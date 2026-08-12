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
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA = join(ROOT, "public", "data");
// Raised from 8 to 13 (2026-07), then 13 to 15 (2026-08). At 8 the gate created
// a cliff rather than a floor: below it a player was absent and the UI showed
// 0.0, at it he inherited a full team-driven prior. On Michigan that was a
// 3.9-point gap opened by 7.7 minutes. 13 mpg was where a box line started
// describing a role instead of a cameo; 15 is where it starts describing a
// rotation player, and bench rows in the 13-15 band were still reading mostly
// as their team. Players below it are omitted entirely and render as "—",
// never 0.0, which is a claim we cannot support.
//
// MUST match MIN_PG in export-epm-json.mjs — if the two disagree, a player
// gets a real EPM from one source and a suppressed one from the other for the
// same role, and which he gets depends on whether the play-by-play fit
// happened to cover him.
const MIN_PG = 15;
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

/**
 * ARC-SCALE VERSION OF THE ESTIMATE.
 *
 * For seasons with no play-by-play the explorer shows this file's numbers in the
 * ARC column, marked estimated. That was comparing two different units. Box-EPM
 * is a shrunk PREDICTION of ARC, so it lives on a much narrower scale — sd 0.87
 * and a maximum near 3.6, against real ARC's sd 1.67 and maximum near 8.3. On an
 * all-seasons leaderboard no pre-2024 player could ever place, not because they
 * were worse but because their number was computed in different units.
 *
 * So regress real ARC on the estimate over the seasons where BOTH exist, and
 * ship the mapping applied to every season as separate `_s` fields.
 *
 * Separate fields on purpose: build-epm-priors.mjs reads `off` and `def` from
 * this same file to build the prior the RAPM fit starts from. Rescaling those
 * in place would feed an inflated prior back into the fit. The raw values stay
 * exactly as they were; only the display copy is rescaled.
 *
 * This expands the estimate's noise along with its signal — an estimate cannot
 * become as informative as a measurement by multiplication. It only stops the
 * two from being silently mixed on one axis.
 */
function arcScaling() {
  const xs = { epm: [], off: [], def: [] };
  const ys = { epm: [], off: [], def: [] };
  for (const year of byYear.keys()) {
    const f = join(DATA, `epm-${year}.json`);
    if (!existsSync(f)) continue;                       // no real fit this season
    const real = JSON.parse(readFileSync(f, "utf8")).players ?? {};
    for (const [bid, r] of Object.entries(real)) {
      const b = byYear.get(year)[bid];
      if (!b || !(r.poss >= 800)) continue;             // reliable rows only
      xs.epm.push(b.epm); ys.epm.push(r.epm);
      xs.off.push(b.off); ys.off.push(r.off);
      xs.def.push(b.def); ys.def.push(r.def);
    }
  }
  const fit = (x, y) => {
    const n = x.length;
    if (n < 200) return { a: 1, b: 0, n };              // not enough overlap — leave alone
    const mx = x.reduce((s, v) => s + v, 0) / n, my = y.reduce((s, v) => s + v, 0) / n;
    let sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; }
    const a = sxx > 0 ? sxy / sxx : 1;
    return { a, b: my - a * mx, n };
  };
  return { epm: fit(xs.epm, ys.epm), off: fit(xs.off, ys.off), def: fit(xs.def, ys.def) };
}
const SCALE = arcScaling();
console.log(`ARC scaling from ${SCALE.epm.n.toLocaleString()} overlapping player-seasons: `
  + `epm x${SCALE.epm.a.toFixed(3)}${SCALE.epm.b >= 0 ? "+" : ""}${SCALE.epm.b.toFixed(3)}, `
  + `off x${SCALE.off.a.toFixed(3)}, def x${SCALE.def.a.toFixed(3)}`);

let total = 0;
for (const [year, players] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
  const n = Object.keys(players).length;
  total += n;
  for (const p of Object.values(players)) {
    p.epm_s = Math.round((SCALE.epm.a * p.epm + SCALE.epm.b) * 100) / 100;
    p.off_s = Math.round((SCALE.off.a * p.off + SCALE.off.b) * 100) / 100;
    p.def_s = Math.round((SCALE.def.a * p.def + SCALE.def.b) * 100) / 100;
  }
  const doc = {
    season: year,
    built_at: BUILT_AT,
    estimated: true,
    method: "box-epm ridge (calibrated to RAPM EPM); see scripts/compute-box-epm.py",
    arc_scale: SCALE,
    players,
  };
  writeFileSync(join(DATA, `box-epm-${year}.json`), JSON.stringify(doc));
  console.log(`  box-epm-${year}.json  ${n} players`);
}
console.log(`Wrote ${byYear.size} year files, ${total} players total`);
