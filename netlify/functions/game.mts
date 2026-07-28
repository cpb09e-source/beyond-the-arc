import type { Context } from "@netlify/functions";

import { setDefaultResultOrder } from "node:dns";

/**
 * Resolve IPv4 first.
 *
 * CBBD sits behind Cloudflare and its DNS answers list AAAA records ahead of
 * A records, so Node's dual-stack connect tries IPv6 first. Netlify's local
 * dev sandbox has no working IPv6 egress and the happy-eyeballs fallback does
 * not recover, so every upstream call died with an unhelpful bare
 * `AggregateError` out of internalConnectMultiple — which reads as "the
 * function is broken" rather than "the socket never opened".
 *
 * This is an ORDERING PREFERENCE, not a restriction: IPv6 is still used if no
 * A record exists. Safe in production, where it is also the faster path to a
 * Cloudflare edge.
 */
setDefaultResultOrder("ipv4first");


/**
 * game — everything about one game, for /game?id=…&date=….
 *
 * Same reasoning as scoreboard.mts: the site is a static export with no
 * server, CBBD's terms forbid shipping the key to the client, so a Netlify
 * Function is the only place this can live. Read that file's header for the
 * caching argument; this one adds two wrinkles.
 *
 * WRINKLE 1 — CACHE BY STATUS, NOT BY CLOCK. A finished game is immutable. Its
 * box score will read the same in ten years, so it is cached at the edge for a
 * day and the browser for an hour. A live game is cached for the same 60
 * seconds the scoreboard uses. One endpoint, two cache lifetimes, chosen from
 * the status of what was actually fetched — which means the archive costs
 * almost nothing and the live path costs what it has to.
 *
 * WRINKLE 2 — THE CONTEXT IS MEMOISED SEPARATELY FROM THE GAME. Standings,
 * head-to-head history and recent form do not change while a game is being
 * played, but they are part of the same response. Re-fetching them on every
 * 60-second refresh would triple the call cost of a live game for data that
 * cannot have moved. They are held in module scope with their own TTLs, so a
 * warm container answers a live refresh with roughly five upstream calls
 * rather than fifteen.
 *
 * CALL BUDGET. Cold, a game page costs ~15 CBBD calls. Warm and live, ~5 per
 * minute. See docs/cbbd-api-quota.md — the plan is upgradeable and cheap, and
 * the 3,000-row response cap is the constraint that money does NOT fix.
 */

const API = "https://api.collegebasketballdata.com";

/**
 * A CBBD row. Deliberately loose: the API returns wide objects (a game row has
 * 39 fields) and this function reads a handful of them, so declaring the full
 * shape would be a large surface to keep in sync for no checking we'd use.
 * Every read goes through num()/str() or an explicit typeof guard.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/** Live games refresh on the same cadence as the scoreboard. */
const LIVE_SECONDS = 60;
const LIVE_STALE = 300;
/** A final game cannot change. Cache it hard. */
const FINAL_SECONDS = 86_400;
const FINAL_STALE = 604_800;

const RANK_TTL_MS = 6 * 60 * 60 * 1000;
const SCHEDULE_TTL_MS = 60 * 60 * 1000;
/** Completed seasons are immutable; their schedules never need refetching. */
const PAST_SEASON_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const STANDINGS_TTL_MS = 60 * 60 * 1000;

/* -------------------------------- helpers -------------------------------- */

function shiftDay(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
/** CBBD labels the 2025-26 season as 2026, rolling over at the calendar year. */
function seasonOf(date: string): number {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7));
  return m >= 7 ? y + 1 : y;
}

