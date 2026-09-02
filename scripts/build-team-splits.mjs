/**
 * build-team-splits.mjs — per-team advanced stats, sliced eight ways.
 *
 * Feeds the "Team Stats" panel on /teams/<slug>. For every team-season it
 * aggregates the raw per-game box scores into eight splits (full season,
 * conference, non-conference, home, away, away+neutral, wins, losses) and
 * attaches a national percentile to every number.
 *
 * WHY PRECOMPUTED. The percentile is the expensive half: a stat's percentile
 * within the "away games only" cohort needs every team's away games, so it
 * cannot be derived from one team's payload at render time. Computing it in the
 * browser would mean shipping the whole 2.3 MB box file to a team page. Done
 * here it costs one pass per season and each team ships ~6 KB.
 *
 * SOURCES, both already committed — this reads nothing from upstream, so it is
 * safe to run during the data freeze:
 *   public/data/game-box-by-year/<year>.json   raw counts, columnar
 *   public/data/game-logs-by-year/<year>.json  venue / result / opponent
 *
 * The box file is keyed "<cbbdGameId>-<cbbdTeamId>", so a game's two rows share
 * the numeric prefix. That is how a team's own row finds its opponent's, which
 * is the only way to get the stats defined against the other side of the ball
 * (fouls drawn, defensive rebound rate).
 *
 * Output: public/data/team-splits/<year>.json
 *   { season, splits: [...], stats: [...], teams: { "<name>": { "<split>": { games, v: [...], p: [...] } } } }
 * Columnar on purpose: 365 teams x 8 splits x ~40 stats of {value, pct} as
 * objects is 4x the bytes of two parallel arrays, and the page reads it by
 * index against the shared `stats` header anyway.
 *
 * Usage: node scripts/build-team-splits.mjs [year...]   (default: every year)
 */
import fs from "node:fs";
import path from "node:path";
import { midrankPercentiles } from "./lib/percentile.mjs";
import process from "node:process";

const DATA = path.resolve("public/data");
const OUT_DIR = path.join(DATA, "team-splits");

/**
 * The eight splits, in the order the dropdown offers them.
 *
 * `away` is strictly away — neutral-site games are their own thing, which is
 * why `away_neutral` exists separately rather than being the same list. In
 * March that difference is most of a team's schedule.
 */
const SPLITS = [
  { key: "full",         label: "Full Season",           test: () => true },
  { key: "conf",         label: "Conference Games",      test: (g) => g.conf },
  { key: "nonconf",      label: "Non-Conference Games",  test: (g) => !g.conf },
  { key: "home",         label: "Home",                  test: (g) => g.home && !g.neutral },
  { key: "away",         label: "Away",                  test: (g) => !g.home && !g.neutral },
  { key: "away_neutral", label: "Away + Neutral",        test: (g) => !g.home || g.neutral },
  { key: "wins",         label: "Wins",                  test: (g) => g.won },
  { key: "losses",       label: "Losses",                test: (g) => !g.won },
];

/**
 * Every stat the panel renders, grouped as the six cards.
 *
 * `higherBetter: false` marks the stats where a low number is the good one, so
 * the percentile is inverted before it becomes a colour. Getting this wrong is
 * invisible in testing and wrong on every page: a defensive rating of 88 would
 * paint red.
 *
 * `neutral: true` marks the stats where NEITHER DIRECTION IS GOOD — tempo,
 * shot diet, and the shares of the scoring pie. The percentile still means
 * something there ("more three-reliant than 82% of the country") so it is
 * still published, but the colour ramp is not, because a ramp is a claim about
 * quality. The three scoring shares make the point unarguable: they sum to
 * 100, so painting a low % of points from twos red is painting the same team
 * green one row above for the same fact.
 *
 * `fmt` drives display only: "num1" one decimal, "pct1" a percentage already on
 * a 0-100 scale, "x2" a ratio like 0.97x.
 */
