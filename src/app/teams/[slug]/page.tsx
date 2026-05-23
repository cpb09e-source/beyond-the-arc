import { notFound } from "next/navigation";
import { readIndex, readPlayersForYear, readTeam, readRankedPlayerIds, readConfRecordsByTeam, readAllTeams, readGameLogsForYear } from "@/lib/static-data";
import { TeamPageView, buildRoster, attachRosterRanks } from "@/components/teams/team-page-view";
import { buildShootingRanks, buildFourFactorRanks } from "@/components/teams/distribution-panel";
import { loadTournamentGames, buildGamesByTeamYear, gamesForTeamYear } from "@/lib/coaches";

const SHORT_ROUND: Record<string, string> = {
  "First Four": "FF",
  "R64": "R1",
  "R32": "R2",
  "Sweet 16": "S16",
  "Elite Eight": "E8",
  "Final Four": "F4",
  "Runner-up": "NC",
  "Champion": "NC",
};

export async function generateStaticParams() {
  const idx = await readIndex();
  return idx.teamSlugs.map((slug) => ({ slug }));
}

function seasonLabel(y: number): string {
  return `${(y - 1).toString().slice(-2)}-${y.toString().slice(-2)}`;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const team = await readTeam(slug);
  if (!team || team.seasons.length === 0) return { title: "Team not found" };

  const current = team.seasons[0]!;
  const trank = current.team_trank_stats;
  const recordBit = trank?.record ? `${trank.record} ` : "";
  const confBit = current.conference ? ` (${current.conference})` : "";
  const seasonStr = seasonLabel(current.year);
  const description = `${team.name}${confBit} ${seasonStr} ${recordBit}— rankings, roster, advanced stats, and head coach history.`.trim();

  return {
    title: team.name,
    description,
    openGraph: {
      title: `${team.name} · ${seasonStr}`,
      description,
      url: `/teams/${slug}/`,
      type: "website",
    },
    twitter: { card: "summary_large_image", title: `${team.name} · ${seasonStr}`, description },
    alternates: { canonical: `/teams/${slug}/` },
  };
}

export default async function TeamPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const team = await readTeam(slug);
  if (!team || team.seasons.length === 0) notFound();

  // Default to the team's most recent season.
  const current = team.seasons[0]!;
  const rosterPool = await readPlayersForYear(current.year);
  const rosterBase = buildRoster(rosterPool, current.id, current.year);
  const rankedPlayerIds = await readRankedPlayerIds();
  const roster = attachRosterRanks(rosterBase, current.roster_ranks);
  const confRecordsAll = await readConfRecordsByTeam();
  const confRecords = confRecordsAll.get(team.name) ?? new Map();
  const allTeams = await readAllTeams();
  const yearCohort = allTeams.filter((t) => t.year === current.year);
  const shootingRanks = buildShootingRanks(current, yearCohort);
  const fourFactorRanks = buildFourFactorRanks(current, yearCohort);
  const allGames = await readGameLogsForYear(current.year);
  // Tag March Madness games with their round label so the ticker shows
  // "R1 / R2 / S16…" above the W/L pill. Match by (team, year, date).
  const tourneyGamesAll = await loadTournamentGames();
  const tourneyLookup = buildGamesByTeamYear(tourneyGamesAll);
  const teamTourneyGames = gamesForTeamYear(tourneyLookup, team.name, current.year);
  const roundByDate = new Map<string, string>();
  for (const tg of teamTourneyGames) {
    if (!tg.date) continue;
    roundByDate.set(tg.date, SHORT_ROUND[tg.round] ?? tg.round);
  }
  const scheduleGames = allGames
    .filter((g) => g.team_id === current.id)
    .sort((a, b) => (a.game_date ?? "").localeCompare(b.game_date ?? ""))
    .map((g) => {
      const round = g.game_date ? roundByDate.get(g.game_date) : undefined;
      return round ? { ...g, tournamentRound: round } : g;
    });

  return (
    <TeamPageView
      team={team}
      current={current}
      roster={roster}
      slug={slug}
      rankedPlayerIds={rankedPlayerIds}
      confRecords={confRecords}
      shootingRanks={shootingRanks}
      fourFactorRanks={fourFactorRanks}
      scheduleGames={scheduleGames}
    />
  );
}
