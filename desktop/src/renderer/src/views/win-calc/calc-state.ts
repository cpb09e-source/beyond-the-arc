import type { Op } from "@/lib/game-filters";
import { ALL_SEASONS, SEASON_CEIL } from "@/lib/seasons";
import {
  CALC_CONFERENCES,
  CALC_STAT_KEYS,
  MAX_CONDITIONS,
  colsOf,
  rowsToFilters,
  type CalcForm,
  type CalcRow,
  type CalcScope,
  type Venue,
} from "@/lib/win-calc";

/**
 * A Win Calculator question as its tab carries it.
 *
 * THE QUESTION IS THE TAB'S QUERY. Everything that decides the answer (seasons,
 * scope, conditions and their order) round-trips through one string, so a
 * favorite keeps the question, Alt+Left goes back to the previous one, a
 * duplicated tab asks the same thing, and a restart reopens it. What is only
 * about looking at the answer (the text filter, a season picked in the chart)
 * stays in the view.
 *
 *   y=2026,2025  v=home  q=1,2  cf=ACC|B10  t=Duke  co=Jon Scheyer  o=Kentucky
 *   d1=0  c=fg3_pct~gte~40,tov_diff~lt~0,ortg~gte~
 *
 * Defaults are left out, so the empty string is the latest season with every
 * D-I game and nothing asked. Anything unrecognised is dropped on the way in
 * rather than trusted: a stat that no longer exists, a season outside the data.
 */

export type CalcState = CalcForm & { d1Only: boolean };

export const DEFAULT_CALC: CalcState = {
  years: [SEASON_CEIL],
  conferences: [],
  teams: [],
  coaches: [],
  opponents: [],
  quads: [],
  venue: "all",
  rows: [],
  d1Only: true,
};

const STAT_ORDER = [...CALC_STAT_KEYS];
const OPS: ReadonlySet<string> = new Set<Op>(["gt", "gte", "lt", "lte", "eq"]);
const VENUES: ReadonlySet<string> = new Set<Venue>(["home", "away", "neutral"]);
const CONF_CODES: ReadonlySet<string> = new Set(CALC_CONFERENCES.map((c) => c.value));
/** What a value box accepts while typing: "-", "4", "40.", "-3.5". */
export const VALUE_PATTERN = /^-?[0-9]*\.?[0-9]*$/;

/**
 * A row's id, from its stat and how many rows of that stat come before it. The
 * same condition keeps its id when rows move around it, which is what lets a
 * dragged chip slide rather than blink.
 */
export function withIds(rows: ReadonlyArray<Omit<CalcRow, "id">>): CalcRow[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const n = seen.get(r.stat) ?? 0;
    seen.set(r.stat, n + 1);
    return { ...r, id: (STAT_ORDER.indexOf(r.stat) + 1) * 32 + n };
  });
}

const names = (v: string | null): string[] =>
  v ? [...new Set(v.split("|").map((s) => s.trim()).filter(Boolean))] : [];

export function parseCalc(query: string): CalcState {
  const p = new URLSearchParams(query);

  const y = p.get("y");
  const years =
    y === "all"
      ? [...ALL_SEASONS]
      : [...new Set((y ?? "").split(",").map(Number))].filter((n) => ALL_SEASONS.includes(n)).sort((a, b) => b - a);

  const rows = withIds(
    (p.get("c") ?? "")
      .split(",")
      .map((part) => part.split("~"))
      .filter(([stat, op, value = ""]) => !!stat && CALC_STAT_KEYS.has(stat) && !!op && OPS.has(op) && VALUE_PATTERN.test(value))
      .slice(0, MAX_CONDITIONS)
      .map(([stat, op, value = ""]) => ({ stat: stat!, op: op as Op, value })),
  );

  const v = p.get("v");
  return {
    years: years.length ? years : [SEASON_CEIL],
    conferences: names(p.get("cf")).filter((c) => CONF_CODES.has(c)),
    teams: names(p.get("t")),
    coaches: names(p.get("co")),
    opponents: names(p.get("o")),
    quads: [...new Set((p.get("q") ?? "").split(","))].filter((q) => ["1", "2", "3", "4"].includes(q)).sort(),
    venue: v && VENUES.has(v) ? (v as Venue) : "all",
    rows,
    d1Only: p.get("d1") !== "0",
  };
}

export function serializeCalc(s: CalcState): string {
  const parts: string[] = [];
  const years = [...new Set(s.years)].sort((a, b) => b - a);
  if (years.length === ALL_SEASONS.length) parts.push("y=all");
  else if (!(years.length === 1 && years[0] === SEASON_CEIL)) parts.push(`y=${years.join(",")}`);
  const put = (key: string, value: string) => parts.push(`${key}=${encodeURIComponent(value)}`);
  if (s.venue !== "all") put("v", s.venue);
  if (s.quads.length) put("q", [...s.quads].sort().join(","));
  if (s.conferences.length) put("cf", s.conferences.join("|"));
  if (s.teams.length) put("t", s.teams.join("|"));
  if (s.coaches.length) put("co", s.coaches.join("|"));
  if (s.opponents.length) put("o", s.opponents.join("|"));
  if (!s.d1Only) parts.push("d1=0");
  if (s.rows.length) put("c", s.rows.map((r) => `${r.stat}~${r.op}~${r.value}`).join(","));
  return parts.join("&");
}

export const scopeOf = (s: CalcState): CalcScope => ({
  conferences: s.conferences,
  teams: s.teams,
  coaches: s.coaches,
  venue: s.venue,
  opponents: s.opponents,
  quads: s.quads.length === 4 ? [] : s.quads,
  d1Only: s.d1Only,
});

/** Whether the question narrows anything: otherwise the answer is every game, which is no answer. */
export function isAsking(s: CalcState): boolean {
  return (
    rowsToFilters(s.rows).length > 0 ||
    s.teams.length > 0 ||
    s.coaches.length > 0 ||
    s.conferences.length > 0 ||
    s.opponents.length > 0 ||
    s.venue !== "all" ||
    (s.quads.length > 0 && s.quads.length < 4)
  );
}

/** The results table's condition columns, in row order. */
export const columnsOf = (s: CalcState): string[] => colsOf(s.rows);
