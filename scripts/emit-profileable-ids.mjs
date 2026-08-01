/**
 * emit-profileable-ids.mjs — writes the set of bart_player_ids that have a
 * profile page (i.e. routes the box-score modal can link to). Mirrors the
 * logic in src/lib/static-data.ts::readRankedPlayerIds, but materialized as a
 * client-readable static JSON so we don't have to ship the rank-set to the
 * browser inline.
 *
 * Three sources, unioned — the same three, in the same order, as
 * readRankedPlayerIds():
 *   1. Cohort-ranked players — every file in public/data/player-ranks/.
 *   2. Freshmen — any bart_player_id whose most-recent appearance in
 *      players-by-year/<year>.json carries class === "Fr".
 *   3. MANUAL_PROFILE_IDS — hand-picked pages that clear neither bar.
 *
 * Rule 3 was missing until 2026-07-31, so Tommy Murr had a profile page that
 * the box-score modal would not link to: generateStaticParams built the route
 * from readRankedPlayerIds (which includes him) while the modal asked this file
 * (which did not). One id today, but the failure is silent by construction —
 * a page that exists and is unreachable looks exactly like a player who never
 * had one.
 *
 * Output: public/data/profileable-ids.json (sorted integer array).
 */

import fs from "node:fs/promises";
import path from "node:path";

const DATA = path.resolve("public/data");
const RANKS_DIR = path.join(DATA, "player-ranks");
const YEARS_DIR = path.join(DATA, "players-by-year");
const OUT = path.join(DATA, "profileable-ids.json");

async function main() {
  const ids = new Set();

  // 1. Cohort-ranked players.
  try {
    const files = await fs.readdir(RANKS_DIR);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const n = parseInt(f.replace(".json", ""), 10);
      if (Number.isFinite(n)) ids.add(n);
    }
  } catch {}
  const rankedCount = ids.size;

  // 2. Freshmen — most-recent season class === "Fr".
  const latestByBartId = new Map();
  const yearFiles = await fs.readdir(YEARS_DIR);
  for (const f of yearFiles) {
    if (!f.endsWith(".json")) continue;
    const year = parseInt(f.replace(".json", ""), 10);
    if (!Number.isFinite(year)) continue;
    let list;
    try {
      list = JSON.parse(await fs.readFile(path.join(YEARS_DIR, f), "utf8"));
    } catch { continue; }
    for (const p of list) {
      const bartId = p.bart_player_id;
      if (bartId == null || !Number.isFinite(bartId)) continue;
      const prev = latestByBartId.get(bartId);
      if (!prev || prev.year < year) {
        latestByBartId.set(bartId, { year, cls: p.class ?? null });
      }
    }
  }
  let freshmenAdded = 0;
  for (const [bartId, latest] of latestByBartId) {
    if (latest.cls === "Fr" && !ids.has(bartId)) {
      ids.add(bartId);
      freshmenAdded++;
    }
  }

  // 3. Hand-picked pages. Keep in sync with MANUAL_PROFILE_IDS in
  //    src/lib/static-data.ts and scripts/prune-search-index.mjs — the list is
  //    duplicated rather than imported because this is plain .mjs and those are
  //    TypeScript; a drift here unlinks a page that still builds.
  const MANUAL_PROFILE_IDS = [73737]; // Tommy Murr (Lipscomb) — requested by hand
  let manualAdded = 0;
  for (const id of MANUAL_PROFILE_IDS) if (!ids.has(id)) { ids.add(id); manualAdded++; }

  const sorted = [...ids].sort((a, b) => a - b);
  await fs.writeFile(OUT, JSON.stringify(sorted));
  console.log(`ranked players:    ${rankedCount}`);
  console.log(`freshmen added:    ${freshmenAdded}`);
  console.log(`manual added:      ${manualAdded}`);
  console.log(`total profileable: ${sorted.length}`);
  console.log(`wrote ${OUT} (${(JSON.stringify(sorted).length / 1024).toFixed(1)} KB)`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
