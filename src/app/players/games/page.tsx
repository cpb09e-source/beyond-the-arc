import { Suspense } from "react";
import { GamesClient } from "@/components/games/games-client";
import { PageHeading } from "@/components/page-heading";

/**
 * Game Log Explorer.
 *
 * NOTHING IS PASSED FROM THE SERVER, deliberately. A season of player-games is
 * 7 MB — serialising one into the RSC payload the way the team explorer does
 * would put it in the HTML of a page most readers open to look at one season.
 * The client fetches public/data/game-index/<year>.json on demand instead, one
 * season at a time, and keeps what it has fetched.
 *
 * The corpus is built by scripts/build-game-index.mjs.
 */
export const metadata = {
  title: "Game Log Explorer — Beyond the Arc",
  description:
    "Every player-game since 2014. Find the best single-game performances in college basketball by any stat, filter or combination.",
};

export default function GameLogPage() {
  return (
    <section className="mx-auto max-w-[88rem] px-6 lg:px-10 pt-4 lg:pt-5 pb-4">
      <PageHeading label="Game log explorer" />
      {/* GamesClient reads useSearchParams for its whole state. A static export
          requires that hook to sit inside a Suspense boundary or the build
          fails on a CSR bailout. */}
      <Suspense fallback={<div className="text-ink-muted text-sm">Loading games…</div>}>
        <GamesClient />
      </Suspense>
    </section>
  );
}
