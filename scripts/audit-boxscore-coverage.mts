/**
 * audit-boxscore-coverage.mts — detect every (game, team) where the
 * team-games/<year>/<id>.json box score is missing players relative to
 * the canonical team score in game-logs-by-year/<year>.json.
 *
 * Signal: team-games.score (= sum of player pts present in the file)
 *         vs.
 *         game-logs.pts_scored (= canonical team final from the row)
 *
 * Any mismatch means at least one player is missing from that team's
 * box, AND tells us how many points are unaccounted for.
 *
 * Output:
 *   - summary per year (games affected, total missing points, biggest gaps)
 *   - top-50 biggest gaps with team / opponent / date so we can spot-check
 *
 * Run: npx tsx scripts/audit-boxscore-coverage.mts
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

type GameLogRow = {
  cbba_game_id: string;
  year: number;
  game_date: string;
  team_id: number;
  opp_team_market: string;
  won: boolean;
  pts_scored: number;
};

type TeamBoxFile = {
  cbba_game_id: number;
  year: number;
  game_date: string;
  teams: Array<{ name: string; score: number; players: Array<{ name: string; pts: number | null; mins: number | null; is_starter: boolean }> }>;
};

const GAMELOGS_DIR = path.resolve("public/data/game-logs-by-year");
const TEAMGAMES_DIR = path.resolve("public/data/team-games");

type Mismatch = {
  year: number;
  cbba_game_id: string;
  team: string;
  opp: string;
  date: string;
  canonical_pts: number;
  box_score: number;
  diff: number;
  players_in_box: number;
  total_mins_in_box: number;
};

async function main() {
  const yearFiles = (await fs.readdir(GAMELOGS_DIR)).filter((f) => f.endsWith(".json"));
  const allMismatches: Mismatch[] = [];
  let totalGameLogs = 0;
  let totalWithBox = 0;
  let totalMatched = 0;

  for (const yf of yearFiles) {
    const year = parseInt(yf.replace(".json", ""), 10);
    if (!Number.isFinite(year)) continue;
    const rows: GameLogRow[] = JSON.parse(
      await fs.readFile(path.join(GAMELOGS_DIR, yf), "utf8"),
    );

    let yearTotal = 0;
    let yearWithBox = 0;
    let yearMismatch = 0;
    let yearMissingPts = 0;

    for (const r of rows) {
      yearTotal++;
      totalGameLogs++;
      if (!r.cbba_game_id) continue;
      // cbba_game_id in game-logs has shape "1017572-103549-game-true" — the
      // numeric prefix matches the team-games filename.
      const gid = String(r.cbba_game_id).split("-")[0];
      const boxPath = path.join(TEAMGAMES_DIR, String(year), `${gid}.json`);
      if (!existsSync(boxPath)) continue;

      const box: TeamBoxFile = JSON.parse(await fs.readFile(boxPath, "utf8"));
      yearWithBox++;
      totalWithBox++;

      // Pick the team's side in the box by SCORE, not by name. Game-logs uses
      // various short-forms in `opp_team_market` ("Mississippi Val.", "UMES")
      // that don't match the canonical team name in team-games files. By
      // selecting the side whose summed player points equal `canonical`, we
      // sidestep the entire naming-alias problem — true coverage gaps will
      // still show up because BOTH sides will fail the canonical match.
      const sides = box.teams;
      if (sides.length === 0) continue;
      const canonical = r.pts_scored ?? 0;
      const scoredSides = sides.map((s) => {
        const sum = s.players.reduce((a, p) => a + (p.pts ?? 0), 0);
        const mins = s.players.reduce((a, p) => a + (p.mins ?? 0), 0);
        return { s, sum, mins, diff: Math.abs(sum - canonical) };
      });
      // Exact match wins; otherwise closest sum to canonical.
      const exact = scoredSides.find((x) => x.sum === canonical);
      const teamScored = exact ?? scoredSides.reduce((best, cur) => (cur.diff < best.diff ? cur : best));
      const teamSide = teamScored.s;
      const sumInBox = teamScored.sum;
      const totalMins = teamScored.mins;

      if (sumInBox === canonical) {
        totalMatched++;
        continue;
      }
      yearMismatch++;
      const diff = canonical - sumInBox;
      yearMissingPts += diff;
      allMismatches.push({
        year,
        cbba_game_id: r.cbba_game_id,
        team: teamSide.name,
        opp: r.opp_team_market,
        date: r.game_date,
        canonical_pts: canonical,
        box_score: sumInBox,
        diff,
        players_in_box: teamSide.players.length,
        total_mins_in_box: Math.round(totalMins),
      });
    }
    console.log(
      `${year}: ${yearTotal} game-rows, ${yearWithBox} with box file, ` +
        `${yearMismatch} mismatched (${yearMissingPts} pts missing total)`,
    );
  }

  console.log();
  console.log(`OVERALL: ${totalGameLogs} game-log rows`);
  console.log(`         ${totalWithBox} have a box file`);
  console.log(`         ${totalMatched} match canonical`);
  console.log(`         ${allMismatches.length} mismatched (= incomplete player coverage)`);
  console.log(`         pct mismatched = ${((allMismatches.length / totalWithBox) * 100).toFixed(2)}%`);

  // Group mismatches by team to find the worst offenders.
  const byTeam = new Map<string, { games: number; missingPts: number }>();
  for (const m of allMismatches) {
    const k = m.team;
    if (!byTeam.has(k)) byTeam.set(k, { games: 0, missingPts: 0 });
    const v = byTeam.get(k)!;
    v.games++;
    v.missingPts += m.diff;
  }
  const teamRanked = [...byTeam.entries()].sort((a, b) => b[1].games - a[1].games);
  console.log();
  console.log("TOP 30 TEAMS BY GAMES WITH MISSING-PLAYER ISSUES:");
  for (const [team, v] of teamRanked.slice(0, 30)) {
    console.log(`  ${team.padEnd(25)} ${String(v.games).padStart(4)} games   ${v.missingPts} missing pts total`);
  }

  console.log();
  console.log("TOP 20 SINGLE-GAME GAPS:");
  for (const m of [...allMismatches].sort((a, b) => b.diff - a.diff).slice(0, 20)) {
    console.log(
      `  ${m.date}  ${m.team.padEnd(20)} vs ${m.opp.padEnd(20)}  ` +
        `canonical ${m.canonical_pts}  box ${m.box_score}  Δ${m.diff}  ` +
        `players=${m.players_in_box}  mins=${m.total_mins_in_box}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
