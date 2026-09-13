import { confDisplay } from "@/lib/conf-display";
import { F, HOME, NEUTRAL, STARTED, WON, type GamePack, type GameStat } from "@/lib/game-index";
import { logoIdMap, normTeamName } from "@/lib/scatter-team";
import cbbTeams from "@/data/cbb-team-ids.json";
import photoMap from "@/data/player-photos.json";
import { normalizeText } from "~/ui/text";
import type { DataSource } from "../../../preload";
import { midrankByValue } from "./midrank-by-value";

/**
 * A season of player-games: about 118,000 rows, every one on the table.
 *
 * ROWS STAY PACKED. The site's game index is integer rows against string
 * tables, and so is this: a row is its index and its array, and names, crests
 * and photos are resolved once per player (about 4,900) and once per opponent
 * rather than once per game. Every stat is the site's GAME_STATS getter.
 *
 * VALUES AND PERCENTILES ARE CACHED PER STAT, as typed arrays: a sort reads a
 * number from an array instead of recomputing Game Score two million times, and
 * a wide view's chips cost a byte a row.
 */

export type PlayerGame = { idx: number; row: number[] };

export type GamePlayer = {
  bartId: number;
  name: string;
  team: string;
  teamLogoId: number | null;
  conf: string;
  confLabel: string;
  cls: string | null;
  hasPhoto: boolean;
  /** BTA overall rank for the season, 0 when unranked. */
  rank: number;
  hay: string;
};

export type GameOpp = { name: string; logoId: number | null; hay: string };

export type PlayerGameSeason = {
  year: number;
  pack: GamePack;
  games: PlayerGame[];
  players: GamePlayer[];
  opps: GameOpp[];
};

const LOGOS = logoIdMap(cbbTeams as Record<string, { id: number }>);
const PHOTOS = photoMap as Record<string, string>;
const DAY_MS = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_DATE = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export async function loadPlayerGameSeason(year: number): Promise<{ value: PlayerGameSeason; source: DataSource }> {
  const { json, source } = await window.bta.data("player-games", year);
  const raw = JSON.parse(json) as Omit<GamePack, "epochMs">;
  // The same derivation the site's loadGameIndex applies.
  const pack: GamePack = { ...raw, epochMs: Date.parse(`${raw.epoch}T00:00:00Z`) };
  const P = pack.players;

  const players: GamePlayer[] = P.ids.map((bartId, i) => {
    const team = P.teams[i] ?? "";
    const conf = P.confs[i] ?? "";
    const confLabel = confDisplay(conf);
    const name = P.names[i] ?? "";
    return {
      bartId,
      name,
      team,
      teamLogoId: LOGOS[normTeamName(team)] ?? null,
      conf,
      confLabel,
      cls: pack.classes[P.cls[i] ?? 0] || null,
      hasPhoto: PHOTOS[String(bartId)] != null,
      rank: P.rank[i] ?? 0,
      hay: normalizeText(`${name} ${team} ${confLabel} ${conf}`),
    };
  });
  const opps: GameOpp[] = pack.opps.map((name) => ({
    name,
    logoId: LOGOS[normTeamName(name)] ?? null,
    hay: normalizeText(name),
  }));
  const games: PlayerGame[] = pack.rows.map((row, idx) => ({ idx, row }));

  return { value: { year, pack, games, players, opps }, source };
}

export const wonGame = (row: number[]): boolean => (row[F.f]! & WON) !== 0;
export const startedGame = (row: number[]): boolean => (row[F.f]! & STARTED) !== 0;
export const siteOf = (row: number[]): "home" | "away" | "neutral" =>
  row[F.f]! & NEUTRAL ? "neutral" : row[F.f]! & HOME ? "home" : "away";

export function shortDate(pack: GamePack, row: number[]): string {
  const d = new Date(pack.epochMs + row[F.d]! * DAY_MS);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export const longDate = (pack: GamePack, row: number[]): string =>
  LONG_DATE.format(new Date(pack.epochMs + row[F.d]! * DAY_MS));

const VALUES = new WeakMap<GamePack, Map<string, Float64Array>>();

/** One stat for every row of the season, NaN where the site's getter gives null. */
export function statValues(pack: GamePack, st: GameStat): Float64Array {
  let byStat = VALUES.get(pack);
  if (!byStat) VALUES.set(pack, (byStat = new Map()));
  const hit = byStat.get(st.key);
  if (hit) return hit;
  const out = new Float64Array(pack.rows.length);
  for (let i = 0; i < pack.rows.length; i++) out[i] = st.get(pack.rows[i]!) ?? Number.NaN;
  byStat.set(st.key, out);
  return out;
}

const PCTS = new WeakMap<GamePack, Map<string, Uint8Array>>();

/**
 * Where each game's number sits among every player-game of the season: the same
 * cohort rule as the Team Game Log, never the rows a shortcut or filter left.
 */
export function statPercentiles(pack: GamePack, st: GameStat): Uint8Array {
  let byStat = PCTS.get(pack);
  if (!byStat) PCTS.set(pack, (byStat = new Map()));
  const hit = byStat.get(st.key);
  if (hit) return hit;
  const out = midrankByValue(statValues(pack, st), !st.lowerBetter);
  byStat.set(st.key, out);
  return out;
}

/**
 * The filter box, as a test per row that costs two array reads per word.
 *
 * Every word has to land in the player's name, team or conference, or in the
 * opponent's name. Folding and matching happen once per player and opponent,
 * about 5,600 strings, instead of once per game.
 */
export function gameMatcher(season: PlayerGameSeason, query: string): ((g: PlayerGame) => boolean) | null {
  const words = normalizeText(query).split(" ").filter(Boolean);
  if (words.length === 0) return null;
  const inPlayer = words.map((w) => Uint8Array.from(season.players, (p) => (p.hay.includes(w) ? 1 : 0)));
  const inOpp = words.map((w) => Uint8Array.from(season.opps, (o) => (o.hay.includes(w) ? 1 : 0)));
  return (g) => {
    const p = g.row[F.p]!;
    const o = g.row[F.o]!;
    for (let i = 0; i < words.length; i++) if (!inPlayer[i]![p] && !inOpp[i]![o]) return false;
    return true;
  };
}
