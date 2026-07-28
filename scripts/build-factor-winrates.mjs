#!/usr/bin/env node
/**
 * build-factor-winrates.mjs — how often winning each of our four factors wins
 * the game, measured across a full season.
 *
 * Prints a TypeScript literal to paste into src/lib/league-averages.ts.
 *
 * Same source the Win Calculator reads: public/data/game-logs-by-year (which
 * carries reb_diff, fbpts_diff and fg3_made_diff per team-game) joined to the
 * box sidecar in public/data/game-box-by-year for the rate stats (ff_orb,
 * ff_ftr, both stored 0-1).
 *
 * COUNTED PER TEAM-GAME, NOT PER GAME. Each game appears twice, once from each
 * side, so a differential factor is credited to exactly one of the two rows.
 * Non-D1 opponents are dropped — a 40-point win over a non-scholarship
 * programme tells you nothing about whether the factor mattered.
 *
 * OREB% IS SCORED AGAINST THE LEAGUE AVERAGE, not the opponent, matching how
 * the game page judges it: both teams can clear the bar in the same game, or
 * neither can. Every other factor is a differential and is won outright.
 *
 * Run: node scripts/build-factor-winrates.mjs [season]
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const season = Number(process.argv[2]) || 2026;

const logs = JSON.parse(fs.readFileSync(path.join(ROOT, `public/data/game-logs-by-year/${season}.json`), "utf8"));
const box = JSON.parse(fs.readFileSync(path.join(ROOT, `public/data/game-box-by-year/${season}.json`), "utf8"));
const idx = new Map(box.fields.map((f, i) => [f, i]));
const boxOf = (gameId) => box.rows[gameId] ?? null;
const get = (row, key) => {
  const i = idx.get(key);
  return row && i !== undefined ? row[i] : null;
};

// League mean offensive rebound rate for the season, same unweighted team mean
// build-league-averages.mjs emits.
const teamStats = JSON.parse(fs.readFileSync(path.join(ROOT, "public/data/team-season-stats.json"), "utf8"));
const orbs = [];
for (const [k, v] of Object.entries(teamStats)) {
  if (Number(k.split("|")[1]) === season && typeof v?.orb_pct === "number") orbs.push(v.orb_pct);
}
const ORB_BAR = orbs.reduce((s, x) => s + x, 0) / orbs.length; // 0-1

const tally = {
  reb: [0, 0], orb: [0, 0], fbp: [0, 0], tpm: [0, 0], fta: [0, 0], overall: [0, 0],
};
const bump = (key, won) => { tally[key][1]++; if (won) tally[key][0]++; };

let used = 0;
for (const r of logs) {
  if (r.non_d1) continue;
  if (typeof r.won !== "boolean") continue;
  const b = boxOf(r.game_id);
  const orb = get(b, "ff_orb");        // 0-1
  const ftr = get(b, "ff_ftr");
  const ftrDef = get(b, "ff_ftr_def");
  used++;

  const factors = [];
  if (typeof r.reb_diff === "number") { factors.push(r.reb_diff > 0); if (r.reb_diff > 0) bump("reb", r.won); }
  if (typeof orb === "number") { factors.push(orb > ORB_BAR); if (orb > ORB_BAR) bump("orb", r.won); }
  if (typeof r.fbpts_diff === "number") { factors.push(r.fbpts_diff > 0); if (r.fbpts_diff > 0) bump("fbp", r.won); }
  if (typeof r.fg3_made_diff === "number") { factors.push(r.fg3_made_diff > 0); if (r.fg3_made_diff > 0) bump("tpm", r.won); }
  if (typeof ftr === "number" && typeof ftrDef === "number" && ftr > ftrDef) bump("fta", r.won);

  // "Won the four factors" = took more of the four than the opponent. The
  // differentials make the opponent's count derivable, except for OREB where
  // both sides can clear the bar — so compare against the mirrored count.
  if (factors.length === 4) {
    const mine = factors.filter(Boolean).length;
    const oppReb = r.reb_diff < 0, oppFbp = r.fbpts_diff < 0, oppTpm = r.fg3_made_diff < 0;
    const oppOrb = typeof get(b, "ff_orb_def") === "number" ? get(b, "ff_orb_def") > ORB_BAR : false;
    const theirs = [oppReb, oppOrb, oppFbp, oppTpm].filter(Boolean).length;
    if (mine > theirs) bump("overall", r.won);
  }
}

const pct = ([w, n]) => (n > 0 ? Math.round((w / n) * 1000) / 10 : null);
console.error(`season ${season}: ${used} team-games, OREB bar ${(ORB_BAR * 100).toFixed(1)}%`);
for (const [k, v] of Object.entries(tally)) {
  console.error(`  ${k.padEnd(8)} ${String(v[0]).padStart(5)}/${String(v[1]).padEnd(6)} = ${pct(v)}%`);
}

console.log(`
export const FACTOR_WIN_RATE = {
  season: ${season},
  reb: ${pct(tally.reb)},
  orb: ${pct(tally.orb)},
  fbp: ${pct(tally.fbp)},
  tpm: ${pct(tally.tpm)},
  fta: ${pct(tally.fta)},
  overall: ${pct(tally.overall)},
} as const;`);
