#!/usr/bin/env node
/**
 * dev.mjs — start `netlify dev` from a known-clean state.
 *
 * Two failure modes cost real time during this build, and both are avoidable:
 *
 * 1. ORPHANED CHILDREN. `netlify dev` spawns its own `next dev`. When the
 *    parent is killed (or crashes), that child survives and keeps port 3000.
 *    The next `netlify dev` then finds the port taken, prints "Another next dev
 *    server is already running", and exits — which reads as "netlify dev is
 *    broken" rather than "there is a zombie". This clears them first.
 *
 * 2. RENDER WORKERS DYING ON MEMORY. Next renders pages in a forked child. On
 *    a long session the dev server grows past 4 GB, the fork cannot allocate,
 *    and the OS kills it. Next reports that as "Jest worker encountered 2 child
 *    process exceptions, exceeding retry limit", which names neither the cause
 *    nor the page. Coach pages hit it first because one of them parses ~140 MB
 *    of game logs. A bigger heap makes it far less likely — granted to Next
 *    alone, on the `[dev] command` in netlify.toml. See point 3.
 *
 * 3. THE NETLIFY CLI PROXY LEAKS, AND THEN ABORTS. Measured on this project:
 *    the proxy process went from 131 MB to 4,988 MB in 126 seconds across
 *    twenty requests, monotonically, while `next dev` held flat at 2.5 GB. It
 *    climbs until it reaches its heap ceiling, at which point V8 aborts through
 *    __fastfail and Windows reports exit 3221226505 with no message, no npm
 *    error and no Windows Error Reporting entry — so it reads as the dev server
 *    having simply vanished mid-request.
 *
 *    Two consequences, both handled here. The heap flag must NOT be set through
 *    NODE_OPTIONS, because every node process in the tree inherits it and the
 *    leak would be handed an 8 GB rope. And because the proxy is the process
 *    that dies, its own `next dev` child survives holding port 3000 — so a
 *    crash used to poison the next start too. This script now supervises:
 *    clears the orphan and restarts, turning a dead afternoon into a few
 *    seconds. The leak is upstream and cannot be fixed from here.
 *
 * Usage: npm run dev  (see also docs/dev-scoreboard.md)
 */
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const isWindows = process.platform === "win32";

/** Ports this project's dev stack binds. Freeing these is the whole job. */
const PORTS = [8899, 3000];

/**
 * Kill whatever is still holding the dev ports, plus any stray next/netlify
 * node process.
 *
 * WRITTEN TO A SCRIPT FILE RATHER THAN PASSED AS -Command. An earlier version
 * inlined the PowerShell in an execSync string; the nested quotes required by
 * `-Filter "Name='node.exe'"` were stripped on the way through the shell and
 * PowerShell answered "Invalid query" — so the cleanup silently did nothing,
 * netlify dev then failed on "Could not acquire required 'port': '8899'", and
 * the whole point of this script was lost. A temp file has no quoting layer to
 * get wrong.
 *
 * PORT OWNERS FIRST, name matching second: the thing blocking startup is
 * whoever holds the port, whatever it happens to be called.
 *
 * THE PATTERN USES `.` WHERE A PATH HAS `\`, deliberately, and it is wrong two
 * different ways if you write the backslashes out. A JS template literal eats
 * `\d` down to `d` (unknown escapes drop the backslash), so `next\dist` reached
 * PowerShell as `nextdist`; and even delivered intact, `-match` is a REGEX
 * operator where `\d` means "a digit". Both branches silently matched nothing.
 * A dot matches the separator on either OS and cannot be mangled by either
 * layer.
 */
