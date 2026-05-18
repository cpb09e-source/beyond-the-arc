/**
 * Shared filter spec for the team explorer. Used by both the URL-state
 * client component and the server-side Supabase query builder.
 *
 * Stats come from two sources, joined on team_id:
 *   - team_trank_stats  (Bart Torvik T-Rank)
 *   - team_cbba_stats   (CBB Analytics season aggregates)
 */

export type StatSource = "trank" | "cbba" | "derived";

export type StatGroup = "overall" | "scoring" | "defense" | "diffs" | "misc";

export type TeamStatColumn = {
  key: string;             // URL-safe key, used everywhere
  source: StatSource;      // "derived" = computed in JS, not a DB column
  dbColumn: string;        // DB column on that table; empty for derived
  label: string;
  desc: string;
  format?: "pct1" | "pct0" | "num1" | "num2" | "num3" | "rank";
  group: StatGroup;
  hideInFilter?: boolean;  // true = available as a sort/data key but hidden from the filter UI
};

// Columns are grouped into basketball-meaningful sections (Overall / Scoring /
// Defense / Differentials / Misc) for the searchable filter dropdown.
// `hideInFilter: true` keeps a column wired internally (sort key, # column)
// without exposing it in the user-facing filter UI.
export const TEAM_STAT_COLUMNS: TeamStatColumn[] = [
  // ── Overall ──────────────────────────────────────────────
  { key: "rank",       source: "trank",   dbColumn: "rank",    label: "BTA RTG",     desc: "Bart's overall ranking (we surface BTA RTG score elsewhere; this is the per-season rank position)", format: "rank", group: "overall", hideInFilter: true },
  { key: "bta_rtg",    source: "derived", dbColumn: "",        label: "BTA RTG",     desc: "Weighted z-score composite (Bart adj ORtg/DRtg + CBB adj ORtg/DRtg + SoS), scaled ×40. ~0 = average D-I team, +75 = elite, +100 = generational.", format: "num1", group: "overall" },
  { key: "bta_net",    source: "derived", dbColumn: "",        label: "Adj Net Rtg", desc: "Adj ORtg − Adj DRtg. Point differential per 100 possessions vs an average D-I opponent on a neutral floor.",                                                                                                              format: "num1", group: "overall" },
  { key: "bta_ortg",   source: "derived", dbColumn: "",        label: "Adj ORtg",    desc: "Average of Bart adj ORtg and CBB adj ORtg",                                                                                                                                                                                       format: "num1", group: "overall" },
  { key: "bta_drtg",   source: "derived", dbColumn: "",        label: "Adj DRtg",    desc: "Average of Bart adj DRtg and CBB adj DRtg",                                                                                                                                                                                       format: "num1", group: "overall" },
  { key: "adjt",       source: "trank",   dbColumn: "adjt",    label: "Adj Tempo",   desc: "Adjusted possessions / 40 min",                                                                                                                                                                                                   format: "num1", group: "overall" },
  { key: "wins",       source: "trank",   dbColumn: "wins",    label: "Wins",        desc: "Season wins",                                                                                                                                                                                                                     format: "num1", group: "overall" },
  { key: "losses",     source: "trank",   dbColumn: "losses",  label: "Losses",      desc: "Season losses",                                                                                                                                                                                                                   format: "num1", group: "overall" },
  { key: "wab",        source: "trank",   dbColumn: "wab",     label: "WAB",         desc: "Wins above bubble",                                                                                                                                                                                                               format: "num1", group: "overall" },
  { key: "sos",        source: "trank",   dbColumn: "sos",     label: "SoS",         desc: "Strength of schedule",                                                                                                                                                                                                            format: "pct1", group: "overall" },
  { key: "ncsos",      source: "trank",   dbColumn: "ncsos",   label: "NC SoS",      desc: "Non-conference SoS",                                                                                                                                                                                                              format: "pct1", group: "overall" },
  { key: "consos",     source: "trank",   dbColumn: "consos",  label: "Conf SoS",    desc: "Conference SoS",                                                                                                                                                                                                                  format: "pct1", group: "overall" },

  // ── Scoring (offense) ────────────────────────────────────
  { key: "cbb_ts",       source: "cbba", dbColumn: "ts_pct",     label: "TS%",        desc: "True shooting %",                  format: "pct1", group: "scoring" },
  { key: "cbb_efg",      source: "cbba", dbColumn: "efg_pct",    label: "eFG%",       desc: "Effective FG%",                    format: "pct1", group: "scoring" },
  { key: "cbb_fg3",      source: "cbba", dbColumn: "fg3_pct",    label: "3P%",        desc: "3-point %",                        format: "pct1", group: "scoring" },
  { key: "cbb_fg3rate",  source: "cbba", dbColumn: "fg3a_rate",  label: "3PA Rate",   desc: "3PA / FGA (3-point reliance)",      format: "pct1", group: "scoring" },
  { key: "cbb_ftarate",  source: "cbba", dbColumn: "fta_rate",   label: "FTA Rate",   desc: "Free-throws attempted / FGA",      format: "pct1", group: "scoring" },
  { key: "cbb_orb",      source: "cbba", dbColumn: "orb_pct",    label: "OREB%",      desc: "Offensive rebound %",              format: "pct1", group: "scoring" },
  { key: "cbb_tov",      source: "cbba", dbColumn: "tov_pct",    label: "TOV%",       desc: "Turnover %",                       format: "pct1", group: "scoring" },
  { key: "cbb_ast",      source: "cbba", dbColumn: "ast_pct",    label: "AST%",       desc: "% of made FGs assisted",            format: "pct1", group: "scoring" },
  { key: "cbb_fbpts",    source: "cbba", dbColumn: "fbpts_pct",  label: "FB Pts %",   desc: "Fast-break points / total pts",     format: "pct1", group: "scoring" },
  { key: "cbb_pitp",     source: "cbba", dbColumn: "pitp_pct",   label: "Paint Pts %", desc: "Paint points / total pts",          format: "pct1", group: "scoring" },
  { key: "cbb_ortg",     source: "cbba", dbColumn: "ortg",       label: "ORtg (raw)",  desc: "CBB raw offensive rating",         format: "num1", group: "scoring" },

  // ── Defense (allowed) ────────────────────────────────────
  { key: "cbb_efg_def", source: "cbba", dbColumn: "efg_pct_def", label: "Opp eFG%",   desc: "Opponent eFG%",                 format: "pct1", group: "defense" },
  { key: "cbb_tov_def", source: "cbba", dbColumn: "tov_pct_def", label: "Opp TOV%",   desc: "Opponent TOV% (forced)",        format: "pct1", group: "defense" },
  { key: "cbb_orb_def", source: "cbba", dbColumn: "orb_pct_def", label: "Opp OREB%",  desc: "Opponent OREB% (allowed)",      format: "pct1", group: "defense" },
  { key: "cbb_fg3_def", source: "cbba", dbColumn: "fg3_pct_def", label: "Opp 3P%",    desc: "Opponent 3-point %",            format: "pct1", group: "defense" },
  { key: "cbb_drtg",    source: "cbba", dbColumn: "drtg",        label: "DRtg (raw)", desc: "CBB raw defensive rating",      format: "num1", group: "defense" },

  // ── Differentials (you vs opponent) ──────────────────────
  // Percentage-point diffs
  { key: "efg_diff",   source: "derived", dbColumn: "", label: "eFG% Diff",    desc: "eFG% − Opp eFG% (shooting margin)",                       format: "pct1", group: "diffs" },
  { key: "tov_diff",   source: "derived", dbColumn: "", label: "TOV% Diff",    desc: "Opp TOV% − your TOV% (+ = forcing more)",                  format: "pct1", group: "diffs" },
  { key: "orb_diff",   source: "derived", dbColumn: "", label: "OREB% Diff",   desc: "OREB% − Opp OREB% (offensive-board battle)",               format: "pct1", group: "diffs" },
  { key: "fg3_diff",   source: "derived", dbColumn: "", label: "3P% Diff",     desc: "3P% − Opp 3P% (computed from raw 3PT counts)",             format: "pct1", group: "diffs" },
  { key: "fta_diff",   source: "derived", dbColumn: "", label: "FTA% Diff",    desc: "FTA Rate − Opp FTA Rate (free-throw drawing edge)",        format: "pct1", group: "diffs" },
  // Count diffs (CBB ready-made; populated after migration 003 + sync)
  { key: "fg3m_diff_ct", source: "cbba", dbColumn: "fg3_made_diff",  label: "3PM Diff",     desc: "3-pointers made − allowed (season total)",   format: "num1", group: "diffs" },
  { key: "fg3a_diff_ct", source: "cbba", dbColumn: "fg3_att_diff",   label: "3PA Diff",     desc: "3-point attempts − allowed",                 format: "num1", group: "diffs" },
  { key: "fg2m_diff_ct", source: "cbba", dbColumn: "fg2_made_diff",  label: "2PM Diff",     desc: "2-pointers made − allowed",                  format: "num1", group: "diffs" },
  { key: "fgm_diff_ct",  source: "cbba", dbColumn: "fg_made_diff",   label: "FGM Diff",     desc: "Field goals made − allowed",                 format: "num1", group: "diffs" },
  { key: "ftm_diff_ct",  source: "cbba", dbColumn: "ft_made_diff",   label: "FTM Diff",     desc: "Free throws made − allowed",                 format: "num1", group: "diffs" },
  { key: "orb_diff_ct",  source: "cbba", dbColumn: "orb_diff_ct",    label: "OREB Diff",    desc: "Offensive rebounds − opp OREB",              format: "num1", group: "diffs" },
  { key: "drb_diff_ct",  source: "cbba", dbColumn: "drb_diff",       label: "DREB Diff",    desc: "Defensive rebounds − opp DREB",              format: "num1", group: "diffs" },
  { key: "reb_diff_ct",  source: "cbba", dbColumn: "reb_diff",       label: "REB Diff",     desc: "Total rebounds − opp REB",                   format: "num1", group: "diffs" },
  { key: "tov_diff_ct",  source: "cbba", dbColumn: "tov_diff_ct",    label: "TOV Diff",     desc: "Turnovers − opp TOV (negative = good)",      format: "num1", group: "diffs" },
  { key: "fbpts_diff",   source: "cbba", dbColumn: "fbpts_diff",     label: "FB Pts Diff",  desc: "Fast-break points − allowed",                format: "num1", group: "diffs" },
  { key: "pitp_diff",    source: "cbba", dbColumn: "pitp_diff",      label: "Paint Pts Diff", desc: "Points in the paint − allowed",            format: "num1", group: "diffs" },
  { key: "pts_diff",     source: "cbba", dbColumn: "pts_diff",       label: "Pts Diff",     desc: "Total points scored − allowed (season)",     format: "num1", group: "diffs" },
  { key: "scp_diff",     source: "cbba", dbColumn: "scp_diff",       label: "2nd-Chance Diff", desc: "Second-chance points − allowed",          format: "num1", group: "diffs" },

  // ── Misc (pace, raw net) ─────────────────────────────────
  { key: "cbb_pace",     source: "cbba", dbColumn: "pace",     label: "Pace",       desc: "CBB raw pace",         format: "num1", group: "misc" },
  { key: "cbb_pace_adj", source: "cbba", dbColumn: "pace_adj", label: "Pace (adj)", desc: "CBB adjusted pace",    format: "num1", group: "misc" },
  { key: "cbb_net",      source: "cbba", dbColumn: "net_rtg",  label: "Net (raw)",  desc: "CBB raw net rating",   format: "num1", group: "misc" },
];

