/**
 * Shared types + client for the scoreboard feed.
 *
 * The types and the pure helpers live in scoreboard-core.ts, which needs no
 * page and no build — the desktop app imports them from there. They are
 * re-exported here so every import of "@/lib/scoreboard" keeps working; what
 * stays in this file is what needs the network, the build flags or the
 * archive manifest.
 *
 * The wire shape is produced by netlify/functions/scoreboard.mts. It is
 * duplicated in scoreboard-core.ts rather than imported because Netlify
 * Functions bundle separately from the Next app and cannot resolve the "@/"
 * alias (same reason parse-query.mts inlines its stat list). Keep the two in
 * step.
 */

import { dataUrl } from "./data-url";
import { IS_DEMO } from "./flags";
import {
  gamePagePath, isArchivedDay, isKnownSeason, latestArchivedDay, seasonOfDate, slateUrl,
} from "./scoreboard-archive";
import { ET_DAY, isFinal, todayEastern, type ScoreGame, type ScoreTeam, type Slate } from "./scoreboard-core";

export type { ScoreGame, ScoreTeam, Slate } from "./scoreboard-core";
export {
  dateLabel, isFinal, isLive, isRanked, isSeed, lineLabel, recordLabel, shortDateLabel, tipLabel, todayEastern,
} from "./scoreboard-core";

export const EMPTY_SLATE: Slate = { source: "recent", date: null, games: [], fetchedAt: "" };

/**
 * In-flight archived slates, by date, shared by every caller.
 *
 * The ticker and the scoreboard page both want the same file and on
 * /scoreboard they mount together — without the shared promise that is two
 * requests for identical bytes on first paint. Holding the PROMISE rather than
 * the result also collapses the two calls that race on mount into one.
 */
const archivedSlates = new Map<string, Promise<Slate>>();

/**
 * One archived day, as a static file. Never passed an abort signal: one
 * component unmounting must not cancel a fetch the other is still waiting on.
 */
function fetchArchivedSlate(date: string): Promise<Slate> {
  let p = archivedSlates.get(date);
  if (!p) {
    p = fetch(dataUrl(slateUrl(date)))
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Slate | null) => (Array.isArray(j?.games) ? j : EMPTY_SLATE))
      .catch(() => {
        archivedSlates.delete(date); // let a later mount retry a network failure
        return EMPTY_SLATE;
      });
    archivedSlates.set(date, p);
  }
  return p;
}

/**
 * DEV ONLY — rewind or wind forward the baked slate so the live and preseason
 * states can be looked at in July.
 *
 * The function has had `?sim=live` since the ticker was built, but demo mode
 * never reaches the function, so the flag quietly stopped working the moment
 * the slate was baked — and a real live slate does not exist again until
 * November. This is the same transform, moved to the client for the demo path.
 *
 * GATED ON THE HOSTNAME, not on `process.env.NODE_ENV`. The env check is the
 * obvious way to write this and it silently broke the page: `process` does not
 * exist as a browser global, and where the bundler does not inline the
 * expression the reference throws inside the fetch chain — which surfaced not
 * as an error but as a slate that never resolved, so the scoreboard and the
 * ticker both sat empty with a clean console. A hostname test needs no build
 * step to be true and says exactly what it guarantees: local only.
 */
function simulate(slate: Slate): Slate {
  if (typeof window === "undefined") return slate;
  const host = window.location.hostname;
  if (host !== "localhost" && host !== "127.0.0.1") return slate;
  const sim = new URLSearchParams(window.location.search).get("sim");
  if (sim !== "live" && sim !== "upcoming") return slate;

  if (sim === "upcoming") {
    return {
      ...slate,
      source: "upcoming",
      games: slate.games.map((g) => ({
        ...g, status: "scheduled", period: null, clock: null,
        home: { ...g.home, points: null, winner: null, periods: [] },
        away: { ...g.away, points: null, winner: null, periods: [] },
      })),
    };
  }

  return {
    ...slate,
    source: "live",
    // A third left final, a third in progress, a third not yet tipped, so one
    // page shows all three states at once rather than a wall of identical live
    // cards. Derived from the index, so a reload gives the same picture instead
    // of reshuffling underneath you.
    games: slate.games.map((g, i) => {
      const bucket = i % 3;
      if (bucket === 0) return g;
      if (bucket === 2) {
        return {
          ...g, status: "scheduled", period: null, clock: null,
          home: { ...g.home, points: null, winner: null, periods: [] },
          away: { ...g.away, points: null, winner: null, periods: [] },
        };
      }
      const half = (s: ScoreTeam): ScoreTeam => ({
        ...s,
        points: s.periods[0] ?? Math.round((s.points ?? 0) / 2),
        periods: s.periods.slice(0, 1),
        winner: null,
      });
      const secs = 60 + ((i * 137) % 1080);
      return {
        ...g,
        status: "in_progress",
        period: 2,
        clock: `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`,
        home: half(g.home),
        away: half(g.away),
      };
    }),
  };
}

/**
 * Poll interval. Matches the function's edge cache, so a reader's request is
 * usually answered from the CDN and CBBD sees roughly one call a minute no
 * matter how many people are watching — see the quota note in the function.
 * Polling faster than the cache would just re-serve the same bytes.
 */
export const POLL_MS = 60_000;

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
  // An archived day is finished by definition.
  if (s.date && isArchivedDay(s.date)) return true;
  if (s.games.length === 0) return false;
  if (s.date && s.date > todayEastern()) return true;
  return s.games.every((g) => isFinal(g));
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
export function gameHref(g: ScoreGame): string {
  const t = Date.parse(g.startDate);
  const date = Number.isFinite(t) ? ET_DAY.format(new Date(t)) : "";
  // Every game we know about has a real page — /games/2026/214837-duke-vs-
  // north-carolina/ — whether it has been played or merely scheduled. CBBD
  // publishes the fixture list weeks ahead, so the page exists before tip-off
  // and the URL never changes when the result lands. Only a game missing from
  // the last build (a rescheduled fixture, mostly) falls back to /game?id=.
  if (date && isKnownSeason(seasonOfDate(date))) {
    return gamePagePath(seasonOfDate(date), g.id, g.away.team, g.home.team);
  }
  return `/game?id=${g.id}${date ? `&date=${date}` : ""}`;
}

/**
 * Fetch a slate. Resolves to EMPTY_SLATE on any failure — including the 404 you
 * get under plain `next dev`, where Netlify Functions are not mounted at all
 * (see the [dev] note in netlify.toml). The ticker treats an empty slate as
 * "render nothing", so local development degrades to an absent rail rather than
 * a broken one.
 */
export async function fetchSlate(date?: string, signal?: AbortSignal): Promise<Slate> {
  // A DAY THE ARCHIVE HOLDS IS A STATIC FILE. No function, no CBBD, no retry
  // loop, no quota — a gzipped asset on the CDN that cannot go stale because
  // nothing in a finished day can change. That covers every date the day
  // stepper can reach outside the season being played.
  if (date && isArchivedDay(date)) return simulate(await fetchArchivedSlate(date));

  // No date, and no season being played: the ticker and the page open on the
  // last day the archive holds rather than on an empty slate. This is what the
  // baked demo file used to do, without a second copy of the data.
  if (!date && IS_DEMO) {
    const last = latestArchivedDay();
    if (last) return simulate(await fetchArchivedSlate(last));
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
