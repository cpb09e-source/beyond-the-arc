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
 * `fmt` drives display only: "num1" one decimal, "pct1" a percentage already on
 * a 0-100 scale, "x2" a ratio like 0.97x.
 */
const STATS = [
  // ---- Core ----
  { key: "net_rtg",   group: "Core",    label: "Net Rating",        fmt: "num1" },
  { key: "ortg",      group: "Core",    label: "Offensive Rating",  fmt: "num1" },
  { key: "drtg",      group: "Core",    label: "Defensive Rating",  fmt: "num1", higherBetter: false },
  { key: "pace",      group: "Core",    label: "Pace",              fmt: "num1" },
  { key: "efg",       group: "Core",    label: "Effective FG%",     fmt: "pct1" },
  { key: "orb_pct",   group: "Core",    label: "Off Rebound Pct",   fmt: "pct1" },
  { key: "tov_pct",   group: "Core",    label: "Turnover Pct",      fmt: "pct1", higherBetter: false },
  { key: "ftr",       group: "Core",    label: "FT Attempt Rate",   fmt: "pct1" },

  // ---- Misc scoring ----
  { key: "fbpts_pg",  group: "Misc",    label: "Fast Break Pts / Game", fmt: "num1" },
  { key: "fbpts_sh",  group: "Misc",    label: "% Pts on Fast Break",   fmt: "pct1" },
  { key: "pitp_pg",   group: "Misc",    label: "Paint Pts / Game",      fmt: "num1" },
  { key: "pitp_sh",   group: "Misc",    label: "% Pts in Paint",        fmt: "pct1" },
  { key: "pot_pg",    group: "Misc",    label: "Points off TOVs / Game", fmt: "num1" },
  { key: "pot_sh",    group: "Misc",    label: "% Pts off TOVs",        fmt: "pct1" },
  { key: "h1_pg",     group: "Misc",    label: "1st Half Pts / Game",   fmt: "num1" },
  { key: "h2_pg",     group: "Misc",    label: "2nd Half Pts / Game",   fmt: "num1" },

  // ---- Box score ----
  { key: "pts_pg",    group: "Box",     label: "Points / Game",     fmt: "num1" },
  { key: "ast_pg",    group: "Box",     label: "Assists / Game",    fmt: "num1" },
  { key: "orb_pg",    group: "Box",     label: "ORebs / Game",      fmt: "num1" },
  { key: "drb_pg",    group: "Box",     label: "DRebs / Game",      fmt: "num1" },
  { key: "stl_pg",    group: "Box",     label: "Steals / Game",     fmt: "num1" },
  { key: "blk_pg",    group: "Box",     label: "Blocks / Game",     fmt: "num1" },
  { key: "tov_pg",    group: "Box",     label: "Turnovers / Game",  fmt: "num1", higherBetter: false },
  { key: "pf_pg",     group: "Box",     label: "PFs / Game",        fmt: "num1", higherBetter: false },

  // ---- Shooting ----
  { key: "fga_pg",    group: "Shooting", label: "FGAs / Game",      fmt: "num1" },
  { key: "fg_pct",    group: "Shooting", label: "Field Goal Pct",   fmt: "pct1" },
  { key: "fg2a_pg",   group: "Shooting", label: "2PAs / Game",      fmt: "num1" },
  { key: "fg2_pct",   group: "Shooting", label: "2-Point Pct",      fmt: "pct1" },
  { key: "fg3a_pg",   group: "Shooting", label: "3PAs / Game",      fmt: "num1" },
  { key: "fg3_pct",   group: "Shooting", label: "3-Point Pct",      fmt: "pct1" },
  { key: "fta_pg",    group: "Shooting", label: "FTAs / Game",      fmt: "num1" },
  { key: "ft_pct",    group: "Shooting", label: "Free Throw Pct",   fmt: "pct1" },

  // ---- Advanced offense ----
  { key: "ortg2",     group: "AdvOff",  label: "Offensive Rating",  fmt: "num1" },
  { key: "ts_pct",    group: "AdvOff",  label: "True Shooting %",   fmt: "pct1" },
  { key: "fg3_rate",  group: "AdvOff",  label: "3-Point Att Rate",  fmt: "pct1" },
  { key: "ftr2",      group: "AdvOff",  label: "FT Attempt Rate",   fmt: "pct1" },
  { key: "ast_pct",   group: "AdvOff",  label: "Assist Pct",        fmt: "pct1" },
  { key: "tov_pct2",  group: "AdvOff",  label: "Turnover Pct",      fmt: "pct1", higherBetter: false },
  { key: "ast_tov",   group: "AdvOff",  label: "Ast/Tov Ratio",     fmt: "x2" },
  { key: "pfd_pg",    group: "AdvOff",  label: "PF Drawn / Game",   fmt: "num1" },

  // ---- Advanced defense ----
  { key: "drtg2",     group: "AdvDef",  label: "Defensive Rating",  fmt: "num1", higherBetter: false },
  { key: "drb_pct",   group: "AdvDef",  label: "Def Rebound Pct",   fmt: "pct1" },
  { key: "stl_pct",   group: "AdvDef",  label: "Steal Pct",         fmt: "pct1" },
  { key: "blk_pct",   group: "AdvDef",  label: "Block Pct",         fmt: "pct1" },
  { key: "hkm_pct",   group: "AdvDef",  label: "Hakeem Pct",        fmt: "pct1" },
  { key: "pf_eff",    group: "AdvDef",  label: "PF Efficiency",     fmt: "x2", higherBetter: false },
  { key: "stl_pf",    group: "AdvDef",  label: "Steals / PF",       fmt: "x2" },
  { key: "blk_pf",    group: "AdvDef",  label: "Blocks / PF",       fmt: "x2" },
];

