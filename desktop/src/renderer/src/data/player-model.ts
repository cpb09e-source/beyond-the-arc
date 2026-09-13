import { confDisplay } from "@/lib/conf-display";
import { formatHeight } from "@/lib/height";
import {
  PCT_KEYS,
  impactFromFiles,
  passesLeaderboardFloor,
  processPlayerSeason,
  type ExplorerPayload,
  type ImpactEntry,
  type PctKey,
  type ShootingEntry,
} from "@/lib/player-cohort";
import { DEFAULT_PLAYER_SPEC, EWINS_FIRST_YEAR, type PlayerSummary } from "@/lib/players";
import { logoIdMap, normTeamName } from "@/lib/scatter-team";
import cbbTeams from "@/data/cbb-team-ids.json";
import photoMap from "@/data/player-photos.json";
import type { DataSource } from "../../../preload";

/**
 * A player-season as the app handles it.
 *
 * EVERY NUMBER IS THE SITE'S. The row expansion, the impact attachment, the
 * leaderboard floor and the percentiles all come from src/lib/player-cohort.ts,
 * the same module the site's Player Explorer runs, so a chip here is the chip
 * there.
 */
export type Player = {
  id: number;
  bartId: number | null;
  name: string;
  team: string;
  teamLogoId: number | null;
  conf: string;
  confLabel: string;
  cls: string | null;
  height: string | null;
  hometown: string | null;
  position: string | null;
  /** BTA's overall player rank for the season. */
  rank: number | null;
  hasPhoto: boolean;
  /** The summary the site's explorer builds, for any cell to read. */
  s: PlayerSummary;
  /** Percentile per chip-bearing field, over the season's eligible pool. */
  pct: Partial<Record<PctKey, number>>;
};

export type PlayerSeason = {
  year: number;
  /** Players on the leaderboard: past the floor at the site's default minimum. */
  players: Player[];
  /** EPM comes from the box-score estimate, not a play-by-play fit (before 2024). */
  estimated: boolean;
  /**
   * Whether anyone this season has eWins. It needs the real play-by-play fit,
   * so before 2024 the column would be a dash on every row and is not shown.
   * Read from the data, not the calendar, so a season that gains a fit gains
   * the column.
   */
  hasEwins: boolean;
  /** eWins needs the real fit, so earlier seasons sort on EPM, as the site does. */
  defaultSort: "ewins" | "epm";
  minGames: number;
};

const LOGOS = logoIdMap(cbbTeams as Record<string, { id: number }>);
/**
 * Bart ids with a downloaded headshot. Only those are requested, so the 16,000
 * players without one never produce a failed image request.
 */
const PHOTOS = photoMap as Record<string, string>;
const MIN_GAMES = DEFAULT_PLAYER_SPEC.minGames;

type ImpactFile = { players?: Record<string, ImpactEntry> } | null;

export async function loadPlayerSeason(year: number): Promise<{ value: PlayerSeason; source: DataSource }> {
  const [main, realFit, box, shooting] = await Promise.all([
    window.bta.data("players", year),
    window.bta.data("player-impact", year),
    window.bta.data("player-box", year),
    window.bta.data("player-shooting", year),
  ]);

  const boxFile = JSON.parse(box.json) as ImpactFile;
  const shootingFile = JSON.parse(shooting.json) as { players?: Record<string, ShootingEntry> } | null;
  const impact = impactFromFiles(JSON.parse(realFit.json) as ImpactFile, boxFile);
  const { players, pctMaps } = processPlayerSeason(
    JSON.parse(main.json) as ExplorerPayload,
    impact,
    boxFile?.players ?? {},
    shootingFile?.players ?? {},
  );

  const listed: Player[] = [];
  for (const s of players) {
    if (!passesLeaderboardFloor(s, MIN_GAMES)) continue;
    const pct: Partial<Record<PctKey, number>> = {};
    for (const k of PCT_KEYS) {
      const v = pctMaps[k].get(s.id);
      if (v != null) pct[k] = v;
    }
    listed.push({
      id: s.id,
      bartId: s.bart_player_id,
      name: s.name,
      team: s.team_name,
      teamLogoId: LOGOS[normTeamName(s.team_name)] ?? null,
      conf: s.team_conference ?? "",
      confLabel: confDisplay(s.team_conference),
      cls: s.class,
      height: formatHeight(s.height),
      hometown: s.hometown,
      position: s.position_note,
      rank: s.rank_overall,
      hasPhoto: s.bart_player_id != null && PHOTOS[String(s.bart_player_id)] != null,
      s,
      pct,
    });
  }

  return {
    value: {
      year,
      players: listed,
      estimated: impact.estimated,
      hasEwins: listed.some((p) => p.s.ewins != null),
      defaultSort: year >= EWINS_FIRST_YEAR ? "ewins" : "epm",
      minGames: MIN_GAMES,
    },
    source: main.source,
  };
}
