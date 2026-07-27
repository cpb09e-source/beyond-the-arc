/**
 * cbbd-ingest.mjs — pull college basketball play-by-play + box data from the
 * CollegeBasketballData.com API (CBBD) and archive it raw to disk. This is the
 * data backbone for BTA EPM / OFF EPM / DEF EPM and the defensive ratings.
 *
 * Design:
 *   - Date-driven: one `/plays/date` call returns EVERY play in the slate, each
 *     play carrying `onFloor` (players on court) — stints derive from this, no
 *     per-game substitution calls needed. Plus `/games` (+ `/games/teams`,
 *     `/games/players` box) per date range. ~3-5 calls per slate → a full-season
 *     backfill is only a few hundred calls.
 *   - Raw archive, compute elsewhere: everything lands gzipped under
 *     data/cbbd/<season>/ exactly as received (plays-YYYYMMDD.json.gz etc.).
 *     We never re-pull history (CBBD terms can change; archive is ours), and the
 *     metric pipeline (Python: stints → ridge RAPM → EPM) reads these files —
 *     no database needed for a nightly batch.
 *   - Resumable: a date whose archive file already exists is skipped, so re-runs
 *     after a failure cost nothing. --force re-pulls.
 *
 * Usage:
 *   node scripts/cbbd-ingest.mjs --date 2026-02-14              (one slate)
 *   node scripts/cbbd-ingest.mjs --from 2025-11-03 --to 2026-04-07   (backfill)
 *   node scripts/cbbd-ingest.mjs --season 2026                  (whole season window)
 *   Flags: --force (re-pull existing), --dry (list planned calls only)
 *
 * Auth: CBBD_API_KEY in .env.local (Bearer). Key is server-side ONLY — never
 * ship it client-side (CBBD terms) and never commit it.
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

// ---- config ----
const API = "https://api.collegebasketballdata.com";
const OUT_ROOT = path.resolve("data/cbbd");
// Season window: Bart-style end-year key. 2026 = 2025-26 (Nov 3 – Apr 7 covers
// opening night through the title game with margin).
const SEASON_WINDOWS = {
  2024: ["2023-11-01", "2024-04-09"],
  2025: ["2024-11-01", "2025-04-09"],
  2026: ["2025-11-03", "2026-04-07"],
  2027: ["2026-11-02", "2027-04-06"],
};
// Seasons before 2024 were never play-by-play ingested (we only archived the
// box endpoints). Nov 1 → Apr 9 brackets every season's opening night and
// title game with margin, so a generated window is safe for the backfill.
// NOTE: CBBD serves plays back to 2014, but `onFloor` is empty and there are
// no substitution events before 2024 — lineups/RAPM are impossible pre-2024.
// The backfill exists for possession reconstruction (second-chance points),
// which only needs the Offensive Rebound + scoring events, both present.
function windowFor(season) {
  if (SEASON_WINDOWS[season]) return SEASON_WINDOWS[season];
  if (season >= 2014 && season <= 2023) return [`${season - 1}-11-01`, `${season}-04-09`];
  return [];
}
const PAUSE_MS = Number(process.env.CBBD_PAUSE_MS) || 1100; // courtesy gap; raise via env to avoid 502s on big historical slates

// ---- env ----
function loadEnvLocal() {
  try {
    const txt = fs.readFileSync(path.resolve(".env.local"), "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]+)"?\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch { /* no .env.local — rely on process env */ }
}
loadEnvLocal();
const KEY = process.env.CBBD_API_KEY;

// ---- args ----
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i > -1 ? args[i + 1] : null; };
const FORCE = flag("force"), DRY = flag("dry");
// --plays-only skips the box-score range pulls. The 2014-2023 seasons already
// have their box archived as `box-teams-full.json.gz` / `box-players-full.json.gz`
// (pulled by pull-team-box-v2 / pull-player-box-v2, which handle the silent
// row caps those endpoints have). Re-pulling here would write a second copy
// under range-stamped names AND silently truncate at the cap. Plays only.
const PLAYS_ONLY = flag("plays-only");

