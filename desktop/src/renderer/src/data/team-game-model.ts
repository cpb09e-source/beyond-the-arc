import { confDisplay } from "@/lib/conf-display";
import { logoIdMap, normTeamName } from "@/lib/scatter-team";
import { CONF, HOME, NEUTRAL, POST, T, TOURNEY, WON, type TeamGamePack } from "@/lib/team-game-index";
import cbbTeams from "@/data/cbb-team-ids.json";
import { normalizeText } from "~/ui/text";
import type { DataSource } from "../../../preload";

/**
 * One team in one game, as the Team Game Log handles it.
 *
 * THE PACK STAYS WHOLE. Every stat is read from the packed row by the site's own
 * TEAM_GAME_STATS getters, and every chip is ranked by the site's own
 * seasonPercentiles over the same pack, so a number here is the number on the
 * site's game log. What this adds is only what a row needs to draw quickly:
 * names and crests resolved once, the flags unpacked, a short date, and the
 * text the filter box searches, folded once rather than on every keystroke.
 */

export type TeamGame = {
  /** Position in pack.rows: the row's key, and its key in every percentile map. */
  idx: number;
  row: number[];
  team: string;
  teamLogoId: number | null;
  conf: string;
  confLabel: string;
  /** AP rank that week, 0 when unranked. */
  ap: number;
  opp: string;
  oppLogoId: number | null;
  oppAp: number;
  won: boolean;
  site: "home" | "away" | "neutral";
  pts: number;
  pa: number;
  ot: boolean;
  conference: boolean;
  tourney: boolean;
  post: boolean;
  dateShort: string;
  hay: string;
};

export type TeamGameSeason = { year: number; pack: TeamGamePack; games: TeamGame[] };

const LOGOS = logoIdMap(cbbTeams as Record<string, { id: number }>);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_DATE = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const DAY_MS = 86_400_000;

/** "Saturday, February 14, 2026". Written when a Peek asks, not for 11,000 rows up front. */
export const longDate = (season: TeamGameSeason, game: TeamGame): string =>
  LONG_DATE.format(new Date(season.pack.epochMs + game.row[T.d]! * DAY_MS));

export async function loadTeamGameSeason(year: number): Promise<{ value: TeamGameSeason; source: DataSource }> {
  const { json, source } = await window.bta.data("team-games", year);
  const raw = JSON.parse(json) as Omit<TeamGamePack, "epochMs">;
  // The same derivation the site's loadTeamGameIndex applies.
  const pack: TeamGamePack = { ...raw, epochMs: Date.parse(`${raw.epoch}T00:00:00Z`) };

  // Per team and per opponent once, not per game.
  const teamLogos = pack.teams.names.map((n) => LOGOS[normTeamName(n)] ?? null);
  const oppLogos = pack.opps.map((n) => LOGOS[normTeamName(n)] ?? null);
  const confLabels = pack.teams.confs.map((c) => confDisplay(c));

  const games: TeamGame[] = pack.rows.map((r, idx) => {
    const t = r[T.t]!;
    const o = r[T.o]!;
    const f = r[T.f]!;
    const team = pack.teams.names[t] ?? "";
    const opp = pack.opps[o] ?? "";
    const conf = pack.teams.confs[t] ?? "";
    const day = new Date(pack.epochMs + r[T.d]! * DAY_MS);
    return {
      idx,
      row: r,
      team,
      teamLogoId: teamLogos[t] ?? null,
      conf,
      confLabel: confLabels[t] ?? "",
      ap: r[T.ap]!,
      opp,
      oppLogoId: oppLogos[o] ?? null,
      oppAp: r[T.oppAp]!,
      won: (f & WON) !== 0,
      site: f & NEUTRAL ? "neutral" : f & HOME ? "home" : "away",
      pts: r[T.pts]!,
      pa: r[T.pa]!,
      ot: r[T.ot]! > 0,
      conference: (f & CONF) !== 0,
      tourney: (f & TOURNEY) !== 0,
      post: (f & POST) !== 0,
      dateShort: `${MONTHS[day.getUTCMonth()]} ${day.getUTCDate()}`,
      hay: normalizeText(`${team} ${opp} ${confLabels[t] ?? ""} ${conf}`),
    };
  });

  return { value: { year, pack, games }, source };
}
