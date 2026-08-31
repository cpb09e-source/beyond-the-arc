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
import { playerKey } from "./lib/cbbd-join.mjs";

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

/**
 * Do two given names plausibly belong to the same person?
 *
 * A shared surname inside one roster is NOT sufficient on its own, which cost
 * two wrong faces before this existed: North Dakota St. has a Treyson Anderson
 * we track and a Garrett Anderson ESPN lists, each unmatched and each unique,
 * and the reconciliation happily married them. Same for Damari Wheeler-Thomas
 * and Reggie Thomas. Uniqueness rules out swapping two brothers; it does
 * nothing about two strangers.
 *
 * So the given names have to agree too, by one of three tests that a real
 * variant passes and a different person does not:
 *   - one is a prefix of the other  (Vince/Vincent, Somto/Somtochukwu)
 *   - they differ by a single character  (Pharell/Pharrell)
 *   - they are a known short form  (Mike/Michael, Drew/Andrew)
 *
 * Genuine nicknames that share nothing with the given name — "Butta" for
 * Efrem, "Spudd" for Tavarus — deliberately fail here. They are real, but
 * they are unguessable, and the cost of guessing wrong is a photo of someone
 * else. Those belong in PLAYER_ALIASES where a human has signed off.
 */
const SHORT_FORMS = [
  ["michael", "mike"], ["joseph", "joe"], ["andrew", "drew"], ["robert", "bob"],
  ["william", "bill"], ["richard", "rick"], ["richard", "dick"], ["charles", "chuck"],
  ["anthony", "tony"], ["nicholas", "nick"], ["theodore", "ted"], ["edward", "ted"],
  ["james", "jim"], ["john", "jack"], ["lawrence", "larry"], ["kenneth", "ken"],
  ["donald", "don"], ["ronald", "ron"], ["patrick", "pat"], ["gregory", "greg"],
  ["timothy", "tim"], ["stephen", "steve"], ["steven", "steve"], ["daniel", "dan"],
  ["david", "dave"], ["thomas", "tom"], ["peter", "pete"], ["frederick", "fred"],
  ["francis", "frank"], ["walter", "walt"], ["albert", "al"], ["alexander", "alex"],
  ["charles", "charlie"], ["benjamin", "benji"],
];

