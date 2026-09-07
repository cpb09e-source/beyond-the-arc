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
 * THE PATTERN IS DELIBERATELY WIDER THAN "NEXT AND NETLIFY". Measured
 * 2026-09-07: after the supervisor is killed without a signal (closing the
 * terminal, a task manager stop) SIX processes survive, and only two of them
 * were matched by the original pattern. The other four are `scripts/dev.mjs`
 * itself, the netlify `functions:serve` runtime, our own dev-proxy, and
 * `.next/dev/build/postcss.js` — a worker Next 16 runs out of process for
 * PostCSS. Between them they held four gigabytes. None hold a port we check
 * except by luck, so name matching is what actually reaps them.
 *
 * THE PATTERN USES `.` WHERE A PATH HAS `\`, deliberately, and it is wrong two
 * different ways if you write the backslashes out. A JS template literal eats
 * `\d` down to `d` (unknown escapes drop the backslash), so `next\dist` reached
 * PowerShell as `nextdist`; and even delivered intact, `-match` is a REGEX
 * operator where `\d` means "a digit". Both branches silently matched nothing.
 * A dot matches the separator on either OS and cannot be mangled by either
 * layer.
 *
 * AND IT MUST NOT KILL US. The exclusion below is `-ne $PID -and -ne <our
 * pid>`: inside a .ps1, `$PID` is PowerShell's own process, not the node
 * process that spawned it. That was harmless while the pattern could not match
 * `scripts/dev.mjs` itself — and instantly fatal on 2026-09-07 when it could:
 * dev.mjs matched, killed itself before printing a single line, and npm
 * reported a bare exit 127 with no output at all. Our own pid is interpolated
 * in so a stale supervisor from a previous run still dies and this one does
 * not.
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
  $_.Name -eq 'node.exe' -and $_.CommandLine -match 'netlify-cli|next.dist.bin.next|next.dist.server|functions.serve|esbuild|zip-it-and-ship-it|dev-proxy|dev.build.postcss|scripts.dev.mjs'
}).ProcessId
$ids = $ids | Where-Object { $_ -and $_ -ne $PID -and $_ -ne ${process.pid} } | Select-Object -Unique
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
    // Sleep in-process. The old line shelled out to PowerShell for the sleep
    // itself, so a single startup burned ~40 processes before Next even began.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
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

/**
 * THE MACHINE COMES FIRST.
 *
 * On 2026-09-07 one `npm run dev` left several hundred node processes alive —
 * two distinct waves, ~5-9 MB each at first and ~70 MB each a minute later —
 * and Windows became unusable: bash could no longer fork ("Resource
 * temporarily unavailable") and the desktop had to be restarted. The restart
 * loop below was not the cause; it fired exactly once in that run.
 *
 * Whatever spawns them, this is the backstop. A healthy stack is Next plus
 * functions:serve plus the proxy plus their immediate helpers — comfortably
 * under twenty node processes. If the count runs away, we stop the stack
 * ourselves and print what was multiplying, rather than letting the box swap
 * itself to death while nobody can open Task Manager.
 *
 * Counting uses `tasklist` rather than PowerShell: one short-lived process
 * every ten seconds instead of a PowerShell startup.
 */
const NODE_LIMIT = 45;
const WATCH_MS = 3_000;   // the runaway filled ten seconds; sample faster than it grows

function countNodes() {
  if (!isWindows) return 0;
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq node.exe" /NH /FO CSV', {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split("\n").filter((l) => l.includes("node.exe")).length;
  } catch {
    return 0;
  }
}

/**
 * What is actually multiplying — printed once, when we trip the limit.
 *
 * Via a temp .ps1 for the same reason clearStale uses one: the query needs
 * nested quotes (`-Filter "Name='node.exe'"`) and passing that through
 * -Command loses them silently, which would make the diagnostic print nothing
 * at exactly the moment it matters.
 */
function reportNodes() {
  if (!isWindows) return "";
  const ps = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ForEach-Object {",
    "  $c = $_.CommandLine",
    "  if (-not $c) { $c = '(no command line)' }",
    "  if ($c.Length -gt 110) { $c = $c.Substring(0,110) }",
    "  $c",
    "} | Group-Object | Sort-Object Count -Descending | Select-Object -First 6 | ForEach-Object {",
    "  '{0,5}  {1}' -f $_.Count, $_.Name",
    "}",
  ].join("\n");
  const file = path.join(os.tmpdir(), `bta-dev-report-${process.pid}.ps1`);
  try {
    fs.writeFileSync(file, ps, "utf8");
    return execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${file}"`, {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20000,
    });
  } catch {
    return "  (could not enumerate)";
  } finally {
    fs.rmSync(file, { force: true });
  }
}

/**
 * Kill a child AND everything it started.
 *
 * `spawn(..., { shell: true })` on Windows makes the direct child a cmd.exe;
 * `child.kill()` kills that shell and orphans the node process underneath it,
 * which then survives every subsequent run. taskkill /T walks the tree.
 */
function killTree(child) {
  if (!child || !child.pid) return;
  try {
    if (isWindows) execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: "ignore" });
    else child.kill("SIGKILL");
  } catch {
    try { child.kill(); } catch { /* already gone */ }
  }
}

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
  for (const child of children.values()) killTree(child);
  clearStale();
  process.exit(0);
};
process.on("SIGINT", () => bye("SIGINT"));
process.on("SIGTERM", () => bye("SIGTERM"));
process.on("SIGHUP", () => bye("SIGHUP"));

for (const svc of SERVICES) start(svc);

// The watchdog runs for the life of the session. unref() so it never keeps the
// process alive on its own.
if (isWindows) {
  const timer = setInterval(() => {
    const n = countNodes();
    if (n <= NODE_LIMIT) return;
    console.log(`\n· RUNAWAY: ${n} node processes (limit ${NODE_LIMIT}). Stopping the dev stack.`);
    console.log("· what is multiplying:\n" + reportNodes());
    clearInterval(timer);
    bye("watchdog");
  }, WATCH_MS);
  timer.unref();
}
