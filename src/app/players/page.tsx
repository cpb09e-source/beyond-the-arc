import { Suspense } from "react";
import fs from "node:fs/promises";
import path from "node:path";
import { PlayersClient } from "@/components/players/players-client";
import { PageHeading } from "@/components/page-heading";

export default async function PlayersOverviewPage() {
  // Conferences-per-year is small (~100 strings) — bake into the static HTML.
  const confsByYear = JSON.parse(
    await fs.readFile(path.resolve("public/data/conferences.json"), "utf8")
  ) as Record<string, string[]>;

  return (
    <>
      <section className="mx-auto max-w-[108rem] px-6 lg:px-10 pt-3 pb-8 lg:pt-9 lg:pb-10">
        <PageHeading
          label="Player ratings"
          sub="Every rotation player in Division I, ranked by impact rather than counting stats. Build the column set you want and filter on any of it."
        />
        <Suspense fallback={<div className="bg-paper-deep/25 border border-hairline rounded-xl shadow-sm p-10 text-center text-ink-muted">Loading players…</div>}>
          <PlayersClient confsByYear={confsByYear} />
        </Suspense>
      </section>
    </>
  );
}