const STATS = [
  // ---- Core: the two ratings and the four factors ----
  { key: "net_rtg",   group: "Core",    label: "Net Rating",        fmt: "num1" },
  { key: "ortg",      group: "Core",    label: "Offensive Rating",  fmt: "num1" },
  { key: "drtg",      group: "Core",    label: "Defensive Rating",  fmt: "num1", higherBetter: false },
  { key: "pace",      group: "Core",    label: "Pace",              fmt: "num1", neutral: true },
  { key: "efg",       group: "Core",    label: "Effective FG%",     fmt: "pct1" },
  { key: "orb_pct",   group: "Core",    label: "Off Rebound Pct",   fmt: "pct1" },
  { key: "tov_pct",   group: "Core",    label: "Turnover Pct",      fmt: "pct1", higherBetter: false },
  { key: "ftr",       group: "Core",    label: "FT Attempt Rate",   fmt: "pct1" },

  // ---- Results: what the scoreboard said ----
  { key: "win_pct",   group: "Results", label: "Win Pct",           fmt: "pct1" },
  { key: "margin_pg", group: "Results", label: "Point Margin / Game", fmt: "num1" },
  { key: "pts_pg",    group: "Results", label: "Points / Game",     fmt: "num1" },
  { key: "opp_pts_pg", group: "Results", label: "Points Allowed / Game", fmt: "num1", higherBetter: false },
  { key: "h1_margin_pg", group: "Results", label: "1st Half Margin", fmt: "num1" },
  { key: "h2_margin_pg", group: "Results", label: "2nd Half Margin", fmt: "num1" },
  { key: "lead_pg",   group: "Results", label: "Avg Largest Lead",  fmt: "num1" },
  { key: "deficit_pg", group: "Results", label: "Avg Largest Deficit", fmt: "num1", higherBetter: false },

  // ---- Box score ----
  { key: "pts_pg",    group: "Box",     label: "Points / Game",     fmt: "num1" },
  { key: "reb_pg",    group: "Box",     label: "Rebounds / Game",   fmt: "num1" },
  { key: "ast_pg",    group: "Box",     label: "Assists / Game",    fmt: "num1" },
  { key: "orb_pg",    group: "Box",     label: "ORebs / Game",      fmt: "num1" },
  { key: "drb_pg",    group: "Box",     label: "DRebs / Game",      fmt: "num1" },
  { key: "stl_pg",    group: "Box",     label: "Steals / Game",     fmt: "num1" },
  { key: "blk_pg",    group: "Box",     label: "Blocks / Game",     fmt: "num1" },
  { key: "tov_pg",    group: "Box",     label: "Turnovers / Game",  fmt: "num1", higherBetter: false },
  { key: "pf_pg",     group: "Box",     label: "PFs / Game",        fmt: "num1", higherBetter: false },

  // ---- Shooting: makes, attempts and the rate, for all three shot types ----
  { key: "fgm_pg",    group: "Shooting", label: "FGMs / Game",      fmt: "num1" },
  { key: "fga_pg",    group: "Shooting", label: "FGAs / Game",      fmt: "num1" },
  { key: "fg_pct",    group: "Shooting", label: "Field Goal Pct",   fmt: "pct1" },
  { key: "fg2m_pg",   group: "Shooting", label: "2PMs / Game",      fmt: "num1" },
  { key: "fg2a_pg",   group: "Shooting", label: "2PAs / Game",      fmt: "num1" },
  { key: "fg2_pct",   group: "Shooting", label: "2-Point Pct",      fmt: "pct1" },
  { key: "fg3m_pg",   group: "Shooting", label: "3PMs / Game",      fmt: "num1" },
  { key: "fg3a_pg",   group: "Shooting", label: "3PAs / Game",      fmt: "num1" },
  { key: "fg3_pct",   group: "Shooting", label: "3-Point Pct",      fmt: "pct1" },
  { key: "ftm_pg",    group: "Shooting", label: "FTMs / Game",      fmt: "num1" },
  { key: "fta_pg",    group: "Shooting", label: "FTAs / Game",      fmt: "num1" },
  { key: "ft_pct",    group: "Shooting", label: "Free Throw Pct",   fmt: "pct1" },

  // ---- Scoring breakdown: where the points come from ----
  //
  // The three shares sum to 100 by construction, which is the point: a team at
  // 28% from three and 16% from the line is a different offence from one at
  // 18/26 even when both score 76.
  { key: "pts2_sh",   group: "Misc",    label: "% Pts from 2s",     fmt: "pct1", neutral: true },
  { key: "pts3_sh",   group: "Misc",    label: "% Pts from 3s",     fmt: "pct1", neutral: true },
  { key: "ptsft_sh",  group: "Misc",    label: "% Pts from FTs",    fmt: "pct1", neutral: true },
  { key: "pitp_pg",   group: "Misc",    label: "Paint Pts / Game",  fmt: "num1" },
  { key: "pitp_sh",   group: "Misc",    label: "% Pts in Paint",    fmt: "pct1", neutral: true },
  { key: "fbpts_pg",  group: "Misc",    label: "Fast Break Pts / Game", fmt: "num1" },
  { key: "fbpts_sh",  group: "Misc",    label: "% Pts on Fast Break",   fmt: "pct1", neutral: true },
  { key: "pot_pg",    group: "Misc",    label: "Points off TOVs / Game", fmt: "num1" },
  { key: "pot_sh",    group: "Misc",    label: "% Pts off TOVs",    fmt: "pct1", neutral: true },
  { key: "h1_pg",     group: "Misc",    label: "1st Half Pts / Game", fmt: "num1" },
  { key: "h2_pg",     group: "Misc",    label: "2nd Half Pts / Game", fmt: "num1" },

  // ---- Advanced offense ----
  { key: "ts_pct",    group: "AdvOff",  label: "True Shooting %",   fmt: "pct1" },
  { key: "pts_shot",  group: "AdvOff",  label: "Points / Shot",     fmt: "num2" },
  { key: "fg3_rate",  group: "AdvOff",  label: "3-Point Att Rate",  fmt: "pct1", neutral: true },
  { key: "ast_pct",   group: "AdvOff",  label: "Assist Pct",        fmt: "pct1" },
  { key: "ast_poss",  group: "AdvOff",  label: "Assists / 100 Poss", fmt: "num1" },
  { key: "ast_tov",   group: "AdvOff",  label: "Ast/Tov Ratio",     fmt: "x2" },
  { key: "pfd_pg",    group: "AdvOff",  label: "PF Drawn / Game",   fmt: "num1" },

  // ---- Opponent shooting ----
  //
  // ALL EIGHT COME FROM THE OTHER TEAM'S BOX ROW, which this file already
  // joins for fouls drawn. Until now the defensive card held only steals,
  // blocks and fouls — a team could hold everyone to 42% eFG and the panel
  // never said so.
  { key: "opp_efg",     group: "OppShoot", label: "Opp Effective FG%", fmt: "pct1", higherBetter: false },
  { key: "opp_ts_pct",  group: "OppShoot", label: "Opp True Shooting %", fmt: "pct1", higherBetter: false },
  { key: "opp_fg_pct",  group: "OppShoot", label: "Opp Field Goal Pct", fmt: "pct1", higherBetter: false },
  { key: "opp_fg2_pct", group: "OppShoot", label: "Opp 2-Point Pct",   fmt: "pct1", higherBetter: false },
  { key: "opp_fg3_pct", group: "OppShoot", label: "Opp 3-Point Pct",   fmt: "pct1", higherBetter: false },
  { key: "opp_fg3_rate", group: "OppShoot", label: "Opp 3PA Rate",     fmt: "pct1", higherBetter: false },
  { key: "opp_ftr",     group: "OppShoot", label: "Opp FT Att Rate",   fmt: "pct1", higherBetter: false },
  { key: "opp_pts_shot", group: "OppShoot", label: "Opp Points / Shot", fmt: "num2", higherBetter: false },

  // ---- What the defence gives up ----
  { key: "opp_pts_pg",   group: "Allowed", label: "Points Allowed / Game", fmt: "num1", higherBetter: false },
  { key: "opp_pitp_pg",  group: "Allowed", label: "Paint Pts Allowed",    fmt: "num1", higherBetter: false },
  { key: "opp_fbpts_pg", group: "Allowed", label: "Fast Break Pts Allowed", fmt: "num1", higherBetter: false },
  { key: "opp_pot_pg",   group: "Allowed", label: "Pts off TOVs Allowed", fmt: "num1", higherBetter: false },
  { key: "opp_ast_pct",  group: "Allowed", label: "Opp Assist Pct",      fmt: "pct1", higherBetter: false },
  { key: "opp_tov_pg",   group: "Allowed", label: "TOVs Forced / Game",  fmt: "num1" },

  // ---- Advanced defense ----
  { key: "drb_pct",   group: "AdvDef",  label: "Def Rebound Pct",   fmt: "pct1" },
  { key: "tov_frc_pct", group: "AdvDef", label: "Turnovers Forced Pct", fmt: "pct1" },
  { key: "stl_pct",   group: "AdvDef",  label: "Steal Pct",         fmt: "pct1" },
  { key: "blk_pct",   group: "AdvDef",  label: "Block Pct",         fmt: "pct1" },
  { key: "hkm_pct",   group: "AdvDef",  label: "Hakeem Pct",        fmt: "pct1" },
  { key: "pf_eff",    group: "AdvDef",  label: "PF Efficiency",     fmt: "x2", higherBetter: false },
  { key: "stl_pf",    group: "AdvDef",  label: "Steals / PF",       fmt: "x2" },
  { key: "blk_pf",    group: "AdvDef",  label: "Blocks / PF",       fmt: "x2" },
];

