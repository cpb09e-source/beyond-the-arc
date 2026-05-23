import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { CalcClient } from "@/components/calc/calc-client";
import { ThemeToggle } from "@/components/theme-toggle";

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
      <section>
        <div className="mx-auto max-w-7xl px-6 lg:px-10 pt-10 pb-2">
          <div className="flex items-center justify-between gap-3 text-xs uppercase tracking-[0.18em] text-coral font-medium mb-4">
            <div className="flex items-center gap-3">
              <span className="h-px w-8 bg-coral" />
              <span>The win calculator</span>
            </div>
            <ThemeToggle />
          </div>
          <h1 className="font-display text-sm sm:text-lg md:text-2xl lg:text-[1.75rem] leading-[1.1] tracking-tight text-ink whitespace-nowrap">
            If these things happen,
            <span className="italic text-coral"> how often do they win?</span>
          </h1>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-0 sm:px-6 lg:px-10 pt-3 pb-8 lg:pt-4 lg:pb-10">
        <CalcClient coachByTeamYear={coachByTeamYear} allCoaches={allCoaches} />
      </section>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10 my-6 sm:my-12">
        <div className="court-divider" />
      </div>
      <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10 mb-4 sm:mb-20">
        <p className="text-sm text-ink-muted max-w-2xl leading-relaxed">
          Each row is one team&apos;s perspective on one game. Conditions are
          evaluated from that team&apos;s perspective, so &ldquo;TOV Diff &gt; 1&rdquo;
          means the team committed fewer turnovers than its opponent by more
          than 1. Game data sourced from{" "}
          <span className="text-ink">cbbanalytics.com</span>.
        </p>
      </section>
    </>
  );
}
