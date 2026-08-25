import { notFound } from "next/navigation";
import { readIndex, readTeam } from "@/lib/static-data";
import { TeamPageView } from "@/components/teams/team-page-view";
import { loadTeamPageData } from "@/lib/team-page-data";


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

export default async function TeamPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // No year in the URL: the most recent season, which is also the only one
  // split into tabs. overviewHref keeps the Overview tab pointing at this URL
  // rather than sending a reader already on it to /teams/<slug>/<year>/.
  const data = await loadTeamPageData(slug);
  if (!data) notFound();

  return <TeamPageView {...data} tab="overview" overviewHref={`/teams/${slug}/`} />;
}
