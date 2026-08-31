/**
 * Builds the Team Game Log Explorer's corpus: every team-game of a season in
 * one file.
 *
 *   node scripts/build-team-game-index.mjs                # every season
 *   node scripts/build-team-game-index.mjs --season 2026  # one
 *
 * THE PLAYER SIDE'S TWIN. Same shape, same reasoning as
 * scripts/build-game-index.mjs — a per-season string table plus integer rows,
 * nothing stored that can be derived — but a tenth the size, because a season
 * is ~12,000 team-games rather than ~115,000 player-games.
 *
 * TWO SOURCES, JOINED ON (game, team). Neither is enough alone:
 *
 *   game-logs-by-year  identity, result, pace, and the DIFFERENTIALS — the
 *                      margins by which a team out-rebounded or out-shot its
 *                      opponent, which is most of what a game log is read for.
 *   game-box-by-year   the raw counting stats, four factors, ratings, and the
 *                      context that makes a game findable: conference game,
 *                      tournament, postseason, AP ranks, seeds, overtime.
 *
 * They share a key — game-logs' `game_id` is already "<gameId>-<teamId>",
 * which is exactly how the box file is keyed — and the join is total: 12,051
 * of 12,051 rows in 2026.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = path.resolve(".");
const LOGS_DIR = path.join(ROOT, "public/data/game-logs-by-year");
const BOX_DIR = path.join(ROOT, "public/data/game-box-by-year");
const OUT_DIR = path.join(ROOT, "public/data/team-game-index");

const args = process.argv.slice(2);
const seasonArg = (() => {
  const i = args.indexOf("--season");
  return i >= 0 ? Number(args[i + 1]) : null;
})();

/**
 * Field order of a packed row. Mirrored by src/lib/team-game-index.ts — the
 * two lists are one contract written twice, so a change to either is a change
 * to both.
 *
 * Percentages are stored per mille and ratings x10, the same integer trick the
 * player index uses: a float costs bytes in JSON, an integer does not.
 */
const FIELDS = [
  "t",      // index into the team table
  "o",      // index into the opponent table
  "d",      // days since the season's epoch
  "f",      // flags — see FLAGS below
  "pts", "pa", "poss",
  "pace",   // x10
  "fgm", "fga", "fg3m", "fg3a", "ftm", "fta",
  "oreb", "reb", "ast", "stl", "blk", "tov", "pf",
  "ortg", "drtg",           // x10
  "efg", "ftr", "tov_r", "orb_r",         // four factors, per mille
  "efg_d", "ftr_d", "tov_d", "orb_d",     // what the defence allowed
  "lead",   // largest lead
  "h1", "h2", "ot",         // points by half, and overtime points
  "reb_dif", "tov_dif", "ast_dif", "stl_dif", "blk_dif", "fg3m_dif",
  "ap", "opp_ap",           // AP rank, 0 = unranked
  "seed", "opp_seed",       // NCAA seed, 0 = none
];

/** Bit flags in `f`. */
const HOME = 1, NEUTRAL = 2, WON = 4, CONF = 8, TOURNEY = 16, POST = 32, NON_D1 = 64;

const seasons = seasonArg
  ? [seasonArg]
  : fs.readdirSync(LOGS_DIR)
      .filter((f) => /^\d{4}\.json$/.test(f))
      .map((f) => Number(f.slice(0, 4)))
      .sort();

const dayNum = (iso) => Math.round(Date.parse(iso + "T00:00:00Z") / 86400000);
const permille = (v) => (typeof v === "number" ? Math.round(v * 1000) : 0);
const tenth = (v) => (typeof v === "number" ? Math.round(v * 10) : 0);
const int = (v) => (typeof v === "number" ? Math.round(v) : 0);

fs.mkdirSync(OUT_DIR, { recursive: true });
let totalRaw = 0;
let totalGz = 0;
let totalRows = 0;

