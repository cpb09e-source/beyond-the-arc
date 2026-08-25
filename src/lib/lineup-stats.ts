/**
 * The lineup stat model: what is stored, what is derived, and how a row is
 * placed against the league.
 *
 * ONE SOURCE FOR THE FORMULAS. The build script (build-lineup-stats.mts, run
 * under tsx) imports this to compute the league benchmarks, and the browser
 * imports it to compute every row. If the two ever disagreed, chips would sit
 * beside numbers they do not describe — a failure that looks like data rather
 * than a bug, so there cannot be two copies.
 *
 * STORED VALUES ARE COUNTS, DERIVED VALUES ARE RATES. Everything the page can
 * do — pick a lineup, pick a 2-man combo, filter to X-on and Y-off, read the
 * Totals row — is the same operation: select the five-man rows that match, sum
 * the counts, then compute the rates from the sums. Rates cannot be averaged,
 * weighted or otherwise; a 3-possession unit shooting 100% would pull a season
 * eFG% as hard as a 300-possession one. This is why nothing here is stored
 * pre-divided.
 */

/** Column order in the shipped `s` array. Mirrors COLS in the build script. */
export type LineupTotals = {
  gp: number; secs: number; poss: number; oppPoss: number;
  pts: number; oppPts: number;
  fga: number; fgm: number; fg3a: number; fg3m: number;
  rima: number; rimm: number; mida: number; midm: number;
  fta: number; ftm: number;
  oreb: number; dreb: number; ast: number; stl: number; blk: number; pf: number; tov: number;
  oppFga: number; oppFgm: number; oppFg3a: number; oppFg3m: number;
  oppFta: number; oppFtm: number;
  oppOreb: number; oppDreb: number; oppAst: number; oppStl: number;
  oppBlk: number; oppPf: number; oppTov: number;
};

export const EMPTY_TOTALS: LineupTotals = {
  gp: 0, secs: 0, poss: 0, oppPoss: 0, pts: 0, oppPts: 0,
  fga: 0, fgm: 0, fg3a: 0, fg3m: 0, rima: 0, rimm: 0, mida: 0, midm: 0, fta: 0, ftm: 0,
  oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, pf: 0, tov: 0,
  oppFga: 0, oppFgm: 0, oppFg3a: 0, oppFg3m: 0, oppFta: 0, oppFtm: 0,
  oppOreb: 0, oppDreb: 0, oppAst: 0, oppStl: 0, oppBlk: 0, oppPf: 0, oppTov: 0,
};

/**
 * Sum any set of lineups into one totals object.
 *
 * `gp` is summed rather than deduplicated, so it reads as unit-games, not
 * team-games: five units that each played the same game sum to 5, not 1. On a
 * single lineup row it is the games that unit appeared in, which is what a
 * reader expects; on an aggregate it is a coarse volume signal and the honest
 * columns to read are POSS and MINS. Deduplicating would need every lineup's
 * game list in the payload, which is many times the size of the stats.
 */
export function sumTotals(rows: LineupTotals[]): LineupTotals {
  const out: LineupTotals = { ...EMPTY_TOTALS };
  for (const r of rows) {
    for (const k of Object.keys(out) as (keyof LineupTotals)[]) out[k] += r[k] ?? 0;
  }
  return out;
}

export type StatFormat = "num1" | "signed" | "pct1" | "int";

export type LineupStat = {
  key: string;
  label: string;
  /** Band the column sits in, for the header groups. */
  group: "volume" | "efficiency" | "four" | "opp" | "shooting" | "playmaking" | "defense";
  title: string;
  format: StatFormat;
  /** Ascending is the "good" direction (defensive rating, turnovers). */
  lowerBetter?: boolean;
  /** Rate columns get a percentile chip; volume columns do not. */
  ranked: boolean;
  value: (t: LineupTotals) => number | null;
};

const div = (a: number, b: number): number | null => (b > 0 ? a / b : null);
/** Per-100-possession rate. */
const per100 = (a: number, poss: number): number | null => (poss > 0 ? (a / poss) * 100 : null);

/**
 * Possessions are the box estimate (FGA − OREB + TO + 0.475·FTA) carried
 * through from the stints, so they are fractional and can be zero on a stint
 * fragment. Every denominator here guards on > 0 rather than != 0.
 */
