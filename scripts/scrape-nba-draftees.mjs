/**
 * scrape-nba-draftees.mjs — pulls every player drafted into the NBA from
 * basketball-reference.com's NBA Draft pages (2013-2025) and writes a slim
 * lookup we can match against college box scores. Used by the box-score modal
 * to render a tiny NBA badge next to drafted players.
 *
 * Output:
 *   public/data/nba-draftees.json
 *     {
 *       "<normalized player name>": { year: 2018, pick: 7, team: "CHI", college: "Duke" },
 *       ...
 *     }
 *
 * Polite at 3.2s per page. 13 pages → ~45s.
 *
 * Run: npm run scrape:nba-draftees
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const BR_BASE = "https://www.basketball-reference.com";
const OUT = path.resolve("public/data/nba-draftees.json");
const CACHE_DIR = path.resolve("scripts/.scrape-cache/nba-draft");

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

/**
 * Normalize a player name for cross-source matching: lowercase, strip
 * accents/punctuation, collapse whitespace. "J'Wan Roberts" → "j wan roberts".
 */
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
  const res = await throttledGet(`${BR_BASE}/draft/NBA_${year}.html`);
  if (!res.ok) return null;
  const html = await res.text();
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(cacheFile, html);
  return html;
}

function parseDraftPage(html, year) {
  // SR wraps tables in HTML comments to dodge bots — expand them first.
  const expanded = html.replace(/<!--([\s\S]*?)-->/g, "$1");
  const tableMatch = expanded.match(/<table[^>]+id="stats"[\s\S]*?<\/table>/);
  if (!tableMatch) return [];
  const out = [];
  const rows = [...tableMatch[0].matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/g)].map((m) => m[0]);
  for (const row of rows) {
    if (/class="thead"/.test(row)) continue;
    // SR's draft tables use `pick_overall` for the pick number and
    // `college_name` for the college (different from the school index pages).
    const pickMatch = row.match(/data-stat="pick_overall"[^>]*>(?:<a[^>]*>)?(\d+)/);
    const playerMatch = row.match(/data-stat="player"[^>]*>(?:<a[^>]*>)?([^<]+)/);
    if (!playerMatch) continue;
    const name = plainText(playerMatch[1]);
    if (!name || /Round|Player/i.test(name)) continue;
    const teamMatch = row.match(/data-stat="team_id"[^>]*>(?:<a[^>]*>)?([^<]+)/);
    const collegeMatch = row.match(/data-stat="college_name"[^>]*>(?:<a[^>]*>)?([^<]+)/);
    out.push({
      name,
      year,
      pick: pickMatch ? parseInt(pickMatch[1], 10) : null,
      team: teamMatch ? plainText(teamMatch[1]) : null,
      college: collegeMatch ? plainText(collegeMatch[1]) : null,
    });
  }
  return out;
}

const YEARS = Array.from({ length: 14 }, (_, i) => 2013 + i); // 2013..2026 (2026 future-proof)

async function main() {
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  const draftees = {};
  for (const year of YEARS) {
    process.stdout.write(`📅 ${year}… `);
    const html = await fetchYear(year);
    if (!html) {
      console.log("(no page)");
      continue;
    }
    const picks = parseDraftPage(html, year);
    console.log(`${picks.length} picks`);
    for (const p of picks) {
      const key = normName(p.name);
      // First entry wins — collisions are usually different players with same
      // name, but the earlier draftee is more relevant for tournament games
      // 2013-2026.
      if (!draftees[key]) draftees[key] = { year: p.year, pick: p.pick, team: p.team, college: p.college };
    }
  }
  await fs.writeFile(OUT, JSON.stringify(draftees));
  console.log(`\n✓ ${Object.keys(draftees).length} unique drafted players → ${path.relative(process.cwd(), OUT)}`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
