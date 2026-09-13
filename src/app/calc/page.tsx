import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { CalcClient } from "@/components/calc/calc-client";
import { PageHeading } from "@/components/page-heading";
import { buildCoachLookup, type CoachHistoryRaw } from "@/lib/win-calc";

/** The (team, year) → coach lookup and the coach list, from src/data/coach-history.json. */
async function loadCoachLookup(): Promise<ReturnType<typeof buildCoachLookup>> {
  const file = path.resolve("src/data/coach-history.json");
  if (!existsSync(file)) return { coachByTeamYear: {}, allCoaches: [] };
  return buildCoachLookup(JSON.parse(await fs.readFile(file, "utf8")) as CoachHistoryRaw);
}

export default async function CalcPage() {
  const { coachByTeamYear, allCoaches } = await loadCoachLookup();
  return (
    <>
      {/* THE SAME HEADING AS EVERY OTHER PAGE. This was a coral rule and a
          coral label, which was the site's older masthead treatment and the
          only one of its kind left — the four table pages all moved to the
          gold kicker, so this read as a page from a different site. */}
      <section className="mx-auto max-w-[var(--page-narrow)] px-6 lg:px-10 pt-4 lg:pt-5">
        <PageHeading label="Win calculator" />
      </section>

      <section className="mx-auto max-w-[var(--page-narrow)] px-0 sm:px-6 lg:px-10 pt-3 pb-8 lg:pt-4 lg:pb-10">
        <CalcClient coachByTeamYear={coachByTeamYear} allCoaches={allCoaches} />
      </section>

    </>
  );
}
