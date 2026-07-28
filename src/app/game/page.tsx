import { Suspense } from "react";
import type { Metadata } from "next";
import { GameClient } from "@/components/game/game-client";

export const metadata: Metadata = {
  title: "Game · Beyond the Arc",
  description: "Box score, shot charts and play-by-play for a single college basketball game.",
};

/**
 * /game?id=…&date=…
 *
 * A QUERY PARAMETER, NOT A DYNAMIC SEGMENT. Under `output: "export"` a
 * `[id]` route has to enumerate every id at build time via
 * generateStaticParams — which is fine for the games already in the archive
 * and impossible for a game that tips tomorrow. One static page that reads its
 * id at runtime covers both, and costs one HTML file instead of ~75,000.
 *
 * Entirely client-rendered for the same reason /scoreboard is: anything
 * rendered here on the server would be frozen at build time.
 *
 * The Suspense boundary is required, not decorative — GameClient reads
 * useSearchParams, and Next refuses to prerender a page that does so outside
 * one.
 */
export default function GamePage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-7xl px-6 lg:px-10 pt-10 pb-20 text-ink-muted">Loading the game…</div>}>
      <GameClient />
    </Suspense>
  );
}
