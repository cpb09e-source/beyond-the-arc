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
 * scoreboard — today's college basketball slate, for the site-wide ticker and
 * the /scoreboard page.
 *
 * WHY A FUNCTION: the site is a static export with no server, and CBBD's terms
 * forbid shipping CBBD_API_KEY to the client. Netlify Functions deploy beside
 * the static bundle and keep the key server-side, same as parse-query does for
 * ANTHROPIC_API_KEY. The browser talks only to this endpoint.
 *
 * WHY THE CDN CACHE IS THE WHOLE DESIGN: CBBD meters calls (the response
 * carries x-calllimit-remaining, and we were sitting near 19,500). If every
 * reader's poll reached CBBD, a few hundred concurrent visitors on a Saturday
 * would exhaust a month's quota in an evening. `Netlify-CDN-Cache-Control`
 * makes the edge answer almost all of them: CBBD sees at most one call per
 * REFRESH_SECONDS no matter how many people are watching. Traffic and API cost
 * are decoupled, which is what makes near-live affordable at all.
 *
 *   Cache-Control            → what the BROWSER may reuse (short; the client
 *                              polls on its own schedule anyway)
 *   Netlify-CDN-Cache-Control→ what the EDGE reuses (the one that matters)
 *
 * stale-while-revalidate means a poll landing on an expired entry still gets an
 * instant answer while the edge refreshes behind it — no reader ever waits on
 * CBBD, and a CBBD hiccup shows the last good slate instead of an error.
 *
 * ENDPOINT CHOICE: /scoreboard is CBBD's live feed and is the right source
 * during a game night, but it is live-ONLY — out of season, and before the
 * day's first tip, it returns []. A ticker that renders nothing for eight
 * months is worse than one showing the last completed slate, so an empty live
 * response falls back to /games over a date window. See resolveSlate().
 */

const API = "https://api.collegebasketballdata.com";

/**
 * LAST-RESORT PREVIEW SLATE.
 *
 * Used only when live, recent AND upcoming all come up empty — never as an
 * override. That ordering matters: the moment CBBD publishes the 2026-27
 * schedule this pin stops being reached on its own, and the surfaces switch to
 * the real opening night with no code change and no deploy.
 *
 * It exists because CBBD's live /scoreboard is live-ONLY and returns [] out of
 * season. As of 28 July 2026 `/games?season=2027` also returns zero rows —
 * CBBD has rolled `/teams` forward to 2027 (365 of them) but not the schedule —
 * so all three resolution paths find nothing and both surfaces would correctly
 * render nothing at all. Saturday 7 Feb 2026 is the fullest slate of that
 * month: 155 games, 17 power-conference, a mix of finals and blowouts and
 * one-possession games.
 *
 * Set to null once the season is under way. Until then it is harmless: it can
 * only fire on a day the sport genuinely has nothing.
 */
const DEMO_DATE: string | null = "2026-02-07";

/**
 * Forward search for the next scheduled slate, in windows of this many days.
 *
 * Windowed rather than one wide query because CBBD caps EVERY list response at
 * 3,000 rows with no error and no cursor (see recordsBefore) — a query spanning
 * November would silently lose its tail. Two weeks of November is roughly 700
 * rows, comfortably clear.
 */
const LOOKAHEAD_DAYS = 14;
/** Windows to try before giving up: 5 × 14 covers ten weeks. */
const LOOKAHEAD_WINDOWS = 5;

/** Edge cache lifetime. See the quota arithmetic in the header comment. */
const REFRESH_SECONDS = 60;
/** How long the edge may serve a stale slate while refetching behind it. */
const STALE_SECONDS = 300;

/**
 * How far back to look for a completed slate when nothing is live. Two days
 * rather than one: college basketball tips late, and a 9pm PT game finishing
 * after midnight UTC would otherwise vanish from "yesterday" for readers in the
 * US while it was still last night's result to them.
 */
const FALLBACK_DAYS = 2;

type Side = {
  team: string;
  conference: string | null;
  points: number | null;
  winner: boolean | null;
  seed: number | null;
  /** AP Top 25 position in the poll current as of this slate, else null. */
  rank: number | null;
  /** Points by period: [1H, 2H, OT, 2OT…]. Empty when not reported. */
  periods: number[];
  /** W-L from completed games BEFORE this slate. Null when unknown. */
  record: { w: number; l: number } | null;
};

