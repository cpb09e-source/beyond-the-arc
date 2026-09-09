import type { Metadata } from "next";
import { GameClient } from "@/components/game/game-client";

export const metadata: Metadata = {
  title: "Game · Beyond the Arc",
  description: "Box score, shot charts and play-by-play for a single college basketball game.",
  // A game being played has no page of its own, so this route stands in for
  // all of them and must not compete with the archive's real URLs.
  robots: { index: false, follow: true },
};

/**
 * /game?id=…&date=… — a game in the season being played.
 *
 * A QUERY PARAMETER, NOT A DYNAMIC SEGMENT, and only for the live season.
 * Under `output: "export"` a `[id]` route has to enumerate every id at build
 * time, which is impossible for a game that tips tomorrow. Every game that has
 * ALREADY been played has a real page — /games/<season>/<id>-<away>-vs-<home>/
 * — built from the archive, with its score in the HTML; see
 * src/app/games/[season]/[slug]/page.tsx. This route is what remains for the
 * one case that cannot be enumerated.
 *
 * NO SUSPENSE BOUNDARY. GameClient reads the query string through
 * useUrlSearchParams (src/lib/use-url-search-params.ts), which gives the build
 * the same answer a first-time visitor gets, so the page prerenders instead of
 * shipping a fallback.
 */
export default function GamePage() {
  return <GameClient />;
}
