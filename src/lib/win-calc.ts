import { CONF_DISPLAY, confDisplay } from "@/lib/conf-display";
import { POWER_CONFS } from "@/lib/conf-tiers";
import { FLAG_KEYS, cleanLabel, isPctKey } from "@/lib/condition-stats";
import { attachGameBox, type GameBoxFile } from "@/lib/game-box";
import { CALC_STAT_OPTIONS, OPS, matches, type Filter, type GameLog, type Op } from "@/lib/game-filters";
import { gameKey, normTeamKey, quadFor, ratingKey, type TeamRatingsFile } from "@/lib/quad";
import { resolveQuery, type ParsedQuery, type ResolvedQuery } from "@/lib/query-parse";
import { ALL_SEASONS, isExhibitionGame } from "@/lib/seasons";

/**
 * The Win Calculator: "when this happened, how often did the team win?"
 *
 * Everything the calculator decides, and nothing it draws. Out of
 * src/components/calc/calc-client.tsx and src/app/calc/page.tsx, so the site's
 * /calc and the desktop app's Win Calculator run one set of rules: which games
 * a season holds, how a condition row becomes a filter, how a plain-English
 * answer lands in the form, and what the record is.
 */

// Venue buckets. A neutral-site game appears twice in the logs (once per
// team) with is_neutral true on both rows, so neutral must be tested BEFORE
// is_home — otherwise half of every neutral game counts as "home".
export type Venue = "all" | "home" | "away" | "neutral";
export function venueOf(g: GameLog): Exclude<Venue, "all"> {
  if (g.is_neutral) return "neutral";
  return g.is_home ? "home" : "away";
}
export const VENUE_OPTIONS: Array<{ value: Venue; label: string }> = [
  { value: "all",     label: "All venues" },
  { value: "home",    label: "Home" },
  { value: "away",    label: "Away" },
  { value: "neutral", label: "Neutral" },
];

/**
 * Static conference list, grouped and ordered exactly as the front page's
 * picker has it — power conferences first, alphabetical within each group.
 *
 * Static rather than derived from loaded games, which made the list change
 * as season files streamed in. CONF_DISPLAY is the app's master code list;
 * GWC is dropped because it folded before our 2014 data floor, so it could
 * only ever be a dead option.
 */
export const CONF_GROUP_LABELS = { power: "Power Conferences", midmajor: "Mid-Majors" } as const;
export type CalcConference = { value: string; label: string; group: keyof typeof CONF_GROUP_LABELS };
export const CALC_CONFERENCES: CalcConference[] = Object.keys(CONF_DISPLAY)
  .filter((c) => c !== "GWC")
  .map((c): CalcConference => ({ value: c, label: confDisplay(c), group: POWER_CONFS.has(c) ? "power" : "midmajor" }))
  .sort((a, b) => (a.group !== b.group ? (a.group === "power" ? -1 : 1) : a.label.localeCompare(b.label)));

/** Ceiling on rows. Each one is a column in the results table. */
export const MAX_CONDITIONS = 12;

/**
 * A condition being edited. `value` is what was typed, in display units. A row
 * with a value is a condition; a row left blank is a column in the
 * matching-games table and filters nothing.
 */
export type CalcRow = { id: number; stat: string; op: Op; value: string };

export const statLabel = (key: string): string =>
  cleanLabel(CALC_STAT_OPTIONS.find((s) => s.key === key)?.label ?? key);

