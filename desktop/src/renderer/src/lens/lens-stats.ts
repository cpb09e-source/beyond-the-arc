import { F, gameStat } from "@/lib/game-index";
import { T, teamGameStat } from "@/lib/team-game-index";
import type { PlayerGame } from "~/data/player-game-model";
import type { TeamGame } from "~/data/team-game-model";

/**
 * The stats the Stat Lens can break down, and how each is rebuilt from games.
 *
 * TWO READINGS PER STAT. `game` is one game's value, read with the site's own
 * game log getters (TEAM_GAME_STATS, GAME_STATS), so a bar in the lens is the
 * number on that game's row. `pool` is a set of games the way a season number
 * is built: shooting from makes and attempts, ratings from points and
 * possessions, never an average of percentages, which weights a 2-for-2 night
 * like a 10-for-20 one.
 *
 * WHERE THE GAMES CANNOT REBUILD IT, THE LENS SAYS SO (`note`). An adjusted
 * rating is the schedule-adjusted version of what the games show raw; a rate
 * the log carries only per game is pooled weighted by possessions or minutes.
 * EPM, eWins and strength of schedule are fits over a season, not sums of
 * games, and have no lens at all.
 */

export type LensFmt = "num1" | "num2" | "pct1" | "signed1";

export type LensStat<G> = {
  key: string;
  /** How the lens heads the stat: "Offensive rating". */
  label: string;
  fmt: LensFmt;
  lowerBetter?: boolean;
  game: (g: G) => number | null;
  pool: (games: G[]) => number | null;
  note?: string;
};

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);
const sumOf = <G>(games: G[], read: (g: G) => number): number => games.reduce((n, g) => n + read(g), 0);
const meanOf = <G>(games: G[], read: (g: G) => number | null): number | null => {
  let n = 0;
  let total = 0;
  for (const g of games) {
    const v = read(g);
    if (v == null || Number.isNaN(v)) continue;
    total += v;
    n += 1;
  }
  return n > 0 ? total / n : null;
};
/** An average of per-game values, each weighted (by possessions, or minutes). */
const weightedOf = <G>(games: G[], read: (g: G) => number | null, weight: (g: G) => number): number | null => {
  let w = 0;
  let total = 0;
  for (const g of games) {
    const v = read(g);
    const k = weight(g);
    if (v == null || Number.isNaN(v) || k <= 0) continue;
    total += v * k;
    w += k;
  }
  return w > 0 ? total / w : null;
};

/* --------------------------------- teams ---------------------------------- */

const tr = (g: TeamGame, i: number) => g.row[i]!;
const tget = (key: string) => {
  const st = teamGameStat(key)!;
  return (g: TeamGame) => st.get(g.row);
};
const perPoss = (g: TeamGame) => tr(g, T.poss);
/** What the opponent had that night, from its own row; null when the log has no row for it. */
const opp = (g: TeamGame, i: number): number | null => g.oppRow?.[i] ?? null;
/** One game's count over its possessions, times `scale`. */
const perGame = (read: (g: TeamGame) => number | null, scale = 1) => (g: TeamGame): number | null => {
  const v = read(g);
  const p = tr(g, T.poss);
  return v == null || p <= 0 ? null : (scale * v) / p;
};
/** A count over possessions across games, counting only games that carry it. */
const pooledPer = (read: (g: TeamGame) => number | null, scale = 1) => (gs: TeamGame[]): number | null => {
  let n = 0;
  let p = 0;
  for (const g of gs) {
    const v = read(g);
    if (v == null) continue;
    n += v;
    p += tr(g, T.poss);
  }
  return p > 0 ? (scale * n) / p : null;
};
/** A ratio of two opponent counts across games, counting only games that carry both. */
const pooledOpp = (top: (g: TeamGame) => number | null, bottom: (g: TeamGame) => number | null) => (gs: TeamGame[]): number | null => {
  let a = 0;
  let b = 0;
  for (const g of gs) {
    const t = top(g);
    const u = bottom(g);
    if (t == null || u == null) continue;
    a += t;
    b += u;
  }
  return b > 0 ? a / b : null;
};
const oppMakes = (g: TeamGame) => (g.oppRow ? g.oppRow[T.fgm]! + 0.5 * g.oppRow[T.fg3m]! : null);

