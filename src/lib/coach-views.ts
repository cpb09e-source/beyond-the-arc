/**
 * The coach pages' own logic, lifted out of their components.
 *
 * lib/coaches-core.ts builds the profiles; this is what the /coaches explorer,
 * the profile page, the season table, the March Madness section and the
 * compare modal then DO with them — which coaches a filter keeps, what a
 * column sorts on, which rank a tile shows, who won a bracket game. All of it
 * used to live inside React components and server pages, where nothing else
 * could reach it. Moved as it was; the components import it back.
 *
 * SAME RULES AS coaches-core: no node:*, no next/*, no React, no `process`.
 * Runtime imports are coaches-core, conf-tiers, conf-display and percentile,
 * none of which import anything outside that set. The range-filter and GameLog
 * types come in as `import type`, which compiles away.
 */

import {
  tournamentWinsRank,
  type CoachIndexRow,
  type CoachProfile,
  type CoachSeason,
  type TourneyGame,
  type TourneyRound,
} from "@/lib/coaches-core";
import { POWER_CONFS } from "@/lib/conf-tiers";
import { confDisplay } from "@/lib/conf-display";
import { midrankPercentileMap } from "@/lib/percentile";
import type { RangeStat, RangeState } from "@/components/filters/range-row";
import type { GameLog } from "@/lib/static-data";

// ---------- /coaches explorer: stat filters ----------

export type CoachStatGroup = { label: string; stats: RangeStat[] };

/**
 * The stat-range drawer's sliders, grouped as the drawer shows them.
 *
 * Bounds below are set from the observed spread across ~800 coaches, rounded
 * outward, so a slider spends its travel where coaches actually differ rather
 * than on values nobody posts.
 */
export const COACH_STAT_GROUPS: CoachStatGroup[] = [
  {
    label: "Play style",
    stats: [
      { key: "pace",      label: "Pace",            min: 55, max: 80, step: 0.5 },
      { key: "fg3a_rate", label: "3PAR",            min: 20, max: 55, step: 0.5 },
      { key: "fta_rate",  label: "FTAR",            min: 20, max: 50, step: 0.5 },
      { key: "orb_pct",   label: "OREB Rate",       min: 15, max: 45, step: 0.5 },
      { key: "tov_pct",   label: "Turnover Rate",   min: 10, max: 25, step: 0.5 },
      { key: "ast_pct",   label: "Assist Rate",     min: 40, max: 70, step: 0.5 },
    ],
  },
  {
    label: "Defensive identity",
    stats: [
      { key: "efg_def",   label: "Opp eFG",         min: 40, max: 58, step: 0.5 },
      { key: "tov_def",   label: "Opp Turnover Rate", min: 12, max: 28, step: 0.5 },
      { key: "orb_def",   label: "Opp OREB Rate",   min: 20, max: 40, step: 0.5 },
    ],
  },
  {
    label: "Résumé",
    stats: [
      { key: "composite",     label: "Composite",     min: -75, max: 285, step: 5 },
      { key: "per_season",    label: "Per Season",    min: -20, max: 40,  step: 0.5 },
      { key: "career_win_pct", label: "Career Win %",  min: 0,   max: 100, step: 1 },
      { key: "conf_win_pct",  label: "Conf Win %",    min: 0,   max: 100, step: 1 },
      { key: "adj_net_avg",   label: "Adj Net",       min: -25, max: 32,  step: 0.5 },
      { key: "seasons",       label: "Seasons",       min: 1,   max: 14,  step: 1 },
    ],
  },
  {
    label: "March",
    stats: [
      { key: "ncaa_rate",       label: "NCAA Rate",       min: 0, max: 100, step: 5 },
      { key: "s16_rate",        label: "Sweet 16 Rate",   min: 0, max: 100, step: 5 },
      { key: "ncaa_appearances", label: "Appearances",    min: 0, max: 14,  step: 1 },
      { key: "sweet_sixteens",  label: "Sweet 16s",       min: 0, max: 12,  step: 1 },
      { key: "final_fours",     label: "Final Fours",     min: 0, max: 6,   step: 1 },
      { key: "ncaa_titles",     label: "Titles",          min: 0, max: 3,   step: 1 },
      { key: "top25_seasons",   label: "Top-25 Seasons",  min: 0, max: 14,  step: 1 },
    ],
  },
];

/** Every drawer stat, in drawer order. */
export const COACH_STATS: RangeStat[] = COACH_STAT_GROUPS.flatMap((g) => g.stats);

/** Pull the comparable number for a stat off a coach row. */
export function coachStatValue(r: CoachIndexRow, key: string): number | null {
  const st = r.style_avg;
  switch (key) {
    case "pace":      return st?.pace ?? null;
    case "fg3a_rate": return st?.fg3a_rate ?? null;
    case "fta_rate":  return st?.fta_rate ?? null;
    case "orb_pct":   return st?.orb_pct ?? null;
    case "tov_pct":   return st?.tov_pct ?? null;
    case "ast_pct":   return st?.ast_pct ?? null;
    case "efg_def":   return st?.efg_def ?? null;
    case "tov_def":   return st?.tov_def ?? null;
    case "orb_def":   return st?.orb_def ?? null;
    case "composite":       return r.composite_score ?? null;
    case "per_season":      return r.composite_per_season ?? null;
    case "career_win_pct":  return r.career_win_pct != null ? r.career_win_pct * 100 : null;
    case "conf_win_pct":    return r.conf_win_pct != null ? r.conf_win_pct * 100 : null;
    case "adj_net_avg":     return r.adj_net_avg ?? null;
    case "seasons":         return r.seasons_count;
    case "ncaa_rate":       return r.ncaa_rate != null ? r.ncaa_rate * 100 : null;
    case "s16_rate":        return r.s16_rate != null ? r.s16_rate * 100 : null;
    case "ncaa_appearances": return r.ncaa_appearances;
    case "sweet_sixteens":  return r.sweet_sixteens;
    case "final_fours":     return r.final_fours;
    case "ncaa_titles":     return r.ncaa_titles;
    case "top25_seasons":   return r.top25_seasons ?? null;
    default: return null;
  }
}

