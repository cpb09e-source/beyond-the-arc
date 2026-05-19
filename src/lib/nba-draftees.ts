/**
 * Client-side lazy loader for the NBA-players lookup. The underlying JSON
 * (public/data/nba-draftees.json) holds every player from the 2013-2025 NBA
 * Draft plus every undrafted player who logged an NBA game between 2013-2026
 * (catches Fred VanVleet-style cases). Keyed by a normalized lowercase name.
 *
 * Used by the team roster + headshot strip and the per-game box-score modal
 * to drop a small "NBA" pill next to a player's name. One fetch per page
 * session, cached at module scope.
 */

export type NbaDraftee = {
  year: number;
  pick: number | null;
  team: string | null;
  college: string | null;
};

let CACHE: Record<string, NbaDraftee> | null = null;
let FETCH: Promise<Record<string, NbaDraftee>> | null = null;

export function loadNbaDraftees(): Promise<Record<string, NbaDraftee>> {
  if (CACHE) return Promise.resolve(CACHE);
  if (FETCH) return FETCH;
  FETCH = fetch("/data/nba-draftees.json")
    .then((r) => (r.ok ? r.json() : {}))
    .then((j: Record<string, NbaDraftee>) => { CACHE = j; return j; })
    .catch(() => ({}));
  return FETCH;
}

/**
 * Name normalizer matching the format used as keys in nba-draftees.json.
 * Strips diacritics, lowercases, collapses non-alphanumerics, and drops
 * generational suffixes ("Jr.", "Sr.", "II", "III", "IV", "V") so
 * "Walter Clayton Jr." matches the scrape's "Walter Clayton".
 */
export function normNbaName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/i, "");
}
