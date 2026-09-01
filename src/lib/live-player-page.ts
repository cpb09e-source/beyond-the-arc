/**
 * The live season's player page, as a file. The player-side twin of
 * live-team-page.ts — read that first; the argument for why any of this exists
 * is made there.
 *
 * WHAT IS DIFFERENT HERE, and it is the whole reason this took a refactor
 * first. A team page is a SEASON page: /teams/duke/2027/ is its own URL, so
 * the live season could be swapped wholesale and twelve frozen seasons went on
 * being prebuilt at other URLs. A player page is a CAREER page. Every season
 * is on the one URL, so the live season is a single row inside a page that is
 * otherwise frozen, and there is no separate route to swap.
 *
 * The consequence is that this ships the WHOLE page's data, not just the live
 * row. That sounds wasteful and is not: a player bundle is a few KB against a
 * team's 132, and the alternative — patching one row into prebuilt markup —
 * means the fetched numbers and the baked ones are rendered by two different
 * code paths, which is the drift this project keeps refusing to accept.
 *
 * ONLY PLAYERS WITH A LIVE-SEASON ROW GET A FILE. About 5,000 of the 25,474
 * pages. The other 20,000 are careers that ended; nothing about them moves
 * again, and a page with no bundle simply never fetches one.
 */
import type { PlayerPageData } from "@/lib/player-page-data";

/**
 * PlayerPageData is already JSON-safe — no Map, no Set, unlike the team
 * bundle. The codec exists anyway so both sides name one shape and the builder
 * has something to round-trip against.
 */
export type LivePlayerBundle = PlayerPageData & {
  /** When the nightly job wrote this, for debugging a stale file. */
  builtAt: string;
};

export function encodeLivePlayerPage(d: PlayerPageData, builtAt = new Date().toISOString()): LivePlayerBundle {
  return { ...d, builtAt };
}

export function decodeLivePlayerPage(b: LivePlayerBundle): PlayerPageData {
  const { builtAt: _builtAt, ...rest } = b;
  return rest as PlayerPageData;
}

/** Where one player's live bundle lives. Public path; dataUrl routes it to R2. */
export const livePlayerPath = (bartId: number) => `/data/live/player/${bartId}.json`;
