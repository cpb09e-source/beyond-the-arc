import type { Metadata } from "next";
import { ScoreboardClient } from "@/components/scoreboard/scoreboard-client";
import { latestArchivedDay } from "@/lib/scoreboard-archive";
import { readArchivedSlate } from "@/lib/game-archive";
import { dateLabel } from "@/lib/scoreboard";

export const metadata: Metadata = {
  title: "College Basketball Scores — Every Division I Game",
  description:
    "Live and final men's college basketball scores for every Division I game, grouped by conference, with box scores, four factors and play-by-play. Free, every night of the season.",
  alternates: { canonical: "/scoreboard/" },
};

/**
 * /scoreboard — tonight's slate, or the last one played.
 *
 * IT PRERENDERS REAL SCORES. This page used to be a Suspense fallback reading
 * "Loading scoreboard…", because the client read useSearchParams and a static
 * export cannot answer that at build time — so the one URL most likely to be
 * found by someone searching "college basketball scores" served a crawler an
 * empty div. It now renders the last night the archive holds, in the HTML,
 * with every result and every link in it.
 *
 * That is not a lie about currency during a season: the client still asks the
 * function on mount, and whatever is live replaces it. `fixed: false` is what
 * says so — see ScoreboardClient. The prerendered night is what a reader sees
 * for the few hundred milliseconds before the answer arrives, and what a
 * crawler that runs no JavaScript sees permanently.
 */
export default async function ScoreboardPage() {
  const last = latestArchivedDay();
  const slate = last ? await readArchivedSlate(last) : null;
  return (
    <ScoreboardClient
      initial={last && slate ? { date: last, slate, fixed: false } : undefined}
      seasonNote={last && slate ? `Latest results · ${dateLabel(last)}` : undefined}
    />
  );
}
