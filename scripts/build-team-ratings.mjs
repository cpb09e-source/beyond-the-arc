#!/usr/bin/env node
/**
 * build-team-ratings.mjs — team efficiency ratings (CBB-Analytics style) from
 * the archived per-game team box (box-teams-*.json.gz).
 *
 * Produces, per team-season:
 *   ortg / drtg / net            — raw points per 100 possessions (and allowed)
 *   adj_ortg / adj_drtg / adj_net — opponent-adjusted, tempo-free, HCA-corrected
 *   ortg_adj / drtg_adj / net_adj — the ADJUSTMENT deltas (adjusted − raw), i.e.
 *                                   the strength-of-schedule correction, exactly
 *                                   the "X Adj" columns CBB Analytics shows
 *   pace, games, rank_net
 *
 * Adjustment method: the standard iterated fixed point (KenPom/Bart family).
 * Each game contributes an offensive and a defensive efficiency observation;
 * we solve, by iteration to convergence, for each team's offense/defense vs an
 * average D-I opponent on a neutral floor. Equivalent to the linear-system
 * (least-squares) solution — the recursion handles opponents-of-opponents, so a
 * mid-major that played up isn't undersold. Possession-weighted; home-court
 * estimated from the data.
 *
 * In:  data/cbbd/<season>/box-teams-*.json.gz
 * Out: public/data/team-ratings-<season>.json
 * Run: node scripts/build-team-ratings.mjs --season 2026
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const args = process.argv.slice(2);
const SEASON = Number(args[args.indexOf("--season") + 1]);
if (!SEASON) { console.error("usage: --season 2026"); process.exit(1); }
const ITERS = 20;
// Calibration: the iterated fixed point reproduces CBBD's own adjusted ratings
// at r=0.995 but ~19% over-spread; a single scale factor (fit vs /ratings/adjusted
// on 2024+2025, slope 0.834/0.846) lands the magnitudes on the accepted scale.
const CAL = 0.84;
const BUILT_AT = process.env.BUILD_STAMP || "";

const dir = path.resolve("data/cbbd", String(SEASON));
const files = fs.readdirSync(dir).filter((f) => f.startsWith("box-teams-") && f.endsWith(".json.gz")).sort();
if (!files.length) { console.error(`no box-teams-*.json.gz in ${dir}`); process.exit(1); }

// team id -> aggregates + per-game observations.
const teams = new Map();
const seen = new Set(); // (gameId,teamId) — /plays/date UTC bucketing dupes some games
function team(id, name, conf) {
  let t = teams.get(id);
  if (!t) { t = { id, name, conf, gp: 0, tPts: 0, tPoss: 0, oPts: 0, oPoss: 0, paceSum: 0, games: [] }; teams.set(id, t); }
  return t;
}

let rowsUsed = 0;
for (const f of files) {
  const rows = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, f))));
  for (const r of rows) {
    const key = `${r.gameId}:${r.teamId}`;
    if (seen.has(key)) continue;
    const ts = r.teamStats, os = r.opponentStats;
    const tPoss = ts?.possessions, oPoss = os?.possessions;
    const tPts = ts?.points?.total, oPts = os?.points?.total;
    if (!(tPoss > 0) || !(oPoss > 0) || tPts == null || oPts == null) continue;
    seen.add(key);
    const t = team(r.teamId, r.team, r.conference);
    t.gp += 1;
    t.tPts += tPts; t.tPoss += tPoss;
    t.oPts += oPts; t.oPoss += oPoss;
    t.paceSum += (r.pace ?? (tPoss + oPoss) / 2);
    const loc = r.neutralSite ? 0 : (r.isHome ? 1 : -1);
    t.games.push({
      opp: r.opponentId,
      oEff: (100 * tPts) / tPoss, oPoss: tPoss,
      dEff: (100 * oPts) / oPoss, dPoss: oPoss,
      loc,
    });
    rowsUsed++;
  }
}

// Rated set = real D-I teams. Non-D1 opponents show up only a handful of times
// (as cupcakes); include everything and they pollute the adjustment with wild
// 1-game ratings, so gate on games played. Only rated teams inform the
// adjustment (games vs non-rated are dropped from the opponent adjustment) and
// only rated teams are output.
const RATED_MIN_GP = 12;
const rated = new Set([...teams.values()].filter((t) => t.gp >= RATED_MIN_GP).map((t) => t.id));
const has = (id) => rated.has(id);

// League mean efficiency over rated teams, possession-weighted.
let allPts = 0, allPoss = 0;
for (const id of rated) { const t = teams.get(id); allPts += t.tPts; allPoss += t.tPoss; }
const M = (100 * allPts) / allPoss;
// Home-court advantage per side (per 100). A fixed constant is far more robust
// than the raw home−away gap, which conflates HCA with the fact that home games
// are disproportionately vs weaker non-conference opponents. ~1.6/side ≈ a ~3.2
// per-100 home swing, the accepted college range.
const HCA = 1.6;

// Raw ratings.
for (const t of teams.values()) {
  t.rawO = (100 * t.tPts) / t.tPoss;
  t.rawD = (100 * t.oPts) / t.oPoss;
  t.adjO = t.rawO; t.adjD = t.rawD; // init
}
const ratedTeams = [...rated].map((id) => teams.get(id));
for (let it = 0; it < ITERS; it++) {
  const nextO = new Map(), nextD = new Map();
  for (const t of ratedTeams) {
    let oNum = 0, oDen = 0, dNum = 0, dDen = 0;
    for (const g of t.games) {
      if (!has(g.opp)) continue;
      const opp = teams.get(g.opp);
      // strip opponent quality + home court from each observation
      oNum += (g.oEff - (opp.adjD - M) - HCA * g.loc) * g.oPoss; oDen += g.oPoss;
      dNum += (g.dEff - (opp.adjO - M) + HCA * g.loc) * g.dPoss; dDen += g.dPoss;
    }
    nextO.set(t.id, oDen ? M + oNum / oDen : t.adjO);
    nextD.set(t.id, dDen ? M + dNum / dDen : t.adjD);
  }
  // recenter to mean M
  let so = 0, sd = 0, n = 0;
  for (const t of ratedTeams) { so += nextO.get(t.id); sd += nextD.get(t.id); n++; }
  const offShift = M - so / n, defShift = M - sd / n;
  for (const t of ratedTeams) { t.adjO = nextO.get(t.id) + offShift; t.adjD = nextD.get(t.id) + defShift; }
}

// Assemble + rank by adjusted net.
const out = [];
for (const t of ratedTeams) {
  const rawNet = t.rawO - t.rawD;
  // Apply the calibration to the adjustment (deviation from league mean).
  const adjO = M + (t.adjO - M) * CAL;
  const adjD = M + (t.adjD - M) * CAL;
  const adjNet = adjO - adjD;
  out.push({
    teamId: t.id, team: t.name, conference: t.conf, games: t.gp,
    pace: round1(t.paceSum / t.gp),
    ortg: round1(t.rawO), drtg: round1(t.rawD), net: round1(rawNet),
    adj_ortg: round1(adjO), adj_drtg: round1(adjD), adj_net: round1(adjNet),
    ortg_adj: round1(adjO - t.rawO), drtg_adj: round1(adjD - t.rawD), net_adj: round1(adjNet - rawNet),
  });
}
out.sort((a, b) => b.adj_net - a.adj_net);
out.forEach((t, i) => { t.rank_net = i + 1; });

const doc = { season: SEASON, built_at: BUILT_AT, league_mean: round1(M), hca: round1(HCA), teams: out };
const dst = path.resolve("public/data", `team-ratings-${SEASON}.json`);
fs.writeFileSync(dst, JSON.stringify(doc));
console.log(`season ${SEASON}: ${out.length} teams, ${rowsUsed} game-rows, M=${M.toFixed(1)}, HCA=${HCA.toFixed(2)}`);
console.log(`wrote ${dst}`);
console.log("\nTop 12 adjusted net:");
for (const t of out.slice(0, 12)) {
  console.log(`  ${String(t.rank_net).padStart(2)}. ${t.team.padEnd(20)} adjNet ${sign(t.adj_net)}  (O ${t.adj_ortg}, D ${t.adj_drtg})  SoS net_adj ${sign(t.net_adj)}`);
}

function round1(x) { return Math.round(x * 10) / 10; }
function sign(x) { return (x >= 0 ? "+" : "") + x.toFixed(1); }