/**
 * Does a coach clear every active bound?
 *
 * A coach with no value for a bounded stat is EXCLUDED. Filtering on pace and
 * keeping the coaches whose pace we don't know would quietly pad the result
 * with rows that cannot be checked against the thing you asked for.
 */
export function passesCoachFilters(r: CoachIndexRow, state: RangeState): boolean {
  for (const st of COACH_STATS) {
    const b = state[st.key];
    if (!b || (b.lo === null && b.hi === null)) continue;
    const v = coachStatValue(r, st.key);
    if (v === null) return false;
    if (b.lo !== null && v < b.lo) return false;
    if (b.hi !== null && v > b.hi) return false;
  }
  return true;
}

/**
 * isBoundActive from filters/range-row.tsx, restated rather than imported:
 * that module is a React component file, and this one must not pull React in.
 * passesCoachFilters above already spells the same test inline.
 */
function boundActive(b: RangeState[string] | undefined): boolean {
  return !!b && (b.lo !== null || b.hi !== null);
}

/**
 * Stats the table already shows in a column of their own. Filtering on Adj Net
 * should not produce a second Adj Net column beside the first.
 *
 * The March counts are deliberately NOT here: the March cell renders them as a
 * tick strip, which is a shape rather than a sortable number, so a coach who
 * filters on Final Fours still has nowhere to read or order the actual count.
 */
const ALREADY_COLUMNED = new Set([
  "composite", "per_season", "career_win_pct", "conf_win_pct", "adj_net_avg", "seasons",
]);

export type CoachStatColumn = { key: string; label: string };

/**
 * Bounded stats that deserve a column, in drawer order. Filtering on something
 * you cannot then see is the gap this closes — you narrow to coaches who play
 * fast and crash the glass, and the two numbers you chose them for come with
 * them instead of staying behind in the drawer.
 */
export function activeCoachStatColumns(state: RangeState): CoachStatColumn[] {
  return COACH_STATS
    .filter((s) => boundActive(state[s.key]) && !ALREADY_COLUMNED.has(s.key))
    .map((s) => ({ key: s.key, label: s.label }));
}

/** Rates that read as percentages; `pace` is possessions, so it stays bare. */
const PCT_STATS = new Set([
  "fg3a_rate", "fta_rate", "orb_pct", "tov_pct", "ast_pct",
  "efg_def", "tov_def", "orb_def",
  "career_win_pct", "conf_win_pct", "ncaa_rate", "s16_rate",
]);
const COUNT_STATS = new Set([
  "seasons", "ncaa_appearances", "sweet_sixteens", "final_fours", "ncaa_titles", "top25_seasons",
]);

export function formatCoachStat(key: string, v: number | null): string {
  if (v === null) return "—";
  if (COUNT_STATS.has(key)) return String(v);
  if (key === "adj_net_avg") return (v > 0 ? "+" : "") + v.toFixed(1);
  return v.toFixed(1) + (PCT_STATS.has(key) ? "%" : "");
}

// ---------- /coaches explorer: scope, sort, percentiles ----------

export type CoachStatusFilter = "All" | "Active" | "Inactive";
export type CoachTierFilter = "All" | "Power" | "Mid Major";

export const COACH_STATUS_OPTIONS: CoachStatusFilter[] = ["All", "Active", "Inactive"];
export const COACH_TIER_OPTIONS: CoachTierFilter[] = ["All", "Power", "Mid Major"];

/**
 * The /coaches default order, IN PLACE (and returned): composite résumé score,
 * descending. Coaches without a composite (rare — only no-data entries) sort
 * last; ties break by last name alphabetical so the order is stable.
 */
export function sortCoachesDefault<T extends CoachIndexRow>(rows: T[]): T[] {
  rows.sort((a, b) => {
    const av = a.composite_score ?? -Infinity;
    const bv = b.composite_score ?? -Infinity;
    if (av !== bv) return bv - av;
    const al = (a.name.split(" ").pop() ?? a.name).toLowerCase();
    const bl = (b.name.split(" ").pop() ?? b.name).toLowerCase();
    return al.localeCompare(bl);
  });
  return rows;
}

/**
 * The scope bar's controls, normalized once per pass: the search needle
 * trimmed and lowercased, the multi-selects as sets (null = no restriction).
 */
export type CoachScope = {
  q: string;
  confSet: ReadonlySet<string> | null;
  teamSet: ReadonlySet<string> | null;
  tier: CoachTierFilter;
  status: CoachStatusFilter;
};

