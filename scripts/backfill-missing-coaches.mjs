/**
 * backfill-missing-coaches.mjs — one-off: fetch the 4 D-I teams that the
 * historical scraper left empty (Illinois, Alabama, North Dakota, Delaware)
 * and merge their year-by-year coach data into src/data/coach-history.json.
 *
 * Used after the resolver fix in snapshot-historical-coaches.mjs went in.
 * This script doesn't need Supabase env vars — slugs are hard-coded since we
 * already know which teams have the gap.
 *
 * Polite at 3.2s between SR requests (4 teams = ~13 seconds total).
 *
 * Run: node scripts/backfill-missing-coaches.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";

const SR_BASE = "https://www.sports-reference.com/cbb";
const OUT = path.resolve("src/data/coach-history.json");
const CACHE_DIR = path.resolve("scripts/.scrape-cache/sr-coach-history");

const UA = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

const MIN_INTERVAL_MS = 3200;
let lastFetchAt = 0;
async function throttledGet(url) {
  const wait = Math.max(0, lastFetchAt + MIN_INTERVAL_MS - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastFetchAt = Date.now();
  return fetch(url, { headers: UA });
}

// Bart team name → SR slug. Hard-coded for this one-off; verified manually
// against SR's school index at https://www.sports-reference.com/cbb/schools/
const TARGETS = [
  { bartName: "Illinois",     slug: "illinois" },
  { bartName: "Alabama",      slug: "alabama" },
  { bartName: "North Dakota", slug: "north-dakota" },
  { bartName: "Delaware",     slug: "delaware" },
];

// Tournament-round parser — mirrors the main scraper exactly so output shape
// matches existing data in coach-history.json.
function parseTourneyRound(roundCellText) {
  const t = roundCellText.trim();
  if (!t) return null;
  if (/^Won\s+NCAA\s+Tournament/i.test(t) || /National Champion/i.test(t)) return "Champion";
  if (/National Final/i.test(t) || /Championship Game/i.test(t)) return "Runner-up";
  if (/National Semifinal/i.test(t) || /Final Four/i.test(t)) return "Final Four";
  if (/Regional Final/i.test(t) || /Elite Eight/i.test(t) || /Fifth Round/i.test(t)) return "Elite Eight";
  if (/Regional Semifinal/i.test(t) || /Sweet Sixteen/i.test(t) || /Sweet 16/i.test(t) || /Fourth Round/i.test(t)) return "Sweet 16";
  if (/Third Round/i.test(t)) return "R32";
  if (/Second Round/i.test(t)) return "R32";
  if (/First Round/i.test(t)) return "R64";
  if (/First Four/i.test(t)) return "First Four";
  return null;
}

function parseSchoolHistory(html) {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)];
  const out = [];
  for (const m of rows) {
    const row = m[1];
    const yearMatch = row.match(/data-stat="season"[^>]*>(?:<a[^>]*>)?(\d{4})-\d{2}/);
    if (!yearMatch) continue;
    const winsMatch = row.match(/data-stat="wins"[^>]*>(\d+)/);
    const lossesMatch = row.match(/data-stat="losses"[^>]*>(\d+)/);
    const confWinsMatch = row.match(/data-stat="wins_conf"[^>]*>(\d+)/);
    const confLossesMatch = row.match(/data-stat="losses_conf"[^>]*>(\d+)/);
    const confAbbrMatch = row.match(/data-stat="conf_abbr"[^>]*>(?:<a[^>]*>)?([^<]+)/);
    const coachMatch = row.match(/data-stat="coaches"[^>]*>(?:<a href="\/cbb\/coaches\/([a-z0-9.-]+)\.html">)?([^<]+)/);
    if (!coachMatch) continue;
    const seedMatch = row.match(/data-stat="seed"[^>]*>(\d+)\s*</);
    const roundCellMatch = row.match(/data-stat="round_max"[^>]*>([\s\S]*?)<\/td>/);
    const roundText = roundCellMatch ? roundCellMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
    const round = parseTourneyRound(roundText);
    const seasonEnd = parseInt(yearMatch[1], 10) + 1;
    out.push({
      year: seasonEnd,
      name: coachMatch[2].trim(),
      slug: coachMatch[1] ?? null,
      wins: winsMatch ? parseInt(winsMatch[1], 10) : null,
      losses: lossesMatch ? parseInt(lossesMatch[1], 10) : null,
      conf: confAbbrMatch ? confAbbrMatch[1].trim() : null,
      conf_wins: confWinsMatch ? parseInt(confWinsMatch[1], 10) : null,
      conf_losses: confLossesMatch ? parseInt(confLossesMatch[1], 10) : null,
      seed: seedMatch ? parseInt(seedMatch[1], 10) : null,
      round,
    });
  }
  return out;
}

const YEAR_SET = new Set([2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]);

async function main() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const history = JSON.parse(await fs.readFile(OUT, "utf8"));

  for (const { bartName, slug } of TARGETS) {
    const existing = history[bartName] && Object.keys(history[bartName]).length;
    if (existing) {
      console.log(`▶ ${bartName} already has ${existing} seasons — skipping`);
      continue;
    }
    console.log(`▶ Fetching ${bartName} (slug: ${slug})…`);
    const url = `${SR_BASE}/schools/${slug}/men/`;
    const res = await throttledGet(url);
    if (!res.ok) {
      console.log(`   ⚠ HTTP ${res.status} for ${url} — skipping`);
      continue;
    }
    const html = await res.text();
    await fs.writeFile(path.join(CACHE_DIR, `${slug}.html`), html);
    const seasons = parseSchoolHistory(html);
    const inRange = seasons.filter((s) => YEAR_SET.has(s.year));
    if (inRange.length === 0) {
      console.log(`   ⚠ Parsed 0 in-range seasons — skipping`);
      continue;
    }
    history[bartName] = {};
    for (const s of inRange) {
      history[bartName][String(s.year)] = {
        name: s.name,
        slug: s.slug,
        wins: s.wins,
        losses: s.losses,
        conf: s.conf,
        conf_wins: s.conf_wins,
        conf_losses: s.conf_losses,
        seed: s.seed,
        round: s.round,
      };
    }
    const coaches = [...new Set(inRange.map((s) => s.name))];
    console.log(`   ✓ ${inRange.length} seasons (${coaches.length} coach${coaches.length > 1 ? "es" : ""}): ${coaches.join(", ")}`);
  }

  await fs.writeFile(OUT, JSON.stringify(history, null, 2));
  console.log(`\nWritten to ${path.relative(process.cwd(), OUT)}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