async function cbbd(path: string, key: string): Promise<Row[]> {
  const res = await fetch(API + path, {
    headers: { Authorization: `Bearer ${key}`, accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`CBBD ${res.status} on ${path}`);
  const body = await res.json();
  return Array.isArray(body) ? body : [];
}
/** Never let a supporting panel take the whole page down. */
async function soft(p: Promise<Row[]>): Promise<Row[]> {
  try { return await p; } catch { return []; }
}

const q = encodeURIComponent;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);

/* ------------------------------ shared caches ----------------------------- */

type Cached<T> = { at: number; value: T };
const scheduleCache = new Map<string, Cached<Row[]>>();
const standingsCache = new Map<string, Cached<Row[]>>();
let rankCache: { season: number; at: number; rows: Row[] } | null = null;

/**
 * A team's season pace entering a date: the mean of its completed games.
 *
 * Taken "entering this game" rather than across the whole season, matching the
 * records and standings on the same page. A February game should be read
 * against how the team had played to that point, not against a figure that
 * includes March.
 *
 * /games/teams carries pace per game, one call for the team's whole season.
 * Cached alongside the schedules.
 */
async function seasonPace(key: string, season: number, team: string, before: string): Promise<number | null> {
  const k = `pace|${season}|${team}`;
  const hit = scheduleCache.get(k);
  let rows = hit && Date.now() - hit.at < SCHEDULE_TTL_MS ? hit.value : null;
  if (!rows) {
    rows = await soft(cbbd(`/games/teams?season=${season}&team=${q(team)}`, key));
    scheduleCache.set(k, { at: Date.now(), value: rows });
  }
  const paces = rows
    .filter((r) => typeof r.pace === "number" && typeof r.startDate === "string" && r.startDate < before)
    .map((r) => r.pace as number);
  if (paces.length === 0) return null;
  return Math.round((paces.reduce((s, x) => s + x, 0) / paces.length) * 10) / 10;
}

/** A team's full season schedule. One call, 40ish rows — well under the cap. */
async function schedule(key: string, season: number, team: string, currentSeason: number): Promise<Row[]> {
  const k = `${season}|${team}`;
  const ttl = season < currentSeason ? PAST_SEASON_TTL_MS : SCHEDULE_TTL_MS;
  const hit = scheduleCache.get(k);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const rows = await soft(cbbd(`/games?season=${season}&team=${q(team)}`, key));
  scheduleCache.set(k, { at: Date.now(), value: rows });
  return rows;
}

/**
 * AP Top 25 for the poll in effect on a date. Same approach as the scoreboard:
 * one request covers the season, cached six hours, and the poll chosen is the
 * most recent one published on or before the game — ranking a February game by
 * a March ballot would be the "ranked at the time" trap.
 */
async function ranksOn(key: string, season: number, date: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    if (!rankCache || rankCache.season !== season || Date.now() - rankCache.at > RANK_TTL_MS) {
      rankCache = { season, at: Date.now(), rows: await cbbd(`/rankings?season=${season}`, key) };
    }
    const ap = rankCache.rows.filter((r) => r.pollType === "AP Top 25" && r.pollDate);
    let best = "";
    const cutoff = `${date}T23:59:59.999Z`;
    for (const r of ap) if (r.pollDate <= cutoff && r.pollDate > best) best = r.pollDate;
    if (!best) return out;
    for (const r of ap) if (r.pollDate === best && r.team && typeof r.ranking === "number") out.set(r.team, r.ranking);
  } catch { /* ranks are decoration */ }
  return out;
}

/**
 * Conference table entering `before`.
 *
 * Scoped by conference rather than fetched season-wide because CBBD caps a
 * response at 3,000 rows with no error and no cursor — `/games?season=2026`
 * silently stops in early January. A conference is ~430 rows and covers the
 * whole season, so this is both correct and cheaper.
 */