export const GROUP_LABEL: Record<StatGroup, string> = {
  overall: "Overall",
  scoring: "Scoring",
  defense: "Defense",
  diffs: "Differentials",
  misc: "Misc",
};

// Filtered down to columns that appear in user-facing filter / sort dropdowns.
export const FILTER_COLUMNS = TEAM_STAT_COLUMNS.filter((c) => !c.hideInFilter);

export type TeamStatKey = (typeof TEAM_STAT_COLUMNS)[number]["key"];
export type Comparator = "gt" | "gte" | "lt" | "lte";

export type StatFilter = { stat: TeamStatKey; op: Comparator; value: number };

export type TeamFilterSpec = {
  years: number[];              // multi-select; any combination of seasons
  conf: string | null;
  filters: StatFilter[];
  sortBy: TeamStatKey;
  sortDir: "asc" | "desc";
  limit: number;                // -1 = show all
};

export const ALL_YEARS = [
  2026, 2025, 2024, 2023, 2022, 2021,
  2020, 2019, 2018, 2017, 2016, 2015, 2014, 2013,
] as const;

export const DEFAULT_SPEC: TeamFilterSpec = {
  years: [2026],                // current season only by default
  conf: null,
  filters: [],
  sortBy: "bta_rtg",
  sortDir: "desc",
  limit: 50,
};

