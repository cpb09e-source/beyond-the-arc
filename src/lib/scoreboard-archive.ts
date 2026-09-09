/**
 * The scoreboard archive, as the browser knows it.
 *
 * A completed season is not served by the Netlify function. It is baked by
 * scripts/build-scoreboard-archive.mts into one static slate per day and one
 * bundle per game, mirrored to R2, and reached by URL — free against the
 * quota, cached by the CDN, and it cannot go stale because nothing in it can
 * change. This module answers the one question the client has to ask before
 * it fetches anything: is this date a static file, or is it the live feed?
 *
 * The answer comes from src/data/scoreboard-archive.json, which the builder
 * writes and which IS committed: it is a few kilobytes of dates, and the
 * client needs it synchronously to build links. The per-game index it also
 * writes is not committed and is read only at build time — see game-archive.ts.
 *
 * Safe to import from client components: no filesystem, no Node.
 */
import archive from "@/data/scoreboard-archive.json";
import { teamSlug } from "@/lib/team-slug";

/**
 * `scheduled` marks the season being PLAYED (or about to be). Its pages are
 * built from the fixture list, so they exist before tip-off — but their
 * contents are not final, so everything that reads them must refetch rather
 * than trust the file. A season without the flag is over and immutable.
 */
type ArchiveSeason = { first: string; last: string; days: string[]; scheduled?: boolean };
const ARCHIVE = archive as Record<string, ArchiveSeason>;

/** CBBD's label for the season a date falls in: 2025-26 is 2026, rolling over in July. */
export function seasonOfDate(date: string): number {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  return m >= 7 ? y + 1 : y;
}

/** "2025-26" */
export function seasonLabel(season: number): string {
  return `${season - 1}-${String(season).slice(2)}`;
}

/** Seasons that are over. */
export function archivedSeasons(): number[] {
  return knownSeasons().filter(isArchivedSeason);
}

/** Any season we have pages for — played or merely scheduled. */
export function isKnownSeason(season: number): boolean {
  return String(season) in ARCHIVE;
}

/** A season that is over: every file for it is final and can be trusted. */
export function isArchivedSeason(season: number): boolean {
  const s = ARCHIVE[String(season)];
  return !!s && !s.scheduled;
}

/** The season being played, whose pages exist but whose scores do not yet. */
export function isScheduledSeason(season: number): boolean {
  return ARCHIVE[String(season)]?.scheduled === true;
}

/** Every season with pages, played or scheduled. */
export function knownSeasons(): number[] {
  return Object.keys(ARCHIVE).map(Number).sort((a, b) => a - b);
}

/** True when this date has a page at all, of either kind. */
export function isKnownDay(date: string): boolean {
  const season = ARCHIVE[String(seasonOfDate(date))];
  return !!season && season.days.includes(date);
}

export function archivedDays(season: number): string[] {
  return ARCHIVE[String(season)]?.days ?? [];
}

const daySets = new Map<string, Set<string>>();
/** True when a static slate exists for this date — a day the sport played. */
export function isArchivedDay(date: string): boolean {
  const key = String(seasonOfDate(date));
  const season = ARCHIVE[key];
  if (!season || season.scheduled) return false;
  let set = daySets.get(key);
  if (!set) {
    set = new Set(season.days);
    daySets.set(key, set);
  }
  return set.has(date);
}

/** The last day any COMPLETED season played — what /scoreboard falls back to. */
export function latestArchivedDay(): string | null {
  const seasons = archivedSeasons();
  if (seasons.length === 0) return null;
  return ARCHIVE[String(seasons[seasons.length - 1])]!.last;
}

/** Paths under /data, to be passed through dataUrl() before fetching. */
export function slateUrl(date: string): string {
  return `/data/scoreboard/${seasonOfDate(date)}/${date}.json`;
}
export function gameBundleUrl(season: number, id: number): string {
  return `/data/games/${season}/${id}.json`;
}

/**
 * The URL segment for a game page: the id first, so the page can find the
 * game without parsing names, then the matchup so the link reads as one.
 * Away first, home second — "Duke vs North Carolina" for Duke at Chapel Hill,
 * which is how the sport says it.
 */
export function gameSlug(id: number, away: string, home: string): string {
  return `${id}-${teamSlug(away)}-vs-${teamSlug(home)}`;
}
export function gamePagePath(season: number, id: number, away: string, home: string): string {
  return `/games/${season}/${gameSlug(id, away, home)}/`;
}
export function idFromSlug(slug: string): number | null {
  const m = slug.match(/^(\d+)-/);
  return m ? Number(m[1]) : null;
}
