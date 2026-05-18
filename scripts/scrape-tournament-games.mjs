/**
 * scrape-tournament-games.mjs — fetches every NCAA Tournament bracket page on
 * Sports Reference (2013 → 2026) and parses each game into a structured row.
 *
 * Output:
 *   src/data/tournament-games.json
 *     {
 *       "2025": [
 *         { round: "R64", date: "2025-03-21",
 *           winner: { seed: 1, school: "Duke",  slug: "duke", score: 93 },
 *           loser:  { seed: 16, school: "Mount St. Mary's", slug: "mount-st-marys", score: 49 } },
 *         ...
 *       ],
 *       ...
 *     }
 *
 * Round inference uses the box-score date: the NCAA tournament has a fixed
 * weekly cadence (R64/R32 first weekend, S16/E8 second, F4/Final third), so
 * mapping the date's ordinal within the tournament's dates yields the round.
 *
 * Polite at 3.2s between requests. ~14 pages = ~45s wall-clock.
 *
 * Run: npm run scrape:tournament-games
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const SR_BASE = "https://www.sports-reference.com/cbb";
const DATA = path.resolve("src/data");
const CACHE_DIR = path.resolve("scripts/.scrape-cache/sr-tournament");
const OUT = path.join(DATA, "tournament-games.json");

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

async function fetchYear(year) {
  const cacheFile = path.join(CACHE_DIR, `${year}.html`);
  if (existsSync(cacheFile)) {
    return await fs.readFile(cacheFile, "utf8");
  }
  const res = await throttledGet(`${SR_BASE}/postseason/men/${year}-ncaa.html`);
  if (!res.ok) {
    console.warn(`  ${year}: HTTP ${res.status}, skipping`);
    return null;
  }
  const html = await res.text();
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(cacheFile, html);
  return html;
}

function plainText(s) {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse a single game block — extract the two team cells and the boxscore date.
 * SR inconsistently orders the cells (winner can be first OR second), so we
 * locate both team divs independently rather than assuming winner-first.
 */
function parseGame(block) {
  // Find every team cell: either `<div class="winner"> ... </div>` or a bare
  // `<div> ... </div>` containing a `<!-- team -->` marker.
  const teamBlocks = [];
  // Use a single regex with global flag to capture each top-level team div.
  const teamRe = /<div(?:\s+class="winner")?>\s*<!-- team -->([\s\S]*?)<\/div>/g;
  let m;
  while ((m = teamRe.exec(block)) !== null) {
    const isWinner = /<div\s+class="winner">/.test(m[0]);
    teamBlocks.push({ isWinner, html: m[1] });
    if (teamBlocks.length >= 2) break;
  }
  if (teamBlocks.length < 2) return null;
  const winnerCell = teamBlocks.find((t) => t.isWinner);
  const loserCell = teamBlocks.find((t) => !t.isWinner);
  if (!winnerCell || !loserCell) return null;
  const winner = parseTeamCell(winnerCell.html);
  const loser = parseTeamCell(loserCell.html);
  if (!winner || !loser) return null;

  const boxscoreMatch = block.match(/href="(\/cbb\/boxscores\/[^"]+)"/);
  const boxscore_url = boxscoreMatch ? boxscoreMatch[1] : null;
  const date = boxscoreMatch ? (boxscoreMatch[1].match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? null) : null;
  return { winner, loser, date, boxscore_url };
}

function parseTeamCell(html) {
  const seedMatch = html.match(/<span>\s*(\d+)\s*<\/span>/);
  const schoolMatch = html.match(/href="\/cbb\/schools\/([a-z0-9-]+)\/men\/\d+\.html"[^>]*>([^<]+)<\/a>/);
  const scoreMatch = html.match(/href="\/cbb\/boxscores\/[^"]+"[^>]*>(\d+)<\/a>/);
  if (!schoolMatch) return null;
  return {
    seed: seedMatch ? parseInt(seedMatch[1], 10) : null,
    slug: schoolMatch[1],
    school: plainText(schoolMatch[2]),
    score: scoreMatch ? parseInt(scoreMatch[1], 10) : null,
  };
}