async function standings(key: string, season: number, conference: string, before: string): Promise<Row[]> {
  const k = `${season}|${conference}|${before}`;
  const hit = standingsCache.get(k);
  if (hit && Date.now() - hit.at < STANDINGS_TTL_MS) return hit.value;
  const rows = await soft(cbbd(`/games?season=${season}&conference=${q(conference)}`, key));
  const tbl = new Map<string, { team: string; w: number; l: number; cw: number; cl: number }>();
  for (const r of rows) {
    if (typeof r.homeWinner !== "boolean" || typeof r.awayWinner !== "boolean") continue;
    if (!r.startDate || r.startDate >= before) continue;
    for (const side of ["home", "away"] as const) {
      if (r[`${side}Conference`] !== conference) continue;
      const team = r[`${side}Team`];
      if (!team) continue;
      let rec = tbl.get(team);
      if (!rec) { rec = { team, w: 0, l: 0, cw: 0, cl: 0 }; tbl.set(team, rec); }
      const won = r[`${side}Winner`] as boolean;
      if (won) rec.w++; else rec.l++;
      if (r.conferenceGame) { if (won) rec.cw++; else rec.cl++; }
    }
  }
  const out = [...tbl.values()].sort((a, b) => {
    const pa = a.cw / (a.cw + a.cl || 1), pb = b.cw / (b.cw + b.cl || 1);
    return pb !== pa ? pb - pa : b.w - a.w;
  });
  standingsCache.set(k, { at: Date.now(), value: out });
  return out;
}

/** One schedule row, from `team`'s point of view. */
function perspective(r: Row, team: string) {
  const isHome = r.homeTeam === team;
  const won = isHome ? r.homeWinner : r.awayWinner;
  return {
    id: r.id,
    date: r.startDate,
    season: r.season,
    opponent: isHome ? r.awayTeam : r.homeTeam,
    isHome,
    neutral: r.neutralSite === true,
    us: num(isHome ? r.homePoints : r.awayPoints),
    them: num(isHome ? r.awayPoints : r.homePoints),
    won: typeof won === "boolean" ? won : null,
    venue: str(r.venue),
  };
}
const played = (r: ReturnType<typeof perspective>) => r.us !== null && r.them !== null && r.won !== null;

/**
 * Fold a full-court location (tenths of a foot, x 0-940 baseline to baseline,
 * y 0-500 sideline to sideline) onto one half court, rim at (250, 52.5). Both
 * ends collapse onto the same picture, which is what makes a shot chart of a
 * game legible — the teams swap ends at the break. Mirrors the fold in
 * scripts/build-player-shots.mjs; keep them in step.
 */
function fold(x: number, y: number): [number, number] {
  return x <= 470 ? [y, x] : [500 - y, 940 - x];
}

/* --------------------------------- handler -------------------------------- */

