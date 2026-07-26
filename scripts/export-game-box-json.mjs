#!/usr/bin/env node
/**
 * export-game-box-json.mjs — joins CBBD's per-game TEAM box (/games/teams,
 * pulled by scripts/pull-team-box.mjs into data/cbbd/<year>/box-teams-*.json.gz)
 * onto our own game logs, and emits a per-season sidecar keyed by
 * `cbba_game_id`.
 *
 *   Out: public/data/game-box-by-year/<season>.json
 *
 * WHY A SIDECAR, NOT AN IN-PLACE MERGE: game-logs-by-year/<year>.json is ~7.5 MB
 * and is fetched by the team pages and the "Find a game" modal, which don't need
 * any of this. Widening those files would tax every consumer to benefit one.
 * /calc fetches the sidecar on top of the base log.
 *
 * JOIN: CBBD's `gameId` and our `cbba_game_id` are different ID spaces, so we
 * match on (calendar date, team). Two wrinkles handled below:
 *   1. CBBD `startDate` is UTC; a 9pm PT tip is the *next* UTC day. We convert
 *      to the US Eastern calendar date, which is what our logs key on, then
 *      allow a +/-1 day window for the stragglers.
 *   2. Team names are Bart-style in our logs ("Ohio St.") and CBBD-style in the
 *      box ("Ohio State"). Reuses the alias table + normalizer from
 *      src/lib/quad.ts so there is one canonical mapping in the codebase.
 *
 * Unmatched rows are expected and fine: our logs include ~480 October
 * exhibition rows per season that CBBD's box does not cover.
 *
 * Run: node scripts/export-game-box-json.mjs [season...]
 */
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "public/data/game-box-by-year");

// ---------- season window (mirrors src/lib/seasons.ts) ----------
const SEASON_FLOOR = 2014;
const SEASON_CEIL = 2026;
const EXCLUDED = new Set([2021]); // COVID season, skipped site-wide

// ---------- team-name bridge + date join (shared with the player export) ----
// Imported rather than defined here so both sidecars resolve a game the same
// way; see scripts/lib/cbbd-join.mjs for what went wrong when they didn't.
import { buildIndexes, findBoxRow } from "./lib/cbbd-join.mjs";

// ---------- field extraction ----------
const n1 = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const int = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
const diff = (a, b) => (typeof a === "number" && typeof b === "number" ? a - b : null);

/**
 * Flatten one box record into the numbers we expose as filters. Percentages
 * arrive from CBBD as 0-100; we store them as 0-1 to match the game logs'
 * existing convention (efg_pct etc.), so the UI formats them uniformly.
 */
