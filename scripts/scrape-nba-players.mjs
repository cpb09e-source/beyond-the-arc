/**
 * scrape-nba-players.mjs — pulls every player who appeared in a regular-season
 * NBA game from 2013 through 2026, using basketball-reference's per-season
 * totals pages. Output extends the draftees file with undrafted-but-played
 * cases (Fred VanVleet style).
 *
 * Strategy: we already have a fully-populated `public/data/nba-draftees.json`
 * (one entry per drafted player). This script ADDS entries for every player
 * who appeared in an NBA game but is NOT already in that file — marking them
 * with `pick: null` so the badge can still detect their NBA tenure.
 *
 * Output (in place merge):
 *   public/data/nba-draftees.json
 *     {
 *       "fred van vleet": { year: 2016, pick: null, team: "TOR", college: null },   ← new, undrafted
 *       "lj cryer":       { year: 2025, pick: 64, team: "...", college: "Houston" },← existing draftee
 *       ...
 *     }
 *   For undrafted entries: `year` = first NBA season they showed up in.
 *
 * Polite at 3.2s/page. 14 pages × 3.2s ≈ 45s wall-clock.
 *
 * Run: npm run scrape:nba-players
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const BR_BASE = "https://www.basketball-reference.com";
const OUT = path.resolve("public/data/nba-draftees.json");
const CACHE_DIR = path.resolve("scripts/.scrape-cache/nba-totals");

const UA = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html",
};

const MIN_INTERVAL_MS = 3200;
let lastFetchAt = 0;
async function throttledGet(url) {
  const wait = Math.max(0, lastFetchAt + MIN_INTERVAL_MS - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastFetchAt = Date.now();
  return fetch(url, { headers: UA });
}

function plainText(s) {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normName(s) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

async function fetchYear(year) {
  const cacheFile = path.join(CACHE_DIR, `${year}.html`);
  if (existsSync(cacheFile)) return await fs.readFile(cacheFile, "utf8");
  // The totals page; cleaner row schema than per_game.
  const res = await throttledGet(`${BR_BASE}/leagues/NBA_${year}_totals.html`);
  if (!res.ok) return null;
  const html = await res.text();
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(cacheFile, html);
  return html;
}

function parseSeason(html) {
  // SR wraps tables in HTML comments — strip them.
  const expanded = html.replace(/<!--([\s\S]*?)-->/g, "$1");
  const tableMatch = expanded.match(/<table[^>]+id="totals_stats"[\s\S]*?<\/table>/);
  if (!tableMatch) return [];
  const rows = [...tableMatch[0].matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/g)].map((m) => m[0]);
  const out = [];
  for (const row of rows) {
    if (/class="thead"/.test(row)) continue;
    // SR's newer schema uses `name_display` for the player name + the link is
    // inside an <a>. Their team column is `team_name_abbr`, games is `games`.
    const nameMatch = row.match(/data-stat="name_display"[^>]*>(?:<a[^>]*>)?([^<]+)/);
    if (!nameMatch) continue;
    const name = plainText(nameMatch[1]);
    if (!name || name === "Player" || name === "League Average") continue;
    const teamMatch = row.match(/data-stat="team_name_abbr"[^>]*>(?:<a[^>]*>)?([^<]+)/);
    const team = teamMatch ? plainText(teamMatch[1]) : null;
    const gamesMatch = row.match(/data-stat="games"[^>]*>(\d+)/);
    const games = gamesMatch ? parseInt(gamesMatch[1], 10) : 0;
    if (games < 1) continue;
    out.push({ name, team });
  }
  return out;
}

const YEARS = Array.from({ length: 14 }, (_, i) => 2013 + i); // 2013..2026

async function main() {
  // Load existing draftees so we preserve their richer fields (pick, college).
  let existing = {};
  if (existsSync(OUT)) {
    existing = JSON.parse(await fs.readFile(OUT, "utf8"));
  }
  console.log(`📂 ${Object.keys(existing).length} draftees already in lookup`);

  await fs.mkdir(path.dirname(OUT), { recursive: true });

  // Build a name → first-NBA-season map from the totals pages.
  const firstSeen = new Map(); // normName → { name, year, team }
  for (const year of YEARS) {
    process.stdout.write(`📅 ${year}… `);
    const html = await fetchYear(year);
    if (!html) {
      console.log("(no page)");
      continue;
    }
    const players = parseSeason(html);
    console.log(`${players.length} players`);
    for (const p of players) {
      const key = normName(p.name);
      if (!key) continue;
      const cur = firstSeen.get(key);
      if (!cur || year < cur.year) {
        firstSeen.set(key, { name: p.name, year, team: p.team });
      }
    }
  }

  // Merge: any player in firstSeen that's NOT already a draftee gets added
  // with pick=null. Drafted players stay as-is.
  let added = 0;
  for (const [key, p] of firstSeen) {
    if (existing[key]) continue;
    existing[key] = { year: p.year, pick: null, team: p.team, college: null };
    added++;
  }

  await fs.writeFile(OUT, JSON.stringify(existing));
  console.log(`\n✓ Added ${added} undrafted-but-played-in-NBA players`);
  console.log(`  Total lookup entries: ${Object.keys(existing).length}`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
