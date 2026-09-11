import { readJson } from "@/lib/static-data";
import { PageHeading } from "@/components/page-heading";
import { TeamScatter } from "@/components/explorer/team-scatter";
import { logoIdMap, toScatterTeams, type ScatterSourceRow } from "@/lib/scatter-team";
import { SEASON_CEIL } from "@/lib/seasons";
import cbbTeams from "@/data/cbb-team-ids.json";

/**
 * Any two team metrics against each other, with school crests as the marks.
 *
 * THE CURRENT SEASON IS RENDERED; THE REST ARE FETCHED. This page serializes one
 * season into the RSC payload — 365 rows of twenty-two numbers — so the chart is
 * on screen with no round trip, which is what a landing page needs. Every other
 * season comes from `teams-by-year/<year>.json` through loadSeason, the same
 * path the team explorer uses, which means the archive gate applies here for
 * free: 2025-26 and 2024-25 are public and everything older asks for a Season
 * Pass. Baking thirteen seasons instead would have put twelve payloads nobody
 * asked for into the page and moved the gate into the build.
 *
 * The chart lives in components/explorer/team-scatter.tsx because the whole
 * design is the selection, and this page is the server half that hands it the
 * opening season.
 */

const SEASON = SEASON_CEIL;

const seasonLabel = `${SEASON - 1}-${String(SEASON).slice(2)}`;

export const metadata = {
  title: "Team Scatter — Beyond the Arc",
  description:
    `Plot any two team metrics against each other for ${seasonLabel}, with school logos as the marks. `
    + "Adjusted efficiency, the four factors, shooting and shot selection for all 365 Division I teams — "
    + "filter by conference, pick individual teams, or open on the contender trapezoid.",
  alternates: { canonical: "/teams/scatter/" },
};

export default async function TeamScatterPage() {
  const rows = await readJson<(ScatterSourceRow & { year: number })[]>("teams-all.json");
  const logos = logoIdMap(cbbTeams as Record<string, { id: number }>);
  const teams = toScatterTeams(rows.filter((r) => r.year === SEASON), logos);

  return (
    // --page-narrow, the player/team/coach page measure, rather than the
    // explorers' --page-max. This is panels and a chart, not a twelve-column
    // table that genuinely wants a 2560px monitor: at 80vw the plot ran past a
    // metre of screen, and a scatter's job is a shape taken in at once.
    <section className="mx-auto max-w-[var(--page-narrow)] px-2 sm:px-6 lg:px-10 pt-4 lg:pt-5 pb-10">
      <PageHeading label="Team scatter" />
      <div className="mt-4">
        {/* The whole logo map, not just this season's — the picker can load any
            season into the browser and every one of them needs crests. 7.4 KB
            for all 366 teams, against re-fetching or re-deriving it per season. */}
        <TeamScatter teams={teams} season={SEASON} logos={logos} />
      </div>
    </section>
  );
}
