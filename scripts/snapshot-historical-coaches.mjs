/**
 * snapshot-historical-coaches.mjs — one-shot scrape of every D-I team's
 * year-by-year head coach from Sports Reference (College Basketball Reference).
 *
 * Output:
 *   src/data/coach-history.json
 *     {
 *       "Duke": {
 *         "2026": { "name": "Jon Scheyer", "slug": "jon-scheyer-1", "wins": 35, "losses": 3 },
 *         "2025": { "name": "Jon Scheyer", "slug": "jon-scheyer-1", "wins": 35, "losses": 4 },
 *         ...
 *       },
 *       ...
 *     }
 *
 * Two-phase scrape:
 *   1. SR's school index → Bart→SR slug map (cached at src/data/sr-school-map.json)
 *   2. For each Bart team, fetch /cbb/schools/<slug>/men/ → parse the year-by-year
 *      table → keep YEARS 2013–2026.
 *
 * Polite at 3.2s between requests (SR robots.txt asks for ≤20 req/min). Total
 * runtime: ~20 minutes. Re-run safely — each team is cached individually so
 * a crash/abort can resume.
 *
 * Run: npm run snapshot:coach-history
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !ANON) {
  console.error("Missing Supabase env vars in .env.local");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });

const SR_BASE = "https://www.sports-reference.com/cbb";
const DATA = path.resolve("src/data");
const CACHE_DIR = path.resolve("scripts/.scrape-cache/sr-coach-history");
const OUT = path.join(DATA, "coach-history.json");
const SLUG_MAP_PATH = path.join(DATA, "sr-school-map.json");

const UA = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

// SR robots.txt asks for ≤20 req/min; we hold to ~18.75/min (3.2s gap).
const MIN_INTERVAL_MS = 3200;
let lastFetchAt = 0;

async function throttledGet(url, label = "", retries = 3) {
  const wait = Math.max(0, lastFetchAt + MIN_INTERVAL_MS - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastFetchAt = Date.now();
  const res = await fetch(url, { headers: UA });
  if (res.status === 429) {
    if (retries <= 0) {
      console.log(`   ⏭ 429 from SR (${label}) — giving up after ${3} retries, skipping`);
      return res; // caller can decide what to do with a 429 response
    }
    const backoff = 30_000 + (3 - retries) * 30_000; // 30s, 60s, 90s
    console.log(`   ⏸ 429 from SR (${label}) — backing off ${backoff / 1000}s (${retries} retries left)`);
    await new Promise((r) => setTimeout(r, backoff));
    return throttledGet(url, label, retries - 1);
  }
  return res;
}

function norm(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Bart → SR slug overrides for teams the fuzzy matcher can't resolve. Add to
// this map as misses surface during scraping.
const BART_TO_SR_OVERRIDES = {
  "N.C. State": "north-carolina-state",
  "Southern California": "southern-california",
  "Saint Mary's": "saint-marys-ca",
  "St. John's": "st-johns-ny",
  "Miami FL": "miami-fl",
  "Miami OH": "miami-oh",
  "UConn": "connecticut",
  "USC": "southern-california",
  "Connecticut": "connecticut",
  "St. Thomas": "st-thomas-mn",
  "Saint Thomas": "st-thomas-mn",
  "Texas A&M Corpus Chris": "texas-am-corpus-christi",
  "Sam Houston St.": "sam-houston-state",
  "Minnesota": "minnesota",
  "Louisiana": "louisiana-lafayette",
  "Ole Miss": "mississippi",
  "Mississippi": "mississippi",
  "UIC": "illinois-chicago",
  "Illinois Chicago": "illinois-chicago",
  "Queens": "queens-nc",
  "Texas A&M": "texas-am",
  "UNC Asheville": "north-carolina-asheville",
  "UNC Greensboro": "north-carolina-greensboro",
  "UNC Wilmington": "north-carolina-wilmington",
  "South Florida": "south-florida",
  "USC Upstate": "south-carolina-upstate",
  "UC San Diego": "california-san-diego",
  "UC Irvine": "california-irvine",
  "UC Davis": "california-davis",
  "UC Riverside": "california-riverside",
  "UC Santa Barbara": "california-santa-barbara",
  "Utah Tech": "dixie-state",
  "Cal St. Bakersfield": "cal-state-bakersfield",
  "Cal St. Fullerton": "cal-state-fullerton",
  "Cal St. Northridge": "cal-state-northridge",
  "FIU": "florida-international",
  "UMass Lowell": "massachusetts-lowell",
  "Massachusetts": "massachusetts",
  "UMKC": "missouri-kansas-city",
  "UMBC": "maryland-baltimore-county",
  "Loyola MD": "loyola-md",
  "Loyola Chicago": "loyola-il",
  "Loyola Marymount": "loyola-marymount",
  "Saint Joseph's": "saint-josephs",
  "Saint Peter's": "saint-peters",
  "Saint Francis": "saint-francis-pa",
  "Saint Louis": "saint-louis",
  "Saint Mary's (CA)": "st-marys-ca",
  "St. Bonaventure": "st-bonaventure",
  "St. Thomas (MN)": "st-thomas-mn",
  "Long Beach St.": "long-beach-state",
  "Sacramento St.": "sacramento-state",
  "Iowa St.": "iowa-state",
  "San Jose St.": "san-jose-state",
  "Michigan St.": "michigan-state",
  "Mississippi St.": "mississippi-state",
  "Ohio St.": "ohio-state",
  "Oklahoma St.": "oklahoma-state",
  "Oregon St.": "oregon-state",
  "Penn St.": "penn-state",
  "San Diego St.": "san-diego-state",
  "South Dakota St.": "south-dakota-state",
  "Utah St.": "utah-state",
  "Washington St.": "washington-state",
  "Kansas St.": "kansas-state",
  "Florida St.": "florida-state",
  "Arizona St.": "arizona-state",
  "Lipscomb": "lipscomb",
  "Mississippi Valley St.": "mississippi-valley-state",
  "Southern Indiana": "southern-indiana",
  "Lindenwood": "lindenwood",
  "Canisius": "canisius",
  "Hawaii": "hawaii",
  "BYU": "brigham-young",
  "SMU": "southern-methodist",
  "TCU": "texas-christian",
  "UCF": "central-florida",
  "UNLV": "nevada-las-vegas",
  "UTEP": "texas-el-paso",
  "UTSA": "texas-san-antonio",
  "UT Arlington": "texas-arlington",
  "UT Rio Grande Valley": "texas-rio-grande-valley",
  "LIU": "long-island-university",
  "VMI": "virginia-military-institute",
  "VCU": "virginia-commonwealth",
  "LSU": "louisiana-state",
  "Stephen F. Austin": "stephen-f-austin",
  "UNC Asheville": "north-carolina-asheville",
  "Penn": "pennsylvania",
  "Pittsburgh": "pittsburgh",
  "Boston University": "boston-university",
  "Boston College": "boston-college",
  "Tennessee Tech": "tennessee-tech",
  "Tennessee Martin": "tennessee-martin",
  "Tennessee St.": "tennessee-state",
  "Maryland Eastern Shore": "maryland-eastern-shore",
  "North Carolina A&T": "north-carolina-at",
  "North Carolina Central": "north-carolina-central",
  "South Carolina St.": "south-carolina-state",
  "Arkansas Pine Bluff": "arkansas-pine-bluff",
  "Florida A&M": "florida-am",
  "Alabama A&M": "alabama-am",
  "Alabama St.": "alabama-state",
  "Norfolk St.": "norfolk-state",
  "Morgan St.": "morgan-state",
  "Coppin St.": "coppin-state",
  "Delaware St.": "delaware-state",
  "Howard": "howard",
  "Bethune Cookman": "bethune-cookman",
  "Prairie View A&M": "prairie-view",
  "Grambling St.": "grambling",
  "Jackson St.": "jackson-state",
  "Texas Southern": "texas-southern",
  "Mississippi Valley St.": "mississippi-valley-state",
  "Alcorn St.": "alcorn-state",
  "Southern": "southern",

  // Round 3 — the 5 the first run flagged unmatched.
  "McNeese St.": "mcneese-state",
  "Cal Baptist": "california-baptist",
  "Nebraska Omaha": "nebraska-omaha",
  "SIU Edwardsville": "southern-illinois-edwardsville",
  "Fairleigh Dickinson": "fairleigh-dickinson",

  // Round 4 — flagship state schools where SR's mascot suffix is longer than
  // a sibling school's full display (e.g. "Illinois Fighting Illini" beats
  // "Illinois State Redbirds" by length, so the shortest-displayName tiebreaker
  // wrongly picked the sibling). Slug-parts heuristic added below also covers
  // these, but explicit overrides are clearer and crash-proof.
  "Illinois":     "illinois",
  "Alabama":      "alabama",
  "North Dakota": "north-dakota",
  "Delaware":     "delaware",
};

// ---------- SR school-index → slug map ----------
async function loadSrSchoolMap() {
  if (existsSync(SLUG_MAP_PATH)) {
    return JSON.parse(await fs.readFile(SLUG_MAP_PATH, "utf8"));
  }
  console.log("📚 Fetching SR school index…");
  const res = await throttledGet(`${SR_BASE}/schools/`, "schools-index");
  if (!res.ok) throw new Error(`SR schools index: HTTP ${res.status}`);
  const html = await res.text();
  // <a href="/cbb/schools/<slug>/men/"> Display Name </a>
  const links = [...html.matchAll(/href="\/cbb\/schools\/([a-z0-9-]+)\/men\/">([^<]+)<\/a>/g)];
  const map = {};
  for (const m of links) {
    const slug = m[1];
    const displayName = m[2].replace(/&amp;/g, "&").trim();
    map[displayName] = slug;
  }
  await fs.mkdir(DATA, { recursive: true });
  await fs.writeFile(SLUG_MAP_PATH, JSON.stringify(map, null, 2));
  console.log(`   ${Object.keys(map).length} schools mapped → ${path.relative(process.cwd(), SLUG_MAP_PATH)}`);
  return map;
}

function resolveBartToSr(bartName, srMap) {
  if (BART_TO_SR_OVERRIDES[bartName]) return BART_TO_SR_OVERRIDES[bartName];
  const bartNorm = norm(bartName);
  const startsWith = [];
  for (const [display, slug] of Object.entries(srMap)) {
    const displayNorm = norm(display);
    if (displayNorm === bartNorm || displayNorm.startsWith(bartNorm + " ")) {
      startsWith.push({ display, slug, displayNorm });
    }
  }
  if (startsWith.length > 0) {
    // Primary tiebreaker: slug-parts proximity to bart-name word count. SR's
    // URL slugs reliably encode the place name (Illinois → illinois, Illinois
    // State → illinois-state). The flagship school's slug therefore has the
    // SAME number of dash-separated parts as bart's name has words; sibling
    // schools have extra parts. This beats the old shortest-displayName rule,
    // which mis-matched "Illinois" → "illinois-state" because "Illinois State
    // Redbirds" (3 words) is shorter than "Illinois Fighting Illini" (3 words
    // but more characters).
    //
    // Fallback tiebreaker: shortest displayNorm, for cases the slug heuristic
    // can't resolve (e.g. both candidates have the same slug-parts count).
    const bartWordCount = bartNorm.split(" ").length;
    startsWith.sort((a, b) => {
      const aExtra = a.slug.split("-").length - bartWordCount;
      const bExtra = b.slug.split("-").length - bartWordCount;
      if (aExtra !== bExtra) return aExtra - bExtra;
      return a.displayNorm.length - b.displayNorm.length;
    });
    return startsWith[0].slug;
  }
  // Fallback: substring contains, prefer shortest display.
  const contains = [];
  for (const [display, slug] of Object.entries(srMap)) {
    const displayNorm = norm(display);
    if (displayNorm.includes(bartNorm)) {
      contains.push({ display, slug, displayNorm });
    }
  }
  if (contains.length > 0) {
    contains.sort((a, b) => a.displayNorm.length - b.displayNorm.length);
    return contains[0].slug;
  }
  return null;
}

// ---------- Per-team SR scrape ----------
const OFFLINE = process.argv.includes("--offline");

async function fetchTeamHistory(srSlug) {
  const cacheFile = path.join(CACHE_DIR, `${srSlug}.html`);
  if (existsSync(cacheFile)) {
    return await fs.readFile(cacheFile, "utf8");
  }
  if (OFFLINE) return null;
  const res = await throttledGet(`${SR_BASE}/schools/${srSlug}/men/`, srSlug);
  if (!res.ok) {
    if (res.status === 404) return null;
    if (res.status === 429) return null; // soft-skip; the retries already exhausted
    throw new Error(`SR team ${srSlug}: HTTP ${res.status}`);
  }
  const html = await res.text();
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(cacheFile, html);
  return html;
}

/**
 * Map SR's round_max text → short tournament-round label.
 * SR phrasing actually uses the bracket-position names, not the colloquial
 * tournament-round names. Both forms handled:
 *   "Regional Semifinal" ↔ Sweet 16
 *   "Regional Final"     ↔ Elite Eight
 *   "National Semifinal" ↔ Final Four
 *   "National Final"     ↔ Runner-up
 *   "National Championship" / "Won NCAA Tournament" → Champion
 */