for (const season of seasons) {
  const logsPath = path.join(LOGS_DIR, `${season}.json`);
  const boxPath = path.join(BOX_DIR, `${season}.json`);
  if (!fs.existsSync(logsPath) || !fs.existsSync(boxPath)) {
    console.warn(`  ! ${season}: missing a source file — skipped`);
    continue;
  }

  const logs = JSON.parse(fs.readFileSync(logsPath, "utf8"));
  const box = JSON.parse(fs.readFileSync(boxPath, "utf8"));
  const at = Object.fromEntries(box.fields.map((f, i) => [f, i]));
  const B = (row, field) => row?.[at[field]] ?? null;

  const teams = new Map();
  const teamList = [];
  const confList = [];
  const opps = new Map();
  const oppList = [];
  const rows = [];
  let minDay = null;
  let unjoined = 0;
  let nonD1 = 0;

  for (const g of logs) {
    const b = box.rows[g.game_id];
    if (!b) { unjoined++; continue; }

    // NON-D1 OPPONENTS ARE NOT IN THIS CORPUS AT ALL. They are 4.2% of the
    // rows and were roughly 100% of the top of any sort that rewards scoring —
    // the first screen was Geneva, Paine, Virginia-Lynchburg and Elms College.
    // A November exhibition against a Bible college is not a college
    // basketball result anyone is looking for, and keeping them behind a
    // default-on toggle just moved the problem into the UI.
    if (g.non_d1) { nonD1++; continue; }

    let ti = teams.get(g.team_name);
    if (ti === undefined) {
      ti = teamList.length;
      teams.set(g.team_name, ti);
      teamList.push(g.team_name);
      confList.push(g.team_conference ?? "");
    }
    const oppName = g.opp_team_market ?? "—";
    let oi = opps.get(oppName);
    if (oi === undefined) {
      oi = oppList.length;
      opps.set(oppName, oi);
      oppList.push(oppName);
    }

    const day = dayNum(g.game_date);
    if (minDay === null || day < minDay) minDay = day;

    // 40 possessions is well below any real college game (the slowest on
    // record sit near 50) and well above the handful of broken rows.
    const ratable = (g.poss ?? 0) >= 40;

    const flags =
      (g.is_home ? HOME : 0) |
      (g.is_neutral ? NEUTRAL : 0) |
      (g.won ? WON : 0) |
      (B(b, "conf_game") ? CONF : 0) |
      (B(b, "tourney") ? TOURNEY : 0) |
      (B(b, "postseason") ? POST : 0) |
      (g.non_d1 ? NON_D1 : 0);

    rows.push([
      ti, oi, day, flags,
      int(g.pts_scored), int(g.pts_against), int(g.poss), tenth(g.pace),
      int(B(b, "fgm")), int(B(b, "fga")), int(B(b, "fg3m")), int(B(b, "fg3a")),
      int(B(b, "ftm")), int(B(b, "fta")),
      int(B(b, "oreb")), int(B(b, "reb")), int(B(b, "ast")), int(B(b, "stl")),
      int(B(b, "blk")), int(B(b, "tov")), int(B(b, "fouls")),
      // RATINGS ONLY WHERE THE POSSESSION COUNT IS BELIEVABLE. Ten rows in
      // 59,000 carry a possession total under 40 — one of them is a 93-47 game
      // logged at 10 possessions, which computes to an offensive rating of 930
      // and takes first place in any sort by efficiency. The box score is real
      // and stays; the ratings derived from a broken denominator do not.
      ratable ? tenth(B(b, "ortg")) : 0, ratable ? tenth(B(b, "drtg")) : 0,
      permille(B(b, "ff_efg")), permille(B(b, "ff_ftr")),
      permille(B(b, "ff_tov")), permille(B(b, "ff_orb")),
      permille(B(b, "ff_efg_def")), permille(B(b, "ff_ftr_def")),
      permille(B(b, "ff_tov_def")), permille(B(b, "ff_orb_def")),
      int(B(b, "largest_lead")),
      int(B(b, "h1_pts")), int(B(b, "h2_pts")), int(B(b, "ot_pts")),
      int(g.reb_diff), int(g.tov_diff), int(g.ast_diff), int(g.stl_diff),
      int(g.blk_diff), int(g.fg3_made_diff),
      int(B(b, "ap_rank")), int(B(b, "opp_ap_rank")),
      int(B(b, "seed")), int(B(b, "opp_seed")),
    ]);
  }

  if (!rows.length) { console.warn(`  ! ${season}: no rows`); continue; }

  // Dates as an offset from the season's first game — three digits, not five.
  for (const r of rows) r[2] -= minDay;
  rows.sort((a, b2) => a[2] - b2[2]);

  const out = {
    season,
    epoch: new Date(minDay * 86400000).toISOString().slice(0, 10),
    fields: FIELDS,
    teams: { names: teamList, confs: confList },
    opps: oppList,
    rows,
  };

  const text = JSON.stringify(out);
  fs.writeFileSync(path.join(OUT_DIR, `${season}.json`), text);
  const gz = zlib.gzipSync(text).length;
  totalRaw += text.length;
  totalGz += gz;
  totalRows += rows.length;
  console.log(
    `  ${season}: ${rows.length.toLocaleString()} team-games, ${teamList.length} teams` +
    `${nonD1 ? `, ${nonD1} non-D1 dropped` : ""}` +
    `${unjoined ? `, ${unjoined} unjoined` : ""} — ` +
    `${(text.length / 1e6).toFixed(1)} MB (${(gz / 1e6).toFixed(2)} MB gz)`,
  );
}

console.log(
  `\n✓ ${totalRows.toLocaleString()} rows, ${(totalRaw / 1e6).toFixed(0)} MB total, ` +
  `${(totalGz / 1e6).toFixed(1)} MB gzipped`,
);
