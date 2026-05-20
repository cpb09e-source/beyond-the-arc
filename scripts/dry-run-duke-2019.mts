/**
 * dry-run-duke-2019.mts — validate that RJ Barrett's rows are present in
 * Supabase but being filtered out of the static export.
 *
 * Logic:
 *   1. Find Duke's team_id in our `teams` table for year=2019
 *   2. Pull ALL player_game_stats for that team_id + year (matched + unmatched)
 *   3. Group by cbba_game_id, sum player points per side
 *   4. Compare against game-logs-by-year/2019.json canonical totals
 *   5. Report: which games are now complete, which players (especially RJ
 *      Barrett) appear when the bart_player_id filter is removed
 *
 * Run: npx tsx scripts/dry-run-duke-2019.mts
 */

import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs/promises";
import path from "node:path";

loadEnv({ path: ".env.local" });
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(URL, SR, { auth: { persistSession: false } });

const YEAR = 2019;

async function main() {
  // 1) Duke's team_id
  const { data: teams } = await sb
    .from("teams")
    .select("id, name, name_normalized, year")
    .eq("year", YEAR)
    .ilike("name", "Duke");
  if (!teams || teams.length === 0) {
    console.error("No Duke row for year 2019 in teams table");
    return;
  }
  const dukeTeamId = teams[0]!.id;
  console.log(`Duke ${YEAR} team_id: ${dukeTeamId}`);

  // 2) Pull all rows for Duke 2019 (matched + unmatched)
  type Row = {
    cbba_game_id: number;
    cbba_player_id: number;
    bart_player_id: number | null;
    full_name: string;
    game_date: string | null;
    is_starter: boolean | null;
    mins: number | null;
    pts_scored: number | null;
    fgm: number | null; fga: number | null;
    fgm3: number | null; fga3: number | null;
    ftm: number | null; fta: number | null;
    reb: number | null; orb: number | null; drb: number | null;
    ast: number | null; stl: number | null; blk: number | null;
    tov: number | null; pf: number | null;
    plus_minus: number | null;
  };
  const all: Row[] = [];
  let lastId = -1;
  while (true) {
    const { data, error } = await sb
      .from("player_game_stats")
      .select(
        "id, cbba_game_id, cbba_player_id, bart_player_id, full_name, game_date, is_starter, mins, pts_scored, fgm, fga, fgm3, fga3, ftm, fta, reb, orb, drb, ast, stl, blk, tov, pf, plus_minus",
      )
      .eq("year", YEAR)
      .eq("team_id", dukeTeamId)
      .gt("id", lastId)
      .order("id", { ascending: true })
      .limit(500);
    if (error) {
      console.error(error);
      return;
    }
    if (!data || data.length === 0) break;
    for (const r of data as Array<Row & { id: number }>) {
      all.push(r);
      lastId = r.id;
    }
    if (data.length < 500) break;
  }
  console.log(`Total Duke 2019 player_game_stats rows: ${all.length}`);

  // 3) Player coverage
  const distinct = new Map<number, { name: string; bart: number | null; rows: number }>();
  for (const r of all) {
    if (!distinct.has(r.cbba_player_id)) {
      distinct.set(r.cbba_player_id, { name: r.full_name, bart: r.bart_player_id, rows: 0 });
    }
    distinct.get(r.cbba_player_id)!.rows++;
  }
  console.log(`\nDistinct Duke 2019 players in Supabase (${distinct.size}):`);
  for (const [cbbId, info] of distinct) {
    const tag = info.bart === null ? "  ← UNMATCHED (filtered out today)" : "";
    console.log(`  cbba=${cbbId}  bart=${info.bart ?? "—"}  ${info.name.padEnd(25)} games=${info.rows}${tag}`);
  }

  // 4) Group by cbba_game_id, sum pts
  const byGame = new Map<number, Row[]>();
  for (const r of all) {
    if (!byGame.has(r.cbba_game_id)) byGame.set(r.cbba_game_id, []);
    byGame.get(r.cbba_game_id)!.push(r);
  }

  // 5) Compare against canonical
  const gameLogs = JSON.parse(
    await fs.readFile(path.resolve(`public/data/game-logs-by-year/${YEAR}.json`), "utf8"),
  ) as Array<{ cbba_game_id: string; team_id: number; pts_scored: number; opp_team_market: string; game_date: string }>;
  // We need to find Duke's team_id in this game-logs file. The game-logs file
  // uses team_id from our teams table (same as Supabase). So filter by dukeTeamId.
  const dukeGameLogs = gameLogs.filter((g) => g.team_id === dukeTeamId);
  console.log(`\nDuke 2019 game-logs canonical rows: ${dukeGameLogs.length}`);

  let matchedBefore = 0;
  let matchedAfter = 0;
  let coveredGames = 0;
  console.log(`\nGAME-BY-GAME (sums "all" includes unmatched; "matched-only" is the current filter):\n`);
  for (const log of dukeGameLogs) {
    const cbbId = parseInt(String(log.cbba_game_id).split("-")[0]!, 10);
    const rows = byGame.get(cbbId) ?? [];
    if (rows.length === 0) continue;
    coveredGames++;
    const sumAll = rows.reduce((a, r) => a + (r.pts_scored ?? 0), 0);
    const sumMatched = rows.filter((r) => r.bart_player_id !== null).reduce((a, r) => a + (r.pts_scored ?? 0), 0);
    if (sumAll === log.pts_scored) matchedAfter++;
    if (sumMatched === log.pts_scored) matchedBefore++;
    const status =
      sumAll === log.pts_scored && sumMatched !== log.pts_scored
        ? "🎯 FIXED"
        : sumAll === log.pts_scored
          ? "✓ already ok"
          : "✗ still broken";
    console.log(
      `  ${log.game_date}  vs ${log.opp_team_market.padEnd(22)} canon=${log.pts_scored} matched-only=${sumMatched} all=${sumAll}  ${status}`,
    );
  }

  console.log();
  console.log(`SUMMARY: covered games = ${coveredGames}`);
  console.log(`  Matched-only (current filter):   ${matchedBefore} games correct`);
  console.log(`  With unmatched included (fix):   ${matchedAfter} games correct`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
