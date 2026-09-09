#!/usr/bin/env npx tsx
/**
 * build-scoreboard-archive.mts — bake a whole season of scoreboards and game
 * pages from the local CBBD archive, with no API calls.
 *
 *   npx tsx scripts/build-scoreboard-archive.mts                 # 2026, everything
 *   npx tsx scripts/build-scoreboard-archive.mts --limit 3       # first 3 days + their games
 *   npx tsx scripts/build-scoreboard-archive.mts --slates-only
 *   npx tsx scripts/build-scoreboard-archive.mts --games-only
 *   npx tsx scripts/build-scoreboard-archive.mts --fetch-lines   # one-time: cache betting lines
 *   npx tsx scripts/build-scoreboard-archive.mts --schedule --season 2027
 *                                                # the UPCOMING season's fixtures
 *   npx tsx scripts/build-scoreboard-archive.mts --fetch-schedule --season 2019
 *                                                # backfill an old season's games-*.json.gz
 *                                                # the UPCOMING season's fixtures
 *
 * Writes:
 *   public/data/scoreboard/<season>/<YYYY-MM-DD>.json   one Slate per day (the
 *                                                        shape /api/scoreboard returns)
 *   public/data/scoreboard/<season>/index.json          every game, compact — what the
 *                                                        static day and game pages are
 *                                                        generated from at build time
 *   public/data/games/<season>/<id>.json                one GameBundle per game (the
 *                                                        shape /api/game returns)
 *   src/data/scoreboard-archive.json                    the archived seasons and their
 *                                                        days — tiny, committed, what the
 *                                                        client reads to know which dates
 *                                                        are static files
 *
 * THE FUNCTIONS ARE THE BUILDERS. Rather than reimplementing how a slate or a
 * game bundle is shaped, this imports the two Netlify handlers and calls them
 * exactly as the browser would — but with `fetch` replaced by a shim that
 * answers every api.collegebasketballdata.com request from the files under
 * data/cbbd/<season>/. The archive holds the full schedule, both box scores
 * and every day's play-by-play, so nothing is missing and nothing is spent
 * against the quota. Same trick the old build-demo-slate.mjs used to bake its
 * two sample files, minus the network — and this replaced it.
 *
 * WHAT THE SHIM HAS TO GET RIGHT is the handful of query shapes the handlers
 * use (see the switch in `answer`). A path it does not recognise throws rather
 * than returning [] — an unknown query silently answered empty would bake a
 * season of pages with a panel quietly missing.
 *
 * ── THE UPCOMING SEASON ────────────────────────────────────────────────────
 *
 * `--schedule` is the other half, and it is what makes a season work without a
 * deploy every night. CBBD publishes the fixture list weeks ahead, so every
 * game HAS an id before it is played — which means its page can be built
 * before it is played. A scheduled page renders the teams, the tip time and
 * the venue on the server and fetches the score live once the game starts.
 *
 * The alternative was a Netlify rewrite catching unknown /games/ URLs and
 * serving an empty shell. This is better on every axis: it works identically
 * in `next dev`, a crawler gets real content instead of a spinner, and there
 * is no rule to keep in step with the routes.
 *
 * Rerun it whenever CBBD publishes more of the season; games already built
 * keep their URLs, so nothing that was shared ever breaks.
 *
 * Lines are the one thing the archive does not carry. `--fetch-lines` pulls
 * the season's closing lines from CBBD once (a dozen calls, windowed to stay
 * under the 3,000-row cap) into data/cbbd/<season>/lines-full.json.gz, and
 * every later run reads that file.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { setDefaultResultOrder } from "node:dns";

setDefaultResultOrder("ipv4first");

const API = "https://api.collegebasketballdata.com";
const root = process.cwd();
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const opt = (name: string) => { const i = argv.indexOf(name); return i > -1 ? argv[i + 1] : undefined; };

const SEASON = Number(opt("--season") ?? 2026);
const LIMIT = Number(opt("--limit") ?? 0);
const SLATES_ONLY = flag("--slates-only");
const GAMES_ONLY = flag("--games-only");
const FETCH_LINES = flag("--fetch-lines");
const SCHEDULE_ONLY = flag("--schedule");
const FETCH_SCHEDULE = flag("--fetch-schedule");

const archiveDir = (season: number) => path.join(root, "data", "cbbd", String(season));
const outSlates = path.join(root, "public", "data", "scoreboard", String(SEASON));
const outGames = path.join(root, "public", "data", "games", String(SEASON));
const committedIndex = path.join(root, "src", "data", "scoreboard-archive.json");

/* ------------------------------ archive loading ---------------------------- */

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function gz<T = Row[]>(file: string): T {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf8")) as T;
}
function exists(file: string): boolean {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}

