import { PCT_KEYS, type PctKey } from "@/lib/player-cohort";
import type { PlayerSummary } from "@/lib/players";
import { teamStatColumn } from "@/lib/team-filters";
import type { Player } from "~/data/player-model";
import type { Team } from "~/data/team-model";
import type { Feature, Profile } from "./similar-model";

/**
 * What "similar" can mean: the stats each profile compares, and how much each
 * counts. The team stats are the site explorer's own row (src/lib/team-filters.ts);
 * the player stats are the site's player summary.
 *
 * RATINGS WEIGH MOST in the profiles that carry them, because a team's adjusted
 * offense says more about what it was than any one of the four factors
 * underneath it does. Style leaves them out on purpose: two teams can play alike
 * at very different levels.
 *
 * THE WEIGHTS ARE MEASURED, not only chosen (scripts/tune-similar.mts,
 * 2026-09-14): searched on the even seasons' split halves, and kept because they
 * held on the odd seasons, which the search never saw. They favor what stays true
 * of a team or player across a season (adjusted ratings, shot diet, role) over
 * what swings from game to game (opponent 3P%, free throw %, a short run of TS%).
 * Rim rate, height and EPM are not in a half, so they keep the weights they were
 * given. Team profiles then share weight among stats that echo one another
 * (sharedWeights); player profiles do not, which measured worse.
 */

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function team(key: string, label: string, weight: number, more: string, less: string): Feature<Team> {
  return {
    key,
    label,
    weight,
    more,
    less,
    pct: teamStatColumn(key)?.format === "pct1",
    digits: 1,
    get: (t) => num((t.explorer as unknown as Record<string, unknown> | null)?.[key]),
  };
}

const T = {
  adjO: team("a_ortg", "Adj O", 2, "better offense", "weaker offense"),
  adjD: team("a_drtg", "Adj D", 2, "weaker defense", "better defense"),
  tempo: team("adjt", "Tempo", 1, "faster", "slower"),
  efg: team("cbb_efg", "eFG%", 1, "better shooting", "worse shooting"),
  tov: team("cbb_tov", "TOV%", 1, "more turnovers", "fewer turnovers"),
  orb: team("cbb_orb", "OREB%", 1, "more offensive boards", "fewer offensive boards"),
  ftr: team("cbb_ftarate", "FT rate", 0.75, "gets to the line more", "gets to the line less"),
  threes: team("cbb_fg3rate", "3PA rate", 1, "more threes", "fewer threes"),
  ft: team("cbb_ft", "FT%", 0.5, "better at the line", "worse at the line"),
  ast: team("cbb_ast", "AST%", 0.75, "more assisted", "less assisted"),
  rim: team("cbb_rim_rate", "Rim rate", 1, "more at the rim", "less at the rim"),
  height: team("eff_height", "Eff height", 1, "taller", "shorter"),
  efgD: team("cbb_efg_def", "Opp eFG%", 1, "allows better shooting", "allows worse shooting"),
  tovD: team("cbb_tov_def", "Opp TOV%", 0.75, "forces more turnovers", "forces fewer turnovers"),
  orbD: team("cbb_orb_def", "Opp OREB%", 0.75, "allows more boards", "allows fewer boards"),
  fg3D: team("cbb_fg3_def", "Opp 3P%", 0.75, "allows better three shooting", "allows worse three shooting"),
  blk: team("cbb_blk_pct", "BLK%", 0.75, "blocks more", "blocks less"),
  stl: team("cbb_stl_pct", "STL%", 0.75, "steals more", "steals less"),
};

const weighted = <R>(f: Feature<R>, weight: number): Feature<R> => ({ ...f, weight });

