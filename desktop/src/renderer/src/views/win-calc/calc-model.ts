import { useCallback, useEffect, useMemo, useState } from "react";
import coachHistory from "@/data/coach-history.json";
import { isPctKey } from "@/lib/condition-stats";
import { CALC_STAT_OPTIONS, type GameLog } from "@/lib/game-filters";
import type { GameBoxFile } from "@/lib/game-box";
import type { TeamRatingsFile } from "@/lib/quad";
import { buildCoachLookup, formatStat, prepareSeason, type CoachHistoryRaw } from "@/lib/win-calc";
import { NO_PCT, midrankByValue } from "~/data/midrank-by-value";
import { loadOnce } from "~/data/use-corpus";
import { logoIdOf } from "~/ui/logo-id";

/**
 * The Win Calculator's seasons, loaded the way /calc loads them and kept for the
 * life of the window.
 *
 * ONE SEASON IS THREE FILES: the game logs, the box sidecar and the ratings
 * that rank each opponent into a quadrant, joined by the site's own
 * prepareSeason. A season is shaped once; asking a second question of it is
 * arithmetic, not a reload.
 *
 * NEWEST FIRST, ONE AT A TIME. Thirteen seasons are about 110 MB of JSON, and
 * parsing them all in one task would freeze the window for a second or two.
 * Each season yields back to the page before the next, so the progress line
 * moves and typing stays live while an all-seasons question loads.
 */

const loaded = new Map<number, GameLog[]>();
/** Where a row sits in its season, for the percentile columns. */
const place = new WeakMap<GameLog, number>();

async function loadSeason(year: number): Promise<GameLog[]> {
  const games = await loadOnce(`calc|${year}`, async () => {
    const [logs, box, ratings] = await Promise.all([
      window.bta.data("game-logs", year),
      window.bta.data("game-box", year),
      window.bta.data("team-ratings", year),
    ]);
    const value = prepareSeason(
      year,
      JSON.parse(logs.json) as GameLog[],
      JSON.parse(ratings.json) as TeamRatingsFile | null,
      JSON.parse(box.json) as GameBoxFile | null,
    );
    return { value, source: logs.source };
  });
  // Recorded here rather than inside the load, so a season already in the shared
  // cache (opened earlier by another tab) is placed too.
  if (games.length && !place.has(games[0]!)) games.forEach((g, i) => place.set(g, i));
  loaded.set(year, games);
  return games;
}

export type CalcSeasons = {
  /** Every selected season that is in, newest first. */
  games: GameLog[];
  ready: number;
  total: number;
  /** Every selected season is in: only then is an answer an answer. */
  complete: boolean;
  error: string | null;
  retry: () => void;
};