/** Rows → the filters the calculator runs. A blank numeric row filters nothing. */
export function rowsToFilters(rows: ReadonlyArray<CalcRow>): Filter[] {
  const out: Filter[] = [];
  for (const r of rows) {
    if (FLAG_KEYS.has(r.stat)) {
      out.push({ id: String(r.id), stat: r.stat, op: "eq", value: r.value === "0" ? 0 : 1 });
      continue;
    }
    const raw = r.value.trim();
    const n = Number(raw);
    if (raw === "" || !Number.isFinite(n)) continue;
    out.push({ id: String(r.id), stat: r.stat, op: r.op, value: isPctKey(r.stat) ? n / 100 : n });
  }
  return out;
}
/** Every stat with a row, once, in row order — the results table's columns. */
export const colsOf = (rows: ReadonlyArray<CalcRow>): string[] => [...new Set(rows.map((r) => r.stat))];
/** A parsed condition's value the way a reader would have typed it. */
export function rowValue(stat: string, v: number): string {
  if (FLAG_KEYS.has(stat)) return v === 0 ? "0" : "1";
  return String(isPctKey(stat) ? Math.round(v * 1000) / 10 : v);
}
/** A fresh row for a stat: flags start at Yes, everything else blank. */
export function newRow(stat: string, id: number): CalcRow {
  const def = CALC_STAT_OPTIONS.find((s) => s.key === stat);
  return {
    id,
    stat,
    op: FLAG_KEYS.has(stat) ? "eq" : def?.defaultDir === "lt" ? "lte" : "gte",
    value: FLAG_KEYS.has(stat) ? "1" : "",
  };
}

/** Format a value the way the stat reads: 40% / +5 / 72.5. */
export function fmtCondValue(key: string, v: number): string {
  if (isPctKey(key)) return `${Math.round(v * 1000) / 10}%`;
  if (key.endsWith("_diff") || key.endsWith("_margin")) return v > 0 ? `+${v}` : String(v);
  return String(Math.round(v * 10) / 10);
}

