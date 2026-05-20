/**
 * audit-missing-players.mts — for every (year, team) where a box score is
 * missing players (per audit-boxscore-coverage), list the actual player
 * names that have a Bart profile claiming the team-year but have NO
 * player-games file. These are the players being dropped silently.
 *
 * Run: npx tsx scripts/audit-missing-players.mts
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const PLAYER_DIR = path.resolve("public/data/player");
const PLAYER_GAMES_DIR = path.resolve("public/data/player-games");

type PlayerProfile = {
  seasons?: Array<{
    year: number;
    team_name?: string;
    raw_row?: unknown[];
  }>;
};

type MissingPlayer = {
  bart_id: number;
  name: string;
  year: number;
  team: string;
};

async function main() {
  console.log("Scanning player profiles...");
  const profileFiles = (await fs.readdir(PLAYER_DIR)).filter((f) => f.endsWith(".json"));
  console.log(`  ${profileFiles.length} profiles`);

  console.log("Building set of bartIds with a player-games file...");
  const gamesIds = new Set<number>();
  for (const f of await fs.readdir(PLAYER_GAMES_DIR)) {
    if (!f.endsWith(".json")) continue;
    const id = parseInt(f.replace(".json", ""), 10);
    if (Number.isFinite(id)) gamesIds.add(id);
  }
  console.log(`  ${gamesIds.size} bartIds have a player-games file`);

  console.log("Cross-referencing...");
  const missing: MissingPlayer[] = [];
  let scanned = 0;
  for (const f of profileFiles) {
    scanned++;
    if (scanned % 5000 === 0) process.stdout.write(`   ${scanned}\r`);
    const bartId = parseInt(f.replace(".json", ""), 10);
    if (!Number.isFinite(bartId)) continue;
    if (gamesIds.has(bartId)) continue;

    let prof: PlayerProfile;
    try {
      prof = JSON.parse(await fs.readFile(path.join(PLAYER_DIR, f), "utf8"));
    } catch {
      continue;
    }
    const latest = prof.seasons?.[0];
    const name =
      Array.isArray(latest?.raw_row) && typeof latest.raw_row[0] === "string"
        ? (latest.raw_row[0] as string)
        : null;
    if (!name) continue;
    for (const s of prof.seasons ?? []) {
      if (s.team_name && s.year) {
        missing.push({ bart_id: bartId, name, year: s.year, team: s.team_name });
      }
    }
  }

  console.log();
  console.log(`TOTAL missing-player rows: ${missing.length}`);
  console.log(`Distinct missing players: ${new Set(missing.map((m) => m.bart_id)).size}`);

  // Group by year.
  const byYear = new Map<number, MissingPlayer[]>();
  for (const m of missing) {
    if (!byYear.has(m.year)) byYear.set(m.year, []);
    byYear.get(m.year)!.push(m);
  }
  console.log("\nMissing players per year:");
  for (const y of [...byYear.keys()].sort()) {
    console.log(`  ${y}: ${byYear.get(y)!.length} (distinct: ${new Set(byYear.get(y)!.map((m) => m.bart_id)).size})`);
  }

  // Top affected teams.
  const byTeam = new Map<string, Set<string>>(); // team → set of "name|year"
  for (const m of missing) {
    const k = m.team;
    if (!byTeam.has(k)) byTeam.set(k, new Set());
    byTeam.get(k)!.add(`${m.name}|${m.year}`);
  }
  const teamRanked = [...byTeam.entries()].sort((a, b) => b[1].size - a[1].size);
  console.log("\nTOP 30 TEAMS BY MISSING-PLAYER-YEAR ROWS:");
  for (const [team, set] of teamRanked.slice(0, 30)) {
    console.log(`  ${team.padEnd(30)} ${String(set.size).padStart(4)}`);
  }

  // Spotlight high-profile blueblood programs.
  console.log("\nBLUEBLOOD SPOTLIGHT (missing players per year):");
  const bluebloods = ["Duke", "Kentucky", "North Carolina", "Kansas", "UCLA", "Connecticut", "Villanova", "Gonzaga"];
  for (const team of bluebloods) {
    const set = byTeam.get(team);
    if (!set || set.size === 0) {
      console.log(`  ${team.padEnd(20)} (clean — no missing players)`);
      continue;
    }
    // Group by year.
    const map = new Map<number, string[]>();
    for (const ny of set) {
      const [name, yr] = ny.split("|");
      const y = parseInt(yr!, 10);
      if (!map.has(y)) map.set(y, []);
      map.get(y)!.push(name!);
    }
    console.log(`  ${team}:`);
    for (const y of [...map.keys()].sort()) {
      console.log(`    ${y}: ${map.get(y)!.slice(0, 8).join(", ")}${map.get(y)!.length > 8 ? ` ...+${map.get(y)!.length - 8}` : ""}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