export const LINEUP_STATS: LineupStat[] = [
  // ---- volume: context, never ranked. A lineup is not "good" for playing more.
  { key: "gp", label: "GP", group: "volume", title: "Games this unit appeared in. On a filtered total it counts unit-games, not team-games.", format: "int", ranked: false, value: (t) => t.gp },
  { key: "poss", label: "POSS", group: "volume", title: "Offensive possessions (FGA − OREB + TO + 0.475·FTA)", format: "int", ranked: false, value: (t) => t.poss },
  { key: "mins", label: "MINS", group: "volume", title: "Minutes on the floor together", format: "int", ranked: false, value: (t) => t.secs / 60 },

  // ---- efficiency
  // NOT ranked, unlike every other efficiency column. +/- is a COUNT, so it
  // scales with playing time: a 3-man combo pools the minutes of every lineup
  // those three appeared in, and lands past the top of a league field built
  // from five-man units. Every such row chipped at 100, which said nothing
  // except "this row aggregates more possessions than a lineup does". Net Rtg
  // is the same quantity per 100 possessions and is ranked in its place.
  { key: "plusMinus", label: "+/-", group: "efficiency", title: "Points scored minus points allowed while this unit was on the floor. Not ranked: it scales with minutes, so combos and totals are not comparable to single lineups.", format: "signed", ranked: false, value: (t) => t.pts - t.oppPts },
  { key: "net", label: "Net Rtg", group: "efficiency", title: "Points scored minus allowed per 100 possessions", format: "num1", ranked: true, value: (t) => { const o = per100(t.pts, t.poss), d = per100(t.oppPts, t.oppPoss); return o === null || d === null ? null : o - d; } },
  { key: "ortg", label: "ORtg", group: "efficiency", title: "Points scored per 100 possessions", format: "num1", ranked: true, value: (t) => per100(t.pts, t.poss) },
  { key: "drtg", label: "DRtg", group: "efficiency", title: "Points allowed per 100 possessions (lower is better)", format: "num1", lowerBetter: true, ranked: true, value: (t) => per100(t.oppPts, t.oppPoss) },
  { key: "pace", label: "Pace", group: "efficiency", title: "Possessions per 40 minutes", format: "num1", ranked: false, value: (t) => (t.secs > 0 ? ((t.poss + t.oppPoss) / 2) / (t.secs / 2400) : null) },

  // ---- four factors, offence
  { key: "efg", label: "eFG%", group: "four", title: "Effective field-goal % — (FGM + 0.5 × 3PM) / FGA", format: "pct1", ranked: true, value: (t) => div(t.fgm + 0.5 * t.fg3m, t.fga) },
  { key: "oreb", label: "OREB%", group: "four", title: "Share of available offensive rebounds collected", format: "pct1", ranked: true, value: (t) => div(t.oreb, t.oreb + t.oppDreb) },
  { key: "tov", label: "TOV%", group: "four", title: "Turnovers per possession (lower is better)", format: "pct1", lowerBetter: true, ranked: true, value: (t) => div(t.tov, t.poss) },
  { key: "ftar", label: "FTAR", group: "four", title: "Free-throw attempt rate — FTA / FGA", format: "pct1", ranked: true, value: (t) => div(t.fta, t.fga) },

  // ---- four factors, defence
  { key: "oppEfg", label: "Opp eFG%", group: "opp", title: "Opponent effective field-goal % (lower is better)", format: "pct1", lowerBetter: true, ranked: true, value: (t) => div(t.oppFgm + 0.5 * t.oppFg3m, t.oppFga) },
  { key: "dreb", label: "DRB%", group: "opp", title: "Share of available defensive rebounds collected", format: "pct1", ranked: true, value: (t) => div(t.dreb, t.dreb + t.oppOreb) },
  { key: "oppTov", label: "Opp TOV%", group: "opp", title: "Opponent turnovers per possession — turnovers forced", format: "pct1", ranked: true, value: (t) => div(t.oppTov, t.oppPoss) },
  { key: "oppFtar", label: "Opp FTAR", group: "opp", title: "Opponent free-throw attempt rate (lower is better)", format: "pct1", lowerBetter: true, ranked: true, value: (t) => div(t.oppFta, t.oppFga) },

  // ---- shooting detail
  { key: "fg3ar", label: "3PAR", group: "shooting", title: "Three-point attempt rate — 3PA / FGA", format: "pct1", ranked: true, value: (t) => div(t.fg3a, t.fga) },
  { key: "fg3", label: "3P%", group: "shooting", title: "Three-point percentage", format: "pct1", ranked: true, value: (t) => div(t.fg3m, t.fg3a) },
  { key: "rimr", label: "Rim Rate", group: "shooting", title: "Share of field-goal attempts taken at the rim", format: "pct1", ranked: true, value: (t) => div(t.rima, t.fga) },
  { key: "rimfg", label: "Rim FG%", group: "shooting", title: "Field-goal percentage at the rim", format: "pct1", ranked: true, value: (t) => div(t.rimm, t.rima) },
  { key: "ft", label: "FT%", group: "shooting", title: "Free-throw percentage", format: "pct1", ranked: true, value: (t) => div(t.ftm, t.fta) },

  // ---- playmaking
  { key: "astr", label: "AST%", group: "playmaking", title: "Share of made field goals that were assisted", format: "pct1", ranked: true, value: (t) => div(t.ast, t.fgm) },
  { key: "astto", label: "AST/TO", group: "playmaking", title: "Assists per turnover", format: "num1", ranked: true, value: (t) => div(t.ast, t.tov) },

  // ---- defence detail
  { key: "stlr", label: "STL%", group: "defense", title: "Steals per opponent possession", format: "pct1", ranked: true, value: (t) => div(t.stl, t.oppPoss) },
  { key: "blkr", label: "BLK%", group: "defense", title: "Blocks per opponent field-goal attempt", format: "pct1", ranked: true, value: (t) => div(t.blk, t.oppFga) },
  {
    key: "hakeem", label: "Hakeem%", group: "defense",
    // Named for Olajuwon, the only player to lead the NBA in both. It is the
    // sum of the two rates, matching how CBB Analytics reports it — checked
    // against a published team card where 9.1 steal + 9.8 block read as 19.0.
    title: "Steal% + Block% — combined defensive event rate",
    format: "pct1", ranked: true,
    value: (t) => { const s = div(t.stl, t.oppPoss), b = div(t.blk, t.oppFga); return s === null || b === null ? null : s + b; },
  },
  { key: "pfr", label: "PF/100", group: "defense", title: "Fouls committed per 100 opponent possessions (lower is better)", format: "num1", lowerBetter: true, ranked: true, value: (t) => per100(t.pf, t.oppPoss) },
];

