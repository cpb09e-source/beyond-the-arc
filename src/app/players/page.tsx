import { Suspense } from "react";
import fs from "node:fs/promises";
import path from "node:path";
import { PlayersClient } from "@/components/players/players-client";

export default async function PlayersOverviewPage() {
  // Conferences-per-year is small (~100 strings) — bake into the static HTML.
  const confsByYear = JSON.parse(
    await fs.readFile(path.resolve("public/data/conferences.json"), "utf8")
  ) as Record<string, string[]>;

  return (
    <>
      <section className="border-b border-hairline">
        <div className="mx-auto max-w-[97rem] px-6 lg:px-10 pt-12 pb-10">
          <div className="flex items-center gap-3 text-xs uppercase tracking-[0.18em] text-coral font-medium mb-4">
            <span className="h-px w-8 bg-coral" />
            <span>The player explorer</span>
          </div>
          <h1 className="font-display text-4xl md:text-5xl lg:text-6xl leading-[1] tracking-tight text-ink mb-3">
            Every player,
            <span className="italic text-coral"> indexed.</span>
          </h1>
          <p className="text-base md:text-lg text-ink-soft max-w-2xl">
            ~5,000 D-I players per season, sourced from Bart Torvik. Filter by
            class, conference, or workload; sort by any per-game stat or
            shooting split. Switching seasons fetches the year on demand.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-[97rem] px-6 lg:px-10 py-8 lg:py-10">
        <Suspense fallback={<div className="bg-card border border-hairline rounded-lg p-10 text-center text-ink-muted">Loading players…</div>}>
          <PlayersClient confsByYear={confsByYear} />
        </Suspense>
      </section>

      <div className="mx-auto max-w-[97rem] px-6 lg:px-10 my-12">
        <div className="court-divider" />
      </div>
      <section className="mx-auto max-w-[97rem] px-6 lg:px-10 mb-20">
        <p className="text-sm text-ink-muted max-w-2xl leading-relaxed">
          Per-game stats sourced from{" "}
          <span className="text-ink">barttorvik.com</span>. Position label is
          Bart&apos;s heuristic (Combo G, Stretch 4, etc.). Click any player
          for their full profile.
        </p>
      </section>
    </>
  );
}
