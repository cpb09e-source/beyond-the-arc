#!/usr/bin/env node
/**
 * cbbd-repair-plays.mjs — backfill games missing from the plays-by-date archive.
 *
 * WHY: `/plays/date` doesn't just 504 on big slates — it also returns 200 with
 * a silently TRUNCATED slate. The 2024 and 2025 archives were ingested before
 * the per-game fallback existed and accepted whatever came back: 2024 covers
 * 3,394 of 6,243 log games (54%), 2025 covers 3,494 of 6,292 (56%). Saturdays
 * are the worst — 2024-04-06 (Final Four Saturday) archived ZERO games,
 * 2024-02-10 archived one. 2026 was ingested with the fallback and sits at
 * 99.4%.
 *
 * WHAT IT DOES: diff the games our game logs say were played against every
 * gameId present anywhere in the season's plays archive, fetch each missing
 * game individually via /plays/game/{id}, and write it into the file for its
 * ET date. All downstream PBP consumers (shot charts, second-chance, lineups)
 * glob the whole season directory and de-duplicate on play id, so they all
 * benefit and none of them care which file a game landed in.
 *
 * THE DIFF IS SEASON-WIDE, NOT PER-DATE, AND THAT MATTERS. The archive's file
 * stamps are the ingest's REQUEST date, which sits one day ahead of our ET
 * game_date for every game (checked: 6,517 of 6,517 in 2024 are off by exactly
 * +1). A per-date diff therefore matches nothing — it reported 0 of 6,243 games
 * present for 2024 when 3,394 were actually there, and would have re-fetched
 * every one of them, doubling the archive.
 *
 * Idempotent and resumable by construction: every run re-diffs the live
 * archive, so an interrupted run just has fewer missing games next time. No
 * state file, no skip markers. Games CBBD genuinely has no plays for come back
 * as empty arrays and would be re-requested every run — accepted cost, it's a
 * handful of calls.
 *
 * Usage: node scripts/cbbd-repair-plays.mjs --season 2024 [--dry]
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = process.cwd();
const API = "https://api.collegebasketballdata.com";
const PAUSE_MS = Number(process.env.CBBD_PAUSE_MS) || 1100;

// ---- env (same loader as cbbd-ingest.mjs) ----
try {
  const txt = fs.readFileSync(path.resolve(".env.local"), "utf8");
  for (const line of txt.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]+)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch { /* rely on process env */ }
const KEY = process.env.CBBD_API_KEY;
if (!KEY) { console.error("CBBD_API_KEY missing"); process.exit(1); }

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const seasonArg = args.indexOf("--season");
if (seasonArg < 0) { console.error("Usage: cbbd-repair-plays.mjs --season <year> [--dry]"); process.exit(1); }
const SEASON = Number(args[seasonArg + 1]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let calls = 0;
async function get(pathname) {
  const url = new URL(API + pathname);
  for (let attempt = 0; ; attempt++) {
    calls++;
    let res;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${KEY}`, accept: "application/json" }, signal: AbortSignal.timeout(45000) });
    } catch (e) {
      if (attempt >= 4) throw new Error(`network on ${url.pathname}: ${e.message}`);
      await sleep(2000 * (attempt + 1)); continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await sleep((res.status === 429 ? 4000 : 2500) * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} on ${url.pathname}`);
    return res.json();
  }
}

const writeGz = (fp, data) => fs.writeFileSync(fp, zlib.gzipSync(JSON.stringify(data)));
const readGz = (fp) => JSON.parse(zlib.gunzipSync(fs.readFileSync(fp)).toString());

// ---- build the ET-date → expected-game-ids map from our game logs ----
const logsFp = path.join(ROOT, `public/data/game-logs-by-year/${SEASON}.json`);
const logs = JSON.parse(fs.readFileSync(logsFp, "utf8"));
const expectedByDate = new Map(); // "2024-02-10" → Set<numeric gameId>
for (const g of logs) {
  if (!g.game_date) continue;
  const numeric = Number(String(g.game_id).split("-")[0]);
  if (!Number.isFinite(numeric)) continue;
  let set = expectedByDate.get(g.game_date);
  if (!set) { set = new Set(); expectedByDate.set(g.game_date, set); }
  set.add(numeric);
}

const dir = path.join(ROOT, "data/cbbd", String(SEASON));
fs.mkdirSync(dir, { recursive: true });

// ---- what the archive already holds, across every file in the season ----
const have = new Set();
for (const f of fs.readdirSync(dir).filter((n) => /^plays-\d{8}\.json\.gz$/.test(n))) {
  for (const p of readGz(path.join(dir, f))) have.add(p.gameId);
}

// ---- diff ----
const work = []; // { date, fp, missing: number[] }
let totalExpected = 0, totalPresent = 0;
for (const [date, expected] of [...expectedByDate].sort()) {
  const fp = path.join(dir, `plays-${date.replaceAll("-", "")}.json.gz`);
  const missing = [...expected].filter((id) => !have.has(id));
  totalExpected += expected.size;
  totalPresent += expected.size - missing.length;
  if (missing.length > 0) work.push({ date, fp, missing });
}

const totalMissing = work.reduce((s, w) => s + w.missing.length, 0);
console.log(
  `${SEASON}: ${totalPresent.toLocaleString()}/${totalExpected.toLocaleString()} log games present in plays archive — ` +
  `${totalMissing.toLocaleString()} to fetch across ${work.length} dates` +
  (DRY ? " (dry run, stopping)" : `, ~${Math.round((totalMissing * (PAUSE_MS + 400)) / 60000)} min at current pause`),
);
if (DRY || totalMissing === 0) process.exit(0);

// ---- fetch + merge, date by date ----
let fetched = 0, failed = 0, emptied = 0;
const t0 = Date.now();
for (const w of work) {
  const existing = fs.existsSync(w.fp) ? readGz(w.fp) : [];
  const added = [];
  for (const id of w.missing) {
    try {
      const p = await get(`/plays/game/${id}`);
      if (Array.isArray(p) && p.length > 0) added.push(...p);
      else emptied++;
      fetched++;
    } catch (e) {
      failed++;
      console.warn(`  ${w.date} game ${id}: ${e.message}`);
    }
    await sleep(PAUSE_MS);
  }
  if (added.length > 0) writeGz(w.fp, [...existing, ...added]);
  const done = fetched + failed;
  const rate = done / Math.max((Date.now() - t0) / 1000, 1);
  const eta = Math.round((totalMissing - done) / Math.max(rate, 0.01) / 60);
  console.log(
    `  ${w.date}: +${added.length.toLocaleString()} plays (${w.missing.length} games) ` +
    `· ${done}/${totalMissing} · ETA ${eta} min`,
  );
}

console.log(
  `\n✓ ${SEASON} repair done — ${fetched.toLocaleString()} games fetched ` +
  `(${emptied} had no plays upstream), ${failed} failed, ${calls.toLocaleString()} API calls`,
);
if (failed > 0) {
  console.log("Re-run to retry failures — the script re-diffs from the archive each time.");
  process.exit(1);
}