function editDistance1(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function givenNamesAgree(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  if (editDistance1(a, b)) return true;
  return SHORT_FORMS.some(([full, short]) =>
    (a === full && b === short) || (a === short && b === full));
}

function givenKey(s) {
  return norm(s).split(" ")[0] ?? "";
}

/**
 * Last name only, suffixes dropped. Used exclusively for the within-roster
 * reconciliation pass, never as a primary key — on its own a surname is far
 * too weak to join on.
 */
function surnameKey(s) {
  const toks = norm(s).split(" ").filter((t) => !/^(jr|sr|ii|iii|iv|v|vi|lll|ll)$/.test(t));
  return toks[toks.length - 1] ?? "";
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

// Per-player name aliases. Key = normalized ESPN name, value = normalized Bart
// name (must match `norm(bartPlayer.name)` exactly).
//
// Two kinds live here. The first is a suffix ESPN carries and Bart strips.
// The second is a nickname that shares nothing with the given name, which the
// surname reconciliation refuses on purpose — "Butta" is not derivable from
// "Efrem" by any rule that wouldn't also derive "Garrett" from "Treyson", and
// getting that wrong publishes a photo of a different person. So they land
// here instead, one line each, confirmed by a human rather than inferred.
//
// Confirmed 2026-08-12.
const PLAYER_ALIASES = {
  "mj collins jr": "mj collins",

  // Nicknames — same player, unguessable given name.
  "butta johnson":    "efrem johnson",         // Clemson
  "spudd webb":       "tavarus webb",          // Georgia Southern
  "cash chavis":      "casmir chavis",         // UT Arlington
  "tj cope":          "tavaj cope",            // New Orleans
  "tae blackshear":   "rontavious blackshear", // Youngstown St.
  "bj roy":           "brandon roy jr",        // Washington
  "chabi barre":      "halil barre",           // Akron
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
  const missLog = [];
  let surnameRescues = 0;
  let surnameRejected = 0;
  const bartRosterPlayers = new Map();
  const bartRosterNames = new Map();
  const bartByTeamPlayer = new Map();
  for (const p of bartPlayers) {
    if (!p.bart_player_id) continue;
    if (!bartRosterNames.has(p.team_id)) bartRosterNames.set(p.team_id, []);
    bartRosterNames.get(p.team_id).push(p.name);
    if (!bartRosterPlayers.has(p.team_id)) bartRosterPlayers.set(p.team_id, []);
    bartRosterPlayers.get(p.team_id).push(p);
    bartByTeamPlayer.set(`${p.team_id}|${norm(p.name)}`, p);
    bartByTeamPlayer.set(`${p.team_id}|${normTight(p.name)}`, p);
    // Third key: suffix-tolerant. norm/normTight both carry trailing suffixes
    // through, so Bart's "Ace Glass lll" (a lowercase-L homoglyph for III)
    // could never meet ESPN's "Ace Glass". Kept in its own namespace so a
    // stripped name can never shadow a real one, and skipped when two players
    // on the roster collapse to it.
    const pk = `${p.team_id}|pk:${playerKey(p.name)}`;
    if (!bartByTeamPlayer.has(pk)) bartByTeamPlayer.set(pk, p);
    else if (bartByTeamPlayer.get(pk)?.bart_player_id !== p.bart_player_id) bartByTeamPlayer.set(pk, null);
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

  /**
   * Download + optimize one athlete's headshot onto a Bart id. Pulled out of
   * the athlete loop so the surname reconciliation pass below can reuse it
   * rather than growing a second copy of the sharp/caching logic.
   */
  async function claim(bart, href) {
    matchedAthletes++;
    const pngPath = path.join(PUB, `${bart.bart_player_id}.png`);
    const webpPath = path.join(PUB, `${bart.bart_player_id}.webp`);
    const thumbPath = path.join(PUB, `${bart.bart_player_id}-sm.webp`);

    // Cache signal is the webp (canonical asset), not the png (intermediate).
    if (existsSync(webpPath) && existsSync(thumbPath)) {
      cached++;
      photoMap[bart.bart_player_id] = `/images/players/${bart.bart_player_id}.webp`;
      return;
    }

    const r = await downloadImage(href, pngPath);
    if (r.bytes) downloaded++;
    else { failed++; return; }
    try {
      await optimize(pngPath, webpPath, thumbPath);
      photoMap[bart.bart_player_id] = `/images/players/${bart.bart_player_id}.webp`;
      // Drop the PNG — webp is canonical. Avoids ~1 GB of dead originals.
      await fs.unlink(pngPath).catch(() => {});
    } catch (e) {
      console.log(`   ⚠ sharp failed for ${bart.bart_player_id}: ${e.message}`);
    }
  }

  for (const [bartTeamId, { espnId, bartName }] of espnByBartId.entries()) {
    const res = await throttledGet(`${ESPN_BASE}/teams/${espnId}/roster`);
    if (!res.ok) {
      console.log(`   ✗ ${bartName} (espn=${espnId}): HTTP ${res.status}`);
      continue;
    }
    const j = await res.json();
    const athletes = j?.athletes ?? [];
    rostersDone++;

    const claimedBart = new Set();
    const leftoverAthletes = [];

    for (const a of athletes) {
      if (!a.headshot?.href) continue;
      // Try exact-norm match first, then fall back to tight-norm to catch
      // "P.J. Haggerty" / "PJ Haggerty" style mismatches. Then check the
      // PLAYER_ALIASES map for explicit overrides like "mj collins jr".
      const espnNorm = norm(a.displayName);
      const bart = bartByTeamPlayer.get(`${bartTeamId}|${espnNorm}`)
        ?? bartByTeamPlayer.get(`${bartTeamId}|${normTight(a.displayName)}`)
        ?? (PLAYER_ALIASES[espnNorm] && bartByTeamPlayer.get(`${bartTeamId}|${PLAYER_ALIASES[espnNorm]}`))
        ?? bartByTeamPlayer.get(`${bartTeamId}|pk:${playerKey(a.displayName)}`);
      if (!bart) {
        nameMisses++;
        leftoverAthletes.push(a);
        // With PHOTO_DUMP_MISSES=1, record what ESPN called them and what we
        // had on that roster, so a miss can be diagnosed without guessing at
        // the name variant. Writing the Bart side too is the point: the miss is
        // a disagreement, and only one half of it is visible from here.
        if (process.env.PHOTO_DUMP_MISSES === "1") {
          missLog.push({
            espn: a.displayName,
            team: bartName,
            bartRoster: bartRosterNames.get(bartTeamId) ?? [],
          });
        }
        continue;
      }
      claimedBart.add(bart.bart_player_id);
      await claim(bart, a.headshot.href);
    }

    // ---- Second pass: reconcile on surname within this one roster.
    //
    // The remaining misses are given-name variants that no normalizer should
    // try to guess at — Bart's "Efrem Johnson" is ESPN's "Butta Johnson", and
    // "Tavarus Webb" is "Spudd Webb". A nickname dictionary would cover this
    // season and rot by the next one.
    //
    // A surname inside a single roster is a much stronger key than it looks:
    // both sides are already known to be the same team, so the only way to be
    // wrong is two same-surname players on one roster. So require the surname
    // to be unique on BOTH sides among who is still unclaimed, and skip it
    // otherwise — brothers stay unmatched rather than get swapped.
    const bySurname = (list, nameOf) => {
      const m = new Map();
      for (const x of list) {
        const k = surnameKey(nameOf(x));
        if (!k) continue;
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(x);
      }
      return m;
    };
    const espnLeft = bySurname(leftoverAthletes, (a) => a.displayName);
    const bartLeft = bySurname(
      (bartRosterPlayers.get(bartTeamId) ?? []).filter((p) => !claimedBart.has(p.bart_player_id)),
      (p) => p.name,
    );
    for (const [k, espnCands] of espnLeft) {
      const bartCands = bartLeft.get(k);
      if (espnCands.length !== 1 || !bartCands || bartCands.length !== 1) continue;
      if (!givenNamesAgree(givenKey(bartCands[0].name), givenKey(espnCands[0].displayName))) {
        surnameRejected++;
        if (process.env.PHOTO_VERBOSE === "1") {
          console.log(`   x ${bartName}: "${bartCands[0].name}" vs ESPN "${espnCands[0].displayName}" — given names disagree, skipped`);
        }
        continue;
      }
      surnameRescues++;
      if (process.env.PHOTO_VERBOSE === "1") {
        console.log(`   ~ ${bartName}: "${bartCands[0].name}" <- ESPN "${espnCands[0].displayName}"`);
      }
      await claim(bartCands[0], espnCands[0].headshot.href);
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
  console.log(`  surname rescues:      ${surnameRescues}`);
  console.log(`  surname rejected:     ${surnameRejected} (same surname, different given name)`);
  if (process.env.PHOTO_DUMP_MISSES === "1") {
    await fs.writeFile(".photo-misses.json", JSON.stringify(missLog, null, 1));
    console.log(`  wrote .photo-misses.json (${missLog.length})`);
  }
  console.log(`  player-photos.json:   ${Object.keys(photoMap).length} entries`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
