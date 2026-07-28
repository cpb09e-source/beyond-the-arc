/**
 * Shared types + client for the scoreboard feed.
 *
 * The wire shape is produced by netlify/functions/scoreboard.mts. It is
 * duplicated here rather than imported because Netlify Functions bundle
 * separately from the Next app and cannot resolve the "@/" alias (same reason
 * parse-query.mts inlines its stat list). Keep the two in step.
 */

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
};

export type Slate = {
  /** "live" came from CBBD's live feed; "recent" is a completed day we fell back to. */
  source: "live" | "recent";
  date: string | null;
  games: ScoreGame[];
  fetchedAt: string;
  error?: string;
};

export const EMPTY_SLATE: Slate = { source: "recent", date: null, games: [], fetchedAt: "" };

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
 */
export function slateIsSettled(s: Slate): boolean {
  return s.games.length > 0 && s.games.every((g) => isFinal(g));
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
  try {
    const qs = date ? `?date=${encodeURIComponent(date)}` : "";
    const res = await fetch(`/api/scoreboard${qs}`, { signal });
    if (!res.ok) return EMPTY_SLATE;
    const j = (await res.json()) as Slate;
    return Array.isArray(j?.games) ? j : EMPTY_SLATE;
  } catch {
    return EMPTY_SLATE;
  }
}