/** The calendar date a game belongs to, US Eastern — same rule as the functions. */
const ET_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
});
function easternDate(iso: string): string | null {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? ET_DATE.format(new Date(t)) : null;
}

/** All schedule rows for a season, deduped by id, sorted by start. */
const gamesCache = new Map<number, Row[]>();
function seasonGames(season: number): Row[] {
  const hit = gamesCache.get(season);
  if (hit) return hit;
  const dir = archiveDir(season);
  const out: Row[] = [];
  const seen = new Set<number>();
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter((x) => /^games-\d{8}-\d{8}\.json\.gz$/.test(x)).sort()) {
      for (const r of gz(path.join(dir, f))) {
        if (typeof r.id !== "number" || seen.has(r.id)) continue;
        seen.add(r.id);
        out.push(r);
      }
    }
  }
  out.sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
  gamesCache.set(season, out);
  return out;
}

const rankCache = new Map<number, Row[]>();
function rankings(season: number): Row[] {
  const hit = rankCache.get(season);
  if (hit) return hit;
  const f = path.join(archiveDir(season), "rankings.json.gz");
  const rows = exists(f) ? gz(f) : [];
  rankCache.set(season, rows);
  return rows;
}

/** Team box rows and player box rows, indexed by team. Loaded once per season. */
type BoxIndex = { byTeam: Map<string, Row[]> };
const boxTeamCache = new Map<number, BoxIndex>();
const boxPlayerCache = new Map<number, BoxIndex>();
function indexByTeam(rows: Row[]): BoxIndex {
  const byTeam = new Map<string, Row[]>();
  for (const r of rows) {
    const t = r.team;
    if (typeof t !== "string") continue;
    let arr = byTeam.get(t);
    if (!arr) { arr = []; byTeam.set(t, arr); }
    arr.push(r);
  }
  return { byTeam };
}
function boxTeams(season: number): BoxIndex {
  let hit = boxTeamCache.get(season);
  if (!hit) {
    const f = path.join(archiveDir(season), "box-teams-full.json.gz");
    hit = indexByTeam(exists(f) ? gz(f) : []);
    boxTeamCache.set(season, hit);
  }
  return hit;
}
function boxPlayers(season: number): BoxIndex {
  let hit = boxPlayerCache.get(season);
  if (!hit) {
    const f = path.join(archiveDir(season), "box-players-full.json.gz");
    hit = indexByTeam(exists(f) ? gz(f) : []);
    boxPlayerCache.set(season, hit);
  }
  return hit;
}

/**
 * Play-by-play, one file per EASTERN game date, grouped by game on first read.
 * A game's plays are looked up by its own date, then a day either side —
 * the files are cut by the date CBBD stamps on the game, which is Eastern,
 * and this guards the one or two a year that land on the wrong side of it.
 */
