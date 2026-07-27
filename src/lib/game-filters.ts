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
  game_id: string;
  year: number;
  game_date: string | null;
  team_id: number;
  team_name: string;
  team_conference: string | null;
  opp_team_market: string | null;
  /** Bart conference code of the opponent; null when the opponent isn't D-I. */
  opp_conference: string | null;
  is_home: boolean | null;
  is_neutral: boolean | null;
  won: boolean;
  pts_scored: number | null;
  pts_against: number | null;
  pts_diff: number | null;
  poss: number | null;
  pace: number | null;
  // ---- count differentials, all own − opponent ----
  // The sign is NOT normalized per stat: "tov_diff < 0" means fewer turnovers
  // than the opponent (good), and "pf_diff < 0" fewer fouls. Every condition,
  // saved query and doc on the site is written against that reading.
  fg3_made_diff: number | null;
  fg3_att_diff: number | null;
  fg2_made_diff: number | null;
  fg2_att_diff: number | null;
  fg_made_diff: number | null;
  fg_att_diff: number | null;
  ft_made_diff: number | null;
  ft_att_diff: number | null;
  reb_diff: number | null;
  orb_diff: number | null;
  drb_diff: number | null;
  tov_diff: number | null;
  ast_diff: number | null;
  stl_diff: number | null;
  blk_diff: number | null;
  pf_diff: number | null;
  fbpts_diff: number | null;
  pitp_diff: number | null;
  pot_diff: number | null;
  /**
   * Second-chance points differential. The only stat with no CBBD box
   * equivalent — derived from play-by-play possession reconstruction, so it is
   * null for any season whose PBP hasn't been ingested.
   */
  scp_diff: number | null;
  fg3_pct: number | null;
  fg2_pct: number | null;
  ft_pct: number | null;
  efg_pct: number | null;
  ts_pct: number | null;
  // ---- opponent shooting ----
  fg3_pct_def: number | null;
  efg_pct_def: number | null;
  ts_pct_def: number | null;
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
 * don't have this stat".
 *
 * ast_diff / stl_diff / blk_diff / ft_att_diff / fg3_pct_def were pulled in
 * July 2026 because the old CBB Analytics game logs left them null in 100% of
 * rows. The logs are now built from CBBD's /games/teams box, which carries all
 * five, so they are back — verified populated on 12,049/12,051 rows for 2026.
 *
 * scp_diff is the one option here that can still be null for a whole season: it
 * has no box equivalent and is reconstructed from play-by-play, which is only
 * ingested for the seasons listed in scripts/build-second-chance.mjs.
 */
export const STAT_OPTIONS: StatOption[] = [
  // Scoring
  { key: "pts_diff",        label: "Pts Diff",        group: "Scoring" },
  { key: "pts_scored",      label: "Pts Scored",      group: "Scoring" },
  { key: "pts_against",     label: "Pts Allowed",     group: "Scoring", defaultDir: "lt" },
  // Diff stats
  { key: "fg_made_diff",    label: "FGM Diff",        group: "Differentials" },
  { key: "fg_att_diff",     label: "FGA Diff",        group: "Differentials" },
  { key: "fg3_made_diff",   label: "3PM Diff",        group: "Differentials" },
  { key: "fg3_att_diff",    label: "3PA Diff",        group: "Differentials" },
  { key: "fg2_made_diff",   label: "2PM Diff",        group: "Differentials" },
  { key: "fg2_att_diff",    label: "2PA Diff",        group: "Differentials" },
  { key: "ft_made_diff",    label: "FTM Diff",        group: "Differentials" },
  { key: "ft_att_diff",     label: "FTA Diff",        group: "Differentials" },
  { key: "reb_diff",        label: "REB Diff",        group: "Differentials" },
  { key: "orb_diff",        label: "OREB Diff",       group: "Differentials" },
  { key: "drb_diff",        label: "DREB Diff",       group: "Differentials" },
  { key: "tov_diff",        label: "TOV Diff",        group: "Differentials", defaultDir: "lt" },
  { key: "ast_diff",        label: "AST Diff",        group: "Differentials" },
  { key: "stl_diff",        label: "STL Diff",        group: "Differentials" },
  { key: "blk_diff",        label: "BLK Diff",        group: "Differentials" },
  { key: "pf_diff",         label: "Fouls Diff",      group: "Differentials", defaultDir: "lt" },
  { key: "fbpts_diff",      label: "FB Pts Diff",     group: "Differentials" },
  { key: "pitp_diff",       label: "Paint Pts Diff",  group: "Differentials" },
  { key: "pot_diff",        label: "Pts off TO Diff", group: "Differentials" },
  { key: "scp_diff",        label: "2nd-Chance Diff", group: "Differentials" },
  // Shooting (offense)
  { key: "fg3_pct",         label: "3P%",   group: "Shooting (off)" },
  { key: "fg2_pct",         label: "2P%",   group: "Shooting (off)" },
  { key: "ft_pct",          label: "FT%",   group: "Shooting (off)" },
  { key: "efg_pct",         label: "eFG%",  group: "Shooting (off)" },
  { key: "ts_pct",          label: "TS%",   group: "Shooting (off)" },
  // Shooting (defense)
  { key: "efg_pct_def",     label: "Opp eFG%", group: "Shooting (def)", defaultDir: "lt" },
  { key: "fg3_pct_def",     label: "Opp 3P%",  group: "Shooting (def)", defaultDir: "lt" },
  { key: "ts_pct_def",      label: "Opp TS%",  group: "Shooting (def)", defaultDir: "lt" },
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
  // postseason (NCAA/NIT) is deliberately not offered: as a combined flag it
  // couldn't isolate March Madness from the NIT, which made it more confusing
  // than useful. The data still ships in the sidecar (attachGameBox), so an
  // NCAA-only filter can come back once the export distinguishes the two.
  // Skip any BOX_FIELDS entry STAT_OPTIONS already covers. The two lists were
  // written independently and overlap on ft_att_diff, ast_diff, stl_diff and
  // blk_diff, so spreading both put each of those in the picker TWICE and React
  // logged a duplicate-key error on every /calc render. STAT_OPTIONS wins: its
  // copy is the curated one that carries the right defaultDir.
  ...BOX_FIELDS
    .filter((f) => f.key !== "postseason" && !STAT_OPTIONS.some((s) => s.key === f.key))
    .map((f) => ({
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
