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

    /**
     * THE RATINGS ARE COMPUTED HERE, NOT IMPORTED.
     *
     * Upstream ships ortg/drtg in the box, and they are `pts / poss_box * 100`
     * — where `poss_box` is a possession count that disagrees with the game
     * log's own. Where it disagrees it is simply wrong: Creighton 107-61 over
     * Alcorn St. logs 76.1 possessions and boxes 45, which prints an offensive
     * rating of 237.8. Houston 77-52 over Tulane logs 59.1 and boxes 13, for
     * 592.3.
     *
     * Guarding the imported number was not enough, because `poss_box` is not
     * merely small on the bad rows — it is arbitrary, and 45 clears any floor
     * worth setting. So the denominator is the log's `poss`, which is the same
     * number this index already ships in the POSS column.
     *
     * SAFE, AND MEASURED. Comparing upstream's rating against `pts / poss` over
     * 85,162 rows: 99.42% agree within a tenth of a point, 0.58% differ by more
     * than ten, and NOTHING lands in between. The disagreement is not drift
     * that recomputing would paper over; it is a clean split between rows where
     * upstream used the same possessions we do and rows where it used garbage.
     *
     * It also makes the table checkable. A reader can now divide the PTS column
     * by the POSS column on the same row and get the ORTG column, which was not
     * true before and is the real defect behind the 237.8.
     */
    /**
     * THE DENOMINATOR IS DERIVED, AND CHECKED AGAINST THE ONE WE WERE GIVEN.
     *
     * Neither supplied possession count can be trusted on its own. The box's
     * `poss_box` is wrong on 493 rows (Creighton 107-61 boxed at 45), and the
     * log's `poss` is wrong on a different ~371 (Georgia 72-52 logged at 42,
     * Kansas 104-74 at 51 — a 104-point game is never 51 possessions).
     *
     * So possessions are computed from the counting stats, which are the part
     * of the box that has never been in doubt:
     *
     *   poss ≈ FGA − ORB + TOV + 0.475·FTA
     *
     * Dean Oliver's estimator, with KenPom's free-throw coefficient. Measured
     * against the log's `poss` over 55,147 rows: 96.05% agree within 5%, 98.87%
     * within 10%, and the 0.67% that differ by more than 25% are exactly the
     * broken rows — the estimate puts Georgia/Wofford at 59.8 and 61.5, which
     * is what a 72-52 game actually looks like.
     *
     * The log wins when the two agree, so the POSS column keeps the number the
     * rest of the site uses; the estimate takes over only where the log has
     * gone wrong. Either way the row is self-consistent: PTS ÷ POSS × 100 is
     * the ORTG printed beside it.
     */
    const est = (() => {
      const fga = B(b, "fga"), orb = B(b, "oreb"), tov = B(b, "tov"), fta = B(b, "fta");
      if ([fga, orb, tov, fta].some((v) => typeof v !== "number")) return null;
      return fga - orb + tov + 0.475 * fta;
    })();
    const logged = g.poss ?? null;
    const poss = (() => {
      if (logged === null) return est;
      if (est === null) return logged;
      return Math.abs(est - logged) / logged <= 0.10 ? logged : est;
    })();

    /**
     * NO BOX, NO RATING. `est` is null when the box carries no counting stats
     * at all — 90 rows across 141,666, where fga/oreb/tov/fta are all absent
     * rather than zero. Those rows fall back to the log's possession count,
     * and there is then nothing left to check it against.
     *
     * Queens 96-87 over Stetson is the case: an empty box, a logged 42
     * possessions, and therefore an offensive rating of 228.6 that survived
     * every other guard here precisely because the row agreed with itself.
     * Where the denominator cannot be verified the honest output is no rating,
     * not a confident wrong one — the rest of the row is already blank, so
     * this is consistent with what the reader sees beside it.
     */
    const ratable = est !== null && poss !== null && poss >= 40;
    const ortg = ratable ? (g.pts_scored / poss) * 100 : null;
    const drtg = ratable ? (g.pts_against / poss) * 100 : null;

    /**
     * PACE IS BROKEN IN THE SAME PLACES, and cannot be recomputed the same way.
     *
     * Pace is possessions per 40 minutes, so for a regulation game it IS the
     * possession count, and for an overtime game it is that scaled by
     * 40/(40 + 5·OT) — a period count this row does not carry. So pace is kept
     * from the log and sanity-checked against the possessions beside it.
     *
     * The ratio distribution over 55,153 rows says exactly where to cut:
     * 93.3% sit at 0.95-1.02 (regulation), 5.9% at 0.70-0.95 (one to three
     * overtimes, 40/45 through 40/55), and then a gap before 0.8% of rows fall
     * below 0.70. 0.65 keeps a hypothetical quadruple overtime and drops the
     * rest — including that Houston row, which logs a pace of 13.0 next to its
     * own 59.1 possessions.
     */
    const paceOk = (g.pace ?? 0) >= 40 && !!poss && g.pace / poss >= 0.65;

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
      int(g.pts_scored), int(g.pts_against), int(poss), paceOk ? tenth(g.pace) : 0,
      int(B(b, "fgm")), int(B(b, "fga")), int(B(b, "fg3m")), int(B(b, "fg3a")),
      int(B(b, "ftm")), int(B(b, "fta")),
      int(B(b, "oreb")), int(B(b, "reb")), int(B(b, "ast")), int(B(b, "stl")),
      int(B(b, "blk")), int(B(b, "tov")), int(B(b, "fouls")),
      // Ratings only where the possession count is believable — see the
      // `ratable` note above. The box score is real and stays; the ratings
      // derived from a broken denominator do not.
      tenth(ortg), tenth(drtg),
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