function parseTourneyRound(roundCellText) {
  const t = roundCellText.trim();
  if (!t) return null;
  // Champion wording on SR: the cell starts with "Won NCAA Tournament" (no further round descriptor).
  if (/^Won\s+NCAA\s+Tournament/i.test(t) || /National Champion/i.test(t)) return "Champion";
  if (/National Final/i.test(t) || /Championship Game/i.test(t)) return "Runner-up";
  if (/National Semifinal/i.test(t) || /Final Four/i.test(t)) return "Final Four";
  // 2011-2015 SR used the "First Round = First Four / Second Round = R64 /
  // Third Round = R32 / Fourth Round = S16 / Fifth Round = E8" numbering.
  // Modern years drop the First Four from the numbering. We handle both by
  // checking the OLD terminology first, then falling back to current.
  if (/Regional Final/i.test(t) || /Elite Eight/i.test(t) || /Fifth Round/i.test(t)) return "Elite Eight";
  if (/Regional Semifinal/i.test(t) || /Sweet Sixteen/i.test(t) || /Sweet 16/i.test(t) || /Fourth Round/i.test(t)) return "Sweet 16";
  if (/Third Round/i.test(t)) return "R32";
  if (/Second Round/i.test(t)) return "R32";
  if (/First Round/i.test(t)) return "R64";
  if (/First Four/i.test(t)) return "First Four";
  return null;
}