const handler = async (req: Request, _ctx: Context) => {
  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));
  const rawDate = url.searchParams.get("date") ?? "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;
  const key = process.env.CBBD_API_KEY;

  const fail = (error: string, status = 200, seconds = 60) =>
    new Response(JSON.stringify({ error }), {
      status,
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=15",
        "netlify-cdn-cache-control": `public, s-maxage=${seconds}`,
      },
    });

  if (!key) return fail("unconfigured");
  if (!Number.isFinite(id)) return fail("missing id");
  // The date is required because CBBD's per-game endpoints ignore a gameId
  // filter — /games/teams?gameId=… returns the first 3,000 rows of the season,
  // not that game. Everything has to be scoped by season plus a date window,
  // so the id alone is not enough to find anything. Carrying it in the URL
  // also makes a shared link self-contained.
  if (!date) return fail("missing date");

  const season = Number(url.searchParams.get("season")) || seasonOf(date);
  // A day either side: the endpoints filter on the UTC start and our day is
  // Eastern, the same straddle easternDate() exists to handle.
  const from = shiftDay(date, -1), to = shiftDay(date, 1);

  try {
    const games = await cbbd(`/games?season=${season}&startDateRange=${from}&endDateRange=${to}`, key);
    const g = games.find((r) => r.id === id);
    if (!g) return fail("game not found");

    const home: string = g.homeTeam, away: string = g.awayTeam;
    const window = `season=${season}&startDateRange=${from}&endDateRange=${to}`;

    const [teamRows, homeBox, awayBox, rawPlays, media, lines, ranks] = await Promise.all([
      soft(cbbd(`/games/teams?${window}&team=${q(home)}`, key)),
      soft(cbbd(`/games/players?${window}&team=${q(home)}`, key)),
      soft(cbbd(`/games/players?${window}&team=${q(away)}`, key)),
      soft(cbbd(`/plays/game/${id}`, key)),
      soft(cbbd(`/games/media?${window}`, key)),
      soft(cbbd(`/lines?season=${season}&startDateRange=${from}&endDateRange=${to}`, key)),
      ranksOn(key, season, date),
    ]);

    // Context. Memoised separately (see the header) so a live refresh does not
    // re-buy the last three seasons of schedule every minute.
    const confs = [...new Set([g.homeConference, g.awayConference].filter(Boolean))] as string[];
    const [homeSched, awaySched, homePace, awayPace, ...confTables] = await Promise.all([
      Promise.all([season, season - 1, season - 2].map((s) => schedule(key, s, home, season))).then((x) => x.flat()),
      Promise.all([season, season - 1, season - 2].map((s) => schedule(key, s, away, season))).then((x) => x.flat()),
      seasonPace(key, season, home, g.startDate),
      seasonPace(key, season, away, g.startDate),
      ...confs.map((c) => standings(key, season, c, g.startDate)),
    ]) as [Row[], Row[], number | null, number | null, ...Row[][]];

    const tr = teamRows.find((r) => r.gameId === id) ?? null;
    const homeStats = tr ? (tr.isHome ? tr.teamStats : tr.opponentStats) : null;
    const awayStats = tr ? (tr.isHome ? tr.opponentStats : tr.teamStats) : null;

    const lastFive = (rows: Row[], team: string) =>
      rows.filter((r) => r.season === season).map((r) => perspective(r, team))
        .filter((r) => played(r) && r.date < g.startDate)
        .sort((a, b) => a.date.localeCompare(b.date)).slice(-5);

    const h2h = homeSched.map((r) => perspective(r, home))
      .filter((r) => r.opponent === away && played(r) && r.date < g.startDate)
      .sort((a, b) => a.date.localeCompare(b.date)).slice(-5);

    /* ---- plays: trimmed from ~474 KB to ~150 KB ---- */

    // CBBD USES TWO ATHLETE ID SPACES. /games/players keys on `athleteId`
    // (Cameron Boozer is 4860318); the play-by-play's `onFloor` and `shotInfo`
    // key on a different, smaller id (the same player is 198977). Joining them
    // by id silently matches nothing, which showed up as a plus-minus column
    // of all zeroes. Names agree exactly across both feeds, so the on-floor
    // ids are translated to box ids HERE — once, server-side — and the client
    // keeps a plain id join.
    const boxIdByName = new Map<string, number>();
    for (const row of [homeBox, awayBox]) {
      for (const r of row) {
        if (r.gameId !== id || !Array.isArray(r.players)) continue;
        for (const pl of r.players) {
          if (typeof pl?.name === "string" && typeof pl?.athleteId === "number") {
            boxIdByName.set(pl.name.trim().toLowerCase(), pl.athleteId);
          }
        }
      }
    }

    const plays = rawPlays.map((p) => {
      const si = p.shotInfo, loc = si?.location;
      const ok = loc && loc.x >= 0 && loc.x <= 940 && loc.y >= 0 && loc.y <= 500;
      const [cx, cy] = ok ? fold(loc.x, loc.y) : [null, null];
      return {
        i: p.id, t: str(p.playType) ?? "", h: p.isHomeTeam === true, tm: str(p.team) ?? "",
        hs: num(p.homeScore) ?? 0, as: num(p.awayScore) ?? 0,
        per: num(p.period) ?? 1, clk: str(p.clock) ?? "", sec: num(p.secondsRemaining) ?? 0,
        sc: p.scoringPlay === true, sh: p.shootingPlay === true, v: num(p.scoreValue),
        txt: str(p.playText) ?? "",
        s: si ? { m: si.made === true, r: str(si.range) ?? "", a: si.assisted === true, by: si.shooter?.name ?? null, x: cx, y: cy } : null,
        // The ten players on the floor, as BOX athlete ids (see the note
        // above). Carried ONLY on scoring plays — that is the only place it is
        // used, and sending it for all 365 plays triples the payload.
        on: p.scoringPlay === true && Array.isArray(p.onFloor)
          ? p.onFloor
              .map((o: Row) => (typeof o?.name === "string" ? boxIdByName.get(o.name.trim().toLowerCase()) : undefined))
              .filter((n: unknown): n is number => typeof n === "number")
          : undefined,
      };
    })
      // CBBD occasionally returns two plays at the same clock out of order —
      // free throw 2 of 2 ahead of 1 of 2. Sort by game time, then by id, so
      // the log reads in the order it happened.
      .sort((a, b) => (a.per - b.per) || (b.sec - a.sec) || (a.i - b.i));

    const lineRow = lines.find((l) => l.gameId === id);
    const pick = Array.isArray(lineRow?.lines)
      ? (lineRow.lines.find((l: Row) => l.provider === "Draft Kings") ?? lineRow.lines[0])
      : null;

    const side = (isHome: boolean) => {
      const p = isHome ? "home" : "away";
      const eloStart = num(g[`${p}TeamEloStart`]), eloEnd = num(g[`${p}TeamEloEnd`]);
      return {
        team: g[`${p}Team`],
        conference: str(g[`${p}Conference`]),
        points: num(g[`${p}Points`]),
        periods: Array.isArray(g[`${p}PeriodPoints`]) ? g[`${p}PeriodPoints`].filter((n: unknown) => typeof n === "number") : [],
        winner: typeof g[`${p}Winner`] === "boolean" ? g[`${p}Winner`] : null,
        rank: ranks.get(g[`${p}Team`]) ?? null,
        elo: eloStart !== null && eloEnd !== null ? [eloStart, eloEnd] : null,
      };
    };

    const status = (str(g.status) ?? "scheduled").toLowerCase();
    const bundle = {
      game: {
        id: g.id,
        startDate: str(g.startDate) ?? "",
        status,
        season,
        venue: str(g.venue), city: str(g.city), state: str(g.state),
        attendance: num(g.attendance),
        neutralSite: g.neutralSite === true,
        conferenceGame: g.conferenceGame === true,
        excitement: num(g.excitement),
        period: num(g.period), clock: str(g.clock),
        home: side(true), away: side(false),
      },
      teamStats: {
        home: homeStats ?? null, away: awayStats ?? null,
        pace: tr ? num(tr.pace) : null, gameMinutes: tr ? num(tr.gameMinutes) : null,
        /** Each side's season average entering this game, for context on the above. */
        seasonPace: { home: homePace, away: awayPace },
      },
      players: {
        home: homeBox.find((r) => r.gameId === id)?.players ?? [],
        away: awayBox.find((r) => r.gameId === id)?.players ?? [],
      },
      plays,
      broadcasts: media.find((m) => m.gameId === id)?.broadcasts ?? [],
      line: pick ? [{ provider: pick.provider ?? "", spread: num(pick.spread), overUnder: num(pick.overUnder) }] : [],
      form: { home: lastFive(homeSched, home), away: lastFive(awaySched, away) },
      h2h,
      standings: Object.fromEntries(confs.map((c, i) => [c, confTables[i] ?? []])),
      fetchedAt: new Date().toISOString(),
    };

    const settled = status === "final";
    return new Response(JSON.stringify(bundle), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": settled ? "public, max-age=3600" : "public, max-age=15",
        "netlify-cdn-cache-control": settled
          ? `public, s-maxage=${FINAL_SECONDS}, stale-while-revalidate=${FINAL_STALE}`
          : `public, s-maxage=${LIVE_SECONDS}, stale-while-revalidate=${LIVE_STALE}`,
      },
    });
  } catch (err) {
    // Never 5xx at the reader — the page renders an empty state instead. Short
    // edge cache so a CBBD blip doesn't pin the failure for a full minute.
    return fail(String(err instanceof Error ? err.message : err).slice(0, 160), 200, 20);
  }
};

export default handler;

export const config = { path: "/api/game" };
