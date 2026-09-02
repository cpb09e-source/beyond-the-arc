#!/usr/bin/env node
/**
 * pull-team-box-v2.mjs — complete, verifiable pull of CBBD's per-game TEAM box
 * (/games/teams) into data/cbbd/<season>/box-teams-full.json.gz
 *
 * Replaces the fixed-window pull in pull-team-box.mjs, which had three defects
 * that silently lost real games:
 *
 *   1. LEAP DAY. Windows were hardcoded `<season>-02-01 .. <season>-02-28`, so
 *      every February 29 game was dropped: 33 team-rows in 2016, 274 in 2020,
 *      102 in 2024.
 *   2. THE 3000-ROW CAP. The endpoint returns at most 3000 rows per call with no
 *      pagination cursor and no error — it just stops. January 2021 and January
 *      2022 both came back at exactly 3000, i.e. truncated. Several other
 *      windows (Feb 2022 at 2988, Mar 2016 at 2982) were one game from the same
 *      fate.
 *   3. NO VERIFICATION. Nothing checked whether a window had hit the cap, so
 *      the loss was invisible.
 *
 * Fix: adaptive windowing. Start at 14 days; if a response comes back at (or
 * above) the cap, split the window in half and recurse until every response is
 * comfortably under it. Date maths uses real Date arithmetic, so leap days are
 * included by construction. The pull then asserts no window ended at the cap.
 *
 * Output is one deduped file per season keyed on (gameId, teamId), which also
 * removes the overlap duplicates the old windowed files contained.
 *
 * Server-side only — reads CBBD_API_KEY from .env.local, never bundled.
 *
 * Usage:
 *   node scripts/pull-team-box-v2.mjs --season 2024
 *   node scripts/pull-team-box-v2.mjs --from 2014 --to 2026
 *   node scripts/pull-team-box-v2.mjs --from 2014 --to 2026 --force
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const API = "https://api.collegebasketballdata.com";
const OUT_ROOT = path.resolve("data/cbbd");
const PAUSE_MS = 1100;
/** Hard server-side row ceiling per response — measured, not documented. */
const ROW_CAP = 3000;
/** Treat anything this close to the ceiling as suspect and split anyway. */
const SAFE_ROWS = 2600;
const MIN_WINDOW_DAYS = 3;
/**
 * Days of overlap added to BOTH ends of every window.
 *
 * The endpoint truncates the first and last calendar day of a range: querying
 * 2015-11-01..2015-11-14 returns 86 rows dated 11-14, while 2015-11-01..11-30
 * returns 318 rows for that same day. The boundary day is only partially
 * served, and the effect is invisible — no error, no flag. Almost certainly a
 * timezone edge in their date filter (games tipping late local time land on the
 * next UTC day).
 *
 * So: never let a date we care about sit on a window edge. Each window is
 * padded outward, which makes every real date interior to at least one request,
 * and the (gameId, teamId) dedupe absorbs the repeats for free.
 */
const OVERLAP_DAYS = 3;

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

/**
 * Set by the first 401/403, and never cleared. Same guard, same reason as
 * pull-player-box-v2.mjs — see the long note there.
 *
 * It matters MORE here. This file writes box-teams-full.json.gz, which is the
 * expected-row set the player pull checks its own completeness against. An
 * empty team box does not just lose this season, it makes the player pull's
 * verdict read "complete vs team box (0)" and pass.
 */
let fatalAuth = null;

