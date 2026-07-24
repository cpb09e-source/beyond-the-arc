#!/usr/bin/env node
// Export Box-EPM predictions to per-year JSON the Players page can consume as an
// ESTIMATED fallback where no real (play-by-play) EPM fit exists.
//
// Shape mirrors epm-<year>.json so the client treats them the same, plus
// `estimated:true` so the UI can mark the values:
//   { season, built_at, estimated:true, players: { <bartId>: {epm,off,def} } }
//
// Gate: only emit players with min_pg >= 8 — low-minute rows carry noisy box
// rates and shouldn't surface even if the user drops the games filter.
//
//   in:  scripts/box-epm-pred.csv   (from compute-box-epm.py)
//   out: public/data/box-epm-<year>.json  (2008..2026)
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA = join(ROOT, "public", "data");
const MIN_PG = 8;
const BUILT_AT = process.env.BUILD_STAMP || "";  // deterministic if provided

const csv = readFileSync(join(__dirname, "box-epm-pred.csv"), "utf8")
  .split(/\r?\n/).map((l) => l.replace(/\r$/, "")).filter(Boolean);
const header = csv[0].split(",");
const col = Object.fromEntries(header.map((h, i) => [h, i]));

const byYear = new Map();
for (let i = 1; i < csv.length; i++) {
  const c = csv[i].split(",");
  const year = Number(c[col.year]);
  const bid = c[col.bart_player_id];
  const minPg = Number(c[col.min_pg]);
  if (!bid || !Number.isFinite(minPg) || minPg < MIN_PG) continue;
  const epm = Number(c[col.box_epm]);
  const off = Number(c[col.box_off]);
  const def = Number(c[col.box_def]);
  if (![epm, off, def].every(Number.isFinite)) continue;
  if (!byYear.has(year)) byYear.set(year, {});
  byYear.get(year)[bid] = { epm, off, def };
}

let total = 0;
for (const [year, players] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
  const n = Object.keys(players).length;
  total += n;
  const doc = {
    season: year,
    built_at: BUILT_AT,
    estimated: true,
    method: "box-epm ridge (calibrated to RAPM EPM); see scripts/compute-box-epm.py",
    players,
  };
  writeFileSync(join(DATA, `box-epm-${year}.json`), JSON.stringify(doc));
  console.log(`  box-epm-${year}.json  ${n} players`);
}
console.log(`Wrote ${byYear.size} year files, ${total} players total`);
