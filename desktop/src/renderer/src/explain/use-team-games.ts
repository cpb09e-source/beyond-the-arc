import { useMemo } from "react";
import type { StaticTeamSeasonRow } from "@/lib/static-data";
import { T } from "@/lib/team-game-index";
import { loadTeamGameSeason, type TeamGame, type TeamGameSeason } from "~/data/team-game-model";
import { shapeSeason, type Season, type Team } from "~/data/team-model";
import { useCorpus, useLoaded, type CorpusState } from "~/data/use-corpus";

const shapeTeams = (json: string, year: number): Season => shapeSeason(year, JSON.parse(json) as StaticTeamSeasonRow[]);

export type TeamSeasonGames = {
  teams: CorpusState<Season>;
  log: CorpusState<TeamGameSeason>;
  /** The team's row in the Team Explorer, once the season has loaded. */
  team: Team | null;
  /** The team's games, in date order. */
  games: TeamGame[];
  /** Every team of the season by name, for what an opponent was. */
  byName: Map<string, Team>;
  ready: boolean;
};

/** One team's season: its explorer row and its games, through the caches every view shares. */
export function useTeamSeasonGames(year: number, name: string | null): TeamSeasonGames {
  const [teams] = useCorpus("teams", year, shapeTeams);
  const [log] = useLoaded(`team-games|${year}`, () => loadTeamGameSeason(year));
  const season = teams.status === "ready" ? teams.value : null;
  const gameSeason = log.status === "ready" ? log.value : null;
  const byName = useMemo(() => new Map((season?.teams ?? []).map((t) => [t.name, t])), [season]);
  const games = useMemo(
    () => (gameSeason && name ? gameSeason.games.filter((g) => g.team === name).sort((a, b) => a.row[T.d]! - b.row[T.d]!) : []),
    [gameSeason, name],
  );
  return { teams, log, team: name ? (byName.get(name) ?? null) : null, games, byName, ready: !!season && !!gameSeason };
}

/** Why a season could not be read, in a sentence; null while it is loading or loaded. */
export function seasonProblem(s: TeamSeasonGames, label: string): string | null {
  for (const st of [s.log, s.teams]) {
    if (st.status !== "error") continue;
    return st.reason === "gated" ? `The ${label} game log comes with Season Pass.` : `The ${label} season did not load.`;
  }
  return null;
}