export const TEAM_PROFILES: Profile<Team>[] = [
  {
    key: "overall",
    label: "Overall",
    desc: "How good, and how: both adjusted ratings, tempo and the four factors at each end",
    features: [
      weighted(T.adjO, 2.5),
      weighted(T.adjD, 1.5),
      T.tempo,
      weighted(T.efg, 0.5),
      weighted(T.tov, 0.75),
      weighted(T.orb, 1.25),
      T.ftr,
      weighted(T.threes, 1.5),
      weighted(T.efgD, 0.5),
      T.tovD,
      weighted(T.orbD, 0.56),
    ],
  },
  {
    key: "style",
    label: "Style",
    desc: "How a team plays, whatever its level: pace, shot diet, sharing, the glass and size",
    features: [
      weighted(T.tempo, 1.13),
      weighted(T.threes, 1.88),
      T.rim,
      weighted(T.ftr, 0.5),
      weighted(T.ast, 1.13),
      weighted(T.orb, 1.5),
      weighted(T.tov, 0.75),
      weighted(T.tovD, 1),
      weighted(T.orbD, 0.56),
      T.height,
    ],
  },
  {
    key: "offense",
    label: "Offense",
    desc: "Adjusted offense and the shooting, ball security, offensive boards and free throws under it",
    features: [weighted(T.adjO, 2.5), weighted(T.efg, 0.75), T.tov, T.orb, weighted(T.ftr, 0.5), weighted(T.threes, 2), weighted(T.ft, 0.63), weighted(T.ast, 1.13)],
  },
  {
    key: "defense",
    label: "Defense",
    desc: "Adjusted defense and what it allows: shooting, turnovers forced, the defensive glass, blocks and steals",
    // Opponent 3P% is mostly luck from one half of a season to the other, and weighs least.
    features: [weighted(T.adjD, 4), weighted(T.efgD, 1.13), weighted(T.tovD, 1), weighted(T.orbD, 0.5), weighted(T.fg3D, 0.38), weighted(T.blk, 0.94), weighted(T.stl, 0.94)],
  },
];

export const teamPct = (t: Team, key: string): number | null => t.explorer?.pct[key] ?? null;

/** Height as the summary spells it ("6-8"), in inches. */
function inches(h: string | null): number | null {
  if (!h) return null;
  const m = /^(\d)\D+(\d{1,2})/.exec(h);
  if (m) return Number(m[1]) * 12 + Number(m[2]);
  const n = Number(h);
  return Number.isFinite(n) && n > 48 ? n : null;
}

/**
 * The attempts under a player's rates, for easing a rate on few of them. The
 * summary carries rates rather than counts, so they are rebuilt: true-shooting
 * attempts are points over twice TS%, and field goal and free throw attempts
 * follow from the free-throw rate.
 */
const seasonTotal = (p: Player, perGame: number | null): number | null => {
  const g = num(p.s.games);
  return perGame != null && g != null ? perGame * g : null;
};
const tsAttempts = (p: Player): number | null => {
  const pts = seasonTotal(p, num(p.s.pts_pg));
  const ts = num(p.s.ts_pct);
  return pts != null && ts != null && ts > 0 ? pts / (2 * ts) : null;
};
const fgAttempts = (p: Player): number | null => {
  const tsa = tsAttempts(p);
  return tsa != null ? tsa / (1 + 0.44 * (num(p.s.fta_rate) ?? 0)) : null;
};
const ftAttempts = (p: Player): number | null => {
  const fga = fgAttempts(p);
  const rate = num(p.s.fta_rate);
  return fga != null && rate != null ? fga * rate : null;
};
/** Possessions a player ended: true-shooting attempts and turnovers. */
const usedPossessions = (p: Player): number | null => {
  const tsa = tsAttempts(p);
  return tsa != null ? tsa + (seasonTotal(p, num(p.s.tov_pg)) ?? 0) : null;
};
/** Possessions on the floor, roughly, at about 68 a game: usage is a share of them. */
const floorPossessions = (p: Player): number | null => {
  const min = seasonTotal(p, num(p.s.min_pg));
  return min != null ? min * 1.7 : null;
};

function player(
  field: keyof PlayerSummary,
  label: string,
  weight: number,
  more: string,
  less: string,
  pct = false,
  n?: (p: Player) => number | null,
): Feature<Player> {
  return { key: field as string, label, weight, more, less, pct, digits: 1, get: (p) => num(p.s[field]), n };
}