export function useCalcSeasons(years: number[]): CalcSeasons {
  const key = [...years].sort((a, b) => b - a).join(",");
  const [, setTick] = useState(0);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let stale = false;
    const wanted = key.split(",").map(Number).filter((y) => !loaded.has(y));
    if (wanted.length === 0) return;
    void (async () => {
      for (const y of wanted) {
        try {
          await loadSeason(y);
        } catch (err) {
          if (!stale) setError({ key, message: err instanceof Error ? err.message : String(err) });
          return;
        }
        if (stale) return;
        setTick((n) => n + 1);
        // Let the page paint the progress before the next parse.
        await new Promise((r) => setTimeout(r, 0));
      }
    })();
    return () => {
      stale = true;
    };
  }, [key, attempt]);

  const inHand = key.split(",").map(Number).filter((y) => loaded.has(y));
  const readyKey = inHand.join(",");
  const games = useMemo(
    () => (readyKey ? readyKey.split(",").flatMap((y) => loaded.get(Number(y)) ?? []) : []),
    [readyKey],
  );
  const retry = useCallback(() => {
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  const total = key.split(",").length;
  return {
    games,
    ready: inHand.length,
    total,
    complete: inHand.length === total,
    error: error?.key === key ? error.message : null,
    retry,
  };
}

/** The names Ask resolves against: everything loaded, plus every school the coach history knows. */
export function knownNames(): { teams: string[]; opponents: string[] } {
  const teams = new Set<string>(Object.keys(coachLookup().coachByTeamYear));
  const opponents = new Set<string>();
  for (const games of loaded.values()) {
    for (const g of games) {
      teams.add(g.team_name);
      if (g.opp_team_market && !g.non_d1) opponents.add(g.opp_team_market);
    }
  }
  for (const t of teams) opponents.add(t);
  return { teams: [...teams].sort(), opponents: [...opponents].sort() };
}

let coaches: ReturnType<typeof buildCoachLookup> | null = null;
/** (team → season → coach) and every coach, from the site's coach history, built on first use. */
export function coachLookup(): ReturnType<typeof buildCoachLookup> {
  coaches ??= buildCoachLookup(coachHistory as CoachHistoryRaw);
  return coaches;
}

// ─── Missing values ─────────────────────────────────────────────────────────

export type DataGap = { key: string; missing: number; total: number; years: number[] };

/**
 * Conditions on a stat that some games in scope have no value for.
 *
 * A game with no value fails every condition on that stat, whatever happened in
 * it, so the answer is drawn only from the games that recorded it. Several
 * stats are only partly recorded in older seasons (fast break points in about
 * three games of five before 2022-23; second-chance points not at all in
 * 2020-21), which a count on its own would never show. This says how many games
 * the question could not see, and the seasons where most of them sit.
 *
 * `scoped` is every game the question reaches before its conditions.
 */
export function dataGaps(scoped: GameLog[], keys: string[]): DataGap[] {
  const out: DataGap[] = [];
  for (const key of new Set(keys)) {
    let missing = 0;
    const bySeason = new Map<number, { n: number; m: number }>();
    for (const g of scoped) {
      const has = typeof g[key] === "number";
      if (!has) missing++;
      const b = bySeason.get(g.year) ?? { n: 0, m: 0 };
      b.n++;
      if (!has) b.m++;
      bySeason.set(g.year, b);
    }
    // A stray missing box score is not worth a sentence.
    if (missing === 0 || missing / scoped.length < 0.02) continue;
    const years = [...bySeason.entries()]
      .filter(([, b]) => b.m / b.n > 0.5)
      .map(([y]) => y)
      .sort((a, b) => a - b);
    out.push({ key, missing, total: scoped.length, years });
  }
  return out;
}

// ─── Percentiles ─────────────────────────────────────────────────────────────

/** Stats with no better end: the chip says how unusual, in the neutral band. */
const NEUTRAL = new Set(["pace", "poss", "opp_rank"]);
/** Lower is better for the team, beyond what the picker's default comparator says. */
const LOWER = new Set([
  ...CALC_STAT_OPTIONS.filter((o) => o.defaultDir === "lt" && o.key !== "opp_rank").map((o) => o.key as string),
  // The picker defaults this one to ≥ for comebacks, but a big opposing lead is bad news.
  "largest_lead_opp",
]);
const FLAGS = new Set(["conf_game", "tourney", "postseason"]);

const pctCache = new Map<string, Uint8Array>();

/**
 * A game's percentile on one stat among every D-I team-game of its season, the
 * way the Player Game Log ranks a night. Worked out per season and stat on
 * first ask, a column at a time, and kept.
 */
export function gamePct(g: GameLog, key: string): { pct: number | null; neutral: boolean } {
  if (FLAGS.has(key)) return { pct: null, neutral: false };
  const i = place.get(g);
  const season = loaded.get(g.year);
  if (i === undefined || !season) return { pct: null, neutral: false };
  const cacheKey = `${g.year}|${key}`;
  let col = pctCache.get(cacheKey);
  if (!col) {
    const values = new Float64Array(season.length);
    for (let k = 0; k < season.length; k++) {
      const v = season[k]![key];
      values[k] = typeof v === "number" ? v : Number.NaN;
    }
    col = midrankByValue(values, !LOWER.has(key));
    pctCache.set(cacheKey, col);
  }
  const p = col[i]!;
  return { pct: p === NO_PCT ? null : p, neutral: NEUTRAL.has(key) };
}

/**
 * A stat as a column shows it. The site's formatStat, except that a rate keeps
 * its decimal ("50.0%", not "50%"), so a column of percentages lines up.
 */
export function fmtValue(v: number | null, key: string): string {
  if (v == null) return "—";
  if (isPctKey(key)) return `${(v * 100).toFixed(1)}%`;
  return formatStat(v, key);
}

// ─── Names and crests ────────────────────────────────────────────────────────

const logoCache = new Map<string, number | null>();
/** A crest for a game-log name, team or opponent, looked up once per name. */
export function crestOf(name: string | null | undefined): number | null {
  if (!name) return null;
  let id = logoCache.get(name);
  if (id === undefined) {
    id = logoIdOf(name);
    logoCache.set(name, id);
  }
  return id;
}

const SHORT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const LONG = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
/** "Feb 14, 2026". */
export const shortDate = (d: string | null): string => (d ? SHORT.format(new Date(`${d}T00:00:00Z`)) : "—");
/** "Saturday, February 14, 2026". */
export const longDate = (d: string | null): string => (d ? LONG.format(new Date(`${d}T00:00:00Z`)) : "");