export const LIMIT_OPTIONS = [50, 100, 250, 500, -1] as const;
export function limitLabel(n: number): string {
  return n === -1 ? "Show all" : String(n);
}

const COLUMN_BY_KEY = new Map(TEAM_STAT_COLUMNS.map((c) => [c.key, c]));
function isStatKey(s: string | undefined): s is TeamStatKey {
  return !!s && COLUMN_BY_KEY.has(s);
}
function isComparator(s: string): s is Comparator {
  return s === "gt" || s === "gte" || s === "lt" || s === "lte";
}
function clampYear(y: number): number {
  if (!Number.isFinite(y)) return DEFAULT_SPEC.years[0]!;
  return Math.max(2013, Math.min(2026, Math.trunc(y)));
}

// ---------- URL <-> spec ----------
export function specToParams(spec: TeamFilterSpec): URLSearchParams {
  const p = new URLSearchParams();
  // Years: comma-separated. Omit when default (just current season).
  if (
    spec.years.length !== DEFAULT_SPEC.years.length ||
    spec.years.some((y, i) => y !== DEFAULT_SPEC.years[i])
  ) {
    p.set("ys", spec.years.join(","));
  }
  if (spec.conf) p.set("conf", spec.conf);
  spec.filters.forEach((f, i) => p.set(`f${i}`, `${f.stat}.${f.op}.${f.value}`));
  if (spec.sortBy !== DEFAULT_SPEC.sortBy) p.set("sort", spec.sortBy);
  if (spec.sortDir !== DEFAULT_SPEC.sortDir) p.set("order", spec.sortDir);
  if (spec.limit !== DEFAULT_SPEC.limit) p.set("limit", String(spec.limit));
  return p;
}