function extract(r) {
  const t = r.teamStats ?? {};
  const o = r.opponentStats ?? {};
  const tf = t.fourFactors ?? {};
  const of_ = o.fourFactors ?? {};
  const pct = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10) / 1000 : null);

  const half = (s) => (Array.isArray(s.points?.byPeriod) ? s.points.byPeriod[0] ?? null : null);
  const h1 = half(t), h1o = half(o);

  return {
    // Four factors — offense
    ff_efg: pct(tf.effectiveFieldGoalPct),
    ff_ftr: pct(tf.freeThrowRate),
    ff_tov: pct(tf.turnoverRatio),
    ff_orb: pct(tf.offensiveReboundPct),
    // Four factors — defense (what the opponent managed)
    ff_efg_def: pct(of_.effectiveFieldGoalPct),
    ff_ftr_def: pct(of_.freeThrowRate),
    ff_tov_def: pct(of_.turnoverRatio),
    ff_orb_def: pct(of_.offensiveReboundPct),
    // Per-game efficiency
    ortg: n1(t.rating),
    drtg: n1(o.rating),
    game_score: n1(t.gameScore),
    // Restores the four filter options that were dead in the game logs
    ast_diff: diff(t.assists, o.assists),
    stl_diff: diff(t.steals, o.steals),
    blk_diff: diff(t.blocks, o.blocks),
    ft_att_diff: diff(t.freeThrows?.attempted, o.freeThrows?.attempted),
    // Raw counts worth filtering on directly
    ast: int(t.assists),
    stl: int(t.steals),
    blk: int(t.blocks),
    fouls: int(t.fouls?.total),
    fouls_diff: diff(t.fouls?.total, o.fouls?.total),
    // Game shape
    largest_lead: int(t.points?.largestLead),
    largest_lead_opp: int(o.points?.largestLead),
    h1_margin: diff(h1, h1o),
    h2_margin: diff(
      typeof t.points?.total === "number" && typeof h1 === "number" ? t.points.total - h1 : undefined,
      typeof o.points?.total === "number" && typeof h1o === "number" ? o.points.total - h1o : undefined,
    ),
    // Flags, 0/1 so they work with the numeric comparator UI.
    //
    // `gameType === "TRNMNT"` is deliberately used for the tournament flag
    // rather than CBBD's `tournament` field. `tournament` only names the NCAA
    // and NIT (168 rows in 2026); gameType catches conference tournaments and
    // multi-team events too (1,152 rows) — which is what people actually mean
    // by "tournament game". `postseason` keeps the narrow NCAA/NIT sense.
    conf_game: r.conferenceGame ? 1 : 0,
    tourney: r.gameType === "TRNMNT" ? 1 : 0,
    postseason: r.seasonType === "postseason" ? 1 : 0,

    // ---- DISPLAY-ONLY (box-score modal + result table badges) ----
    // These are deliberately NOT filter options — see BOX_DISPLAY_FIELDS in
    // src/lib/game-box.ts. Seeds and rounds exist on ~1% of rows, so as
    // filters they'd read as "never happened"; as badges that same sparseness
    // is exactly right ("not applicable" simply renders nothing).
    // Named poss_box, NOT poss: the game logs already carry a `poss` that the
    // Possessions filter reads (CBB Analytics' raw estimate, e.g. 71.9).
    // Overwriting it would silently swap that filter's data source, and would
    // do it only for rows that got a box join — a mixed-source column.
    poss_box: int(t.possessions),
    fgm: int(t.fieldGoals?.made),
    fga: int(t.fieldGoals?.attempted),
    fg3m: int(t.threePointFieldGoals?.made),
    fg3a: int(t.threePointFieldGoals?.attempted),
    ftm: int(t.freeThrows?.made),
    fta: int(t.freeThrows?.attempted),
    tov: int(t.turnovers?.total),
    oreb: int(t.rebounds?.offensive),
    reb: int(t.rebounds?.total),
    seed: int(r.teamSeed),
    opp_seed: int(r.opponentSeed),
    tourney_name: r.tournament || null,
    round: parseRound(r.notes),
  };
}

/**
 * CBBD's free-text `notes` → a short round label ("Sweet 16", "Final Four").
 *
 * The raw strings are inconsistent across seasons — casing flips between
 * years ("SWEET 16" vs "Sweet 16"), the NCAA prefix varies ("Men's Basketball
 * Championship" vs "NCAA Men's Basketball Championship"), and sponsor names
 * drift ("Discount Tire CBI", "Roman CBI", "Ro CBI"). Matching on the round
 * keyword alone survives all of it; anything unrecognized returns null rather
 * than a mangled label.
 */
function parseRound(notes) {
  if (!notes) return null;
  const s = String(notes).toLowerCase();
  // ORDER MATTERS. Every NCAA note contains the words "Men's Basketball
  // Championship" — including first-round games — so the specific round
  // keywords must all be tested before the bare "championship" fallback,
  // which exists only for the NIT/CBI/CIT title games ("NIT - Championship").
  if (s.includes("national championship")) return "National Championship";
  if (s.includes("final four")) return "Final Four";
  if (s.includes("elite 8")) return "Elite Eight";
  if (s.includes("sweet 16")) return "Sweet 16";
  if (s.includes("first four")) return "First Four";
  if (s.includes("quarterfinal")) return "Quarterfinal";
  if (s.includes("semifinal")) return "Semifinal";
  if (s.includes("2nd round")) return "2nd Round";
  if (s.includes("1st round")) return "1st Round";
  if (s.includes("championship")) return "Championship";
  return null;
}