export function coachScope(input: {
  query: string;
  confs: readonly string[];
  teams: readonly string[];
  tier: CoachTierFilter;
  status: CoachStatusFilter;
}): CoachScope {
  return {
    q: input.query.trim().toLowerCase(),
    confSet: input.confs.length === 0 ? null : new Set(input.confs),
    teamSet: input.teams.length === 0 ? null : new Set(input.teams),
    tier: input.tier,
    status: input.status,
  };
}

/**
 * Does a coach survive the scope bar — status, team, conference, tier, search?
 * The stat drawer's bounds are a separate test, passesCoachFilters.
 */
export function passesCoachScope(r: CoachIndexRow, scope: CoachScope): boolean {
  const { q, confSet, teamSet, tier, status } = scope;
  if (status === "Active" && !r.is_active) return false;
  if (status === "Inactive" && r.is_active) return false;
  // Match against any team the coach has been at in our window, not
  // just their current team. So picking "Abilene Christian" shows every
  // coach who's coached there since 2013.
  if (teamSet) {
    let hit = false;
    for (const t of r.all_teams ?? []) if (teamSet.has(t)) { hit = true; break; }
    if (!hit) return false;
  }
  if (confSet && (!r.current_conference || !confSet.has(r.current_conference))) return false;
  if (tier !== "All") {
    // Unknown is unknown. `Mid Major` used to mean "not power", which
    // quietly asserted mid-major status for anyone we had no conference
    // for; a coach we cannot place belongs in neither tier.
    if (!r.current_conference) return false;
    const isPower = POWER_CONFS.has(r.current_conference);
    if (tier === "Power" && !isPower) return false;
    if (tier === "Mid Major" && isPower) return false;
  }
  if (q && !r.name.toLowerCase().includes(q) && !(r.current_team ?? "").toLowerCase().includes(q)) return false;
  return true;
}

/**
 * Fixed columns, plus `stat:<key>` for the columns a stat filter adds. The
 * tagged form keeps the two kinds apart without a second piece of state, and
 * lets a stat column be sorted the same way any other column is.
 */
export type CoachSortKey = "name" | "team" | "conference" | "active" | "career_wins" | "career_winpct" | "seasons" | "schools" | "composite"
  | "composite_per_season" | "conf_winpct" | "adj_net" | "tourney" | "tourney_rec" | `stat:${string}`;

/** The value a column sorts on. Null sorts last whichever way the column runs. */
export function coachSortValue(r: CoachIndexRow, effectiveSort: CoachSortKey): string | number | boolean | null {
  if (effectiveSort.startsWith("stat:")) return coachStatValue(r, effectiveSort.slice(5));
  switch (effectiveSort) {
    case "name":           return (r.name.split(" ").pop() ?? r.name).toLowerCase();
    case "team":           return (r.current_team ?? "zzz").toLowerCase();
    case "conference":     return r.current_conference ? confDisplay(r.current_conference).toLowerCase() : "zzz";
    case "active":         return r.is_active ? 1 : 0;
    case "career_wins":    return r.career_wins;
    case "career_winpct":  return r.career_win_pct;
    case "seasons":        return r.seasons_count;
    case "schools":        return r.schools_count;
    case "composite":      return r.composite_score ?? null;
    case "composite_per_season": return r.composite_per_season ?? null;
    case "conf_winpct":    return r.conf_win_pct ?? null;
    case "adj_net":        return r.adj_net_avg ?? null;
    case "tourney":        return r.tourney_rank_key ?? null;
    // Wins first, then fewest losses. 20-6 outranks 20-14, and a coach who
    // has never been leaves the column unranked rather than sorting as 0-0
    // ahead of someone who went once and lost.
    case "tourney_rec":    return r.ncaa_appearances > 0 ? r.tourney_wins * 100 - r.tourney_losses : null;
    default:               return null;
  }
}

/**
 * The sort key actually in force.
 *
 * It exists because clearing a filter takes its column away. Deriving the
 * fallback here rather than resetting `sortBy` in an effect keeps the table
 * sorted by something real on the very first render after the column goes,
 * with no extra pass.
 */
export function effectiveCoachSort(sortBy: CoachSortKey, statColKeys: ReadonlySet<string>): CoachSortKey {
  return sortBy.startsWith("stat:") && !statColKeys.has(sortBy.slice(5)) ? "composite" : sortBy;
}

/** A sorted copy: nulls last in either direction, ties by last name. */
export function sortCoachRows<T extends CoachIndexRow>(
  filtered: readonly T[],
  effectiveSort: CoachSortKey,
  sortDir: "asc" | "desc",
): T[] {
  const dir = sortDir === "asc" ? 1 : -1;
  const key = (r: T) => coachSortValue(r, effectiveSort);
  return [...filtered].sort((a, b) => {
    const av = key(a), bv = key(b);
    // Missing values go last whichever way the column runs. Two missing values
    // compare equal: returning 1 for both claimed a > b and b > a at once,
    // which is not a comparator Array.sort promises to handle.
    const aMissing = av === null || av === undefined;
    const bMissing = bv === null || bv === undefined;
    if (aMissing || bMissing) return aMissing === bMissing ? 0 : aMissing ? 1 : -1;
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    // Stable secondary sort by last name
    const al = (a.name.split(" ").pop() ?? a.name).toLowerCase();
    const bl = (b.name.split(" ").pop() ?? b.name).toLowerCase();
    return al.localeCompare(bl);
  });
}

export type CoachPercentiles = {
  composite: Map<string, number>;
  perSeason: Map<string, number>;
  conf: Map<string, number>;
  adjNet: Map<string, number>;
  tourneyWins: Map<string, number>;
};