function* dateRange(from, to) {
  const d = new Date(`${from}T12:00:00Z`), end = new Date(`${to}T12:00:00Z`);
  while (d <= end) {
    yield d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

// ---- fetch ----
let calls = 0;
async function get(pathname, params = {}) {
  const url = new URL(API + pathname);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
  // Retry 5xx (big historical slates time out under load) and 429 (burst
  // throttle) with exponential backoff. Only a genuinely persistent failure
  // after several tries bubbles up to the per-date catch.
  for (let attempt = 0; ; attempt++) {
    calls++;
    let res;
    try {
      // Hard timeout — some big historical slates hang open without ever
      // responding; abort + retry rather than block the whole run forever.
      res = await fetch(url, { headers: { Authorization: `Bearer ${KEY}`, accept: "application/json" }, signal: AbortSignal.timeout(45000) });
    } catch (e) {
      if (attempt >= 4) throw new Error(`network on ${url.pathname}${url.search}: ${e.message}`);
      await sleep(2000 * (attempt + 1)); continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await sleep((res.status === 429 ? 4000 : 2500) * (attempt + 1));
      continue;
    }
    if (res.status === 429) throw new Error(`429 rate-limited on ${pathname} — stop and check quota`);
    if (!res.ok) throw new Error(`${res.status} on ${url.pathname}${url.search}`);
    return res.json();
  }
}

function writeGz(fp, data) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, zlib.gzipSync(JSON.stringify(data)));
}
const readGz = (fp) => JSON.parse(zlib.gunzipSync(fs.readFileSync(fp)).toString());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Season key for a date (end-year: Nov-Dec belong to the following year's key).
const seasonOf = (date) => {
  const [y, m] = date.split("-").map(Number);
  return m >= 8 ? y + 1 : y;
};

async function ingestDate(date) {
  const season = seasonOf(date);
  const dir = path.join(OUT_ROOT, String(season));
  const stamp = date.replace(/-/g, "");
  const playsFp = path.join(dir, `plays-${stamp}.json.gz`);
  if (!FORCE && fs.existsSync(playsFp)) return { date, skipped: true };
  if (DRY) { console.log(`  would pull ${date}`); return { date, dry: true }; }

  // 1. Every play in the slate (carries onFloor + participants + shotInfo).
  // utcOffset pins the date bucket to ET so a 7pm tip doesn't also appear in
  // the next UTC day's pull (stint builder dedupes by gameId regardless).
  const plays = await get("/plays/date", { date, utcOffset: -5 });
  await sleep(PAUSE_MS);
  if (!Array.isArray(plays) || plays.length === 0) {
    // Off day — write an empty marker so resume skips it.
    writeGz(playsFp, []);
    return { date, games: 0, plays: 0 };
  }
  writeGz(playsFp, plays);
  const gameIds = new Set(plays.map((p) => p.gameId));
  return { date, games: gameIds.size, plays: plays.length };
}

// Box scores pull in date-range chunks (fewer calls than per-date).
async function ingestBoxRange(from, to) {
  const season = seasonOf(to);
  const dir = path.join(OUT_ROOT, String(season));
  const stamp = `${from.replace(/-/g, "")}-${to.replace(/-/g, "")}`;
  const range = { startDateRange: from, endDateRange: to };
  for (const [name, pathName] of [
    ["games", "/games"],
    ["box-teams", "/games/teams"],
    ["box-players", "/games/players"],
  ]) {
    const fp = path.join(dir, `${name}-${stamp}.json.gz`);
    if (!FORCE && fs.existsSync(fp)) continue;
    if (DRY) { console.log(`  would pull ${pathName} ${from}..${to}`); continue; }
    writeGz(fp, await get(pathName, range));
    await sleep(PAUSE_MS);
  }
}

async function main() {
  if (!KEY && !DRY) {
    console.error("✗ CBBD_API_KEY missing — add it to .env.local (CBBD_API_KEY=...)");
    process.exit(1);
  }

  let from = opt("from"), to = opt("to");
  const one = opt("date"), season = opt("season");
  if (one) { from = one; to = one; }
  else if (season) { [from, to] = windowFor(Number(season)) ?? []; }
  if (!from || !to) {
    console.error("usage: --date YYYY-MM-DD | --from A --to B | --season 2026");
    process.exit(1);
  }

  console.log(`🏀 CBBD ingest ${from} → ${to}${DRY ? " (dry run)" : ""}`);
  let games = 0, plays = 0, skipped = 0, pulled = 0;
  for (const date of dateRange(from, to)) {
    try {
      const r = await ingestDate(date);
      if (r.skipped) { skipped++; continue; }
      pulled++;
      games += r.games ?? 0; plays += r.plays ?? 0;
      process.stdout.write(`\r  ${date}: ${r.games ?? 0} games (${calls} calls total)   `);
    } catch (e) {
      console.error(`\n  ✗ ${date}: ${e.message}`);
      if (String(e.message).startsWith("429")) process.exit(2);
    }
  }
  // Box in ~2-week chunks.
  const dates = PLAYS_ONLY ? [] : [...dateRange(from, to)];
  for (let i = 0; i < dates.length; i += 14) {
    const a = dates[i], b = dates[Math.min(i + 13, dates.length - 1)];
    try { await ingestBoxRange(a, b); } catch (e) { console.error(`  ✗ box ${a}..${b}: ${e.message}`); }
  }
  console.log(`\n✓ done — ${pulled} slates pulled, ${skipped} already archived, ${games} games, ${plays.toLocaleString()} plays, ${calls} API calls`);
}

main().catch((e) => { console.error(e); process.exit(1); });
