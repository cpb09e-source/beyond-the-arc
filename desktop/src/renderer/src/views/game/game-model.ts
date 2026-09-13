import type { GameBundle } from "@/components/game/types";
import type { PhotoIndex } from "@/lib/player-photo-index";
import { useLoaded, type CorpusState } from "~/data/use-corpus";
import type { RecordRef } from "~/shell/views";

/**
 * One game's bundle, and the season's name-to-player index its box score needs.
 *
 * The bundle is the file the site's game page reads (/data/games/<season>/<id>),
 * so every figure on the app's page is derived from the same bytes by the same
 * functions (src/lib/game-stats.ts). A game with no bundle, which is most of the
 * scheduled 2026-27 fixtures, resolves to null rather than an error.
 */

export function useGame(season: number, id: number): [CorpusState<GameBundle | null>, () => void] {
  return useLoaded(`game|${season}|${id}`, async () => {
    const { json, source } = await window.bta.data("game", season, String(id));
    return { value: JSON.parse(json) as GameBundle | null, source };
  });
}

export const NO_PHOTOS: PhotoIndex = {};

/**
 * CBBD names to our player ids, for one season. Built to leave out any name that
 * is ambiguous within the season, so a lookup is the right player or nothing
 * (src/lib/player-photo-index.ts).
 */
export function usePhotoIndex(season: number): CorpusState<PhotoIndex> {
  const [state] = useLoaded(`photo-index|${season}`, async () => {
    const { json, source } = await window.bta.data("player-photo-index", season);
    return { value: (JSON.parse(json) as PhotoIndex | null) ?? NO_PHOTOS, source };
  });
  return state;
}

/** How a link was followed: Ctrl for a new tab, Shift for the side. */
export type How = { newTab: boolean; side: boolean };

export type GameRecord = Extract<RecordRef, { kind: "game" }>;

/**
 * Where a game page's names lead. A school opens its page only when it is one
 * we cover, a player only when the season's index names them, so a name with
 * nowhere to go is plain text rather than a link to the wrong page.
 */
export type Links = {
  team: (cbbd: string) => ((how: How) => void) | null;
  player: (name: string) => { bartId: number; open: (how: How) => void } | null;
  game: (record: GameRecord, how: How) => void;
};