type Game = {
  id: number;
  startDate: string;
  status: string;
  home: Side;
  away: Side;
  neutralSite: boolean;
  conferenceGame: boolean;
  venue: string | null;
  /** Live only: current period and game clock, when CBBD supplies them. */
  period: number | null;
  clock: string | null;
  /** Closing betting line, HOME perspective (negative = home favoured). */
  line: { spread: number | null; overUnder: number | null; provider: string } | null;
};

type Slate = {
  /**
   * "live"     — CBBD's live feed, games in progress right now
   * "recent"   — a completed slate we fell back to (last night)
   * "upcoming" — the next day that HAS games, nothing played yet. This is the
   *              offseason and preseason state: in July it means opening night.
   */
  source: "live" | "recent" | "upcoming";
  /** ISO date the games belong to, for the UI's heading. */
  date: string | null;
  games: Game[];
  fetchedAt: string;
};

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * DEV ONLY — rewind a settled slate so the live styling can be worked on at
 * any hour.
 *
 * Live games happen for about four hours a night. Without this, iterating on
 * the pulsing clock, the "N live" rail label, the half-filled line score or
 * the live card border means either waiting for tip-off or hand-editing the
 * response, and nobody does the second one twice. `?sim=live` takes whatever
 * slate was resolved and puts a share of it back in progress with a plausible
 * clock, so the states are reachable from a desk at ten in the morning.
 *
 * GATED ON NETLIFY_DEV, which the Netlify CLI sets for local runs and which is
 * never set in a deployed function. A production request carrying ?sim=live
 * gets the real slate — the parameter is not merely ignored by convention, it
 * is unreachable.
 */
function simulateLive(games: Game[]): Game[] {
  return games.map((g, i) => {
    // Leave a third finished and a few not yet tipped, so one page shows all
    // three states at once rather than a wall of identical live cards.
    const bucket = i % 3;
    if (bucket === 0) return g;
    if (bucket === 2) {
      return {
        ...g, status: "scheduled", period: null, clock: null,
        home: { ...g.home, points: null, winner: null, periods: [] },
        away: { ...g.away, points: null, winner: null, periods: [] },
      };
    }
    // In progress: keep first-half points, drop the rest, invent a clock.
    const half = (side: Side): Side => ({
      ...side,
      points: side.periods[0] ?? Math.round((side.points ?? 0) / 2),
      periods: side.periods.slice(0, 1),
      winner: null,
    });
    const secs = 60 + ((i * 137) % 1080); // deterministic, so reloads are stable
    return {
      ...g,
      status: "in_progress",
      period: 2,
      clock: `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`,
      home: half(g.home),
      away: half(g.away),
    };
  });
}

/**
 * DEV ONLY — wind a settled slate FORWARD, so the preseason state is reachable.
 *
 * Same gate and same purpose as simulateLive(), for the opposite end of the
 * calendar: until CBBD publishes a schedule there is no way to see what the
 * ticker and the page look like the week before the season starts, and "we will
 * find out in November" is not a design process. Scores and winners are
 * stripped, records are kept — a real opening night has 0-0 everywhere, but the
 * week after has records, and that is the version worth checking.
 */
function simulateUpcoming(games: Game[]): Game[] {
  return games.map((g) => ({
    ...g,
    status: "scheduled",
    period: null,
    clock: null,
    home: { ...g.home, points: null, winner: null, periods: [] },
    away: { ...g.away, points: null, winner: null, periods: [] },
  }));
}

/**
 * The calendar date a game BELONGS to, US Eastern.
 *
 * CBBD timestamps are UTC and a college basketball night runs from about 7pm
 * ET to 1am ET, so it straddles UTC midnight: a 9pm ET tip on Feb 1 is
 * 02:00Z on Feb 2. Grouping by the UTC date splits every evening in half and
 * files the late games under tomorrow — asking for Feb 1 returned Jan 31's
 * slate before this existed. Eastern is the right anchor because that is how
 * the sport itself dates its schedule, and Intl handles the DST switch that a
 * fixed -5 offset would get wrong for half the season.
 */
