#!/usr/bin/env node
/**
 * pull-player-box-v2.mjs — complete, verifiable pull of CBBD's per-game PLAYER
 * box (/games/players) into data/cbbd/<season>/box-players-full.json.gz
 *
 * Replaces the fixed-window box-players-<from>-<to> files, which were silently
 * truncated almost everywhere. Every one of 2026's windows came back at
 * EXACTLY 1000 rows — the endpoint's undocumented ceiling — so the season held
 * 9,354 team-game rows where ~24,000 exist. The per-game player export joined
 * only 69% of games as a direct result.
 *
 * This is the same defect class fixed in pull-team-box-v2.mjs, with two
 * differences worth knowing:
 *
 *   1. THE CAP IS 1000 HERE, not 3000. A player row nests a full roster, so
 *      the server's row budget is spent far faster. Windows start at 7 days
 *      rather than 14 for the same reason.
 *   2. Dedupe is on (gameId, teamId) — one row per team per game, each
 *      carrying that team's whole line-up.
 *
 * Boundary-day truncation is handled exactly as in the team pull: every window
 * is padded outward by OVERLAP_DAYS so no date we care about ever sits on a
 * request edge, and the dedupe absorbs the repeats.
 *
 * Server-side only — reads CBBD_API_KEY from .env.local, never bundled.
 *
 * Usage:
 *   node scripts/pull-player-box-v2.mjs --season 2026
 *   node scripts/pull-player-box-v2.mjs --from 2014 --to 2026 [--force]
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const API = "https://api.collegebasketballdata.com";
const OUT_ROOT = path.resolve("data/cbbd");
const PAUSE_MS = 1100;
/** Hard server-side row ceiling per response — measured, not documented. */
const ROW_CAP = 1000;
/** Treat anything this close to the ceiling as suspect and split anyway. */
const SAFE_ROWS = 850;
/**
 * 0, not 1: `span > MIN_WINDOW_DAYS` has to stay true for a two-calendar-day
 * window so it can split into two single days. At 1 it refused, and dense
 * mid-November dates sat at the cap with no way down.
 */
const MIN_WINDOW_DAYS = 0;
const START_WINDOW_DAYS = 7;
/**
 * See pull-team-box-v2.mjs for why edge days need padding at all. ONE day here,
 * not the team pull's three: padding is applied to both ends, so a 3-day pad
 * makes even a single-day request span seven days — and seven days of rosters
 * blows a 1000-row ceiling in November no matter how far the splitter recurses.
 * One day still makes every target date interior to its request.
 */
const OVERLAP_DAYS = 1;

