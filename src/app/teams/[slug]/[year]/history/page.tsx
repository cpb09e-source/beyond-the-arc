import { notFound } from "next/navigation";
import { TeamPageView } from "@/components/teams/team-page-view";
import { loadTeamPageData } from "@/lib/team-page-data";
import { tabbedSeasonParams, tabMetadata } from "@/lib/team-tab-route";
import { isSeasonFree } from "@/lib/access";
import { ArchiveSeasonGate } from "@/components/teams/archive-season-gate";
import { archiveGateProps } from "@/lib/archive-gate";

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

  // THE ARCHIVE GATE, before any data is read. A gated season never reaches
  // loadTeamPageData, so its numbers are not in this file's HTML at all —
  // which is the only kind of gate a static export can actually enforce.
  if (!isSeasonFree(year)) {
    const gate = await archiveGateProps(slug, year);
    if (gate) return <ArchiveSeasonGate {...gate} />;
  }

  const data = await loadTeamPageData(slug, year);
  if (!data) notFound();

  return <TeamPageView {...data} tab="history" />;
}