function parseSchoolHistory(html) {
  // Row shape we extract: { year, name, slug, wins, losses, conf_wins, conf_losses, seed, round }
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
    // Seed in the NCAA tournament (1-16, null if didn't qualify).
    const seedMatch = row.match(/data-stat="seed"[^>]*>(\d+)\s*</);
    // Furthest round reached. The cell contains an <a> with descriptive text;
    // strip HTML and map to short label.
    const roundCellMatch = row.match(/data-stat="round_max"[^>]*>([\s\S]*?)<\/td>/);
    const roundText = roundCellMatch ? roundCellMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
    const round = parseTourneyRound(roundText);
    const seasonEnd = parseInt(yearMatch[1], 10) + 1; // SR shows "2025-26" → season-end year 2026
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

// ---------- main ----------
const YEARS = [2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
const YEAR_SET = new Set(YEARS);

async function main() {
  await fs.mkdir(DATA, { recursive: true });
  await fs.mkdir(CACHE_DIR, { recursive: true });

  // Resume existing output if present so a crash-recovery doesn't lose work.
  let existing = {};
  if (existsSync(OUT)) {
    existing = JSON.parse(await fs.readFile(OUT, "utf8"));
    console.log(`▶ Resuming: ${Object.keys(existing).length} teams already in coach-history.json`);
  }

  const srMap = await loadSrSchoolMap();

  console.log("\n🏀 Bart team list from Supabase (year 2026)…");
  const { data: teamsRaw, error } = await sb
    .from("teams")
    .select("id, name, year")
    .eq("year", 2026)
    .limit(500);
  if (error) throw new Error(`teams: ${error.message}`);
  console.log(`   ${teamsRaw.length} Bart teams`);

  // Resolve each Bart team to its SR slug
  const matched = [];
  const unmatched = [];
  for (const t of teamsRaw) {
    const slug = resolveBartToSr(t.name, srMap);
    if (slug) matched.push({ bartName: t.name, srSlug: slug });
    else unmatched.push(t.name);
  }
  console.log(`   matched ${matched.length}/${teamsRaw.length}`);
  if (unmatched.length) {
    console.log(`   unmatched: ${unmatched.join(", ")}`);
    console.log("   (add to BART_TO_SR_OVERRIDES at top of script and re-run)");
  }

  // Scrape each matched team
  console.log("\n🎩 Scraping per-team year-by-year coach history (3.2s polite rate)…");
  const t0 = Date.now();
  let processed = 0;
  let cached = 0;
  let downloaded = 0;
  let failed = 0;
  let totalYears = 0;

  for (const { bartName, srSlug } of matched) {
    processed++;
    try {
      const cacheFile = path.join(CACHE_DIR, `${srSlug}.html`);
      const wasCached = existsSync(cacheFile);
      const html = await fetchTeamHistory(srSlug);
      if (!html) { failed++; continue; }
      if (wasCached) cached++; else downloaded++;

      const seasons = parseSchoolHistory(html);
      const inRange = seasons.filter((s) => YEAR_SET.has(s.year));
      if (inRange.length === 0) continue;

      if (!existing[bartName]) existing[bartName] = {};
      for (const s of inRange) {
        existing[bartName][String(s.year)] = {
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
        totalYears++;
      }

      if (processed % 10 === 0) {
        // Checkpoint every 10 teams.
        await fs.writeFile(OUT, JSON.stringify(existing, null, 2));
        process.stdout.write(`   ${processed}/${matched.length} teams · ${downloaded} fetched · ${cached} cached\r`);
      }
    } catch (e) {
      failed++;
      console.log(`\n   ⚠ ${bartName} (${srSlug}): ${e.message}`);
    }
  }

  await fs.writeFile(OUT, JSON.stringify(existing, null, 2));

  const seconds = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n${"═".repeat(60)}`);
  console.log(`Done in ${seconds}s.`);
  console.log(`  teams processed:        ${processed}`);
  console.log(`  downloaded fresh:       ${downloaded}`);
  console.log(`  served from cache:      ${cached}`);
  console.log(`  HTTP / parse failures:  ${failed}`);
  console.log(`  team-year entries:      ${totalYears}`);
  console.log(`  teams in output:        ${Object.keys(existing).length}`);
  console.log(`  written to:             ${path.relative(process.cwd(), OUT)}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