/**
 * Percentiles for the chipped columns.
 *
 * Ranked over the WHOLE coach set, not the filtered view: a chip should mean
 * "against every coach we hold", so filtering to the Big 12 doesn't silently
 * turn a national 60th percentile into a 95th. Same rule the players and
 * teams grids follow. Coaches missing a value are left out rather than
 * ranked last — no adjusted rating is not a bad one.
 */
export function coachPercentiles(rows: readonly CoachIndexRow[]): CoachPercentiles {
  // Ties share a percentile — see src/lib/percentile.ts. Ranking by sorted
  // position gave two coaches with identical records different chips.
  const rank = (get: (r: CoachIndexRow) => number | null | undefined) =>
    midrankPercentileMap(rows.map((r) => [r.slug, get(r)] as const));
  return {
    composite: rank((r) => r.composite_score),
    perSeason: rank((r) => r.composite_per_season),
    conf: rank((r) => r.conf_win_pct),
    adjNet: rank((r) => r.adj_net_avg),
    // Only among coaches who have been. A 0-0 chipped at the 30th percentile
    // would read as a tournament result, and never qualifying is not one.
    tourneyWins: rank((r) => (r.ncaa_appearances > 0 ? r.tourney_wins : null)),
  };
}

/**
 * Percentiles for the filter-added columns, on the same national basis.
 *
 * Keyed by stat so a column added and removed and added again costs one
 * ranking pass, not one per render. Nothing is computed for a stat that has
 * no column.
 */
export function coachStatPercentiles(
  rows: readonly CoachIndexRow[],
  statCols: readonly CoachStatColumn[],
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const c of statCols) {
    // Midrank, as coachPercentiles does, so tied coaches share a chip. A stat
    // with fewer than two coaches holding a value gets an empty map.
    out.set(c.key, midrankPercentileMap(rows.map((r) => [r.slug, coachStatValue(r, c.key)] as const)));
  }
  return out;
}

// ---------- /coaches/<slug> profile page ----------

// Compact label per TourneyRound. R64/R32 → R1/R2 to match conventional
// fan parlance; Champion + Runner-up both label as NC since the W/L pill on
// the game cell already disambiguates winner vs loser of the title game.
export const SHORT_ROUND: Record<string, string> = {
  "First Four": "FF",
  "R64": "R1",
  "R32": "R2",
  "Sweet 16": "S16",
  "Elite Eight": "E8",
  "Final Four": "F4",
  "Runner-up": "NC",
  "Champion": "NC",
};

/** Every season-year's team, resolved against the team rows (see the page). */
export type CoachTeamYear = { team: string; teamSlug: string; year: number };

export function resolveCoachTeamYears(
  byYear: readonly CoachSeason[],
  allTeams: ReadonlyArray<{ name: string; year: number }>,
): CoachTeamYear[] {
  // No teamId here on purpose. It used to carry teams-all's bart id, which
  // nothing downstream can join against — game_logs is keyed by CBBD's ids —
  // and keeping a dead id around is how the modal came to match on it.
  const coachTeamYears: CoachTeamYear[] = [];
  for (const s of byYear) {
    const teamRow = allTeams.find((t) => t.name === s.team && t.year === s.year);
    if (!teamRow) continue;
    coachTeamYears.push({
      team: s.team,
      teamSlug: teamRow.name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
      year: s.year,
    });
  }
  return coachTeamYears;
}

/**
 * The seasons a March Madness resume is built from: every seeded season.
 *
 * Newest season leftmost — the coach's most recent tournament run reads
 * first, with their earlier appearances trailing off to the right. Within
 * each season we keep games in chronological round order (R1 → NC) so the
 * arc inside a single cluster still reads left-to-right naturally.
 */
export function resumeSeasons(byYear: readonly CoachSeason[]): CoachSeason[] {
  return [...byYear]
    .filter((s) => s.seed !== null)
    .sort((a, b) => b.year - a.year);
}

/**
 * One season's resume games: each bracket game with a date, matched to the
 * team's own row in that year's game logs by (team name, date) and tagged with
 * its SHORT_ROUND label. A bracket game with no matching row is dropped.
 */
export function resumeGamesForSeason(
  season: CoachSeason,
  tGames: readonly TourneyGame[],
  yearGameLogs: readonly GameLog[],
): GameLog[] {
  const marchGames: GameLog[] = [];
  for (const tg of tGames) {
    if (!tg.date) continue;
    // Match on team name, not id: game_logs.team_id is CBBD's id space
    // and teams-all carries the bart id, so an id join finds nothing and
    // the resume ticker just renders empty. Names agree exactly across
    // both exports.
    const match = yearGameLogs.find(
      (gl) => gl.team_name === season.team && gl.game_date === tg.date,
    );
    if (match) {
      marchGames.push({
        ...match,
        tournamentRound: SHORT_ROUND[tg.round] ?? tg.round,
      });
    }
  }
  return marchGames;
}

/** 1 → "1st", 12 → "12th", 22 → "22nd". */
export function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

export type CoachProfileStats = {
  totalGames: number;
  ncaaAppearances: number;
  avgWinsPerSeason: number;
  twentyWinSeasons: number;
  conferences: string[];
};

