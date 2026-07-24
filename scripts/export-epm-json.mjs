/**
 * export-epm-json.mjs — join the EPM fit (data/cbbd/<season>/epm.csv, CBBD
 * player ids) onto OUR Bart player ids and write public/data/epm-<season>.json
 * for the players grid to fetch.
 *
 * Join: normalized name (+ suffix-stripped) corroborated by team name. Same
 * cascade philosophy as refresh-portal's matchBart: exact name+team → exact
 * name unique → first-initial+last+team. Unmatched EPM rows are listed (usually
 * walk-ons who never appear in Bart's stat feed — harmless).
 *
 * Out shape: { season, built_at, players: { <bart_player_id>: { epm, off, def,
 *             poss, rk } }, meta: { matched, unmatched } }
 * RK = rank by EPM among players with >= MIN_POSS.
 *
 * Run: node scripts/export-epm-json.mjs --season 2026
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const args = process.argv.slice(2);
const SEASON = Number(args[args.indexOf("--season") + 1] || 2026);
const MIN_POSS = 300; // below this the RAPM is mostly shrinkage — exclude from RK
const DATA = path.resolve("public/data");

const norm = (s) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim()
  .replace(/\s+(jr|sr|ii|iii|iv|v)$/, "");
const normTeam = (s) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/\buniversity\b|\bthe\b/g, "").replace(/\bstate\b/g, "st")
  .replace(/[^a-z0-9]+/g, "");

function parseCsvLine(l) { // epm.csv is simple (no embedded commas in our fields except names w/o commas)
  return l.split(",");
}

function main() {
  // 1. EPM rows.
  const epmCsv = fs.readFileSync(path.resolve(`data/cbbd/${SEASON}/epm.csv`), "utf8").trim().split(/\r?\n/).map((l) => l.replace(/\r$/, ""));
  const head = epmCsv[0].split(",");
  const col = (n) => head.indexOf(n);
  const iId = col("playerId"), iN = col("name"), iT = col("team"), iP = col("poss"),
    iO = col("offEpm"), iD = col("defEpm"), iE = col("epm");
  const rows = epmCsv.slice(1).map(parseCsvLine).map((r) => ({
    name: r[iN], team: r[iT], poss: +r[iP], off: +r[iO], def: +r[iD], epm: +r[iE],
  }));

  // 2. Bart players for the season → name/team indices.
  const bart = JSON.parse(fs.readFileSync(path.join(DATA, "players-by-year", `${SEASON}.json`), "utf8"));
  const byNameTeam = new Map(), byName = new Map(), byIL = new Map();
  for (const p of bart) {
    if (p.bart_player_id == null) continue;
    const t = Array.isArray(p.teams) ? p.teams[0] : p.teams;
    const nn = norm(p.name), nt = normTeam(t?.name);
    byNameTeam.set(`${nn}|${nt}`, p.bart_player_id);
    if (!byName.has(nn)) byName.set(nn, []);
    byName.get(nn).push(p.bart_player_id);
    const toks = nn.split(" ");
    if (toks.length >= 2) {
      const il = `${toks[0][0]} ${toks[toks.length - 1]}|${nt}`;
      if (!byIL.has(il)) byIL.set(il, p.bart_player_id);
    }
  }

  // 3. Join.
  const players = {};
  let matched = 0;
  const unmatched = [];
  // RK over qualified rows first (CBBD universe), then attach to matches.
  const qual = rows.filter((r) => r.poss >= MIN_POSS).sort((a, b) => b.epm - a.epm);
  const rkByNameTeam = new Map(qual.map((r, i) => [`${norm(r.name)}|${normTeam(r.team)}`, i + 1]));

  for (const r of rows) {
    const nn = norm(r.name), nt = normTeam(r.team);
    let bid = byNameTeam.get(`${nn}|${nt}`);
    if (bid == null) {
      const cands = byName.get(nn);
      if (cands && cands.length === 1) bid = cands[0];
    }
    if (bid == null) {
      const toks = nn.split(" ");
      if (toks.length >= 2) bid = byIL.get(`${toks[0][0]} ${toks[toks.length - 1]}|${nt}`);
    }
    if (bid == null) { unmatched.push(`${r.name} (${r.team})`); continue; }
    matched++;
    players[bid] = {
      epm: r.epm, off: r.off, def: r.def, poss: r.poss,
      rk: rkByNameTeam.get(`${nn}|${nt}`) ?? null,
    };
  }

  const out = {
    season: SEASON,
    built_at: new Date().toISOString(),
    min_poss: MIN_POSS,
    players,
    meta: { matched, unmatched: unmatched.length },
  };
  const fp = path.join(DATA, `epm-${SEASON}.json`);
  fs.writeFileSync(fp, JSON.stringify(out));
  console.log(`✓ wrote ${fp} — ${matched.toLocaleString()} matched, ${unmatched.length} unmatched`);
  if (unmatched.length) console.log("  sample unmatched:", unmatched.slice(0, 10).join(" | "));
}

main();
