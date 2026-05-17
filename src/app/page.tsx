import { Suspense } from "react";
import { ExplorerClient } from "@/components/explorer/explorer-client";
import { readAllTeams } from "@/lib/static-data";
import fs from "node:fs/promises";
import path from "node:path";

export default async function HomePage() {
  // Build-time load: static JSON → server passes to client component as props.
  // No request-time DB hits; Netlify serves the pre-rendered HTML from edge.
  const allTeams = await readAllTeams();
  const confsByYear = JSON.parse(
    await fs.readFile(path.resolve("public/data/conferences.json"), "utf8")
  ) as Record<string, string[]>;

  return (
    <>
      <section className="border-b border-hairline">
        <div className="mx-auto max-w-7xl px-6 lg:px-10 pt-12 pb-10">
          <div className="flex items-center gap-3 text-xs uppercase tracking-[0.18em] text-coral font-medium mb-4">
            <span className="h-px w-8 bg-coral" />
            <span>The team explorer</span>
          </div>
          <h1 className="font-display text-4xl md:text-5xl lg:text-6xl leading-[1] tracking-tight text-ink mb-3">
            Build a query.
            <span className="italic text-coral"> Find an answer.</span>
          </h1>
          <p className="text-base md:text-lg text-ink-soft max-w-2xl">
            Every D-I men&apos;s team stats since the 2012-13 season. Pick a
            season or any combination of seasons, narrow by conference, stack
            as many filters as you want - interactions are instant.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 lg:px-10 py-8">
        <Suspense fallback={<div className="bg-card border border-hairline rounded-lg p-10 text-center text-ink-muted">Loading explorer…</div>}>
          <ExplorerClient allTeams={allTeams} confsByYear={confsByYear} />
        </Suspense>
      </section>

      <div className="mx-auto max-w-7xl px-6 lg:px-10 my-4">
        <div className="court-divider" />
      </div>

      <section className="mx-auto max-w-7xl px-6 lg:px-10">
        <p className="text-sm text-ink-muted max-w-2xl leading-relaxed">
          <span className="text-ink">BTA RTG</span> is our weighted z-score
          composite of both adjusted offensive and defensive ratings, SoS,
          standardized within the seasons you have selected and scaled. ~0 = an
          average D-I team, +75 = elite, +100 = a generational season.
        </p>
      </section>
    </>
  );
}
