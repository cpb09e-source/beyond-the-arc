/**
 * fetch-player-images.mjs — pulls ESPN player headshots for our Bart roster.
 *
 *   1. GET ESPN's D-I teams index (1 call, 362 teams)
 *   2. Fuzzy-match each Bart team name to ESPN team ID
 *   3. For each matched team: GET ESPN roster (~360 calls @ 2 r/s = ~3 min)
 *   4. For each athlete in the roster: fuzzy-match to a Bart player by name
 *   5. Download headshot.href → public/images/players/<bart_player_id>.png
 *   6. Sharp optimize: full webp + thumbnail webp (240x174)
 *   7. Emit src/data/player-photos.json mapping bart_player_id → image path
 *
 * Idempotent: cached downloads are skipped, mapping JSON is rewritten in place.
 * Run with: npm run fetch:photos
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
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

const PUB = path.resolve("public/images/players");
const DATA = path.resolve("src/data");
const PHOTOS_JSON = path.join(DATA, "player-photos.json");

const UA = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json, image/*, */*;q=0.8",
};

// ---------- name normalization (same algorithm we use for team matching) ----
function norm(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
// Tighter variant: collapses all whitespace away. Catches ESPN "P.J. Haggerty"
// (→ "p j haggerty") vs Bart "PJ Haggerty" (→ "pj haggerty") and similar
// dotted-initial mismatches. Used as a fallback after exact-norm match fails
// so we don't introduce ambiguity collisions on common names.
function normTight(s) {
  return norm(s).replace(/\s+/g, "");
}

// Bart team-name → ESPN team-name aliases pulled from src/data/cbb-team-ids.json
// (those are CBB names, but ESPN uses similar conventions). For most teams the
// normalized location matches; the gnarly ones get explicit mappings.
const TEAM_ALIASES = {
  // norm(bart) → ESPN-id-direct
  "st johns":          "st johns red storm",
  "saint marys":       "saint marys saint marys",  // ESPN uses doubled-up
  "hawaii":            "hawaii rainbow warriors",
  "miami fl":          "miami hurricanes",
  "miami":             "miami hurricanes",
  "sam houston st":    "sam houston bearkats",
  "louisiana":         "louisiana ragin cajuns",
  "louisiana monroe":  "louisiana monroe warhawks",
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

  // "X St." schools — fuzzy `contains` can match the wrong team. Pin explicitly.
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

  // Schools the fuzzy matcher missed in the last run
  "st thomas":         "st thomas minnesota tommies",
  "saint thomas":      "st thomas minnesota tommies",
  "utah tech":         "utah tech trailblazers",
  "canisius":          "canisius golden griffins",

  // Round 2 misses — punctuation + abbreviation collisions.
  "n c state":         "nc state wolfpack",       // Bart "N.C. State" → "n c state"
  "mississippi valley st":  "mississippi valley state delta devils",
  "lindenwood":        "lindenwood lions",         // pin to avoid Lindenwood-Belleville etc.
  "usc upstate":       "south carolina upstate spartans",
  "southern indiana":  "southern indiana screaming eagles",
};

// Per-player name aliases for cases where ESPN's displayName has a suffix
// (Jr., Sr., III) that Bart strips. Key = normalized ESPN name, value =
// normalized Bart name (must match `norm(bartPlayer.name)` exactly).
const PLAYER_ALIASES = {
  "mj collins jr": "mj collins",
};

// ---------- ESPN ----------
const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball";

async function fetchEspnTeams() {
  const url = `${ESPN_BASE}/teams?limit=500`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`ESPN teams index: HTTP ${res.status}`);
  const j = await res.json();
  return j?.sports?.[0]?.leagues?.[0]?.teams?.map((t) => t.team) ?? [];
}

async function fetchEspnRoster(espnTeamId) {
  const url = `${ESPN_BASE}/teams/${espnTeamId}/roster`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) return [];
  const j = await res.json();
  return j?.athletes ?? [];
}

