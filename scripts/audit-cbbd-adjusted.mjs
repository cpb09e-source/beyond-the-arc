#!/usr/bin/env node
/**
 * audit-cbbd-adjusted.mjs — which seasons of CBBD's adjusted ratings can be believed.
 *
 * WHY THIS EXISTS. `team_season_stats.ortg_adj / drtg_adj / net_rtg_adj` come
 * straight from CBBD's /ratings/adjusted, and several seasons of that endpoint
 * are wrong in ways that are invisible in the numbers themselves. 2023 puts 357
 * of 361 teams inside a seven-point band and calls Pittsburgh the best offense
 * in the country at 160.4; 2020 looks completely normal — a 24.5-point spread,
 * nothing out of range — and simply does not describe the season that happened.
 *
 * A SPREAD CHECK CANNOT FIND THE SECOND ONE, which is why this compares against
 * something instead of inspecting the file alone. Bart's adjusted offense minus
 * his adjusted defense is an independent model of the same quantity, and in a
 * season where both sources are working they agree at r > 0.96. Where CBBD is
 * broken the correlation collapses. The gap between the two groups is wide —
 * 0.858 against 0.962 — so the threshold is not a fine judgment call.
 *
 * Our own RAW net rating is NOT a usable reference and was tried first: 2024,
 * 2025 and 2026 correlate only ~0.82 with it, because opponent adjustment is
 * supposed to move teams a long way. A reference has to be adjusted too.
 *
 * Usage: node scripts/audit-cbbd-adjusted.mjs
 *
 * Reads data/cbbd/<year>/ratings-adjusted.json.gz and public/data/teams-all.json.
 * Prints the table that src/lib/cbbd-rating-trust.ts records, and exits 1 if
 * that file's verdict no longer matches what the data says.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = process.cwd();
const SEASONS = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

/** Below this, CBBD's adjusted ratings do not describe the season that happened. */
const MIN_AGREEMENT = 0.93;

const TEAM_MAP = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/cbbd-team-map.json"), "utf8"));
const all = JSON.parse(fs.readFileSync(path.join(ROOT, "public/data/teams-all.json"), "utf8"));

/** Bart's adjusted margin, keyed "<team>|<year>" — the independent reference. */
const bart = new Map();
for (const r of all) {
  const tr = r.team_trank_stats;
  if (tr && typeof tr.adjoe === "number" && typeof tr.adjde === "number") {
    bart.set(`${r.name}|${r.year}`, tr.adjoe - tr.adjde);
  }
}

const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
};

const rows = [];
for (const year of SEASONS) {
  const fp = path.join(ROOT, "data/cbbd", String(year), "ratings-adjusted.json.gz");
  if (!fs.existsSync(fp)) { rows.push({ year, missing: true }); continue; }

  const pairs = [];
  for (const r of JSON.parse(zlib.gunzipSync(fs.readFileSync(fp)).toString())) {
    const mapped = TEAM_MAP[r.teamId];
    if (!mapped) continue;
    const cbbd = r.offensiveRating - r.defensiveRating;
    const ref = bart.get(`${mapped.name}|${year}`);
    if (Number.isFinite(cbbd) && typeof ref === "number") pairs.push([cbbd, ref]);
  }
  if (pairs.length < 50) { rows.push({ year, thin: pairs.length }); continue; }

  const cs = pairs.map((p) => p[0]), bs = pairs.map((p) => p[1]);
  const mc = cs.reduce((s, v) => s + v, 0) / cs.length;
  const mb = bs.reduce((s, v) => s + v, 0) / bs.length;
  let num = 0, dc = 0, db = 0;
  for (const [c, b] of pairs) { num += (c - mc) * (b - mb); dc += (c - mc) ** 2; db += (b - mb) ** 2; }

  rows.push({
    year, n: pairs.length,
    r: num / Math.sqrt(dc * db),
    slope: num / dc,
    spread: pct(cs, 0.95) - pct(cs, 0.05),
    refSpread: pct(bs, 0.95) - pct(bs, 0.05),
  });
}

console.log("year    n   spread   ref    slope       r   verdict");
const rejected = [];
for (const d of rows) {
  if (d.missing) { console.log(`${d.year}    — file missing`); continue; }
  if (d.thin != null) { console.log(`${d.year}    — only ${d.thin} mapped teams`); continue; }
  const ok = d.r >= MIN_AGREEMENT;
  if (!ok) rejected.push(d.year);
  console.log(
    `${d.year}  ${String(d.n).padStart(3)}   ${d.spread.toFixed(1).padStart(5)}  ${d.refSpread.toFixed(1).padStart(5)}`
    + `   ${d.slope.toFixed(2).padStart(5)}   ${d.r.toFixed(3)}   ${ok ? "trusted" : "REJECTED"}`,
  );
}
console.log(`\nrejected: [${rejected.join(", ")}]   (r < ${MIN_AGREEMENT})`);

// The library has to agree with the measurement, or the site is filtering on a
// list somebody edited by hand and never re-checked.
const lib = fs.readFileSync(path.join(ROOT, "src/lib/cbbd-rating-trust.ts"), "utf8");
const declared = (lib.match(/UNTRUSTED_SEASONS = new Set\(\[([^\]]*)\]/) ?? [])[1];
if (declared == null) {
  console.error("\nFAIL: could not find UNTRUSTED_SEASONS in src/lib/cbbd-rating-trust.ts");
  process.exit(1);
}
const declaredSet = declared.split(",").map((s) => Number(s.trim())).filter(Number.isFinite).sort();
const same = declaredSet.length === rejected.length && declaredSet.every((v, i) => v === rejected[i]);
console.log(`declared: [${declaredSet.join(", ")}]  ${same ? "— matches" : "— MISMATCH"}`);
if (!same) process.exit(1);
