import { Suspense } from "react";
import fs from "node:fs/promises";
import path from "node:path";
import { PlayersClient } from "@/components/players/players-client";
import { ThemeToggle } from "@/components/theme-toggle";

export default async function PlayersOverviewPage() {
  // Conferences-per-year is small (~100 strings) — bake into the static HTML.
  const confsByYear = JSON.parse(
    await fs.readFile(path.resolve("public/data/conferences.json"), "utf8")
  ) as Record<string, string[]>;

  const years = Object.keys(confsByYear).map(Number).sort((a, b) => a - b);
  const latestYear = years[years.length - 1] ?? 2026;
  const earliestYear = years[0] ?? 2013;
  const yearRange = `${earliestYear - 1}–${String(latestYear).slice(-2)}`;

  return (
    <>
      <section>
        <div className="mx-auto max-w-[88rem] px-6 lg:px-10 pt-10 pb-2">
          <div className="flex items-center justify-between gap-3 text-xs uppercase tracking-[0.18em] text-coral font-medium">
            <div className="flex items-center gap-3">
              <span className="h-px w-8 bg-coral" />
              <span>The player explorer · {yearRange}</span>
            </div>
            <ThemeToggle />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[88rem] px-6 lg:px-10 pt-4 pb-8 lg:pt-5 lg:pb-10">
        <Suspense fallback={<div className="bg-paper-deep/25 border border-hairline rounded-xl shadow-sm p-10 text-center text-ink-muted">Loading players…</div>}>
          <PlayersClient confsByYear={confsByYear} />
        </Suspense>
      </section>

      <div className="mx-auto max-w-[88rem] px-6 lg:px-10 my-12">
        <div className="court-divider" />
      </div>
      <section className="mx-auto max-w-[88rem] px-6 lg:px-10 mb-20">
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

