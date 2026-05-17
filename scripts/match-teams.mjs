// One-off: match Bart team names to CBB Analytics D1 MALE teams,
// emit src/data/cbb-team-ids.json with {normalizedBartName: {id, market, name, color1, color2}}
import fs from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });

const rawPath = process.argv[2];
if (!rawPath) {
  console.error("Usage: node scripts/match-teams.mjs <path-to-cbb-teams-json>");
  process.exit(1);
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const raw = JSON.parse(fs.readFileSync(rawPath, "utf8"));
const cbb = raw.results.filter((t) => t.gender === "MALE" && t.divisionId === 1);
console.log(`CBB D1 MALE teams: ${cbb.length}`);

function norm(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Expanded normalization: rewrites common CBB-program abbreviations so
// "Cal St. Bakersfield" and "CSU Bakersfield" hash to the same key.
function normExpand(s) {
  return norm(s)
    .replace(/\bst\b/g, "state")
    .replace(/\bu\b/g, "university")
    .replace(/\buniv\b/g, "university")
    .replace(/\bcal state\b/g, "csu")
    .replace(/\bcal\b/g, "csu")            // "Cal Baptist" → "csu baptist" (CBB doesn't use, but harmless)
    .replace(/\bcalifornia state\b/g, "csu")
    .replace(/\bnorth carolina\b/g, "nc")
    .replace(/\bsouth carolina\b/g, "sc")
    .replace(/\bmississippi\b/g, "miss")
    .replace(/\btennessee\b/g, "tenn")
    .replace(/\bwashington\b/g, "wash")
    .replace(/\bcarolina\b/g, "caro")
    .replace(/\bmichigan\b/g, "mich")
    .replace(/\barizona\b/g, "ariz")
    .replace(/\billinois\b/g, "ill")
    .replace(/\bconnecticut\b/g, "uconn")
    .replace(/\bcentral connecticut\b/g, "central conn")
    .replace(/\bsouthern\b/g, "so")
    .replace(/\bnorthern\b/g, "n")
    .replace(/\bnortheast\b/g, "ne")
    .replace(/\bnorthwest\b/g, "nw")
    .replace(/\bsoutheast\b/g, "se")
    .replace(/\bsouthwest\b/g, "sw")
    .replace(/\beastern\b/g, "e")
    .replace(/\bwestern\b/g, "w")
    .replace(/\bappalachian\b/g, "app")
    .replace(/\bmilwaukee\b/g, "milw")
    .replace(/\bcollege of charleston\b/g, "charleston")
    .replace(/\bsaint\b/g, "st")
    .trim()
    .replace(/\s+/g, " ");
}

// Hand-coded fix-ups for cases the expanded normalizer can't catch.
// LHS = bart-normalized team name. RHS = a string we try to look up in
// cbbByKey (which is indexed by both norm() and normExpand() of teamMarket).
// User-confirmed mappings (from inspecting CBB's actual teamMarket strings)
// live at the bottom and override any earlier guess.
const MANUAL_ALIASES = {
  // Direct rename / nickname
  "albany": "ualbany",
  "umkc": "kansas city",
  "iupui": "iu indianapolis",
  "uic": "illinois chicago",
  "central conn st": "central connecticut",
  "central connecticut": "central connecticut",
  "illinois chicago": "uic",
  "fairleigh dickinson": "fdu",
  "florida atlantic": "fau",
  "florida gulf coast": "fgcu",
  "loyola md": "loyola maryland",
  "loyola maryland": "loyola md",
  "loyola marymount": "lmu",
  "mississippi": "ole miss",
  "nebraska omaha": "omaha",
  "north carolina state": "nc state",
  "nc state": "north carolina state",
  "n c state": "nc state",
  "ole miss": "mississippi",
  "south carolina state": "sc state",
  "st johns": "st johns ny",
  "st thomas": "st thomas mn",
  "monmouth": "monmouth nj",
  "miami": "miami fl",
  "army": "army west point",
  "boston university": "boston u",
  "central michigan": "central mich",
  "cal st northridge": "csun",
  "csu northridge": "csun",
  "cal baptist": "california baptist",
  "california baptist": "cal baptist",
  "east tennessee state": "etsu",
  "etsu": "east tennessee st",
  "eastern washington": "eastern wash",
  "eastern kentucky": "eastern ky",
  "eastern illinois": "eastern ill",
  "western carolina": "western caro",
  "western kentucky": "western ky",
  "northern arizona": "northern ariz",
  "northern colorado": "northern colo",
  "northern illinois": "northern ill",
  "southern illinois": "southern ill",
  "western illinois": "western ill",
  "western michigan": "western mich",
  "western kentucky": "western ky",
  "northern iowa": "northern iowa",
  "central arkansas": "central ark",
  "north dakota state": "n dakota state",
  "south dakota state": "s dakota state",
  "san jose state": "san jose state",
  "ut rio grande valley": "utrgv",
  "utrgv": "ut rio grande valley",
  "ut martin": "ut martin",
  "tennessee martin": "ut martin",
  "long island university": "liu",
  "liu brooklyn": "liu",
  "incarnate word": "incarnate word",
  "louisiana monroe": "ul monroe",
  "ul monroe": "louisiana monroe",
  "louisiana lafayette": "ul lafayette",
  "louisiana": "ul lafayette",
  "kennesaw state": "kennesaw state",
  "mississippi valley state": "ms valley state",
  "ms valley state": "mississippi valley state",
  "arkansas pine bluff": "ark pine bluff",
  "alcorn state": "alcorn",
  "alcorn st": "alcorn",
  "alcorn": "alcorn state",
  "grambling state": "grambling",
  "grambling st": "grambling",
  "grambling": "grambling state",
  "georgia southern": "georgia so",
  "georgia state": "georgia state",
  "mcneese state": "mcneese",
  "mcneese st": "mcneese",
  "saint francis pa": "st francis pa",
  "st francis pa": "saint francis pa",
  "lehigh": "lehigh",
  "lipscomb": "lipscomb",
  "houston christian": "houston christian",
  "tennessee tech": "tenn tech",
  "tenn tech": "tennessee tech",
  "tennessee state": "tenn state",
  "charleston": "college of charleston",
  "charleston southern": "charleston so",
  "florida international": "fiu",
  "fiu": "florida international",
  "uc santa barbara": "uc santa barbara",
  "uc irvine": "uc irvine",
  "uc riverside": "uc riverside",
  "uc davis": "uc davis",
  "uc san diego": "uc san diego",
  "hartford": "hartford",

  // === User-confirmed mappings (override anything above) ===
  "north alabama":            "north ala",
  "queens":                   "queens nc",
  "west georgia":             "west ga",
  "florida atlantic":         "fla atlantic",
  "south florida":            "south fla",
  "usc":                      "southern california",
  "st john s":                "st john s ny",      // apostrophe → space in norm()
  "charleston":               "col of charleston",
  "north carolina a t":       "n c a t",
  "unc wilmington":           "uncw",
  "sam houston st":           "sam houston",
  "northern kentucky":        "northern ky",
  "northern illinois":        "niu",
  "maryland eastern shore":   "umes",
  "north carolina central":   "n c central",
  "northern iowa":            "uni",
  "central connecticut":      "central conn st",
  "siu edwardsville":         "siue",
  "southeast missouri st":    "southeast mo st",
  "southern indiana":         "southern ind",
  "georgia southern":         "ga southern",
  "louisiana monroe":         "ulm",                // CBB actually uses "ULM"; "Louisiana" is already taken by UL Lafayette
  "east tennessee st":        "etsu",
  "mississippi valley st":    "mississippi val",
  "prairie view a m":         "prairie view",
  "southern":                 "southern u",
  "incarnate word":           "uiw",
  "lamar":                    "lamar university",
  "nicholls st":              "nicholls",
  "southeastern louisiana":   "southeastern la",
  "stephen f austin":         "sfa",
  "texas a m corpus chris":   "a m corpus christi",
  "loyola marymount":         "lmu ca",
  "saint mary s":             "saint mary s ca",   // apostrophe → space in norm()
  "st francis ny":            "st francis brooklyn",
  "seattle":                  "seattle u",
};

// CBB index by expanded-normalized name. Multiple original Bart names can hit
// the same key, so we keep them all and pick the first CBB record per key.
const cbbByKey = new Map();
for (const t of cbb) {
  cbbByKey.set(normExpand(t.teamMarket), t);
  // also index by raw normalized (for the alias map values that are raw-norm)
  cbbByKey.set(norm(t.teamMarket), t);
}

// Bart: distinct team names across all years (paginated)
const bartByNorm = new Map();
let from = 0;
while (true) {
  const { data, error } = await sb.from("teams").select("name").range(from, from + 999);
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) break;
  for (const r of data) bartByNorm.set(norm(r.name), r.name);
  if (data.length < 1000) break;
  from += 1000;
}
console.log(`Bart unique normalized names: ${bartByNorm.size}`);

function findCbb(bartNormName) {
  // 1) exact normalized
  let c = cbbByKey.get(bartNormName);
  if (c) return c;
  // 2) expanded normalized
  const expanded = normExpand(bartNormName);
  c = cbbByKey.get(expanded);
  if (c) return c;
  // 3) manual alias
  const aliased = MANUAL_ALIASES[bartNormName] ?? MANUAL_ALIASES[expanded];
  if (aliased) {
    c = cbbByKey.get(aliased) ?? cbbByKey.get(normExpand(aliased));
    if (c) return c;
  }
  return null;
}

// Match
const result = {};
const unmatchedBart = [];
const usedIds = new Set();
for (const [normName, bartName] of bartByNorm) {
  const c = findCbb(normName);
  if (c) {
    result[normName] = {
      bart_name: bartName,
      id: c.teamId,
      market: c.teamMarket,
      mascot: c.teamName,
      color1: c.hexColor1,
      color2: c.hexColor2,
      conf: c.conferenceShortName,
    };
    usedIds.add(c.teamId);
  } else {
    unmatchedBart.push(bartName);
  }
}
const unmatchedCbb = new Map();
for (const t of cbb) if (!usedIds.has(t.teamId)) unmatchedCbb.set(norm(t.teamMarket), t);

const outPath = path.resolve("src/data/cbb-team-ids.json");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
console.log(`\nMatched: ${Object.keys(result).length} of ${bartByNorm.size} Bart names (${((Object.keys(result).length / bartByNorm.size) * 100).toFixed(1)}%)`);
console.log(`Wrote ${outPath}`);
console.log(`\n--- First 25 unmatched Bart names ---`);
console.log(unmatchedBart.slice(0, 25).join("\n"));
console.log(`\n--- First 15 unmatched CBB names (likely renames / suffix differences) ---`);
console.log([...unmatchedCbb.values()].slice(0, 15).map((t) => t.teamMarket).join("\n"));
