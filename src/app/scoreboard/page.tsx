import { Suspense } from "react";
import type { Metadata } from "next";
import { ScoreboardClient } from "@/components/scoreboard/scoreboard-client";

export const metadata: Metadata = {
  title: "Scoreboard · Beyond the Arc",
  description: "College basketball scores, grouped by conference and updating through the night.",
};

/**
 * /scoreboard — the day's slate.
 *
 * Entirely client-rendered on purpose. The site is a static export, so anything
 * rendered on the server here would be frozen at build time and serve a stale
 * slate until the next deploy — the opposite of what a scoreboard is for. The
 * client fetches from the Netlify function, the only part of the stack that can
 * hold the CBBD key (see netlify/functions/scoreboard.mts).
 *
 * The Suspense boundary is required, not decorative: ScoreboardClient reads
 * ?date= via useSearchParams, and under `output: "export"` Next refuses to
 * prerender a page that does so outside one.
 */
export default function ScoreboardPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-7xl px-6 lg:px-10 pt-6 pb-20 text-ink-muted">Loading scoreboard…</div>}>
      <ScoreboardClient />
    </Suspense>
  );
}
