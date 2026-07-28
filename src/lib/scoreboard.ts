/**
 * Shared types + client for the scoreboard feed.
 *
 * The wire shape is produced by netlify/functions/scoreboard.mts. It is
 * duplicated here rather than imported because Netlify Functions bundle
 * separately from the Next app and cannot resolve the "@/" alias (same reason
 * parse-query.mts inlines its stat list). Keep the two in step.
 */

import { DEMO_GAME, DEMO_SLATE_URL, IS_DEMO } from "./flags";

export type ScoreTeam = {
  team: string;
  conference: string | null;
  points: number | null;
  winner: boolean | null;
  seed: number | null;
  /** AP Top 25 position in the poll current as of the slate, else null. */
  rank: number | null;
  /** Points by period: [1H, 2H, OT, 2OT…]. Empty when not reported. */
  periods: number[];
  /** W-L from completed games before this slate. Null when unknown. */
  record: { w: number; l: number } | null;
};

export type ScoreGame = {
  id: number;
  startDate: string;
  /** "scheduled" | "in_progress" | "final" — lowercased by the function. */
  status: string;
  home: ScoreTeam;
  away: ScoreTeam;
  neutralSite: boolean;
  conferenceGame: boolean;
  venue: string | null;
  period: number | null;
  clock: string | null;
  /** Closing betting line, HOME perspective (negative = home favoured). */
  line: { spread: number | null; overUnder: number | null; provider: string } | null;
};

export type Slate = {
  /**
   * "live"     — CBBD's live feed, games in progress now
   * "recent"   — a completed day we fell back to (last night)
   * "upcoming" — the next day that has games, none of them played yet. The
   *              offseason and preseason state; in July it is opening night.
   */
  source: "live" | "recent" | "upcoming";
  date: string | null;
  games: ScoreGame[];
  fetchedAt: string;
  error?: string;
};

export const EMPTY_SLATE: Slate = { source: "recent", date: null, games: [], fetchedAt: "" };

/** The in-flight (then resolved) demo slate, shared by every caller. */
let demoSlate: Promise<Slate> | null = null;

/**
 * Poll interval. Matches the function's edge cache, so a reader's request is
 * usually answered from the CDN and CBBD sees roughly one call a minute no
 * matter how many people are watching — see the quota note in the function.
 * Polling faster than the cache would just re-serve the same bytes.
 */
export const POLL_MS = 60_000;

/** A game with at least one AP Top 25 side — what leads both surfaces. */
export function isRanked(g: ScoreGame): boolean {
  return g.home.rank !== null || g.away.rank !== null;
}

export function isLive(g: ScoreGame): boolean {
  return g.status === "in_progress";
}
export function isFinal(g: ScoreGame): boolean {
  return g.status === "final";
}

/**
 * Any game still to tip, or currently being played, means the slate is worth
 * re-polling. A day of all-finals is settled — stop asking.
 *
 * A FUTURE slate is settled too, and that one matters against the call budget:
 * out of season the feed answers with opening night, every game "scheduled" and
 * therefore never all-final. Left to the games alone, the ticker would poll
 * once a minute for four months to re-learn a fixture list that cannot change
 * — about 43,000 CBBD calls a month against a quota of roughly 20,000. Nothing
 * about 3 November moves while it is still July.
 */
export function slateIsSettled(s: Slate): boolean {
  // A baked slate cannot change. Polling it would re-read the same static file
  // forever, on every page of the site.
  if (IS_DEMO) return true;
  if (s.games.length === 0) return false;
  if (s.date && s.date > todayEastern()) return true;
  return s.games.every((g) => isFinal(g));
}

/** Today's date in US Eastern, the day the sport files its schedule under. */
export function todayEastern(): string {
  return ET_DAY.format(new Date());
}

/** "Nov 3" — compact enough for the ticker's label rail. */
export function shortDateLabel(d: string | null): string {
  if (!d) return "";
  const t = Date.parse(`${d}T12:00:00Z`);
  if (!Number.isFinite(t)) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC", month: "short", day: "numeric",
  }).format(new Date(t));
}

/**
 * "Duke -2.5 · O/U 148.5" — the pre-tip line, written the way it is quoted:
 * the FAVOURITE named with its own number. The wire format is home-perspective
 * (see the function), so an away favourite has to be flipped, and a pick'em
 * (spread 0) is named rather than shown as "-0".
 */
