import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { CalcClient } from "@/components/calc/calc-client";
import { PageHeading } from "@/components/page-heading";

// Mirror src/lib/coaches.ts TEAM_NAME_OVERRIDES so the (team, year) coach
// lookup keys match the team_name strings that appear in game logs.
const TEAM_NAME_OVERRIDES: Record<string, string> = {
  "Southern California": "USC",
};
function overrideTeam(n: string): string { return TEAM_NAME_OVERRIDES[n] ?? n; }

type CoachHistoryRaw = Record<string, Record<string, { name: string }>>;

async function loadCoachLookup(): Promise<{
  coachByTeamYear: Record<string, Record<number, string>>;
  allCoaches: string[];
}> {
  const file = path.resolve("src/data/coach-history.json");
  if (!existsSync(file)) return { coachByTeamYear: {}, allCoaches: [] };
  const raw = JSON.parse(await fs.readFile(file, "utf8")) as CoachHistoryRaw;
  const coachByTeamYear: Record<string, Record<number, string>> = {};
  const coachSet = new Set<string>();
  for (const [bartName, byYear] of Object.entries(raw)) {
    const team = overrideTeam(bartName);
    coachByTeamYear[team] = coachByTeamYear[team] ?? {};
    for (const [yearStr, s] of Object.entries(byYear)) {
      const y = Number(yearStr);
      if (!Number.isFinite(y)) continue;
      coachByTeamYear[team]![y] = s.name;
      coachSet.add(s.name);
    }
  }
  const allCoaches = [...coachSet].sort((a, b) => {
    // Sort by last name then first — matches how /coaches index sorts on ties.
    const la = (a.split(" ").pop() ?? a).toLowerCase();
    const lb = (b.split(" ").pop() ?? b).toLowerCase();
    if (la !== lb) return la.localeCompare(lb);
    return a.localeCompare(b);
  });
  return { coachByTeamYear, allCoaches };
}

export default async function CalcPage() {
  const { coachByTeamYear, allCoaches } = await loadCoachLookup();
  return (
    <>
      {/* THE SAME HEADING AS EVERY OTHER PAGE. This was a coral rule and a
          coral label, which was the site's older masthead treatment and the
          only one of its kind left — the four table pages all moved to the
          gold kicker, so this read as a page from a different site. */}
      <section className="mx-auto max-w-7xl px-6 lg:px-10 pt-4 lg:pt-5">
        <PageHeading label="Win calculator" />
      </section>

      <section className="mx-auto max-w-7xl px-0 sm:px-6 lg:px-10 pt-3 pb-8 lg:pt-4 lg:pb-10">
        <CalcClient coachByTeamYear={coachByTeamYear} allCoaches={allCoaches} />
      </section>

    </>
  );
}
