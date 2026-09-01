/**
 * Everything a player page renders, loaded once.
 *
 * EXTRACTED FROM THE ROUTE, which had grown to a 384-line file that both
 * loaded a dozen sources and composed eight components inline. There was no
 * seam: nothing could render a player page except that function, in that file,
 * on the server.
 *
 * That mattered the moment the live season stopped being prebuilt. Team pages
 * could be swapped to a fetched bundle in three lines because
 * loadTeamPageData already returned one object that TeamPageView consumed;
 * this is the same shape, so PlayerPageView can be rendered from data that
 * arrived over the network instead of off the disk.
 *
 * @returns null when the player does not exist or has no seasons — the caller
 *          calls notFound(), because a library should not decide a route's
 *          response.
 */
import {
  readPlayer, readPortalEntryForBartId, readPlayerRanks, readNbaDraftee,
  readRsciRank, readPlayerBoxScores, readTeamGameScores, teamGameKey,
  readGamePercentiles, readTeammates,
} from "@/lib/static-data";
import { nbaTeamName } from "@/lib/nba-draftees";
import { type PlayerOverviewOption } from "@/components/players/player-overview";
import { type GameLogRow } from "@/components/players/player-game-log";

export function fmtNum(x: number | null, digits = 1): string {
  if (x === null || x === undefined) return "—";
  return x.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
export function seasonLabel(y: number): string {
  return `${(y - 1).toString().slice(-2)}-${y.toString().slice(-2)}`;
}
// Bart's per-season role note (raw_row[64]) → the G/F/C bucket the rest of the
// site ranks by. Mirrors scripts/compute-player-ranks.mts and
// scripts/build-shot-baselines.mjs — all three must agree or a player gets
// compared against a cohort he isn't in.
const POSITION_BUCKET: Record<string, "G" | "F" | "C"> = {
  "Pure PG": "G", "Scoring PG": "G", "Combo G": "G", "Wing G": "G",
  "Wing F": "F", "Stretch 4": "F",
  "G/F": "G", "F/G": "F", "C/F": "C",
  "PF/C": "C", "C": "C",
};

// raw_row column positions — see scripts/sync-bart.mts
export function fromEnd(row: Array<string | number | null> | null, offset: number): number | null {
  if (!row || row.length <= offset) return null;
  const v = row[row.length - 1 - offset];
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export type PlayerPageData = NonNullable<Awaited<ReturnType<typeof loadPlayerPageData>>>;

export async function loadPlayerPageData(bartId: number) {
  const player = await readPlayer(bartId);
  // null rather than notFound(): a library should not decide a route's
  // response. The caller calls notFound(). Same contract as loadTeamPageData.
  if (!player || player.seasons.length === 0) return null;

  const current = player.seasons[0]!;

  // Portal lookup: if the player has committed to a new school this cycle,
  // surface the transfer in the hero with a redacted-current + new-school
  // treatment. Only kicks in when status === "Transferred" AND team_to is set.
  const portalEntry = await readPortalEntryForBartId(bartId);
  /**
   * NOT A TRANSFER IF HE ENDED UP WHERE HE STARTED.
   *
   * The banner exists because a portal commit is news about next season. A
   * player who entered the portal and withdrew has no such news: the
   * destination is the school whose name is already at the top of this page,
   * so the banner read "Transfer → Missouri" directly under MISSOURI. Mark
   * Mitchell is the case — see the same-team guards in rescore-portal.mjs and
   * patch-preview-manual-transfers.mjs, which this completes on the page side.
   *
   * Compared against the portal row's own origin rather than the page's
   * current team: `current` is the newest season we hold, which for a summer
   * move is still the old school, so testing against it would suppress the
   * banner for every genuine transfer.
   */
  const transfer = portalEntry && portalEntry.status === "Transferred" && portalEntry.team_to
    && portalEntry.team_to !== portalEntry.team_from
    ? { from: current.team_name, to: portalEntry.team_to, toConf: portalEntry.conf_to }
    : null;

  // Pre-computed percentile ranks (year × position bucket). Drives the
  // Player Overview panel. Populated for players who clear the 18g/20mpg/5.3ppg
  // baseline; the year dropdown reflects only ranked seasons.
  const ranks = await readPlayerRanks(bartId);
  const overviewOptions: PlayerOverviewOption[] = ranks
    ? ranks.seasonRanks
        .map((r) => {
          const sb = player.seasons.find((s) => s.year === r.year);
          if (!sb) return null;
          return { year: r.year, team_name: sb.team_name, ranks: r };
        })
        .filter((x): x is PlayerOverviewOption => x !== null)
    : [];

  // Season → position bucket, from Bart's per-season role note. Feeds the shot
  // chart's "vs position" court, which needs a cohort to compare against; same
  // mapping compute-player-ranks.mts uses for percentiles.
  const positionByYear: Record<string, "G" | "F" | "C"> = {};
  for (const s of player.seasons) {
    const note = (Array.isArray(s.raw_row) ? s.raw_row[64] : null) ?? s.notes;
    const b = typeof note === "string" ? POSITION_BUCKET[note] : undefined;
    if (b) positionByYear[String(s.year)] = b;
  }

  // Ranks for the season the hero shows. Falls back to the newest ranked season
  // so a player whose latest year missed the eligibility floor still gets rings
  // rather than a hole where they were.
  const heroRanks =
    ranks?.seasonRanks.find((r) => r.year === current.year) ??
    ranks?.seasonRanks.slice().sort((a, b) => b.year - a.year)[0] ??
    null;

  const row = current.raw_row;
  const stats = {
    pts: fromEnd(row, 3),
    blk: fromEnd(row, 4),
    stl: fromEnd(row, 5),
    ast: fromEnd(row, 6),
    reb: fromEnd(row, 7),
    name: typeof row?.[0] === "string" ? row[0] : null,
    height: typeof row?.[26] === "string" ? row[26] : null,
    hometown: typeof row?.[33] === "string" ? row[33] : null,
  };

  /**
   * The game log, with each night's opponent conference joined in.
   *
   * The player box does not say which conference the opponent was in, so the
   * conference split is joined from the team log on TEAM NAME AND DATE — the
   * two files key games in different id spaces, and a team plays at most once
   * on a date. The team
   * for a given row is the team the player was on THAT season, which is why
   * this walks the seasons rather than using the current one: a transfer's
   * 24-25 games have to join against his old school.
   *
   * Newest first, which is the order the table reads and what makes its
   * "last 5" split a slice from the front.
   */
  const boxRows = await readPlayerBoxScores(bartId);
  const teamByYear = new Map(player.seasons.map((sn) => [sn.year, sn.team_name]));
  const scoreYears = new Map<number, Awaited<ReturnType<typeof readTeamGameScores>>>();
  for (const y of new Set(boxRows.map((r) => r.year))) {
    scoreYears.set(y, await readTeamGameScores(y));
  }
  const logRows: GameLogRow[] = boxRows
    .map((r) => {
      const team = teamByYear.get(r.year) ?? null;
      const scores = scoreYears.get(r.year);
      const hit = team && r.game_date ? scores?.get(teamGameKey(team, r.game_date)) ?? null : null;
      return {
        ...r,
        // Null rather than false where the join missed: an unmatched game is
        // not a non-conference game, and the split would quietly file it as
        // one. Both conference splits test explicitly for true/false.
        isConf:
          hit && hit.teamConf && hit.oppConf ? hit.teamConf === hit.oppConf : null,
      };
    })
    .sort((a, b) => (b.game_date ?? "").localeCompare(a.game_date ?? ""));

  // The rest of the roster for the season the hero shows. Read against the
  // team the player actually played for that year, not the transfer's
  // destination — the hero's teamName is already resolved that way above.
  const teammates = await readTeammates(
    transfer ? transfer.from : current.team_name,
    current.year,
    bartId,
  );

  /**
   * National percentile ladders for the game log's shooting chips, narrowed to
   * the position the player was listed at IN EACH SEASON.
   *
   * Per season rather than once: a player who arrives as a guard and finishes
   * as a forward should have each year's nights ranked against the players he
   * was actually on the floor as. The bucket comes from Bart's own role note
   * for that year, falling back to the hero's bucket and then to G.
   *
   * The whole file is a few hundred KB and read once for the build; only the
   * seasons this player has are handed to the client.
   */
  const gamePct = await readGamePercentiles();
  const logLadders: Record<string, Record<string, number[]>> = {};
  for (const y of new Set(logRows.map((r) => r.year))) {
    const bucket = positionByYear[String(y)] ?? heroRanks?.bucket ?? "G";
    const forYear = gamePct?.seasons?.[String(y)]?.[bucket];
    if (forYear) logLadders[String(y)] = forYear;
  }

  /**
   * NBA draft record, matched on name.
   *
   * A drafted player has left college, so this SUPERSEDES the transfer banner
   * rather than stacking with it: a portal entry from an earlier cycle is stale
   * the moment a player is drafted, and showing both would have him arriving at
   * a new school and going to the NBA in the same breath.
   */
  const draft = await readNbaDraftee(stats.name);
  const rsci = await readRsciRank(stats.name);
  const draftTeam = draft && draft.pick !== null ? nbaTeamName(draft.team, draft.year) : null;

  return {
    bartId, player, current, stats, transfer, ranks, overviewOptions,
    positionByYear, heroRanks, logRows, teammates, gamePct, logLadders,
    draft, rsci, draftTeam,
  };
}
