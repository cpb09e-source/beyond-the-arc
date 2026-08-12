#!/usr/bin/env node
/**
 * refresh-preview-links.mjs — recompute the `link` flag on every
 * season-preview.json roster row, in place, no network.
 *
 * WHAT WENT WRONG. `link` decides whether a preview roster renders a player's
 * name as a link to /players/<id>/. It is baked into season-preview.json when
 * the builder runs. Which profile pages EXIST is decided separately, at build
 * time, by readRankedPlayerIds — essentially "does public/data/player-ranks/
 * <id>.json exist". Those two answers drift apart the moment the rank files are
 * rebuilt without rebuilding the preview, and the builder cannot be rebuilt:
 * it pulls Bart's living offseason feed and the freeze holds until 2026-10-01.
 *
 * Measured before this script existed: 150 rows linked to a page that no longer
 * exists (Iowa's Isaia Howard, /players/126574/ — a hard 404 in production and
 * a "missing param in generateStaticParams" screen in dev), and 436 players who
 * do have a page were rendered as plain text.
 *
 * SECOND BUG, in the builder's own rule. hasPage() there reads
 *   rankedSet.has(id) || cls === "Fr"
 * but `cls` on a preview row is the class ADVANCED one year — a 2025-26
 * freshman is "So" on his 2026-27 row. readRankedPlayerIds' freshman pass looks
 * at the class of the player's most recent ACTUAL season, so every current
 * freshman failed the builder's test and got no link despite having a page.
 * That is most of the 436. The rule below mirrors readRankedPlayerIds instead
 * of approximating it, and build-season-preview.mjs has been corrected to match.
 *
 * Keep in sync with readRankedPlayerIds in src/lib/static-data.ts:
 *   a rank file exists, OR the player's latest season class is "Fr",
 *   OR the id is in MANUAL_PROFILE_IDS.
 *
 * Idempotent. Refuses to write if the rank directory comes back empty, so a
 * bad read cannot strip every link on the site's 365 preview pages.
 *
 *   Run: node scripts/refresh-preview-links.mjs [--dry]
 */
import fs from "node:fs";
import path from "node:path";

const DATA = path.resolve("public/data");
const FILE = path.join(DATA, "season-preview.json");
const DRY = process.argv.includes("--dry");

// Mirrors FRESHMAN_SCAN_START_YEAR / MANUAL_PROFILE_IDS in static-data.ts.
const FRESHMAN_SCAN_START_YEAR = 2013;
const MANUAL_PROFILE_IDS = [73737]; // Tommy Murr (Lipscomb)

const doc = JSON.parse(fs.readFileSync(FILE, "utf8"));
const PREV_YEAR = doc.season - 1;

const ranked = new Set(
  fs.readdirSync(path.join(DATA, "player-ranks"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => parseInt(f, 10))
    .filter(Number.isFinite),
);
if (ranked.size === 0) {
  console.error("✗ player-ranks/ is empty — refusing to unlink every roster.");
  process.exit(1);
}
const rankFiles = ranked.size;

// Freshman pass: latest (year, class) per bart id; latest class "Fr" ⇒ page.
const latestByBartId = new Map();
for (let year = FRESHMAN_SCAN_START_YEAR; year <= PREV_YEAR; year++) {
  let list;
  try { list = JSON.parse(fs.readFileSync(path.join(DATA, "players-by-year", `${year}.json`), "utf8")); }
  catch { continue; }
  for (const p of list) {
    const id = p.bart_player_id;
    if (id == null || !Number.isFinite(id)) continue;
    const prev = latestByBartId.get(id);
    if (!prev || prev.year < year) latestByBartId.set(id, { year, cls: p.class ?? null });
  }
}
let freshmanAdds = 0;
for (const [id, latest] of latestByBartId) {
  if (latest.cls === "Fr" && !ranked.has(id)) { ranked.add(id); freshmanAdds++; }
}
for (const id of MANUAL_PROFILE_IDS) ranked.add(id);

console.log(`profile pages: ${ranked.size}  (${rankFiles} rank files + ${freshmanAdds} freshmen + ${MANUAL_PROFILE_IDS.length} manual)`);

let rows = 0, nowLinked = 0, fixedBroken = 0, fixedMissing = 0;
const broke = [], added = [];
for (const [teamName, team] of Object.entries(doc.teams ?? {})) {
  for (const row of team.roster ?? []) {
    rows++;
    const should = row.bart_id != null && ranked.has(row.bart_id);
    if (row.link === true && !should) {
      fixedBroken++;
      if (broke.length < 6) broke.push(`${teamName}: ${row.name} (/players/${row.bart_id}/)`);
    } else if (row.link !== true && should) {
      fixedMissing++;
      if (added.length < 6) added.push(`${teamName}: ${row.name} (/players/${row.bart_id}/)`);
    }
    row.link = should;
    if (should) nowLinked++;
  }
}

console.log(`roster rows:      ${rows}`);
console.log(`  linked now:     ${nowLinked}`);
console.log(`  dead links cut: ${fixedBroken}`);
if (broke.length) console.log(broke.map((e) => `    ${e}`).join("\n"));
console.log(`  links restored: ${fixedMissing}`);
if (added.length) console.log(added.map((e) => `    ${e}`).join("\n"));

if (DRY) { console.log("\n--dry: nothing written."); process.exit(0); }
doc.links_refreshed_at = new Date().toISOString();
fs.writeFileSync(FILE, JSON.stringify(doc));
console.log(`\n✓ rewrote ${FILE}`);
