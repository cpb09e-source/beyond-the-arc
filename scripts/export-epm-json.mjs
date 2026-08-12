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
/**
 * eWins RELIABILITY SHRINKAGE for low-usage players.
 *
 * eWins is EPM x possessions, and EPM for a low-usage player rests much more
 * heavily on the box prior — he simply does not end enough possessions for the
 * on-court half to say much about him specifically, and what the prior knows
 * about a 12%-usage role player is thin. The estimate is not wrong so much as
 * UNDER-EVIDENCED, and the honest response to a weak estimate is to move it
 * toward the average rather than to publish it at full confidence.
 *
 * So below the 34th percentile in usage, eWins is scaled toward zero on a ramp:
 * full weight at the 34th, LOW_USG_FLOOR at the 0th, linear between.
 *
 * TOWARD ZERO, NOT DOWNWARD — this is shrinkage, not a penalty. A low-usage
 * player with NEGATIVE eWins moves UP, because less confidence should pull an
 * estimate in from both tails, not just the flattering one. A punishment would
 * only ever subtract, and would be a claim about a player's worth rather than
 * about how much we know.
 *
 * Usage percentile is computed over the players who actually receive an EPM
 * (post minutes gate), so it ranks against the same population the column is
 * read against.
 */
const LOW_USG_PCTILE = Number(process.env.BTA_LOW_USG_PCTILE ?? 34);
const LOW_USG_FLOOR = Number(process.env.BTA_LOW_USG_FLOOR ?? 0.85);

const MIN_PG = Number(args.includes("--min-pg") ? args[args.indexOf("--min-pg") + 1] : 15);
// Which fit to read and where to write it. Defaults are the shipped metric; the
// CALIBRATION pass overrides both so the prior-free fit lands in its own file.
const IN_CSV = args.includes("--in") ? args[args.indexOf("--in") + 1] : "epm.csv";
const OUT_JSON = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
import { playerKey } from "./lib/cbbd-join.mjs";

const DATA = path.resolve("public/data");

const norm = (s) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim()
  .replace(/\s+(jr|sr|ii|iii|iv|v)$/, "");

// Shared suffix/initial-tolerant person key. `norm` above only strips the
// literal Roman numerals, so it misses Bart's lowercase-L homoglyph ("Ace
// Glass lll") and it never reunites "J.J." with "JJ". Worse, the initial-last
// fallback below reads that homoglyph as the SURNAME — "Ace Glass lll" becomes
// "a lll" and can never meet CBBD's "a glass". Consulted as a last tier so no
// match that already worked can move.
const normTeam = (s) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/\buniversity\b|\bthe\b/g, "").replace(/\bstate\b/g, "st")
  .replace(/[^a-z0-9]+/g, "");

function parseCsvLine(l) { // epm.csv is simple (no embedded commas in our fields except names w/o commas)
  return l.split(",");
}

