/**
 * prune-search-index.mjs — drop player entries from search-index.json whose
 * profile page won't exist (so search never links to a 404).
 *
 * A player gets a page (see readRankedPlayerIds in src/lib/static-data.ts) iff:
 *   1. they have a rank file (cleared the leaderboard baseline), OR
 *   2. their most-recent season was a freshman year, OR
 *   3. they're in MANUAL_PROFILE_IDS (hand-picked).
 * The export writes search-index.json BEFORE ranks exist, so it can't apply
 * rule 1 — this runs AFTER compute-player-ranks and prunes the difference.
 *
 * Run AFTER compute-player-ranks: node scripts/prune-search-index.mjs
 * Keep MANUAL_PROFILE_IDS in sync with src/lib/static-data.ts.
 */
import fs from "node:fs";
import path from "node:path";

const DATA = path.resolve("public/data");
const MANUAL_PROFILE_IDS = new Set([73737]); // Tommy Murr (Lipscomb)

// 1. Ranked ids = every rank file on disk.
const ranked = new Set(
  fs.readdirSync(path.join(DATA, "player-ranks"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => parseInt(f.replace(".json", ""), 10))
    .filter(Number.isFinite),
);

// 2. Freshman-latest ids — most-recent season's class === "Fr".
const latestByBart = new Map();
for (let y = 2008; y <= 2026; y++) {
  const f = path.join(DATA, "players-by-year", `${y}.json`);
  if (!fs.existsSync(f)) continue;
  for (const p of JSON.parse(fs.readFileSync(f, "utf8"))) {
    const id = p.bart_player_id;
    if (id == null || !Number.isFinite(id)) continue;
    const prev = latestByBart.get(id);
    if (!prev || prev.year < y) latestByBart.set(id, { year: y, cls: p.class ?? null });
  }
}
const freshmanLatest = new Set();
for (const [id, l] of latestByBart) if (l.cls === "Fr") freshmanLatest.add(id);

const hasPage = (id) => ranked.has(id) || freshmanLatest.has(id) || MANUAL_PROFILE_IDS.has(id);

const SEARCH = path.join(DATA, "search-index.json");
const all = JSON.parse(fs.readFileSync(SEARCH, "utf8"));
let players = 0, removed = 0;
const pruned = all.filter((e) => {
  if (e.t !== "p") return true; // keep teams + coaches untouched
  players++;
  if (hasPage(e.b)) return true;
  removed++;
  return false;
});
fs.writeFileSync(SEARCH, JSON.stringify(pruned));
console.log(`search-index pruned: ${players} players in, ${removed} removed (no page), ${players - removed} kept`);
console.log(`  page set: ${ranked.size} ranked + ${freshmanLatest.size} freshman-latest + ${MANUAL_PROFILE_IDS.size} manual`);
