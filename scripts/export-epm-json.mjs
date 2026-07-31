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
/**
 * Minutes floor for being given an EPM at all. Matches MIN_PG in
 * export-box-epm-json.mjs — the two must agree, or a player would get a real
 * EPM in one season and a suppressed one in another for the same role.
 *
 * Below this the fit is essentially the prior, and the prior is essentially
 * "how good is your team". Emitting that as a number invited exactly the wrong
 * reading; emitting nothing lets the UI say "—", which is the truth.
 */
const MIN_PG = 13;
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

  // EPM-extras (on/off + eWins), keyed by name|team so it merges through the
  // same join. Optional — only present once compute-epm-extras.py has run.
  const extras = new Map();
  const extrasPath = path.resolve(`data/cbbd/${SEASON}/epm-extras.csv`);
  if (fs.existsSync(extrasPath)) {
    const ex = fs.readFileSync(extrasPath, "utf8").trim().split(/\r?\n/).map((l) => l.replace(/\r$/, ""));
    const eh = ex[0].split(",");
    const eN = eh.indexOf("name"), eT = eh.indexOf("team"), eW = eh.indexOf("ewins"), eOO = eh.indexOf("on_off");
    for (const line of ex.slice(1)) {
      const r = parseCsvLine(line);
      const ewins = r[eW] === "" ? null : +r[eW];
      const on_off = r[eOO] === "" ? null : +r[eOO];
      extras.set(`${norm(r[eN])}|${normTeam(r[eT])}`, { ewins, on_off });
    }
  }

  // 2. Bart players for the season → name/team indices.
  const bart = JSON.parse(fs.readFileSync(path.join(DATA, "players-by-year", `${SEASON}.json`), "utf8"));
  const byNameTeam = new Map(), byName = new Map(), byIL = new Map();
  // Minutes per game by bart id — Bart's raw_row column 54, the same one the
  // explorer reads. Needed for the MIN_PG gate; epm.csv only carries possessions.
  const mpgByBart = new Map();
  for (const p of bart) {
    if (p.bart_player_id == null) continue;
    {
      const st = Array.isArray(p.player_bart_stats) ? p.player_bart_stats[0] : p.player_bart_stats;
      const v = st?.raw_row?.[54];
      const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
      if (Number.isFinite(n)) mpgByBart.set(p.bart_player_id, n);
    }
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
  let matched = 0, suppressed = 0;
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
    // Below the minutes floor we publish nothing rather than a shrunk-to-zero
    // number the reader would take at face value.
    const mpg = mpgByBart.get(bid);
    if (!Number.isFinite(mpg) || mpg < MIN_PG) { suppressed++; continue; }
    matched++;
    const ex = extras.get(`${nn}|${nt}`);
    players[bid] = {
      epm: r.epm, off: r.off, def: r.def, poss: r.poss,
      rk: rkByNameTeam.get(`${nn}|${nt}`) ?? null,
      ...(ex ? { ewins: ex.ewins, on_off: ex.on_off } : {}),
    };
  }

  const out = {
    season: SEASON,
    built_at: new Date().toISOString(),
    min_poss: MIN_POSS,
    min_pg: MIN_PG,
    players,
    meta: { matched, unmatched: unmatched.length, suppressed },
  };
  const fp = path.join(DATA, `epm-${SEASON}.json`);
  fs.writeFileSync(fp, JSON.stringify(out));
  console.log(`✓ wrote ${fp} — ${matched.toLocaleString()} matched, ${unmatched.length} unmatched, ${suppressed.toLocaleString()} below ${MIN_PG} mpg (suppressed)`);
  if (unmatched.length) console.log("  sample unmatched:", unmatched.slice(0, 10).join(" | "));
}

main();