const ET_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric", month: "2-digit", day: "2-digit",
});
function easternDate(isoTimestamp: string): string | null {
  const t = Date.parse(isoTimestamp);
  if (!Number.isFinite(t)) return null;
  return ET_DATE.format(new Date(t)); // en-CA formats as YYYY-MM-DD
}

/**
 * CBBD returns two slightly different row shapes (the live scoreboard carries
 * period/clock; /games carries winners and seeds). Both are normalised here so
 * the client renders one type and never branches on which feed it came from.
 */
function normalise(r: Record<string, unknown>): Game | null {
  const id = Number(r.id ?? r.gameId);
  if (!Number.isFinite(id)) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);
  const home = str(r.homeTeam), away = str(r.awayTeam);
  if (!home || !away) return null;
  return {
    id,
    startDate: str(r.startDate) ?? "",
    // CBBD uses lowercase status strings ("scheduled" / "in_progress" / "final").
    status: (str(r.status) ?? "scheduled").toLowerCase(),
    home: {
      team: home,
      conference: str(r.homeConference),
      points: num(r.homePoints),
      winner: typeof r.homeWinner === "boolean" ? r.homeWinner : null,
      seed: num(r.homeSeed),
      rank: null,
      periods: Array.isArray(r.homePeriodPoints) ? (r.homePeriodPoints as number[]).filter((n) => typeof n === "number") : [],
      record: null,
    },
    away: {
      team: away,
      conference: str(r.awayConference),
      points: num(r.awayPoints),
      winner: typeof r.awayWinner === "boolean" ? r.awayWinner : null,
      seed: num(r.awaySeed),
      rank: null,
      periods: Array.isArray(r.awayPeriodPoints) ? (r.awayPeriodPoints as number[]).filter((n) => typeof n === "number") : [],
      record: null,
    },
    neutralSite: r.neutralSite === true,
    conferenceGame: r.conferenceGame === true,
    venue: str(r.venue),
    period: num(r.period),
    clock: str(r.clock),
    line: null,
  };
}

/**
 * AP Top 25 for the poll in effect on a given date, as team name → ranking.
 *
 * Cached in module scope for six hours. The polls only move once a week, and
 * this would otherwise DOUBLE the CBBD calls the scoreboard makes — the whole
 * quota argument in the header comment assumes one call per refresh, and two
 * would push a season past the budget. A warm Netlify container reuses this
 * across invocations; a cold start pays for one extra call.
 *
 * One request covers the entire season (~1,600 rows, both polls), so there is
 * nothing to gain from asking per week.
 *
 * AP over the Coaches Poll because the AP is what a scoreboard means by "#4" —
 * it is the poll broadcasts and tickers quote.
 */
const RANK_TTL_MS = 6 * 60 * 60 * 1000;
type RankRow = { pollType?: string; pollDate?: string; team?: string; ranking?: number };
let rankCache: { season: number; at: number; rows: RankRow[] } | null = null;

async function rankingsForDate(key: string, season: number, onDate: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    if (!rankCache || rankCache.season !== season || Date.now() - rankCache.at > RANK_TTL_MS) {
      const rows = (await cbbd(`/rankings?season=${season}`, key)) as RankRow[];
      rankCache = { season, at: Date.now(), rows };
    }
    const ap = rankCache.rows.filter((r) => r.pollType === "AP Top 25" && r.pollDate);
    if (ap.length === 0) return out;
    // The poll in effect is the most recent one published on or before the
    // slate. Using the newest poll outright would rank a January game by a
    // March ballot — the same "ranked at the time" trap pull-rankings.mjs
    // documents for the Win Calculator.
    const cutoff = `${onDate}T23:59:59.999Z`;
    let best = "";
    for (const r of ap) if (r.pollDate! <= cutoff && r.pollDate! > best) best = r.pollDate!;
    if (!best) return out;
    for (const r of ap) {
      if (r.pollDate === best && r.team && typeof r.ranking === "number") out.set(r.team, r.ranking);
    }
  } catch {
    // Ranks are decoration. A rankings outage must not take the scores down.
  }
  return out;
}

