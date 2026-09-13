import { confDisplay } from "@/lib/conf-display";
import { logoIdMap, normTeamName } from "@/lib/scatter-team";
import { ALL_SEASONS, SEASON_CEIL } from "@/lib/seasons";
import cbbTeams from "@/data/cbb-team-ids.json";
import photoMap from "@/data/player-photos.json";
import type { DataSource } from "../../../preload";

/**
 * What Ctrl K can find: every team-season and player-season the site indexes,
 * for every season the app opens.
 *
 * THE SITE'S OWN INDEXES. teams-index.json and players-index.json are built for
 * exactly this, and search-index.json carries the site's team aliases (UConn,
 * Zags, Ole Miss), so nothing here re-reads thirteen season files to learn a
 * name. About 4 MB of text, parsed once in the background at launch.
 *
 * ONE ENTRY PER SEASON. The palette collapses a player or team to its best
 * season unless the query names one, so "flagg" is one row and "flagg 2025" is
 * that season.
 */

export type TeamHit = {
  kind: "team";
  name: string;
  year: number;
  conf: string;
  confLabel: string;
  logoId: number | null;
  /** The site's nicknames for the school, space-separated, or "". */
  aliases: string;
};

export type PlayerHit = {
  kind: "player";
  bartId: number;
  name: string;
  year: number;
  team: string;
  teamLogoId: number | null;
  conf: string;
  cls: string | null;
  games: number | null;
  minutes: number | null;
  hasPhoto: boolean;
};

export type SearchData = { teams: TeamHit[]; players: PlayerHit[] };

type TeamIndexRow = { n: string; y: number; c: string | null };
/** `id` is Bart's player id, the same id the player photos and pages use. */
type PlayerIndexRow = { id: number; n: string; y: number; t: string; c: string | null; cl: string | null; g: number | null; m: number | null };
type SiteSearchIndex = { e: Array<{ t: string; n: string; k?: string }> };

const LOGOS = logoIdMap(cbbTeams as Record<string, { id: number }>);
const PHOTOS = photoMap as Record<string, string>;
const OPENABLE = new Set<number>(ALL_SEASONS);

export async function loadSearchData(): Promise<{ value: SearchData; source: DataSource }> {
  // Cross-season files; the year passed is the newest season they cover.
  const [teamsFile, playersFile, siteFile] = await Promise.all([
    window.bta.data("teams-index", SEASON_CEIL),
    window.bta.data("players-index", SEASON_CEIL),
    window.bta.data("search-index", SEASON_CEIL),
  ]);

  const aliases = new Map<string, string>();
  for (const e of (JSON.parse(siteFile.json) as SiteSearchIndex).e) {
    if (e.t === "t" && e.k) aliases.set(e.n, e.k);
  }

  const teams: TeamHit[] = [];
  for (const r of JSON.parse(teamsFile.json) as TeamIndexRow[]) {
    // The index reaches back past the first season the app can open.
    if (!OPENABLE.has(r.y)) continue;
    teams.push({
      kind: "team",
      name: r.n,
      year: r.y,
      conf: r.c ?? "",
      confLabel: confDisplay(r.c),
      logoId: LOGOS[normTeamName(r.n)] ?? null,
      aliases: aliases.get(r.n) ?? "",
    });
  }

  const players: PlayerHit[] = [];
  for (const r of JSON.parse(playersFile.json) as PlayerIndexRow[]) {
    if (!OPENABLE.has(r.y)) continue;
    players.push({
      kind: "player",
      bartId: r.id,
      name: r.n,
      year: r.y,
      team: r.t,
      teamLogoId: LOGOS[normTeamName(r.t)] ?? null,
      conf: r.c ?? "",
      cls: r.cl,
      games: r.g,
      minutes: r.m,
      hasPhoto: PHOTOS[String(r.id)] != null,
    });
  }

  return { value: { teams, players }, source: playersFile.source };
}
