/**
 * build-team-game-boxscores.mjs — assembles per-game box scores from the
 * already-exported per-player game logs in `public/data/player-games/`.
 *
 * Strategy:
 *   1. Walk every player-games file (~27k files).
 *   2. For each game row, key by `cbba_game_id` and accumulate player rows.
 *   3. Cross-reference each bartId → team_name for that year via the
 *      per-player profile in `public/data/player/<bartId>.json`.
 *   4. Group each game's player rows into the two teams, compute totals.
 *   5. Write one JSON file per game at:
 *        public/data/team-games/<year>/<cbba_game_id>.json
 *
 * Used by the schedule ticker modal — clicking a game in the schedule loads
 * the corresponding box-score file with full per-player stats for both teams.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const PLAYER_GAMES_DIR = path.resolve("public/data/player-games");
const PLAYER_DIR = path.resolve("public/data/player");
const OUT_DIR = path.resolve("public/data/team-games");

async function main() {
  const playerFiles = await fs.readdir(PLAYER_GAMES_DIR);
  const jsonFiles = playerFiles.filter((f) => f.endsWith(".json"));
  console.log(`📂 Found ${jsonFiles.length} player-games files`);

  // Pass 1: build bartId → year → team_name map from player profiles.
  console.log("\n📂 Building bartId → year → team_name map...");
  const teamByBartIdYear = new Map();
  const profileFiles = await fs.readdir(PLAYER_DIR);
  let pn = 0;
  for (const f of profileFiles) {
    if (!f.endsWith(".json")) continue;
    pn++;
    if (pn % 5000 === 0) process.stdout.write(`   ${pn}\r`);
    const bartId = parseInt(f.replace(".json", ""), 10);
    if (!Number.isFinite(bartId)) continue;
    try {
      const p = JSON.parse(await fs.readFile(path.join(PLAYER_DIR, f), "utf8"));
      const byYear = new Map();
      for (const s of p.seasons ?? []) {
        if (s.team_name) byYear.set(s.year, s.team_name);
      }
      if (byYear.size > 0) teamByBartIdYear.set(bartId, byYear);
    } catch {}
  }
  console.log(`\n   ${teamByBartIdYear.size} player profiles indexed`);

  // Pass 2: bartId → name lookup, also from profile data.
  console.log("\n📂 Building bartId → name map...");
  const nameByBartId = new Map();
  for (const f of profileFiles) {
    if (!f.endsWith(".json")) continue;
    const bartId = parseInt(f.replace(".json", ""), 10);
    if (!Number.isFinite(bartId)) continue;
    try {
      const p = JSON.parse(await fs.readFile(path.join(PLAYER_DIR, f), "utf8"));
      // The player's name is in raw_row[0] of the most-recent season.
      const latest = p.seasons?.[0];
      const row = latest?.raw_row;
      const name = Array.isArray(row) && typeof row[0] === "string" ? row[0] : null;
      if (name) nameByBartId.set(bartId, name);
    } catch {}
  }
  console.log(`   ${nameByBartId.size} names indexed`);

  // Pass 3: stream player-games → group by cbba_game_id.
  // gamesByCbbaId: cbba_game_id → array of { bartId, row }
  console.log("\n📊 Grouping player-games by cbba_game_id...");
  const gamesByCbbaId = new Map();
  let processed = 0;
  for (const f of jsonFiles) {
    processed++;
    if (processed % 2500 === 0) process.stdout.write(`   ${processed}/${jsonFiles.length}\r`);
    const bartId = parseInt(f.replace(".json", ""), 10);
    if (!Number.isFinite(bartId)) continue;
    try {
      const data = JSON.parse(await fs.readFile(path.join(PLAYER_GAMES_DIR, f), "utf8"));
      for (const g of data.games ?? []) {
        if (!g.cbba_game_id) continue;
        let arr = gamesByCbbaId.get(g.cbba_game_id);
        if (!arr) { arr = []; gamesByCbbaId.set(g.cbba_game_id, arr); }
        arr.push({ bartId, row: g });
      }
    } catch {}
  }
  console.log(`\n   ${gamesByCbbaId.size} unique games`);

  // Pass 4: emit one JSON per game.
  console.log("\n💾 Writing per-game files...");
  await fs.mkdir(OUT_DIR, { recursive: true });
  let written = 0, skipped = 0;
  for (const [cbbaId, rows] of gamesByCbbaId) {
    if (rows.length === 0) { skipped++; continue; }
    // Sanity: all rows for the same game should share year, game_date.
    const sample = rows[0].row;
    const year = sample.year;
    const date = sample.game_date;
    if (!year || !date) { skipped++; continue; }

    // Group rows into two teams by team_name (from teamByBartIdYear).
    // Some rows will be missing team lookup — drop those.
    /** @type {Map<string, Array<any>>} */
    const teamsByName = new Map();
    for (const r of rows) {
      const team = teamByBartIdYear.get(r.bartId)?.get(year);
      if (!team) continue;
      let arr = teamsByName.get(team);
      if (!arr) { arr = []; teamsByName.set(team, arr); }
      arr.push({ ...r.row, _bartId: r.bartId, _team: team });
    }
    if (teamsByName.size === 0) { skipped++; continue; }

    // Build the team summaries. For each team, sort players: starters first
    // (by minutes desc), then bench (by minutes desc).
    const teams = [];
    for (const [teamName, playerRows] of teamsByName) {
      // Sort: starters first, then by minutes desc.
      playerRows.sort((a, b) => {
        if ((a.is_starter ? 1 : 0) !== (b.is_starter ? 1 : 0)) {
          return (b.is_starter ? 1 : 0) - (a.is_starter ? 1 : 0);
        }
        return (b.mins ?? 0) - (a.mins ?? 0);
      });
      const players = playerRows.map((p) => ({
        name: nameByBartId.get(p._bartId) ?? `Player ${p._bartId}`,
        bart_id: p._bartId,
        is_starter: p.is_starter ?? false,
        mins: p.mins ?? null,
        pts: p.pts_scored ?? null,
        fgm: p.fgm ?? null, fga: p.fga ?? null,
        fgm3: p.fgm3 ?? null, fga3: p.fga3 ?? null,
        ftm: p.ftm ?? null, fta: p.fta ?? null,
        reb: p.reb ?? null, orb: p.orb ?? null, drb: p.drb ?? null,
        ast: p.ast ?? null, stl: p.stl ?? null, blk: p.blk ?? null,
        tov: p.tov ?? null, pf: p.pf ?? null,
        plus_minus: p.plus_minus ?? null,
      }));
      // Score = sum of player pts (most reliable). Also expose totals.
      let score = 0;
      const totals = {
        fgm: 0, fga: 0, fgm3: 0, fga3: 0, ftm: 0, fta: 0,
        reb: 0, orb: 0, drb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, pts: 0,
      };
      for (const p of players) {
        if (p.pts != null) { score += p.pts; totals.pts += p.pts; }
        for (const k of ["fgm","fga","fgm3","fga3","ftm","fta","reb","orb","drb","ast","stl","blk","tov","pf"]) {
          if (p[k] != null) totals[k] += p[k];
        }
      }
      teams.push({
        name: teamName,
        score,
        players,
        totals,
      });
    }

    // Note: many games will only have 1 team's data if the opp is a non-D-I
    // school (we don't index those player-games files).
    const out = {
      cbba_game_id: cbbaId,
      year,
      game_date: date,
      is_neutral: sample.is_neutral ?? null,
      teams,
    };

    const yearDir = path.join(OUT_DIR, String(year));
    if (!existsSync(yearDir)) await fs.mkdir(yearDir, { recursive: true });
    await fs.writeFile(path.join(yearDir, `${cbbaId}.json`), JSON.stringify(out));
    written++;
    if (written % 1000 === 0) process.stdout.write(`   ${written}/${gamesByCbbaId.size}\r`);
  }
  console.log(`\n✓ wrote ${written} team-games files (skipped ${skipped})`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
