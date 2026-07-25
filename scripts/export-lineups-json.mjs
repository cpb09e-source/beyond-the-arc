#!/usr/bin/env node
/**
 * export-lineups-json.mjs — publish the 5-man lineup ratings for team pages.
 * Reads compute-epm-extras' data/cbbd/<season>/lineups.json (all qualified
 * units) and writes public/data/lineups-<season>.json grouped by normalized
 * team name, top N units per team by net rating.
 *
 *   Run: node scripts/export-lineups-json.mjs --from 2025 --to 2026
 */
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i > -1 ? args[i + 1] : null; };
const FROM = Number(opt("from") || 2025), TO = Number(opt("to") || 2026);
const TOP_PER_TEAM = 8;
const DATA = path.resolve("public/data");

const normTeam = (s) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/\buniversity\b|\bthe\b/g, "").replace(/\bstate\b/g, "st").replace(/[^a-z0-9]+/g, "");

for (let season = FROM; season <= TO; season++) {
  const src = path.resolve("data/cbbd", String(season), "lineups.json");
  if (!fs.existsSync(src)) { console.warn(`skip ${season}: no lineups.json`); continue; }
  const { lineups } = JSON.parse(fs.readFileSync(src, "utf8"));
  const byTeam = {};
  for (const l of lineups) {
    if (!l.team || l.net == null) continue;
    const k = normTeam(l.team);
    (byTeam[k] ??= []).push({ players: l.players, poss: l.poss, off: l.off, def: l.def, net: l.net });
  }
  let teams = 0, kept = 0;
  for (const k of Object.keys(byTeam)) {
    byTeam[k].sort((a, b) => b.net - a.net);
    byTeam[k] = byTeam[k].slice(0, TOP_PER_TEAM);
    teams++; kept += byTeam[k].length;
  }
  fs.writeFileSync(path.join(DATA, `lineups-${season}.json`), JSON.stringify({ season, byTeam }));
  console.log(`lineups-${season}.json: ${teams} teams, ${kept} units`);
}