export function lineLabel(g: ScoreGame): string {
  if (!g.line) return "";
  const parts: string[] = [];
  const s = g.line.spread;
  if (s !== null) {
    if (s === 0) parts.push("Pick'em");
    else {
      const fav = s < 0 ? g.home.team : g.away.team;
      parts.push(`${fav} ${(-Math.abs(s)).toFixed(1).replace(/\.0$/, "")}`);
    }
  }
  if (g.line.overUnder !== null) parts.push(`O/U ${g.line.overUnder}`);
  return parts.join(" · ");
}

/** "12-4", or "" when we have no record for the team. */
export function recordLabel(t: ScoreTeam): string {
  return t.record ? `${t.record.w}-${t.record.l}` : "";
}

/** Tip time in US Eastern, which is how the sport lists its schedule. */
export function tipLabel(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(t)).replace(":00", "") + " ET";
}

/**
 * Link to a game's own page.
 *
 * The date rides in the URL because CBBD's per-game endpoints ignore a gameId
 * filter and everything upstream has to be scoped by a date window — the id
 * alone is not enough to find the game (see netlify/functions/game.mts). It is
 * the US Eastern date, which is the day the sport files the game under and the
 * day the function buckets by.
 *
 * One implementation so the ticker and the scoreboard cannot build the link
 * two different ways.
 */
const ET_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
});
export function gameHref(g: ScoreGame): string {
  // Demo mode has one baked box score, so every card opens it. Pointing the
  // links at their real ids instead would give 127 of the 128 cards a page that
  // can only fail — a dead end is worse than a sample.
  if (IS_DEMO) return `/game?id=${DEMO_GAME.id}&date=${DEMO_GAME.date}`;
  const t = Date.parse(g.startDate);
  const date = Number.isFinite(t) ? ET_DAY.format(new Date(t)) : "";
  return `/game?id=${g.id}${date ? `&date=${date}` : ""}`;
}

export function dateLabel(d: string | null): string {
  if (!d) return "";
  const t = Date.parse(`${d}T12:00:00Z`);
  if (!Number.isFinite(t)) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(t));
}

/**
 * Fetch a slate. Resolves to EMPTY_SLATE on any failure — including the 404 you
 * get under plain `next dev`, where Netlify Functions are not mounted at all
 * (see the [dev] note in netlify.toml). The ticker treats an empty slate as
 * "render nothing", so local development degrades to an absent rail rather than
 * a broken one.
 */
export async function fetchSlate(date?: string, signal?: AbortSignal): Promise<Slate> {
  // DEMO MODE: one static asset, no function, no CBBD, no retry loop. The
  // ticker is on every page of the site, so this is the difference between a
  // browser-cached file and a serverless round trip per navigation. The `date`
  // argument is ignored on purpose — there is exactly one baked day, and
  // quietly returning it for any requested date is better than an empty page
  // from the scoreboard's day stepper.
  if (IS_DEMO) {
    // Memoised across callers AND across navigations. The ticker and the
    // scoreboard page both want this file, and on /scoreboard they mount
    // together — without the shared promise that is two requests for identical
    // bytes on first paint. Holding the promise rather than the result also
    // collapses the two calls that race on mount into one.
    //
    // Deliberately NOT passed the abort signal: one component unmounting must
    // not cancel a fetch the other is still waiting on.
    demoSlate ??= fetch(DEMO_SLATE_URL)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Slate | null) => (Array.isArray(j?.games) ? j : EMPTY_SLATE))
      .catch(() => {
        demoSlate = null; // let a later mount retry a genuine network failure
        return EMPTY_SLATE;
      });
    return demoSlate;
  }

  const qs = new URLSearchParams();
  if (date) qs.set("date", date);
  // Dev-only passthrough: ?sim=live lets the live styling be exercised at any
  // hour. Inert in production — the function ignores it unless NETLIFY_DEV is
  // set. See docs/dev-scoreboard.md.
  if (typeof window !== "undefined") {
    const sim = new URLSearchParams(window.location.search).get("sim");
    if (sim) qs.set("sim", sim);
  }
  const url = `/api/scoreboard${qs.toString() ? `?${qs}` : ""}`;

  // ONE RETRY BEFORE GIVING UP. A single failed request used to blank the
  // ticker for a full minute — it renders nothing on an empty slate, so a
  // transient blip reads to the reader as "no games tonight". A short second
  // attempt costs nothing and the edge cache absorbs it.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { signal });
      if (res.ok) {
        const j = (await res.json()) as Slate;
        if (Array.isArray(j?.games)) return j;
      }
    } catch {
      // Aborted by the caller — do not retry into a torn-down component.
      if (signal?.aborted) return EMPTY_SLATE;
    }
    if (signal?.aborted) return EMPTY_SLATE;
    if (attempt === 0) await new Promise((r) => setTimeout(r, 1200));
  }
  return EMPTY_SLATE;
}
