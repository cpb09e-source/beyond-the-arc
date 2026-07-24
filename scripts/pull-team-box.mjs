#!/usr/bin/env node
/**
 * pull-team-box.mjs — lightweight pull of per-game TEAM box (/games/teams) for
 * seasons where we don't ingest play-by-play. Team ratings only need team +
 * opponent points/possessions per game, so this skips the heavy /plays pull
 * entirely — a whole season is a handful of monthly calls.
 *
 * Archives to the SAME shape/location the full ingest uses, so
 * build-team-ratings.mjs reads every season uniformly:
 *   data/cbbd/<season>/box-teams-<from>-<to>.json.gz
 *
 * Resumable (existing range files are skipped). Server-side key only.
 *
 * Usage:
 *   node scripts/pull-team-box.mjs --season 2015
 *   node scripts/pull-team-box.mjs --from 2008 --to 2023      (inclusive range of seasons)
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const API = "https://api.collegebasketballdata.com";
const OUT_ROOT = path.resolve("data/cbbd");
const PAUSE_MS = 1100;

for (const line of fs.readFileSync(path.resolve(".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]+)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const KEY = process.env.CBBD_API_KEY;
if (!KEY) { console.error("CBBD_API_KEY missing"); process.exit(1); }

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i > -1 ? args[i + 1] : null; };
const one = opt("season");
const seasons = one
  ? [Number(one)]
  : (() => { const a = Number(opt("from")), b = Number(opt("to")); const out = []; for (let s = a; s <= b; s++) out.push(s); return out; })();
if (!seasons.length || seasons.some((s) => !Number.isFinite(s))) { console.error("usage: --season 2015 | --from 2008 --to 2023"); process.exit(1); }

// Season = end-year (2015 = 2014-15). Pull Nov–Apr in monthly windows.
function windows(season) {
  const y0 = season - 1;
  return [
    [`${y0}-11-01`, `${y0}-11-30`],
    [`${y0}-12-01`, `${y0}-12-31`],
    [`${season}-01-01`, `${season}-01-31`],
    [`${season}-02-01`, `${season}-02-28`],
    [`${season}-03-01`, `${season}-03-31`],
    [`${season}-04-01`, `${season}-04-12`],
  ];
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(url) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(45000) });
      if (r.status === 429 || r.status >= 500) { await sleep(3000 * (attempt + 1)); continue; }
      if (!r.ok) return { error: r.status };
      return { data: await r.json() };
    } catch (e) { await sleep(2000 * (attempt + 1)); }
  }
  return { error: "retries" };
}

let calls = 0;
for (const season of seasons) {
  const dir = path.join(OUT_ROOT, String(season));
  fs.mkdirSync(dir, { recursive: true });
  let rows = 0;
  for (const [from, to] of windows(season)) {
    const dst = path.join(dir, `box-teams-${from.replace(/-/g, "")}-${to.replace(/-/g, "")}.json.gz`);
    if (fs.existsSync(dst)) { continue; }
    const url = `${API}/games/teams?season=${season}&startDateRange=${from}&endDateRange=${to}`;
    const { data, error } = await getJson(url);
    calls++;
    if (error) { console.warn(`  ✗ ${season} ${from}..${to}: ${error}`); await sleep(PAUSE_MS); continue; }
    fs.writeFileSync(dst, zlib.gzipSync(JSON.stringify(data)));
    rows += Array.isArray(data) ? data.length : 0;
    await sleep(PAUSE_MS);
  }
  console.log(`✓ ${season}: ${rows} team-game rows`);
}
console.log(`done — ${calls} API calls`);
