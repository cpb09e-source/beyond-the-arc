import { readJson } from "@/lib/static-data";
import { PageHeading } from "@/components/page-heading";
import { TeamScatter, type ScatterTeam } from "@/components/explorer/team-scatter";
import cbbTeams from "@/data/cbb-team-ids.json";

/**
 * Offense against defense, with school crests as the marks.
 *
 * CURRENT SEASON ONLY, and deliberately. Every other explorer here serializes a
 * season into the RSC payload and pays for a season picker with build time and
 * page weight; this page is one 365-row projection of two numbers, so it costs
 * almost nothing as it stands. Adding seasons means either a picker with twelve
 * payloads or a client fetch, and neither is worth doing before anybody has
 * asked for 2019's scatter. It also keeps the page outside the paywall, which
 * gates explorers by season — there is only the free one here.
 *
 * The chart itself lives in components/explorer/team-scatter.tsx: it is a
 * client component because the whole design is the selection, and this page is
 * the server half that hands it the season.
 */

const SEASON = 2026;

type TrankStats = { adjoe?: number; adjde?: number; rank?: number; wins?: number; losses?: number };
type TeamRow = { name: string; conference: string | null; year: number; team_trank_stats?: TrankStats | null };

const TEAMS = cbbTeams as Record<string, { id: number }>;
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();

const seasonLabel = `${SEASON - 1}-${String(SEASON).slice(2)}`;

export const metadata = {
  title: "Team Scatter — Beyond the Arc",
  description:
    `Every Division I team plotted by adjusted offensive and defensive efficiency for ${seasonLabel}, `
    + "with school logos as the marks. Filter by conference, pick individual teams, or show every mid-major at once.",
  alternates: { canonical: "/teams/scatter/" },
};

export default async function TeamScatterPage() {
  const rows = await readJson<TeamRow[]>("teams-all.json");
  const teams: ScatterTeam[] = rows
    .filter((r) => r.year === SEASON && r.team_trank_stats?.adjoe != null && r.team_trank_stats?.adjde != null)
    .map((r) => ({
      name: r.name,
      conf: r.conference ?? "—",
      rank: r.team_trank_stats!.rank ?? 999,
      oe: r.team_trank_stats!.adjoe!,
      de: r.team_trank_stats!.adjde!,
      id: TEAMS[norm(r.name)]?.id ?? null,
      record: `${r.team_trank_stats!.wins ?? 0}-${r.team_trank_stats!.losses ?? 0}`,
    }))
    .sort((a, b) => a.rank - b.rank);

  return (
    <section className="mx-auto max-w-[var(--page-max)] px-6 lg:px-10 pt-4 lg:pt-5 pb-10">
      <PageHeading
        label="Team scatter"
        sub={`Adjusted efficiency for all ${teams.length} Division I teams, ${seasonLabel}. Better is up and to the right.`}
      />
      {/* CAPPED, not full-bleed. --page-max is 88rem at its narrowest and grows
          with the viewport, which is sized for the explorers' twelve-column
          tables — a chart taking all of it ran past 1300px and a metre of
          screen, and a scatter gains nothing from width the way a table does.
          Its job is a shape you take in at once, and past about 900px the eye
          has to travel to compare two corners of the same cloud. */}
      <div className="mt-4 max-w-[52rem]">
        <TeamScatter teams={teams} season={SEASON} />
      </div>
    </section>
  );
}