export const TEAM_LENS: Record<string, LensStat<TeamGame>> = {
  ortg: {
    key: "ortg", label: "Offensive rating", fmt: "num1", game: tget("ortg"),
    pool: (gs) => {
      const r = ratio(sumOf(gs, (g) => tr(g, T.pts)), sumOf(gs, perPoss));
      return r == null ? null : r * 100;
    },
  },
  drtg: {
    key: "drtg", label: "Defensive rating", fmt: "num1", lowerBetter: true, game: tget("drtg"),
    pool: (gs) => {
      const r = ratio(sumOf(gs, (g) => tr(g, T.pa)), sumOf(gs, perPoss));
      return r == null ? null : r * 100;
    },
  },
  net: {
    key: "net", label: "Net rating", fmt: "signed1", game: tget("net"),
    pool: (gs) => {
      const r = ratio(sumOf(gs, (g) => tr(g, T.pts) - tr(g, T.pa)), sumOf(gs, perPoss));
      return r == null ? null : r * 100;
    },
  },
  margin: {
    key: "margin", label: "Scoring margin", fmt: "signed1", game: tget("margin"),
    pool: (gs) => meanOf(gs, tget("margin")),
  },
  pace: {
    key: "pace", label: "Pace", fmt: "num1", game: tget("pace"),
    pool: (gs) => meanOf(gs, tget("pace")),
  },
  pts: { key: "pts", label: "Points", fmt: "num1", game: tget("pts"), pool: (gs) => meanOf(gs, tget("pts")) },
  pa: { key: "pa", label: "Points allowed", fmt: "num1", lowerBetter: true, game: tget("pa"), pool: (gs) => meanOf(gs, tget("pa")) },
  reb: { key: "reb", label: "Rebounds", fmt: "num1", game: tget("reb"), pool: (gs) => meanOf(gs, tget("reb")) },
  oreb: { key: "oreb", label: "Offensive rebounds", fmt: "num1", game: tget("oreb"), pool: (gs) => meanOf(gs, tget("oreb")) },
  ast: { key: "ast", label: "Assists", fmt: "num1", game: tget("ast"), pool: (gs) => meanOf(gs, tget("ast")) },
  stl: { key: "stl", label: "Steals", fmt: "num1", game: tget("stl"), pool: (gs) => meanOf(gs, tget("stl")) },
  blk: { key: "blk", label: "Blocks", fmt: "num1", game: tget("blk"), pool: (gs) => meanOf(gs, tget("blk")) },
  tov: { key: "tov", label: "Turnovers", fmt: "num1", lowerBetter: true, game: tget("tov"), pool: (gs) => meanOf(gs, tget("tov")) },
  efg: {
    key: "efg", label: "Effective FG%", fmt: "pct1", game: tget("efg"),
    pool: (gs) => ratio(sumOf(gs, (g) => tr(g, T.fgm) + 0.5 * tr(g, T.fg3m)), sumOf(gs, (g) => tr(g, T.fga))),
  },
  fg_pct: {
    key: "fg_pct", label: "Field goal %", fmt: "pct1", game: tget("fg_pct"),
    pool: (gs) => ratio(sumOf(gs, (g) => tr(g, T.fgm)), sumOf(gs, (g) => tr(g, T.fga))),
  },
  fg3_pct: {
    key: "fg3_pct", label: "Three-point %", fmt: "pct1", game: tget("fg3_pct"),
    pool: (gs) => ratio(sumOf(gs, (g) => tr(g, T.fg3m)), sumOf(gs, (g) => tr(g, T.fg3a))),
  },
  ft_pct: {
    key: "ft_pct", label: "Free throw %", fmt: "pct1", game: tget("ft_pct"),
    pool: (gs) => ratio(sumOf(gs, (g) => tr(g, T.ftm)), sumOf(gs, (g) => tr(g, T.fta))),
  },
  ts: {
    key: "ts", label: "True shooting %", fmt: "pct1", game: tget("ts"),
    pool: (gs) => ratio(sumOf(gs, (g) => tr(g, T.pts)), sumOf(gs, (g) => 2 * (tr(g, T.fga) + 0.44 * tr(g, T.fta)))),
  },
  fg3_rate: {
    key: "fg3_rate", label: "Three-point attempt rate", fmt: "pct1",
    game: (g) => ratio(tr(g, T.fg3a), tr(g, T.fga)),
    pool: (gs) => ratio(sumOf(gs, (g) => tr(g, T.fg3a)), sumOf(gs, (g) => tr(g, T.fga))),
  },
  ftr: {
    key: "ftr", label: "Free throw rate", fmt: "pct1", game: tget("ftr"),
    pool: (gs) => ratio(sumOf(gs, (g) => tr(g, T.fta)), sumOf(gs, (g) => tr(g, T.fga))),
  },
  tovr: {
    key: "tovr", label: "Turnover rate", fmt: "pct1", lowerBetter: true, game: tget("tovr"),
    pool: (gs) => ratio(sumOf(gs, (g) => tr(g, T.tov)), sumOf(gs, perPoss)),
  },
  orbr: {
    key: "orbr", label: "Offensive rebound rate", fmt: "pct1", game: tget("orbr"),
    pool: (gs) => weightedOf(gs, tget("orbr"), perPoss),
    note: "The log carries rebound rates per game, so a set of games is weighted by possessions.",
  },
  efgd: {
    key: "efgd", label: "Opponent effective FG%", fmt: "pct1", lowerBetter: true, game: tget("efgd"),
    // From the opponents' own makes and attempts; a game without an opponent row falls back to the log's rate.
    pool: (gs) => (gs.every((g) => g.oppRow) ? pooledOpp(oppMakes, (g) => opp(g, T.fga))(gs) : weightedOf(gs, tget("efgd"), perPoss)),
  },
  tovd: {
    key: "tovd", label: "Opponent turnover rate", fmt: "pct1", game: perGame((g) => opp(g, T.tov)),
    pool: pooledPer((g) => opp(g, T.tov)),
  },
  orebp: {
    key: "orebp", label: "Offensive rebounds per 100 possessions", fmt: "num1", game: perGame((g) => tr(g, T.oreb), 100),
    pool: pooledPer((g) => tr(g, T.oreb), 100),
  },
  orebpd: {
    key: "orebpd", label: "Opponent offensive rebounds per 100 possessions", fmt: "num1", lowerBetter: true,
    game: perGame((g) => opp(g, T.oreb), 100),
    pool: pooledPer((g) => opp(g, T.oreb), 100),
  },
  ftap: {
    key: "ftap", label: "Free throw attempts per 100 possessions", fmt: "num1", game: perGame((g) => tr(g, T.fta), 100),
    pool: pooledPer((g) => tr(g, T.fta), 100),
  },
  ftapd: {
    key: "ftapd", label: "Opponent free throw attempts per 100 possessions", fmt: "num1", lowerBetter: true,
    game: perGame((g) => opp(g, T.fta), 100),
    pool: pooledPer((g) => opp(g, T.fta), 100),
  },
  ftpd: {
    key: "ftpd", label: "Opponent free throw %", fmt: "pct1", lowerBetter: true,
    game: (g) => (g.oppRow && g.oppRow[T.fta]! > 0 ? g.oppRow[T.ftm]! / g.oppRow[T.fta]! : null),
    pool: pooledOpp((g) => opp(g, T.ftm), (g) => opp(g, T.fta)),
  },
};

