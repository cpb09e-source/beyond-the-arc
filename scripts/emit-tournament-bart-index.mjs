/**
 * emit-tournament-bart-index.mjs — builds the lookup the tournament box-score
 * modal needs to link player names to their /players/<bart_id> profile pages.
 *
 * Input:  public/data/tournament-box/<year>/<slug>.json  (SR scrape — no IDs)
 *         public/data/players-by-year/<year>.json        (Bart data — has IDs)
 *
 * Output: public/data/tournament-bart-index.json — a flat object keyed by
 *         "<year>|<normTeam>|<normName>" → bart_player_id. The modal loads
 *         this once per page session and resolves each player row to a link
 *         when the key matches AND the bartId is in profileable-ids.json.
 *
 * Why a single combined file (vs per-year) — opening any tournament box score
 * is a low-frequency event and the combined output is small enough (a few
 * hundred KB) that one fetch beats orchestrating per-year fallback paths.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const DATA = path.resolve("public/data");
const TOURN_DIR = path.join(DATA, "tournament-box");
const YEARS_DIR = path.join(DATA, "players-by-year");
const OUT = path.join(DATA, "tournament-bart-index.json");

function normName(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/i, "");
}
function normTeam(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

async function main() {
  if (!existsSync(TOURN_DIR)) {
    console.error("No tournament-box directory at", TOURN_DIR);
    process.exit(1);
  }
  const yearDirs = (await fs.readdir(TOURN_DIR))
    .map((y) => ({ year: parseInt(y, 10), dir: path.join(TOURN_DIR, y) }))
    .filter((e) => Number.isFinite(e.year));
  console.log(`tournament-box years: ${yearDirs.length}`);

  const out = {};
  let resolved = 0, unresolved = 0;

  for (const { year, dir } of yearDirs) {
    // Build a name→bart_player_id map for this year from players-by-year.
    // Key by `<normTeam>|<normName>` so per-team lookups are fast.
    const playersFile = path.join(YEARS_DIR, `${year}.json`);
    if (!existsSync(playersFile)) {
      console.warn(`  ${year}: no players-by-year file — skipping`);
      continue;
    }
    const players = JSON.parse(await fs.readFile(playersFile, "utf8"));
    const yearMap = new Map();
    for (const p of players) {
      if (p.bart_player_id == null || !Number.isFinite(p.bart_player_id)) continue;
      const teams = Array.isArray(p.teams) ? p.teams : [p.teams];
      for (const t of teams) {
        if (!t?.name) continue;
        yearMap.set(`${normTeam(t.name)}|${normName(p.name)}`, p.bart_player_id);
      }
    }

    // Walk every tournament box score in this year, look up bart_player_id
    // for each player by (team, normalized name).
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json"));
    let yearResolved = 0, yearMissed = 0;
    for (const f of files) {
      let box;
      try { box = JSON.parse(await fs.readFile(path.join(dir, f), "utf8")); }
      catch { continue; }
      if (!Array.isArray(box.teams)) continue;
      for (const t of box.teams) {
        if (!Array.isArray(t.players)) continue;
        for (const pl of t.players) {
          if (!pl.name) continue;
          const key = `${normTeam(t.name)}|${normName(pl.name)}`;
          const bartId = yearMap.get(key);
          if (bartId != null) {
            out[`${year}|${normTeam(t.name)}|${normName(pl.name)}`] = bartId;
            yearResolved++;
          } else {
            yearMissed++;
          }
        }
      }
    }
    resolved += yearResolved;
    unresolved += yearMissed;
    console.log(`  ${year}: ${yearResolved} resolved, ${yearMissed} missed (${files.length} games)`);
  }

  await fs.writeFile(OUT, JSON.stringify(out));
  const sizeKb = (JSON.stringify(out).length / 1024).toFixed(1);
  console.log(`\nresolved:   ${resolved}`);
  console.log(`unresolved: ${unresolved}`);
  console.log(`index keys: ${Object.keys(out).length}`);
  console.log(`wrote ${OUT} (${sizeKb} KB)`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