function clearStale() {
  try {
    if (isWindows) {
      const ps = `
$ErrorActionPreference = 'SilentlyContinue'
$ids = @()
foreach ($p in ${PORTS.join(",")}) {
  $ids += (Get-NetTCPConnection -LocalPort $p -State Listen).OwningProcess
}
$ids += (Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq 'node.exe' -and $_.CommandLine -match 'netlify-cli|next.dist.bin.next|next.dist.server'
}).ProcessId
$ids = $ids | Where-Object { $_ -and $_ -ne $PID } | Select-Object -Unique
if ($ids) { $ids -join ',' ; Stop-Process -Id $ids -Force }
`;
      const file = path.join(os.tmpdir(), `bta-dev-clean-${process.pid}.ps1`);
      fs.writeFileSync(file, ps, "utf8");
      try {
        const out = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${file}"`, {
          encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        if (out) console.log(`· cleared stale dev process(es): ${out}`);
      } finally {
        fs.rmSync(file, { force: true });
      }
    } else {
      execSync(`lsof -ti:${PORTS.join(",")} | xargs -r kill -9`, { stdio: "ignore" });
      execSync("pkill -f 'next/dist/bin/next|netlify-cli' || true", { stdio: "ignore" });
    }
  } catch {
    // Nothing to clear, or the query failed. Never block startup on cleanup.
  }
}

/** Give the OS a moment to actually release the sockets before rebinding. */
function waitForPorts() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      if (isWindows) {
        const out = execSync(
          `powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort ${PORTS.join(",")} -State Listen -ErrorAction SilentlyContinue | Measure-Object).Count"`,
          { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
        ).trim();
        if (out === "0") return;
      } else {
        execSync(`lsof -ti:${PORTS.join(",")}`, { stdio: "ignore" });
      }
    } catch {
      return; // nothing listening
    }
    execSync(isWindows ? "powershell -NoProfile -Command \"Start-Sleep -Milliseconds 400\"" : "sleep 0.4", { stdio: "ignore" });
  }
}

clearStale();
waitForPorts();

/**
 * 0xC0000409 — STATUS_STACK_BUFFER_OVERRUN, which on modern Windows is what
 * `__fastfail` reports. Node uses it for a V8 fatal error, so this is the
 * signature of the proxy aborting on its own heap rather than being killed.
 */
const FASTFAIL = 3221226505;

let child = null;
let shuttingDown = false;
let restarts = 0;
/** Enough to survive an afternoon; a cap so a genuinely broken config still stops. */
const MAX_RESTARTS = 20;

function start() {
  // NOTE: no NODE_OPTIONS here on purpose. The render fork's heap flag lives on
  // the `[dev] command` in netlify.toml so it applies to Next ALONE — see the
  // comment there. Setting it in the environment handed the same 8 GB ceiling
  // to the leaking Netlify proxy, which is what turned a slow leak into a hard
  // crash.
  child = spawn("netlify", ["dev"], { stdio: "inherit", shell: true });

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    const how = signal ? `signal ${signal}` : `exit code ${code}`;
    const leaked = code === FASTFAIL;
    console.log(`\n· netlify dev ended — ${how}${leaked ? "  (V8 fatal error — the CLI proxy's known heap leak)" : ""}`);

    if (restarts >= MAX_RESTARTS) {
      console.log(`· ${MAX_RESTARTS} restarts reached; stopping. Something is wrong beyond the leak.`);
      process.exit(code ?? 0);
    }
    restarts++;
    // The dead proxy leaves its `next dev` child holding port 3000. Left alone,
    // the respawn hits "Another next dev server is already running" and exits —
    // which is how one crash used to end the whole session.
    console.log(`· clearing the orphaned next dev and restarting (${restarts}/${MAX_RESTARTS})…`);
    clearStale();
    waitForPorts();
    start();
  });
}

// Take the children with us, so the next run starts clean.
const bye = (sig) => {
  shuttingDown = true;
  console.log(`\n· dev.mjs received ${sig}, cleaning up`);
  clearStale();
  process.exit(0);
};
process.on("SIGINT", () => bye("SIGINT"));
process.on("SIGTERM", () => bye("SIGTERM"));
process.on("SIGHUP", () => bye("SIGHUP"));

start();
