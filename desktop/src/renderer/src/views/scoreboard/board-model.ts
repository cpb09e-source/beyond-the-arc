import photoMap from "@/data/player-photos.json";
import { archivedDays, isKnownDay, knownSeasons, latestArchivedDay, seasonOfDate } from "@/lib/scoreboard-archive";
import type { Slate } from "@/lib/scoreboard-core";
import { SEASON_CEIL } from "@/lib/seasons";
import { buildCanonMap, canonicalTeamName } from "@/lib/team-name-match";
import { useLoaded, type CorpusState } from "~/data/use-corpus";
import type { RecordRef } from "~/shell/views";
import { logoIdOf } from "~/ui/logo-id";

/**
 * The scoreboard's data: a day's slate, the calendar of days that have one, and
 * CBBD's team names as the app knows them.
 *
 * THE DAY IS THE TAB'S QUERY (d=2026-03-19&f=@top25), so a favorite keeps the
 * night and the filter, and Alt+Left goes back a night. No date means the latest
 * night the archive holds, which is what the site's /scoreboard shows out of
 * season.
 *
 * TWO NAME SPACES. Slates and box scores spell schools the way CBBD does
 * ("Michigan State", "UConn"); every page here uses ours ("Michigan St.",
 * "Connecticut"). The site's own matcher (src/lib/team-name-match.ts) bridges
 * them against /data/team-names.json, and a name it cannot place is a school
 * with no page here, shown as text with no link.
 */

const DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

let days: string[] | null = null;
/** Every day with a slate, played or scheduled, oldest first. */
function gameDays(): string[] {
  days ??= knownSeasons()
    .flatMap((s) => archivedDays(s))
    .sort();
  return days;
}

/** The last night of the latest completed season. */
export const latestDay = (): string => latestArchivedDay() ?? gameDays()[gameDays().length - 1] ?? "2026-04-06";

/** Opening night of the season being scheduled, when there is one past the archive. */
export function nextSeasonOpener(): string | null {
  const seasons = knownSeasons();
  const last = seasons[seasons.length - 1];
  if (last == null) return null;
  const first = archivedDays(last)[0];
  return first && first > latestDay() ? first : null;
}

/** The nearest day with games before (-1) or after (1) `d`, across seasons. */
export function stepGameDay(d: string, dir: -1 | 1): string | null {
  const list = gameDays();
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid]! <= d) lo = mid + 1;
    else hi = mid;
  }
  // lo is the first day after d.
  if (dir === 1) return list[lo] ?? null;
  let i = lo - 1;
  if (list[i] === d) i--;
  return i >= 0 ? list[i]! : null;
}

export { isKnownDay, seasonOfDate };

export type Board = { date: string; filter: string };

export function parseBoard(query: string): Board {
  const p = new URLSearchParams(query);
  const d = p.get("d");
  const date = d && DAY.test(d) && knownSeasons().includes(seasonOfDate(d)) ? d : latestDay();
  return { date, filter: p.get("f") ?? "" };
}

export function serializeBoard(b: Board): string {
  const p = new URLSearchParams();
  if (b.date !== latestDay()) p.set("d", b.date);
  if (b.filter) p.set("f", b.filter);
  return p.toString();
}

export function useSlate(date: string): [CorpusState<Slate | null>, () => void] {
  return useLoaded(`slate|${date}`, async () => {
    const { json, source } = await window.bta.data("scoreboard-day", seasonOfDate(date), date);
    return { value: JSON.parse(json) as Slate | null, source };
  });
}

export type TeamNames = { canon: Map<string, string> };

export function useTeamNames(): CorpusState<TeamNames> {
  const [state] = useLoaded("team-names", async () => {
    const { json, source } = await window.bta.data("team-names", SEASON_CEIL);
    const file = JSON.parse(json) as { teams: Array<{ name: string }> };
    return { value: { canon: buildCanonMap(file.teams.map((t) => t.name)) }, source };
  });
  return state;
}

/** A school as CBBD names it, with our name when it is one we cover, and its crest. */
export type Side = { name: string; ours: string | null; logoId: number | null };

const sides = new WeakMap<Map<string, string>, Map<string, Side>>();

export function sideOf(names: TeamNames | null, cbbd: string): Side {
  if (!names) return { name: cbbd, ours: null, logoId: logoIdOf(cbbd) };
  let m = sides.get(names.canon);
  if (!m) {
    m = new Map();
    sides.set(names.canon, m);
  }
  let s = m.get(cbbd);
  if (!s) {
    const ours = canonicalTeamName(names.canon, cbbd);
    s = { name: cbbd, ours, logoId: logoIdOf(ours ?? cbbd) };
    m.set(cbbd, s);
  }
  return s;
}

type GameLike = { id: number; neutralSite: boolean; away: { team: string }; home: { team: string } };

/** A game as a record a tab can hold. */
export function gameRecord(season: number, g: GameLike, names: TeamNames | null): Extract<RecordRef, { kind: "game" }> {
  const away = sideOf(names, g.away.team);
  const home = sideOf(names, g.home.team);
  return {
    kind: "game",
    season,
    id: g.id,
    name: `${g.away.team} ${g.neutralSite ? "vs" : "at"} ${g.home.team}`,
    away: g.away.team,
    home: g.home.team,
    awayLogo: away.logoId,
    homeLogo: home.logoId,
  };
}

const PHOTOS = photoMap as Record<string, string>;
/** Only players with a downloaded headshot ask for one, as everywhere in the app. */
export const hasPhoto = (bartId: number | null): boolean => bartId != null && PHOTOS[String(bartId)] != null;
