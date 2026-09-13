/**
 * Desktop stand-in for src/lib/gated-corpus.ts, swapped in by the Vite alias.
 *
 * The site's version signs paid seasons through Supabase and /api/data-url. The
 * app reads the same files through its main process, which already knows where
 * each one lives (the repo, the disk cache, R2), so this is that door with the
 * site's names on it. Signing in to the app, and so paid seasons outside the
 * repo, arrives in P3.
 */

export type SignedCorpus = "games" | "team-games";

export const SIGNED_CORPORA: Record<SignedCorpus, string> = {
  games: "/data/game-index",
  "team-games": "/data/team-game-index",
};

export const corpusPublicPath = (kind: SignedCorpus, year: number): string => `${SIGNED_CORPORA[kind]}/${year}.json`;

export async function loadSignedCorpus<T>(kind: SignedCorpus, year: number): Promise<T | null> {
  const { json } = await window.bta.data(kind === "games" ? "player-games" : "team-games", year);
  return JSON.parse(json) as T | null;
}