export function parseSpec(searchParams: Record<string, string | string[] | undefined>): TeamFilterSpec {
  const get = (k: string) => {
    const v = searchParams[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const filters: StatFilter[] = [];
  for (let i = 0; i < 8; i++) {
    const raw = get(`f${i}`);
    if (!raw) continue;
    const dot = raw.indexOf(".");
    const dot2 = raw.indexOf(".", dot + 1);
    if (dot < 0 || dot2 < 0) continue;
    const stat = raw.slice(0, dot);
    const op = raw.slice(dot + 1, dot2);
    const valueStr = raw.slice(dot2 + 1);
    if (!isStatKey(stat) || !isComparator(op)) continue;
    const value = Number(valueStr);
    if (!Number.isFinite(value)) continue;
    filters.push({ stat, op, value });
  }
  const sortBy = get("sort");
  const sortDir = get("order");
  const limitRaw = get("limit");
  const limit = limitRaw === "-1" || limitRaw === "all" ? -1 : Number(limitRaw);

  // Years: prefer the new ?ys=2020,2022 multi-select; fall back to legacy
  // ?yf= / ?yt= range, then to ?year= single. Empty = default (current season).
  let years: number[] = [];
  const ys = get("ys");
  if (ys) {
    years = ys
      .split(",")
      .map((s) => clampYear(Number(s.trim())))
      .filter((n, i, a) => a.indexOf(n) === i);
  } else if (get("yf") !== undefined || get("yt") !== undefined) {
    let yf = clampYear(Number(get("yf") ?? get("yt")));
    let yt = clampYear(Number(get("yt") ?? get("yf")));
    if (yf > yt) [yf, yt] = [yt, yf];
    years = [];
    for (let y = yt; y >= yf; y--) years.push(y);
  } else if (get("year") !== undefined) {
    years = [clampYear(Number(get("year")))];
  } else {
    years = [...DEFAULT_SPEC.years];
  }
  if (years.length === 0) years = [...DEFAULT_SPEC.years];
  years.sort((a, b) => b - a);     // canonical newest-first

  return {
    years,
    conf: get("conf") ?? null,
    filters,
    sortBy: isStatKey(sortBy) ? sortBy : DEFAULT_SPEC.sortBy,
    sortDir: sortDir === "asc" || sortDir === "desc" ? sortDir : DEFAULT_SPEC.sortDir,
    limit: limit === -1 ? -1 : (Number.isFinite(limit) && limit > 0 && limit <= 5000 ? limit : DEFAULT_SPEC.limit),
  };
}

// ---------- query ----------
// PostgREST can't join sibling tables directly — pivot from `teams` and pull
// both stat tables through it via the FK each one has to teams(id).
function foreignTable(col: TeamStatColumn): string {
  return col.source === "trank" ? "team_trank_stats" : "team_cbba_stats";
}

export type TeamRow = {
  // identity
  team_id: number;
  team_name: string;
  team_conference: string | null;
  team_year: number;
  // bart
  rank: number | null;
  record: string | null;
  wins: number | null;
  losses: number | null;
  adjoe: number | null;
  adjde: number | null;
  adjt: number | null;
  wab: number | null;
  sos: number | null;
  ncsos: number | null;
  consos: number | null;
  // cbb (nullable until sync runs)
  cbb_efg: number | null;
  cbb_ts: number | null;
  cbb_tov: number | null;
  cbb_orb: number | null;
  cbb_ftarate: number | null;
  cbb_fg3: number | null;
  cbb_fg3rate: number | null;
  cbb_ast: number | null;
  cbb_efg_def: number | null;
  cbb_tov_def: number | null;
  cbb_orb_def: number | null;
  cbb_fg3_def: number | null;
  cbb_ortg: number | null;
  cbb_drtg: number | null;
  cbb_net: number | null;
  cbb_ortg_adj: number | null;
  cbb_drtg_adj: number | null;
  cbb_net_adj: number | null;
  cbb_pace: number | null;
  cbb_pace_adj: number | null;
  cbb_fbpts: number | null;
  cbb_pitp: number | null;
  // CBB raw counts
  fg3_made: number | null;
  fg3_attempts: number | null;
  fg3_made_def: number | null;
  fg3_attempts_def: number | null;
  // CBB ready-made count diffs
  fg3m_diff_ct: number | null;
  fg3a_diff_ct: number | null;
  fg2m_diff_ct: number | null;
  fgm_diff_ct: number | null;
  ftm_diff_ct: number | null;
  orb_diff_ct: number | null;
  drb_diff_ct: number | null;
  reb_diff_ct: number | null;
  tov_diff_ct: number | null;
  fbpts_diff: number | null;
  pitp_diff: number | null;
  pts_diff: number | null;
  scp_diff: number | null;
  potov_diff: number | null;
  // derived
  bta_ortg: number | null;
  bta_drtg: number | null;
  bta_net: number | null;        // bta_ortg − bta_drtg
  bta_rtg: number | null;        // weighted z-score composite ×10
  efg_diff: number | null;
  tov_diff: number | null;
  orb_diff: number | null;
  fg3_diff: number | null;
  fta_diff: number | null;
  // Per-season percentile rank (0–100) for each visible stat. Computed within
  // the team's own season cohort, not the full multi-year selection.
  pct: Record<string, number | null>;
};

// ---------- pure JS processing (no Supabase) ----------
// Used by client-side ExplorerClient to filter/sort/derive over the static
// teams-all.json blob. Same end shape as fetchTeams.
export type RawTeamSeason = {
  id: number;
  name: string;
  conference: string | null;
  year: number;
  team_trank_stats: {
    rank: number | null; record: string | null;
    wins: number | null; losses: number | null;
    adjoe: number | null; adjde: number | null;
    adjt: number | null;
    wab: number | null; sos: number | null;
    ncsos: number | null; consos: number | null;
  } | Array<unknown>;
  team_cbba_stats: {
    efg_pct: number | null; ts_pct: number | null;
    tov_pct: number | null; orb_pct: number | null;
    fta_rate: number | null; fg3_pct: number | null;
    fg3a_rate: number | null; ast_pct: number | null;
    efg_pct_def: number | null; tov_pct_def: number | null;
    orb_pct_def: number | null; fg3_pct_def: number | null;
    ortg: number | null; drtg: number | null;
    net_rtg: number | null; ortg_adj: number | null;
    drtg_adj: number | null; net_rtg_adj: number | null;
    pace: number | null; pace_adj: number | null;
    fbpts_pct: number | null; pitp_pct: number | null;
    // count-diff fields (migration 003 + 006). Loosely typed because the
    // export reads them via index access and the rest of this file casts.
    fg3_made_diff?: number | null; orb_diff_ct?: number | null;
    reb_diff?: number | null; fbpts_diff?: number | null;
    potov_diff?: number | null;
  } | null | Array<unknown>;
};

export function processTeams(rawAll: RawTeamSeason[], spec: TeamFilterSpec): { rows: TeamRow[]; count: number } {
  // Year is the only pre-filter applied before BTA RTG is computed — we want
  // every team-season to keep the SAME BTA RTG regardless of which conference
  // or stat filters are active. So z-score within the full year cohort, then
  // apply conf + stat filters as display-only filters below.
  const yearSet = new Set(spec.years);
  const cohort = rawAll.filter((r) => yearSet.has(r.year));

  // Shape rows + average-based derived columns
  const allRows: TeamRow[] = cohort.map((r) => {
    const trank = (Array.isArray(r.team_trank_stats) ? null : r.team_trank_stats) as Record<string, number | string | null> | null;
    const cbb = (Array.isArray(r.team_cbba_stats) || !r.team_cbba_stats ? null : r.team_cbba_stats) as Record<string, number | null> | null;
    const adjoe = (trank?.adjoe as number | null) ?? null;
    const adjde = (trank?.adjde as number | null) ?? null;
    const cbbOAdj = cbb?.ortg_adj ?? null;
    const cbbDAdj = cbb?.drtg_adj ?? null;
    const bta_ortg = avgIfPresent([adjoe, cbbOAdj]);
    const bta_drtg = avgIfPresent([adjde, cbbDAdj]);
    const fg3a_def_raw = cbb?.fg3_attempts_def ?? null;
    const fg3m_def_raw = cbb?.fg3_made_def ?? null;
    const fg3_pct_def_derived =
      typeof fg3a_def_raw === "number" && fg3a_def_raw > 0 && typeof fg3m_def_raw === "number"
        ? fg3m_def_raw / fg3a_def_raw
        : null;
    return {
      team_id: r.id,
      team_name: r.name,
      team_conference: r.conference ?? null,
      team_year: r.year,
      rank: (trank?.rank as number | null) ?? null,
      record: (trank?.record as string | null) ?? null,
      wins: (trank?.wins as number | null) ?? null,
      losses: (trank?.losses as number | null) ?? null,
      adjoe, adjde,
      adjt: (trank?.adjt as number | null) ?? null,
      wab: (trank?.wab as number | null) ?? null,
      sos: (trank?.sos as number | null) ?? null,
      ncsos: (trank?.ncsos as number | null) ?? null,
      consos: (trank?.consos as number | null) ?? null,
      cbb_efg: cbb?.efg_pct ?? null,
      cbb_ts: cbb?.ts_pct ?? null,
      cbb_tov: cbb?.tov_pct ?? null,
      cbb_orb: cbb?.orb_pct ?? null,
      cbb_ftarate: cbb?.fta_rate ?? null,
      cbb_fg3: cbb?.fg3_pct ?? null,
      cbb_fg3rate: cbb?.fg3a_rate ?? null,
      cbb_ast: cbb?.ast_pct ?? null,
      cbb_efg_def: cbb?.efg_pct_def ?? null,
      cbb_tov_def: cbb?.tov_pct_def ?? null,
      cbb_orb_def: cbb?.orb_pct_def ?? null,
      cbb_fg3_def: cbb?.fg3_pct_def ?? fg3_pct_def_derived,
      cbb_ortg: cbb?.ortg ?? null,
      cbb_drtg: cbb?.drtg ?? null,
      cbb_net: cbb?.net_rtg ?? null,
      cbb_ortg_adj: cbbOAdj,
      cbb_drtg_adj: cbbDAdj,
      cbb_net_adj: cbb?.net_rtg_adj ?? null,
      cbb_pace: cbb?.pace ?? null,
      cbb_pace_adj: cbb?.pace_adj ?? null,
      cbb_fbpts: cbb?.fbpts_pct ?? null,
      cbb_pitp: cbb?.pitp_pct ?? null,
      fg3_made: cbb?.fg3_made ?? null,
      fg3_attempts: cbb?.fg3_attempts ?? null,
      fg3_made_def: cbb?.fg3_made_def ?? null,
      fg3_attempts_def: cbb?.fg3_attempts_def ?? null,
      fg3m_diff_ct: cbb?.fg3_made_diff ?? null,
      fg3a_diff_ct: cbb?.fg3_att_diff ?? null,
      fg2m_diff_ct: cbb?.fg2_made_diff ?? null,
      fgm_diff_ct: cbb?.fg_made_diff ?? null,
      ftm_diff_ct: cbb?.ft_made_diff ?? null,
      orb_diff_ct: cbb?.orb_diff_ct ?? null,
      drb_diff_ct: cbb?.drb_diff ?? null,
      reb_diff_ct: cbb?.reb_diff ?? null,
      tov_diff_ct: cbb?.tov_diff_ct ?? null,
      fbpts_diff: cbb?.fbpts_diff ?? null,
      pitp_diff: cbb?.pitp_diff ?? null,
      pts_diff: cbb?.pts_diff ?? null,
      scp_diff: cbb?.scp_diff ?? null,
      potov_diff: cbb?.potov_diff ?? null,
      bta_ortg,
      bta_drtg,
      bta_net: (bta_ortg !== null && bta_drtg !== null) ? bta_ortg - bta_drtg : null,
      bta_rtg: null,
      efg_diff: diff(cbb?.efg_pct ?? null, cbb?.efg_pct_def ?? null),
      tov_diff: diff(cbb?.tov_pct_def ?? null, cbb?.tov_pct ?? null),
      orb_diff: diff(cbb?.orb_pct ?? null, cbb?.orb_pct_def ?? null),
      fg3_diff: diff(cbb?.fg3_pct ?? null, fg3_pct_def_derived),
      fta_diff: diff(cbb?.fta_rate ?? null, cbb?.fta_rate_def ?? null),
      pct: {},
    };
  });

  // Bucket by year and z-score within EACH year cohort separately, so a team-
  // season's BTA RTG is locked to its own season (Gonzaga 2026 is always 71.3,
  // whether the user is viewing just 2026 or 2014-2026 together).
  {
    const rowsByYear = new Map<number, TeamRow[]>();
    for (const r of allRows) {
      const arr = rowsByYear.get(r.team_year) ?? [];
      arr.push(r);
      rowsByYear.set(r.team_year, arr);
    }
    for (const yearRows of rowsByYear.values()) attachBtaRtg(yearRows);
  }

  // Display filters (conf + raw stats + derived stats). All applied AFTER
  // attachBtaRtg so the rating doesn't shift when the user narrows the view.
  function passes(r: TeamRow, f: StatFilter): boolean {
    const key = f.stat as keyof TeamRow;
    const v = r[key] as number | null;
    if (v === null) return false;
    if (f.op === "gt") return v > f.value;
    if (f.op === "gte") return v >= f.value;
    if (f.op === "lt") return v < f.value;
    return v <= f.value;
  }
  let displaySet = allRows;
  if (spec.conf) displaySet = displaySet.filter((r) => r.team_conference === spec.conf);
  for (const f of spec.filters) {
    const col = COLUMN_BY_KEY.get(f.stat);
    if (!col || col.source === "derived") continue;
    displaySet = displaySet.filter((r) => passes(r, f));
  }

  attachPercentiles(displaySet); // percentile within the visible cohort (matches prior UX)

  let filtered = displaySet;
  for (const f of spec.filters) {
    const col = COLUMN_BY_KEY.get(f.stat);
    if (!col || col.source !== "derived") continue;
    filtered = filtered.filter((r) => passes(r, f));
  }

  const sortCol = COLUMN_BY_KEY.get(spec.sortBy);
  if (sortCol) {
    const key = spec.sortBy as keyof TeamRow;
    const dir = spec.sortDir === "asc" ? 1 : -1;
    filtered.sort((a, b) => {
      const av = a[key] as number | string | null;
      const bv = b[key] as number | string | null;
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }
  const sliced = spec.limit === -1 ? filtered : filtered.slice(0, spec.limit);
  return { rows: sliced, count: filtered.length };
}

// ---------- legacy Supabase fetch (left for any non-SSG consumers) ----------

// Legacy Supabase fetchers removed — all reads now go through static-data.ts
// + processTeams() above. The supabase import is unused at runtime too.

// ---------- helpers used by processTeams (re-added after dead-code cleanup)
function avgIfPresent(vals: Array<number | null | undefined>): number | null {
  const ok = vals.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (ok.length === 0) return null;
  return ok.reduce((a, b) => a + b, 0) / ok.length;
}
function diff(a: number | null | undefined, b: number | null | undefined): number | null {
  if (typeof a !== "number" || typeof b !== "number") return null;
  return a - b;
}

// Per-season percentile rank for the 8 stats shown in the explorer table.
// `higherBetter: false` flips the sort so "lower is better" stats (Adj DRtg,
// Opp eFG%) get green chips at low values.
const PERCENTILE_STATS: Array<{ key: keyof TeamRow; higherBetter: boolean }> = [
  { key: "bta_rtg",     higherBetter: true },
  { key: "bta_net",     higherBetter: true },
  { key: "bta_ortg",    higherBetter: true },
  { key: "bta_drtg",    higherBetter: false },
  { key: "adjt",        higherBetter: true },
  { key: "cbb_ts",      higherBetter: true },
  { key: "cbb_efg",     higherBetter: true },
  { key: "cbb_fg3",     higherBetter: true },
  { key: "cbb_efg_def", higherBetter: false },
];

function attachPercentiles(rows: TeamRow[]) {
  const byYear = new Map<number, TeamRow[]>();
  for (const r of rows) {
    if (!byYear.has(r.team_year)) byYear.set(r.team_year, []);
    byYear.get(r.team_year)!.push(r);
  }
  for (const cohort of byYear.values()) {
    if (cohort.length === 0) continue;
    for (const { key, higherBetter } of PERCENTILE_STATS) {
      const indexed = cohort
        .map((r, i) => ({ v: r[key] as number | null, i }))
        .filter((x) => typeof x.v === "number" && Number.isFinite(x.v)) as { v: number; i: number }[];
      if (indexed.length < 2) {
        for (const r of cohort) r.pct[key as string] = null;
        continue;
      }
      indexed.sort((a, b) => (higherBetter ? a.v - b.v : b.v - a.v));
      const n = indexed.length;
      const written = new Set<number>();
      for (let rank = 0; rank < n; rank++) {
        const { i } = indexed[rank]!;
        cohort[i]!.pct[key as string] = Math.round((rank / (n - 1)) * 100);
        written.add(i);
      }
      for (let i = 0; i < cohort.length; i++) {
        if (!written.has(i)) cohort[i]!.pct[key as string] = null;
      }
    }
  }
}

function attachBtaRtg(rows: TeamRow[]) {
  const meanStd = (pick: (r: TeamRow) => number | null) => {
    const vals = rows.map(pick).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (vals.length === 0) return null;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
    const std = Math.sqrt(variance);
    return std > 1e-9 ? { mean, std } : null;
  };

  const adjoe = meanStd((r) => r.adjoe);
  const adjde = meanStd((r) => r.adjde);
  const cbbO = meanStd((r) => r.cbb_ortg_adj);
  const cbbD = meanStd((r) => r.cbb_drtg_adj);
  const sos = meanStd((r) => r.sos);
  // Small-weight diff tells — ORTG side
  const orbDiff   = meanStd((r) => r.orb_diff_ct);
  const fg3mDiff  = meanStd((r) => r.fg3m_diff_ct);
  const fbptsDiff = meanStd((r) => r.fbpts_diff);
  // Small-weight diff tells — DRTG side
  const rebDiff   = meanStd((r) => r.reb_diff_ct);
  const potovDiff = meanStd((r) => r.potov_diff);

  for (const r of rows) {
    let weightedSum = 0;
    let totalWeight = 0;
    const add = (z: number, weight: number) => {
      weightedSum += z * weight;
      totalWeight += weight;
    };
    if (adjoe && typeof r.adjoe === "number") add((r.adjoe - adjoe.mean) / adjoe.std, 1);
    if (cbbO && typeof r.cbb_ortg_adj === "number") add((r.cbb_ortg_adj - cbbO.mean) / cbbO.std, 1);
    if (adjde && typeof r.adjde === "number") add(-((r.adjde - adjde.mean) / adjde.std), 1);
    if (cbbD && typeof r.cbb_drtg_adj === "number") add(-((r.cbb_drtg_adj - cbbD.mean) / cbbD.std), 1);
    if (sos && typeof r.sos === "number") add((r.sos - sos.mean) / sos.std, 0.5);
    // ORTG-side small-weight tells (+z = bigger advantage = better)
    if (orbDiff   && typeof r.orb_diff_ct  === "number") add((r.orb_diff_ct  - orbDiff.mean)   / orbDiff.std,   0.25);
    if (fg3mDiff  && typeof r.fg3m_diff_ct === "number") add((r.fg3m_diff_ct - fg3mDiff.mean)  / fg3mDiff.std,  0.25);
    if (fbptsDiff && typeof r.fbpts_diff   === "number") add((r.fbpts_diff   - fbptsDiff.mean) / fbptsDiff.std, 0.25);
    // DRTG-side small-weight tells (+z = bigger advantage = better)
    if (rebDiff   && typeof r.reb_diff_ct === "number") add((r.reb_diff_ct - rebDiff.mean)   / rebDiff.std,   0.25);
    if (potovDiff && typeof r.potov_diff  === "number") add((r.potov_diff  - potovDiff.mean) / potovDiff.std, 0.25);
    r.bta_rtg = totalWeight === 0 ? null : (weightedSum / totalWeight) * 40;
  }
}

void avgIfPresent;
void diff;
void attachPercentiles;
void attachBtaRtg;
