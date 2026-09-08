import { Suspense } from "react";
import fs from "node:fs/promises";
import path from "node:path";
import { PageHeading } from "@/components/page-heading";
import { MatchupClient } from "@/components/matchup/matchup-client";
import { MatchupView } from "@/components/matchup/matchup-view";
import { project, type MatchupPack } from "@/lib/matchup";

/**
 * Matchup Predictor — pick any two Division I teams, choose the floor, rule
 * players out, and get a projected score with the arithmetic shown.
 *
 * ONE SEASON, FREE. The most recent completed season is the only one on offer
 * until the next one tips; the cut-over is a to-do, not a switch.
 *
 * THE PACK IS BUILT, NOT PULLED. scripts/build-matchup.mjs writes
 * public/data/matchup/<season>.json from the archive. This page reads it at
 * build time for the prerendered default and the browser fetches the same
 * file for everything else — see matchup-client.tsx for why the two-team
 * slice is all that goes into the HTML.
 */

const SEASON = 2026;

export const metadata = {
  // The layout's title template appends the site name.
  title: "Matchup Predictor",
  description:
    "Project any college basketball matchup: score, margin and win probability from opponent-adjusted ratings, with home court, pace, style and player availability — and every step of the arithmetic shown.",
};

async function loadPack(): Promise<MatchupPack | null> {
  try {
    return JSON.parse(await fs.readFile(path.resolve("public/data/matchup", `${SEASON}.json`), "utf8")) as MatchupPack;
  } catch {
    return null;
  }
}

export default async function MatchupPage() {
  const pack = await loadPack();

  /**
   * The default is the season's top two, on a neutral floor — the matchup
   * most people would try first, and the one that reads best as a page on
   * its own. The fallback carries only these two teams.
   */
  const a = pack?.teams[0], b = pack?.teams[1];
  const slim: MatchupPack | null = pack && a && b ? { ...pack, teams: [a, b] } : null;
  const fallback = slim && a && b
    ? <MatchupView pack={slim} projection={project({ pack: slim, a, b, site: "neutral" })} />
    : <div className="bg-paper-deep/25 border border-hairline rounded-xl shadow-sm p-10 text-center text-ink-muted">Loading matchup…</div>;

  return (
    <section className="mx-auto max-w-[var(--page-max)] px-6 lg:px-10 pt-4 lg:pt-5 pb-10">
      <PageHeading label="Matchup predictor" />
      {/* THE FALLBACK IS THE PRERENDERED PAGE. MatchupClient reads
          useSearchParams, which a static export requires to sit inside a
          Suspense boundary — so this fallback is the only HTML the route has
          until hydration, and it is the full default matchup, not a spinner. */}
      {slim && a && b ? (
        <Suspense fallback={fallback}>
          <MatchupClient initialPack={slim} defaultA={a.s} defaultB={b.s} />
        </Suspense>
      ) : fallback}
    </section>
  );
}