/**
 * Team → W-L from every completed game BEFORE `beforeDate`.
 *
 * CBBD's /games has winner flags but no record column, so the record has to be
 * tallied. Cached for an hour: the figure only moves when games finish, and it
 * is deliberately the record a team CARRIES INTO the day, which is stable for
 * that whole day. That also makes it historically correct when stepping back
 * through February — showing today's record beside a game from three weeks ago
 * would be a lie about the standings at the time.
 *
 * FETCHED A MONTH AT A TIME, NOT A SEASON AT A TIME. CBBD caps a response at
 * 3,000 rows with no error and no paging cursor, and a D-I season is roughly
 * 6,000 games — so `/games?season=2026` silently returns November through
 * 6 January and simply omits the rest. This read as every team being stuck on
 * its early-January record for the whole back half of the season. Monthly
 * windows are the largest slice that clears the cap (busiest month measured:
 * 1,534 rows), and asking only up to the slate date keeps it to four or five
 * calls even in March.
 */
const RECORD_TTL_MS = 60 * 60 * 1000;
type SeasonRow = { id?: number; startDate?: string; homeTeam?: string; awayTeam?: string; homeWinner?: boolean; awayWinner?: boolean };
let seasonCache: { season: number; through: string; at: number; rows: SeasonRow[] } | null = null;

/** Month starts from the season opener up to and including `throughDate`. */
function monthWindows(season: number, throughDate: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  // A CBBD season labelled 2026 opens in November 2025.
  let y = season - 1, m = 10; // October, 0-indexed — a few exhibitions land there
  const end = Date.parse(`${throughDate}T12:00:00Z`);
  for (let i = 0; i < 14; i++) {
    const from = new Date(Date.UTC(y, m, 1, 12));
    if (from.getTime() > end) break;
    const to = new Date(Date.UTC(y, m + 1, 0, 12));
    out.push([iso(from), iso(to)]);
    m++;
    if (m > 11) { m = 0; y++; }
  }
  return out;
}

async function recordsBefore(key: string, season: number, beforeDate: string): Promise<Map<string, { w: number; l: number }>> {
  const out = new Map<string, { w: number; l: number }>();
  try {
    // Cache key includes the date asked for: a slate in March needs strictly
    // more months than one in December, so a December-shaped cache entry must
    // not satisfy a March request.
    if (!seasonCache || seasonCache.season !== season || seasonCache.through !== beforeDate || Date.now() - seasonCache.at > RECORD_TTL_MS) {
      const windows = monthWindows(season, beforeDate);
      const chunks = await Promise.all(
        windows.map(([from, to]) =>
          cbbd(`/games?season=${season}&startDateRange=${from}&endDateRange=${to}`, key).catch(() => [] as unknown[]),
        ),
      );
      seasonCache = { season, through: beforeDate, at: Date.now(), rows: chunks.flat() as SeasonRow[] };
    }
    const bump = (team: string, won: boolean) => {
      const cur = out.get(team) ?? { w: 0, l: 0 };
      if (won) cur.w++; else cur.l++;
      out.set(team, cur);
    };
    // Dedupe by game id. The windows are stitched from separate requests and
    // the range filter runs on the UTC start, so a game tipping late on the
    // last night of a month can legitimately answer to two of them — and a
    // double-counted game is two wins for one result.
    const seen = new Set<number>();
    for (const r of seasonCache.rows) {
      if (!r.startDate || !r.homeTeam || !r.awayTeam) continue;
      if (typeof r.homeWinner !== "boolean" || typeof r.awayWinner !== "boolean") continue;
      if (typeof r.id === "number") {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
      }
      const d = easternDate(r.startDate);
      if (!d || d >= beforeDate) continue;
      bump(r.homeTeam, r.homeWinner);
      bump(r.awayTeam, r.awayWinner);
    }
  } catch {
    // Records are supporting detail; never let them take the scores down.
  }
  return out;
}

/**
 * gameId → the closing betting line, keyed by the same date window as the
 * slate. Cached for an hour alongside the season games.
 *
 * SIGN CONVENTION: `spread` is from the HOME team's perspective, so −8.5 means
 * the home side is laying 8.5. Verified against 136 settled games from 7 Feb
 * 2026 — reading it as home-favoured makes the favourite win 72% of the time,
 * which is the expected rate for college basketball; the opposite reading would
 * have put it at 28% and inverted every game on the page.
 *
 * Draft Kings preferred, any provider accepted, because a missing book should
 * degrade to a different book rather than to no line.
 */
