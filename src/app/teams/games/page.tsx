import { Suspense } from "react";
import { TeamGamesClient } from "@/components/games/team-games-client";
import { PageHeading } from "@/components/page-heading";

/**
 * Team Game Log Explorer.
 *
 * The player Game Log's twin, one level up. Nothing is passed from the server:
 * the client fetches /data/team-game-index/<year>.json on demand, one season
 * at a time, and keeps what it has.
 *
 * A STATIC SEGMENT UNDER /teams, which does not collide with the team pages —
 * those live at /teams/[slug]/[year], two segments deep, so nothing dynamic
 * matches a single "games" segment.
 *
 * Corpus: scripts/build-team-game-index.mjs.
 */
export const metadata = {
  title: "Team Game Log Explorer — Beyond the Arc",
  description:
    "Every team-game since 2014. Find the best single-game team performances in college basketball by any stat, filter or combination.",
};

export default function TeamGameLogPage() {
  return (
    <section className="mx-auto max-w-[108rem] px-6 lg:px-10 pt-4 lg:pt-5 pb-4">
      <PageHeading label="Team game log explorer" />
      {/* TeamGamesClient reads useSearchParams for its whole state, which a
          static export requires to sit inside a Suspense boundary. */}
      <Suspense fallback={<div className="text-ink-muted text-sm">Loading team games…</div>}>
        <TeamGamesClient />
      </Suspense>
    </section>
  );
}