/**
 * Card titles, keyed by the group each stat carries.
 *
 * The panel renders one card per group IN THE ORDER STATS LISTS THEM, so this
 * map only names them — reordering the cards means reordering STATS.
 */
export const GROUP_LABEL = {
  Core: "Core Stats",
  Results: "Results & Margin",
  Box: "Box Score",
  Shooting: "Shooting",
  Misc: "Scoring Breakdown",
  AdvOff: "Adv Offense",
  OppShoot: "Opponent Shooting",
  Allowed: "Defense Allowed",
  AdvDef: "Adv Defense",
};

const div = (a, b) => (b > 0 ? a / b : null);
const r1 = (n) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n * 10) / 10 : null);
const r2 = (n) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n * 100) / 100 : null);

/**
 * Aggregate a list of games into one row of stats.
 *
 * Rates are computed from SUMMED COUNTS, never by averaging per-game rates. A
 * team that shoots 2/2 in a blowout and 8/30 in a grind did not shoot 63% — it
 * shot 31%. Averaging the two games' percentages says otherwise, and that error
 * grows exactly where the splits are most interesting (small samples: wins,
 * losses, postseason).
 *
 * ANYTHING INVOLVING THE OPPONENT SUMS OVER A SMALLER SET. About 4% of box
 * rows have no sibling row in the file, so for those games this team's own
 * counts are known and the other side's are not. Mixing the two denominators
 * is what makes a rate wrong rather than merely noisy: summing our offensive
 * rebounds over 30 games and the opponent's defensive rebounds over 29 hands
 * ORB% a board nobody grabbed. `sp` and `oppN` below only count the paired
 * games, so every opponent-relative rate divides like with like.
 */
