import type { Metadata } from "next";
import { TournamentClient } from "@/components/tournament/tournament-client";
import type { Tournament } from "@/lib/tournament";
import seed from "@/data/cig-2026.json";

/**
 * /t/cig — 4-D at the Central Ismaili Games, September 2026.
 *
 * UNLISTED. This is a coach's page for one weekend: reachable by its link,
 * linked from nowhere on the site, absent from the sitemap, told to stay out
 * of search here and again by the X-Robots-Tag rule for /t/* in netlify.toml,
 * and disallowed in robots.ts. That is obscurity rather than access control —
 * anyone holding the link can open it — which is the right level for a
 * schedule that is already public on the organiser's own site.
 *
 * LIVE FROM THE FUNCTION, SEEDED FROM A SNAPSHOT. The site is a static export,
 * so the client fetches netlify/functions/tournament.mts — the only part of
 * the stack that can talk to Playinga's Firestore — and polls it while games
 * can still change. The baked snapshot in src/data/cig-2026.json is what
 * renders first and what stays up if the feed dies mid-tournament: a schedule
 * with no scores beats a spinner on a Saturday morning. Regenerate it with
 * `node scripts/snapshot-tournament.mjs` when the organiser moves a game.
 */
export const metadata: Metadata = {
  title: "4-D · CIG 2026",
  description: "Schedule, scores, standings and the playoff picture for 4-D at the Central Ismaili Games.",
  robots: { index: false, follow: false, nocache: true },
};

export default function CigTournamentPage() {
  // The JSON's string unions widen to `string` on import; the file is written
  // by the function that defines the type, so the cast is a formality.
  return <TournamentClient slug="cig" seed={seed as unknown as Tournament} />;
}