/** Team Explorer columns, team stat card keys and profile tiles, as the lens stat each one is built from. */
export const TEAM_LENS_FOR: Record<string, { stat: string; adjusted?: boolean }> = {
  // Team Explorer
  record: { stat: "margin" },
  adjO: { stat: "ortg", adjusted: true },
  adjD: { stat: "drtg", adjusted: true },
  adjNet: { stat: "net", adjusted: true },
  tempo: { stat: "pace", adjusted: true },
  efg: { stat: "efg" },
  efgDef: { stat: "efgd" },
  tov: { stat: "tovr" },
  orb: { stat: "orbr" },
  fg3: { stat: "fg3_pct" },
  // The site's team stat cards (team-splits)
  net_rtg: { stat: "net" },
  ortg: { stat: "ortg" },
  drtg: { stat: "drtg" },
  pace: { stat: "pace" },
  orb_pct: { stat: "orbr" },
  tov_pct: { stat: "tovr" },
  ftr: { stat: "ftr" },
  win_pct: { stat: "margin" },
  margin_pg: { stat: "margin" },
  pts_pg: { stat: "pts" },
  opp_pts_pg: { stat: "pa" },
  reb_pg: { stat: "reb" },
  ast_pg: { stat: "ast" },
  orb_pg: { stat: "oreb" },
  stl_pg: { stat: "stl" },
  blk_pg: { stat: "blk" },
  tov_pg: { stat: "tov" },
  fg_pct: { stat: "fg_pct" },
  fg3_pct: { stat: "fg3_pct" },
  ft_pct: { stat: "ft_pct" },
  ts_pct: { stat: "ts" },
  fg3_rate: { stat: "fg3_rate" },
  opp_efg: { stat: "efgd" },
};

