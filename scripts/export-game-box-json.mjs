#!/usr/bin/env node
/**
 * export-game-box-json.mjs — joins CBBD's per-game TEAM box (/games/teams,
 * pulled by scripts/pull-team-box.mjs into data/cbbd/<year>/box-teams-*.json.gz)
 * onto our own game logs, and emits a per-season sidecar keyed by
 * `game_id`.
 *
 *   Out: public/data/game-box-by-year/<season>.json
 *
 * WHY A SIDECAR, NOT AN IN-PLACE MERGE: game-logs-by-year/<year>.json is ~7.5 MB
 * and is fetched by the team pages and the "Find a game" modal, which don't need
 * any of this. Widening those files would tax every consumer to benefit one.
 * /calc fetches the sidecar on top of the base log.
 *
 * JOIN: exact, by id. The game logs are now built from this same box archive
 * (scripts/build-game-logs-cbbd.mjs) and their `game_id` is
 * "<cbbdGameId>-<cbbdTeamId>", so a game resolves with a Map lookup.
 *
 * This used to be a (US Eastern calendar date, normalized team name) match with
 * a +/-1 day window and an alias table, because the logs came from CB
 * Analytics and the two providers disagreed about both dates and spellings.
 * That machinery is gone along with the provider — as is the ~480-rows-per-season
 * miss count it produced from October exhibitions the box didn't cover.
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
import { norm, etDate } from "./lib/cbbd-join.mjs";

// ---------- field extraction ----------
const n1 = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const int = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
const diff = (a, b) => (typeof a === "number" && typeof b === "number" ? a - b : null);

/**
 * Flatten one box record into the numbers we expose as filters. Percentages
 * arrive from CBBD as 0-100; we store them as 0-1 to match the game logs'
 * existing convention (efg_pct etc.), so the UI formats them uniformly.
 */
