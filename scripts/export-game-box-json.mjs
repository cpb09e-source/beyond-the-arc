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

// ---------- team-name bridge (single source: src/lib/quad.ts) ----------
function loadAliases() {
  const src = fs.readFileSync(path.join(ROOT, "src/lib/quad.ts"), "utf8");
  const block = src.match(/TEAM_RATING_ALIASES[^=]*=\s*\{([\s\S]*?)\n\};/);
  if (!block) throw new Error("Could not parse TEAM_RATING_ALIASES from src/lib/quad.ts");
  const out = {};
  for (const m of block[1].matchAll(/"((?:[^"\\]|\\.)*)":\s*"((?:[^"\\]|\\.)*)"/g)) out[m[1]] = m[2];
  return out;
}
const ALIASES = loadAliases();
const norm = (s) =>
  (s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/\bst\.?\b/g, "state").replace(/\bu\b/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
const teamKey = (logName) => norm(ALIASES[logName] ?? logName);

const ET = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
});
const etDate = (iso) => ET.format(new Date(iso));
const shiftDate = (ymd, days) =>
  new Date(new Date(`${ymd}T12:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);

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
    //
    // NOT exported: teamSeed. It is only populated for NCAA/NIT games — 1.2% of
    // rows — so as a general filter it would return "0 games" almost always,
    // which reads as "never happened" rather than "not applicable". Same reason
    // ast/stl/blk/fta were pulled from the game-log options.
    conf_game: r.conferenceGame ? 1 : 0,
    tourney: r.gameType === "TRNMNT" ? 1 : 0,
    postseason: r.seasonType === "postseason" ? 1 : 0,
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

  // (date|team) -> box row. Dedupe defensively: the pull's date windows overlap
  // by a day in a couple of seasons, so the same game can appear twice.
  const byDateTeam = new Map();
  // (team|opponent) -> [box rows], the fallback when the date is off by more
  // than a day (rare, but happens around late West-coast tips).
  const byMatchup = new Map();
  for (const r of boxRows) {
    if (!r.startDate || !r.team) continue;
    const d = etDate(r.startDate);
    const tk = norm(r.team);
    const k = `${d}|${tk}`;
    if (!byDateTeam.has(k)) byDateTeam.set(k, r);
    const mk = `${tk}|${norm(r.opponent)}`;
    const arr = byMatchup.get(mk);
    if (arr) arr.push(r);
    else byMatchup.set(mk, [r]);
  }

  const out = {};
  let exact = 0, near = 0, viaMatchup = 0, miss = 0, exhib = 0;
  for (const g of logs) {
    // Preseason exhibitions are excluded site-wide (see src/lib/seasons.ts) and
    // CBBD's box carries none of them, so skip rather than count as a miss.
    if (g.game_date && g.game_date < `${season - 1}-11-01`) { exhib++; continue; }
    if (!g.game_date || !g.team_name || !g.cbba_game_id) { miss++; continue; }
    const tk = teamKey(g.team_name);
    let hit = byDateTeam.get(`${g.game_date}|${tk}`);
    if (hit) exact++;
    if (!hit) {
      for (const off of [-1, 1]) {
        hit = byDateTeam.get(`${shiftDate(g.game_date, off)}|${tk}`);
        if (hit) { near++; break; }
      }
    }
    if (!hit && g.opp_team_market) {
      // Same two teams, closest date within a week. Only accept when it is
      // unambiguous or clearly the nearest meeting (teams can play twice).
      const cands = byMatchup.get(`${tk}|${teamKey(g.opp_team_market)}`);
      if (cands?.length) {
        let best = null, bestGap = Infinity;
        for (const c of cands) {
          const gap = Math.abs(new Date(etDate(c.startDate)) - new Date(g.game_date)) / 86400000;
          if (gap < bestGap) { bestGap = gap; best = c; }
        }
        if (best && bestGap <= 7) { hit = best; viaMatchup++; }
      }
    }
    if (!hit) { miss++; continue; }
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
  const matched = exact + near + viaMatchup;
  const eligible = logs.length - exhib;
  console.log(
    `${season}: ${String(matched).padStart(6)}/${String(eligible).padStart(6)} eligible rows ` +
    `(${((100 * matched) / eligible).toFixed(1)}%)  exact=${exact} +/-1d=${near} matchup=${viaMatchup} ` +
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
