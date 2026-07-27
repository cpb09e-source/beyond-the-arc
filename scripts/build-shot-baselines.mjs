/**
 * build-shot-baselines.mjs — league-wide FG% by court location, split by
 * position bucket, for the player page's "vs position" shot chart.
 *
 * Reads what's already on disk (public/data/shots/*.json + players-by-year)
 * rather than the CBBD plays archive, so it's a pure re-derivation with no
 * network and no dependency on data/cbbd being present.
 *
 * Output: public/data/shot-baselines.json
 *   { r, seasons: { "2026": { G: { "247,53": [made, att] }, F: {…}, C: {…} } } }
 *
 * Binned on a COARSER hex grid than the volume chart (r=22 vs r=9). A single
 * player takes ~450 shots a season; at r=9 that's 2-3 attempts per cell, which
 * is not a shooting percentage, it's noise. The client shrinks toward this
 * baseline on top of that — see player-shot-chart.tsx.
 *
 * r was 15 first. At that size a typical player still only put ~4 attempts in
 * a cell and the court read as scattered confetti; 22 groups the floor into
 * regions you can actually name ("left elbow", "top of the key") and roughly
 * doubles the attempts behind each one.
 */
import fs from "node:fs";
import path from "node:path";
import { hexbin as d3hexbin } from "d3-hexbin";

const ROOT = path.resolve("public/data");
const SHOTS = path.join(ROOT, "shots");
const OUT = path.join(ROOT, "shot-baselines.json");

// The client reads this back off the file, so the two can't disagree.
const R = 22;
const W = 500, H = 400;
const CX = 0, CY = 1, MADE = 2;

// Same mapping as compute-player-ranks.mts / build-box-epm-features.mjs. Bart's
// per-season role note (raw_row[64]) is the only position signal we carry.
const BUCKET_BY_NOTE = {
  "Pure PG": "G", "Scoring PG": "G", "Combo G": "G", "Wing G": "G",
  "Wing F": "F", "Stretch 4": "F",
  "G/F": "G", "F/G": "F", "C/F": "C",
  "PF/C": "C", "C": "C",
};

// Seasons the shots pipeline covers (build-player-shots.mjs writes 2024+).
const SEASONS = [2024, 2025, 2026];

// ---- bart_player_id → bucket, per season ----
const bucketBySeason = new Map(); // year → Map(bartId → "G"|"F"|"C")
for (const year of SEASONS) {
  const m = new Map();
  const file = path.join(ROOT, "players-by-year", `${year}.json`);
  if (!fs.existsSync(file)) { bucketBySeason.set(year, m); continue; }
  for (const p of JSON.parse(fs.readFileSync(file, "utf8"))) {
    const note = p.player_bart_stats?.raw_row?.[64] ?? p.player_bart_stats?.notes;
    const b = BUCKET_BY_NOTE[note];
    if (b && p.bart_player_id) m.set(p.bart_player_id, b);
  }
  bucketBySeason.set(year, m);
  console.log(`  ${year}: ${m.size.toLocaleString()} players bucketed`);
}

// ---- accumulate every located shot into (season, bucket) hex grids ----
// Collect points first so one hexbin pass per group assigns cells consistently.
const points = new Map(); // `${year}|${bucket}` → [[x,y,made], …]
let files = 0, shots = 0, unbucketed = 0;

for (const name of fs.readdirSync(SHOTS)) {
  if (!name.endsWith(".json")) continue;
  const j = JSON.parse(fs.readFileSync(path.join(SHOTS, name), "utf8"));
  const bartId = j.bart_player_id;
  files++;
  for (const [yStr, rows] of Object.entries(j.seasons ?? {})) {
    const year = Number(yStr);
    const bucket = bucketBySeason.get(year)?.get(bartId);
    if (!bucket) { unbucketed += rows.length; continue; }
    const key = `${year}|${bucket}`;
    let arr = points.get(key);
    if (!arr) { arr = []; points.set(key, arr); }
    for (const s of rows) { arr.push(s); shots++; }
  }
}
console.log(`  ${files.toLocaleString()} shot files · ${shots.toLocaleString()} shots bucketed · ${unbucketed.toLocaleString()} skipped (no position note)`);

// ---- bin ----
const gen = d3hexbin().x((s) => s[CX]).y((s) => s[CY]).radius(R).extent([[0, 0], [W, H]]);
const seasons = {};
for (const [key, arr] of points) {
  const [yStr, bucket] = key.split("|");
  (seasons[yStr] ??= {});
  const cells = {};
  for (const b of gen(arr)) {
    // Rounded centre as the cell key. Lattice spacing at r=22 is 38.1 in x and
    // 33.0 in y, so rounding to whole units can't collide two centres.
    cells[`${Math.round(b.x)},${Math.round(b.y)}`] = [b.reduce((n, s) => n + s[MADE], 0), b.length];
  }
  seasons[yStr][bucket] = cells;
}

fs.writeFileSync(OUT, JSON.stringify({ r: R, w: W, h: H, seasons }));
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`Wrote ${OUT} (${kb} KB)`);
for (const [y, byBucket] of Object.entries(seasons)) {
  const parts = Object.entries(byBucket).map(([b, cells]) => {
    const att = Object.values(cells).reduce((n, [, a]) => n + a, 0);
    return `${b} ${Object.keys(cells).length} cells / ${att.toLocaleString()} att`;
  });
  console.log(`  ${y}: ${parts.join(" · ")}`);
}
