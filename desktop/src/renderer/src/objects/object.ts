import { coachSlug } from "@/lib/coach-slug";
import { gameSlug } from "@/lib/scoreboard-archive";
import { teamSlug } from "@/lib/team-slug";
import { isRecordRef, type RecordRef } from "~/shell/views";

/**
 * The things in the app a reader can point at: a team in a season, a player in
 * a season, a coach, a game, a row of a game log, a conference.
 *
 * AN OBJECT, NOT A ROW. Michigan in the Team Explorer, Michigan in Ctrl K,
 * Michigan's crest on a player's page and Michigan's own page are one object,
 * and every surface that shows it asks ./actions.tsx what can be done with it.
 * That is what makes right-click, Ctrl K, Peek, a record page's menu, drag and
 * the row keys all say the same thing.
 *
 * PLAIN DATA, so an object can ride a drag between panes, sit in a favorite and
 * be compared by value. It carries what its actions need and nothing a table
 * cell draws: the conference, for "Big Ten teams"; the team, for "Duke players".
 */

export type TeamObj = { kind: "team"; name: string; logoId: number | null; year: number; conf?: string };
export type PlayerObj = {
  kind: "player";
  bartId: number;
  name: string;
  hasPhoto: boolean;
  year: number;
  team?: string;
  teamLogoId?: number | null;
  conf?: string;
};
export type CoachObj = { kind: "coach"; slug: string; name: string; team: string | null };
export type GameObj = Extract<RecordRef, { kind: "game" }>;
/**
 * One row of a game log. The logs carry no game id, so the game is found on its
 * night's slate when it is opened (see ~/data/game-link.ts). `summary` is the
 * line the row itself shows, for Copy stats.
 */
export type LogGameObj = {
  kind: "log-game";
  year: number;
  /** YYYY-MM-DD, the slate's date. */
  date: string;
  team: string;
  teamLogoId: number | null;
  opp: string;
  oppLogoId: number | null;
  site: "home" | "away" | "neutral";
  summary?: string;
  /** Set on a player's game log row: whose game it was. */
  player?: { bartId: number; name: string; hasPhoto: boolean };
};
export type ConferenceObj = { kind: "conference"; conf: string; label: string; year: number };

export type Obj = TeamObj | PlayerObj | CoachObj | GameObj | LogGameObj | ConferenceObj;

/** What dragging an object carries: a type a drop target recognizes, its data, and a label to show. */
export type DragSpec = { type: string; data: string; label: string };

export const OBJECT_DRAG_TYPE = "application/x-bta-object";

const shortSeason = (y: number) => `${String(y - 1).slice(2)}-${String(y).slice(2)}`;

/** The object's name, the way a menu heading or a toast says it. */
export function objTitle(o: Obj): string {
  switch (o.kind) {
    case "team":
    case "player":
    case "coach":
    case "game":
      return o.name;
    case "log-game":
      return `${o.player ? `${o.player.name}: ` : ""}${o.team} ${o.site === "away" ? "at" : "vs"} ${o.opp}`;
    case "conference":
      return o.label;
  }
}

/** The season an object belongs to, when it belongs to one. */
export function objYear(o: Obj): number | null {
  switch (o.kind) {
    case "team":
    case "player":
    case "log-game":
    case "conference":
      return o.year;
    case "game":
      return o.season;
    case "coach":
      return null;
  }
}

/** The record a tab holds for this object, when it has a page of its own. */
export function recordOf(o: Obj): RecordRef | null {
  switch (o.kind) {
    case "team":
      return { kind: "team", name: o.name, logoId: o.logoId };
    case "player":
      return { kind: "player", bartId: o.bartId, name: o.name, hasPhoto: o.hasPhoto };
    case "coach":
      return { kind: "coach", slug: o.slug, name: o.name, team: o.team };
    case "game":
      return o;
    case "log-game":
    case "conference":
      return null;
  }
}

/** A record, placed in the season a tab or favorite holds it in. */
export function objFromRecord(record: RecordRef, year: number): Obj {
  switch (record.kind) {
    case "team":
      return { ...record, year };
    case "player":
      return { ...record, year };
    case "coach":
    case "game":
      return record;
  }
}

export const coachObj = (name: string, team: string | null): CoachObj => ({ kind: "coach", slug: coachSlug(name), name, team });

/** The same page on btacbb.xyz, for anyone without the app. */
export function siteUrl(o: Obj): string | null {
  switch (o.kind) {
    case "team":
      return `https://btacbb.xyz/teams/${teamSlug(o.name)}/${o.year}/`;
    case "player":
      return `https://btacbb.xyz/players/${o.bartId}/`;
    case "coach":
      return `https://btacbb.xyz/coaches/${o.slug}/`;
    case "game":
      return `https://btacbb.xyz/games/${o.season}/${gameSlug(o.id, o.away, o.home)}/`;
    case "log-game":
    case "conference":
      return null;
  }
}

/** Two references to the same thing: the same team in the same season, say. */
export function sameObj(a: Obj, b: Obj): boolean {
  return objKey(a) === objKey(b);
}

export function objKey(o: Obj): string {
  switch (o.kind) {
    case "team":
      return `team:${o.name}:${o.year}`;
    case "player":
      return `player:${o.bartId}:${o.year}`;
    case "coach":
      return `coach:${o.slug}`;
    case "game":
      return `game:${o.season}:${o.id}`;
    case "log-game":
      return `log-game:${o.date}:${o.team}:${o.opp}:${o.player?.bartId ?? ""}`;
    case "conference":
      return `conference:${o.conf}:${o.year}`;
  }
}

/** The pointer carries a small label rather than a picture of what was picked up. */
export function objectDrag(o: Obj): DragSpec {
  const year = objYear(o);
  return {
    type: OBJECT_DRAG_TYPE,
    data: JSON.stringify(o),
    label: year != null && o.kind !== "game" ? `${objTitle(o)}  ${shortSeason(year)}` : objTitle(o),
  };
}

export const carriesObject = (dt: DataTransfer | null): boolean => !!dt && Array.from(dt.types).includes(OBJECT_DRAG_TYPE);

/** What a drop brought, if it was one of ours and still well formed. */
export function droppedObject(dt: DataTransfer): Obj | null {
  try {
    const v: unknown = JSON.parse(dt.getData(OBJECT_DRAG_TYPE));
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}

const isYear = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const optStr = (v: unknown) => v === undefined || typeof v === "string";

export function isObj(v: unknown): v is Obj {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  switch (o.kind) {
    case "team":
      return isRecordRef(v) && isYear(o.year) && optStr(o.conf);
    case "player":
      return isRecordRef(v) && isYear(o.year) && optStr(o.team) && optStr(o.conf);
    case "coach":
    case "game":
      return isRecordRef(v);
    case "log-game":
      return isYear(o.year) && isStr(o.date) && isStr(o.team) && isStr(o.opp) && (o.site === "home" || o.site === "away" || o.site === "neutral");
    case "conference":
      return isStr(o.conf) && isStr(o.label) && isYear(o.year);
    default:
      return false;
  }
}
