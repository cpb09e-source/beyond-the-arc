#!/usr/bin/env node
/**
 * build-league-averages.mjs — D-I season means for the handful of rates that
 * need a league baseline rather than a head-to-head comparison.
 *
 * Prints a TypeScript literal to paste into src/lib/league-averages.ts. It is
 * a dozen numbers that move a tenth of a point a year, so they live in code
 * rather than in a file the browser has to fetch to render one panel.
 *
 * WHY A BASELINE AT ALL: offensive rebound rate is the one of our four factors
 * that is not a differential. Both teams have their own, and both can be good
 * or both bad in the same game — a 34% and a 33% night is two teams crashing
 * the glass, not one winning a category. Judging it against the league average
 * says something true where judging it head-to-head does not.
 *
 * The mean is unweighted across teams, which is the right shape here: the
 * question is "is this a good rebounding performance for a D-I team", not
 * "what share of all offensive rebounds league-wide".
 *
 * Run: node scripts/build-league-averages.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const src = path.join(ROOT, "public/data/team-season-stats.json");
const rows = JSON.parse(fs.readFileSync(src, "utf8"));

const bySeason = new Map();
for (const [key, v] of Object.entries(rows)) {
  const season = Number(key.split("|")[1]);
  if (!Number.isFinite(season) || typeof v?.orb_pct !== "number") continue;
  if (!bySeason.has(season)) bySeason.set(season, []);
  bySeason.get(season).push(v.orb_pct);
}

const out = [];
for (const season of [...bySeason.keys()].sort((a, b) => a - b)) {
  const vals = bySeason.get(season);
  const mean = vals.reduce((s, x) => s + x, 0) / vals.length;
  out.push(`  ${season}: ${(mean * 100).toFixed(1)},`);
  console.error(`${season}  n=${vals.length}  OREB% ${(mean * 100).toFixed(1)}`);
}

console.log("\nexport const OREB_PCT_D1: Record<number, number> = {");
console.log(out.join("\n"));
console.log("};");
