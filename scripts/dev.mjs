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
 *    of game logs. A bigger heap makes it far less likely.
 *
 * Usage: npm run dev  (see also docs/dev-scoreboard.md)
 */
import { spawn, execSync } from "node:child_process";
import process from "node:process";

const isWindows = process.platform === "win32";

/** Kill any next/netlify node process still holding this project's ports. */
function clearStale() {
  try {
    if (isWindows) {
      // CommandLine matching rather than port scanning: a stale child may hold
      // several ports, and we want all of its pieces gone, not one listener.
      const ps = [
        "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\"",
        "| Where-Object { $_.CommandLine -match 'next dist.bin.next|netlify-cli|next[\\\\/]dist[\\\\/]server' }",
        "| ForEach-Object { $_.ProcessId }",
      ].join(" ");
      const out = execSync(`powershell -NoProfile -Command "${ps}"`, { encoding: "utf8" }).trim();
      const pids = out.split(/\s+/).filter(Boolean).filter((p) => Number(p) !== process.pid);
      if (pids.length === 0) return;
      console.log(`· clearing ${pids.length} stale dev process${pids.length === 1 ? "" : "es"}`);
      execSync(`powershell -NoProfile -Command "Stop-Process -Id ${pids.join(",")} -Force -ErrorAction SilentlyContinue"`);
    } else {
      execSync("pkill -f 'next/dist/bin/next|netlify-cli' || true", { stdio: "ignore" });
    }
  } catch {
    // Nothing to clear, or the query failed. Never block startup on cleanup.
  }
}

clearStale();

const child = spawn("netlify", ["dev"], {
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    // Headroom for the render fork. See note 2 above.
    NODE_OPTIONS: [process.env.NODE_OPTIONS, "--max-old-space-size=8192"].filter(Boolean).join(" "),
  },
});

// Take the children with us, so the next run starts clean.
const bye = () => { clearStale(); process.exit(0); };
process.on("SIGINT", bye);
process.on("SIGTERM", bye);
child.on("exit", (code) => process.exit(code ?? 0));
