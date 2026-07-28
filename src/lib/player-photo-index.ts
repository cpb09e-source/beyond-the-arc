/**
 * Resolve a CBBD box-score name to our own player id, so the live game pages
 * can show headshots and link to player profiles.
 *
 * The game pages read from CBBD, which keys athletes on its own ids — two of
 * them, in fact: the box score uses `athleteId` and the play-by-play uses a
 * different, smaller id for the same person. Neither is `bart_player_id`,
 * which is what src/data/player-photos.json and every /players/ URL use. Names
 * are the only field the two worlds share.
 *
 * The index is built at build time by scripts/build-player-photo-index.mjs and
 * deliberately EXCLUDES names that are ambiguous within a season, so a lookup
 * either returns the right player or returns nothing. It never guesses.
 */

/** Fold accents, drop suffixes and punctuation. Mirrors normName() in the
 *  build script — the two must agree or every lookup misses. */
export function normName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, " ")
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type PhotoIndex = Record<string, number>;

/**
 * Module-scoped per season. A game page resolves ~17 names against the same
 * file, and two panels on one page must not fetch it twice. A failed fetch
 * resolves to an empty index rather than rejecting, so the UI degrades to
 * monograms instead of breaking.
 */
const cache = new Map<number, Promise<PhotoIndex>>();

export function loadPhotoIndex(season: number): Promise<PhotoIndex> {
  const hit = cache.get(season);
  if (hit) return hit;
  const p = fetch(`/data/player-photo-index/${season}.json`)
    .then((r) => (r.ok ? (r.json() as Promise<PhotoIndex>) : {}))
    .catch(() => ({} as PhotoIndex));
  cache.set(season, p);
  return p;
}

export function lookupId(index: PhotoIndex, name: string): number | null {
  return index[normName(name)] ?? null;
}
