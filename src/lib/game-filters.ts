/**
 * Shared game-filter primitives used by /calc (cross-team "if these things
 * happen, how often do they win?") and the team-page "Find a game" modal
 * (single-team variant). Mirrors the per-game JSON shape served from
 * /data/game-logs-by-year/<year>.json.
 *
 * Keeping types + STAT_OPTIONS + matches() here lets both surfaces stay in
 * sync — add a stat to STAT_OPTIONS once and it shows up everywhere.
 */

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
};

export type Op = "gt" | "gte" | "lt" | "lte" | "eq";
export type Filter = { id: string; stat: keyof GameLog; op: Op; value: number };

export type StatOption = {
  key: keyof GameLog;
  label: string;
  group: string;
  defaultDir?: "gt" | "lt";
};

export const STAT_OPTIONS: StatOption[] = [
  // Scoring margin
  { key: "pts_diff",        label: "Pts Diff",        group: "Margin" },
  // Diff stats
  { key: "fg3_made_diff",   label: "3PM Diff",        group: "Differentials" },
  { key: "fg3_att_diff",    label: "3PA Diff",        group: "Differentials" },
  { key: "fg2_made_diff",   label: "2PM Diff",        group: "Differentials" },
  { key: "ft_made_diff",    label: "FTM Diff",        group: "Differentials" },
  { key: "reb_diff",        label: "REB Diff",        group: "Differentials" },
  { key: "orb_diff",        label: "OREB Diff",       group: "Differentials" },
  { key: "drb_diff",        label: "DREB Diff",       group: "Differentials" },
  { key: "tov_diff",        label: "TOV Diff",        group: "Differentials", defaultDir: "lt" },
  { key: "ast_diff",        label: "AST Diff",        group: "Differentials" },
  { key: "stl_diff",        label: "STL Diff",        group: "Differentials" },
  { key: "blk_diff",        label: "BLK Diff",        group: "Differentials" },
  { key: "fbpts_diff",      label: "FB Pts Diff",     group: "Differentials" },
  { key: "pitp_diff",       label: "Paint Pts Diff",  group: "Differentials" },
  { key: "scp_diff",        label: "2nd-Chance Diff", group: "Differentials" },
  // Shooting (offense)
  { key: "fg3_pct",         label: "3P%",   group: "Shooting (off)" },
  { key: "fg2_pct",         label: "2P%",   group: "Shooting (off)" },
  { key: "ft_pct",          label: "FT%",   group: "Shooting (off)" },
  { key: "efg_pct",         label: "eFG%",  group: "Shooting (off)" },
  { key: "ts_pct",          label: "TS%",   group: "Shooting (off)" },
  // Pace
  { key: "poss",            label: "Possessions", group: "Pace" },
  { key: "pace",            label: "Pace",        group: "Pace" },
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
