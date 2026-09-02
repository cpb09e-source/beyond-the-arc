#!/usr/bin/env node
/**
 * export-game-players-json.mjs — per-game PLAYER box scores for the Win
 * Calculator's box-score modal.
 *
 *   public/data/game-players/<season>/<gameKey>.json
 *
 * WHY PER-GAME FILES AND NOT A SEASON BUNDLE: a season carries ~260k
 * player-game rows (12k games x 2 teams x ~11 players). Bundled per season
 * that is 20 MB+ of JSON the browser would download to show ONE game. The
 * modal opens one game at a time, so one file per game is the natural fetch
 * unit — a few KB each.
 *
 * WHY THAT IS SAFE FOR THE BUILD: these land in an R2-mirrored directory
 * (src/lib/data-url.ts R2_DIRS, scripts/strip-r2-mirrored-from-out.mjs), so
 * they are uploaded to Cloudflare R2 and DELETED from out/ before Netlify's
 * deploy upload ever sees them. Adding ~132k files to out/ would otherwise
 * re-create the deploy timeout R2 exists to solve.
 *
 * KEYED BY gameKey, NOT game_id: our game ids are "<num>-<side>", one per
 * team perspective. The modal wants both line-ups at once, so files are keyed
 * on the shared numeric prefix and hold both teams.
 *
 * Usage:
 *   node scripts/export-game-players-json.mjs
 *   node scripts/export-game-players-json.mjs --season 2026
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = process.cwd();
const OUT_ROOT = path.join(ROOT, "public/data/game-players");
// 2021 JOINED THE RUN 2026-09-02, when box-players-full.json.gz was finally
// pulled. It is NOT excluded site-wide — see FLAGGED_SEASONS in
// src/lib/seasons.ts, which marks the COVID season as incomparable, not as
// absent. What is still missing for it is the play-by-play (~157
// plays-*.json.gz day files), a separate and much larger pull.
const SEASONS = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

const args = process.argv.slice(2);
const oneSeason = args.includes("--season") ? Number(args[args.indexOf("--season") + 1]) : null;

// gameKey() splits the shared numeric prefix off a game_id; both perspectives
// of a game write into the same file. The fuzzy (date | team-name) matcher that
// used to live here is gone: the logs are built from this same CBBD archive now,
// so `game_id` is "<cbbdGameId>-<cbbdTeamId>" and the join is a Map lookup.
import { gameKey } from "./lib/cbbd-join.mjs";

const int = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
const n1 = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
/** CBBD sends percentages 0-100; store 0-1 to match every other surface. */
const pct = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10) / 1000 : null);

/**
 * One player's line. Deliberately trimmed: athleteSourceId, ejected,
 * assistsTurnoverRatio, netRating and the 2PT split are dropped because the
 * modal doesn't show them and they'd inflate 132k files for nothing.
 */
function player(p) {
  return {
    id: p.athleteId ?? null,
    name: p.name ?? "",
    pos: p.position ?? null,
    starter: !!p.starter,
    min: int(p.minutes),
    pts: int(p.points),
    fgm: int(p.fieldGoals?.made),
    fga: int(p.fieldGoals?.attempted),
    fg3m: int(p.threePointFieldGoals?.made),
    fg3a: int(p.threePointFieldGoals?.attempted),
    ftm: int(p.freeThrows?.made),
    fta: int(p.freeThrows?.attempted),
    oreb: int(p.rebounds?.offensive),
    reb: int(p.rebounds?.total),
    ast: int(p.assists),
    stl: int(p.steals),
    blk: int(p.blocks),
    tov: int(p.turnovers),
    pf: int(p.fouls),
    usage: pct(p.usage),
    ts: pct(p.trueShootingPct),
    ortg: n1(p.offensiveRating),
    drtg: n1(p.defensiveRating),
  };
}

function readPlayerBox(season) {
  const dir = path.join(ROOT, "data/cbbd", String(season));
  if (!fs.existsSync(dir)) return [];

  // Prefer the complete pull from pull-player-box-v2.mjs. The older
  // box-players-<from>-<to> window files are deliberately NOT merged in when
  // it exists: every one of them was truncated at the endpoint's 1000-row
  // ceiling, so mixing them back in adds nothing but stale rows.
  const full = path.join(dir, "box-players-full.json.gz");
  if (fs.existsSync(full)) {
    try {
      return JSON.parse(zlib.gunzipSync(fs.readFileSync(full)).toString());
    } catch (e) {
      console.warn(`   ! could not parse box-players-full for ${season}: ${e.message}`);
    }
  }

  const rows = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.startsWith("box-players-") && x !== "box-players-full.json.gz")) {
    let raw = fs.readFileSync(path.join(dir, f));
    if (f.endsWith(".gz")) raw = zlib.gunzipSync(raw);
    try {
      const j = JSON.parse(raw.toString());
      if (Array.isArray(j)) rows.push(...j);
    } catch (e) {
      console.warn(`   ! could not parse ${f}: ${e.message}`);
    }
  }
  return rows;
}

function run(season) {
  const logPath = path.join(ROOT, `public/data/game-logs-by-year/${season}.json`);
  if (!fs.existsSync(logPath)) {
    console.log(`${season}: no game log — skipped`);
    return;
  }
  const boxRows = readPlayerBox(season);
  if (boxRows.length === 0) {
    console.log(`${season}: no player box — skipped`);
    return;
  }
  const logs = JSON.parse(fs.readFileSync(logPath, "utf8"));

  const byId = new Map();
  for (const r of boxRows) byId.set(`${r.gameId}-${r.teamId}`, r);

  // gameKey -> { teams: [...] }. Both perspectives of a game write into the
  // same file; the second one fills in the other team's line-up.
  const files = new Map();
  let matched = 0, miss = 0;

  for (const g of logs) {
    const hit = g.game_id ? byId.get(g.game_id) : null;
    if (!hit || !Array.isArray(hit.players)) { miss++; continue; }

    const key = gameKey(g.game_id);
    if (!key) { miss++; continue; }
    let file = files.get(key);
    if (!file) { file = { teams: [] }; files.set(key, file); }
    // Guard against writing the same side twice (the ±1-day fallback can make
    // two log rows resolve to one box row).
    if (file.teams.some((t) => t.team === hit.team)) { matched++; continue; }
    file.teams.push({
      team: hit.team,
      logName: g.team_name,
      players: hit.players.map(player),
    });
    matched++;
  }

  const outDir = path.join(OUT_ROOT, String(season));
  fs.mkdirSync(outDir, { recursive: true });
  let bytes = 0;
  for (const [key, file] of files) {
    const json = JSON.stringify(file);
    fs.writeFileSync(path.join(outDir, `${key}.json`), json);
    bytes += json.length;
  }

  console.log(
    `${season}: ${String(matched).padStart(6)}/${String(logs.length).padStart(6)} rows joined ` +
    `(${((100 * matched) / logs.length).toFixed(1)}%)  files=${files.size}  ` +
    `miss=${miss}  -> ${(bytes / 1024 / 1024).toFixed(1)} MB`,
  );
}

const list = oneSeason ? [oneSeason] : SEASONS;
console.log(`Exporting per-game player box for ${list.length} season(s)…\n`);
for (const s of list) run(s);
console.log("\nDone.");