export const STAT_BY_KEY = new Map(LINEUP_STATS.map((s) => [s.key, s]));

/**
 * The possession floor a row must clear to be ranked against the league.
 *
 * A QUALIFICATION threshold, not a filter. Every lineup ships and every lineup
 * renders; this only decides which rows get a percentile chip and which read
 * DNQ. Vermont's qualifying units are under half its possessions, so filtering
 * on this would silently hide most of a season.
 */
export const MIN_POSS = 30;

/** Percentile breakpoints for one season's qualifying lineups, per stat key. */
export type LineupBenchmarks = {
  season: number;
  n: number;
  /** stat key -> 101 ascending values, index i = the i-th percentile. */
  q: Record<string, number[]>;
};

/**
 * Where a value sits in the league distribution, 0-100.
 *
 * Binary search into the breakpoint array rather than a stored percentile,
 * because the row being placed usually does not exist in the league set: a
 * 2-man combo, or the Totals of an on/off filter, is an aggregate nobody
 * precomputed. One code path places all of them.
 *
 * Returns null when the stat is unranked, the value is missing, or the season
 * has no benchmarks — the caller renders no chip rather than a misleading one.
 */
export function percentileOf(
  stat: LineupStat,
  value: number | null,
  benchmarks: LineupBenchmarks | null,
): number | null {
  if (!stat.ranked || value === null || !Number.isFinite(value) || !benchmarks) return null;
  const arr = benchmarks.q[stat.key];
  if (!arr || arr.length < 2) return null;
  let lo = 0, hi = arr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  const pct = Math.round((lo / (arr.length - 1)) * 100);
  // Low is good for these, so flip the scale rather than the comparison — the
  // chip's colour reads "better" at high numbers everywhere on the page.
  return stat.lowerBetter ? 100 - pct : pct;
}

export function formatStat(v: number | null, fmt: StatFormat): string {
  if (v === null || !Number.isFinite(v)) return "—";
  if (fmt === "pct1") return (v * 100).toFixed(1) + "%";
  if (fmt === "signed") return (v > 0 ? "+" : "") + Math.round(v).toLocaleString("en-US");
  if (fmt === "int") return Math.round(v).toLocaleString("en-US");
  return v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
