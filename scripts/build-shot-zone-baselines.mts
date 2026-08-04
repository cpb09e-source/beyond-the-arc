/**
 * build-shot-zone-baselines.mts — cohort rate AND cohort DISTRIBUTION for each
 * of the thirteen shot zones, by season and position bucket.
 *
 * The hex baselines (build-shot-baselines.mjs) answer "what does an average
 * guard shoot from here", which is enough to colour a chart hot or cold. It is
 * not enough to say WHERE IN THE FIELD a player sits, because an aggregate has
 * no spread: 39% from the top of the key could be the 60th percentile or the
 * 95th depending on how tightly guards cluster there, and the aggregate cannot
 * tell you which.
 *
 * So this also emits the distribution — 101 breakpoints, p0 through p100, of
 * per-player FG% within each (season, bucket, zone). The client interpolates a
 * percentile off them. Breakpoints rather than the raw list because the list is
 * a few hundred players per cell and the quantiles are all anyone reads.
 *
 * Only players with MIN_ZONE_ATT attempts in a zone enter its distribution. A
 * player who took two corner threes has a FG% of 0 or 50 or 100, and letting
 * those into the pool would flatten the middle of it into noise.
 *
 * Zone geometry is imported from src/lib/shot-zones.ts, the same module the
 * chart uses, so the cohort and the player are pooled by one definition.
 *
 * Reads only committed data. Safe during the freeze.
 *
 * Out: public/data/shot-zone-baselines.json
 *   { minAtt, seasons: { "2026": { G: { close_m: { made, att, q: number[101] } } } } }
 *
 *   Run: npx tsx scripts/build-shot-zone-baselines.mts
 */
import fs from "node:fs";
import path from "node:path";

import { ZONES, zoneOf, type ZoneId } from "../src/lib/shot-zones.ts";

const ROOT = path.resolve("public/data");
const SHOTS = path.join(ROOT, "shots");
const OUT = path.join(ROOT, "shot-zone-baselines.json");

// Tuple positions in the shot files: x, y, made, type, is3, …
const CX = 0, CY = 1, MADE = 2, IS3 = 4;

/** Below this a player's rate in a zone is not a rate, so it stays out. */
const MIN_ZONE_ATT = 10;

const BUCKET_BY_NOTE: Record<string, "G" | "F" | "C"> = {
  "Pure PG": "G", "Scoring PG": "G", "Combo G": "G", "Wing G": "G",
  "Wing F": "F", "Stretch 4": "F",
  "G/F": "G", "F/G": "F", "C/F": "C",
  "PF/C": "C", "C": "C",
};

const SEASONS = [2022, 2023, 2024, 2025, 2026];

type Tally = { made: number; att: number };

// ---- bart_player_id -> bucket, per season ----
const bucketBySeason = new Map<number, Map<number, "G" | "F" | "C">>();
for (const year of SEASONS) {
  const m = new Map<number, "G" | "F" | "C">();
  const file = path.join(ROOT, "players-by-year", `${year}.json`);
  if (fs.existsSync(file)) {
    for (const p of JSON.parse(fs.readFileSync(file, "utf8"))) {
      const st = Array.isArray(p.player_bart_stats) ? p.player_bart_stats[0] : p.player_bart_stats;
      const note = st?.raw_row?.[64] ?? st?.notes;
      const b = BUCKET_BY_NOTE[note as string];
      if (b && p.bart_player_id) m.set(p.bart_player_id, b);
    }
  }
  bucketBySeason.set(year, m);
}

// ---- pool every located shot by (season, bucket, zone) ----
// pooled: cohort totals. perPlayer: one tally per player, for the distribution.
const pooled = new Map<string, Tally>();
const perPlayer = new Map<string, Map<number, Tally>>();
let files = 0, shots = 0, unbucketed = 0;

for (const name of fs.readdirSync(SHOTS)) {
  if (!name.endsWith(".json")) continue;
  const j = JSON.parse(fs.readFileSync(path.join(SHOTS, name), "utf8"));
  const bartId: number = j.bart_player_id;
  files++;
  for (const [yStr, rows] of Object.entries(j.seasons ?? {}) as [string, number[][]][]) {
    const year = Number(yStr);
    const bucket = bucketBySeason.get(year)?.get(bartId);
    if (!bucket) { unbucketed += rows.length; continue; }
    for (const s of rows) {
      const zone = zoneOf(s[CX]!, s[CY]!, s[IS3] === 1);
      const key = `${year}|${bucket}|${zone}`;
      shots++;

      const p = pooled.get(key) ?? { made: 0, att: 0 };
      p.made += s[MADE]!; p.att += 1;
      pooled.set(key, p);

      let byId = perPlayer.get(key);
      if (!byId) { byId = new Map(); perPlayer.set(key, byId); }
      const t = byId.get(bartId) ?? { made: 0, att: 0 };
      t.made += s[MADE]!; t.att += 1;
      byId.set(bartId, t);
    }
  }
}
console.log(`${files.toLocaleString()} shot files · ${shots.toLocaleString()} shots zoned · ${unbucketed.toLocaleString()} skipped (no position note)`);

// ---- breakpoints ----
/** 101 quantiles of a sorted ascending sample, linearly interpolated. */
function quantiles(sorted: number[]): number[] {
  const n = sorted.length;
  const q: number[] = [];
  for (let i = 0; i <= 100; i++) {
    const pos = (i / 100) * (n - 1);
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    const v = lo === hi ? sorted[lo]! : sorted[lo]! + (pos - lo) * (sorted[hi]! - sorted[lo]!);
    q.push(Math.round(v * 10000) / 10000);
  }
  return q;
}

const seasons: Record<string, Record<string, Record<string, { made: number; att: number; q?: number[]; n?: number }>>> = {};
for (const [key, tot] of pooled) {
  const [yStr, bucket, zone] = key.split("|") as [string, string, ZoneId];
  ((seasons[yStr] ??= {})[bucket] ??= {});

  const rates = [...(perPlayer.get(key) ?? new Map()).values()]
    .filter((t) => t.att >= MIN_ZONE_ATT)
    .map((t) => t.made / t.att)
    .sort((a, b) => a - b);

  seasons[yStr]![bucket]![zone] = rates.length >= 20
    ? { made: tot.made, att: tot.att, q: quantiles(rates), n: rates.length }
    : { made: tot.made, att: tot.att };   // too thin to publish a distribution
}

fs.writeFileSync(OUT, JSON.stringify({ minAtt: MIN_ZONE_ATT, zones: ZONES.map((z) => z.id), seasons }));
console.log(`Wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);

for (const y of Object.keys(seasons).sort()) {
  const parts = Object.entries(seasons[y]!).map(([b, zs]) => {
    const withQ = Object.values(zs).filter((z) => z.q).length;
    return `${b} ${withQ}/${Object.keys(zs).length} zones ranked`;
  });
  console.log(`  ${y}: ${parts.join(" · ")}`);
}

// A quick readable check that the distributions are not degenerate.
const sample = seasons["2026"]?.G?.["3_mid"];
if (sample?.q) {
  console.log(`\n2026 guards, three from the top (${sample.n} players over ${MIN_ZONE_ATT} att):`);
  console.log(`  cohort ${(100 * sample.made / sample.att).toFixed(1)}%  ` +
    [10, 25, 50, 75, 90].map((p) => `p${p} ${(100 * sample.q![p]!).toFixed(1)}%`).join("  "));
}
