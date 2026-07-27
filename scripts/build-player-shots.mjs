#!/usr/bin/env node
/**
 * build-player-shots.mjs — per-player shot locations, from CBBD play-by-play.
 *
 *   public/data/shots/<bartPlayerId>.json
 *     { bart_player_id, seasons: { "<year>": [ [cx, cy, m, t, p3, w, loc, a], … ] } }
 *
 * Row tuple (all ints; positions in tenths of feet):
 *   cx  lateral position, 0–500, 0 = left sideline facing the hoop
 *   cy  distance from the baseline, 0–470 (both ends folded onto one half court;
 *       rim center sits at (250, 52.5))
 *   m   1 made, 0 missed
 *   t   0 jump shot · 1 layup · 2 dunk · 3 tip
 *   p3  1 three-pointer, 0 two
 *   w   1 team won that game, 0 lost, -1 unknown
 *   loc 0 home · 1 away · 2 neutral
 *   a   1 assisted (only ever set on makes)
 *
 * Distance is NOT stored — the client derives it from (cx, cy) vs the rim, so
 * the tuples stay 8 small ints. Free throws carry no location upstream and are
 * excluded. Shots without coordinates are excluded (this file feeds a shot
 * chart; a shot that can't be plotted has nothing to contribute).
 *
 * SEASONS 2022+. The bar is location coverage: a chart missing a large share of
 * attempts visibly under-plots, so a season only ships if most of its shots
 * carry coordinates.
 *
 * Originally gated at 2024+ on a reading of ~71% for 2023. That measurement
 * predated the plays backfill, and re-measuring the current archive puts 2023
 * at 89.4% — HIGHER than 2024's 86.5%, which was already shipping. Coverage by
 * season now: 2019 27.8%, 2020 68.0%, 2022 83.3%, 2023 89.4%, 2024 86.5%,
 * 2025 98.8%, 2026 90.9%. (2021 is the COVID season and is excluded site-wide.)
 * 2022 and 2023 both sit at or above a season already in production, so they're
 * in; 2020 and earlier stay out.
 *
 * Joins reuse the exact machinery of build-player-games-cbbd.mjs:
 *   shooter → bart id  via (normalized TEAM_MAP name | normalized player name)
 *   game    → W/L + venue  via game-logs-by-year on `${gameId}-${teamId}`
 * Plays whose game has no log row are skipped (exhibitions / cancelled / non-D1
 * perspective), same eligibility rule as every other player surface.
 *
 * Dedupe: CBBD serves the same play under multiple date files near ET
 * boundaries, and some slates carry outright duplicate rows (Jaden Bradley's
 * 2026 PBP shows 395 FGA vs 367 in the box). First occurrence of a play id
 * wins, per season.
 *
 * Usage: node scripts/build-player-shots.mjs [--season 2026]
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { norm } from "./lib/cbbd-join.mjs";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "public/data/shots");
const SEASONS = [2022, 2023, 2024, 2025, 2026];

const args = process.argv.slice(2);
const oneSeason = args.includes("--season") ? Number(args[args.indexOf("--season") + 1]) : null;

const TEAM_MAP = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/cbbd-team-map.json"), "utf8"));

const SHOT_TYPE = { JumpShot: 0, LayUpShot: 1, DunkShot: 2, TipShot: 3 };

/** (normTeam|normName) → bart_player_id for one season. Same as player-games. */
function bartIndex(season) {
  const fp = path.join(ROOT, "public/data/players-by-year", `${season}.json`);
  const idx = new Map();
  if (!fs.existsSync(fp)) return idx;
  for (const p of JSON.parse(fs.readFileSync(fp, "utf8"))) {
    if (p.bart_player_id == null || !p.name) continue;
    const team = Array.isArray(p.teams) ? p.teams[0] : p.teams;
    if (!team?.name) continue;
    idx.set(`${norm(team.name)}|${norm(p.name)}`, p.bart_player_id);
  }
  return idx;
}

/** `${gameId}-${teamId}` → { won, is_home, is_neutral }. */
function logIndex(season) {
  const fp = path.join(ROOT, `public/data/game-logs-by-year/${season}.json`);
  const idx = new Map();
  if (!fs.existsSync(fp)) return idx;
  for (const g of JSON.parse(fs.readFileSync(fp, "utf8"))) idx.set(g.game_id, g);
  return idx;
}

/**
 * Fold a full-court location (tenths of feet, x 0–940 baseline-to-baseline,
 * y 0–500 sideline-to-sideline) onto one half court. Mirror BOTH axes for the
 * far end so the shooter's left/right is preserved.
 */
function fold(x, y) {
  const cx = x <= 470 ? y : 500 - y;
  const cy = x <= 470 ? x : 940 - x;
  return [Math.round(cx), Math.round(cy)];
}

// bartId → { season → rows }, accumulated across every season processed.
const byPlayer = new Map();