const LINE_TTL_MS = 60 * 60 * 1000;
type LineRow = { gameId?: number; lines?: Array<{ provider?: string; spread?: number; overUnder?: number }> };
const lineCache = new Map<string, { at: number; map: Map<number, Game["line"]> }>();

async function linesForDate(key: string, season: number, onDate: string): Promise<Map<number, Game["line"]>> {
  const hit = lineCache.get(onDate);
  if (hit && Date.now() - hit.at < LINE_TTL_MS) return hit.map;
  const map = new Map<number, Game["line"]>();
  try {
    // A day either side, because the endpoint filters on the UTC start and our
    // day is Eastern — the same straddle easternDate() exists to handle.
    const from = iso(new Date(Date.parse(`${onDate}T12:00:00Z`) - 86_400_000));
    const to = iso(new Date(Date.parse(`${onDate}T12:00:00Z`) + 86_400_000));
    const rows = (await cbbd(`/lines?season=${season}&startDateRange=${from}&endDateRange=${to}`, key)) as LineRow[];
    for (const r of rows) {
      if (typeof r.gameId !== "number" || !Array.isArray(r.lines) || r.lines.length === 0) continue;
      const pick = r.lines.find((l) => l.provider === "Draft Kings") ?? r.lines[0]!;
      const spread = typeof pick.spread === "number" ? pick.spread : null;
      const overUnder = typeof pick.overUnder === "number" ? pick.overUnder : null;
      if (spread === null && overUnder === null) continue;
      map.set(r.gameId, { spread, overUnder, provider: pick.provider ?? "" });
    }
  } catch {
    // No line is a normal state (small conferences often have none). Never let
    // it take the scores down.
  }
  lineCache.set(onDate, { at: Date.now(), map });
  return map;
}

/**
 * Ranked games lead, best matchup first: a top-5 vs top-10 outranks a #2 vs
 * unranked. Everything else keeps tip order. This is the order the ticker and
 * the page both render, so "the games that matter" are what you see without
 * scrolling.
 */
function rankKey(g: Game): number {
  const a = g.home.rank ?? 999;
  const b = g.away.rank ?? 999;
  if (a === 999 && b === 999) return 9999;
  return Math.min(a, b) * 100 + Math.max(a, b);
}
function orderGames(games: Game[]): Game[] {
  return games.slice().sort((x, y) => {
    const dk = rankKey(x) - rankKey(y);
    if (dk !== 0) return dk;
    return x.startDate.localeCompare(y.startDate);
  });
}

