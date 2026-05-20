/**
 * emit-profileable-ids.mjs — writes the set of bart_player_ids that have a
 * profile page (i.e. routes the box-score modal can link to). Mirrors the
 * logic in src/lib/static-data.ts::readRankedPlayerIds, but materialized as a
 * client-readable static JSON so we don't have to ship the rank-set to the
 * browser inline.
 *
 * Two sources, unioned:
 *   1. Cohort-ranked players — every file in public/data/player-ranks/.
 *   2. Freshmen — any bart_player_id whose most-recent appearance in
 *      players-by-year/<year>.json carries class === "Fr".
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

  const sorted = [...ids].sort((a, b) => a - b);
  await fs.writeFile(OUT, JSON.stringify(sorted));
  console.log(`ranked players:    ${rankedCount}`);
  console.log(`freshmen added:    ${freshmenAdded}`);
  console.log(`total profileable: ${sorted.length}`);
  console.log(`wrote ${OUT} (${(JSON.stringify(sorted).length / 1024).toFixed(1)} KB)`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
