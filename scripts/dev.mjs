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
 * 3. THE NETLIFY CLI PROXY LEAKED, AND THEN ABORTED — SO IT IS GONE. Measured
 *    on this project: the proxy process went from 131 MB to 4,988 MB in 126
 *    seconds across twenty requests, monotonically, while `next dev` held flat
 *    at 2.5 GB. It climbed until V8 aborted through __fastfail and Windows
 *    reported exit 3221226505 with no message, no npm error and no Windows
 *    Error Reporting entry — so it read as the dev server having simply
 *    vanished mid-request. Upgrading the CLI 26 -> 27 made it worse.
 *
 *    And well before the crash it started SILENTLY DROPPING CLIENT
 *    NAVIGATIONS: on the teams explorer nothing could write the URL — not the
 *    filter chips, not the "Show" select, not column sorting — with no error
 *    and no failed request, while production did the same interaction in 800ms.
 *    A proxy that fails by doing nothing is worse than one that crashes.
 *
 *    So `netlify dev` no longer runs at all. This script starts the three
 *    processes itself and puts our own streaming proxy in front — see the
 *    SERVICES table below and scripts/dev-proxy.mjs. The heap flag still stays
 *    on Next alone rather than in NODE_OPTIONS, which every child inherits.
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
const PORTS = [8899, 3000, 9999];

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
 * signature of a process aborting on its own heap rather than being killed.
 */
const FASTFAIL = 3221226505;

let shuttingDown = false;
/** Enough to survive an afternoon; a cap so a genuinely broken config still stops. */
const MAX_RESTARTS = 20;

/**
 * THREE PROCESSES, NOT ONE.
 *
 * `netlify dev` used to be the single entry point: it spawned Next and put its
 * own proxy in front. That proxy is the leak (see the header, and
 * scripts/dev-proxy.mjs), so it is gone. What replaces it:
 *
 *   next dev            :3000   the app
 *   functions:serve     :9999   the three /api/* functions, real runtime + env
 *   dev-proxy.mjs       :8899   streaming front door, one origin over both
 *
 * Each is supervised independently, because they fail independently: Next dies
 * on a render-fork OOM, functions:serve dies on an esbuild error in a handler,
 * and neither should take the other down. The proxy is ours and holds nothing,
 * so in practice it just sits there.
 *
 * The heap flag stays scoped to Next alone (it is the only one that renders
 * pages) rather than going through NODE_OPTIONS, which every child inherits.
 */
const SERVICES = [
  {
    name: "next dev",
    cmd: "node",
    args: ["--max-old-space-size=8192", "./node_modules/next/dist/bin/next", "dev", "--port", "3000"],
  },
  {
    name: "functions:serve",
    cmd: "netlify",
    args: ["functions:serve", "--port", "9999"],
  },
  {
    name: "dev-proxy",
    cmd: "node",
    args: ["./scripts/dev-proxy.mjs"],
  },
];

const children = new Map();

function start(svc) {
  const child = spawn(svc.cmd, svc.args, { stdio: "inherit", shell: true });
  children.set(svc.name, child);

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    children.delete(svc.name);
    const how = signal ? `signal ${signal}` : `exit code ${code}`;
    const fatal = code === FASTFAIL;
    console.log(`\n· ${svc.name} ended — ${how}${fatal ? "  (V8 fatal error — out of heap)" : ""}`);

    svc.restarts = (svc.restarts ?? 0) + 1;
    if (svc.restarts > MAX_RESTARTS) {
      console.log(`· ${svc.name} restarted ${MAX_RESTARTS} times; giving up. Something is wrong beyond a leak.`);
      return;
    }
    // Only this service's port needs freeing — the other two are still serving,
    // and clearing everything would turn one crash into a full restart.
    console.log(`· restarting ${svc.name} (${svc.restarts}/${MAX_RESTARTS})…`);
    setTimeout(() => start(svc), 500);
  });
}

// Take the children with us, so the next run starts clean.
const bye = (sig) => {
  shuttingDown = true;
  console.log(`\n· dev.mjs received ${sig}, cleaning up`);
  for (const child of children.values()) child.kill();
  clearStale();
  process.exit(0);
};
process.on("SIGINT", () => bye("SIGINT"));
process.on("SIGTERM", () => bye("SIGTERM"));
process.on("SIGHUP", () => bye("SIGHUP"));

for (const svc of SERVICES) start(svc);
