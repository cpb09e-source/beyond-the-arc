import { notFound } from "next/navigation";
import { TeamPageView } from "@/components/teams/team-page-view";
import { loadTeamPageData } from "@/lib/team-page-data";
import { currentSeasonParams, tabMetadata } from "@/lib/team-tab-route";

// Current season only — see the note in team-tab-route.ts.
export const generateStaticParams = currentSeasonParams;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; year: string }>;
}) {
  const { slug, year } = await params;
  return tabMetadata({
    slug,
    yearStr: year,
    tabLabel: "School History",
    segment: "history",
    describe: "every season on record — conference, record, tournament finish and adjusted ratings.",
  });
}

export default async function TeamTabPage({
  params,
}: {
  params: Promise<{ slug: string; year: string }>;
}) {
  const { slug, year: yearStr } = await params;
  const year = Number(yearStr);
  if (!Number.isFinite(year)) notFound();

  const data = await loadTeamPageData(slug, year);
  if (!data) notFound();

  return <TeamPageView {...data} tab="history" />;
}