const playsCache = new Map<string, Map<number, Row[]>>();
function playsFile(season: number, date: string): Map<number, Row[]> {
  const hit = playsCache.get(date);
  if (hit) return hit;
  const f = path.join(archiveDir(season), `plays-${date.replace(/-/g, "")}.json.gz`);
  const byGame = new Map<number, Row[]>();
  if (exists(f)) {
    for (const p of gz(f)) {
      const id = p.gameId;
      if (typeof id !== "number") continue;
      let arr = byGame.get(id);
      if (!arr) { arr = []; byGame.set(id, arr); }
      arr.push(p);
    }
  }
  playsCache.set(date, byGame);
  // Keep memory bounded: a season is 150 files of ~60k rows.
  if (playsCache.size > 4) {
    const oldest = playsCache.keys().next().value;
    if (oldest && oldest !== date) playsCache.delete(oldest);
  }
  return byGame;
}
function shiftDay(d: string, n: number): string {
  return new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
const gameDate = new Map<number, string>(); // id → eastern date, filled from the schedule
function playsFor(season: number, id: number): Row[] {
  const d = gameDate.get(id);
  if (!d) return [];
  for (const cand of [d, shiftDay(d, -1), shiftDay(d, 1)]) {
    const rows = playsFile(season, cand).get(id);
    if (rows && rows.length) return rows;
  }
  return [];
}

const linesCache = new Map<number, Row[]>();
function lines(season: number): Row[] {
  const hit = linesCache.get(season);
  if (hit) return hit;
  const f = path.join(archiveDir(season), "lines-full.json.gz");
  const rows = exists(f) ? gz(f) : [];
  linesCache.set(season, rows);
  return rows;
}

/* --------------------------------- the shim -------------------------------- */

const inRange = (iso: unknown, from: string | null, to: string | null) => {
  if (typeof iso !== "string") return false;
  const d = iso.slice(0, 10);
  return (!from || d >= from) && (!to || d <= to);
};

function answer(url: URL): Row[] {
  const p = url.pathname;
  const q = url.searchParams;
  const season = Number(q.get("season"));
  const from = q.get("startDateRange"), to = q.get("endDateRange");
  const team = q.get("team"), conference = q.get("conference");

  if (p === "/scoreboard") return []; // never live in the archive
  if (p === "/games") {
    let rows = seasonGames(season);
    if (team) rows = rows.filter((r) => r.homeTeam === team || r.awayTeam === team);
    if (conference) rows = rows.filter((r) => r.homeConference === conference || r.awayConference === conference);
    if (from || to) rows = rows.filter((r) => inRange(r.startDate, from, to));
    return rows;
  }
  if (p === "/rankings") return rankings(season);
  if (p === "/games/teams" || p === "/games/players") {
    const idx = p === "/games/teams" ? boxTeams(season) : boxPlayers(season);
    let rows = team ? (idx.byTeam.get(team) ?? []) : [];
    if (!team) throw new Error(`shim: ${p} without team is not a query the archive answers`);
    if (from || to) rows = rows.filter((r) => inRange(r.startDate, from, to));
    return rows;
  }
  const playsMatch = p.match(/^\/plays\/game\/(\d+)$/);
  if (playsMatch) return playsFor(SEASON, Number(playsMatch[1]));
  if (p === "/games/media") return []; // not archived; broadcasts render as absent
  if (p === "/lines") return lines(season).filter((r) => inRange(r.startDate, from, to));
  throw new Error(`shim: no local answer for ${p}?${q}`);
}

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.origin !== API) return realFetch(input, init);
  const rows = answer(url);
  return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

process.env.CBBD_API_KEY ??= "offline";
delete process.env.NETLIFY_DEV;

/* ------------------------------- lines cache ------------------------------- */