// Format a game-log stat value for display. Flags → Yes/No, percentages →
// "55.5%", diff stats → signed integers ("+8" / "-5"), everything else → 1 dp.
export function formatStat(v: number | string | boolean | null, key: string): string {
  if (typeof v !== "number") return "—";
  if (FLAG_KEYS.has(key)) return v === 1 ? "Yes" : v === 0 ? "No" : "—";
  if (isPctKey(key)) return (v * 100).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "%";
  if (key.endsWith("_diff")) return v > 0 ? `+${v}` : String(v);
  if (key === "poss" || key === "pace") return v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return v.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

/** One condition as a sentence fragment: "3P% ≥ 40%", "NCAA Tournament: Yes". */
export function labelFor(f: Filter): string {
  const key = String(f.stat);
  const stat = cleanLabel(CALC_STAT_OPTIONS.find((s) => s.key === f.stat)?.label ?? key);
  if (FLAG_KEYS.has(key)) return `${stat}: ${f.value === 1 ? "Yes" : "No"}`;
  const op = OPS.find((o) => o.value === f.op)?.label ?? f.op;
  return `${stat} ${op} ${fmtCondValue(key, f.value)}`;
}

/**
 * Attach opponent rank + quadrant to one season's rows.
 *
 * The opponent is found by pairing rows on the shared numeric prefix of
 * game_id rather than by matching opp_team_market, which is a third name
 * space. A game with no paired row is a non-D1 opponent (~5% of rows) and gets
 * a null rank, which quadFor() maps to Q4 — matching how the committee treats
 * non-D1 games.
 */
export function enrichWithQuad(rows: GameLog[], ratings: TeamRatingsFile | null): GameLog[] {
  const rankByTeam = new Map<string, number>();
  if (ratings) for (const t of ratings.teams) rankByTeam.set(normTeamKey(t.team), t.rank_net);

  const byGame = new Map<string, GameLog[]>();
  for (const r of rows) {
    const k = gameKey(r.game_id);
    const arr = byGame.get(k);
    if (arr) arr.push(r);
    else byGame.set(k, [r]);
  }

  return rows.map((r) => {
    const pair = byGame.get(gameKey(r.game_id));
    const opp = pair && pair.length > 1 ? pair.find((x) => x !== r) : undefined;
    const oppRank = opp ? rankByTeam.get(ratingKey(opp.team_name)) ?? null : null;
    // No paired row means the opponent isn't a D1 team in our data.
    return { ...r, opp_rank: oppRank, quad: quadFor(oppRank, venueOf(r)), non_d1: !opp };
  });
}

/**
 * One season as the calculator runs it, from its three files: the game logs,
 * the ratings that place each opponent in a quadrant (~80 KB, optional), and
 * the per-game box sidecar (~2 MB, optional; a missing file leaves those
 * fields null).
 *
 * Preseason exhibitions are not real results — dropped before enrichment so
 * they can't reach the record, win%, or quadrant math.
 */
export function prepareSeason(
  year: number,
  logs: GameLog[],
  ratings: TeamRatingsFile | null,
  box: GameBoxFile | null,
): GameLog[] {
  return attachGameBox(
    enrichWithQuad(logs.filter((g) => !isExhibitionGame(g.game_date, year)), ratings),
    box,
  );
}

/** Everything besides the conditions that narrows which games count. */
export type CalcScope = {
  conferences: string[];
  teams: string[];
  coaches: string[];
  venue: Venue;
  opponents: string[];
  quads: string[];
  d1Only: boolean;
};

export type CalcResult<G extends GameLog = GameLog> = {
  total: number;
  wins: number;
  losses: number;
  winPct: number;
  /** Signed. Null when no matching game has a margin. */
  avgMargin: number | null;
  matching: G[];
};

/**
 * The answer: every game in scope where every condition held, and the record
 * in them. `coachByTeamYear` resolves which games belong to a coach, since the
 * logs carry no coach of their own.
 */
export function runWinCalc<G extends GameLog>(
  games: G[],
  question: CalcScope & { filters: Filter[] },
  coachByTeamYear: Record<string, Record<number, string>>,
): CalcResult<G> {
  const confSet = question.conferences.length === 0 ? null : new Set(question.conferences);
  const teamSet = question.teams.length === 0 ? null : new Set(question.teams);
  const coachSet = question.coaches.length === 0 ? null : new Set(question.coaches);
  const oppSet = question.opponents.length === 0 ? null : new Set(question.opponents);
  const quadSet = question.quads.length === 0 ? null : new Set(question.quads);
  const matching = games.filter((g) => {
    if (confSet && (g.team_conference == null || !confSet.has(g.team_conference))) return false;
    if (teamSet && !teamSet.has(g.team_name)) return false;
    if (oppSet && (g.opp_team_market == null || !oppSet.has(g.opp_team_market))) return false;
    if (question.venue !== "all" && venueOf(g) !== question.venue) return false;
    if (quadSet && !quadSet.has(String(g.quad ?? 4))) return false;
    if (question.d1Only && g.non_d1) return false;
    if (coachSet) {
      const coach = coachByTeamYear[g.team_name]?.[g.year];
      if (!coach || !coachSet.has(coach)) return false;
    }
    return question.filters.every((f) => matches(g, f));
  });
  const wins = matching.filter((g) => g.won).length;
  const losses = matching.length - wins;
  // Average margin (signed). Positive => team typically won by X; negative
  // => team typically lost by X. Skips rows with null pts_diff so missing
  // data doesn't drag the mean toward zero.
  let marginSum = 0;
  let marginCount = 0;
  for (const g of matching) {
    if (typeof g.pts_diff === "number") {
      marginSum += g.pts_diff;
      marginCount++;
    }
  }
  const avgMargin = marginCount > 0 ? marginSum / marginCount : null;
  return {
    total: matching.length,
    wins,
    losses,
    winPct: matching.length === 0 ? 0 : wins / matching.length,
    avgMargin,
    matching,
  };
}

/**
 * The typical range for each stat, from the games loaded — the hint in an
 * empty value box. 5th to 95th percentile in display units, so a reader who
 * has never seen a TOV% learns that 12 is low and 22 is high before typing
 * anything. One pass over the games for every column at once.
 */
export function conditionBounds(games: GameLog[], cols: string[]): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  if (cols.length === 0) return out;
  const lists = new Map<string, number[]>(cols.map((k) => [k, []]));
  for (const g of games) {
    for (const [k, xs] of lists) {
      const v = g[k];
      if (typeof v === "number") xs.push(v);
    }
  }
  for (const [k, xs] of lists) {
    if (xs.length < 50) continue;
    // A typed array sorts numerically without a comparator, and in a
    // fraction of the time — this runs over up to 150,000 games.
    const a = Float64Array.from(xs).sort();
    const scale = isPctKey(k) ? 100 : 1;
    out.set(k, [
      Math.round(a[Math.floor(a.length * 0.05)]! * scale),
      Math.round(a[Math.floor(a.length * 0.95)]! * scale),
    ]);
  }
  return out;
}

