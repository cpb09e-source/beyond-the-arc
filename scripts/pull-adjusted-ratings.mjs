#!/usr/bin/env node
/**
 * pull-adjusted-ratings.mjs — CBBD opponent-adjusted efficiency ratings,
 * one request per season → data/cbbd/<season>/ratings-adjusted.json.gz
 *
 * WHY WE NEED AN ADJUSTED SOURCE AT ALL: BTA RTG is deliberately a TWO-SOURCE
 * composite. bta_ortg / bta_drtg average Bart Torvik's adjoe/adjde with a
 * second provider's adjusted ratings, and bta_rtg z-scores both pairs
 * independently before weighting (src/lib/team-filters.ts). That second
 * provider used to be CBB Analytics' ortg_adj/drtg_adj. Dropping to Bart alone
 * would have quietly turned the site's headline metric into a single-source
 * number and shifted every team's score.
 *
 * Adjusted ratings are the one thing in the migration that genuinely cannot be
 * recomputed from a box-score archive — they need the full opponent graph — so
 * this is a real endpoint call rather than a local aggregation.
 *
 * Cheap: 13 requests total, all seasons verified to return every D-I team.
 *
 * Usage: node scripts/pull-adjusted-ratings.mjs [--force]
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const API = "https://api.collegebasketballdata.com";
const ROOT = process.cwd();
const SEASONS = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
const FORCE = process.argv.includes("--force");

function loadEnvLocal() {
  try {
    for (const line of fs.readFileSync(path.resolve(".env.local"), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]+)"?\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch { /* rely on process env */ }
}
loadEnvLocal();
const KEY = process.env.CBBD_API_KEY;
if (!KEY) { console.error("✗ CBBD_API_KEY missing from .env.local"); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const season of SEASONS) {
  const fp = path.join(ROOT, "data/cbbd", String(season), "ratings-adjusted.json.gz");
  if (!FORCE && fs.existsSync(fp)) { console.log(`${season}: already archived`); continue; }
  const res = await fetch(`${API}/ratings/adjusted?season=${season}`, {
    headers: { Authorization: `Bearer ${KEY}`, accept: "application/json" },
  });
  if (!res.ok) { console.error(`${season}: HTTP ${res.status} — skipped`); continue; }
  const rows = await res.json();
  const rated = rows.filter((r) => typeof r.offensiveRating === "number").length;
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, zlib.gzipSync(JSON.stringify(rows)));
  console.log(`${season}: ${rows.length} teams (${rated} rated)`);
  await sleep(400);
}
console.log("\nDone.");