async function getJson(url) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${KEY}` },
        signal: AbortSignal.timeout(60000),
      });
      calls++;
      if (r.status === 429 || r.status >= 500) { await sleep(3000 * (attempt + 1)); continue; }
      if (r.status === 401 || r.status === 403) {
        fatalAuth = `HTTP ${r.status} — CBBD rejected CBBD_API_KEY`;
        return { error: fatalAuth };
      }
      if (!r.ok) return { error: `HTTP ${r.status}` };
      return { data: await r.json() };
    } catch {
      await sleep(2000 * (attempt + 1));
    }
  }
  return { error: "retries exhausted" };
}

/**
 * Fetch [from, to] inclusive, splitting whenever a response looks capped.
 * Pushes into `sink`; returns the number of windows that could not be split
 * far enough (should always be 0).
 */
async function fetchRange(season, from, to, sink, depth = 0) {
  // Unwind the recursion the moment auth dies rather than splitting windows
  // that are all going to be rejected the same way.
  if (fatalAuth) return 1;
  // Pad outward so the days we actually want are never on the edge (see
  // OVERLAP_DAYS). Requesting beyond the season is harmless — the `season`
  // parameter already scopes the result set.
  const qFrom = addDays(from, -OVERLAP_DAYS);
  const qTo = addDays(to, OVERLAP_DAYS);
  const url = `${API}/games/teams?season=${season}&startDateRange=${iso(qFrom)}&endDateRange=${iso(qTo)}`;
  const { data, error } = await getJson(url);
  await sleep(PAUSE_MS);
  if (error) {
    console.warn(`    ! ${iso(from)}..${iso(to)}: ${error}`);
    return 1;
  }
  const rows = Array.isArray(data) ? data : [];
  const span = dayDiff(from, to);

  // Capped (or close enough to be untrustworthy) → split and recurse.
  if (rows.length >= SAFE_ROWS && span > MIN_WINDOW_DAYS) {
    const mid = addDays(from, Math.floor(span / 2));
    const a = await fetchRange(season, from, mid, sink, depth + 1);
    const b = await fetchRange(season, addDays(mid, 1), to, sink, depth + 1);
    return a + b;
  }
  if (rows.length >= ROW_CAP) {
    console.warn(`    ! ${iso(from)}..${iso(to)} still at cap (${rows.length}) at 1-day granularity`);
    sink.push(...rows);
    return 1;
  }
  sink.push(...rows);
  return 0;
}

for (const season of seasons) {
  const dir = path.join(OUT_ROOT, String(season));
  fs.mkdirSync(dir, { recursive: true });
  const dst = path.join(dir, "box-teams-full.json.gz");
  if (fs.existsSync(dst) && !FORCE) {
    console.log(`= ${season}: already pulled (use --force to redo)`);
    continue;
  }

  // Nov 1 → Apr 15 covers every regular season plus the full postseason.
  // Real Date arithmetic, so Feb 29 is included in leap years automatically.
  const seasonStart = new Date(Date.UTC(season - 1, 10, 1));
  const seasonEnd = new Date(Date.UTC(season, 3, 15));

  const sink = [];
  let failures = 0;
  let cursor = seasonStart;
  while (cursor <= seasonEnd && !fatalAuth) {
    const end = addDays(cursor, 13) > seasonEnd ? seasonEnd : addDays(cursor, 13);
    failures += await fetchRange(season, cursor, end, sink);
    cursor = addDays(end, 1);
  }

  if (fatalAuth) {
    console.error(
      `
✗ ${season}: ${fatalAuth}. Nothing written.

` +
      `  CBBD revokes a key when the Patreon subscription lapses, and
` +
      `  re-subscribing issues a NEW one — an active subscription does not
` +
      `  revive the old string. Replace CBBD_API_KEY in .env.local.
`,
    );
    process.exitCode = 1;
    break;
  }

  // Dedupe — split windows share no dates, but overlapping retries can repeat.
  const seen = new Set();
  const rows = [];
  for (const r of sink) {
    const k = `${r.gameId}|${r.teamId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    rows.push(r);
  }

  // An empty pull is a failed pull. Writing `[]` here would poison the file the
  // player pull verifies against, AND trip the "already pulled" guard so the
  // season could not be retried without --force.
  if (rows.length === 0) {
    console.error(
      `
✗ ${season}: pulled 0 rows from ${failures} failed window(s). Nothing written.
` +
      `  Existing data for this season is untouched.
`,
    );
    process.exitCode = 1;
    continue;
  }

  fs.writeFileSync(dst, zlib.gzipSync(JSON.stringify(rows)));
  const dates = rows.map((r) => new Date(r.startDate).toISOString().slice(0, 10)).sort();
  const feb29 = rows.filter((r) => new Date(r.startDate).toISOString().slice(5, 10) === "02-29").length;
  console.log(
    `✓ ${season}: ${rows.length} rows (${sink.length - rows.length} dupes dropped)  ` +
    `${dates[0]}..${dates[dates.length - 1]}  feb29=${feb29}` +
    (failures ? `  ⚠ ${failures} window(s) failed` : ""),
  );
}
console.log(`\ndone — ${calls} API calls`);
