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

/**
 * Set the first time CBBD rejects the key, and never cleared.
 *
 * A REJECTED KEY DOES NOT BECOME VALID ON THE NEXT SEASON. Without this the
 * run walks all 13 seasons, logs 13 identical 401s and exits 0, which reads as
 * success to anything downstream. Same failure the box pulls had — see the long
 * note above `fatalAuth` in pull-player-box-v2.mjs for the full account.
 */
let fatalAuth = null;
let failures = 0;

for (const season of seasons) {
  if (fatalAuth) break;
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
  if (r.status === 401 || r.status === 403) {
    fatalAuth = `HTTP ${r.status} — CBBD rejected CBBD_API_KEY`;
    console.error(
      `\n✗ ${season}: ${fatalAuth}. Nothing written.\n\n` +
      `  The key in .env.local is being rejected outright, so this is not a\n` +
      `  transient failure and no amount of retrying will help. CBBD revokes a\n` +
      `  key when the Patreon subscription lapses, and re-subscribing issues a\n` +
      `  NEW one. Get the current key from collegebasketballdata.com and\n` +
      `  replace CBBD_API_KEY in .env.local.\n`,
    );
    process.exitCode = 1;
    break;
  }
  if (!r.ok) {
    console.warn(`! ${season}: HTTP ${r.status}`);
    failures++;
    process.exitCode = 1;
    await sleep(PAUSE_MS);
    continue;
  }
  const all = await r.json();
  // A response that is not an array is an error object wearing a 200 — the
  // filter below would turn it into `[]` and write it out as a real file.
  if (!Array.isArray(all)) {
    console.warn(`! ${season}: response was not an array — nothing written`);
    failures++;
    process.exitCode = 1;
    await sleep(PAUSE_MS);
    continue;
  }
  // AP only. The Coaches Poll is a near-duplicate signal and showing two
  // numbers beside a team name would be noise, not information.
  const rows = all.filter((x) => x.pollType === "AP Top 25");
  // AN EMPTY PULL IS NOT A PULL. Writing `[]` is worse than writing nothing:
  // the `already pulled` guard at the top of this loop then refuses to try the
  // season again without --force, so one bad afternoon becomes permanent.
  //
  // A season that genuinely has no AP polls yet — a preseason run against a
  // year that has not started — lands here too, and the right answer is still
  // to write no file, because there is nothing to archive either way.
  if (rows.length === 0) {
    console.error(`✗ ${season}: 0 AP rows in ${all.length} returned rows — nothing written`);
    failures++;
    process.exitCode = 1;
    await sleep(PAUSE_MS);
    continue;
  }
  fs.writeFileSync(dst, zlib.gzipSync(JSON.stringify(rows)));
  const dates = [...new Set(rows.map((x) => String(x.pollDate).slice(0, 10)))].sort();
  console.log(
    `✓ ${season}: ${rows.length} AP rows across ${dates.length} polls  ` +
    `${dates[0] ?? "-"}..${dates[dates.length - 1] ?? "-"}`,
  );
  await sleep(PAUSE_MS);
}
// Exit non-zero if anything failed, so a caller that checks the code sees it.
// `process.exitCode` is already set at each failure; this only reports.
console.log(failures ? `\ndone, with ${failures} failed season(s).` : "\ndone.");