function extract(r, rankAt = null) {
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
    // `tourney` means THE NCAA TOURNAMENT and nothing else. It previously used
    // `gameType === "TRNMNT"`, which also caught conference tournaments and
    // multi-team events — so "tourney game" answered a much broader question
    // than the one people ask. Conference tournament games are now ordinary
    // games as far as this flag is concerned.
    //
    // `postseason` (NCAA *or* NIT) is still exported but no longer offered as
    // a filter: as one flag it couldn't separate March Madness from the NIT.
    conf_game: r.conferenceGame ? 1 : 0,
    tourney: r.tournament === "NCAA" ? 1 : 0,
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
    // Raw totals for the box-score modal. The game logs carry only the
    // DIFFERENTIALS of these (fbpts_diff, pitp_diff), which can't be shown as
    // a two-sided comparison.
    fbpts: int(t.points?.fastBreak),
    pitp: int(t.points?.inPaint),
    pot: int(t.points?.offTurnovers),
    // Half-by-half points for the linescore. The existing h1_margin/h2_margin
    // are DIFFERENCES, which can't reconstruct either team's actual halves.
    // Anything past the second period is overtime, summed — a 3OT game would
    // otherwise need an unknown number of columns.
    h1_pts: int(t.points?.byPeriod?.[0]),
    h2_pts: int(t.points?.byPeriod?.[1]),
    ot_pts: Array.isArray(t.points?.byPeriod) && t.points.byPeriod.length > 2
      ? int(t.points.byPeriod.slice(2).reduce((s, v) => s + (typeof v === "number" ? v : 0), 0))
      : null,
    seed: int(r.teamSeed),
    opp_seed: int(r.opponentSeed),
    tourney_name: r.tournament || null,
    round: parseRound(r.notes),
    // AP rank AS OF THIS GAME — from the most recent poll before it, not the
    // final standings. A team that finished 4th may well have been unranked
    // the night it lost in December, and that is the interesting fact.
    ap_rank: rankAt && r.startDate ? rankAt(r.team, etDate(r.startDate)) : null,
    opp_ap_rank: rankAt && r.startDate ? rankAt(r.opponent, etDate(r.startDate)) : null,
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

// ---------- AP poll lookup ("what were they ranked at the time") ----------

/**
 * Build a (date -> team -> AP rank) lookup for one season, plus the sorted
 * poll dates, so a game can be matched to the most recent poll before it.
 *
 * WEEK -> DATE. Most seasons ship a real `pollDate`, but 2014-2016 ship null
 * for every row and carry only a week number. Those weeks are recoverable
 * because the AP cadence is fixed: week 1 is the preseason poll, and week 2
 * onward land on consecutive Mondays starting the first Monday STRICTLY AFTER
 * the season's first game. That formula was validated against every season
 * that does carry dates — 144 of 145 weeks reproduced exactly.
 *
 * The one exception is a corrupt upstream row (2026 week 3 carrying an April
 * poll date), which is why a supplied date more than 10 days from its derived
 * position is rejected in favour of the derived one: trusting it would rank a
 * November game off the final poll of the season.
 */
function buildRankIndex(season, boxRows) {
  const p = path.join(ROOT, "data/cbbd", String(season), "rankings.json.gz");
  if (!fs.existsSync(p) || boxRows.length === 0) return null;
  let rows;
  try {
    rows = JSON.parse(zlib.gunzipSync(fs.readFileSync(p)).toString());
  } catch { return null; }
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const firstGame = boxRows.map((r) => r.startDate).filter(Boolean).sort()[0];
  if (!firstGame) return null;
  const anchor = new Date(`${firstGame.slice(0, 10)}T00:00:00Z`);
  do { anchor.setUTCDate(anchor.getUTCDate() + 1); } while (anchor.getUTCDay() !== 1);
  const derived = (week) =>
    new Date(anchor.getTime() + (week - 2) * 7 * 86400000).toISOString().slice(0, 10);

  const byDate = new Map();
  for (const r of rows) {
    if (typeof r.week !== "number" || typeof r.ranking !== "number" || !r.team) continue;
    // Week 1 is the preseason poll — before any game, so it can never be the
    // "most recent poll" for a game and is skipped.
    if (r.week < 2) continue;
    const d = derived(r.week);
    const supplied = r.pollDate ? String(r.pollDate).slice(0, 10) : null;
    const gap = supplied
      ? Math.abs(new Date(`${supplied}T00:00:00Z`) - new Date(`${d}T00:00:00Z`)) / 86400000
      : Infinity;
    const date = supplied && gap <= 10 ? supplied : d;
    let m = byDate.get(date);
    if (!m) { m = new Map(); byDate.set(date, m); }
    m.set(norm(r.team), r.ranking);
  }
  const dates = [...byDate.keys()].sort();
  if (dates.length === 0) return null;

  /** Rank for `team` as of `gameDate`, or null if unranked/too early. */
  return function rankAt(team, gameDate) {
    if (!team || !gameDate) return null;
    // Latest poll on or before the game.
    let lo = 0, hi = dates.length - 1, best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (dates[mid] <= gameDate) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (best < 0) return null;
    return byDate.get(dates[best]).get(norm(team)) ?? null;
  };
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

  // DIRECT ID LOOKUP, NOT A FUZZY JOIN. The game logs are themselves built from
  // this same box archive now (scripts/build-game-logs-cbbd.mjs), and their
  // game_id is literally "<cbbdGameId>-<cbbdTeamId>". The old (ET date | team
  // name) matcher existed only because the logs came from a different provider
  // with different spellings; keeping it would reintroduce ±1-day fallbacks and
  // alias-map drift for a join that is now exact by construction.
  const byId = new Map();
  for (const r of boxRows) byId.set(`${r.gameId}-${r.teamId}`, r);
  const rankAt = buildRankIndex(season, boxRows);

  const out = {};
  let matched = 0, miss = 0;
  for (const g of logs) {
    const hit = g.game_id ? byId.get(g.game_id) : null;
    if (!hit) { miss++; continue; }
    matched++;
    out[g.game_id] = extract(hit, rankAt);
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
  console.log(
    `${season}: ${String(matched).padStart(6)}/${String(logs.length).padStart(6)} log rows ` +
    `(${((100 * matched) / logs.length).toFixed(1)}%)  miss=${miss}  -> ${kb} KB`,
  );
}

const args = process.argv.slice(2).map(Number).filter(Number.isFinite);
const seasons = args.length
  ? args
  : Array.from({ length: SEASON_CEIL - SEASON_FLOOR + 1 }, (_, i) => SEASON_FLOOR + i).filter((y) => !EXCLUDED.has(y));

console.log(`Exporting per-game team box for ${seasons.length} season(s)…\n`);
for (const s of seasons) run(s);
console.log("\nDone.");
