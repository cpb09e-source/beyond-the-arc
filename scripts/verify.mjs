#!/usr/bin/env node
/**
 * verify.mjs — every check the repo has, in one command, with one verdict.
 *
 *   npm run verify                        typechecks, math checks, guard rules
 *   npm run verify -- --smoke             also drives the desktop app's real window
 *   npm run verify -- --smoke --full      and the slow player Find Similar
 *   npm run verify -- --only desktop      one group: repo, site or desktop
 *
 * WHY ONE COMMAND. The checks arrived one feature at a time (the filter grammar,
 * the explain engine, Find Similar's score, the guard rules, two typechecks) and
 * each was remembered only by the session that wrote it. A release candidate,
 * and the bta-verify agent (.claude/agents/bta-verify.md), need all of them.
 *
 * AT ONCE, REPORTED IN ORDER. The static checks share nothing, so they run in
 * parallel. The smoke suite runs after them and alone: it needs a quiet machine,
 * and a typecheck names most of what would break it faster.
 *
 * Exits 0 only when every check that ran passed.
 */
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DESKTOP = join(REPO, "desktop");
const argv = process.argv.slice(2);
const onlyAt = argv.indexOf("--only");
const only = onlyAt >= 0 ? new Set((argv[onlyAt + 1] ?? "").split(",")) : null;
const smoke = argv.includes("--smoke");

const tsx = (file) => ({ cmd: "npx", args: ["tsx", "--tsconfig", "tsconfig.json", file], cwd: DESKTOP });

const CHECKS = [
  { group: "repo", label: "Guard rules", cmd: "node", args: [".claude/hooks/guard.test.mjs"], cwd: REPO },
  { group: "site", label: "Site typecheck", cmd: "npx", args: ["tsc", "--noEmit"], cwd: REPO },
  { group: "desktop", label: "Desktop typecheck", cmd: "npx", args: ["tsc", "--noEmit", "-p", "tsconfig.json"], cwd: DESKTOP },
  { group: "desktop", label: "Filter grammar", ...tsx("scripts/check-filter.mts") },
  { group: "desktop", label: "Explain engine", ...tsx("scripts/check-explain.mts") },
  { group: "desktop", label: "Find Similar score", ...tsx("scripts/check-similar.mts") },
].filter((c) => !only || only.has(c.group));

function run({ cmd, args, cwd }, timeoutMs = 10 * 60_000) {
  return new Promise((done) => {
    const started = Date.now();
    // npx is a .cmd on Windows, which only a shell can start; the shell gets one fixed command line.
    const child =
      process.platform === "win32" ? spawn([cmd, ...args].join(" "), { cwd, shell: true, env: process.env }) : spawn(cmd, args, { cwd, env: process.env });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ ok: code === 0, code, out, secs: (Date.now() - started) / 1000 });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      done({ ok: false, code: -1, out: String(err), secs: (Date.now() - started) / 1000 });
    });
  });
}

const lastLine = (out) =>
  out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .pop() ?? "";

function report(label, r) {
  const mark = r.ok ? "PASS" : "FAIL";
  console.log(`  ${mark}  ${label.padEnd(22)} ${r.secs.toFixed(1).padStart(6)}s  ${r.ok ? lastLine(r.out).slice(0, 90) : `exit ${r.code}`}`);
  if (!r.ok) {
    const tail = r.out.split(/\r?\n/).filter((l) => l.trim()).slice(-40);
    for (const l of tail) console.log(`        ${l}`);
  }
}

console.log(`Beyond the Arc: verify${only ? ` (${[...only].join(", ")})` : ""}${smoke ? " with the smoke suite" : ""}`);
const results = await Promise.all(CHECKS.map((c) => run(c)));
CHECKS.forEach((c, i) => report(c.label, results[i]));
let ok = results.every((r) => r.ok);

if (smoke) {
  const extra = argv.filter((a) => a === "--full" || a === "--keep");
  const r = await run({ cmd: "node", args: ["scripts/smoke/run.mjs", ...extra], cwd: DESKTOP }, 20 * 60_000);
  // The suite prints its own check-by-check lines; show them all.
  console.log("");
  for (const l of r.out.split(/\r?\n/).filter((x) => x.trim())) console.log(`  ${l}`);
  report("Desktop smoke suite", { ...r, out: r.ok ? r.out : "" });
  ok &&= r.ok;
}

console.log(ok ? "\nVERIFY PASSED" : "\nVERIFY FAILED");
process.exit(ok ? 0 : 1);
