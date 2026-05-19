import { notFound } from "next/navigation";
import { readIndex, readPlayersForYear, readTeam, readRankedPlayerIds, readConfRecordsByTeam, readAllTeams, readGameLogsForYear } from "@/lib/static-data";
import { TeamPageView, buildRoster } from "@/components/teams/team-page-view";
import { buildShootingRanks, buildFourFactorRanks } from "@/components/teams/distribution-panel";

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
  const roster = buildRoster(rosterPool, current.id, current.year);
  const rankedPlayerIds = await readRankedPlayerIds();
  const confRecordsAll = await readConfRecordsByTeam();
  const confRecords = confRecordsAll.get(team.name) ?? new Map();
  const allTeams = await readAllTeams();
  const yearCohort = allTeams.filter((t) => t.year === current.year);
  const shootingRanks = buildShootingRanks(current, yearCohort);
  const fourFactorRanks = buildFourFactorRanks(current, yearCohort);
  const allGames = await readGameLogsForYear(current.year);
  const scheduleGames = allGames
    .filter((g) => g.team_id === current.id)
    .sort((a, b) => (a.game_date ?? "").localeCompare(b.game_date ?? ""));

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
