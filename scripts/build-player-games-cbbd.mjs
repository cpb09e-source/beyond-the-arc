#!/usr/bin/env node
/**
 * build-player-games-cbbd.mjs — per-player game logs, from the CBBD player box.
 *
 *   public/data/player-games/<bartPlayerId>.json
 *     { bart_player_id, games: [ { year, game_date, game_id, opp_team_market,
 *                                  is_home, is_neutral, won, is_starter, mins,
 *                                  pts_scored, fgm, fga, … } ] }
 *
 * REPLACES the per-player game-log section of export-static-data.mts, which
 * keyset-paginated ~1.59M rows out of the CBB Analytics `player_game_stats`
 * table. See docs/data-sources.md.
 *
 * Consumed by src/components/players/season-games-modal.tsx, so the row shape
 * is deliberately unchanged — same field names, same nulls, same sort (newest
 * game first). Only the origin of the numbers changed.
 *
 * WHAT'S GONE: `plus_minus`. It needs to know who was on the floor, and CBBD's
 * play-by-play has no onFloor and no substitution events before 2024. The modal
 * never displayed it, so nothing in the UI changes.
 *
 * WHAT'S NEW, free from the same source: `usage`, `ts`, `ortg`, `drtg`,
 * `game_score` per game.
 *
 * KEYED BY BART ID ONLY. The old export also wrote `cbb_<cbbaPlayerId>.json`
 * files for the ~2k players it couldn't match to Bart (1,968 of 28,495 files).
 * Those were unreachable from the UI — every entry point goes through a Bart
 * player id — so they are not reproduced.
 *
 * Usage: node scripts/build-player-games-cbbd.mjs [--season 2026]
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { norm, etDate, buildPlayerIndex, resolvePlayer } from "./lib/cbbd-join.mjs";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "public/data/player-games");
const SEASONS = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2022, 2023, 2024, 2025, 2026];

const args = process.argv.slice(2);
const oneSeason = args.includes("--season") ? Number(args[args.indexOf("--season") + 1]) : null;

const TEAM_MAP = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/cbbd-team-map.json"), "utf8"));

const int = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
const n1 = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const pct = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10) / 1000 : null);

/** Exact + suffix/initial-tolerant player index for one season. */
function bartIndex(season) {
  const fp = path.join(ROOT, "public/data/players-by-year", `${season}.json`);
  if (!fs.existsSync(fp)) return buildPlayerIndex([]);
  return buildPlayerIndex(JSON.parse(fs.readFileSync(fp, "utf8")));
}

/** game_id → the log row, so each game carries the same venue/result the rest of the site shows. */
function logIndex(season) {
  const fp = path.join(ROOT, `public/data/game-logs-by-year/${season}.json`);
  const idx = new Map();
  if (!fs.existsSync(fp)) return idx;
  for (const g of JSON.parse(fs.readFileSync(fp, "utf8"))) idx.set(g.game_id, g);
  return idx;
}

function readPlayerBox(season) {
  const fp = path.join(ROOT, "data/cbbd", String(season), "box-players-full.json.gz");
  if (!fs.existsSync(fp)) return [];
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(fp)).toString());
}

// bartId → array of game rows, accumulated across every season processed.
const byPlayer = new Map();

function run(season) {
  const bart = bartIndex(season);
  const logs = logIndex(season);
  const rows = readPlayerBox(season);
  if (!rows.length || !bart.exact.size) { console.log(`${season}: skipped (no box or no bart index)`); return; }

  let kept = 0, unmatchedPlayer = 0, skippedGame = 0;

  for (const r of rows) {
    const team = TEAM_MAP[r.teamId];
    if (!team) continue;
    const gameId = `${r.gameId}-${r.teamId}`;
    const log = logs.get(gameId);
    // No log row = the game was filtered upstream (cancelled, exhibition,
    // non-D1 perspective). Skip so a player's log can never contain a game
    // /calc and the team pages don't show.
    if (!log) { skippedGame++; continue; }
    if (!Array.isArray(r.players)) continue;
    const tk = norm(team.name);

    for (const p of r.players) {
      if (!p?.name) continue;
      const bartId = resolvePlayer(bart, tk, p.name);
      if (bartId == null) { unmatchedPlayer++; continue; }
      let arr = byPlayer.get(bartId);
      if (!arr) { arr = []; byPlayer.set(bartId, arr); }
      arr.push({
        year: season,
        game_date: log.game_date ?? (r.startDate ? etDate(r.startDate) : null),
        // Numeric CBBD game id — the modal types this as a number and only uses
        // it as a React key.
        game_id: r.gameId,
        opp_team_market: log.opp_team_market ?? r.opponent ?? null,
        is_home: log.is_home ?? null,
        is_neutral: log.is_neutral ?? null,
        won: log.won ?? null,
        is_starter: !!p.starter,
        mins: int(p.minutes),
        pts_scored: int(p.points),
        fgm: int(p.fieldGoals?.made),
        fga: int(p.fieldGoals?.attempted),
        fgm3: int(p.threePointFieldGoals?.made),
        fga3: int(p.threePointFieldGoals?.attempted),
        ftm: int(p.freeThrows?.made),
        fta: int(p.freeThrows?.attempted),
        reb: int(p.rebounds?.total),
        orb: int(p.rebounds?.offensive),
        drb: int(p.rebounds?.defensive),
        ast: int(p.assists),
        stl: int(p.steals),
        blk: int(p.blocks),
        tov: int(p.turnovers),
        pf: int(p.fouls),
        // Rates CBB Analytics also carried, kept so the modal can grow into them.
        fg_pct: pct(p.fieldGoals?.pct),
        fg3_pct: pct(p.threePointFieldGoals?.pct),
        ft_pct: pct(p.freeThrows?.pct),
        efg_pct: pct(p.effectiveFieldGoalPct),
        ts_pct: pct(p.trueShootingPct),
        usage_pct: pct(p.usage),
        // New.
        ortg: n1(p.offensiveRating),
        drtg: n1(p.defensiveRating),
        game_score: n1(p.gameScore),
      });
      kept++;
    }
  }

  console.log(
    `${season}: ${kept.toLocaleString()} player-game rows  ` +
    `(${unmatchedPlayer.toLocaleString()} unmatched players, ${skippedGame.toLocaleString()} non-eligible games)`,
  );
}

const list = oneSeason ? [oneSeason] : SEASONS;
console.log(`Building per-player game logs for ${list.length} season(s)…\n`);
for (const s of list) run(s);

// A single-season run must merge into the existing files, not truncate a
// player's career to one year.
fs.mkdirSync(OUT_DIR, { recursive: true });
let written = 0, totalRows = 0;
for (const [bartId, games] of byPlayer) {
  const fp = path.join(OUT_DIR, `${bartId}.json`);
  let merged = games;
  if (oneSeason && fs.existsSync(fp)) {
    try {
      const prev = JSON.parse(fs.readFileSync(fp, "utf8"));
      const keep = (prev.games ?? []).filter((g) => g.year !== oneSeason);
      merged = [...keep, ...games];
    } catch { /* corrupt file — overwrite */ }
  }
  // Newest game first, matching what the modal expects.
  merged.sort((a, b) => (b.game_date ?? "").localeCompare(a.game_date ?? ""));
  fs.writeFileSync(fp, JSON.stringify({ bart_player_id: bartId, games: merged }));
  written++;
  totalRows += merged.length;
}
console.log(`\n✓ ${written.toLocaleString()} player files, ${totalRows.toLocaleString()} rows → ${path.relative(ROOT, OUT_DIR)}`);
