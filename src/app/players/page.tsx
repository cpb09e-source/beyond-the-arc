import { Suspense } from "react";
import fs from "node:fs/promises";
import path from "node:path";
import { PlayersClient } from "@/components/players/players-client";

export default async function PlayersOverviewPage() {
  // Conferences-per-year is small (~100 strings) — bake into the static HTML.
  const confsByYear = JSON.parse(
    await fs.readFile(path.resolve("public/data/conferences.json"), "utf8")
  ) as Record<string, string[]>;

  const years = Object.keys(confsByYear).map(Number).sort((a, b) => a - b);
  const seasonsCovered = years.length;
  const latestYear = years[years.length - 1] ?? 2026;
  const earliestYear = years[0] ?? 2013;
  const currentConfs = confsByYear[String(latestYear)]?.length ?? 0;
  const yearRange = `${earliestYear - 1}–${String(latestYear).slice(-2)}`;

  return (
    <>
      {/* Hero — eyebrow + headline + lede + scale-of-data ribbon. Mirrors the
          editorial mast we use on coach and team dossiers; the kicker stats
          give the page a sense of scope without leaning on hero imagery. */}
      <section className="border-b border-hairline">
        <div className="mx-auto max-w-[97rem] px-6 lg:px-10 pt-12 pb-10 lg:pt-16 lg:pb-12">
          <div className="flex items-center gap-3 text-xs uppercase tracking-[0.18em] text-coral font-medium mb-5">
            <span className="h-px w-8 bg-coral" />
            <span>The player explorer · {yearRange}</span>
          </div>
          <h1 className="font-display text-4xl md:text-5xl lg:text-6xl leading-[1] tracking-tight text-ink max-w-4xl">
            Every D-I player,
            <span className="italic text-coral"> by the numbers</span>.
          </h1>
          <p className="mt-5 text-base lg:text-lg text-ink-soft max-w-2xl leading-relaxed">
            Per-game stats, season percentile ranks, and a BTA composite rating
            cohort-scored against every other player in the position bucket.
          </p>
          <dl className="mt-7 flex flex-wrap items-end gap-x-8 gap-y-3 text-ink-muted">
            <StatBeat value={seasonsCovered} label="Seasons" />
            <StatBeat value={currentConfs} label={`Conferences · ${latestYear - 1}-${String(latestYear).slice(-2)}`} />
            <StatBeat value="364" label="D-I programs" />
            <StatBeat value="~5.5k" label="Player-seasons / year" />
          </dl>
        </div>
      </section>

      <section className="mx-auto max-w-[97rem] px-6 lg:px-10 py-8 lg:py-10">
        <Suspense fallback={<div className="bg-paper-deep/25 border border-hairline rounded-xl shadow-sm p-10 text-center text-ink-muted">Loading players…</div>}>
          <PlayersClient confsByYear={confsByYear} />
        </Suspense>
      </section>

      <div className="mx-auto max-w-[97rem] px-6 lg:px-10 my-12">
        <div className="court-divider" />
      </div>
      <section className="mx-auto max-w-[97rem] px-6 lg:px-10 mb-20">
        <div className="flex items-start gap-4 max-w-3xl">
          <div className="text-[0.6rem] uppercase tracking-[0.18em] text-coral/80 font-bold pt-1 whitespace-nowrap">
            Sources
          </div>
          <p className="text-sm text-ink-muted leading-relaxed">
            Per-game stats sourced from{" "}
            <a
              href="https://barttorvik.com/"
              target="_blank"
              rel="noreferrer"
              className="text-ink hover:text-coral underline decoration-dotted underline-offset-4 transition-colors"
            >
              barttorvik.com
            </a>
            . Position label is Bart&apos;s heuristic (Combo G, Stretch 4, etc.).
            Click any player for their full profile.
          </p>
        </div>
      </section>
    </>
  );
}

function StatBeat({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[0.6rem] uppercase tracking-[0.18em] text-ink-muted font-medium order-2">
        {label}
      </dt>
      <dd className="font-display text-3xl lg:text-[2.25rem] leading-none tabular text-ink order-1">
        {typeof value === "number" ? value.toLocaleString() : value}
      </dd>
    </div>
  );
}
