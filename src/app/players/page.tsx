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

  return (
    <>
      <section className="hidden md:block">
        <div className="mx-auto max-w-[108rem] px-6 lg:px-10 pt-10 pb-2">
          <div className="flex items-center justify-end gap-3 text-xs uppercase tracking-[0.18em] text-coral font-medium">
            <ThemeToggle />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[108rem] px-6 lg:px-10 pt-4 pb-8 lg:pt-5 lg:pb-10">
        <Suspense fallback={<div className="bg-paper-deep/25 border border-hairline rounded-xl shadow-sm p-10 text-center text-ink-muted">Loading players…</div>}>
          <PlayersClient confsByYear={confsByYear} />
        </Suspense>
      </section>
    </>
  );
}

