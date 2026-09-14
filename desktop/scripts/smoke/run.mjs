#!/usr/bin/env node
/**
 * run.mjs — the desktop smoke suite: the app's main paths in its real window,
 * checked against known numbers, so a change that breaks a filter, a download,
 * Find Similar, a hint or the research history fails here, not in Colin's hands.
 *
 *   node scripts/smoke/run.mjs                   reuse the app on port 9223, or start one and close it after
 *   node scripts/smoke/run.mjs --keep            leave a started app running
 *   node scripts/smoke/run.mjs --only filters,similar
 *   node scripts/smoke/run.mjs --full            also player Find Similar (reads thirteen seasons of players)
 *   node scripts/smoke/run.mjs --shots <dir>     screenshots at each scenario's key moments
 *
 * THE NUMBERS ARE 2025-26's, a frozen season: they hold until that season's data
 * is rebuilt. A changed count means a behavior changed; never "fix" one here
 * without knowing which.
 *
 * STARTING THE APP. `npm run dev` with BTA_CDP_PORT; BTA_EXPORT_DIR, so a
 * download lands in a temporary folder instead of opening a Save dialog; and
 * BTA_PROFILE_DIR, a fresh temporary profile. The profile has its own
 * single-instance lock, so the suite runs beside a dev copy someone already has
 * open, and it never touches that copy's history, hints, favorites or sign-in.
 * Output goes to a log file, never a pipe. The started copy and its profile are
 * removed at the end unless --keep.
 *
 * A REUSED APP (one already on the port) was started by someone else, maybe
 * without BTA_EXPORT_DIR, so the download checks are skipped rather than left
 * waiting on a dialog, and its profile is the one it has.
 *
 * WHAT IT LEAVES BEHIND in a reused app: each scenario puts its table back as it
 * found it and restores the hint counters, but the research history keeps the
 * steps the run took.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { connect, sleep } from "./cdp.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DESKTOP = resolve(HERE, "../..");
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};
const PORT = Number(opt("--port", "9223"));
const FULL = argv.includes("--full");
const KEEP = argv.includes("--keep");
const SCENARIOS = ["views", "filters", "tables", "similar", "hints", "history", "sidebar"];
const only = opt("--only", null)?.split(",");
const chosen = only ? SCENARIOS.filter((s) => only.includes(s)) : SCENARIOS;

const work = mkdtempSync(join(tmpdir(), "bta-smoke-"));
const shotsDir = opt("--shots", null);

async function appUp() {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(1500) })).json();
    return list.some((t) => t.type === "page" && /^(http:\/\/localhost|file:)/.test(t.url));
  } catch {
    return false;
  }
}

let child = null;
let exportsDir = null;
const logFile = join(work, "dev.log");

async function stopApp() {
  if (!child || KEEP) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill();
  // The profile's files stay locked for a moment after the processes go.
  for (let i = 0; i < 10; i++) {
    try {
      rmSync(join(work, "profile"), { recursive: true, force: true });
      return;
    } catch {
      await sleep(500);
    }
  }
}

if (await appUp()) {
  console.log(`Using the app already on port ${PORT} (download checks skipped).`);
} else {
  exportsDir = join(work, "exports");
  mkdirSync(exportsDir, { recursive: true });
  const profileDir = join(work, "profile");
  mkdirSync(profileDir, { recursive: true });
  const log = openSync(logFile, "w");
  console.log(`Starting the dev app on port ${PORT} with a fresh profile (log: ${logFile})`);
  child = spawn("npm run dev", {
    cwd: DESKTOP,
    shell: true,
    stdio: ["ignore", log, log],
    env: { ...process.env, BTA_CDP_PORT: String(PORT), BTA_EXPORT_DIR: exportsDir, BTA_PROFILE_DIR: profileDir },
  });
  const until = Date.now() + 180_000;
  while (!(await appUp())) {
    if (child.exitCode != null || Date.now() > until) {
      const tail = readFileSync(logFile, "utf8").split(/\r?\n/).slice(-25).join("\n");
      console.log(`FAIL the app did not start${child.exitCode != null ? ` (exit ${child.exitCode})` : " within 3 minutes"}.`);
      console.log(tail);
      await stopApp();
      process.exit(1);
    }
    await sleep(1000);
  }
}

const results = [];
let app;
try {
  app = await connect(PORT, shotsDir);
  await app.reload();
  for (const name of chosen) {
    const t = {
      name,
      exportsDir,
      full: FULL,
      check(label, ok, got) {
        results.push({ name, label, ok: !!ok });
        const detail = !ok && got !== undefined ? `  (got ${typeof got === "string" ? got : JSON.stringify(got)})` : "";
        console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${label}${detail}`);
      },
    };
    const started = Date.now();
    app.errors.length = 0;
    try {
      const mod = await import(pathToFileURL(join(HERE, `${name}.mjs`)).href);
      await mod.default(app, t);
    } catch (err) {
      t.check("ran to the end", false, err instanceof Error ? err.message.slice(0, 300) : String(err));
      await app.key("Escape").catch(() => {});
    }
    t.check("no errors in the page", app.errors.length === 0, app.errors.slice(0, 3));
    console.log(`     ${name} took ${((Date.now() - started) / 1000).toFixed(0)}s`);
  }
} catch (err) {
  results.push({ name: "suite", label: "connect", ok: false });
  console.log(`FAIL could not drive the window: ${err instanceof Error ? err.message : String(err)}`);
} finally {
  app?.close();
  await stopApp();
}

const failed = results.filter((r) => !r.ok);
console.log(
  failed.length
    ? `\n${failed.length} of ${results.length} SMOKE CHECKS FAILED`
    : `\nALL ${results.length} SMOKE CHECKS PASSED (${chosen.join(", ")})`,
);
process.exit(failed.length ? 1 : 0);
