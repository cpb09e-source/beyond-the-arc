import type { Context } from "@netlify/functions";

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
 * ⚠ TEMPORARY PREVIEW PIN — DELETE BEFORE THE SEASON STARTS.
 *
 * Set to an ISO date, the feed pretends that day is "today" whenever no
 * explicit ?date= is given. Set to null, everything behaves normally: live feed
 * first, then a walk back for the most recent completed slate.
 *
 * It exists because we are building this in July. CBBD's live /scoreboard is
 * live-ONLY and returns [] out of season, and the fallback walk finds nothing
 * either, so both the ticker and the page correctly render nothing at all —
 * which makes them impossible to look at. Saturday 7 Feb 2026 is the fullest
 * slate of that month: 155 games, 17 of them power-conference, a mix of finals
 * and blowouts and one-possession games.
 *
 * Setting this back to null is the only step needed to go live.
 */
const DEMO_DATE: string | null = "2026-02-07";

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
};

type Slate = {
  /** "live" = from CBBD's live feed; "recent" = a completed slate we fell back to. */
  source: "live" | "recent";
  /** ISO date the games belong to, for the UI's heading. */
  date: string | null;
  games: Game[];
  fetchedAt: string;
};

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
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
    },
    away: {
      team: away,
      conference: str(r.awayConference),
      points: num(r.awayPoints),
      winner: typeof r.awayWinner === "boolean" ? r.awayWinner : null,
      seed: num(r.awaySeed),
      rank: null,
    },
    neutralSite: r.neutralSite === true,
    conferenceGame: r.conferenceGame === true,
    venue: str(r.venue),
    period: num(r.period),
    clock: str(r.clock),
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
      const ranks = await rankingsForDate(key, season, date);
      for (const g of games) {
        g.home.rank = ranks.get(g.home.team) ?? null;
        g.away.rank = ranks.get(g.away.team) ?? null;
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
      const ranks = await rankingsForDate(key, season, day!);
      for (const g of games) {
        g.home.rank = ranks.get(g.home.team) ?? null;
        g.away.rank = ranks.get(g.away.team) ?? null;
      }
      return { source: "recent", date: day, games: orderGames(games), fetchedAt: now.toISOString() };
    }
  }
  return { source: "recent", date: null, games: [], fetchedAt: now.toISOString() };
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
  // day picker asks for, and the only way to exercise a populated slate out of
  // season. Anything unparseable falls through to "today".
  const params = new URL(req.url).searchParams;
  const raw = params.get("date") ?? DEMO_DATE; // see DEMO_DATE — remove for live
  const anchor = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T23:59:59Z`) : undefined;
  const season = Number(params.get("season")) || currentSeason(anchor);
  try {
    const slate = await resolveSlate(key, season, anchor);
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
