/**
 * audit-rosters.mjs — ONE-TIME reconciliation of our 2026-27 preview rosters
 * against each school's OFFICIAL athletics-site roster (the only source that's
 * current pre-season; Bart AND ESPN both still list departed players in the
 * offseason). Rosters are finalized, so this runs once and the result is stored
 * — NOT part of the daily refresh.
 *
 * Domain map: we borrow the school→site map from Sports-Roster-Data's public
 * women's-basketball dataset (github.com/Sports-Roster-Data). Its teams.csv has
 * every D-I athletics domain plus a `stats_name` column in our exact Bart naming
 * ("James Madison", "Kansas St."). Men's and women's share the same athletics
 * domain, so we swap the sport token (womens-basketball → mens-basketball) to get
 * the men's roster URL. Most schools run Sidearm, whose roster page carries a
 * uniform player-link pattern (/sports/mens-basketball/roster/<slug>/<id>).
 *
 * Output:
 *   public/data/official-rosters-2026.json  → { generated_at, source,
 *       teams: { <ourTeamName>: { url, players:[{name,slug}] } } }
 *   scratchpad/roster-audit-missing.txt      → teams we could NOT resolve/scrape
 *       (no domain match, URL swap failed, or 0 players) — hand-fill these URLs.
 *
 * Run: node scripts/audit-rosters.mjs
 *      node scripts/audit-rosters.mjs --overrides overrides.json   (manual URLs)
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const DATA = path.resolve("public/data");
const OUT = path.join(DATA, "official-rosters-2026.json");
const MISSING = path.resolve("roster-audit-missing.txt");
const WBB_TEAMS = "https://raw.githubusercontent.com/Sports-Roster-Data/womens-college-basketball/main/teams.csv";

function normTeam(s) {
  return (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/\buniversity\b|\bthe\b/g, "").replace(/\bstate\b/g, "st")
    .replace(/[^a-z0-9]+/g, "").trim();
}

// Our team name → the name the women's dataset uses, for the ~dozen schools
// where they differ (verified exact matches, no fuzzy guessing).
const ALIASES = {
  "Connecticut": "UConn",
  "Saint Mary's": "Saint Mary's (CA)",
  "St. Thomas": "St. Thomas (MN)",
  "Cal Baptist": "California Baptist",
  "Lindenwood": "Lindenwood (MO)",
  "Queens": "Queens (NC)",
  "Loyola MD": "Loyola-Maryland",
  "Grambling St.": "Grambling",
  "Charleston": "College of Charleston",
  "Cal St. Northridge": "CSUN",
  "Nebraska Omaha": "Omaha",
  "UMKC": "Kansas City",
  "Tennessee Martin": "UT Martin",
  "IU Indy": "IUPUI",
};

function parseCsv(text) {
  const rows = [];
  let row = [], cur = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += ch; }
    else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n") { row.push(cur.replace(/\r$/, "")); rows.push(row); row = []; cur = ""; }
    else cur += ch;
  }
  if (cur !== "" || row.length) { row.push(cur.replace(/\r$/, "")); rows.push(row); }
  return rows;
}

const curl = (url) =>
  execFileSync("curl", ["-sL", "--max-time", "25", "-H", `user-agent: ${UA}`, "-H", "accept: text/html", url],
    { encoding: "utf8", maxBuffer: 48 * 1024 * 1024 });

// Women's sport URL → candidate men's ROSTER urls. The dataset stores the sport
// base (…/sports/womens-basketball, no /roster). Most sites use the mirror men's
// token, but some differ (Clemson: women's "w-basketball" but men's
// "mens-basketball"), so we return several candidates to try in order and append
// /roster (the bare landing page has no player links).
const MENS_TOKENS = ["mens-basketball", "mbball", "m-basketball", "m-baskbl", "mbb"];
function mensCandidates(url) {
  const base = url.replace(/\/$/, "");
  // Locate the women's sport segment (…/<seg>/… where seg names basketball).
  const seg = base.match(/\/(sports?\/)?([a-z0-9_-]*(?:basketball|baskbl|bball|bb))(\/|$)/i);
  const cands = [];
  if (seg) {
    const [, sportsPrefix = "", token] = seg;
    for (const mt of MENS_TOKENS) {
      const rebuilt = base.replace(`${sportsPrefix}${token}`, `${sportsPrefix}${mt}`);
      if (rebuilt !== base || token === mt) cands.push(rebuilt);
    }
  }
  // Fallback: naive global swaps (covers odd paths the segment regex misses).
  cands.push(base.replace(/womens/g, "mens").replace(/w-baskbl/g, "m-baskbl").replace(/wbball/g, "mbball"));
  // Dedup, ensure /roster suffix.
  return [...new Set(cands)].map((u) => (/\/roster$/.test(u) ? u : `${u}/roster`));
}

// Slug ("paul-jones-iii") → display-ish name ("Paul Jones Iii") for matching.
// Only used to normalize; exact display casing isn't important for the join.
function slugToName(slug) {
  return slug.split("-").map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join(" ");
}

// Pull player slugs from a Sidearm/Presto roster page. The canonical Sidearm
// pattern is /sports/mens-basketball/roster/<slug>/<id>; some sites drop the id
// or use /roster/season/2026-27/<slug>. Grab any roster/<slug> segment that
// isn't a known non-player token.
const NON_PLAYER = new Set(["coaches", "staff", "season", "print", "roster", "coach", "player"]);
function extractPlayers(html) {
  const found = new Map(); // slug -> name
  // On the men's roster page, player hrefs come in a few Sidearm shapes:
  //   /roster/<slug>[/id]                     (classic)
  //   /roster/player/<slug>                   (newer React roster)
  //   /roster/season/2026-27/<slug>           (season-scoped)
  // Staff live under …/roster/season/YYYY-YY/staff/<slug> — excluded because the
  // capture lands on "staff" (no hyphen → filtered), never the staffer's slug.
  const re = /\/roster\/(?:season\/[0-9-]+\/)?(?:player\/)?([a-z][a-z0-9-]{2,})(?:\/(\d+))?/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const slug = m[1].toLowerCase();
    if (NON_PLAYER.has(slug) || /^\d+$/.test(slug) || !slug.includes("-")) continue;
    if (!found.has(slug)) found.set(slug, slugToName(slug));
  }
  return [...found.entries()].map(([slug, name]) => ({ slug, name }));
}

async function main() {
  const overridesArg = process.argv.indexOf("--overrides");
  const overrides = overridesArg > -1 ? JSON.parse(fs.readFileSync(process.argv[overridesArg + 1], "utf8")) : {};

  // Our 2026-27 preview teams (the universe we must cover).
  const preview = JSON.parse(fs.readFileSync(path.join(DATA, "season-preview.json"), "utf8"));
  const ourTeams = Object.keys(preview.teams);
  console.log(`our preview teams: ${ourTeams.length}`);

  // Domain map from the women's dataset.
  console.log("downloading school→domain map…");
  const rows = parseCsv(curl(WBB_TEAMS));
  const head = rows[0].map((h) => h.trim());
  const ci = (n) => head.indexOf(n);
  const iTeam = ci("team"), iUrl = ci("url"), iStats = ci("stats_name"), iDiv = ci("division");
  const urlByNorm = new Map(); // normTeam(stats_name||team) -> [candidate mens urls]
  for (const r of rows.slice(1)) {
    if ((r[iDiv] ?? "").trim() !== "I") continue;
    const url = (r[iUrl] ?? "").trim();
    if (!url) continue;
    const cands = mensCandidates(url);
    for (const key of [r[iStats], r[iTeam]]) {
      const k = normTeam(key);
      if (k && !urlByNorm.has(k)) urlByNorm.set(k, cands);
    }
  }
  console.log(`domain map: ${urlByNorm.size} normalized keys`);

  const out = {};
  const missingUrl = [], scrapeEmpty = [];
  let ok = 0, done = 0;
  for (const team of ourTeams) {
    done++;
    process.stdout.write(`\r  ${done}/${ourTeams.length} — ${ok} ok   `);
    const ov = overrides[team];
    const candidates = ov ? [ov] : (urlByNorm.get(normTeam(team)) ?? urlByNorm.get(normTeam(ALIASES[team])));
    if (!candidates) { missingUrl.push(team); continue; }
    // Try candidate men's URLs in order; take the first that yields real players.
    let best = { url: candidates[0], players: [] };
    for (const url of candidates) {
      let players = [];
      try { players = extractPlayers(curl(url)); } catch { /* timeout → next */ }
      if (players.length > best.players.length) best = { url, players };
      if (best.players.length >= 7) break; // healthy roster — stop early
    }
    if (best.players.length === 0) { scrapeEmpty.push(`${team}\t${candidates[0]}`); continue; }
    out[team] = { url: best.url, players: best.players };
    ok++;
  }
  console.log(`\n\nresolved+scraped: ${ok}/${ourTeams.length}`);
  console.log(`no domain match:  ${missingUrl.length}`);
  console.log(`scraped 0 players: ${scrapeEmpty.length}`);

  fs.writeFileSync(OUT, JSON.stringify({
    generated_at: new Date().toISOString(),
    source: "official athletics sites (Sidearm/Presto); domain map via Sports-Roster-Data women's dataset",
    teams: out,
  }));
  console.log(`\n✓ wrote ${OUT}`);

  const lines = [
    "# Teams needing a manual men's-basketball roster URL",
    "# Format: paste `Team Name<TAB>https://...roster` lines into an overrides.json",
    "# ({ \"Team Name\": \"url\" }) and re-run:  node scripts/audit-rosters.mjs --overrides overrides.json",
    "",
    "## No domain match (school not in the map):",
    ...missingUrl.map((t) => t),
    "",
    "## URL resolved but scraped 0 players (non-Sidearm layout or wrong swap):",
    ...scrapeEmpty,
  ];
  fs.writeFileSync(MISSING, lines.join("\n"));
  console.log(`✓ wrote ${MISSING} (${missingUrl.length + scrapeEmpty.length} teams to hand-fill)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
