/**
 * Shared game-filter primitives used by /calc (cross-team "if these things
 * happen, how often do they win?") and the team-page "Find a game" modal
 * (single-team variant). Mirrors the per-game JSON shape served from
 * /data/game-logs-by-year/<year>.json.
 *
 * Keeping types + STAT_OPTIONS + matches() here lets both surfaces stay in
 * sync — add a stat to STAT_OPTIONS once and it shows up everywhere.
 */

import { BOX_FIELDS } from "@/lib/game-box";

export type GameLog = {
  cbba_game_id: string;
  year: number;
  game_date: string | null;
  team_id: number;
  team_name: string;
  team_conference: string | null;
  opp_team_market: string | null;
  is_home: boolean | null;
  is_neutral: boolean | null;
  won: boolean;
  pts_scored: number | null;
  pts_against: number | null;
  pts_diff: number | null;
  poss: number | null;
  pace: number | null;
  fg3_made_diff: number | null;
  fg3_att_diff: number | null;
  fg2_made_diff: number | null;
  fg_made_diff: number | null;
  ft_made_diff: number | null;
  reb_diff: number | null;
  orb_diff: number | null;
  drb_diff: number | null;
  tov_diff: number | null;
  ast_diff: number | null;
  stl_diff: number | null;
  blk_diff: number | null;
  fbpts_diff: number | null;
  pitp_diff: number | null;
  scp_diff: number | null;
  fg3_pct: number | null;
  fg2_pct: number | null;
  ft_pct: number | null;
  efg_pct: number | null;
  ts_pct: number | null;
  // Opponent shooting — the only defensive rate the game logs actually carry.
  // (fg3_pct_def exists as a key in the JSON but is null in every season, so
  // it is deliberately NOT surfaced as a filter — see STAT_OPTIONS note.)
  efg_pct_def: number | null;
  // ---- enriched client-side, NOT present in the raw JSON ----
  // Attached by /calc from team-ratings-<year>.json (see src/lib/quad.ts).
  // Anything consuming raw game logs without that enrichment will see these
  // undefined, which is why they live in CALC_STAT_OPTIONS rather than the
  // shared STAT_OPTIONS list.
  opp_rank?: number | null;
  quad?: 1 | 2 | 3 | 4;
  /** True when the opponent is not a D1 team (no paired row in the logs). */
  non_d1?: boolean;
  /**
   * Box-derived fields merged from the game-box sidecar (see src/lib/game-box.ts).
   * Declared as an index signature rather than 27 explicit optional keys to
   * avoid a circular import with game-box.ts, which needs this type.
   */
  [boxKey: string]: string | number | boolean | null | undefined;
};

export type Op = "gt" | "gte" | "lt" | "lte" | "eq";
export type Filter = { id: string; stat: keyof GameLog; op: Op; value: number };

export type StatOption = {
  key: keyof GameLog;
  label: string;
  group: string;
  defaultDir?: "gt" | "lt";
};

/**
 * Filterable game-log stats.
 *
 * IMPORTANT — only list keys that are actually populated. `matches()` returns
 * false for a non-number, so a column that is null in the data silently yields
 * "0 games", which reads to a user as "this never happened" rather than "we
 * don't have this stat". Four options were removed in July 2026 for exactly
 * that reason — ast_diff, stl_diff, blk_diff and ft_att_diff are null in 100%
 * of rows across every season (2014-2026). CBBD's /games/teams box carries real
 * assists/steals/blocks/FTA, so they can come back once that source is joined
 * into the export.
 *
 * Same rule killed fg3_pct_def (null everywhere); efg_pct_def is real and is
 * the one defensive rate we can offer today.
 */
