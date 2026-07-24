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
const WINDOWS = { 2024: ["2023-11-01", "2024-04-09"], 2025: ["2024-11-01", "2025-04-09"], 2026: ["2025-11-03", "2026-04-07"] };
const [FROM, TO] = WINDOWS[SEASON] || [];
if (!FROM) { console.error("usage: --season 2024|2025|2026"); process.exit(1); }

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
      if (!r.ok) { if (attempt) return `fail(${r.status})`; await sleep(2500); continue; }
      const data = await r.json();
      fs.writeFileSync(fp, zlib.gzipSync(JSON.stringify(data)));
      return `ok(${Array.isArray(data) ? data.length : 0})`;
    } catch (e) { if (attempt) return "fail(timeout)"; await sleep(2500); }
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
  await sleep(1200);
}
console.log(`\nseason ${SEASON}: +${got} pulled, ${skipped} already had, ${failed} failed`);
if (fails.length) console.log(`failed dates: ${fails.join(", ")}`);
