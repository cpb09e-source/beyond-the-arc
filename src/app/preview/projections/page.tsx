import fs from "node:fs/promises";
import path from "node:path";
import { PREVIEW_SEASON_LABEL } from "@/components/teams/team-page-view";
import { ProjectionsClient, type ProjectionFile } from "@/components/preview/projections-client";

export const metadata = {
  title: `${PREVIEW_SEASON_LABEL} Team Projections`,
  description:
    `Projected ${PREVIEW_SEASON_LABEL} college basketball team ratings for all 365 Division I teams, built from EPM — returning production, transfer additions and incoming freshmen, with projected rotations and minutes.`,
  alternates: { canonical: "/preview/projections/" },
};

/**
 * Read at BUILD time and hand to the client as props, rather than fetching the
 * file in the browser. It is 1.2 MB of JSON that every visitor to this page
 * needs in full — the table ranks all 365 teams and the detail panel opens
 * without a second request — so a runtime fetch would only add a round trip
 * before anything could render. Next inlines it into the RSC payload, which the
 * CDN serves compressed.
 */
export default async function ProjectionsPage() {
  const raw = await fs.readFile(path.join(process.cwd(), "public", "data", "projections-2027.json"), "utf8");
  const data = JSON.parse(raw) as ProjectionFile;
  return <ProjectionsClient data={data} />;
}
