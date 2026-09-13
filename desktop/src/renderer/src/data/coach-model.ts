import coachHistory from "@/data/coach-history.json";
import teamCoaches from "@/data/team-coaches.json";
import tournamentGames from "@/data/tournament-games.json";
import { coachPercentiles, compositeRankLookup, sortCoachesDefault, type CoachPercentiles } from "@/lib/coach-views";
import {
  buildCoachProfiles,
  toIndexRow,
  type CoachHistory,
  type CoachIndexRow,
  type CoachProfile,
  type EspnCoachSnapshot,
  type TournamentGamesByYear,
} from "@/lib/coaches-core";
import { ALL_SEASONS, isUsableSeason, PREVIEW_SEASON } from "@/lib/seasons";
import type { StaticTeamSeasonRow } from "@/lib/static-data";
import type { DataSource } from "../../../preload";
import { seasonLabel } from "~/ui/format";
import { loadOnce, useLoaded, type CorpusState } from "./use-corpus";

/**
 * Every coach, built the way the site builds /coaches.
 *
 * THE SITE'S OWN BUILD. src/lib/coaches-core.ts is what the site's pages call,
 * fed the same four sources: the coach history, ESPN's current snapshot and the
 * bracket (bundled, as the Win Calculator bundles the history), and every
 * team-season row in the usable window. The site reads those rows from
 * teams-all.json; the app reads them a season at a time from the files it
 * already has, which was proven to give byte-identical profiles.
 *
 * A SEASON THAT CANNOT BE READ (a paid season, signed out) is left out and
 * named, so a profile never quietly shows ratings from fewer seasons than it
 * says.
 */

export type CoachBook = {
  profiles: CoachProfile[];
  bySlug: Map<string, CoachProfile>;
  /** The index, in the site's default order: composite, then last name. */
  rows: CoachIndexRow[];
  pct: CoachPercentiles;
  /** Composite rank by slug, 1 = best, as the site's compare modal ranks. */
  compositeRank: Map<string, number>;
  /** Seasons whose team rows could not be read. */
  missing: number[];
};

async function readBook(): Promise<{ value: CoachBook; source: DataSource }> {
  const years = [...new Set([...ALL_SEASONS, PREVIEW_SEASON])].filter(isUsableSeason).sort((a, b) => a - b);
  const teams: StaticTeamSeasonRow[] = [];
  const missing: number[] = [];
  let source: DataSource = "memory";
  for (const year of years) {
    try {
      const got = await window.bta.data("teams", year);
      const rows = JSON.parse(got.json) as StaticTeamSeasonRow[] | null;
      if (rows) for (const t of rows) if (isUsableSeason(t.year)) teams.push(t);
      if (got.source !== "memory") source = got.source;
    } catch {
      missing.push(year);
    }
    // A breath between seasons, so the window stays responsive while they parse.
    await new Promise((r) => setTimeout(r, 0));
  }
  const profiles = buildCoachProfiles({
    history: coachHistory as unknown as CoachHistory,
    espn: teamCoaches as unknown as EspnCoachSnapshot,
    teams,
    tournamentGames: tournamentGames as unknown as TournamentGamesByYear,
  });
  const rows = sortCoachesDefault(profiles.map(toIndexRow));
  return {
    value: {
      profiles,
      bySlug: new Map(profiles.map((p) => [p.slug, p])),
      rows,
      pct: coachPercentiles(rows),
      compositeRank: compositeRankLookup(rows),
      missing,
    },
    source,
  };
}

export function useCoachBook(): [CorpusState<CoachBook>, () => void] {
  return useLoaded("coach-book", readBook);
}

/** The same book outside a component: an action copying a coach's line. */
export const loadCoachBook = (): Promise<CoachBook> => loadOnce("coach-book", readBook);

/** A 1-based rank among `total` as a percentile, 100 = first. */
export const rankPct = (rank: number, total: number): number | null =>
  rank > 0 && total > 1 ? Math.round((100 * (total - rank)) / (total - 1)) : null;

/** A run of seasons as "2014–26", or one season as "2025-26". */
export const yearsSpan = (first: number, last: number): string =>
  first === last ? seasonLabel(first) : `${first - 1}–${String(last).slice(2)}`;
