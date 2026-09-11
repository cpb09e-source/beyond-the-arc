/**
 * One team-season, shaped for the scatter — and the one place that shaping happens.
 *
 * WHY IT IS NOT IN THE PAGE ANY MORE. The server renders the current season, and
 * the season picker fetches every other one into the browser, so the same
 * `teams-by-year` row has to become the same object on both sides. Two copies of
 * this mapping would disagree the first time one of them learned something — and
 * the thing they would disagree about is which crest a team gets, which is the
 * chart's entire vocabulary.
 *
 * THE LOGO ID IS NOT ON THE ROW. `row.id` is the database id (Kentucky is 3253);
 * the crest under /ttz-logos is keyed by a different id entirely (103765). The
 * lookup is by normalized name, and the map has to reach the client somehow —
 * see `logoIdMap`, which is why it is 7 KB rather than the 72 KB source file.
 */

import { extractMetrics } from "@/lib/team-scatter-metrics";

export type ScatterTeam = {
  name: string;
  conf: string;
  rank: number;
  id: number | null;
  record: string;
  m: Record<string, number | null>;
};

/** A row as it arrives from `teams-by-year/<year>.json` or `teams-all.json`. */
export type ScatterSourceRow = {
  name: string;
  conference?: string | null;
  year?: number | null;
  team_trank_stats?: Record<string, unknown> | null;
  team_season_stats?: Record<string, unknown> | null;
};

/**
 * Name → crest id, the form the browser gets.
 *
 * The source file carries seven fields a team — bart name, market, mascot, two
 * colors, conference — and the chart wants exactly one of them. Sending the
 * whole thing would be 72 KB of client payload to read 366 numbers out of; this
 * is 7.4 KB and covers every team in all thirteen seasons.
 */
export type LogoIds = Record<string, number>;

/** Same normalization the rest of the site uses to join on team name. */
export function normTeamName(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
}

/** Build the compact map from the full cbb-team-ids.json. Server side only. */
export function logoIdMap(src: Record<string, { id: number }>): LogoIds {
  const out: LogoIds = {};
  for (const [key, v] of Object.entries(src)) {
    if (typeof v?.id === "number") out[key] = v.id;
  }
  return out;
}

/**
 * Shape a season's rows for the chart, best teams first.
 *
 * Rows without an adjusted offensive rating are dropped rather than plotted at
 * the origin — that is the marker for a row that exists in the corpus without
 * having played a Division I season.
 */
export function toScatterTeams(rows: ScatterSourceRow[], logos: LogoIds): ScatterTeam[] {
  return rows
    .filter((r) => typeof r.team_trank_stats?.adjoe === "number")
    .map((r) => {
      const tr = r.team_trank_stats ?? {};
      return {
        name: r.name,
        conf: r.conference ?? "—",
        // 999 rather than null so the default sort has something to work with.
        // A team with no Torvik rank sorts last, which is where it belongs.
        rank: typeof tr.rank === "number" ? tr.rank : 999,
        id: logos[normTeamName(r.name)] ?? null,
        record: `${(tr.wins as number) ?? 0}-${(tr.losses as number) ?? 0}`,
        m: extractMetrics(r),
      };
    })
    .sort((a, b) => a.rank - b.rank);
}

/**
 * How many of these teams carry a finite value for a metric.
 *
 * COVERAGE IS A PER-SEASON FACT, and the chart has to be able to ask. Three of
 * the metrics here are built from play-by-play that CBBD only half has in the
 * older seasons — share of points on the break covers 165 of 351 teams in
 * 2013-14 — and one, adjusted net rating, is withheld outright in five seasons.
 * A scatter given a metric with no values draws an empty grid and looks broken;
 * given a thin one it draws a real chart of half the country without saying so.
 */
export function metricCoverage(teams: ScatterTeam[], key: string): number {
  let n = 0;
  for (const t of teams) if (typeof t.m[key] === "number") n++;
  return n;
}