function aggregate(games) {
  const n = games.length;
  if (n === 0) return null;
  const s = (f) => games.reduce((a, g) => a + (f(g) ?? 0), 0);
  // Paired-only sum and count: games where the other team's box row was found.
  const paired = games.filter((g) => g.hasOpp);
  const oppN = paired.length;
  const sp = (f) => paired.reduce((a, g) => a + (f(g) ?? 0), 0);
  // Average over the games that actually carried the field, so a column that
  // is 99.7% present is not quietly deflated by the 0.3% that is missing.
  const avg = (f) => div(s(f), games.filter((g) => typeof f(g) === "number").length);

  const poss = s((g) => g.poss);
  const pts = s((g) => g.pts);
  const ptsAg = s((g) => g.ptsAgainst);
  const fgm = s((g) => g.fgm), fga = s((g) => g.fga);
  const fg3m = s((g) => g.fg3m), fg3a = s((g) => g.fg3a);
  const ftm = s((g) => g.ftm), fta = s((g) => g.fta);
  const tov = s((g) => g.tov), oreb = s((g) => g.oreb), reb = s((g) => g.reb);
  const ast = s((g) => g.ast), stl = s((g) => g.stl), blk = s((g) => g.blk);
  const pf = s((g) => g.pf), pfd = sp((g) => g.pfDrawn);
  const fbpts = s((g) => g.fbpts), pitp = s((g) => g.pitp), pot = s((g) => g.pot);
  const h1 = s((g) => g.h1), h2 = s((g) => g.h2);
  const fg2m = fgm - fg3m, fg2a = fga - fg3a;
  const drb = reb - oreb;
  const wins = games.reduce((a, g) => a + (g.won ? 1 : 0), 0);

  // Our own boards over the paired games only — see the header.
  const orebP = sp((g) => g.oreb);
  const rebP = sp((g) => g.reb);
  const drbP = rebP - orebP;
  const possP = sp((g) => g.poss);
  const ptsAgP = sp((g) => g.ptsAgainst);
  const oppOreb = sp((g) => g.oppOreb), oppDrb = sp((g) => g.oppDrb);

  // The other side of the ball, in counts.
  const oFgm = sp((g) => g.oppFgm), oFga = sp((g) => g.oppFga);
  const oFg3m = sp((g) => g.oppFg3m), oFg3a = sp((g) => g.oppFg3a);
  const oFta = sp((g) => g.oppFta);
  const oTov = sp((g) => g.oppTov), oAst = sp((g) => g.oppAst);
  const oPitp = sp((g) => g.oppPitp), oFb = sp((g) => g.oppFbpts), oPot = sp((g) => g.oppPot);
  const oFg2m = oFgm - oFg3m, oFg2a = oFga - oFg3a;

  const ortg = div(pts * 100, poss);
  const drtg = div(ptsAg * 100, poss);
  const efg = div((fgm + 0.5 * fg3m) * 100, fga);
  const ts = div(pts * 100, 2 * (fga + 0.44 * fta));
  const tovPct = div(tov * 100, poss);

  return {
    games: n,
    net_rtg: r1(ortg != null && drtg != null ? ortg - drtg : null),
    ortg: r1(ortg),
    drtg: r1(drtg),
    pace: r1(div(poss, n)),
    efg: r1(efg),
    // Rebound rates are a ratio of SUMS against the boards that were actually
    // available, not an average of per-game rates. Weighting the opponent's
    // per-game ORB% by possessions and subtracting from 100 put Michigan's
    // defensive rebounding at 64.7% where the counts say 71.8% — the same
    // average-of-ratios error this function's comment warns about.
    orb_pct: r1(div(orebP * 100, orebP + oppDrb)),
    tov_pct: r1(tovPct),
    ftr: r1(div(fta * 100, fga)),

    win_pct: r1(div(wins * 100, n)),
    margin_pg: r1(div(pts - ptsAg, n)),
    opp_pts_pg: r1(div(ptsAg, n)),
    h1_margin_pg: r1(avg((g) => g.h1m)),
    h2_margin_pg: r1(avg((g) => g.h2m)),
    lead_pg: r1(avg((g) => g.lead)),
    deficit_pg: r1(avg((g) => g.leadOpp)),

    fbpts_pg: r1(div(fbpts, n)), fbpts_sh: r1(div(fbpts * 100, pts)),
    pitp_pg: r1(div(pitp, n)),   pitp_sh: r1(div(pitp * 100, pts)),
    pot_pg: r1(div(pot, n)),     pot_sh: r1(div(pot * 100, pts)),
    h1_pg: r1(div(h1, n)), h2_pg: r1(div(h2, n)),
    // The three shares of the scoring pie. Free throws are worth one, twos two
    // and threes three — so these are points, not makes, and they sum to 100.
    pts2_sh: r1(div(fg2m * 2 * 100, pts)),
    pts3_sh: r1(div(fg3m * 3 * 100, pts)),
    ptsft_sh: r1(div(ftm * 100, pts)),

    pts_pg: r1(div(pts, n)),
    reb_pg: r1(div(reb, n)),
    ast_pg: r1(div(ast, n)),
    orb_pg: r1(div(oreb, n)),
    drb_pg: r1(div(reb - oreb, n)),
    stl_pg: r1(div(stl, n)),
    blk_pg: r1(div(blk, n)),
    tov_pg: r1(div(tov, n)),
    pf_pg: r1(div(pf, n)),

    fgm_pg: r1(div(fgm, n)), fga_pg: r1(div(fga, n)), fg_pct: r1(div(fgm * 100, fga)),
    fg2m_pg: r1(div(fg2m, n)), fg2a_pg: r1(div(fg2a, n)), fg2_pct: r1(div(fg2m * 100, fg2a)),
    fg3m_pg: r1(div(fg3m, n)), fg3a_pg: r1(div(fg3a, n)), fg3_pct: r1(div(fg3m * 100, fg3a)),
    ftm_pg: r1(div(ftm, n)), fta_pg: r1(div(fta, n)), ft_pct: r1(div(ftm * 100, fta)),

    ts_pct: r1(ts),
    pts_shot: r2(div(pts, fga)),
    fg3_rate: r1(div(fg3a * 100, fga)),
    ast_pct: r1(div(ast * 100, fgm)),
    ast_poss: r1(div(ast * 100, poss)),
    ast_tov: r2(div(ast, tov)),
    pfd_pg: r1(div(pfd, oppN)),

    opp_efg: r1(div((oFgm + 0.5 * oFg3m) * 100, oFga)),
    opp_ts_pct: r1(div(ptsAgP * 100, 2 * (oFga + 0.44 * oFta))),
    opp_fg_pct: r1(div(oFgm * 100, oFga)),
    opp_fg2_pct: r1(div(oFg2m * 100, oFg2a)),
    opp_fg3_pct: r1(div(oFg3m * 100, oFg3a)),
    opp_fg3_rate: r1(div(oFg3a * 100, oFga)),
    opp_ftr: r1(div(oFta * 100, oFga)),
    opp_pts_shot: r2(div(ptsAgP, oFga)),

    opp_pitp_pg: r1(div(oPitp, oppN)),
    opp_fbpts_pg: r1(div(oFb, oppN)),
    opp_pot_pg: r1(div(oPot, oppN)),
    opp_ast_pct: r1(div(oAst * 100, oFgm)),
    opp_tov_pg: r1(div(oTov, oppN)),

    drb_pct: r1(div(drbP * 100, drbP + oppOreb)),
    // Possessions are shared, so a turnover rate forced reads on the same
    // scale as the one committed — and against the paired possessions, since
    // the opponent's turnovers are only known for those games.
    tov_frc_pct: r1(div(oTov * 100, possP)),
    stl_pct: r1(div(stl * 100, poss)),
    blk_pct: r1(div(blk * 100, poss)),
    hkm_pct: r1(div((stl + blk) * 100, poss)),
    pf_eff: r2(div(pf, pfd)),
    stl_pf: r2(div(stl, pf)),
    blk_pf: r2(div(blk, pf)),
  };
}

