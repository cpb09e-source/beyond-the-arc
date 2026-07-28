import { GameDetail } from "@/components/game/game-detail";
import type { GameBundle } from "@/components/game/types";
import bundle from "./game.json";

/**
 * /gamemock — the game page rendered against a baked CBBD bundle (Duke at
 * North Carolina, 7 Feb 2026) so it can be designed and reviewed out of
 * season. The real route reads the same shape from netlify/functions/game.mts.
 *
 * Delete this once the live page is wired up.
 */
export const metadata = { title: "Game page · mock" };

export default function GameMockPage() {
  return <GameDetail b={bundle as unknown as GameBundle} />;
}