// ---------- per-season work ----------
function readBox(season) {
  const dir = path.join(ROOT, "data/cbbd", String(season));
  if (!fs.existsSync(dir)) return [];

  // Prefer the complete single-file pull from pull-team-box-v2.mjs. The older
  // box-teams-<from>-<to> window files are deliberately NOT merged in when it
  // exists: they were produced by a pull that dropped leap days and silently
  // truncated any window that hit the API's undocumented 3000-row ceiling, so
  // mixing them back in would reintroduce stale, incomplete rows.
  const full = path.join(dir, "box-teams-full.json.gz");
  if (fs.existsSync(full)) {
    try {
      return JSON.parse(zlib.gunzipSync(fs.readFileSync(full)).toString());
    } catch (e) {
      console.warn(`   ! could not parse box-teams-full for ${season}: ${e.message}`);
    }
  }

  const rows = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.startsWith("box-teams-") && x !== "box-teams-full.json.gz")) {
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
  const boxRows = readBox(season);
  const logPath = path.join(ROOT, `public/data/game-logs-by-year/${season}.json`);
  if (!fs.existsSync(logPath)) {
    console.log(`${season}: no game log — skipped`);
    return;
  }
  const logs = JSON.parse(fs.readFileSync(logPath, "utf8"));
  if (boxRows.length === 0) {
    console.log(`${season}: no box data — skipped`);
    return;
  }

  const indexes = buildIndexes(boxRows);

  const out = {};
  let matched = 0, miss = 0, exhib = 0;
  for (const g of logs) {
    // Preseason exhibitions are excluded site-wide (see src/lib/seasons.ts) and
    // CBBD's box carries none of them, so skip rather than count as a miss.
    if (g.game_date && g.game_date < `${season - 1}-11-01`) { exhib++; continue; }
    if (!g.game_date || !g.team_name || !g.cbba_game_id) { miss++; continue; }
    const hit = findBoxRow(g, indexes);
    if (!hit) { miss++; continue; }
    matched++;
    out[g.cbba_game_id] = extract(hit);
  }

  // Columnar on purpose. Object-per-row repeats ~27 key names 11k times, which
  // is most of the file: 4.58 MB vs 1.45 MB for the same data as positional
  // arrays. Parse time drops with it. FIELDS order is the contract with
  // src/lib/game-box.ts — append only, never reorder.
  const FIELDS = Object.keys(extract({}));
  const rows = {};
  for (const [id, rec] of Object.entries(out)) rows[id] = FIELDS.map((f) => rec[f]);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const dst = path.join(OUT_DIR, `${season}.json`);
  fs.writeFileSync(dst, JSON.stringify({ season, fields: FIELDS, rows }));
  const kb = (fs.statSync(dst).size / 1024).toFixed(0);
  const eligible = logs.length - exhib;
  console.log(
    `${season}: ${String(matched).padStart(6)}/${String(eligible).padStart(6)} eligible rows ` +
    `(${((100 * matched) / eligible).toFixed(1)}%)  ` +
    `miss=${miss} exhib-skipped=${exhib}  -> ${kb} KB`,
  );
}

const args = process.argv.slice(2).map(Number).filter(Number.isFinite);
const seasons = args.length
  ? args
  : Array.from({ length: SEASON_CEIL - SEASON_FLOOR + 1 }, (_, i) => SEASON_FLOOR + i).filter((y) => !EXCLUDED.has(y));

console.log(`Exporting per-game team box for ${seasons.length} season(s)…\n`);
for (const s of seasons) run(s);
console.log("\nDone.");