async function fetchLines(season: number): Promise<void> {
  const key = fs.readFileSync(path.join(root, ".env.local"), "utf8").match(/^CBBD_API_KEY=(.+)$/m)?.[1]?.trim();
  if (!key) throw new Error("CBBD_API_KEY not found in .env.local");
  const games = seasonGames(season);
  const first = String(games[0]!.startDate).slice(0, 10);
  const last = String(games[games.length - 1]!.startDate).slice(0, 10);
  const out: Row[] = [];
  let cursor = first;
  while (cursor <= last) {
    const to = shiftDay(cursor, 13);
    const res = await realFetch(`${API}/lines?season=${season}&startDateRange=${cursor}&endDateRange=${to}`, {
      headers: { Authorization: `Bearer ${key}`, accept: "application/json" },
    });
    if (!res.ok) throw new Error(`CBBD ${res.status} on /lines ${cursor}..${to}`);
    const rows = (await res.json()) as Row[];
    if (rows.length >= 3000) throw new Error(`/lines ${cursor}..${to} hit the 3,000-row cap — narrow the window`);
    console.log(`  lines ${cursor}..${to}: ${rows.length}`);
    out.push(...rows);
    cursor = shiftDay(to, 1);
  }
  const f = path.join(archiveDir(season), "lines-full.json.gz");
  fs.writeFileSync(f, zlib.gzipSync(JSON.stringify(out)));
  linesCache.delete(season);
  console.log(`wrote ${f}: ${out.length} rows`);
}

/**
 * Backfill a season's schedule into the archive, in the same shape and naming
 * the ingest scripts use, so the shim finds it like any other season.
 *
 * 2014-2024 have box scores, play-by-play and rankings locally but no
 * `games-*.json.gz` — the schedule was never archived because nothing needed
 * it until the game pages did. It is the cheapest file in the set: a dozen
 * windowed calls a season.
 */
/**
 * A CBBD GET with backoff.
 *
 * CBBD rate-limits per short window as well as per month, and answers 429
 * rather than queueing. Backfilling a decade of schedules is the first thing
 * here fast enough to trip it, and a bare throw halfway through leaves the
 * archive in a state nobody can tell apart from "done".
 */