function main() {
  // 1. EPM rows.
  const epmCsv = fs.readFileSync(path.resolve(`data/cbbd/${SEASON}/${IN_CSV}`), "utf8").trim().split(/\r?\n/).map((l) => l.replace(/\r$/, ""));
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
    const eN = eh.indexOf("name"), eT = eh.indexOf("team"), eW = eh.indexOf("ewins");
    const eOO = eh.indexOf("on_off"), eOOA = eh.indexOf("on_off_adj");
    for (const line of ex.slice(1)) {
      const r = parseCsvLine(line);
      const ewins = r[eW] === "" ? null : +r[eW];
      // Ship the LUCK-ADJUSTED on/off where we have it. Raw on/off carries
      // whatever the ball did while a player stood there; restating each side's
      // points at its own season three-point and free-throw rates lifts
      // year-over-year stability from r=0.072 to r=0.098 on 1,676 players with
      // 400+ possessions in both seasons, and tightens the spread ~20%.
      // The raw column stays in epm-extras.csv for diagnostics.
      const adj = eOOA >= 0 && r[eOOA] !== "" && r[eOOA] != null ? +r[eOOA] : null;
      const raw = eOO >= 0 && r[eOO] !== "" ? +r[eOO] : null;
      extras.set(`${norm(r[eN])}|${normTeam(r[eT])}`, { ewins, on_off: adj ?? raw });
    }
  }

  // 2. Bart players for the season → name/team indices.
  const bart = JSON.parse(fs.readFileSync(path.join(DATA, "players-by-year", `${SEASON}.json`), "utf8"));
  const byKey = new Map();
  const byNameTeam = new Map(), byName = new Map(), byIL = new Map();
  // Minutes per game by bart id — Bart's raw_row column 54, the same one the
  // explorer reads. Needed for the MIN_PG gate; epm.csv only carries possessions.
  const mpgByBart = new Map();
  const usgByBart = new Map();
  for (const p of bart) {
    if (p.bart_player_id == null) continue;
    {
      const st = Array.isArray(p.player_bart_stats) ? p.player_bart_stats[0] : p.player_bart_stats;
      const u = st?.raw_row?.[6];      // Bart usage %
      const un = typeof u === "number" ? u : typeof u === "string" ? Number(u) : NaN;
      if (Number.isFinite(un)) usgByBart.set(p.bart_player_id, un);
      const v = st?.raw_row?.[54];
      const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
      if (Number.isFinite(n)) mpgByBart.set(p.bart_player_id, n);
    }
    const t = Array.isArray(p.teams) ? p.teams[0] : p.teams;
    const nn = norm(p.name), nt = normTeam(t?.name);
    byNameTeam.set(`${nn}|${nt}`, p.bart_player_id);
    // Suffix/initial-tolerant key. null marks an ambiguous key (two players on
    // one team collapsing to the same stripped name) so it is never guessed.
    const pk = `${playerKey(p.name)}|${nt}`;
    if (!byKey.has(pk)) byKey.set(pk, p.bart_player_id);
    else if (byKey.get(pk) !== p.bart_player_id) byKey.set(pk, null);
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
    if (bid == null) bid = byKey.get(`${playerKey(r.name)}|${nt}`) ?? null;
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

  // ---- eWins reliability shrinkage (see LOW_USG_* above) ----
  // Ranked over the players who actually got an EPM, so the percentile matches
  // the population a reader compares them against.
  let shrunk = 0, minFactor = 1;
  {
    const withUsg = Object.keys(players)
      .map((bid) => ({ bid, u: usgByBart.get(Number(bid)) }))
      .filter((x) => Number.isFinite(x.u))
      .sort((a, b) => a.u - b.u);
    const n = withUsg.length;
    withUsg.forEach((x, i) => {
      const pct = n <= 1 ? 100 : (i / (n - 1)) * 100;
      if (pct >= LOW_USG_PCTILE) return;
      const factor = LOW_USG_FLOOR + (1 - LOW_USG_FLOOR) * (pct / LOW_USG_PCTILE);
      const p = players[x.bid];
      if (typeof p.ewins !== "number") return;
      p.ewins = Math.round(p.ewins * factor * 100) / 100;
      p.usg_shrink = Math.round(factor * 1000) / 1000;
      shrunk++;
      if (factor < minFactor) minFactor = factor;
    });
  }
  console.log(`  eWins shrinkage: ${shrunk.toLocaleString()} players under the `
    + `${LOW_USG_PCTILE}th usage percentile, factor ${minFactor.toFixed(3)}–1.000`);

  const out = {
    season: SEASON,
    built_at: new Date().toISOString(),
    min_poss: MIN_POSS,
    min_pg: MIN_PG,
    players,
    meta: { matched, unmatched: unmatched.length, suppressed },
  };
  const fp = path.join(DATA, OUT_JSON ?? `epm-${SEASON}.json`);
  fs.writeFileSync(fp, JSON.stringify(out));
  console.log(`✓ wrote ${fp} — ${matched.toLocaleString()} matched, ${unmatched.length} unmatched, ${suppressed.toLocaleString()} below ${MIN_PG} mpg (suppressed)`);
  if (unmatched.length) console.log("  sample unmatched:", unmatched.slice(0, 10).join(" | "));
}

main();