async function cbbd(path: string, key: string): Promise<unknown[]> {
  const res = await fetch(API + path, {
    headers: { Authorization: `Bearer ${key}`, accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`CBBD ${res.status} on ${path}`);
  const body = await res.json();
  return Array.isArray(body) ? body : [];
}

/**
 * Live slate if there is one, else the most recent completed slate within
 * FALLBACK_DAYS. Returns whichever it used so the UI can label it honestly
 * rather than implying eight-month-old scores are current.
 */
async function resolveSlate(key: string, season: number, anchor?: Date): Promise<Slate> {
  const now = anchor ?? new Date();
  // An explicit date asks for THAT day's slate, so skip the live feed — it only
  // ever describes right now and would override the day being asked for.
  const live = anchor ? [] : await cbbd("/scoreboard", key);
  if (live.length > 0) {
    const games = live.map((r) => normalise(r as Record<string, unknown>)).filter((g): g is Game => g !== null);
    if (games.length > 0) {
      const date = easternDate(games[0]!.startDate) ?? iso(now);
      const [ranks, recs, lines] = await Promise.all([
        rankingsForDate(key, season, date),
        recordsBefore(key, season, date),
              linesForDate(key, season, date),
      ]);
      for (const g of games) {
        g.home.rank = ranks.get(g.home.team) ?? null;
        g.away.rank = ranks.get(g.away.team) ?? null;
        g.home.record = recs.get(g.home.team) ?? null;
        g.away.record = recs.get(g.away.team) ?? null;
        g.line = lines.get(g.id) ?? null;
      }
      return { source: "live", date, games: orderGames(games), fetchedAt: now.toISOString() };
    }
  }
  // Nothing live. Walk back a day at a time and return the first Eastern day
  // that has games, so the ticker shows last night rather than an empty rail.
  //
  // One CBBD request covers the whole walk: we ask for a UTC window a day wider
  // on each side than the days we care about, then bucket by Eastern date. That
  // is both cheaper against the call quota and the only way to catch the late
  // games, which land on the following UTC day.
  const target = easternDate(now.toISOString());
  const wide = await cbbd(
    `/games?season=${season}` +
      `&startDateRange=${iso(new Date(now.getTime() - (FALLBACK_DAYS + 1) * 86_400_000))}` +
      `&endDateRange=${iso(new Date(now.getTime() + 86_400_000))}`,
    key,
  );
  const byDate = new Map<string, Game[]>();
  for (const row of wide) {
    const g = normalise(row as Record<string, unknown>);
    if (!g) continue;
    if (g.home.points === null && g.away.points === null) continue; // not played
    const d = easternDate(g.startDate);
    if (!d) continue;
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(g);
  }
  for (let back = 0; back <= FALLBACK_DAYS; back++) {
    const day = target
      ? easternDate(new Date(Date.parse(`${target}T12:00:00Z`) - back * 86_400_000).toISOString())
      : null;
    const games = day ? byDate.get(day) : undefined;
    if (games && games.length > 0) {
      const [ranks, recs, lines] = await Promise.all([
        rankingsForDate(key, season, day!),
        recordsBefore(key, season, day!),
              linesForDate(key, season, day!),
      ]);
      for (const g of games) {
        g.home.rank = ranks.get(g.home.team) ?? null;
        g.away.rank = ranks.get(g.away.team) ?? null;
        g.home.record = recs.get(g.home.team) ?? null;
        g.away.record = recs.get(g.away.team) ?? null;
        g.line = lines.get(g.id) ?? null;
      }
      return { source: "recent", date: day, games: orderGames(games), fetchedAt: now.toISOString() };
    }
  }
  // Nothing live and nothing behind us. Look FORWARD for the next day that has
  // games — which in July is opening night, and in early November is tomorrow.
  // Skipped when a date was explicitly asked for: "show me 4 February" must not
  // silently answer with 11 February because the 4th was empty.
  if (!anchor) {
    const next = await nextSlate(key, season, now);
    if (next) {
      const [ranks, recs, lines] = await Promise.all([
        rankingsForDate(key, season, next.date),
        recordsBefore(key, season, next.date),
        linesForDate(key, season, next.date),
      ]);
      for (const g of next.games) {
        g.home.rank = ranks.get(g.home.team) ?? null;
        g.away.rank = ranks.get(g.away.team) ?? null;
        g.home.record = recs.get(g.home.team) ?? null;
        g.away.record = recs.get(g.away.team) ?? null;
        g.line = lines.get(g.id) ?? null;
      }
      return { source: "upcoming", date: next.date, games: orderGames(next.games), fetchedAt: now.toISOString() };
    }
  }
  return { source: "recent", date: null, games: [], fetchedAt: now.toISOString() };
}

/**
 * The earliest day from `now` forward that has games on the schedule.
 *
 * WHY IT STARTS AT THE SEASON OPENER RATHER THAN TODAY: for five months of the
 * year the answer is months away, and stepping forward a fortnight at a time
 * from late July would burn a dozen calls to learn what the calendar already
 * says — the sport does not play before November. Jumping the cursor straight
 * to 1 November collapses the whole offseason to a single request.
 *
 * Returns the first day with ANY game, not the first day with a good one. In
 * November that is a Monday of buy games, and that is the honest answer to
 * "when does basketball start".
 *
 * EXPORTED for scripts/check-schedule.mts, which asks "has CBBD published next
 * season yet?". That script wants the real walk rather than a copy of it —
 * a second implementation of the cursor and the bucketing is a second thing to
 * get wrong. Netlify only ever invokes the default export.
 */
export async function nextSlate(
  key: string, season: number, now: Date,
): Promise<{ date: string; games: Game[] } | null> {
  const today = easternDate(now.toISOString()) ?? iso(now);
  // A CBBD season labelled N is played across N-1 and N, and opens in early
  // November of N-1. Late-October exhibitions exist, so the cursor starts there.
  const opens = `${season - 1}-10-25`;
  let cursor = today > opens ? today : opens;

  for (let w = 0; w < LOOKAHEAD_WINDOWS; w++) {
    const to = iso(new Date(Date.parse(`${cursor}T12:00:00Z`) + LOOKAHEAD_DAYS * 86_400_000));
    const rows = await cbbd(
      `/games?season=${season}&startDateRange=${cursor}&endDateRange=${to}`, key,
    ).catch(() => [] as unknown[]);

    const byDate = new Map<string, Game[]>();
    for (const row of rows) {
      const g = normalise(row as Record<string, unknown>);
      if (!g) continue;
      const d = easternDate(g.startDate);
      // Strictly forward. The window's first day is today, whose already-played
      // games belong to the backward walk that ran before this.
      if (!d || d < today) continue;
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d)!.push(g);
    }
    if (byDate.size > 0) {
      const first = [...byDate.keys()].sort()[0]!;
      return { date: first, games: byDate.get(first)! };
    }
    cursor = to;
  }
  return null;
}

/**
 * Season label CBBD uses: the 2025-26 season is season=2026, and it rolls over
 * at the turn of the calendar year — a game in November 2025 is season 2026.
 */
function currentSeason(now = new Date()): number {
  return now.getUTCMonth() >= 6 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
}

export default async (req: Request, _context: Context) => {
  const key = process.env.CBBD_API_KEY;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    // Browsers revalidate quickly; the edge is what actually shields CBBD.
    "cache-control": "public, max-age=15",
    "netlify-cdn-cache-control": `public, s-maxage=${REFRESH_SECONDS}, stale-while-revalidate=${STALE_SECONDS}`,
  };

  if (!key) {
    // Absent key is a deployment problem, not a reader problem: answer 200 with
    // an empty slate so the ticker hides itself instead of throwing in the UI.
    return new Response(
      JSON.stringify({ source: "recent", date: null, games: [], fetchedAt: new Date().toISOString(), error: "unconfigured" }),
      { status: 200, headers },
    );
  }

  // ?date=YYYY-MM-DD pins the slate to one day — what the /scoreboard page's
  // day picker asks for. Anything unparseable falls through to "today".
  const params = new URL(req.url).searchParams;
  const raw = params.get("date");
  const asDate = (d: string | null) =>
    d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T23:59:59Z`) : undefined;
  const anchor = asDate(raw);
  const season = Number(params.get("season")) || currentSeason(anchor);
  try {
    let slate = await resolveSlate(key, season, anchor);
    // DEMO_DATE is reached ONLY here, after live, recent and upcoming have all
    // come up empty, and only when no date was asked for. Ordering it last is
    // what makes it self-retiring: publish the schedule upstream and the
    // preview stops being consulted, no deploy required.
    if (!anchor && slate.games.length === 0 && DEMO_DATE) {
      const demo = asDate(DEMO_DATE);
      if (demo) slate = await resolveSlate(key, currentSeason(demo), demo);
    }
    // See simulateLive(). Unreachable in a deployed function.
    if (process.env.NETLIFY_DEV === "true") {
      const sim = params.get("sim");
      if (sim === "live") {
        slate.games = simulateLive(slate.games);
        slate.source = "live";
      } else if (sim === "upcoming") {
        // The preseason state, which is otherwise unreachable until CBBD
        // publishes a schedule: every game back to scheduled, dated forward so
        // the "future slate stops polling" rule is exercised too.
        slate.games = simulateUpcoming(slate.games);
        slate.source = "upcoming";
        slate.date = iso(new Date(Date.now() + 30 * 86_400_000));
      }
    }
    return new Response(JSON.stringify(slate), { status: 200, headers });
  } catch (err) {
    // Never 5xx at the reader. An empty slate collapses the ticker; a 500 would
    // put an error state in front of someone who came to read about teams.
    return new Response(
      JSON.stringify({
        source: "recent", date: null, games: [], fetchedAt: new Date().toISOString(),
        error: String(err instanceof Error ? err.message : err).slice(0, 120),
      }),
      // Short edge cache on failure so a CBBD blip doesn't pin an empty slate
      // for a full minute.
      { status: 200, headers: { ...headers, "netlify-cdn-cache-control": "public, s-maxage=20" } },
    );
  }
};

export const config = { path: "/api/scoreboard" };