/**
 * The teams to pick from, in the games loaded, narrowed by the conference
 * picker so the list shrinks as the reader commits to a conference (the
 * typical "Big 12 teams only" flow).
 */
export function teamNamesIn(games: GameLog[], conferences: string[]): string[] {
  const confSet = conferences.length === 0 ? null : new Set(conferences);
  const s = new Set<string>();
  for (const g of games) {
    if (confSet && (!g.team_conference || !confSet.has(g.team_conference))) continue;
    s.add(g.team_name);
  }
  return [...s].sort();
}

/**
 * The opponents to pick from — opp_team_market, which is its own name space.
 * Non-D1 opponents are left out of the PICKER (rows where the game has no
 * paired D1 row, ~400 names of noise); the games themselves stay in results
 * whenever the D-I only toggle is off.
 */
export function opponentNamesIn(games: GameLog[]): string[] {
  const s = new Set<string>();
  for (const g of games) if (g.opp_team_market && !g.non_d1) s.add(g.opp_team_market);
  return [...s].sort();
}

/** Every stat the calculator accepts from a parse. */
export const CALC_STAT_KEYS: ReadonlySet<string> = new Set(CALC_STAT_OPTIONS.map((o) => o.key as string));

/** Resolve a plain-English parse's free-text names against the calculator's real option lists. */
export function resolveCalcQuery(
  parsed: ParsedQuery,
  names: { coaches: string[]; teams: string[]; opponents: string[] },
): ResolvedQuery {
  return resolveQuery(parsed, {
    coaches: names.coaches,
    teams: names.teams,
    opponents: names.opponents,
    conferences: CALC_CONFERENCES.map((o) => ({ value: o.value, label: o.label })),
    validStats: new Set(CALC_STAT_KEYS),
    validSeasons: [...ALL_SEASONS],
  });
}

/** The question on screen, as the form holds it. */
export type CalcForm = {
  years: number[];
  conferences: string[];
  teams: string[];
  coaches: string[];
  opponents: string[];
  quads: string[];
  venue: Venue;
  rows: CalcRow[];
};

/**
 * Where a plain-English question leaves the form.
 *
 * Every dimension is resolved to its NEXT value here, then used for both the
 * form and the calculation, so nothing reads a value React has not applied yet.
 */