export const GROUP_LABEL = {
  Core: "Core Stats",
  Misc: "Misc Scoring",
  Box: "Box Score",
  Shooting: "Shooting",
  AdvOff: "Adv Offense",
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
 */
function aggregate(games) {
  const n = games.length;
  if (n === 0) return null;
  const s = (f) => games.reduce((a, g) => a + (f(g) ?? 0), 0);

  const poss = s((g) => g.poss);
  const pts = s((g) => g.pts);
  const ptsAg = s((g) => g.ptsAgainst);
  const fgm = s((g) => g.fgm), fga = s((g) => g.fga);
  const fg3m = s((g) => g.fg3m), fg3a = s((g) => g.fg3a);
  const ftm = s((g) => g.ftm), fta = s((g) => g.fta);
  const tov = s((g) => g.tov), oreb = s((g) => g.oreb), reb = s((g) => g.reb);
  const ast = s((g) => g.ast), stl = s((g) => g.stl), blk = s((g) => g.blk);
  const pf = s((g) => g.pf), pfd = s((g) => g.pfDrawn);
  const fbpts = s((g) => g.fbpts), pitp = s((g) => g.pitp), pot = s((g) => g.pot);
  const h1 = s((g) => g.h1), h2 = s((g) => g.h2);
  const fg2m = fgm - fg3m, fg2a = fga - fg3a;
  const drb = reb - oreb;
  const oppOreb = s((g) => g.oppOreb), oppDrb = s((g) => g.oppDrb);

  const ortg = div(pts * 100, poss);
  const drtg = div(ptsAg * 100, poss);
  const efg = div((fgm + 0.5 * fg3m) * 100, fga);
  const ts = div(pts * 100, 2 * (fga + 0.44 * fta));
  const tovPct = div(tov * 100, poss);

  return {
    games: n,
    net_rtg: r1(ortg != null && drtg != null ? ortg - drtg : null),
    ortg: r1(ortg), ortg2: r1(ortg),
    drtg: r1(drtg), drtg2: r1(drtg),
    pace: r1(div(poss, n)),
    efg: r1(efg),
    // Rebound rates are a ratio of SUMS against the boards that were actually
    // available, not an average of per-game rates. Weighting the opponent's
    // per-game ORB% by possessions and subtracting from 100 put Michigan's
    // defensive rebounding at 64.7% where the counts say 71.8% — the same
    // average-of-ratios error this function's comment warns about.
    orb_pct: r1(div(oreb * 100, oreb + oppDrb)),
    tov_pct: r1(tovPct), tov_pct2: r1(tovPct),
    ftr: r1(div(fta * 100, fga)), ftr2: r1(div(fta * 100, fga)),

    fbpts_pg: r1(div(fbpts, n)), fbpts_sh: r1(div(fbpts * 100, pts)),
    pitp_pg: r1(div(pitp, n)),   pitp_sh: r1(div(pitp * 100, pts)),
    pot_pg: r1(div(pot, n)),     pot_sh: r1(div(pot * 100, pts)),
    h1_pg: r1(div(h1, n)), h2_pg: r1(div(h2, n)),

    pts_pg: r1(div(pts, n)),
    ast_pg: r1(div(ast, n)),
    orb_pg: r1(div(oreb, n)),
    drb_pg: r1(div(reb - oreb, n)),
    stl_pg: r1(div(stl, n)),
    blk_pg: r1(div(blk, n)),
    tov_pg: r1(div(tov, n)),
    pf_pg: r1(div(pf, n)),

    fga_pg: r1(div(fga, n)), fg_pct: r1(div(fgm * 100, fga)),
    fg2a_pg: r1(div(fg2a, n)), fg2_pct: r1(div(fg2m * 100, fg2a)),
    fg3a_pg: r1(div(fg3a, n)), fg3_pct: r1(div(fg3m * 100, fg3a)),
    fta_pg: r1(div(fta, n)), ft_pct: r1(div(ftm * 100, fta)),

    ts_pct: r1(ts),
    fg3_rate: r1(div(fg3a * 100, fga)),
    ast_pct: r1(div(ast * 100, fgm)),
    ast_tov: r2(div(ast, tov)),
    pfd_pg: r1(div(pfd, n)),

    drb_pct: r1(div(drb * 100, drb + oppOreb)),
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

    const entry = {
      conf: !!row[F.conf_game],
      home: !!g.is_home,
      neutral: !!g.is_neutral,
      won: !!g.won,
      poss: num(F.poss_box),
      pts: g.pts_scored, ptsAgainst: g.pts_against,
      fgm: num(F.fgm), fga: num(F.fga),
      fg3m: num(F.fg3m), fg3a: num(F.fg3a),
      ftm: num(F.ftm), fta: num(F.fta),
      tov: num(F.tov), oreb: num(F.oreb), reb: num(F.reb),
      ast: num(F.ast), stl: num(F.stl), blk: num(F.blk),
      pf: num(F.fouls),
      // Fouls the OPPONENT committed = fouls this team drew.
      pfDrawn: opp && typeof opp[F.fouls] === "number" ? opp[F.fouls] : null,
      fbpts: num(F.fbpts), pitp: num(F.pitp), pot: num(F.pot),
      h1: num(F.h1_pts), h2: num(F.h2_pts),
      // Opponent boards, for the rebound RATES. Their offensive rebounds are
      // the ones this team failed to secure; their defensive rebounds are the
      // ones it failed to grab back. Counts, not the ff_orb rate columns, so
      // the split aggregates as a ratio of sums.
      oppOreb: opp && typeof opp[F.oreb] === "number" ? opp[F.oreb] : null,
      oppDrb: opp && typeof opp[F.reb] === "number" && typeof opp[F.oreb] === "number"
        ? opp[F.reb] - opp[F.oreb] : null,
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
      stats: STATS.map((s) => ({ key: s.key, group: s.group, label: s.label, fmt: s.fmt })),
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