/**
 * Percentile of every team's value within one (split, stat) cohort.
 *
 * Ranked ascending then inverted for the lower-is-better stats, so 100 always
 * means "best in the country at this" and the colour ramp needs no per-stat
 * knowledge. Cohorts under 20 teams are left unranked — a percentile out of
 * eight teams is noise wearing a number.
 */
function percentiles(values, higherBetter) {
  // A THIN POOL IS NOT A PERCENTILE. Under twenty teams, "83rd percentile"
  // describes the shape of a small sample rather than the field, so the split
  // reports nothing instead. Kept exactly as it was.
  const present = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (present.length < 20) return new Array(values.length).fill(null);
  // A PERCENTILE IS ONLY NATIONAL IF MOST OF THE NATION IS IN IT. Some columns
  // are absent for whole seasons rather than for the odd team — largest lead is
  // in 0.5% of 2014 box rows and 99.7% of 2025 — and ranking the 57 teams that
  // have it would print a national percentile computed from a sixth of the
  // field. Over the 20-team floor but under half the cohort, the value still
  // shows and the chip does not.
  if (present.length * 2 < values.length) return new Array(values.length).fill(null);
  // A CONSTANT COLUMN HAS NO ORDER. Win Pct on the Wins split is 100 for every
  // team in the country and 0 on Losses — the split defines the stat — so the
  // midrank hands all 364 of them a 50th percentile, which reads as "average
  // at winning" rather than "this question is empty". Every tie is a tie, so
  // no chip.
  if (new Set(present).size === 1) return new Array(values.length).fill(null);
  // Ties share a midrank — see scripts/lib/percentile.mjs. This used to rank by
  // position in the sorted array, so equal values got different percentiles
  // depending on where Array.sort left them.
  //
  // INVERSION IS PASSED IN rather than applied as 100 - p afterwards: once ties
  // exist the two stop agreeing, because flipping a midrank only lands right
  // when the tied block is symmetric about the middle.
  return midrankPercentiles(values, higherBetter !== false);
}