export function mergeParsedQuery(resolved: ResolvedQuery, current: CalcForm, nextId: () => number): CalcForm {
  // Seasons are the one dimension we must NOT leave alone when the question
  // didn't name one. The parser documents an empty list as "all seasons",
  // but the form defaults to the current season, so "what's Roy Williams'
  // record on the road" silently answered "...in 2025-26" — and he retired
  // in 2021. That renders as a confident 0-0, which reads as "never
  // happened" rather than "wrong years selected".
  //
  // So an unspecified season means every season, matching what the parser
  // already promises. This is deliberately universal rather than a
  // coach-shaped special case: a coach, a team, a conference or no subject
  // at all each get the full history unless the question names a year, and
  // a named year always wins.
  const years = resolved.seasons.length
    ? [...resolved.seasons].sort((a, b) => b - a)
    : [...ALL_SEASONS].sort((a, b) => b - a);
  // A QUESTION THAT NAMES A SUBJECT STARTS OVER. Anything it doesn't
  // mention is cleared rather than inherited.
  //
  // Dimensions the question didn't speak to used to keep their current
  // value unconditionally, so a follow-up ("...and only at home") could
  // refine instead of resetting. That is right for a follow-up and wrong
  // for a new question, and nothing told the two apart: asking about Bill
  // Self and then asking about Purdue kept Bill Self, so the second answer
  // was Purdue games coached by Bill Self — a coach who has never coached
  // there. Nought games, 0.0%, no error. The venue rode along the same way.
  //
  // Naming a team, coach, conference or opponent is the signal that the
  // subject has changed and the previous question is over. Ask something
  // with no subject at all ("...and only in Quad 1") and every carry-over
  // still applies, so refining a question keeps working.
  //
  // The cost is that "what about Purdue" drops the conditions from the
  // previous question — visible in the chips, and recoverable, where
  // inheriting a stale coach was neither.
  const namesSubject =
    resolved.resolved.teams.length > 0 ||
    resolved.resolved.coaches.length > 0 ||
    resolved.resolved.conferences.length > 0 ||
    resolved.resolved.opponents.length > 0;
  /** The parser's value, else the current one — unless the subject changed. */
  const keep = <T,>(next: T[], cur: T[]): T[] => (next.length ? next : namesSubject ? [] : cur);

  return {
    years,
    conferences: keep(resolved.resolved.conferences, current.conferences),
    teams: keep(resolved.resolved.teams, current.teams),
    coaches: keep(resolved.resolved.coaches, current.coaches),
    opponents: keep(resolved.resolved.opponents, current.opponents),
    quads: keep(resolved.quads.map(String), current.quads),
    venue: resolved.venue !== "all" ? resolved.venue : namesSubject ? "all" : current.venue,
    rows: resolved.conditions.length
      ? resolved.conditions.slice(0, MAX_CONDITIONS).map((c) => ({
          id: nextId(),
          stat: String(c.stat),
          op: c.op,
          value: rowValue(String(c.stat), c.value),
        }))
      : namesSubject
        ? []
        : current.rows,
  };
}

// Mirror src/lib/coaches.ts TEAM_NAME_OVERRIDES so the (team, year) coach
// lookup keys match the team_name strings that appear in game logs.
const TEAM_NAME_OVERRIDES: Record<string, string> = {
  "Southern California": "USC",
};
function overrideTeam(n: string): string { return TEAM_NAME_OVERRIDES[n] ?? n; }

export type CoachHistoryRaw = Record<string, Record<string, { name: string }>>;

/**
 * (team_name → year → coach name), and every coach sorted by last name then
 * first, from src/data/coach-history.json. Lets the Coach picker resolve which
 * games belong to a coach without a per-game coach field on the log itself.
 */
export function buildCoachLookup(raw: CoachHistoryRaw): {
  coachByTeamYear: Record<string, Record<number, string>>;
  allCoaches: string[];
} {
  const coachByTeamYear: Record<string, Record<number, string>> = {};
  const coachSet = new Set<string>();
  for (const [bartName, byYear] of Object.entries(raw)) {
    const team = overrideTeam(bartName);
    coachByTeamYear[team] = coachByTeamYear[team] ?? {};
    for (const [yearStr, s] of Object.entries(byYear)) {
      const y = Number(yearStr);
      if (!Number.isFinite(y)) continue;
      coachByTeamYear[team]![y] = s.name;
      coachSet.add(s.name);
    }
  }
  const allCoaches = [...coachSet].sort((a, b) => {
    // Sort by last name then first — matches how /coaches index sorts on ties.
    const la = (a.split(" ").pop() ?? a).toLowerCase();
    const lb = (b.split(" ").pop() ?? b).toLowerCase();
    if (la !== lb) return la.localeCompare(lb);
    return a.localeCompare(b);
  });
  return { coachByTeamYear, allCoaches };
}
