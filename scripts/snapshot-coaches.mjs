/**
 * snapshot-coaches.mjs — one-shot scrape of current D-I head coaches.
 *
 * Reads the same Bart team list + ESPN team mapping that fetch-player-images.mjs
 * uses (so the team alias machinery stays in sync), hits ESPN's roster endpoint
 * per team, and pulls the head coach out of the response. Output:
 *
 *   src/data/team-coaches.json
 *     {
 *       "Duke": { "name": "Jon Scheyer", "espn_id": "31709",
 *                 "first_name": "Jon", "last_name": "Scheyer" },
 *       ...
 *     }
 *
 * Coach name + ID get baked into the per-team JSONs by export-static-data.mts
 * and rendered by the team page's hero. This script is the historical-data
 * snapshot the user wants — run it once, commit the JSON, never run it again
 * until the new season's coaching carousel settles.
 *
 * Run: npm run snapshot:coaches
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

const DATA = path.resolve("src/data");
const OUT = path.join(DATA, "team-coaches.json");

const UA = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json, */*;q=0.8",
};

// ---------- name normalization (mirror of fetch-player-images.mjs) ----
function norm(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Same alias map as fetch-player-images.mjs. Duplicated to avoid coupling but
// keep them in sync when adding new schools.
const TEAM_ALIASES = {
  "st johns":          "st johns red storm",
  "saint marys":       "saint marys saint marys",
  "hawaii":            "hawaii rainbow warriors",
  "miami fl":          "miami hurricanes",
  "miami":             "miami hurricanes",
  "sam houston st":    "sam houston bearkats",
  "louisiana":         "louisiana ragin cajuns",
  "louisiana monroe":  "ul monroe warhawks",
  "southeastern louisiana": "se louisiana lions",
  "ole miss":          "ole miss rebels",
  "mississippi":       "ole miss rebels",
  "central michigan":  "central michigan chippewas",
  "uconn":             "uconn huskies",       // ESPN displayName is "UConn Huskies" — `connecticut` fell through to Central Connecticut
  "connecticut":       "uconn huskies",
  "southern california": "usc trojans",         // Bart raw name pre-override → pin to USC
  "usc":               "usc trojans",
  "ucla":              "ucla bruins",
  "uic":               "uic flames",
  "illinois chicago":  "uic flames",
  "iowa st":           "iowa state cyclones",
  "iowa state":        "iowa state cyclones",
  "san jose st":       "san jose state spartans",
  "san jose state":    "san jose state spartans",
  "michigan st":       "michigan state spartans",
  "mississippi st":    "mississippi state bulldogs",
  "ohio st":           "ohio state buckeyes",
  "oklahoma st":       "oklahoma state cowboys",
  "oregon st":         "oregon state beavers",
  "penn st":           "penn state nittany lions",
  "san diego st":      "san diego state aztecs",
  "south dakota st":   "south dakota state jackrabbits",
  "utah st":           "utah state aggies",
  "washington st":     "washington state cougars",
  "kansas st":         "kansas state wildcats",
  "florida st":        "florida state seminoles",
  "arizona st":        "arizona state sun devils",
  "st thomas":         "st thomas minnesota tommies",
  "saint thomas":      "st thomas minnesota tommies",
  "utah tech":         "utah tech trailblazers",
  "canisius":          "canisius golden griffins",
  "n c state":         "nc state wolfpack",
  "mississippi valley st":  "mississippi valley state delta devils",
  "lindenwood":        "lindenwood lions",
  "usc upstate":       "south carolina upstate spartans",
  "southern indiana":  "southern indiana screaming eagles",
  // Bart "St." → ESPN "State" mismatches (top-level alias) so the strict
  // fuzzy fallback isn't needed for these.
  "appalachian st":    "app state mountaineers",
  "jacksonville st":   "jacksonville state gamecocks",
  "south carolina st": "south carolina state bulldogs",
  "missouri st":       "missouri state bears",
  "southeast missouri st": "southeast missouri state redhawks",
  "north dakota st":   "north dakota state bison",
  "cal baptist":       "california baptist lancers",
  "cal st northridge": "cal state northridge matadors",
  "nebraska omaha":    "omaha mavericks",
  "texas a m corpus chris": "texas a m corpus christi islanders",
  "tennessee martin":  "ut martin skyhawks",
  // Bart name diverges from ESPN displayName — old loose fuzzy matched these by
  // luck; the new strict matcher needs explicit aliases.
  "mcneese st":        "mcneese cowboys",
  "seattle":           "seattle u redhawks",
  "hawaii":            "hawai i rainbow warriors", // ESPN spells with apostrophe → norm strips to "hawai i"
  "liu":               "long island university sharks",
  "kent st":           "kent state golden flashes",
  "cal st fullerton":  "cal state fullerton titans",
  "nicholls st":       "nicholls colonels",
  "ball st":           "ball state cardinals",
  "grambling st":      "grambling tigers",
  "northwestern st":   "northwestern state demons",
  "albany":            "ualbany great danes",
  "cal st bakersfield": "cal state bakersfield roadrunners",
  "umkc":              "kansas city roos",
};

// ---------- ESPN ----------
const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball";

async function fetchEspnTeams() {
  const res = await fetch(`${ESPN_BASE}/teams?limit=500`, { headers: UA });
  if (!res.ok) throw new Error(`ESPN teams index: HTTP ${res.status}`);
  const j = await res.json();
  return j?.sports?.[0]?.leagues?.[0]?.teams?.map((t) => t.team) ?? [];
}

// Polite throttling — 3 req/sec to ESPN.
const MIN_INTERVAL_MS = 350;
let lastFetchAt = 0;
async function throttledGet(url) {
  const wait = Math.max(0, lastFetchAt + MIN_INTERVAL_MS - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastFetchAt = Date.now();
  return fetch(url, { headers: UA });
}

async function main() {
  await fs.mkdir(DATA, { recursive: true });

  console.log("📦 ESPN teams index…");
  const espnTeams = await fetchEspnTeams();
  console.log(`   ${espnTeams.length} D-I teams`);

  // Index ESPN by several normalized variants. Abbreviation (e.g. "CAL", "IND",
  // "OU") is intentionally EXCLUDED — those 2-3 letter keys substring-match
  // unrelated schools ("Cal Baptist" → "cal" → California, "Southern Indiana"
  // → "indiana" → Indiana, etc.) and were the source of the duplicate-coach bug.
  const espnByKey = new Map();
  for (const t of espnTeams) {
    const variants = [
      norm(t.displayName),
      norm(t.location),
      norm(`${t.location} ${t.name}`),
      norm(t.shortDisplayName),
      norm(t.name),
    ];
    for (const v of variants) if (v) espnByKey.set(v, t);
  }

  // Strict fuzzy: Bart's tokens must be a subset of an ESPN variant's tokens.
  // (The reverse direction — ESPN variant ⊆ Bart — is unsafe: ESPN "Tennessee
  // St" (short for Tennessee State) is a subset of Bart "East Tennessee St"
  // and would wrongly map them together.) Both sides require ≥2 tokens.
  function tokenSet(s) { return new Set(s.split(" ").filter(Boolean)); }
  function fuzzyMatch(n) {
    const bt = tokenSet(n);
    if (bt.size < 2) return null;
    let best = null;
    let bestKtSize = Infinity;
    for (const [k, v] of espnByKey.entries()) {
      const kt = tokenSet(k);
      if (kt.size < 2) continue;
      const bartInK = [...bt].every((t) => kt.has(t));
      if (!bartInK) continue;
      // Prefer the tightest containing key — fewer extra tokens = closer match.
      if (kt.size < bestKtSize) { bestKtSize = kt.size; best = v; }
    }
    return best;
  }

  console.log("\n🏀 Bart team list from Supabase (year 2026)…");
  const { data: teamsRaw, error } = await sb
    .from("teams")
    .select("id, name, year")
    .eq("year", 2026)
    .limit(500);
  if (error) throw new Error(`teams: ${error.message}`);
  console.log(`   ${teamsRaw.length} Bart teams`);

  // Match Bart → ESPN
  const espnByBartName = new Map();
  const unmatched = [];
  for (const t of teamsRaw) {
    const n = norm(t.name);
    let espn = espnByKey.get(n);
    if (!espn) {
      const aliasNorm = norm(TEAM_ALIASES[n] ?? "");
      if (aliasNorm) espn = espnByKey.get(aliasNorm);
    }
    if (!espn) {
      espn = fuzzyMatch(n);
    }
    if (espn) espnByBartName.set(t.name, { espnId: espn.id });
    else unmatched.push(t.name);
  }
  console.log(`   matched ${espnByBartName.size}/${teamsRaw.length} teams to ESPN`);
  if (unmatched.length) {
    console.log(`   unmatched: ${unmatched.slice(0, 10).join(", ")}${unmatched.length > 10 ? "…" : ""}`);
  }

  // Existing coaches map — preserve any manually-corrected entries on re-run.
  let coaches = {};
  if (existsSync(OUT)) {
    coaches = JSON.parse(await fs.readFile(OUT, "utf8"));
  }

  console.log("\n🎩 Fetching coach per team (rate-limited)…");
  const t0 = Date.now();
  let teamsDone = 0;
  let coachesFound = 0;
  let coachesMissing = 0;
  let httpErrors = 0;

  for (const [bartName, { espnId }] of espnByBartName.entries()) {
    const res = await throttledGet(`${ESPN_BASE}/teams/${espnId}/roster`);
    teamsDone++;
    if (!res.ok) {
      httpErrors++;
      continue;
    }
    const j = await res.json();
    const coach = j?.coach?.[0];
    if (!coach || (!coach.firstName && !coach.lastName)) {
      coachesMissing++;
      continue;
    }
    const first = coach.firstName ?? "";
    const last = coach.lastName ?? "";
    coaches[bartName] = {
      name: `${first} ${last}`.trim(),
      first_name: first,
      last_name: last,
      espn_id: coach.id != null ? String(coach.id) : null,
    };
    coachesFound++;

    if (teamsDone % 25 === 0) {
      process.stdout.write(`   ${teamsDone}/${espnByBartName.size} teams processed\r`);
    }
  }
  console.log("");

  await fs.writeFile(OUT, JSON.stringify(coaches, null, 2));

  const seconds = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n${"═".repeat(60)}`);
  console.log(`Done in ${seconds}s.`);
  console.log(`  teams matched to ESPN:    ${espnByBartName.size}`);
  console.log(`  coaches found:            ${coachesFound}`);
  console.log(`  coaches missing on ESPN:  ${coachesMissing}`);
  console.log(`  HTTP errors:              ${httpErrors}`);
  console.log(`  total entries in JSON:    ${Object.keys(coaches).length}`);
  console.log(`  written to:               ${path.relative(process.cwd(), OUT)}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