function buildYear(year) {
  const boxPath = path.join(DATA, "game-box-by-year", `${year}.json`);
  const logPath = path.join(DATA, "game-logs-by-year", `${year}.json`);
  if (!fs.existsSync(boxPath) || !fs.existsSync(logPath)) return null;

  const box = JSON.parse(fs.readFileSync(boxPath, "utf8"));
  const logs = JSON.parse(fs.readFileSync(logPath, "utf8"));
  const F = {};
  box.fields.forEach((f, i) => { F[f] = i; });

  // Both rows of a game share the numeric prefix of their key. Needed for the
  // stats defined against the other side: fouls drawn, defensive rebound rate.
  const siblings = new Map();
  for (const k of Object.keys(box.rows)) {
    const p = k.slice(0, k.indexOf("-"));
    const list = siblings.get(p) ?? siblings.set(p, []).get(p);
    list.push(k);
  }

  const byTeam = new Map();
  let unjoined = 0;
  for (const g of logs) {
    const row = box.rows[g.game_id];
    if (!row) { unjoined++; continue; }
    const sibKey = (siblings.get(g.game_id.slice(0, g.game_id.indexOf("-"))) ?? [])
      .find((k) => k !== g.game_id);
    const opp = sibKey ? box.rows[sibKey] : null;
    const num = (i) => (typeof row[i] === "number" ? row[i] : null);
    // The other team's row, read the same way. Null when the sibling is
    // missing — about 4% of rows — which is why `hasOpp` rides along and every
    // opponent-relative rate in aggregate() sums over the paired games only.
    const onum = (i) => (opp && typeof opp[i] === "number" ? opp[i] : null);

    const entry = {
      conf: !!row[F.conf_game],
      home: !!g.is_home,
      neutral: !!g.is_neutral,
      won: !!g.won,
      hasOpp: !!opp,
      poss: num(F.poss_box),
      pts: g.pts_scored, ptsAgainst: g.pts_against,
      fgm: num(F.fgm), fga: num(F.fga),
      fg3m: num(F.fg3m), fg3a: num(F.fg3a),
      ftm: num(F.ftm), fta: num(F.fta),
      tov: num(F.tov), oreb: num(F.oreb), reb: num(F.reb),
      ast: num(F.ast), stl: num(F.stl), blk: num(F.blk),
      pf: num(F.fouls),
      // Fouls the OPPONENT committed = fouls this team drew.
      pfDrawn: onum(F.fouls),
      fbpts: num(F.fbpts), pitp: num(F.pitp), pot: num(F.pot),
      h1: num(F.h1_pts), h2: num(F.h2_pts),
      // Margins and biggest swings, already computed upstream per game.
      h1m: num(F.h1_margin), h2m: num(F.h2_margin),
      lead: num(F.largest_lead), leadOpp: num(F.largest_lead_opp),
      // Opponent boards, for the rebound RATES. Their offensive rebounds are
      // the ones this team failed to secure; their defensive rebounds are the
      // ones it failed to grab back. Counts, not the ff_orb rate columns, so
      // the split aggregates as a ratio of sums.
      oppOreb: onum(F.oreb),
      oppDrb: opp && typeof opp[F.reb] === "number" && typeof opp[F.oreb] === "number"
        ? opp[F.reb] - opp[F.oreb] : null,
      // The rest of the opponent's line. Same reason the ff_*_def columns are
      // not used: those are per-game rates, and a split has to aggregate as a
      // ratio of sums or it is an average of ratios.
      oppFgm: onum(F.fgm), oppFga: onum(F.fga),
      oppFg3m: onum(F.fg3m), oppFg3a: onum(F.fg3a),
      oppFta: onum(F.fta),
      oppTov: onum(F.tov), oppAst: onum(F.ast),
      oppPitp: onum(F.pitp), oppFbpts: onum(F.fbpts), oppPot: onum(F.pot),
    };
    const list = byTeam.get(g.team_name) ?? byTeam.set(g.team_name, []).get(g.team_name);
    list.push(entry);
  }

  // teams -> split -> aggregate row
  const agg = new Map();
  for (const [team, games] of byTeam) {
    const perSplit = {};
    for (const sp of SPLITS) {
      const sub = games.filter(sp.test);
      const a = aggregate(sub);
      if (a) perSplit[sp.key] = a;
    }
    agg.set(team, perSplit);
  }

  // Percentiles, one cohort per (split, stat).
  const teamNames = [...agg.keys()].sort();
  const out = {};
  for (const t of teamNames) out[t] = {};
  for (const sp of SPLITS) {
    for (const t of teamNames) {
      const a = agg.get(t)[sp.key];
      if (a) out[t][sp.key] = { games: a.games, v: STATS.map((st) => a[st.key] ?? null), p: [] };
    }
    STATS.forEach((st, si) => {
      const vals = teamNames.map((t) => out[t][sp.key]?.v[si] ?? null);
      const pcts = percentiles(vals, st.higherBetter);
      teamNames.forEach((t, ti) => {
        if (out[t][sp.key]) out[t][sp.key].p[si] = pcts[ti];
      });
    });
  }

  return {
    payload: {
      season: year,
      splits: SPLITS.map((s) => ({ key: s.key, label: s.label })),
      // `neutral` is spread in only when true: it lands on 8 of 77 stats and a
      // false on the other 69 would be 69 wasted keys in every season file.
      stats: STATS.map((s) => ({
        key: s.key, group: s.group, label: s.label, fmt: s.fmt,
        ...(s.neutral ? { neutral: true } : {}),
      })),
      groups: GROUP_LABEL,
      teams: out,
    },
    teamCount: teamNames.length,
    unjoined,
  };
}

