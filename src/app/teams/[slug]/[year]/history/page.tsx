import { notFound } from "next/navigation";
import { TeamPageView } from "@/components/teams/team-page-view";
import { LiveTeamPage } from "@/components/teams/live-team-page";
import { isLiveSeason } from "@/lib/seasons";
import { loadTeamPageData } from "@/lib/team-page-data";
import { tabbedSeasonParams, tabMetadata } from "@/lib/team-tab-route";

// The tabbed window plus the review teams — see team-tab-route.ts.
export const generateStaticParams = tabbedSeasonParams;

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

  /**
   * The live season is fetched, not baked — see src/lib/live-team-page.ts.
   * `data` is still loaded here and passed down: it is the last build's
   * numbers, and it is what this page ships as HTML and what stays on screen
   * if the live file cannot be reached.
   */
  if (isLiveSeason(year)) {
    return <LiveTeamPage slug={slug} fallback={data} tab="history" />;
  }
  return <TeamPageView {...data} tab="history" />;
}
