import { readJson } from "@/lib/static-data";
import { PageHeading } from "@/components/page-heading";
import { TeamScatter, type ScatterTeam } from "@/components/explorer/team-scatter";
import { extractMetrics } from "@/lib/team-scatter-metrics";
import cbbTeams from "@/data/cbb-team-ids.json";

/**
 * Any two team metrics against each other, with school crests as the marks.
 *
 * CURRENT SEASON ONLY, and deliberately. Every other explorer here serializes a
 * season into the RSC payload and pays for a season picker with build time and
 * page weight; this page is one 365-row projection of twenty-two numbers, so it
 * costs almost nothing as it stands. Adding seasons means either twelve
 * payloads or a derived file the client fetches — the shape the conference
 * rankings use — and neither is worth doing before anyone has asked for 2019's
 * scatter. It also keeps the page outside the paywall, which gates explorers by
 * season: there is only the free one here.
 *
 * The chart lives in components/explorer/team-scatter.tsx because the whole
 * design is the selection, and this page is the server half that hands it the
 * season.
 */

const SEASON = 2026;

type TeamRow = {
  name: string;
  conference: string | null;
  year: number;
  team_trank_stats?: Record<string, unknown> | null;
  team_season_stats?: Record<string, unknown> | null;
};

const TEAMS = cbbTeams as Record<string, { id: number; color1: string; color2: string }>;
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Team color, with a floor on how pale it is allowed to be.
 *
 * A few schools' primary is near-white — Abilene Christian is #c5c3cd — and a
 * dot in that color is simply not on the page. Falling back to the secondary
 * when the primary is too light keeps every team visible in the no-logos view
 * without abandoning team color as the encoding.
 */
function teamColor(name: string): string {
  const e = TEAMS[norm(name)];
  if (!e) return "var(--ink-soft)";
  const h = e.color1.replace("#", "");
  if (h.length !== 6) return e.color1;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  return lum > 0.72 ? e.color2 : e.color1;
}

const seasonLabel = `${SEASON - 1}-${String(SEASON).slice(2)}`;

export const metadata = {
  title: "Team Scatter — Beyond the Arc",
  description:
    `Plot any two team metrics against each other for ${seasonLabel}, with school logos as the marks. `
    + "Adjusted efficiency, the four factors, shooting and shot selection for all 365 Division I teams — "
    + "filter by conference, pick individual teams, or show every mid-major at once.",
  alternates: { canonical: "/teams/scatter/" },
};

export default async function TeamScatterPage() {
  const rows = await readJson<TeamRow[]>("teams-all.json");
  const teams: ScatterTeam[] = rows
    .filter((r) => r.year === SEASON && typeof r.team_trank_stats?.adjoe === "number")
    .map((r) => {
      const tr = r.team_trank_stats ?? {};
      return {
        name: r.name,
        conf: r.conference ?? "—",
        rank: typeof tr.rank === "number" ? tr.rank : 999,
        id: TEAMS[norm(r.name)]?.id ?? null,
        color: teamColor(r.name),
        record: `${(tr.wins as number) ?? 0}-${(tr.losses as number) ?? 0}`,
        m: extractMetrics(r),
      };
    })
    .sort((a, b) => a.rank - b.rank);

  return (
    // --page-narrow, the player/team/coach page measure, rather than the
    // explorers' --page-max. This is panels and a chart, not a twelve-column
    // table that genuinely wants a 2560px monitor: at 80vw the plot ran past a
    // metre of screen, and a scatter's job is a shape taken in at once.
    <section className="mx-auto max-w-[var(--page-narrow)] px-6 lg:px-10 pt-4 lg:pt-5 pb-10">
      <PageHeading
        label="Team scatter"
        sub={`Any two metrics, all ${teams.length} Division I teams, ${seasonLabel}. Better is up and to the right.`}
      />
      <div className="mt-4">
        <TeamScatter teams={teams} season={SEASON} />
      </div>
    </section>
  );
}