function main() {
  const argv = process.argv.slice(2).map(Number).filter(Number.isFinite);
  const years = argv.length
    ? argv
    : fs.readdirSync(path.join(DATA, "game-box-by-year"))
        .filter((f) => f.endsWith(".json"))
        .map((f) => Number(f.replace(".json", "")))
        .filter(Number.isFinite)
        .sort();

  fs.mkdirSync(OUT_DIR, { recursive: true });
  let wrote = 0, totalMb = 0;
  for (const year of years) {
    const res = buildYear(year);
    if (!res) { console.log(`  ${year}: no box/log file, skipped`); continue; }
    const file = path.join(OUT_DIR, `${year}.json`);
    fs.writeFileSync(file, JSON.stringify(res.payload));
    const mb = fs.statSync(file).size / 1e6;
    totalMb += mb;
    wrote++;
    console.log(
      `  ${year}: ${String(res.teamCount).padStart(3)} teams · ${mb.toFixed(2)} MB` +
      (res.unjoined ? `  (${res.unjoined} log rows had no box row)` : ""),
    );
  }

  // A season that produced no teams means the join broke, which would ship an
  // empty panel rather than an obviously missing one. Stop instead.
  if (wrote === 0) {
    console.error("\n  ABORTED: no season produced any team splits. Check the box/log join.");
    process.exit(1);
  }
  console.log(`\n✓ wrote ${wrote} season file(s) to ${OUT_DIR} (${totalMb.toFixed(2)} MB total)`);
}

main();
