import { notFound } from "next/navigation";
import { TeamPageView } from "@/components/teams/team-page-view";
import { loadTeamPageData } from "@/lib/team-page-data";
import { tabbedSeasonParams, tabMetadata } from "@/lib/team-tab-route";

/**
 * One team-season's game log.
 *
 * NOT TO BE CONFUSED WITH /teams/games, which is the explorer over every
 * team's every game. They render the same component — see TeamGamesScope in
 * team-games-client — and this route is the scoped one: the season comes from
 * the path and the team from the slug, so the two pickers that would set them
 * are hidden and the rest of the controls are identical.
 *
 * The paths cannot collide. /teams/games is a static segment two levels up and
 * static segments win over [slug]; this is /teams/<slug>/<year>/games.
 */
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
    tabLabel: "Game Log",
    segment: "games",
    describe:
      "every game of the season with the box beside it — filter, sort and add columns.",
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

  return <TeamPageView {...data} tab="games" />;
}
