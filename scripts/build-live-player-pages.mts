/**
 * build-live-player-pages.mts — writes the live season's player pages as data.
 *
 * The player-side twin of build-live-team-pages.mts. Read
 * src/lib/live-player-page.ts for why a player bundle carries the whole page
 * rather than just the live row.
 *
 * ONLY PLAYERS WITH A ROW IN THE LIVE SEASON. About 5,000 of the 25,474 pages;
 * the other 20,000 are careers that ended and nothing about them moves again.
 * A page with no bundle never fetches one, so there is nothing to clean up for
 * a player who was active last season and is not this one.
 *
 * IT VERIFIES ITS OWN CODEC, like the team builder — decode the written JSON
 * again and deep-compare. PlayerPageData is a wide inferred type and the
 * failure mode of a lost field is not a crash but a panel that renders empty.
 * On the team side this check caught a real discrepancy on its first run.
 *
 * Usage:
 *   npx tsx scripts/build-live-player-pages.mts               # LIVE_SEASON
 *   npx tsx scripts/build-live-player-pages.mts --season 2026 # dry-run any season
 *   npx tsx scripts/build-live-player-pages.mts --season 2026 --limit 25
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { loadPlayerPageData } from "@/lib/player-page-data";
import { encodeLivePlayerPage, decodeLivePlayerPage } from "@/lib/live-player-page";
import { LIVE_SEASON } from "@/lib/seasons";
import { readRankedPlayerIds, readPlayer } from "@/lib/static-data";

const OUT_DIR = path.join(process.cwd(), "public", "data", "live", "player");

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i > -1 ? (process.argv[i + 1] ?? null) : null;
}

const seasonArg = arg("--season");
const season = seasonArg ? Number(seasonArg) : LIVE_SEASON;
if (season === null || !Number.isFinite(season)) {
  console.error(
    "No live season. LIVE_SEASON in src/lib/seasons.ts is null (no season is being played),\n" +
    "so there is nothing to build. Pass --season <year> to generate one anyway.",
  );
  process.exit(1);
}
const limitArg = arg("--limit");
const limit = limitArg ? Number(limitArg) : Infinity;

/** Structural equality for the round trip. Same rules as the team builder. */
function same(a: unknown, b: unknown, path_ = ""): string | null {
  if (a === b) return null;
  if (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b)) return null;
  if (a instanceof Map || a instanceof Set || b instanceof Map || b instanceof Set) {
    return `${path_}: a Map or Set reached the player bundle, which JSON cannot carry`;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return `${path_}: array vs non-array`;
    if (a.length !== b.length) return `${path_}: length ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const e = same(a[i], b[i], `${path_}[${i}]`);
      if (e) return e;
    }
    return null;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    // A key set to undefined and an absent key are the same thing here, and
    // only here: JSON.stringify drops the former, and every reader of these
    // fields tests them for truthiness. See the team builder's note.
    const ao = a as Record<string, unknown>, bo = b as Record<string, unknown>;
    for (const k of new Set([...Object.keys(ao), ...Object.keys(bo)])) {
      const e = same(ao[k], bo[k], `${path_}.${k}`);
      if (e) return e;
    }
    return null;
  }
  return `${path_}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
}

/**
 * The players to build: ranked (so the route exists at all) AND holding a row
 * in the live season.
 *
 * Both conditions matter. generateStaticParams only emits pages for ranked
 * players, so an unranked player's bundle would be a file nothing can fetch;
 * and a ranked player whose last season was 2019 has nothing that moves.
 */
const ranked = await readRankedPlayerIds();
console.log(`Building live player pages for ${season}\n  ${ranked.size.toLocaleString()} ranked players to check`);

const targets: number[] = [];
let checked = 0;
for (const id of ranked) {
  checked++;
  if (checked % 5000 === 0) console.log(`  checked ${checked.toLocaleString()}…`);
  const p = await readPlayer(id);
  if (p?.seasons.some((s) => s.year === season)) targets.push(id);
  if (targets.length >= limit) break;
}
console.log(`  ${targets.length.toLocaleString()} have a ${season} row\n`);

fs.mkdirSync(OUT_DIR, { recursive: true });
const builtAt = new Date().toISOString();

let written = 0, skipped = 0, bytes = 0;
const failures: string[] = [];

for (const id of targets) {
  const data = await loadPlayerPageData(id);
  if (!data) { skipped++; continue; }

  const json = JSON.stringify(encodeLivePlayerPage(data, builtAt));
  const roundTrip = decodeLivePlayerPage(JSON.parse(json));
  const err = same(data, roundTrip, String(id));
  if (err) { failures.push(err); continue; }

  fs.writeFileSync(path.join(OUT_DIR, `${id}.json`), json);
  written++;
  bytes += Buffer.byteLength(json);
  if (written % 500 === 0) console.log(`  ${written}/${targets.length}…`);
}

if (failures.length) {
  console.error(`\nCODEC MISMATCH on ${failures.length} player(s) — nothing about these files can be trusted:`);
  for (const f of failures.slice(0, 5)) console.error(`  ${f}`);
  process.exit(1);
}

console.log(`\n${written} files, ${(bytes / 1024 / 1024).toFixed(1)} MB, ~${Math.round(bytes / Math.max(written, 1) / 1024)} KB each`);
if (skipped) console.log(`${skipped} had no page data`);
console.log(`→ public/data/live/player/`);
