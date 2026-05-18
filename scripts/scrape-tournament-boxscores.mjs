/**
 * scrape-tournament-boxscores.mjs — pull a basic box score for every NCAA
 * Tournament game we've already captured in tournament-games.json. Used by the
 * in-browser box-score modal on coach profile pages.
 *
 * Output structure:
 *   public/data/tournament-box/<year>/<game-slug>.json   (one file per game)
 *     {
 *       year: 2025,
 *       round: "Champion",
 *       date: "2025-04-07",
 *       venue: "Alamodome, San Antonio, TX",
 *       teams: [
 *         { slug: "florida", name: "Florida", seed: 1, score: 65, line: [25, 40],
 *           players: [
 *             { name, mp, fg, fga, fg3, fg3a, ft, fta, orb, drb, trb, ast, stl, blk, tov, pf, pts, starter },
 *             ...
 *           ] },
 *         { slug: "houston", ... }
 *       ]
 *     }
 *
 * Polite at 3.2s between SR fetches. Local cache in scripts/.scrape-cache/sr-boxscores/
 * so we can re-run idempotently.
 *
 * Run: npm run scrape:tournament-boxscores
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const SR_BASE = "https://www.sports-reference.com";
const SRC = path.resolve("src/data");
const OUT_DIR = path.resolve("public/data/tournament-box");
const CACHE_DIR = path.resolve("scripts/.scrape-cache/sr-boxscores");

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

function gameSlugFromUrl(url) {
  // /cbb/boxscores/2025-04-07-20-houston.html → "2025-04-07-20-houston"
  const m = url.match(/\/cbb\/boxscores\/([^.]+)\.html/);
  return m ? m[1] : null;
}

async function fetchBoxscore(url, slug) {
  const cacheFile = path.join(CACHE_DIR, `${slug}.html`);
  if (existsSync(cacheFile)) return await fs.readFile(cacheFile, "utf8");
  const res = await throttledGet(`${SR_BASE}${url}`);
  if (!res.ok) {
    console.warn(`  HTTP ${res.status} on ${slug}; skipping`);
    return null;
  }
  const html = await res.text();
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(cacheFile, html);
  return html;
}

// SR wraps some tables in HTML comments so they don't get loaded by some
// bots — we strip the `<!-- ... -->` wrapper around table blocks before parsing.
function uncomment(html) {
  return html.replace(/<!--([\s\S]*?)-->/g, "$1");
}

function parseLineScore(html, teamSlugA, teamSlugB) {
  void teamSlugA; void teamSlugB;
  const tableMatch = html.match(/<table[^>]+id="line-score"[\s\S]*?<\/table>/);
  if (!tableMatch) return null;
  // Find body rows — each starts with `<tr ` and contains a team cell.
  const tbodyMatch = tableMatch[0].match(/<tbody>([\s\S]*?)<\/tbody>/);
  const body = tbodyMatch ? tbodyMatch[1] : tableMatch[0];
  const rows = [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)];
  const out = {};
  for (const r of rows) {
    // Team cell: <th data-stat="team"><a href="/cbb/schools/<slug>/...">XYZ</a></th>
    // SR mixes single + double quotes in href attributes, so allow both.
    const teamMatch = r[1].match(/data-stat="team"[^>]*>(?:<a[^>]*href=['"]\/cbb\/schools\/([a-z0-9-]+)\/[^'"]+['"][^>]*>)?([^<]+)/);
    if (!teamMatch) continue;
    const teamSlug = teamMatch[1] ?? null;
    if (!teamSlug) continue;
    // Period cells: data-stat="1", "2", "OT1", etc. The "T" column is the
    // final score (may be wrapped in <strong>...</strong>).
    const periodCells = [...r[1].matchAll(/data-stat="(\d+|OT\d+)"[^>]*>(?:<strong>)?(\d+)/g)];
    const finalMatch = r[1].match(/data-stat="T"[^>]*>(?:<strong>)?(\d+)/);
    const line = periodCells.map((m) => parseInt(m[2], 10));
    const score = finalMatch ? parseInt(finalMatch[1], 10) : (line.length ? line.reduce((s, n) => s + n, 0) : null);
    out[teamSlug] = { line, score };
  }
  return out;
}

function parseGameInfo(html) {
  const tableMatch = html.match(/<table[^>]+id="game-info"[\s\S]*?<\/table>/);
  if (!tableMatch) return {};
  const info = {};
  const rows = [...tableMatch[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)];
  for (const r of rows) {
    const labelMatch = r[1].match(/<th[^>]*>([\s\S]*?)<\/th>/);
    const valueMatch = r[1].match(/<td[^>]*>([\s\S]*?)<\/td>/);
    if (!labelMatch || !valueMatch) continue;
    const label = plainText(labelMatch[1]).toLowerCase();
    const value = plainText(valueMatch[1]);
    info[label] = value;
  }
  return info;
}

function parsePlayers(html, teamSlug) {
  // Each team's basic box: <table id="box-score-basic-<slug>">
  const re = new RegExp(`<table[^>]+id="box-score-basic-${teamSlug}"[\\s\\S]*?<\\/table>`);
  const tableMatch = html.match(re);
  if (!tableMatch) return [];
  const players = [];
  // Capture the ENTIRE <tr ...>…</tr> (including the opening tag) so we can
  // check `class="thead"` on the row itself, not just on its inner content.
  const rows = [...tableMatch[0].matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/g)].map((m) => m[0]);
  let starterCutoff = false;
  for (const row of rows) {
    // Skip header / divider rows. SR uses a mix of structures:
    //   <tr class="thead"> ... </tr>                     ← Reserves divider
    //   <tr><th data-stat="player" scope="col">Starters</th>...  ← column header
    // We use BOTH the class check and the `scope="col"` check.
    const isHeader =
      /class="thead"/.test(row) ||
      /class="over_header"/.test(row) ||
      /data-stat="player"[^>]*scope="col"/.test(row);
    if (isHeader) {
      if (/Reserves/i.test(plainText(row))) starterCutoff = true;
      continue;
    }
    // Real player rows have a `data-stat="mp"` cell — header rows don't.
    if (!/data-stat="mp"[^>]*>[^<]/.test(row)) continue;
    const nameMatch = row.match(/data-stat="player"[^>]*>(?:<a[^>]*>)?([^<]+)/);
    if (!nameMatch) continue;
    const name = plainText(nameMatch[1]);
    if (!name) continue;
    // Footer rows: "Team Totals", "School Totals", "Bench Totals".
    if (/Totals/i.test(name)) continue;
    function num(stat) {
      const m = row.match(new RegExp(`data-stat="${stat}"[^>]*>([^<]+)<`));
      if (!m) return null;
      const v = m[1].trim();
      if (v === "" || v === "Did Not Play" || v === "DNP") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    function str(stat) {
      const m = row.match(new RegExp(`data-stat="${stat}"[^>]*>([^<]+)<`));
      return m ? plainText(m[1]) : null;
    }
    players.push({
      name,
      starter: !starterCutoff,
      mp: str("mp"),
      fg: num("fg"), fga: num("fga"),
      fg3: num("fg3"), fg3a: num("fg3a"),
      ft: num("ft"), fta: num("fta"),
      orb: num("orb"), drb: num("drb"), trb: num("trb"),
      ast: num("ast"), stl: num("stl"), blk: num("blk"),
      tov: num("tov"), pf: num("pf"), pts: num("pts"),
    });
  }
  return players;
}

async function processGame(game) {
  const slug = gameSlugFromUrl(game.boxscore_url);
  if (!slug) return { status: "skip-no-url" };
  const outFile = path.join(OUT_DIR, String(game.year), `${slug}.json`);
  if (existsSync(outFile)) return { status: "already-have" };

  const html = await fetchBoxscore(game.boxscore_url, slug);
  if (!html) return { status: "fetch-failed" };

  // SR hides some content in comments; expand to get tables parseable.
  const expanded = uncomment(html);

  const line = parseLineScore(expanded, game.winner.slug, game.loser.slug) ?? {};
  const info = parseGameInfo(expanded);

  // Line-score is now keyed by team slug. Lookup is direct.
  const teams = [
    {
      slug: game.winner.slug,
      name: game.winner.school,
      seed: game.winner.seed,
      score: game.winner.score,
      line: line[game.winner.slug]?.line ?? null,
      players: parsePlayers(expanded, game.winner.slug),
    },
    {
      slug: game.loser.slug,
      name: game.loser.school,
      seed: game.loser.seed,
      score: game.loser.score,
      line: line[game.loser.slug]?.line ?? null,
      players: parsePlayers(expanded, game.loser.slug),
    },
  ];

  const out = {
    year: game.year,
    round: game.round,
    date: game.date,
    venue: info["arena"] ?? info["venue"] ?? null,
    attendance: info["attendance"] ?? null,
    teams,
  };

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, JSON.stringify(out));
  return { status: "wrote" };
}

async function main() {
  const games = JSON.parse(await fs.readFile(path.join(SRC, "tournament-games.json"), "utf8"));
  const allGames = [];
  for (const [year, list] of Object.entries(games)) {
    for (const g of list) {
      if (!g.boxscore_url) continue;
      allGames.push(g);
    }
  }
  console.log(`📦 ${allGames.length} games queued`);
  await fs.mkdir(OUT_DIR, { recursive: true });

  let wrote = 0, cached = 0, failed = 0;
  for (let i = 0; i < allGames.length; i++) {
    const g = allGames[i];
    try {
      const res = await processGame(g);
      if (res.status === "wrote") wrote++;
      else if (res.status === "already-have") cached++;
      else failed++;
    } catch (e) {
      failed++;
      console.warn(`  error on game ${gameSlugFromUrl(g.boxscore_url)}: ${e.message}`);
    }
    if ((i + 1) % 25 === 0) {
      process.stdout.write(`   ${i + 1}/${allGames.length} · ${wrote} fresh · ${cached} cached · ${failed} failed\r`);
    }
  }
  console.log("");
  console.log(`✓ wrote ${wrote} new files, ${cached} already cached, ${failed} failed`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