/** The profile header's own counts, all off the profile itself. */
export function coachProfileStats(profile: CoachProfile): CoachProfileStats {
  const totalGames = profile.career_wins + profile.career_losses;
  const ncaaAppearances = profile.by_year.filter((s) => s.seed !== null).length;
  const avgWinsPerSeason = profile.seasons_count > 0 ? (profile.career_wins / profile.seasons_count) : 0;
  // 20+ win seasons — the rough threshold for an NCAA-tournament-caliber team in our window.
  const twentyWinSeasons = profile.by_year.filter((s) => (s.wins ?? 0) >= 20).length;
  // Distinct conferences coached in (when known). Sourced from each season's
  // conference field which is only populated for the current year — but still
  // worth showing the current-team's conference at minimum.
  const conferences = Array.from(new Set(profile.by_year.map((s) => s.conference).filter((c): c is string => !!c)));
  return { totalGames, ncaaAppearances, avgWinsPerSeason, twentyWinSeasons, conferences };
}

export type CoachProfileRanks = {
  winsRank: number;
  compositeRank: number;
  compositeRankTotal: number;
  pctRank: number;
  pctRankTotal: number;
  pctRankEligible: boolean;
  tourneyRank: { rank: number; total: number; wins: number };
};

/** Where one coach stands against every profile. A rank of 0 means not found. */
export function coachProfileRanks(allProfiles: CoachProfile[], profile: CoachProfile): CoachProfileRanks {
  // Career rank — where does this coach stand vs all others in our data
  // window? Wins rank uses raw totals; win-% rank requires a minimum sample
  // size (3 seasons) so single-season flukes don't dominate.
  const sortedByWins = [...allProfiles].sort((a, b) => b.career_wins - a.career_wins);
  const winsRank = sortedByWins.findIndex((p) => p.slug === profile.slug) + 1;

  // Composite résumé rank — where this coach stands across the full pool by
  // the multi-component score (see computeCompositeScore in lib/coaches-core.ts).
  const sortedByComposite = [...allProfiles].sort(
    (a, b) => (b.composite_score ?? 0) - (a.composite_score ?? 0),
  );
  const compositeRank = sortedByComposite.findIndex((p) => p.slug === profile.slug) + 1;
  const compositeRankTotal = sortedByComposite.length;
  const eligibleForPctRank = allProfiles.filter((p) => p.seasons_count >= 3 && p.career_win_pct !== null);
  eligibleForPctRank.sort((a, b) => (b.career_win_pct ?? 0) - (a.career_win_pct ?? 0));
  const pctRank = eligibleForPctRank.findIndex((p) => p.slug === profile.slug) + 1;
  const pctRankTotal = eligibleForPctRank.length;
  const pctRankEligible = profile.seasons_count >= 3 && profile.career_win_pct !== null && pctRank > 0;

  // Tournament-wins rank — only meaningful for coaches with at least one
  // appearance; for everyone else, the Tournament Success section shows
  // "no appearances" so the rank doesn't render either way.
  const tourneyRank = tournamentWinsRank(allProfiles, profile);
  return { winsRank, compositeRank, compositeRankTotal, pctRank, pctRankTotal, pctRankEligible, tourneyRank };
}

// ---------- March Madness section ----------

// "How far they got" → numeric depth. Higher = deeper run.
export const TOURNEY_ROUND_DEPTH: Record<TourneyRound, number> = {
  "First Four": 0,
  "R64": 1,
  "R32": 2,
  "Sweet 16": 3,
  "Elite Eight": 4,
  "Final Four": 5,
  "Runner-up": 6,
  "Champion": 7,
};

// Number of tournament wins implied by reaching a given round.
// (R64 loss = 0 wins, R32 loss = 1 win, ..., Champion = 6 wins.)
export const TOURNEY_ROUND_WINS: Record<TourneyRound, number> = {
  "First Four": 0,
  "R64": 0,
  "R32": 1,
  "Sweet 16": 2,
  "Elite Eight": 3,
  "Final Four": 4,
  "Runner-up": 5,
  "Champion": 6,
};

export const TOURNEY_ROUND_LABEL: Record<TourneyRound, string> = {
  "First Four": "First Four",
  "R64": "First Round",
  "R32": "Second Round",
  "Sweet 16": "Sweet 16",
  "Elite Eight": "Elite Eight",
  "Final Four": "Final Four",
  "Runner-up": "Title runner-up",
  "Champion": "Champion",
};

export const TOURNEY_ROUND_SHORT: Record<TourneyRound, string> = {
  "First Four": "FF",
  "R64": "R64",
  "R32": "R32",
  "Sweet 16": "S16",
  "Elite Eight": "E8",
  "Final Four": "F4",
  "Runner-up": "FINAL",
  "Champion": "CHAMP",
};

export type TourneySummary = {
  /** Seeded seasons, newest first. */
  tourneys: CoachSeason[];
  appearances: number;
  tourneyWins: number;
  tourneyLosses: number;
  highestSeed: number;
};

/**
 * The March Madness section's summary. With no seeded season `tourneys` is
 * empty and the section renders its empty state instead.
 *
 * Pass `record` whenever the profile is at hand: profile.tourney_wins and
 * profile.tourney_losses, counted off the bracket by attachTournamentRecord in
 * lib/coaches-core.ts. That is the record the tourney-wins rank and the
 * explorer's NCAA column use. Without it the record is inferred from round
 * labels, which cannot tell a game won from a round skipped: Oregon's 2021
 * no-contest against VCU put Dana Altman's profile at 17-9 beside a 16-9
 * index row.
 */
