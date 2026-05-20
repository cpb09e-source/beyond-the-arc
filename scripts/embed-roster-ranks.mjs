#!/usr/bin/env node
/**
 * Embed per-roster percentile ranks into every public/data/team/<slug>.json.
 *
 * Why: the team dossier roster table shows percentile chips next to each
 * player's stats. Naively, that means each of ~5,100 team-season pages reads
 * ~12 player-ranks/<bartId>.json files at build time. Next.js worker
 * processes don't share module cache, so a build-time bulk load also gets
 * duplicated across workers and blows the build budget.
 *
 * Fix: pre-compute `roster_ranks: { [bartId]: { bta_portg, pir, ... } }`
 * into each season's row in the team JSON. The team page renders chips
 * straight from `current.roster_ranks` — zero extra file reads at build
 * time.
 *
 * Idempotent: re-running re-derives roster_ranks from the current
 * player-ranks files and overwrites. Safe to re-run after sync:bart /
 * export:data.
 *
 * Run: node scripts/embed-roster-ranks.mjs
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), "public/data");
const TEAM_DIR = path.join(ROOT, "team");
const PLAYERS_BY_YEAR_DIR = path.join(ROOT, "players-by-year");
const RANKS_DIR = path.join(ROOT, "player-ranks");

// Stat keys → roster column. Same mapping as attachRosterRanks in
// team-page-view.tsx. Keep in sync if the roster columns change.
const STAT_KEYS = {
  bta_portg: "bta_portg",
  pir: "pir",
  pts: "pts_pg",
  reb: "reb_pg",
  ast: "ast_pg",
  fg3_pct: "fg3_pct",
  ft_pct: "ft_pct",
};

async function readJson(p) {
  return JSON.parse(await readFile(p, "utf8"));
}

async function main() {
  console.log("📂 Loading player-ranks…");
  const rankFiles = await readdir(RANKS_DIR);
  const ranksByBartId = new Map();
  let loaded = 0;
  for (const f of rankFiles) {
    if (!f.endsWith(".json")) continue;
    const bartId = parseInt(f.replace(".json", ""), 10);
    if (!Number.isFinite(bartId)) continue;
    try {
      const data = await readJson(path.join(RANKS_DIR, f));
      ranksByBartId.set(bartId, data);
      loaded++;
    } catch {
      // skip unreadable file
    }
  }
  console.log(`   loaded ${loaded.toLocaleString()} player-ranks files`);

  // Build: year → team_id → set of bart_player_ids on that team's roster.
  // Reads each players-by-year JSON exactly once, vs. per-team disk reads.
  console.log("\n📂 Indexing rosters by (year, team_id)…");
  const rosterByYearTeam = new Map(); // year -> teamId -> Set<bartId>
  const yearFiles = await readdir(PLAYERS_BY_YEAR_DIR);
  for (const f of yearFiles) {
    if (!f.endsWith(".json")) continue;
    const year = parseInt(f.replace(".json", ""), 10);
    if (!Number.isFinite(year)) continue;
    const players = await readJson(path.join(PLAYERS_BY_YEAR_DIR, f));
    const byTeam = new Map();
    for (const p of players) {
      const team = Array.isArray(p.teams) ? p.teams[0] : p.teams;
      if (!team) continue;
      const bartId = p.bart_player_id;
      if (bartId == null) continue;
      const set = byTeam.get(team.id) ?? new Set();
      set.add(bartId);
      byTeam.set(team.id, set);
    }
    rosterByYearTeam.set(year, byTeam);
  }
  console.log(`   indexed rosters for ${rosterByYearTeam.size} seasons`);

  // For each team JSON, look up roster bart_ids for each (year, team.id) and
  // emit roster_ranks { [bartId]: { bta_portg, pir, pts, reb, ast, fg3_pct,
  // ft_pct } }.
  console.log("\n📂 Embedding roster_ranks into team JSONs…");
  const teamFiles = (await readdir(TEAM_DIR)).filter((f) => f.endsWith(".json"));
  let updated = 0;
  let totalPlayersStamped = 0;
  for (const f of teamFiles) {
    const fp = path.join(TEAM_DIR, f);
    const team = await readJson(fp);
    if (!team.seasons || !Array.isArray(team.seasons)) continue;
    let mutated = false;
    for (const s of team.seasons) {
      const teamId = s.id;
      const year = s.year;
      const rosterIds = rosterByYearTeam.get(year)?.get(teamId);
      if (!rosterIds || rosterIds.size === 0) {
        // No players this season for this team — clear stale field if any.
        if (s.roster_ranks) { delete s.roster_ranks; mutated = true; }
        continue;
      }
      const rr = {};
      for (const bartId of rosterIds) {
        const ranks = ranksByBartId.get(bartId);
        const season = ranks?.seasonRanks?.find((sr) => sr.year === year);
        if (!season) continue;
        const stats = season.stats ?? {};
        const entry = {};
        let any = false;
        for (const [col, rankKey] of Object.entries(STAT_KEYS)) {
          const v = stats[rankKey]?.percentile;
          if (typeof v === "number") { entry[col] = v; any = true; }
        }
        if (any) { rr[bartId] = entry; totalPlayersStamped++; }
      }
      // Stable JSON key order — sort by bartId so re-runs produce byte-identical output.
      const sorted = {};
      for (const k of Object.keys(rr).map(Number).sort((a, b) => a - b)) sorted[k] = rr[k];
      s.roster_ranks = sorted;
      mutated = true;
    }
    if (mutated) {
      await writeFile(fp, JSON.stringify(team));
      updated++;
    }
  }
  console.log(`   updated ${updated.toLocaleString()} team JSONs (${totalPlayersStamped.toLocaleString()} player-seasons stamped)`);
  console.log("\n✓ Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