/* -------------------------------- players --------------------------------- */

const pr = (g: PlayerGame, i: number) => g.row[i]!;
const pget = (key: string) => {
  const st = gameStat(key)!;
  return (g: PlayerGame) => st.get(g.row);
};
const avg = (key: string) => (gs: PlayerGame[]) => meanOf(gs, pget(key));
const minutes = (g: PlayerGame) => pr(g, F.min);

export const PLAYER_LENS: Record<string, LensStat<PlayerGame>> = {
  pts: { key: "pts", label: "Points", fmt: "num1", game: pget("pts"), pool: avg("pts") },
  reb: { key: "reb", label: "Rebounds", fmt: "num1", game: pget("reb"), pool: avg("reb") },
  orb: { key: "orb", label: "Offensive rebounds", fmt: "num1", game: pget("orb"), pool: avg("orb") },
  drb: { key: "drb", label: "Defensive rebounds", fmt: "num1", game: pget("drb"), pool: avg("drb") },
  ast: { key: "ast", label: "Assists", fmt: "num1", game: pget("ast"), pool: avg("ast") },
  stl: { key: "stl", label: "Steals", fmt: "num1", game: pget("stl"), pool: avg("stl") },
  blk: { key: "blk", label: "Blocks", fmt: "num1", game: pget("blk"), pool: avg("blk") },
  tov: { key: "tov", label: "Turnovers", fmt: "num1", lowerBetter: true, game: pget("tov"), pool: avg("tov") },
  min: { key: "min", label: "Minutes", fmt: "num1", game: pget("min"), pool: avg("min") },
  fgm: { key: "fgm", label: "Field goals made", fmt: "num1", game: pget("fgm"), pool: avg("fgm") },
  fga: { key: "fga", label: "Field goals attempted", fmt: "num1", game: pget("fga"), pool: avg("fga") },
  fg3m: { key: "fg3m", label: "Threes made", fmt: "num1", game: pget("fg3m"), pool: avg("fg3m") },
  fg3a: { key: "fg3a", label: "Threes attempted", fmt: "num1", game: pget("fg3a"), pool: avg("fg3a") },
  fta: { key: "fta", label: "Free throws attempted", fmt: "num1", game: pget("fta"), pool: avg("fta") },
  fg_pct: {
    key: "fg_pct", label: "Field goal %", fmt: "pct1", game: pget("fg_pct"),
    pool: (gs) => ratio(sumOf(gs, (g) => pr(g, F.fgm)), sumOf(gs, (g) => pr(g, F.fga))),
  },
  fg3_pct: {
    key: "fg3_pct", label: "Three-point %", fmt: "pct1", game: pget("fg3_pct"),
    pool: (gs) => ratio(sumOf(gs, (g) => pr(g, F.fg3m)), sumOf(gs, (g) => pr(g, F.fg3a))),
  },
  ft_pct: {
    key: "ft_pct", label: "Free throw %", fmt: "pct1", game: pget("ft_pct"),
    pool: (gs) => ratio(sumOf(gs, (g) => pr(g, F.ftm)), sumOf(gs, (g) => pr(g, F.fta))),
  },
  efg: {
    key: "efg", label: "Effective FG%", fmt: "pct1", game: pget("efg"),
    pool: (gs) => ratio(sumOf(gs, (g) => pr(g, F.fgm) + 0.5 * pr(g, F.fg3m)), sumOf(gs, (g) => pr(g, F.fga))),
  },
  ts: {
    key: "ts", label: "True shooting %", fmt: "pct1", game: pget("ts"),
    pool: (gs) => ratio(sumOf(gs, (g) => pr(g, F.pts)), sumOf(gs, (g) => 2 * (pr(g, F.fga) + 0.44 * pr(g, F.fta)))),
  },
  ppp: {
    key: "ppp", label: "Points per possession used", fmt: "num2",
    game: (g) => ratio(pr(g, F.pts), pr(g, F.fga) + 0.44 * pr(g, F.fta) + pr(g, F.tov)),
    pool: (gs) => ratio(sumOf(gs, (g) => pr(g, F.pts)), sumOf(gs, (g) => pr(g, F.fga) + 0.44 * pr(g, F.fta) + pr(g, F.tov))),
  },
  fg3_rate: {
    key: "fg3_rate", label: "Three-point attempt rate", fmt: "pct1",
    game: (g) => ratio(pr(g, F.fg3a), pr(g, F.fga)),
    pool: (gs) => ratio(sumOf(gs, (g) => pr(g, F.fg3a)), sumOf(gs, (g) => pr(g, F.fga))),
  },
  ftr: {
    key: "ftr", label: "Free throw rate", fmt: "pct1",
    game: (g) => ratio(pr(g, F.fta), pr(g, F.fga)),
    pool: (gs) => ratio(sumOf(gs, (g) => pr(g, F.fta)), sumOf(gs, (g) => pr(g, F.fga))),
  },
  usg: {
    key: "usg", label: "Usage rate", fmt: "pct1", game: pget("usg"),
    pool: (gs) => weightedOf(gs, pget("usg"), minutes),
    note: "Usage is carried per game, so a set of games is weighted by minutes.",
  },
  ortg: {
    key: "ortg", label: "Offensive rating", fmt: "num1", game: pget("ortg"),
    pool: (gs) => weightedOf(gs, pget("ortg"), minutes),
    note: "Ratings are carried per game, so a set of games is weighted by minutes.",
  },
  drtg: {
    key: "drtg", label: "Defensive rating", fmt: "num1", lowerBetter: true, game: pget("drtg"),
    pool: (gs) => weightedOf(gs, pget("drtg"), minutes),
    note: "Ratings are carried per game, so a set of games is weighted by minutes.",
  },
};