export function tourneySummary(
  seasons: readonly CoachSeason[],
  record?: { wins: number; losses: number },
): TourneySummary {
  // "Tournament appearance" = we have a seed assigned.
  const tourneys = seasons.filter((s) => s.seed !== null).sort((a, b) => b.year - a.year);

  // Summary stats
  const appearances = tourneys.length;
  // The label fallback: each appearance's round implies its wins, and every
  // appearance ends with a loss except for years won.
  const champions = tourneys.filter((s) => s.round === "Champion").length;
  const tourneyWins = record?.wins ?? tourneys.reduce(
    (sum, s) => sum + (s.round ? TOURNEY_ROUND_WINS[s.round] : 0),
    0,
  );
  const tourneyLosses = record?.losses ?? appearances - champions;
  const highestSeed = Math.min(...tourneys.map((s) => s.seed ?? 99));
  return { tourneys, appearances, tourneyWins, tourneyLosses, highestSeed };
}

export type TourneyGameRow = {
  teamIsWinner: boolean;
  oppCell: TourneyGame["winner"];
  yourCell: TourneyGame["winner"];
  result: "W" | "L";
  gameSlug: string | null;
  sportsRefHref: string;
  title: string;
};

/** One bracket game from the coach's team's side: who won, the two cells, the box-score link. */
export function tourneyGameRow(game: TourneyGame, teamName: string): TourneyGameRow {
  const teamIsWinner = matchSrSchool(game.winner.school, teamName);
  const oppCell = teamIsWinner ? game.loser : game.winner;
  const yourCell = teamIsWinner ? game.winner : game.loser;
  const result = teamIsWinner ? "W" : "L";
  const gameSlug = game.boxscore_url
    ? game.boxscore_url.replace(/^\/cbb\/boxscores\//, "").replace(/\.html$/, "")
    : null;
  const sportsRefHref = game.boxscore_url
    ? `https://www.sports-reference.com${game.boxscore_url}`
    : "";
  const title = `${TOURNEY_ROUND_LABEL[game.round]} · ${result} ${yourCell.score}–${oppCell.score} vs ${oppCell.school} — click for box score`;
  return { teamIsWinner, oppCell, yourCell, result, gameSlug, sportsRefHref, title };
}

/**
 * Match a Sports-Reference bracket school name against a Bart team name.
 *
 * THIS DECIDES WHO WON. `teamIsWinner` is computed by matching the coach's team
 * against the game's winner, so a false negative doesn't just mis-label a name —
 * it flips the whole row. Every UConn tournament game on every UConn coach page
 * rendered as a LOSS to "UConn", including the 2024 title game, because the
 * bracket data says "UConn" and Bart says "Connecticut" and a bare
 * strip-punctuation compare can never equate those.
 *
 * Three passes, cheapest first. Measured against all 233 school names in
 * tournament-games.json: a bare compare left 54 unmatched, normalization plus
 * the shared alias table plus a parenthetical retry left 7, and the explicit map
 * below covers those.
 */
export function matchSrSchool(a: string, b: string): boolean {
  const ka = schoolKeys(a);
  return schoolKeys(b).some((k) => ka.includes(k));
}

/**
 * Sports-Reference abbreviations with no algorithmic route to Bart's spelling.
 * Only genuine abbreviations belong here — anything normalization can reach
 * should be left to `norm`.
 */
const SR_SCHOOL_ALIASES: Record<string, string> = {
  "UNC": "North Carolina",
  "Pitt": "Pittsburgh",
  "UMass": "Massachusetts",
  "UConn": "Connecticut",
  "Ole Miss": "Mississippi",
  "ETSU": "East Tennessee St.",
  "FDU": "Fairleigh Dickinson",
  "Loyola (IL)": "Loyola Chicago",
  "College of Charleston": "Charleston",
  "California Baptist": "Cal Baptist",
  "Grambling": "Grambling St.",
  "McNeese": "McNeese St.",
  "Omaha": "Nebraska Omaha",
  "Texas A&M-Corpus Christi": "Texas A&M Corpus Chris",
};

/**
 * Candidate keys for one school name — a parenthetical qualifier is tried BOTH
 * ways, which is the whole reason this returns a list.
 *
 * Bart drops the parentheses but keeps the qualifier for "Miami (FL)" →
 * "Miami FL", and drops the qualifier entirely for "Albany (NY)" → "Albany".
 * Picking either rule alone breaks the other, and picking "always strip the
 * qualifier" collapses Miami (FL) and Miami (OH) onto the same key — two real
 * schools that have both been in the same bracket.
 */
function schoolKeys(s: string): string[] {
  const aliased = SR_SCHOOL_ALIASES[s.trim()] ?? s;
  const keys = new Set<string>();
  keys.add(norm(aliased));                                   // "Miami (FL)" -> miamifl
  keys.add(norm(aliased.replace(/\s*\([^)]*\)\s*$/, "")));    // "Albany (NY)" -> albany
  keys.delete("");
  return [...keys];
}

/**
 * Folds "St." and "State" onto one token — the single biggest divergence
 * between the two vocabularies ("Michigan State" vs "Michigan St."). Parentheses
 * are dropped but their CONTENTS are kept; schoolKeys() supplies the
 * qualifier-removed variant separately.
 */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/\bst\.?\b/g, "state")
    .replace(/[^a-z0-9]+/g, "");
}

// ---------- season-by-season table ----------

