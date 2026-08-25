/**
 * Everything a team page needs, loaded once.
 *
 * WHY THIS EXISTS. This block was already copied between /teams/<slug> and
 * /teams/<slug>/<year> before the tab split, and the split adds three more
 * routes that need exactly the same data — Roster, Shooting and Play-by-play
 * all render the same hero, which reads the same season row, ranks, conference
 * records and schedule as Overview does. Five copies of a fourteen-call load
 * would drift, and the drift would be invisible: a page that quietly loses its
 * tournament-round tags still renders.
 *
 * EVERY TAB LOADS EVERYTHING, deliberately. A Roster page does not need the
 * clock splits, and skipping them per tab would save real build time. It is
 * not worth the coupling: the saving is a few file reads that are already
 * cached per season, and the cost is five routes that each know which subset
 * of the page they are allowed to ask for. If build time becomes the problem,
 * narrow it here behind one argument rather than in the routes.
 */
import {
  readPlayersForYear,
  readImpactForYear,
  readImpactExtrasForYear,
  readTeam,
  readAllTeams,
  netRanksForTeam,
  readTeamSplits,
  readRankedPlayerIds,
  readConfRecordsByTeam,
  readGameLogsForYear,
  readAssistNetwork,
  readClockSplits,
  readTeamSeasonGrid,
  readLineupStats,
  readLineupBenchmarks,
} from "@/lib/static-data";
import { toSeasonGridRows } from "@/lib/season-grid-rows";
import {
  buildRoster,
  attachRosterRanks,
  PREVIEW_SEASON_YEAR,
} from "@/components/teams/team-page-view";
import { buildShootingRanks, buildFourFactorRanks } from "@/components/teams/distribution-panel";
import { loadTournamentGames, buildGamesByTeamYear, gamesForTeamYear } from "@/lib/coaches";

// Same SHORT_ROUND mapping the coach page uses for tournament-round badges,
// so a March-Madness game in the schedule ticker reads as "R1 / R2 / S16…"
// matching the coach-resume tickers.
const SHORT_ROUND: Record<string, string> = {
  "First Four": "FF",
  "R64": "R1",
  "R32": "R2",
  "Sweet 16": "S16",
  "Elite Eight": "E8",
  "Final Four": "F4",
  "Runner-up": "NC",
  "Champion": "NC",
};

export type TeamPageData = NonNullable<Awaited<ReturnType<typeof loadTeamPageData>>>;

/**
 * @param year the season to render, or undefined for the most recent one
 *             (the bare /teams/<slug> route).
 * @returns null when the team or the season does not exist — the caller calls
 *          notFound(), because a library should not decide a route's response.
 */
export async function loadTeamPageData(slug: string, year?: number) {
  const team = await readTeam(slug);
  if (!team || team.seasons.length === 0) return null;

  // Next-season preview — renders the last-completed-season layout with the
  // game-dependent sections blurred (no games played yet). The structure comes
  // from the most-recent completed season; only the hero shows the projection.
  const isPreview = year === PREVIEW_SEASON_YEAR;
  const effYear = year === undefined || isPreview ? (team.seasons[0]?.year ?? year!) : year;

  const current = team.seasons.find((s) => s.year === effYear);
  if (!current) return null;

  const rosterPool = await readPlayersForYear(effYear);
  const epmByBart = await readImpactForYear(effYear);
  const extrasByBart = await readImpactExtrasForYear(effYear);
  const rosterBase = buildRoster(rosterPool, current.id, effYear, epmByBart, extrasByBart);
  const rankedPlayerIds = await readRankedPlayerIds();
  const roster = attachRosterRanks(rosterBase, current.roster_ranks);
  const confRecordsAll = await readConfRecordsByTeam();
  const confRecords = confRecordsAll.get(team.name) ?? new Map();
  const allTeams = await readAllTeams();
  // Headline badge + the five-year average both read aNET position in D-I.
  const netRanks = netRanksForTeam(allTeams, team.name, team.seasons.map((s) => s.year));
  // Eight-way stat splits for the season on screen. Season file is read once
  // and cached, so all ~365 team pages for a year share one parse.
  const teamSplits = await readTeamSplits(effYear, team.name);
  const assistNetwork = await readAssistNetwork(effYear, team.name);
  const clockSplits = await readClockSplits(effYear, team.name);
  const yearCohort = allTeams.filter((t) => t.year === effYear);
  const shootingRanks = buildShootingRanks(current, yearCohort);
  const fourFactorRanks = buildFourFactorRanks(current, yearCohort);
  const allGames = await readGameLogsForYear(effYear);
  // Tag any of this team's games that match a March Madness date so the
  // ticker shows the round (R1, S16, NC, etc.) above the W/L pill.
  const tourneyGamesAll = await loadTournamentGames();
  const tourneyLookup = buildGamesByTeamYear(tourneyGamesAll);
  const teamTourneyGames = gamesForTeamYear(tourneyLookup, team.name, effYear);
  const roundByDate = new Map<string, string>();
  for (const tg of teamTourneyGames) {
    if (!tg.date) continue;
    roundByDate.set(tg.date, SHORT_ROUND[tg.round] ?? tg.round);
  }
  const scheduleGames = allGames
    // Join on name, NOT id. The CBBD migration re-keyed game_logs.team_id to
    // CBBD's ids while team/*.json kept the bart id (Florida: 87 vs 3228), so
    // `g.team_id === current.id` matched nothing and the ticker silently
    // rendered as absent rather than broken. Names are exact across both
    // exports — checked all 2,158 team-seasons, zero unmatched. Same rule
    // find-game-trigger already follows.
    .filter((g) => g.team_name === team.name)
    .sort((a, b) => (a.game_date ?? "").localeCompare(b.game_date ?? ""))
    .map((g) => {
      const round = g.game_date ? roundByDate.get(g.game_date) : undefined;
      return round ? { ...g, tournamentRound: round } : g;
    });

  // By season renders the explorer's grid when this team has been baked, and
  // the older seasons table when it has not. See readTeamSeasonGrid().
  const bakedSeasons = await readTeamSeasonGrid(slug);
  const seasonGrid = bakedSeasons ? toSeasonGridRows(bakedSeasons, confRecords, netRanks) : null;

  // Five-man lineups and the league field they are ranked against. Both null
  // before 2024, where the play feed carries no onFloor — see readLineupStats.
  const lineupStats = await readLineupStats(slug, effYear);
  const lineupBenchmarks = lineupStats ? await readLineupBenchmarks(effYear) : null;

  return {
    team,
    current,
    roster,
    slug,
    rankedPlayerIds,
    confRecords,
    shootingRanks,
    fourFactorRanks,
    scheduleGames,
    netRanks,
    teamSplits,
    assistNetwork,
    clockSplits,
    seasonGrid,
    lineupStats,
    lineupBenchmarks,
    preview: isPreview,
  };
}
