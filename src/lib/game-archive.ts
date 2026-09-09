/**
 * The scoreboard archive, as the BUILD knows it.
 *
 * Server-only: reads the files scripts/build-scoreboard-archive.mts wrote
 * under public/data at build time, so the static day pages and game pages can
 * be prerendered with their scores in the HTML. Nothing here is imported by a
 * client component — the browser's view of the archive is scoreboard-archive.ts.
 *
 * Every read is cached for the life of the build: the game index is read once
 * per season and consulted ~6,000 times by generateStaticParams, metadata and
 * the page itself.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { GameBundle } from "@/components/game/types";
import type { Slate } from "@/lib/scoreboard";

export type ArchiveSide = {
  team: string; conf: string | null; pts: number | null; periods: number[]; winner: boolean | null;
  rank: number | null; seed: number | null; rec: [number, number] | null; elo: [number, number] | null;
};
export type ArchiveGame = {
  id: number; date: string; start: string; status: string;
  /** Tip time not set — every 2026-27 fixture as of September 2026. */
  tbd?: boolean;
  venue: string | null; city: string | null; state: string | null; attendance: number | null;
  neutral: boolean; confGame: boolean; excitement: number | null;
  home: ArchiveSide; away: ArchiveSide;
  line: { spread: number | null; overUnder: number | null; provider: string } | null;
};
export type ArchiveIndex = {
  season: number;
  days: Array<{ date: string; games: number }>;
  games: ArchiveGame[];
  byId: Map<number, ArchiveGame>;
};

const ROOT = path.resolve("public/data");
const indexCache = new Map<number, Promise<ArchiveIndex | null>>();

export function readArchiveIndex(season: number): Promise<ArchiveIndex | null> {
  let p = indexCache.get(season);
  if (!p) {
    p = fs.readFile(path.join(ROOT, "scoreboard", String(season), "index.json"), "utf8")
      .then((txt) => {
        const j = JSON.parse(txt) as Omit<ArchiveIndex, "byId">;
        return { ...j, byId: new Map(j.games.map((g) => [g.id, g])) };
      })
      .catch(() => null);
    indexCache.set(season, p);
  }
  return p;
}

export async function readArchivedSlate(date: string): Promise<Slate | null> {
  const season = Number(date.slice(5, 7)) >= 7 ? Number(date.slice(0, 4)) + 1 : Number(date.slice(0, 4));
  try {
    const txt = await fs.readFile(path.join(ROOT, "scoreboard", String(season), `${date}.json`), "utf8");
    const j = JSON.parse(txt) as Slate;
    return Array.isArray(j?.games) ? j : null;
  } catch {
    return null;
  }
}

/**
 * The part of a game bundle the index carries, as a bundle.
 *
 * This is what a static game page renders on the server: the scoreline,
 * the halves, the records and the venue — everything the header shows and
 * everything a search engine needs to read. The tabs need the full bundle
 * (box scores, play-by-play), which is ~120 KB a game and arrives from R2
 * once the page is open. Rendering the header from the same component with
 * the same shape means the full bundle replaces this one without the header
 * moving a pixel.
 */
export function minimalBundle(g: ArchiveGame, season: number): GameBundle {
  const side = (s: ArchiveSide) => ({
    team: s.team, conference: s.conf, points: s.pts, periods: s.periods, winner: s.winner,
    rank: s.rank, elo: s.elo,
  });
  // GameDetail reads each team's record off the standings tables, so the two
  // records the index carries are handed over as a two-row table under a
  // conference key that never collides with a real one.
  const standings: GameBundle["standings"] = {};
  for (const s of [g.home, g.away]) {
    if (!s.rec) continue;
    const key = s.conf ?? "Independent";
    (standings[key] ??= []).push({ team: s.team, w: s.rec[0], l: s.rec[1], cw: 0, cl: 0 });
  }
  return {
    game: {
      id: g.id, startDate: g.start, status: g.status, season,
      venue: g.venue, city: g.city, state: g.state, attendance: g.attendance,
      neutralSite: g.neutral, conferenceGame: g.confGame, excitement: g.excitement,
      period: null, clock: null, tbd: g.tbd,
      home: side(g.home), away: side(g.away),
    },
    teamStats: { home: null, away: null, pace: null, gameMinutes: null },
    players: { home: [], away: [] },
    plays: [],
    broadcasts: [],
    line: g.line ? [g.line] : [],
    form: { home: [], away: [] },
    h2h: [],
    standings,
    fetchedAt: "",
  };
}

/** "Feb 7, 2026" in Eastern time, for titles. */
export function shortDate(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric",
  }).format(new Date(t));
}