export type SeasonSortKey =
  | "year"
  | "school"
  | "conf"
  | "record"
  | "bta_rtg"
  | "adj_net"
  | "adj_oe"
  | "adj_de"
  | "awards";

export type SeasonSortDir = "asc" | "desc";

/**
 * The season table's order for a column and direction, as a sorted copy.
 *
 * Numeric columns: numeric compare. String columns: locale compare. A season
 * missing the value sorts last in either direction.
 */
export function sortCoachSeasons(
  seasons: readonly CoachSeason[],
  sortBy: SeasonSortKey,
  sortDir: SeasonSortDir,
): CoachSeason[] {
  const arr = [...seasons];
  const dir = sortDir === "asc" ? 1 : -1;
  arr.sort((a, b) => {
    const get = (s: CoachSeason): number | string | null => {
      switch (sortBy) {
        case "year": return s.year;
        case "school": return s.team;
        case "conf": return s.conference ?? "";
        case "record":
          // Sort by wins primarily; null records sort last.
          return s.wins ?? null;
        case "bta_rtg":
          // We display BTA rank (lower = better) and sort on the rank value,
          // so "asc" on this column = best-ranked first.
          return s.bta_rank ?? null;
        case "adj_net": return s.adj_net ?? null;
        case "adj_oe": return s.adj_oe ?? null;
        case "adj_de": return s.adj_de ?? null;
        case "awards":
          return awardsRank(s);
        default: return 0;
      }
    };
    const av = get(a);
    const bv = get(b);
    // Missing values last, and two missing values tie. The ±Infinity stand-ins
    // this replaces only put them last in each column's default direction, and
    // two of them made the comparator NaN (Infinity - Infinity).
    if (av === null || bv === null) return av === bv ? 0 : av === null ? 1 : -1;
    if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * dir;
    const an = typeof av === "number" ? av : 0;
    const bn = typeof bv === "number" ? bv : 0;
    return (an - bn) * dir;
  });
  return arr;
}

/**
 * The direction a column sorts in on its first click. Stat columns where
 * higher-is-better (BTA RTG, Adj Net, Adj ORTG) default to descending;
 * lower-is-better (Adj DRTG) defaults to ascending.
 */
export function defaultSeasonSortDir(key: SeasonSortKey): SeasonSortDir {
  // Sensible default direction per column.
  if (key === "year" || key === "adj_net" || key === "adj_oe" || key === "record" || key === "awards") {
    return "desc"; // higher = first
  } else if (key === "bta_rtg" || key === "adj_de") {
    return "asc"; // lower-is-better: BTA rank #1 first, lowest DRTG first
  } else {
    return "asc"; // alphabetical
  }
}

export function awardsRank(s: CoachSeason): number {
  // Higher value = more impressive achievement, so descending puts these on top.
  if (s.round === "Champion") return 10;
  if (s.round === "Runner-up") return 9;
  if (s.round === "Final Four") return 8;
  if (s.round === "Elite Eight") return 7;
  if (s.round === "Sweet 16") return 6;
  if (s.round === "R32") return 5;
  if (s.round === "R64") return 4;
  if (s.seed != null) return 3;
  if (s.reg_season_conf_champ) return 2;
  return 0;
}

export type SeasonAward = { label: string; tone: "coral" | "muted" };

/** The award pills for one season: regular-season title, then the NCAA result. */
export function seasonAwards(season: CoachSeason): SeasonAward[] {
  const awards: SeasonAward[] = [];
  if (season.reg_season_conf_champ) {
    awards.push({ label: "Reg. season champ", tone: "coral" });
  }
  if (season.seed !== null) {
    const roundLabel =
      season.round === "Champion" ? "NCAA Champion"
      : season.round === "Runner-up" ? "NCAA Title runner-up"
      : season.round === "Final Four" ? "NCAA Final Four"
      : season.round === "Elite Eight" ? "NCAA Elite Eight"
      : season.round === "Sweet 16" ? "NCAA Sweet 16"
      : season.round === "R32" ? "NCAA Second Round"
      : season.round === "R64" ? "NCAA First Round"
      : season.round === "First Four" ? "NCAA First Four"
      : "NCAA Tournament";
    awards.push({ label: roundLabel, tone: "coral" });
  }
  return awards;
}

// ---------- compare modal ----------

export type CompareDirection = "higher" | "lower" | "depth" | "none";

// Friendly short labels for best_finish display.
export const FINISH_LABEL: Record<string, string> = {
  "First Four": "First Four",
  "R64": "Round of 64",
  "R32": "Round of 32",
  "Sweet 16": "Sweet 16",
  "Elite Eight": "Elite Eight",
  "Final Four": "Final Four",
  "Runner-up": "Title game",
  "Champion": "National title",
};

export type CompareRow = {
  key: string;
  label: string;
  /** Per-coach raw value (used for max/min comparison). Null = "—". */
  value: (c: CoachIndexRow) => number | string | null;
  /** What value is "best": higher number, lower number, deeper bracket round, or no comparison. */
  dir: CompareDirection;
  /** Formatter for display. Default: stringify. */
  format?: (v: number | string | null) => string;
};

function fmtPct(v: number | null): string {
  if (v === null) return "—";
  return (v * 100).toFixed(1) + "%";
}
function fmtRec(c: CoachIndexRow): string {
  return `${c.career_wins}-${c.career_losses}`;
}