/**
 * Map each unique game date to a round label. Strategy: sort all unique dates,
 * count games per date, and assign rounds by the standard NCAA bracket cadence.
 *
 *  - First Four:  Tue/Wed of opening week     (4 games on 1-2 days, before R64)
 *  - R64:         Thu/Fri of opening week     (32 games)
 *  - R32:         Sat/Sun of opening week     (16 games)
 *  - Sweet 16:    Thu/Fri of week 2           (8 games)
 *  - Elite Eight: Sat/Sun of week 2           (4 games)
 *  - Final Four:  Sat of week 3               (2 games)
 *  - Championship: Mon of week 3              (1 game)
 *
 * Robust approach: order dates ascending, accumulate game counts, and tag by
 * cumulative game-count tipping points (4 / 36 / 52 / 60 / 64 / 66 / 67).
 */
function buildDateRoundMap(games) {
  const dateMap = new Map(); // date → game count
  for (const g of games) {
    if (!g.date) continue;
    dateMap.set(g.date, (dateMap.get(g.date) ?? 0) + 1);
  }
  const dates = [...dateMap.keys()].sort();

  // Compute total games-by-day to detect First Four presence.
  let cumulative = 0;
  const cumulativeByDate = new Map();
  for (const d of dates) {
    cumulative += dateMap.get(d);
    cumulativeByDate.set(d, cumulative);
  }
  const total = cumulative;
  const hasFirstFour = total > 63; // 63 = 64-team bracket; >63 means First Four games included

  // Standard cumulative game counts AFTER each round, depending on First Four.
  // No First Four (63 games total): 32, 48, 56, 60, 62, 63
  // With First Four (67 games total): 4, 36, 52, 60, 64, 66, 67
  const dateRound = new Map();
  for (const d of dates) {
    const cum = cumulativeByDate.get(d);
    let round;
    if (hasFirstFour) {
      if (cum <= 4) round = "First Four";
      else if (cum <= 36) round = "R64";
      else if (cum <= 52) round = "R32";
      else if (cum <= 60) round = "Sweet 16";
      else if (cum <= 64) round = "Elite Eight";
      else if (cum <= 66) round = "Final Four";
      else round = "Champion";
    } else {
      if (cum <= 32) round = "R64";
      else if (cum <= 48) round = "R32";
      else if (cum <= 56) round = "Sweet 16";
      else if (cum <= 60) round = "Elite Eight";
      else if (cum <= 62) round = "Final Four";
      else round = "Champion";
    }
    dateRound.set(d, round);
  }
  return dateRound;
}

function parseBracket(html, year) {
  // Each game block lives inside a `<div class="round">`. We don't need the
  // round wrapper — we extract all winner/loser pairs in document order and
  // assign rounds by date.
  const games = [];
  // Game boundary marker is the "<!-- game -->" comment SR inserts.
  const segments = html.split("<!-- game -->").slice(1);
  for (const seg of segments) {
    // Each segment ends at the next "<!-- game -->" or a closing wrapper.
    // We only need the leading winner+loser+date — clip generously.
    const block = seg.slice(0, 2000);
    const g = parseGame(block);
    if (g) games.push({ year, ...g });
  }

  const dateRound = buildDateRoundMap(games);
  for (const g of games) g.round = g.date ? (dateRound.get(g.date) ?? null) : null;
  return games;
}

// --- main ---
const YEARS = [2013, 2014, 2015, 2016, 2017, 2018, 2019, 2021, 2022, 2023, 2024, 2025, 2026]; // 2020 = canceled (COVID)

async function main() {
  await fs.mkdir(DATA, { recursive: true });
  await fs.mkdir(CACHE_DIR, { recursive: true });

  const out = {};
  for (const year of YEARS) {
    console.log(`📅 ${year}…`);
    const html = await fetchYear(year);
    if (!html) continue;
    const games = parseBracket(html, year);
    console.log(`   ${games.length} games`);
    out[String(year)] = games;
  }

  await fs.writeFile(OUT, JSON.stringify(out, null, 2));
  console.log(`\n✓ Wrote ${OUT}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