const P = {
  epm: player("epm", "EPM", 1.5, "more impact", "less impact"),
  offEpm: player("off_epm", "Off EPM", 1.5, "more offensive impact", "less offensive impact"),
  defEpm: player("def_epm", "Def EPM", 1.5, "more defensive impact", "less defensive impact"),
  boxEpm: player("box_epm", "Box EPM", 1, "a stronger box score", "a weaker box score"),
  usage: player("usage_pct", "USG%", 1.25, "a bigger role", "a smaller role", true, floorPossessions),
  ts: player("ts_pct", "TS%", 1, "more efficient", "less efficient", true, tsAttempts),
  pts: player("pts_pg", "PPG", 1, "scores more", "scores less"),
  reb: player("reb_pg", "RPG", 1, "rebounds more", "rebounds less"),
  orb: player("orb_pg", "OREB", 0.75, "more offensive boards", "fewer offensive boards"),
  ast: player("ast_pg", "APG", 1, "passes more", "passes less"),
  stl: player("stl_pg", "SPG", 0.5, "steals more", "steals less"),
  blk: player("blk_pg", "BPG", 0.75, "blocks more", "blocks less"),
  tov: player("tov_pct", "TOV%", 0.5, "turns it over more", "turns it over less", true, usedPossessions),
  ftr: player("fta_rate", "FT rate", 0.5, "gets to the line more", "gets to the line less", true, fgAttempts),
  threes: player("tp_rate", "3PT rate", 0.75, "shoots more threes", "shoots fewer threes", false, fgAttempts),
  rim: player("rim_rate", "Rim rate", 1, "more at the rim", "less at the rim", false, fgAttempts),
  fg3: player("fg3_pct", "3P%", 0.75, "a better shooter", "a worse shooter", true, (p) => num(p.s.fg3_att)),
  ft: player("ft_pct", "FT%", 0.5, "better at the line", "worse at the line", true, ftAttempts),
  minutes: player("min_pg", "MPG", 0.75, "plays more", "plays less"),
  height: { key: "height", label: "Height", weight: 0.75, more: "taller", less: "shorter", digits: 0, get: (p) => inches(p.s.height) } satisfies Feature<Player>,
};

export const PLAYER_PROFILES: Profile<Player>[] = [
  {
    key: "overall",
    label: "Overall",
    desc: "Impact, role, efficiency and the box score, with size and minutes",
    features: [
      P.epm,
      weighted(P.usage, 1.88),
      weighted(P.ts, 0.5),
      weighted(P.pts, 0.5),
      weighted(P.reb, 0.75),
      weighted(P.ast, 1.25),
      weighted(P.stl, 0.25),
      P.blk,
      weighted(P.tov, 0.25),
      weighted(P.ftr, 0.25),
      weighted(P.threes, 1.5),
      weighted(P.minutes, 1.5),
      P.height,
    ],
  },
  {
    key: "role",
    label: "Role",
    desc: "What a player does, whatever his level: usage, passing, the glass, rim protection, shot diet and size",
    features: [
      weighted(P.usage, 1.5),
      weighted(P.ast, 1.56),
      weighted(P.reb, 2),
      P.orb,
      weighted(P.blk, 1),
      weighted(P.stl, 0.38),
      weighted(P.threes, 2.5),
      P.rim,
      weighted(P.ftr, 0.38),
      weighted(P.height, 1.25),
    ],
  },
  {
    key: "scoring",
    label: "Scoring",
    desc: "How much he scores and how: volume, efficiency, where the shots come from and the line",
    features: [
      weighted(P.pts, 3),
      weighted(P.usage, 2),
      weighted(P.ts, 0.94),
      weighted(P.fg3, 0.38),
      weighted(P.threes, 2),
      weighted(P.rim, 0.75),
      weighted(P.ftr, 0.75),
      weighted(P.ft, 0.25),
    ],
  },
  {
    key: "impact",
    label: "Impact",
    desc: "EPM and its offensive and defensive halves, with the box-score estimate beside them",
    features: [weighted(P.epm, 2), P.offEpm, P.defEpm, P.boxEpm, weighted(P.usage, 0.5)],
  },
];

export const playerPct = (p: Player, key: string): number | null =>
  (PCT_KEYS as readonly string[]).includes(key) ? (p.pct[key as PctKey] ?? null) : null;

const unique = <R>(profiles: Profile<R>[]): Feature<R>[] => {
  const seen = new Map<string, Feature<R>>();
  for (const p of profiles) for (const f of p.features) if (!seen.has(f.key)) seen.set(f.key, f);
  return [...seen.values()];
};

/** Every stat any profile reads, for scaling the seasons once. */
export const TEAM_FEATURES = unique(TEAM_PROFILES);
export const PLAYER_FEATURES = unique(PLAYER_PROFILES);