function run(season) {
  const bart = bartIndex(season);
  const logs = logIndex(season);
  const dir = path.join(ROOT, "data/cbbd", String(season));
  if (!bart.size || !logs.size || !fs.existsSync(dir)) {
    console.log(`${season}: skipped (missing bart index, logs, or plays)`);
    return;
  }
  const files = fs.readdirSync(dir).filter((n) => /^plays-\d{8}\.json\.gz$/.test(n)).sort();

  const seenPlay = new Set();
  let kept = 0, noLoc = 0, unmatchedPlayer = 0, skippedGame = 0, dupes = 0, unkType = 0;
  // Per-player located-FGA tally for the coverage report.
  const typeVocab = {};

  for (const f of files) {
    const plays = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, f))));
    for (const p of plays) {
      const si = p.shotInfo;
      if (!si || si.range === "free_throw") continue;
      if (p.id != null && seenPlay.has(p.id)) { dupes++; continue; }
      if (p.id != null) seenPlay.add(p.id);

      const team = TEAM_MAP[p.teamId];
      if (!team) continue;
      const log = logs.get(`${p.gameId}-${p.teamId}`);
      if (!log) { skippedGame++; continue; }

      const shooter = si.shooter?.name;
      if (!shooter) continue;
      const bartId = bart.get(`${norm(team.name)}|${norm(shooter)}`);
      if (bartId == null) { unmatchedPlayer++; continue; }

      const l = si.location;
      if (!l || typeof l.x !== "number" || typeof l.y !== "number") { noLoc++; continue; }
      // Reject junk coordinates rather than plotting them at an edge.
      if (l.x < 0 || l.x > 940 || l.y < 0 || l.y > 500) { noLoc++; continue; }

      typeVocab[p.playType] = (typeVocab[p.playType] ?? 0) + 1;
      let t = SHOT_TYPE[p.playType];
      if (t === undefined) { unkType++; t = 0; }

      const [cx, cy] = fold(l.x, l.y);
      const row = [
        cx, cy,
        si.made ? 1 : 0,
        t,
        p.scoreValue === 3 || si.range === "three_pointer" ? 1 : 0,
        log.won === true ? 1 : log.won === false ? 0 : -1,
        log.is_neutral ? 2 : log.is_home ? 0 : 1,
        si.made && si.assisted ? 1 : 0,
      ];

      let seasons = byPlayer.get(bartId);
      if (!seasons) { seasons = {}; byPlayer.set(bartId, seasons); }
      (seasons[season] ??= []).push(row);
      kept++;
    }
  }

  console.log(
    `${season}: ${kept.toLocaleString()} shots kept  ` +
    `(${noLoc.toLocaleString()} no/junk location, ${unmatchedPlayer.toLocaleString()} unmatched shooters, ` +
    `${skippedGame.toLocaleString()} non-eligible games, ${dupes.toLocaleString()} duplicate plays` +
    (unkType ? `, ${unkType} unknown playTypes` : "") + `)`,
  );
  console.log(`        playTypes: ${JSON.stringify(typeVocab)}`);

  // Coordinate sanity: 3PT attempts should sit beyond ~20 ft of the rim
  // (NCAA line is 22.15). A mis-oriented fold or a unit change upstream would
  // show up here before it ships as a nonsense chart.
  let th = 0, thUnder20 = 0;
  for (const seasons of byPlayer.values()) {
    for (const row of seasons[season] ?? []) {
      if (row[4] !== 1) continue;
      th++;
      const distFt = Math.hypot(row[0] - 250, row[1] - 52.5) / 10;
      if (distFt < 20) thUnder20++;
    }
  }
  const pctBad = th ? ((100 * thUnder20) / th).toFixed(2) : "0";
  console.log(`        3PT sanity: ${th.toLocaleString()} attempts, ${thUnder20} under 20ft (${pctBad}%)`);
  if (th > 1000 && thUnder20 / th > 0.02) {
    throw new Error(`${season}: ${pctBad}% of 3PT attempts plot inside 20ft — coordinate fold or units are wrong; not writing files.`);
  }
}

const list = oneSeason ? [oneSeason] : SEASONS;
console.log(`Building per-player shot charts for ${list.length} season(s)…\n`);
for (const s of list) run(s);

// A single-season run merges into existing files, replacing only that season.
fs.mkdirSync(OUT_DIR, { recursive: true });
let written = 0, totalShots = 0;
for (const [bartId, seasons] of byPlayer) {
  const fp = path.join(OUT_DIR, `${bartId}.json`);
  let merged = seasons;
  if (oneSeason && fs.existsSync(fp)) {
    try {
      const prev = JSON.parse(fs.readFileSync(fp, "utf8"));
      merged = { ...(prev.seasons ?? {}), ...seasons };
    } catch { /* corrupt file — overwrite */ }
  }
  fs.writeFileSync(fp, JSON.stringify({ bart_player_id: bartId, seasons: merged }));
  written++;
  for (const rows of Object.values(merged)) totalShots += rows.length;
}
console.log(`\n✓ ${written.toLocaleString()} player files, ${totalShots.toLocaleString()} shots → ${path.relative(ROOT, OUT_DIR)}`);