// rate limit: 3 req/sec polite for ESPN
const MIN_INTERVAL_MS = 350;
let lastFetchAt = 0;
async function throttledGet(url) {
  const wait = Math.max(0, lastFetchAt + MIN_INTERVAL_MS - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastFetchAt = Date.now();
  return fetch(url, { headers: UA });
}

// ---------- download + sharp ----------
async function downloadImage(url, destPng) {
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 12_000);
    const res = await fetch(url, { headers: UA, signal: ctrl.signal });
    clearTimeout(to);
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(destPng, buf);
    return { bytes: buf.length };
  } catch (e) {
    return { error: e.message };
  }
}

async function optimize(srcPng, destWebp, destThumbWebp) {
  if (!existsSync(destWebp)) {
    await sharp(srcPng).webp({ quality: 82 }).toFile(destWebp);
  }
  if (!existsSync(destThumbWebp)) {
    await sharp(srcPng)
      .resize(240, 174, { fit: "cover", position: "top" })
      .webp({ quality: 78 })
      .toFile(destThumbWebp);
  }
}

// ---------- main ----------
async function main() {
  await fs.mkdir(PUB, { recursive: true });
  await fs.mkdir(DATA, { recursive: true });

  console.log("📦 ESPN teams index…");
  const espnTeams = await fetchEspnTeams();
  console.log(`   ${espnTeams.length} D-I teams`);

  // Build ESPN lookup index. Keys = several normalized variants.
  const espnByKey = new Map();
  for (const t of espnTeams) {
    const variants = [
      norm(t.displayName),                  // "Duke Blue Devils"
      norm(t.location),                     // "Duke"
      norm(`${t.location} ${t.name}`),      // "Duke Blue Devils"
      norm(t.shortDisplayName),
      norm(t.name),                         // "Blue Devils"
      norm(t.abbreviation),                 // "DUKE"
    ];
    for (const v of variants) if (v) espnByKey.set(v, t);
  }

  console.log("\n🏀 Pulling Bart team list from Supabase (year 2026)…");
  const { data: teamsRaw } = await sb
    .from("teams")
    .select("id, name, year")
    .eq("year", 2026)
    .limit(500);
  console.log(`   ${teamsRaw.length} Bart teams`);

  // Map Bart team id → ESPN team id, via alias-aware name match
  const espnByBartId = new Map();
  const unmatchedTeams = [];
  for (const t of teamsRaw) {
    const n = norm(t.name);
    let espn = espnByKey.get(n);
    if (!espn) {
      // Try alias
      const aliasNorm = norm(TEAM_ALIASES[n] ?? "");
      if (aliasNorm) espn = espnByKey.get(aliasNorm);
    }
    if (!espn) {
      // Try contains
      for (const [k, v] of espnByKey.entries()) {
        if (k.includes(n) || n.includes(k)) {
          espn = v;
          break;
        }
      }
    }
    if (espn) {
      espnByBartId.set(t.id, { espnId: espn.id, name: espn.displayName, bartName: t.name });
    } else {
      unmatchedTeams.push(t.name);
    }
  }
  console.log(`   matched ${espnByBartId.size}/${teamsRaw.length} teams to ESPN`);
  if (unmatchedTeams.length) {
    console.log(`   unmatched: ${unmatchedTeams.slice(0, 10).join(", ")}${unmatchedTeams.length > 10 ? "…" : ""}`);
  }

  console.log("\n🧑‍💼 Pulling Bart players (current season)…");
  const bartPlayers = [];
  let from = 0;
  while (true) {
    const { data } = await sb
      .from("players")
      .select("id, bart_player_id, name, team_id, year")
      .eq("year", 2026)
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    bartPlayers.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`   ${bartPlayers.length} Bart players this season`);

  // Index bart players by (team_id + normalized name). Index BOTH `norm` and
  // `normTight` keys so dotted-initial ESPN names ("P.J. Haggerty") can find
  // their Bart counterpart ("PJ Haggerty"). normTight collisions are extremely
  // rare for last-name disambiguation within a single roster.
  const bartByTeamPlayer = new Map();
  for (const p of bartPlayers) {
    if (!p.bart_player_id) continue;
    bartByTeamPlayer.set(`${p.team_id}|${norm(p.name)}`, p);
    bartByTeamPlayer.set(`${p.team_id}|${normTight(p.name)}`, p);
  }

  // Existing photo map (so re-runs accumulate)
  let photoMap = {};
  if (existsSync(PHOTOS_JSON)) {
    photoMap = JSON.parse(await fs.readFile(PHOTOS_JSON, "utf8"));
  }

  console.log("\n📸 Fetching rosters + photos (rate-limited)…");
  const t0 = Date.now();
  let rostersDone = 0;
  let matchedAthletes = 0;
  let downloaded = 0;
  let cached = 0;
  let failed = 0;
  let nameMisses = 0;

  for (const [bartTeamId, { espnId, bartName }] of espnByBartId.entries()) {
    const res = await throttledGet(`${ESPN_BASE}/teams/${espnId}/roster`);
    if (!res.ok) {
      console.log(`   ✗ ${bartName} (espn=${espnId}): HTTP ${res.status}`);
      continue;
    }
    const j = await res.json();
    const athletes = j?.athletes ?? [];
    rostersDone++;

    for (const a of athletes) {
      if (!a.headshot?.href) continue;
      // Try exact-norm match first, then fall back to tight-norm to catch
      // "P.J. Haggerty" / "PJ Haggerty" style mismatches. Then check the
      // PLAYER_ALIASES map for explicit overrides like "mj collins jr".
      const espnNorm = norm(a.displayName);
      const bart = bartByTeamPlayer.get(`${bartTeamId}|${espnNorm}`)
        ?? bartByTeamPlayer.get(`${bartTeamId}|${normTight(a.displayName)}`)
        ?? (PLAYER_ALIASES[espnNorm] && bartByTeamPlayer.get(`${bartTeamId}|${PLAYER_ALIASES[espnNorm]}`));
      if (!bart) {
        nameMisses++;
        continue;
      }
      matchedAthletes++;
      const pngPath = path.join(PUB, `${bart.bart_player_id}.png`);
      const webpPath = path.join(PUB, `${bart.bart_player_id}.webp`);
      const thumbPath = path.join(PUB, `${bart.bart_player_id}-sm.webp`);

      // Cache signal is the webp (canonical asset), not the png (intermediate).
      if (existsSync(webpPath) && existsSync(thumbPath)) {
        cached++;
        photoMap[bart.bart_player_id] = `/images/players/${bart.bart_player_id}.webp`;
        continue;
      }

      const r = await downloadImage(a.headshot.href, pngPath);
      if (r.bytes) {
        downloaded++;
      } else {
        failed++;
        continue;
      }
      try {
        await optimize(pngPath, webpPath, thumbPath);
        photoMap[bart.bart_player_id] = `/images/players/${bart.bart_player_id}.webp`;
        // Drop the PNG — webp is canonical. Avoids ~1 GB of dead originals.
        await fs.unlink(pngPath).catch(() => {});
      } catch (e) {
        console.log(`   ⚠ sharp failed for ${bart.bart_player_id}: ${e.message}`);
      }
    }

    if (rostersDone % 25 === 0) {
      process.stdout.write(`   ${rostersDone}/${espnByBartId.size} rosters processed\r`);
    }
  }
  console.log("");

  await fs.writeFile(PHOTOS_JSON, JSON.stringify(photoMap, null, 2));

  const seconds = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n${"═".repeat(60)}`);
  console.log(`Done in ${seconds}s.`);
  console.log(`  rosters processed:    ${rostersDone}`);
  console.log(`  athletes matched:     ${matchedAthletes}`);
  console.log(`  photos downloaded:    ${downloaded}`);
  console.log(`  photos cached:        ${cached}`);
  console.log(`  photo fetch failed:   ${failed}`);
  console.log(`  athlete name misses:  ${nameMisses}`);
  console.log(`  player-photos.json:   ${Object.keys(photoMap).length} entries`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