/** Player Explorer columns and player stat card keys, as the lens stat each one is built from. */
export const PLAYER_LENS_FOR: Record<string, string> = {
  // Player Explorer (src/lib/players.ts keys)
  ppg: "pts",
  rpg: "reb",
  apg: "ast",
  spg: "stl",
  bpg: "blk",
  mpg: "min",
  tov_pg: "tov",
  orpg: "orb",
  fg_pct: "fg_pct",
  fg3_pct: "fg3_pct",
  ft_pct: "ft_pct",
  ts_pct: "ts",
  efg_pct: "efg",
  usg_pct: "usg",
  ppp: "ppp",
  // The site's player stat cards (src/lib/player-stat-cards.ts keys)
  pts: "pts",
  reb: "reb",
  orb: "orb",
  drb: "drb",
  ast: "ast",
  stl: "stl",
  blk: "blk",
  tov: "tov",
  fgm: "fgm",
  fga: "fga",
  fgm3: "fg3m",
  fga3: "fg3a",
  fta: "fta",
  usage_pct: "usg",
  ortg: "ortg",
  drtg: "drtg",
  tpar: "fg3_rate",
  ftr: "ftr",
};

export function formatLens(fmt: LensFmt, v: number | null): string {
  if (v == null || Number.isNaN(v)) return "–";
  switch (fmt) {
    case "pct1":
      return `${(v * 100).toFixed(1)}%`;
    case "num2":
      return v.toFixed(2);
    case "signed1":
      return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}`;
    default:
      return v.toFixed(1);
  }
}
