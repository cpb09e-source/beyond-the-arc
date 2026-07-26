#!/usr/bin/env node
/**
 * pull-rankings.mjs — CBBD's weekly polls into data/cbbd/<season>/rankings.json.gz
 *
 * Feeds the "ranked at the time" badge in the Win Calculator. Our existing
 * team-ratings files hold END-OF-SEASON ranks, which are the wrong thing to
 * show next to a game played in December: a team that finished 4th may have
 * been unranked when it lost that game.
 *
 * One request per season — the whole poll history is ~1.8k rows, well under
 * any row ceiling, so none of the windowing machinery the box pulls need
 * applies here.
 *
 * Server-side only — reads CBBD_API_KEY from .env.local, never bundled.
 *
 * Usage:
 *   node scripts/pull-rankings.mjs --season 2026
 *   node scripts/pull-rankings.mjs --from 2014 --to 2026 [--force]
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
if (!KEY) { console.error("CBBD_API_KEY missing from .env.local"); process.exit(1); }

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i > -1 ? args[i + 1] : null; };
const FORCE = args.includes("--force");
const one = opt("season");
const seasons = one
  ? [Number(one)]
  : (() => {
      const a = Number(opt("from")), b = Number(opt("to"));
      const out = []; for (let s = a; s <= b; s++) if (s !== 2021) out.push(s); return out;
    })();
if (!seasons.length || seasons.some((s) => !Number.isFinite(s))) {
  console.error("usage: --season 2026 | --from 2014 --to 2026 [--force]");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const season of seasons) {
  const dir = path.join(OUT_ROOT, String(season));
  fs.mkdirSync(dir, { recursive: true });
  const dst = path.join(dir, "rankings.json.gz");
  if (fs.existsSync(dst) && !FORCE) {
    console.log(`= ${season}: already pulled (use --force to redo)`);
    continue;
  }

  const r = await fetch(`${API}/rankings?season=${season}`, {
    headers: { Authorization: `Bearer ${KEY}` },
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) {
    console.warn(`! ${season}: HTTP ${r.status}`);
    await sleep(PAUSE_MS);
    continue;
  }
  const all = await r.json();
  // AP only. The Coaches Poll is a near-duplicate signal and showing two
  // numbers beside a team name would be noise, not information.
  const rows = (Array.isArray(all) ? all : []).filter((x) => x.pollType === "AP Top 25");
  fs.writeFileSync(dst, zlib.gzipSync(JSON.stringify(rows)));
  const dates = [...new Set(rows.map((x) => String(x.pollDate).slice(0, 10)))].sort();
  console.log(
    `✓ ${season}: ${rows.length} AP rows across ${dates.length} polls  ` +
    `${dates[0] ?? "-"}..${dates[dates.length - 1] ?? "-"}`,
  );
  await sleep(PAUSE_MS);
}
console.log("\ndone.");