export const STAT_OPTIONS: StatOption[] = [
  // Scoring
  { key: "pts_diff",        label: "Pts Diff",        group: "Scoring" },
  { key: "pts_scored",      label: "Pts Scored",      group: "Scoring" },
  { key: "pts_against",     label: "Pts Allowed",     group: "Scoring", defaultDir: "lt" },
  // Diff stats
  { key: "fg_made_diff",    label: "FGM Diff",        group: "Differentials" },
  { key: "fg3_made_diff",   label: "3PM Diff",        group: "Differentials" },
  { key: "fg3_att_diff",    label: "3PA Diff",        group: "Differentials" },
  { key: "fg2_made_diff",   label: "2PM Diff",        group: "Differentials" },
  { key: "ft_made_diff",    label: "FTM Diff",        group: "Differentials" },
  { key: "reb_diff",        label: "REB Diff",        group: "Differentials" },
  { key: "orb_diff",        label: "OREB Diff",       group: "Differentials" },
  { key: "drb_diff",        label: "DREB Diff",       group: "Differentials" },
  { key: "tov_diff",        label: "TOV Diff",        group: "Differentials", defaultDir: "lt" },
  { key: "fbpts_diff",      label: "FB Pts Diff",     group: "Differentials" },
  { key: "pitp_diff",       label: "Paint Pts Diff",  group: "Differentials" },
  { key: "scp_diff",        label: "2nd-Chance Diff", group: "Differentials" },
  // Shooting (offense)
  { key: "fg3_pct",         label: "3P%",   group: "Shooting (off)" },
  { key: "fg2_pct",         label: "2P%",   group: "Shooting (off)" },
  { key: "ft_pct",          label: "FT%",   group: "Shooting (off)" },
  { key: "efg_pct",         label: "eFG%",  group: "Shooting (off)" },
  { key: "ts_pct",          label: "TS%",   group: "Shooting (off)" },
  // Shooting (defense)
  { key: "efg_pct_def",     label: "Opp eFG%", group: "Shooting (def)", defaultDir: "lt" },
  // Pace
  { key: "poss",            label: "Possessions", group: "Pace" },
  { key: "pace",            label: "Pace",        group: "Pace" },
];

/**
 * /calc-only additions. These depend on the opponent-rank enrichment in
 * src/lib/quad.ts, so they must NOT go in STAT_OPTIONS — the team/coach
 * "Find a game" modal reads raw logs and would render them as dead options
 * (always-null → silently 0 results).
 */
export const CALC_STAT_OPTIONS: StatOption[] = [
  ...STAT_OPTIONS,
  { key: "opp_rank", label: "Opp Rank", group: "Opponent", defaultDir: "lt" },
  ...BOX_FIELDS.map((f) => ({
    key: f.key as keyof GameLog,
    label: f.label,
    group: f.group,
    ...("lower" in f && f.lower ? { defaultDir: "lt" as const } : {}),
  })),
];

export const OPS: Array<{ value: Op; label: string }> = [
  { value: "gt",  label: ">" },
  { value: "gte", label: "≥" },
  { value: "lt",  label: "<" },
  { value: "lte", label: "≤" },
  { value: "eq",  label: "=" },
];

export function makeFilter(stat: keyof GameLog = "tov_diff"): Filter {
  const def = STAT_OPTIONS.find((s) => s.key === stat);
  return {
    id: Math.random().toString(36).slice(2, 9),
    stat,
    op: def?.defaultDir === "lt" ? "lt" : "gt",
    value: 0,
  };
}

export function matches(g: GameLog, f: Filter): boolean {
  const v = g[f.stat];
  if (typeof v !== "number") return false;
  switch (f.op) {
    case "gt":  return v >  f.value;
    case "gte": return v >= f.value;
    case "lt":  return v <  f.value;
    case "lte": return v <= f.value;
    case "eq":  return v === f.value;
  }
}

// Module-scoped cache for /data/game-logs-by-year/<year>.json — shared
// between /calc and the team-page "Find a game" modal so users who hit one
// surface don't re-pay the cost on the other.
const yearCache = new Map<number, Promise<GameLog[]>>();
export function loadGamesForYear(year: number): Promise<GameLog[]> {
  const hit = yearCache.get(year);
  if (hit) return hit;
  const p = fetch(`/data/game-logs-by-year/${year}.json`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .catch(() => [] as GameLog[]);
  yearCache.set(year, p);
  return p;
}
