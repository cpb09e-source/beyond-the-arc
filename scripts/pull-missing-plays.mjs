#!/usr/bin/env node
/**
 * pull-missing-plays.mjs — targeted, fail-fast puller for the plays-*.json.gz
 * files a season is missing (the sequential ingest gets wedged retrying one
 * hanging historical slate; this skips hangs and grabs everything that answers).
 *
 * Only pulls /plays/date (stints read plays); team box comes from
 * pull-team-box.mjs. Short per-date timeout, one quick retry, then move on.
 *
 * Run: node scripts/pull-missing-plays.mjs --season 2024
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

for (const line of fs.readFileSync(path.resolve(".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]+)"?\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const KEY = process.env.CBBD_API_KEY;
const API = "https://api.collegebasketballdata.com";
const args = process.argv.slice(2);
const SEASON = args[args.indexOf("--season") + 1];
/**
 * Season → [first date, last date] to walk.
 *
 * SPARSE ON PURPOSE. Only seasons that have needed a targeted re-pull are
 * here; a season absent from this map is one nobody has had to repair, not one
 * that cannot be. Add its window when it does.
 *
 * 2021 is the COVID season and opens a month later than its neighbours — first
 * game 2020-11-25, against 2023-11-01 for 2024 — so the usual November 1 start
 * would spend three weeks of requests on empty days. Bounds are padded a few
 * days either side of the measured range (2020-11-25 to 2021-04-06, from
 * box-players-full.json.gz): an empty date costs one cheap response, a missing
 * date costs a gap nobody notices.
 */
const WINDOWS = {
  2021: ["2020-11-20", "2021-04-10"],
  2024: ["2023-11-01", "2024-04-09"],
  2025: ["2024-11-01", "2025-04-09"],
  2026: ["2025-11-03", "2026-04-07"],
};
const [FROM, TO] = WINDOWS[SEASON] || [];
if (!FROM) { console.error(`usage: --season ${Object.keys(WINDOWS).join("|")}`); process.exit(1); }

/** Set by the first 401/403; stops the walk rather than repeating it per date. */
let fatalAuth = null;

const dir = path.resolve("data/cbbd", String(SEASON));
fs.mkdirSync(dir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function* dateRange(from, to) {
  const d = new Date(`${from}T12:00:00Z`), end = new Date(`${to}T12:00:00Z`);
  while (d <= end) { yield d.toISOString().slice(0, 10); d.setUTCDate(d.getUTCDate() + 1); }
}
async function pullDate(date) {
  const fp = path.join(dir, `plays-${date.replace(/-/g, "")}.json.gz`);
  if (fs.existsSync(fp)) return "skip";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(`${API}/plays/date?date=${date}&utcOffset=-5`, {
        headers: { Authorization: `Bearer ${KEY}`, accept: "application/json" },
        signal: AbortSignal.timeout(25000),
      });
      // A rejected key does not become valid on the next date. Without this the
      // run walks 140 days logging 140 identical auth failures — the same
      // defect fixed in pull-player-box-v2.mjs and pull-team-box-v2.mjs.
      if (r.status === 401 || r.status === 403) {
        fatalAuth = `HTTP ${r.status} — CBBD rejected CBBD_API_KEY`;
        return `fail(${r.status})`;
      }
      if (!r.ok) { if (attempt) return `fail(${r.status})`; await sleep(2500); continue; }
      const data = await r.json();
      fs.writeFileSync(fp, zlib.gzipSync(JSON.stringify(data)));
      return `ok(${Array.isArray(data) ? data.length : 0})`;
    } catch { if (attempt) return "fail(timeout)"; await sleep(2500); }
  }
  return "fail";
}

let got = 0, failed = 0, skipped = 0;
const fails = [];
for (const date of dateRange(FROM, TO)) {
  const res = await pullDate(date);
  if (res === "skip") { skipped++; continue; }
  if (res.startsWith("ok")) { got++; console.log(`  ✓ ${date} ${res}`); }
  else { failed++; fails.push(date); console.log(`  ✗ ${date} ${res}`); }
  if (fatalAuth) break;
  await sleep(1200);
}
console.log(`\nseason ${SEASON}: +${got} pulled, ${skipped} already had, ${failed} failed`);
if (fails.length) console.log(`failed dates: ${fails.join(", ")}`);

/**
 * A FAILED DATE IS A FAILED RUN. This printed its failures and exited 0, so a
 * caller reading $? saw success and the chain would carry on building an index
 * over days it does not have. Same defect, same fix, as the two box pulls.
 *
 * Re-running is the repair: every file already on disk is skipped, so a second
 * pass retries only the dates that failed and costs nothing for the rest.
 */
if (fatalAuth) {
  console.error(`\n✗ ${fatalAuth}\n  Replace CBBD_API_KEY in .env.local. The walk stopped at the first rejection.\n`);
  process.exitCode = 1;
} else if (failed > 0) {
  console.error(`\n✗ ${failed} date(s) did not come back. Re-run to retry just those.\n`);
  process.exitCode = 1;
}
