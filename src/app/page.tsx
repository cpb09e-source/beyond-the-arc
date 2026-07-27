import { Suspense } from "react";
import { ExplorerClient } from "@/components/explorer/explorer-client";
import { readAllTeams, readConfRecordsByTeam } from "@/lib/static-data";
import { loadTournamentGames, buildGamesByTeamYear, gamesForTeamYear } from "@/lib/coaches";
import { ThemeToggle } from "@/components/theme-toggle";
import fs from "node:fs/promises";
import path from "node:path";

// Compact bracket-round → short label (R64→R1 to match fan parlance).
// Mirrors the maps in /coaches/[slug] and /teams/[slug]/[year].
const ROUND_TO_LABEL: Record<string, string> = {
  "First Four": "First Four",
  "R64": "R1",
  "R32": "R2",
  "Sweet 16": "Sweet 16",
  "Elite Eight": "Elite 8",
  "Final Four": "Final Four",
  "Runner-up": "Runner-up",
  "Champion": "Champion",
};

// Bracket order — used to pick the team's deepest round per season.
const ROUND_DEPTH: Record<string, number> = {
  "First Four": 0, "R64": 1, "R32": 2, "Sweet 16": 3, "Elite Eight": 4,
  "Final Four": 5, "Runner-up": 6, "Champion": 7,
};

export default async function HomePage() {
  // Build-time load: static JSON → server passes to client component as props.
  // No request-time DB hits; Netlify serves the pre-rendered HTML from edge.
  const allTeams = await readAllTeams();
  const confsByYear = JSON.parse(
    await fs.readFile(path.resolve("public/data/conferences.json"), "utf8")
  ) as Record<string, string[]>;

  // Coach + tournament-finish lookups for the Compare Teams modal. Both are
  // small JSONs that ship in the build — we resolve every (team, year) once
  // here so the client component can hand them to the modal as plain Maps.
  const confRecordsAll = await readConfRecordsByTeam();
  const coachByTeamYear: Record<string, string | null> = {};
  for (const [teamName, byYear] of confRecordsAll) {
    for (const [year, rec] of byYear) {
      coachByTeamYear[`${teamName}|${year}`] = rec.coachName;
    }
  }

  const tourneyGames = await loadTournamentGames();
  const tourneyLookup = buildGamesByTeamYear(tourneyGames);
  const tourneyFinishByTeamYear: Record<string, string> = {};
  // SR helper — normalize school strings the same way the tournament lookup
  // does so we can identify winner vs loser by string compare.
  const normSchool = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const t of allTeams) {
    const games = gamesForTeamYear(tourneyLookup, t.name, t.year);
    if (games.length === 0) continue;
    // Pick the deepest round this team reached. The championship game is
    // stored with round="Champion" for BOTH teams, so we re-label the loser
    // as Runner-up so they don't get credited as champion.
    let best: string | null = null;
    let bestDepth = -1;
    let bestIsChampLoss = false;
    for (const g of games) {
      const d = ROUND_DEPTH[g.round] ?? -1;
      if (d > bestDepth) {
        bestDepth = d;
        best = g.round;
        // If this is the title game and we lost it, mark as runner-up.
        bestIsChampLoss = g.round === "Champion" && normSchool(g.loser.school).includes(normSchool(t.name));
      }
    }
    if (best) {
      const finalRound = bestIsChampLoss ? "Runner-up" : best;
      tourneyFinishByTeamYear[`${t.name}|${t.year}`] = ROUND_TO_LABEL[finalRound] ?? finalRound;
    }
  }

  return (
    <>
      <section className="hidden md:block">
        <div className="mx-auto max-w-[108rem] px-6 lg:px-10 pt-10 pb-2">
          <div className="flex items-center justify-end gap-3 text-xs uppercase tracking-[0.18em] text-coral font-medium">
            <ThemeToggle />
          </div>
        </div>
      </section>

      {/* Same padding rhythm as /players so the two tables sit at the same
          height on the page. */}
      <section className="mx-auto max-w-[108rem] px-6 lg:px-10 pt-4 pb-8 lg:pt-5 lg:pb-10">
        <Suspense fallback={<div className="bg-paper-deep/25 border border-hairline rounded-xl shadow-sm p-10 text-center text-ink-muted">Loading teams…</div>}>
          <ExplorerClient
            allTeams={allTeams}
            confsByYear={confsByYear}
            coachByTeamYear={coachByTeamYear}
            tourneyFinishByTeamYear={tourneyFinishByTeamYear}
          />
        </Suspense>
      </section>

      <div className="mx-auto max-w-[108rem] px-6 lg:px-10 my-4">
        <div className="court-divider" />
      </div>

      {/* Explains the HEADLINE column. This used to describe BTA RTG, which is
          no longer what the table leads with — a footnote defining a metric the
          reader can't see is worse than no footnote. */}
      <section className="mx-auto max-w-[108rem] px-6 lg:px-10 pb-10">
        <p className="text-sm text-ink-muted max-w-2xl leading-relaxed">
          <span className="text-ink">aNET</span> is our schedule-adjusted net
          rating — points per 100 possessions against an average D-I opponent on
          a neutral floor. Offense and defense are solved together across every
          game of the season, so beating a good defense counts for more than
          beating a bad one. <span className="text-ink">SOS</span> is the average
          adjusted net rating of the opponents faced.
        </p>
      </section>
    </>
  );
}