export const COMPARE_ROWS: CompareRow[] = [
  { key: "titles", label: "National titles", value: (c) => c.ncaa_titles, dir: "higher" },
  { key: "f4", label: "Final Fours", value: (c) => c.final_fours, dir: "higher" },
  { key: "s16", label: "Sweet 16+ trips", value: (c) => c.sweet_sixteens, dir: "higher" },
  { key: "ncaa", label: "NCAA Tournament trips", value: (c) => c.ncaa_appearances, dir: "higher" },
  { key: "best", label: "Deepest run", value: (c) => c.best_finish, dir: "depth",
    format: (v) => (v == null || typeof v !== "string") ? "—" : (FINISH_LABEL[v] ?? v) },
  { key: "powerch", label: "Power reg-season titles", value: (c) => c.power_reg_champs, dir: "higher" },
  { key: "regch", label: "Reg-season conf titles", value: (c) => c.reg_season_champs, dir: "higher" },
  { key: "20w", label: "20+ win seasons", value: (c) => c.twenty_win_seasons, dir: "higher" },
  { key: "30w", label: "30+ win seasons", value: (c) => c.thirty_win_seasons, dir: "higher" },
  { key: "wins", label: "Career wins", value: (c) => c.career_wins, dir: "higher" },
  { key: "rec", label: "Career W-L", value: (c) => fmtRec(c), dir: "none" },
  { key: "winpct", label: "Career win %", value: (c) => c.career_win_pct, dir: "higher",
    format: (v) => fmtPct(typeof v === "number" ? v : null) },
  { key: "seas", label: "Seasons coached", value: (c) => c.seasons_count, dir: "higher" },
  // Composite score row — has special formatter in render that appends a (#rank)
  // suffix from the global ranking across allCoaches.
  { key: "comp", label: "Composite score", value: (c) => c.composite_score ?? null, dir: "higher" },
];

/**
 * Composite rank lookup — coaches sorted desc by composite_score, position
 * becomes the rank. Used to render "270.4 (#1)" in the Composite Score row.
 */
export function compositeRankLookup(allCoaches: readonly CoachIndexRow[]): Map<string, number> {
  const m = new Map<string, number>();
  const ranked = allCoaches
    .filter((c) => c.composite_score != null)
    .sort((a, b) => (b.composite_score ?? 0) - (a.composite_score ?? 0));
  ranked.forEach((c, i) => m.set(c.slug, i + 1));
  return m;
}

/**
 * One cell's text. Shared because the phone and desktop bodies are two
 * different layouts over the same numbers, and the composite row's "(#12)"
 * suffix is exactly the sort of thing that goes stale in one copy.
 */
export function compareCellDisplay(
  row: CompareRow,
  c: CoachIndexRow,
  compositeRankBySlug: ReadonlyMap<string, number>,
): string {
  const raw = row.value(c);
  if (row.key === "comp") {
    if (typeof raw !== "number") return "—";
    const rank = compositeRankBySlug.get(c.slug);
    return rank != null ? `${raw.toFixed(1)} (#${rank})` : raw.toFixed(1);
  }
  if (row.format) return row.format(raw);
  return raw == null ? "—" : String(raw);
}

/**
 * The best and worst coach on one row, by slug, among the coaches being
 * compared. Null when the row does not compare, fewer than two coaches have a
 * value, or the extreme is shared — ties get neither.
 */
export function compareRowExtremes(
  row: CompareRow,
  filledCoaches: readonly CoachIndexRow[],
): { bestKey: string | null; worstKey: string | null } {
  if (row.dir === "none") return { bestKey: null, worstKey: null };
  const entries = filledCoaches.map((c) => ({ slug: c.slug, raw: row.value(c) }));
  if (entries.length < 2) return { bestKey: null, worstKey: null };

  if (row.dir === "depth") {
    const numbered = entries.map((e) => ({ slug: e.slug, n: typeof e.raw === "string" ? ((TOURNEY_ROUND_DEPTH as Record<string, number>)[e.raw] ?? -1) : -1 }));
    const max = Math.max(...numbered.map((x) => x.n));
    const min = Math.min(...numbered.map((x) => x.n));
    if (max === min) return { bestKey: null, worstKey: null };
    const bestSlugs = numbered.filter((x) => x.n === max).map((x) => x.slug);
    const worstSlugs = numbered.filter((x) => x.n === min).map((x) => x.slug);
    return { bestKey: bestSlugs.length === 1 ? bestSlugs[0]! : null, worstKey: worstSlugs.length === 1 ? worstSlugs[0]! : null };
  }
  const nums = entries.map((e) => ({ slug: e.slug, n: typeof e.raw === "number" ? e.raw : NaN }));
  const valid = nums.filter((x) => Number.isFinite(x.n));
  if (valid.length < 2) return { bestKey: null, worstKey: null };
  const max = Math.max(...valid.map((x) => x.n));
  const min = Math.min(...valid.map((x) => x.n));
  if (max === min) return { bestKey: null, worstKey: null };
  const bestN = row.dir === "higher" ? max : min;
  const worstN = row.dir === "higher" ? min : max;
  const bestSlugs = valid.filter((x) => x.n === bestN).map((x) => x.slug);
  const worstSlugs = valid.filter((x) => x.n === worstN).map((x) => x.slug);
  return { bestKey: bestSlugs.length === 1 ? bestSlugs[0]! : null, worstKey: worstSlugs.length === 1 ? worstSlugs[0]! : null };
}
