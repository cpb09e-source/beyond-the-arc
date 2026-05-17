import { notFound } from "next/navigation";
import { readIndex, readPlayersForYear, readTeam } from "@/lib/static-data";
import { TeamPageView, buildRoster } from "@/components/teams/team-page-view";

export async function generateStaticParams() {
  const idx = await readIndex();
  return idx.teamSlugs.map((slug) => ({ slug }));
}

export default async function TeamPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const team = await readTeam(slug);
  if (!team || team.seasons.length === 0) notFound();

  // Default to the team's most recent season.
  const current = team.seasons[0]!;
  const rosterPool = await readPlayersForYear(current.year);
  const roster = buildRoster(rosterPool, current.id, current.year);

  return <TeamPageView team={team} current={current} roster={roster} slug={slug} />;
}