async function cbbdGet(url: string, key: string, tries = 5): Promise<Row[]> {
  for (let i = 0; i < tries; i++) {
    const res = await realFetch(url, { headers: { Authorization: `Bearer ${key}`, accept: "application/json" } });
    if (res.status === 429) {
      const wait = 2000 * 2 ** i;
      console.log(`    429 — waiting ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) throw new Error(`CBBD ${res.status} on ${url.replace(API, "")}`);
    return (await res.json()) as Row[];
  }
  throw new Error(`CBBD kept rate-limiting ${url.replace(API, "")}`);
}

async function fetchSchedule(season: number): Promise<void> {
  const key = fs.readFileSync(path.join(root, ".env.local"), "utf8").match(/^CBBD_API_KEY=(.+)$/m)?.[1]?.trim();
  if (!key) throw new Error("CBBD_API_KEY not found in .env.local");
  const dir = archiveDir(season);
  fs.mkdirSync(dir, { recursive: true });
  let cursor = `${season - 1}-10-25`;
  const end = `${season}-04-15`;
  let total = 0, files = 0;
  while (cursor <= end) {
    const to = shiftDay(cursor, 13);
    const batch = await cbbdGet(`${API}/games?season=${season}&startDateRange=${cursor}&endDateRange=${to}`, key);
    if (batch.length >= 3000) throw new Error(`/games ${cursor}..${to} hit the 3,000-row cap`);
    if (batch.length) {
      const name = `games-${cursor.replace(/-/g, "")}-${to.replace(/-/g, "")}.json.gz`;
      fs.writeFileSync(path.join(dir, name), zlib.gzipSync(JSON.stringify(batch)));
      total += batch.length;
      files++;
    }
    cursor = shiftDay(to, 1);
  }
  gamesCache.delete(season);
  console.log(`schedule ${season}: ${total} games in ${files} files`);
}

/* ------------------------------ the schedule ------------------------------- */

/**
 * Bake the upcoming season's fixtures: one slate per day, plus an index.
 *
 * Straight from CBBD rather than through the shim — there is no local archive
 * for a season that has not been played, and there is nothing to assemble
 * beyond the schedule itself. Windowed at 14 days to stay clear of the
 * 3,000-row response cap.
 */
async function buildSchedule(season: number): Promise<void> {
  const key = fs.readFileSync(path.join(root, ".env.local"), "utf8").match(/^CBBD_API_KEY=(.+)$/m)?.[1]?.trim();
  if (!key) throw new Error("CBBD_API_KEY not found in .env.local");
  const rows: Row[] = [];
  const seen = new Set<number>();
  // A season labeled N opens in early November of N-1 and ends in April.
  let cursor = `${season - 1}-10-25`;
  const end = `${season}-04-15`;
  while (cursor <= end) {
    const to = shiftDay(cursor, 13);
    const res = await realFetch(`${API}/games?season=${season}&startDateRange=${cursor}&endDateRange=${to}`, {
      headers: { Authorization: `Bearer ${key}`, accept: "application/json" },
    });
    if (!res.ok) throw new Error(`CBBD ${res.status} on /games ${cursor}..${to}`);
    const batch = (await res.json()) as Row[];
    if (batch.length >= 3000) throw new Error(`/games ${cursor}..${to} hit the 3,000-row cap — narrow the window`);
    for (const r of batch) {
      if (typeof r.id !== "number" || seen.has(r.id)) continue;
      seen.add(r.id);
      rows.push(r);
    }
    if (batch.length) console.log(`  ${cursor}..${to}: ${batch.length}`);
    cursor = shiftDay(to, 1);
  }
  if (rows.length === 0) throw new Error(`CBBD has published no schedule for ${season}`);

  const outDir = path.join(root, "public", "data", "scoreboard", String(season));
  fs.mkdirSync(outDir, { recursive: true });
  const byDay = new Map<string, Row[]>();
  for (const r of rows) {
    const d = easternDate(String(r.startDate));
    if (!d) continue;
    let arr = byDay.get(d);
    if (!arr) { arr = []; byDay.set(d, arr); }
    arr.push(r);
  }
  const side = (r: Row, p: "home" | "away") => ({
    team: r[`${p}Team`] ?? "", conference: r[`${p}Conference`] ?? null,
    // CBBD scores an unplayed game 0-0; only a game that has started may
    // carry a number. Same rule as normalize() in the scoreboard function.
    points: (r.status ?? "scheduled").toLowerCase() !== "scheduled" && typeof r[`${p}Points`] === "number"
      ? r[`${p}Points`] : null,
    winner: typeof r[`${p}Winner`] === "boolean" ? r[`${p}Winner`] : null,
    seed: typeof r[`${p}Seed`] === "number" ? r[`${p}Seed`] : null,
    rank: null,
    periods: Array.isArray(r[`${p}PeriodPoints`]) ? r[`${p}PeriodPoints`].filter((n: unknown) => typeof n === "number") : [],
    record: null,
  });
  const days: Array<{ date: string; games: number }> = [];
  const index: Row[] = [];
  for (const d of [...byDay.keys()].sort()) {
    const games = byDay.get(d)!
      .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)))
      .map((r) => ({
        id: r.id, startDate: r.startDate ?? "", status: (r.status ?? "scheduled").toLowerCase(),
        home: side(r, "home"), away: side(r, "away"),
        neutralSite: r.neutralSite === true, conferenceGame: r.conferenceGame === true,
        venue: r.venue ?? null, period: null, clock: null, line: null,
        /**
         * CBBD'"'"'S OWN "TIP TIME NOT SET" FLAG, carried rather than inferred.
         * Every unscheduled game comes back at midnight Eastern, so without
         * this the card would print a confident "12:00 AM ET" for a game
         * whose time nobody has decided. In September 2026 that is every
         * fixture in the 2026-27 list.
         */
        tbd: r.startTimeTbd === true || String(r.startDate ?? "").slice(11, 16) === "05:00",
      }));
    fs.writeFileSync(
      path.join(outDir, `${d}.json`),
      JSON.stringify({ source: "upcoming", date: d, games, fetchedAt: new Date().toISOString() }),
    );
    days.push({ date: d, games: games.length });
    for (const g of games) {
      index.push({
        id: g.id, date: d, start: g.startDate, status: g.status, tbd: g.tbd,
        venue: g.venue, city: null, state: null, attendance: null,
        neutral: g.neutralSite, confGame: g.conferenceGame, excitement: null,
        home: { team: g.home.team, conf: g.home.conference, pts: null, periods: [], winner: null, rank: null, seed: g.home.seed, rec: null, elo: null },
        away: { team: g.away.team, conf: g.away.conference, pts: null, periods: [], winner: null, rank: null, seed: g.away.seed, rec: null, elo: null },
        line: null,
      });
    }
  }
  fs.writeFileSync(path.join(outDir, "index.json"), JSON.stringify({ season, days, games: index }));
  const committed = exists(committedIndex) ? JSON.parse(fs.readFileSync(committedIndex, "utf8")) : {};
  // `scheduled` is what tells the site these pages must fetch live rather than
  // trusting the file: an archived day is over, a scheduled one has not
  // happened yet.
  committed[String(season)] = { first: days[0]!.date, last: days[days.length - 1]!.date, days: days.map((x) => x.date), scheduled: true };
  fs.writeFileSync(committedIndex, JSON.stringify(committed));
  console.log(`schedule ${season}: ${rows.length} games across ${days.length} days`);
  console.log(`  wrote ${path.relative(root, outDir)} and ${path.relative(root, committedIndex)}`);
}

/* ---------------------------------- build ---------------------------------- */

async function call(handler: (req: Request, ctx: unknown) => Promise<Response>, url: string) {
  const res = await handler(new Request(url), {});
  const text = await res.text();
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const json = JSON.parse(text);
  if (json?.error) throw new Error(`${url} → ${json.error}`);
  return { json, text };
}

async function main() {
  const t0 = Date.now();
  if (FETCH_SCHEDULE) {
    await fetchSchedule(SEASON);
    console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    return;
  }
  if (SCHEDULE_ONLY) {
    await buildSchedule(SEASON);
    console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    return;
  }
  if (FETCH_LINES) await fetchLines(SEASON);

  const games = seasonGames(SEASON);
  if (games.length === 0) throw new Error(`no schedule files under data/cbbd/${SEASON}`);
  for (const r of games) {
    const d = easternDate(String(r.startDate));
    if (d) gameDate.set(r.id, d);
  }
  const played = games.filter((r) => r.status === "final" && typeof r.homePoints === "number");
  const daySet = new Set<string>();
  for (const r of played) daySet.add(gameDate.get(r.id)!);
  let days = [...daySet].sort();
  if (LIMIT) days = days.slice(0, LIMIT);
  console.log(`season ${SEASON}: ${games.length} scheduled, ${played.length} played, ${daySet.size} days${LIMIT ? ` (limited to ${days.length})` : ""}`);
  console.log(`lines: ${lines(SEASON).length ? "cached" : "NONE — run with --fetch-lines once to add betting lines"}`);

  const { default: scoreboard } = await import("../netlify/functions/scoreboard.mts");
  const { default: game } = await import("../netlify/functions/game.mts");

  fs.mkdirSync(outSlates, { recursive: true });
  fs.mkdirSync(outGames, { recursive: true });

  /* ---- slates ---- */
  type IndexGame = {
    id: number; date: string; start: string; status: string;
    venue: string | null; city: string | null; state: string | null; attendance: number | null;
    neutral: boolean; confGame: boolean; excitement: number | null;
    home: IndexSide; away: IndexSide;
    line: { spread: number | null; overUnder: number | null; provider: string } | null;
  };
  type IndexSide = {
    team: string; conf: string | null; pts: number | null; periods: number[]; winner: boolean | null;
    rank: number | null; seed: number | null; rec: [number, number] | null; elo: [number, number] | null;
  };
  const index: IndexGame[] = [];
  const dayCounts: Array<{ date: string; games: number }> = [];
  let slateBytes = 0;
  if (!GAMES_ONLY) {
    for (const d of days) {
      const { json } = await call(scoreboard, `http://x/api/scoreboard?date=${d}`);
      if (json.date !== d) throw new Error(`slate for ${d} came back dated ${json.date}`);
      /**
       * A FINISHED DAY CONTAINS ONLY FINISHED GAMES. CBBD keeps cancelled and
       * postponed rows in the schedule with 0-0 scores, and the live path
       * cannot drop them — a 0-0 at 7pm is a game about to tip. On a day that
       * is over it is a game that never happened, and printing "0 - 0 Final"
       * beside fifty real results is the scoreboard being wrong about the only
       * thing it does. 15 rows across 2025-26.
       */
      json.games = json.games.filter((g: Row) => g.status === "final" && g.home?.points !== null && g.away?.points !== null);
      if (!json.games.length) throw new Error(`slate for ${d} is empty`);
      const text = JSON.stringify(json);
      fs.writeFileSync(path.join(outSlates, `${d}.json`), text);
      slateBytes += text.length;
      dayCounts.push({ date: d, games: json.games.length });
      const rawById = new Map<number, Row>(games.map((r) => [r.id, r]));
      for (const g of json.games) {
        const raw = rawById.get(g.id) ?? {};
        const side = (s: Row, p: "home" | "away"): IndexSide => ({
          team: s.team, conf: s.conference ?? null, pts: s.points ?? null, periods: s.periods ?? [],
          winner: s.winner ?? null, rank: s.rank ?? null, seed: s.seed ?? null,
          rec: s.record ? [s.record.w, s.record.l] : null,
          elo: typeof raw[`${p}TeamEloStart`] === "number" && typeof raw[`${p}TeamEloEnd`] === "number"
            ? [raw[`${p}TeamEloStart`], raw[`${p}TeamEloEnd`]] : null,
        });
        index.push({
          id: g.id, date: d, start: g.startDate, status: g.status,
          venue: g.venue ?? null, city: raw.city ?? null, state: raw.state ?? null,
          attendance: typeof raw.attendance === "number" ? raw.attendance : null,
          neutral: g.neutralSite === true, confGame: g.conferenceGame === true,
          excitement: typeof raw.excitement === "number" ? raw.excitement : null,
          home: side(g.home, "home"), away: side(g.away, "away"),
          line: g.line ?? null,
        });
      }
      process.stdout.write(`\r  slates ${dayCounts.length}/${days.length}  ${d}  ${json.games.length} games   `);
    }
    process.stdout.write("\n");
    index.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.id - b.id);
    fs.writeFileSync(path.join(outSlates, "index.json"), JSON.stringify({ season: SEASON, days: dayCounts, games: index }));
    console.log(`  ${dayCounts.length} slates, ${(slateBytes / 1024).toFixed(0)} KB; index ${index.length} games`);

    // The committed index: seasons and their days, nothing else.
    const existing = exists(committedIndex) ? JSON.parse(fs.readFileSync(committedIndex, "utf8")) : {};
    existing[String(SEASON)] = { first: days[0], last: days[days.length - 1], days: dayCounts.map((x) => x.date) };
    fs.writeFileSync(committedIndex, JSON.stringify(existing));
    console.log(`  wrote ${path.relative(root, committedIndex)}`);
  }

  /* ---- games ---- */
  if (!SLATES_ONLY) {
    const wanted = played.filter((r) => days.includes(gameDate.get(r.id)!));
    let n = 0, bytes = 0, noPlays = 0, noBox = 0;
    for (const r of wanted) {
      const d = gameDate.get(r.id)!;
      const { json, text } = await call(game, `http://x/api/game?id=${r.id}&date=${d}`);
      if (json.game?.id !== r.id) throw new Error(`game ${r.id} came back as ${json.game?.id}`);
      if (!json.plays?.length) noPlays++;
      if (!json.teamStats?.home) noBox++;
      fs.writeFileSync(path.join(outGames, `${r.id}.json`), text);
      bytes += text.length;
      n++;
      if (n % 50 === 0 || n === wanted.length) {
        process.stdout.write(`\r  games ${n}/${wanted.length}  ${(bytes / 1048576).toFixed(0)} MB  no-plays ${noPlays}  no-box ${noBox}   `);
      }
    }
    process.stdout.write("\n");
  }
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

main().catch((e) => { console.error(e); process.exit(1); });