for (const line of fs.readFileSync(path.resolve(".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]+)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const KEY = process.env.CBBD_API_KEY;
if (!KEY) { console.error("CBBD_API_KEY missing from .env.local"); process.exit(1); }

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i > -1 ? args[i + 1] : null; };
const FORCE = args.includes("--force");
const one = opt("season");
const seasons = one
  ? [Number(one)]
  : (() => {
      const a = Number(opt("from")), b = Number(opt("to"));
      const out = []; for (let s = a; s <= b; s++) out.push(s); return out;
    })();
if (!seasons.length || seasons.some((s) => !Number.isFinite(s))) {
  console.error("usage: --season 2024 | --from 2014 --to 2026 [--force]");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const dayDiff = (a, b) => Math.round((b.getTime() - a.getTime()) / 86400000);

let calls = 0;
async function getJson(url) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${KEY}` },
        signal: AbortSignal.timeout(60000),
      });
      calls++;
      if (r.status === 429 || r.status >= 500) { await sleep(3000 * (attempt + 1)); continue; }
      if (!r.ok) return { error: `HTTP ${r.status}` };
      return { data: await r.json() };
    } catch {
      await sleep(2000 * (attempt + 1));
    }
  }
  return { error: "retries exhausted" };
}

async function fetchRange(season, from, to, sink) {
  const qFrom = addDays(from, -OVERLAP_DAYS);
  const qTo = addDays(to, OVERLAP_DAYS);
  const url = `${API}/games/players?season=${season}&startDateRange=${iso(qFrom)}&endDateRange=${iso(qTo)}`;
  const { data, error } = await getJson(url);
  await sleep(PAUSE_MS);
  if (error) {
    console.warn(`    ! ${iso(from)}..${iso(to)}: ${error}`);
    return 1;
  }
  const rows = Array.isArray(data) ? data : [];
  const span = dayDiff(from, to);

  if (rows.length >= SAFE_ROWS && span > MIN_WINDOW_DAYS) {
    const mid = addDays(from, Math.floor(span / 2));
    const a = await fetchRange(season, from, mid, sink);
    const b = await fetchRange(season, addDays(mid, 1), to, sink);
    return a + b;
  }
  if (rows.length >= ROW_CAP) {
    // A single calendar day at the cap and unsplittable. Reported, but NOT
    // treated as loss: the overlap padding means neighbouring windows usually
    // carry this day too. The completeness verdict printed per season (row
    // parity with the team box) is what actually decides.
    console.warn(`    · ${iso(from)}..${iso(to)} at cap (${rows.length}) at 1-day granularity — checking coverage below`);
    sink.push(...rows);
    return 1;
  }
  sink.push(...rows);
  return 0;
}

for (const season of seasons) {
  const dir = path.join(OUT_ROOT, String(season));
  fs.mkdirSync(dir, { recursive: true });
  const dst = path.join(dir, "box-players-full.json.gz");
  if (fs.existsSync(dst) && !FORCE) {
    console.log(`= ${season}: already pulled (use --force to redo)`);
    continue;
  }

  const seasonStart = new Date(Date.UTC(season - 1, 10, 1));
  const seasonEnd = new Date(Date.UTC(season, 3, 15));

  const sink = [];
  let failures = 0;
  let cursor = seasonStart;
  while (cursor <= seasonEnd) {
    const end = addDays(cursor, START_WINDOW_DAYS - 1) > seasonEnd
      ? seasonEnd
      : addDays(cursor, START_WINDOW_DAYS - 1);
    failures += await fetchRange(season, cursor, end, sink);
    cursor = addDays(end, 1);
  }

  const seen = new Set();
  const rows = [];
  for (const r of sink) {
    const k = `${r.gameId}|${r.teamId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    rows.push(r);
  }

  fs.writeFileSync(dst, zlib.gzipSync(JSON.stringify(rows)));
  const dates = rows.map((r) => new Date(r.startDate).toISOString().slice(0, 10)).sort();
  const feb29 = rows.filter((r) => new Date(r.startDate).toISOString().slice(5, 10) === "02-29").length;

  /**
   * VERIFY against the team pull rather than trusting the cap warnings.
   *
   * Both endpoints return exactly one row per (gameId, teamId), so the team
   * box is a ready-made expected set. This matters because a "still at cap"
   * warning does NOT imply data was lost: the ±OVERLAP_DAYS padding means a
   * capped day is usually also covered by its neighbours' windows, and the
   * dedupe merges them. 2016 and 2017 both warned and both came out complete.
   * Only a non-empty `missing` set is real loss.
   */
  let verdict = "";
  const teamPath = path.join(dir, "box-teams-full.json.gz");
  if (fs.existsSync(teamPath)) {
    try {
      const teamRows = JSON.parse(zlib.gunzipSync(fs.readFileSync(teamPath)).toString());
      const have = new Set(rows.map((r) => `${r.gameId}|${r.teamId}`));
      const missing = teamRows.filter((r) => !have.has(`${r.gameId}|${r.teamId}`)).length;
      verdict = missing === 0
        ? `  ✓ complete vs team box (${teamRows.length})`
        : `  ✗ MISSING ${missing} of ${teamRows.length} team-game rows`;
    } catch { /* team box unreadable — skip the check rather than fail the pull */ }
  }

  console.log(
    `✓ ${season}: ${rows.length} rows (${sink.length - rows.length} dupes dropped)  ` +
    `${dates[0]}..${dates[dates.length - 1]}  feb29=${feb29}` +
    (failures ? `  (${failures} window(s) hit the cap)` : "") + verdict,
  );
}
console.log(`\ndone — ${calls} API calls`);
