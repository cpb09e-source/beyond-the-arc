import { Suspense } from "react";
import { ExplorerClient } from "@/components/explorer/explorer-client";
import { readAllTeams, readConfRecordsByTeam } from "@/lib/static-data";
import { loadTournamentGames, buildGamesByTeamYear, gamesForTeamYear } from "@/lib/coaches";
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
  //
  // ONE SEASON, NOT ALL OF THEM. This used to pass the whole of teams-all.json,
  // which Next serialises into the page's RSC payload: index.html measured
  // 10.73 MB raw / 1.51 MB gzipped, 99.9% of it a single <script> holding 4,273
  // team-season objects, on the page every visitor lands on first. The explorer
  // only ever renders the seasons its picker has selected — one by default — so
  // it now gets the current season plus a names-and-years index, and fetches
  // other seasons from /data/teams-by-year/<year>.json when asked for them.
  const allTeamSeasons = await readAllTeams();
  const latestYear = allTeamSeasons.reduce((m, t) => Math.max(m, t.year), 0);
  const initialTeams = allTeamSeasons.filter((t) => t.year === latestYear);
  // Names and years only — what the Team filter and the Compare picker need to
  // offer seasons that are not loaded. ~0.03 MB gzipped against 1.51.
  const teamsIndex = allTeamSeasons.map((t) => ({
    n: t.name,
    y: t.year,
    c: t.conference ?? null,
  }));
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
  // Still every team-season: the output is only the ~68 tournament teams a year,
  // so this stays a build-time sweep whose small result ships as a prop.
  for (const t of allTeamSeasons) {
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
      {/* Same padding rhythm as /players so the two tables sit at the same
          height on the page. */}
      <section className="mx-auto max-w-[108rem] px-6 lg:px-10 pt-7 pb-8 lg:pt-9 lg:pb-10">
        <Suspense fallback={<div className="bg-paper-deep/25 border border-hairline rounded-xl shadow-sm p-10 text-center text-ink-muted">Loading teams…</div>}>
          <ExplorerClient
            initialTeams={initialTeams}
            teamsIndex={teamsIndex}
            latestYear={latestYear}
            confsByYear={confsByYear}
            coachByTeamYear={coachByTeamYear}
            tourneyFinishByTeamYear={tourneyFinishByTeamYear}
          />
        </Suspense>
      </section>

      <div className="mx-auto max-w-[108rem] px-6 lg:px-10 my-4">
        <div className="court-divider" />
      </div>

      {/* The aNET / SOS footnote that sat here is gone — those definitions
          belong on the glossary page, not repeated under one table. Every
          column head still carries its own `title`, so the meaning is a hover
          away in the meantime. */}
    </>
  );
}
