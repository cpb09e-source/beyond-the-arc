#!/usr/bin/env node
/**
 * build-player-stat-pack.mjs — the Players Explorer's full stat catalogue.
 *
 * Spec: docs/players-stat-spec.md. Read it before changing anything here; the
 * accuracy numbers quoted in the comments below were measured, not assumed, and
 * the script that measured them is this one's calibration.
 *
 *   out: public/data/player-stats/<season>/<group>.json
 *
 * ── WHY COLUMN-MAJOR, AND WHY SPLIT BY GROUP ──────────────────────────────
 *
 * The existing explorer payload is 1.68 MB a season for 36 stats — about six
 * bytes per stat per player, and most of that is the repeated JSON key
 * (`"tov_pct":0.126,` is sixteen characters to carry five). Going to 137 stats
 * in the same shape would be ~4.8 MB a season, 58 MB across twelve, on a static
 * export whose own build scripts already refuse to ship a 12 MB file.
 *
 * So: one file per (season, group), each column-major.
 *
 *   { season, group, cols: [...], dir: [...], ids: [...], vals: [[...]], pcts: [[...]] }
 *
 * Column-major drops the keys entirely, puts every value of one stat next to
 * its neighbours (which gzip likes), and lets a column be added or removed
 * without rewriting a row. Splitting by group means the browser fetches the
 * ~15 stats of the view on screen instead of all 137.
 *
 * ── WHY PERCENTILES ARE BAKED ─────────────────────────────────────────────
 *
 * They could be computed in the browser — the client holds the whole season, so
 * the cohort is there. They are baked anyway because the cohort is NOT simply
 * "every row in the file": per-40 stats are ranked only over players past a
 * minutes floor, and a percentile that silently changes when a filter is
 * applied is the bug we just spent a day removing from the team side. Baking
 * fixes the cohort at build time, where it can be stated once and checked.
 *
 * Ties share a midrank — scripts/lib/percentile.mjs. Inversion is passed INTO
 * the ranker, never applied as `100 - p` afterwards.
 *
 * Usage: node scripts/build-player-stat-pack.mjs [--from 2014] [--to 2026] [--only 2026]
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { norm, buildPlayerIndex, resolvePlayer } from "./lib/cbbd-join.mjs";
import { midrankPercentiles } from "./lib/percentile.mjs";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "public/data/player-stats");
const CBBD = path.join(ROOT, "data/cbbd");

// 2021 JOINED THE RUN 2026-09-02, when box-players-full.json.gz was finally
// pulled. It is NOT excluded site-wide — see FLAGGED_SEASONS in
// src/lib/seasons.ts, which marks the COVID season as incomparable, not as
// absent. What is still missing for it is the play-by-play (~157
// plays-*.json.gz day files), a separate and much larger pull.
// PBP-derived stats therefore come back empty for 2021 rather than absent:
// the plays reader degrades to an empty file list when the directory is not
// there, so box-derived groups populate normally and the play-by-play ones
// are null. That is the same honest degradation the team pages already show.
const ALL_SEASONS = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

/**
 * Seasons with a ROSTER. This used to be ALL_SEASONS plus 2021, because 2021
 * had no player box and nothing was built for it, yet its roster was still what
 * identified a player who only ever played that year. 2021 is in ALL_SEASONS
 * now, so the two lists are the same and the append would have duplicated it.
 *
 * Kept as its own name rather than collapsed into ALL_SEASONS: the distinction
 * is real and will matter again the moment another season has a roster without
 * stats.
 */
const ROSTER_SEASONS = [...ALL_SEASONS];

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i > -1 ? args[i + 1] : null; };
const ONLY = opt("only") ? [Number(opt("only"))] : null;
const FROM = Number(opt("from") || 2014);
const TO = Number(opt("to") || 2026);
const SEASONS = ONLY ?? ALL_SEASONS.filter((y) => y >= FROM && y <= TO);

const TEAM_MAP = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/cbbd-team-map.json"), "utf8"));

/**
 * First season with lineup data. Before this the play-by-play carries no
 * `onFloor` and no substitution events, so on-court plus/minus is unrecoverable
 * — the same wall that retired `plus_minus_pg` from src/lib/players.ts.
 */
const PM_FIRST_YEAR = 2024;

/**
 * Minutes a player needs before a per-40 rate is published.
 *
 * Twelve minutes and four points is 13.3 PTS/40, which tops the leaderboard
 * over anybody real. Same principle as the twenty-team floor in
 * build-team-splits.mjs: a rate over a thin sample describes the sample.
 */
const MIN_MIN_FOR_PER40 = 200;

/** Minutes before a team-context rate (AST%, BLK%, ORB%…) is published. */
const MIN_MIN_FOR_RATE = 100;

// ── Court geometry, for Points in the Paint ────────────────────────────────
//
// Duplicated from src/lib/shot-zones.ts rather than imported: that is a .ts
// module and this runs under plain node. Half court is 500x400 in TENTHS OF A
// FOOT, rim at (250, 52.5).
//
// The lane is 12 ft wide and runs to the free-throw line at 19 ft. Calibrated
// against CBBD's own team totals (`teamStats.points.inPaint`) over 304
// team-games: this definition lands at MAE 0.42 points, bias -0.25. Using
// `shotInfo.range === "rim"` instead — dunks, layups and tips only — misses
// every short paint jumper and comes in at MAE 5.43, undercounting EVERY game.
const LANE_HALF_WIDTH = 60;
const LANE_DEPTH = 190;

/** Full-court (tenths of a foot) → one half court, mirroring both axes. */
function fold(x, y) {
  return x <= 470 ? [y, x] : [500 - y, 940 - x];
}
const inPaint = (cx, cy) => Math.abs(cx - 250) <= LANE_HALF_WIDTH && cy <= LANE_DEPTH;

/**
 * Seconds into a possession that still counts as transition.
 *
 * Swept 4-12s against CBBD's official `teamStats.points.fastBreak` over 342
 * team-games. With free throws counted (which the official stat does) the error
 * bottoms out at 5s: MAE 3.54 against a 10.3-point mean.
 *
 * THAT IS STILL 34% RELATIVE ERROR, which is why the raw figure is not what
 * ships — see allocateFastBreak(). The threshold only decides how the official
 * team total gets SPLIT between teammates.
 */
const FB_WINDOW = 5;

const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);
const div = (a, b) => (b > 0 ? a / b : null);
const readGz = (fp) => JSON.parse(zlib.gunzipSync(fs.readFileSync(fp)).toString());

// ── Stat catalogue ─────────────────────────────────────────────────────────
//
// dir: 1 = higher is better, -1 = lower is better, 0 = no percentile.
//
// A ZERO IS NOT A SHRUG. Milestone counts, single-game leads and technical
// fouls are small integers dominated by zero — technicals run about 0.026 per
// player-game. A midrank over that collapses the entire zero block onto one
// percentile, which is arithmetically right and visually useless: a wall of
// identical chips implying a finding. Those columns ship as raw counts.

const GROUPS = {
  info: [
    // AGE RANKS DOWNWARD. A nineteen-year-old and a twenty-three-year-old
    // putting up the same line are not the same player, and the younger one is
    // the better of the two — he did it against older opposition and has more
    // in front of him. Ranking age upward said the opposite in colour.
    ["age", -1],
    ["ht_in", 1], ["draft_pick", -1],
    // ROUND AND SLOT GET NO PERCENTILE. There are two rounds, so a "round"
    // percentile is a two-valued colour ramp saying nothing the number does
    // not; and a 30th pick in the first round outranks a 1st pick in the
    // second, which a within-round rank inverts. The overall pick already
    // carries the ordering that means something.
    ["draft_rd", 0], ["draft_rd_pick", 0],
  ],
  playtime: [
    ["gp", 1], ["gs", 1], ["min", 1], ["min_pg", 1], ["win_pct", 1],
  ],
  box: [
    ["pts", 1], ["pts_40", 1], ["reb", 1], ["reb_40", 1], ["orb", 1], ["orb_40", 1],
    ["drb", 1], ["drb_40", 1], ["ast", 1], ["ast_40", 1], ["stl", 1], ["stl_40", 1],
    ["blk", 1], ["blk_40", 1], ["tov", -1], ["tov_40", -1],
    ["pf", -1], ["pf_40", -1], ["pf_pg", -1],
    ["pm", 1], ["tech", 0],
  ],
  shooting: [
    ["fgm", 1], ["fga", 1], ["fga_40", 1], ["fga_pg", 1],
    ["fg2m", 1], ["fg2a", 1], ["fg2a_40", 1], ["fg2a_pg", 1],
    ["fg3m", 1], ["fg3a", 1], ["fg3a_40", 1], ["fg3a_pg", 1],
    ["ftm", 1], ["fta", 1], ["fta_40", 1], ["fta_pg", 1],
    ["rts_pct", 1],
  ],
  context: [
    ["pitp", 1], ["pitp_40", 1], ["pitp_pg", 1], ["pitp_share", 1],
    ["scp", 1], ["scp_40", 1], ["scp_pg", 1], ["scp_share", 1],
    ["fbp", 1], ["fbp_40", 1], ["fbp_pg", 1], ["fbp_share", 1],
  ],
  advoff: [
    ["pts2_share", 1], ["pts3_share", 1], ["ptsft_share", 1],
    ["ast_pct", 1], ["ast_ratio", 1], ["ast_usg", 1], ["ppr", 1],
    ["ftm_rate", 1], ["orb_pct", 1], ["reb_pct", 1],
    ["ast_pts", 1], ["pts_created", 1], ["self_orb_pct", 1],
  ],
  advdef: [
    ["blk_pct", 1], ["stl_pct", 1], ["drb_pct", 1], ["stl_tov", 1],
  ],
  fouls: [
    ["pf_eff", 1], ["blk_pf", 1], ["stl_pf", 1], ["fouled_out", -1],
  ],
  doubles: [
    ["dd", 0], ["td", 0], ["g20p10a", 0], ["g20p10r", 0],
    ["g3x5", 0], ["g4x5", 0], ["g5x5", 0],
  ],
  leaders: [
    ["led_g_pts", 0], ["led_g_reb", 0], ["led_g_ast", 0], ["led_g_stl", 0], ["led_g_blk", 0],
    ["led_g_pa", 0], ["led_g_pr", 0], ["led_g_pra", 0], ["led_g_prasb", 0],
    ["led_t_pts", 0], ["led_t_reb", 0], ["led_t_ast", 0], ["led_t_stl", 0], ["led_t_blk", 0],
    ["led_t_pa", 0], ["led_t_pr", 0], ["led_t_pra", 0], ["led_t_prasb", 0],
  ],
};


// ── Bart-side identity ─────────────────────────────────────────────────────

function bartRows(season) {
  const fp = path.join(ROOT, "public/data/players-by-year", `${season}.json`);
  return fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, "utf8")) : [];
}

/** Bart stores height hyphenated ("6-3"); rank and filter on inches. */
function heightInches(h) {
  const m = /^(\d+)-(\d+)$/.exec(String(h ?? "").trim());
  return m ? Number(m[1]) * 12 + Number(m[2]) : null;
}

/**
 * Date of birth is the LAST cell of Bart's raw row, and there is no header to
 * confirm that against — so it is validated as a date in a plausible window
 * rather than trusted by position.
 */
function ageAt(rawRow, season) {
  if (!Array.isArray(rawRow) || !rawRow.length) return null;
  const dob = rawRow[rawRow.length - 1];
  if (typeof dob !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const born = new Date(dob + "T00:00:00Z");
  if (Number.isNaN(born.getTime())) return null;
  // Season end: April 1 of the season year. A college player outside 15-30 is
  // a parse error, not a prodigy.
  const age = (Date.UTC(season, 3, 1) - born.getTime()) / (365.2425 * 86400000);
  return age >= 15 && age <= 30 ? r1(age) : null;
}

/**
 * bart id → draft record, resolved BY COLLEGE as well as by name.
 *
 * nba-draftees.json is keyed by normalised name alone, and names collide. The
 * case that caught it: Jalen Smith of Maryland went 10th in 2020, and Jalen
 * Smith of SMU and Rice — a different person, never drafted — was being handed
 * his pick. A name-keyed lookup has no way to tell them apart.
 *
 * The record carries the college, and we know every school a bart id ever
 * played for, so the two are matched on both. Where that still leaves more
 * than one candidate, or none, the player gets NO draft data rather than a
 * guess: a blank cell is a missing fact, a wrong pick is a false one.
 */
function draftByBartId() {
  const fp = path.join(ROOT, "public/data/nba-draftees.json");
  if (!fs.existsSync(fp)) return new Map();
  const draft = JSON.parse(fs.readFileSync(fp, "utf8"));

  // Every school each bart id ever appears under, across every season we hold.
  const schools = new Map();   // bartId -> Set<normalised school>
  const byName = new Map();    // normalised name -> Set<bartId>
  /**
   * EVERY ROSTER FILE, not just the seasons this pack builds. 2021 has no
   * player box and no play-by-play, so it is excluded everywhere else — but it
   * has a roster, and leaving it out hid the one season that identifies a
   * player. Jalen Johnson's only Duke year is 2021; without it the 2021 draft's
   * 20th pick matched nobody and went blank.
   */
  for (const year of ROSTER_SEASONS) {
    for (const p of bartRows(year)) {
      if (p.bart_player_id == null || !p.name) continue;
      const id = p.bart_player_id;
      const team = Array.isArray(p.teams) ? p.teams[0] : p.teams;
      if (team?.name) {
        let set = schools.get(id);
        if (!set) { set = new Set(); schools.set(id, set); }
        set.add(normSchool(team.name));
      }
      const nn = normDraftName(p.name);
      let ids = byName.get(nn);
      if (!ids) { ids = new Set(); byName.set(nn, ids); }
      ids.add(id);
    }
  }

  const out = new Map();
  let matched = 0, ambiguous = 0, unmatched = 0;
  for (const [name, rec] of Object.entries(draft)) {
    const ids = byName.get(normDraftName(name));
    if (!ids || ids.size === 0) { unmatched++; continue; }
    if (ids.size === 1) {
      // One player by that name — no collision to resolve.
      out.set([...ids][0], rec);
      matched++;
      continue;
    }
    const college = normSchool(rec.college ?? "");
    if (!college) { ambiguous++; continue; }
    const played = (id, test) => {
      const set = schools.get(id);
      if (!set) return false;
      for (const s of set) if (test(s)) return true;
      return false;
    };
    /**
     * EXACT FIRST, and containment only if exactly one candidate survives it.
     *
     * Plain substring matching put Brandon Miller of Alabama and Brandon Miller
     * of Alabama A&M in the same bucket — "alabama" is inside "alabamaaandm" —
     * so the real second pick of 2023 was thrown out as ambiguous. Exact
     * equality separates them; containment stays as a fallback for the schools
     * whose names genuinely differ in length between the two sources.
     */
    let fits = [...ids].filter((id) => played(id, (s) => s === college));
    if (fits.length !== 1) {
      fits = [...ids].filter((id) => played(id, (s) => s.includes(college) || college.includes(s)));
    }
    if (fits.length === 1) { out.set(fits[0], rec); matched++; }
    else ambiguous++;
  }
  out.stats = { matched, ambiguous, unmatched };
  return out;
}

/**
 * The draft source writes schools the way a broadcast does — UNC, UConn — and
 * our roster writes them out. Neither spelling is wrong and no amount of
 * normalising turns one into the other, so the handful that differ are listed.
 */
const SCHOOL_ALIASES = {
  unc: "northcarolina",
  uconn: "connecticut",
  usc: "southerncalifornia",
  ucf: "centralflorida",
  pitt: "pittsburgh",
  olemiss: "mississippi",
  umass: "massachusetts",
  smu: "southernmethodist",
  lsu: "louisianastate",
  vcu: "virginiacommonwealth",
  byu: "brighamyoung",
  tcu: "texaschristian",
};

/** School names for comparison — "St." vs "State", punctuation, case. */
function normSchool(s) {
  const n = String(s ?? "").toLowerCase()
    .replace(/\bst\.?\b/g, "state")
    .replace(/\buniversity\b|\bthe\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
  return SCHOOL_ALIASES[n] ?? n;
}
const normDraftName = (s) => String(s ?? "").toLowerCase().normalize("NFKD")
  .replace(/[̀-ͯ]/g, "").replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim()
  .replace(/\s+(jr|sr|ii|iii|iv|v)$/, "");

// ── Main ───────────────────────────────────────────────────────────────────

function buildSeason(season) {
  const t0 = Date.now();
  const dir = path.join(CBBD, String(season));
  const boxFile = path.join(dir, "box-players-full.json.gz");
  const tboxFile = path.join(dir, "box-teams-full.json.gz");
  if (!fs.existsSync(boxFile) || !fs.existsSync(tboxFile)) {
    console.log(`${season}: skipped (no box archive)`);
    return null;
  }

  const rows = bartRows(season);
  const bart = buildPlayerIndex(rows);
  if (!bart.exact.size) { console.log(`${season}: skipped (no bart index)`); return null; }

  const A = new Map();          // bartId → accumulator
  const acc = (id) => {
    let a = A.get(id);
    if (!a) {
      a = {
        gp: 0, gs: 0, min: 0, w: 0, l: 0,
        pts: 0, reb: 0, orb: 0, drb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0,
        fgm: 0, fga: 0, fg2m: 0, fg2a: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0,
        fouled_out: 0,
        dd: 0, td: 0, g20p10a: 0, g20p10r: 0, g3x5: 0, g4x5: 0, g5x5: 0,
        // team context, accumulated only over the games he actually played
        tmMp: 0, tmFgm: 0, tmFga: 0, tmOrb: 0, tmDrb: 0, tmReb: 0, tmTov: 0,
        tmFta: 0, tmPoss: 0, oppFga: 0, opp3pa: 0, oppOrb: 0, oppDrb: 0,
        oppReb: 0, oppPoss: 0,
        // pbp
        pitp: 0, scp: 0, fbRaw: 0, fbp: 0, tech: 0, pm: 0, pmSeen: 0,
        ast_pts: 0, selfOrb: 0, ownMiss: 0,
      };
      for (const [k] of GROUPS.leaders) a[k] = 0;
      A.set(id, a);
    }
    return a;
  };

  // ── Pass 1: team box. Per-team-game context and the official totals. ─────
  const tg = new Map();  // "gameId|teamId" → context
  for (const r of readGz(tboxFile)) {
    const s = r.teamStats, o = r.opponentStats;
    if (!s || !o) continue;
    tg.set(`${r.gameId}|${r.teamId}`, {
      mp: (r.gameMinutes ?? 40) * 5,
      fgm: s.fieldGoals?.made ?? 0, fga: s.fieldGoals?.attempted ?? 0,
      fta: s.freeThrows?.attempted ?? 0,
      orb: s.rebounds?.offensive ?? 0, drb: s.rebounds?.defensive ?? 0,
      reb: s.rebounds?.total ?? 0, tov: s.turnovers?.total ?? 0,
      poss: s.possessions ?? 0,
      oppFga: o.fieldGoals?.attempted ?? 0, opp3pa: o.threePointFieldGoals?.attempted ?? 0,
      oppOrb: o.rebounds?.offensive ?? 0, oppDrb: o.rebounds?.defensive ?? 0,
      oppReb: o.rebounds?.total ?? 0, oppPoss: o.possessions ?? 0,
      win: (s.points?.total ?? 0) > (o.points?.total ?? 0),
      fbOfficial: s.points?.fastBreak ?? null,
      pitpOfficial: s.points?.inPaint ?? null,
    });
  }

  // ── Pass 2: player box. Counting stats, milestones, leaders. ─────────────
  //
  // Leaders need every player in the GAME, not just the team, so the box is
  // walked game by game: box-players-full groups both sides under one gameId.
  const byGame = new Map();
  for (const r of readGz(boxFile)) {
    if (!Array.isArray(r.players)) continue;
    const l = byGame.get(r.gameId);
    if (l) l.push(r); else byGame.set(r.gameId, [r]);
  }

  let matched = 0, unmatched = 0;
  for (const sides of byGame.values()) {
    // Resolve every player in the game once, then score leads over the results.
    const inGame = [];
    for (const side of sides) {
      const team = TEAM_MAP[side.teamId];
      if (!team) continue;
      const tk = norm(team.name);
      const ctx = tg.get(`${side.gameId}|${side.teamId}`);
      for (const p of side.players) {
        if (!p?.name) continue;
        const id = resolvePlayer(bart, tk, p.name);
        if (id == null) { unmatched++; continue; }
        matched++;
        inGame.push({ id, teamId: side.teamId, p, ctx });
      }
    }
    if (!inGame.length) continue;

    // Per-game accumulation.
    for (const { id, p, ctx } of inGame) {
      const a = acc(id);
      const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
      const pts = n(p.points), reb = n(p.rebounds?.total), ast = n(p.assists);
      const stl = n(p.steals), blk = n(p.blocks), orb = n(p.rebounds?.offensive);
      const fouls = n(p.fouls);

      a.gp++;
      if (p.starter === true) a.gs++;
      a.min += n(p.minutes);
      a.pts += pts; a.reb += reb; a.orb += orb;
      a.drb += n(p.rebounds?.defensive); a.ast += ast; a.stl += stl; a.blk += blk;
      a.tov += n(p.turnovers); a.pf += fouls;
      a.fgm += n(p.fieldGoals?.made); a.fga += n(p.fieldGoals?.attempted);
      a.fg2m += n(p.twoPointFieldGoals?.made); a.fg2a += n(p.twoPointFieldGoals?.attempted);
      a.fg3m += n(p.threePointFieldGoals?.made); a.fg3a += n(p.threePointFieldGoals?.attempted);
      a.ftm += n(p.freeThrows?.made); a.fta += n(p.freeThrows?.attempted);
      if (fouls >= 5) a.fouled_out++;

      // Milestones. Ten-plus in two of the five categories is a double-double;
      // three is a triple-double. Counting from the same five keeps 5x5 and the
      // doubles on one definition.
      const five = [pts, reb, ast, stl, blk];
      const tens = five.filter((v) => v >= 10).length;
      if (tens >= 2) a.dd++;
      if (tens >= 3) a.td++;
      if (pts >= 20 && ast >= 10) a.g20p10a++;
      if (pts >= 20 && reb >= 10) a.g20p10r++;
      if (five.every((v) => v >= 3)) a.g3x5++;
      if (five.every((v) => v >= 4)) a.g4x5++;
      if (five.every((v) => v >= 5)) a.g5x5++;

      if (ctx) {
        if (ctx.win) a.w++; else a.l++;
        a.tmMp += ctx.mp; a.tmFgm += ctx.fgm; a.tmFga += ctx.fga; a.tmFta += ctx.fta;
        a.tmOrb += ctx.orb; a.tmDrb += ctx.drb; a.tmReb += ctx.reb; a.tmTov += ctx.tov;
        a.tmPoss += ctx.poss;
        a.oppFga += ctx.oppFga; a.opp3pa += ctx.opp3pa; a.oppOrb += ctx.oppOrb;
        a.oppDrb += ctx.oppDrb; a.oppReb += ctx.oppReb; a.oppPoss += ctx.oppPoss;
      }
    }

    // Leads. A tie counts for everyone tied — any other rule needs a tiebreak
    // we would have to invent.
    const COMBOS = {
      pts: (p) => p.points, reb: (p) => p.rebounds?.total, ast: (p) => p.assists,
      stl: (p) => p.steals, blk: (p) => p.blocks,
      pa: (p) => (p.points ?? 0) + (p.assists ?? 0),
      pr: (p) => (p.points ?? 0) + (p.rebounds?.total ?? 0),
      pra: (p) => (p.points ?? 0) + (p.rebounds?.total ?? 0) + (p.assists ?? 0),
      prasb: (p) => (p.points ?? 0) + (p.rebounds?.total ?? 0) + (p.assists ?? 0) +
                    (p.steals ?? 0) + (p.blocks ?? 0),
    };
    for (const [key, get] of Object.entries(COMBOS)) {
      const vals = inGame.map((e) => Number(get(e.p)) || 0);
      // Game-wide lead. Zero never counts as leading anything.
      const gMax = Math.max(...vals);
      if (gMax > 0) {
        inGame.forEach((e, i) => { if (vals[i] === gMax) acc(e.id)[`led_g_${key}`]++; });
      }
      // Team lead, scored within each side separately.
      for (const teamId of new Set(inGame.map((e) => e.teamId))) {
        let tMax = 0;
        inGame.forEach((e, i) => { if (e.teamId === teamId && vals[i] > tMax) tMax = vals[i]; });
        if (tMax > 0) {
          inGame.forEach((e, i) => {
            if (e.teamId === teamId && vals[i] === tMax) acc(e.id)[`led_t_${key}`]++;
          });
        }
      }
    }
  }

  // ── Pass 3: play-by-play. ───────────────────────────────────────────────
  //
  // COVERAGE IS CHECKED FIRST, AND A THIN ARCHIVE PUBLISHES NOTHING.
  //
  // `/plays/date` does not merely fail on a big slate, it returns 200 with a
  // silently truncated one — see the header of scripts/cbbd-repair-plays.mjs.
  // 2024 and 2025 were ingested before the per-game fallback existed and have
  // since been repaired; 2014-2023 have not, and sit at 51-58% of their games.
  //
  // Half a season of play-by-play does not produce a half-confident number, it
  // produces a confidently wrong one: a player's paint points would read 200
  // when the truth is 400, with nothing on the page to say so. So the gate is
  // measured per season rather than hardcoded to a year — run the repair and
  // these light up on the next build with no code change.
  const pbpGamesPresent = new Set();
  const pbpStats = { files: 0, plays: 0, fbGames: 0, fbAllocated: 0, fbOrphan: 0 };
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((n) => /^plays-\d{8}\.json\.gz$/.test(n)).sort()
    : [];
  const seenPlay = new Set();
  /**
   * Raw detections per (game|team), so an official team total can be split
   * across the players who earned it. Used for BOTH fast break and paint —
   * see allocate() and the two calls under it for why each needs it.
   */
  const fbRawByTeam = new Map();
  const fbRawByPlayer = new Map();     // "game|team" → Map(bartId → raw pts)
  const pitpRawByTeam = new Map();
  const pitpRawByPlayer = new Map();
  /**
   * Fallback basis for paint, used only where the primary one is empty.
   *
   * 1,413 team-games in 2026 have made field goals in the play feed and not one
   * of them carries a location, so the lane rectangle has nothing to measure
   * and those games would contribute zero — an 87.4% ceiling on the season.
   * `shotInfo.range` is always present, and "rim" (dunks, layups, tip-ins) is a
   * strict subset of the paint. As a raw count it undercounts badly, which is
   * why it is not the primary; as a SHARE between teammates it is fine, and the
   * official team total still sets the level.
   */
  const pitpAltByTeam = new Map();
  const pitpAltByPlayer = new Map();

  for (const f of files) {
    pbpStats.files++;
    const plays = readGz(path.join(dir, f));
    const games = new Map();
    for (const p of plays) {
      if (p.id != null) { if (seenPlay.has(p.id)) continue; seenPlay.add(p.id); }
      const l = games.get(p.gameId);
      if (l) l.push(p); else games.set(p.gameId, [p]);
    }
    pbpStats.plays += plays.length;

    for (const [gameId, g] of games) {
      pbpGamesPresent.add(gameId);
      // CBBD team name → bart-normalised name, for resolving PBP participants.
      const teamName = new Map();
      for (const p of g) {
        if (TEAM_MAP[p.teamId]) teamName.set(p.team, norm(TEAM_MAP[p.teamId].name));
        if (TEAM_MAP[p.opponentId]) teamName.set(p.opponent, norm(TEAM_MAP[p.opponentId].name));
      }
      const idOf = (name, cbbdTeam) => {
        const tk = teamName.get(cbbdTeam);
        return tk && name ? resolvePlayer(bart, tk, name) : null;
      };

      let poss = null;          // { t, team, per } — who has the ball, since when
      let lastMissBy = null;    // { id, team } — for self-offensive-rebound

      for (const p of g) {
        const si = p.shotInfo;
        const own = TEAM_MAP[p.teamId] ? norm(TEAM_MAP[p.teamId].name) : null;

        if (si && si.range !== "free_throw") {
          const shooter = si.shooter?.name ? resolvePlayer(bart, own, si.shooter.name) : null;

          if (si.made) {
            const pts = si.range === "three_pointer" ? 3 : 2;
            // Points in the paint — lane rectangle, MAE 0.42 vs official.
            const l = si.location;
            if (l && Number.isFinite(l.x) && Number.isFinite(l.y) &&
                l.x >= 0 && l.x <= 940 && l.y >= 0 && l.y <= 500) {
              const [cx, cy] = fold(l.x, l.y);
              if (inPaint(cx, cy) && shooter != null) {
                const k = `${gameId}|${p.teamId}`;
                pitpRawByTeam.set(k, (pitpRawByTeam.get(k) ?? 0) + pts);
                let m = pitpRawByPlayer.get(k);
                if (!m) { m = new Map(); pitpRawByPlayer.set(k, m); }
                m.set(shooter, (m.get(shooter) ?? 0) + pts);
              }
            }
            // Fallback basis — see pitpAltByTeam. Accumulated for every game,
            // consulted only where the coordinate basis came up empty.
            if (si.range === "rim" && shooter != null) {
              const k = `${gameId}|${p.teamId}`;
              pitpAltByTeam.set(k, (pitpAltByTeam.get(k) ?? 0) + pts);
              let m = pitpAltByPlayer.get(k);
              if (!m) { m = new Map(); pitpAltByPlayer.set(k, m); }
              m.set(shooter, (m.get(shooter) ?? 0) + pts);
            }
            // Second chance — this possession began with an offensive rebound.
            if (shooter != null && poss?.orb && poss.team === p.teamId && poss.per === p.period) {
              acc(shooter).scp += pts;
            }
            // Assist points go to the PASSER, at the value of the shot he set up.
            if (si.assisted && si.assistedBy?.name) {
              const passer = resolvePlayer(bart, own, si.assistedBy.name);
              if (passer != null) acc(passer).ast_pts += pts;
            }
            // Raw transition, for allocation below.
            if (shooter != null && poss && poss.team === p.teamId && poss.per === p.period &&
                poss.t - p.secondsRemaining >= 0 && poss.t - p.secondsRemaining <= FB_WINDOW) {
              const k = `${gameId}|${p.teamId}`;
              fbRawByTeam.set(k, (fbRawByTeam.get(k) ?? 0) + pts);
              let m = fbRawByPlayer.get(k);
              if (!m) { m = new Map(); fbRawByPlayer.set(k, m); }
              m.set(shooter, (m.get(shooter) ?? 0) + pts);
            }
            lastMissBy = null;
          } else {
            lastMissBy = { id: shooter, teamId: p.teamId };
          }
        }

        // A made free throw in transition still counts toward the official
        // stat, so it counts toward the raw split too.
        if (si && si.range === "free_throw" && si.made) {
          const shooter = si.shooter?.name ? resolvePlayer(bart, own, si.shooter.name) : null;
          if (shooter != null && poss && poss.team === p.teamId && poss.per === p.period &&
              poss.t - p.secondsRemaining >= 0 && poss.t - p.secondsRemaining <= FB_WINDOW) {
            const k = `${gameId}|${p.teamId}`;
            fbRawByTeam.set(k, (fbRawByTeam.get(k) ?? 0) + 1);
            let m = fbRawByPlayer.get(k);
            if (!m) { m = new Map(); fbRawByPlayer.set(k, m); }
            m.set(shooter, (m.get(shooter) ?? 0) + 1);
          }
        }

        if (p.playType === "Technical Foul") {
          const who = p.participants?.[0]?.name;
          const id = who ? resolvePlayer(bart, own, who) : null;
          if (id != null) acc(id).tech++;
        }

        // Plus/minus, 2024+. Every player on the floor is credited with the
        // scoring play, positively for his side and negatively for the other.
        if (season >= PM_FIRST_YEAR && p.scoringPlay && p.scoreValue > 0 &&
            Array.isArray(p.onFloor) && p.onFloor.length === 10) {
          const scoringTeam = p.team;
          for (const e of p.onFloor) {
            const id = idOf(e.name, e.team);
            if (id == null) continue;
            const a = acc(id);
            a.pm += e.team === scoringTeam ? p.scoreValue : -p.scoreValue;
            a.pmSeen++;
          }
        }

        // Possession bookkeeping. `orb` marks a possession that began with an
        // offensive rebound, which is what makes the points on it second-chance.
        if (p.playType === "Offensive Rebound") {
          const who = p.participants?.[0]?.name;
          const id = who ? resolvePlayer(bart, own, who) : null;
          if (id != null && lastMissBy && lastMissBy.id === id) acc(id).selfOrb++;
          if (lastMissBy?.id != null) acc(lastMissBy.id).ownMiss++;
          poss = { t: p.secondsRemaining, team: p.teamId, per: p.period, orb: true };
          lastMissBy = null;
        } else if (p.playType === "Defensive Rebound" || p.playType === "Steal") {
          poss = { t: p.secondsRemaining, team: p.teamId, per: p.period, orb: false };
          lastMissBy = null;
        } else if (/Turnover/.test(p.playType)) {
          poss = { t: p.secondsRemaining, team: p.opponentId, per: p.period, orb: false };
        }
      }
    }
  }

  // ── Allocate the official team totals. ──────────────────────────────────
  //
  // BOTH fast break and paint are published by CBBD at TEAM level and by
  // nobody at player level. Our per-player detection is used only to decide how
  // that official total SPLITS between teammates: team sums then match the
  // official figure exactly, and all remaining error lives in the split.
  //
  // Each needs it for a different reason, and both reasons are the same shape —
  // a bias that is not uniform across players:
  //
  //   FAST BREAK  no transition tag exists. A 5-second possession window is
  //               the best proxy and still lands at MAE 3.54 on a 10.3-point
  //               mean — 34% error, not a number to publish raw.
  //   PAINT       the lane rectangle is accurate (MAE 0.42) but only for shots
  //               that HAVE coordinates, and 12.3% of made field goals in 2026
  //               do not. Left raw, the season total came to 85% of official,
  //               and the missing sixth is concentrated in whichever games went
  //               unlogged — so a player was penalised for his venue.
  const allocate = (rawByPlayer, rawByTeam, officialKey, field, stats, alt) => {
    // Every team-game with an official total is walked, not just the ones the
    // primary basis found — otherwise a game the primary cannot see is silently
    // dropped rather than handed to the fallback.
    const keys = new Set([...rawByPlayer.keys(), ...(alt ? alt.byPlayer.keys() : [])]);
    for (const k of keys) {
      const official = tg.get(k)?.[officialKey];
      stats.games++;
      if (official == null) { stats.orphan++; continue; }
      let byPlayer = rawByPlayer.get(k);
      let raw = rawByTeam.get(k) ?? 0;
      if (raw <= 0 && alt) {
        byPlayer = alt.byPlayer.get(k);
        raw = alt.byTeam.get(k) ?? 0;
        if (raw > 0) stats.viaFallback++;
      }
      if (!byPlayer || raw <= 0) { stats.orphan++; continue; }
      const scale = official / raw;
      for (const [id, v] of byPlayer) acc(id)[field] += v * scale;
      stats.allocated++;
    }
  };
  const fbStats = { games: 0, allocated: 0, orphan: 0, viaFallback: 0 };
  const pitpStats = { games: 0, allocated: 0, orphan: 0, viaFallback: 0 };
  allocate(fbRawByPlayer, fbRawByTeam, "fbOfficial", "fbp", fbStats);
  allocate(pitpRawByPlayer, pitpRawByTeam, "pitpOfficial", "pitp", pitpStats,
           { byPlayer: pitpAltByPlayer, byTeam: pitpAltByTeam });
  pbpStats.fbGames = fbStats.games;
  pbpStats.fbAllocated = fbStats.allocated;
  pbpStats.pitpAllocated = pitpStats.allocated;
  pbpStats.pitpGames = pitpStats.games;
  pbpStats.pitpFallback = pitpStats.viaFallback;

  // ── Derive, and emit. ───────────────────────────────────────────────────
  const draft = DRAFT;
  const meta = new Map();
  for (const p of rows) {
    if (p.bart_player_id == null) continue;
    meta.set(p.bart_player_id, p);
  }

  const ids = [...A.keys()].sort((a, b) => a - b);
  const V = new Map();  // key → array aligned to ids
  const put = (key, fn) => V.set(key, ids.map((id) => fn(A.get(id), meta.get(id))));

  const per40 = (a, v) => (a.min >= MIN_MIN_FOR_PER40 && a.min > 0 ? r1((v / a.min) * 40) : null);
  const perG = (a, v) => (a.gp > 0 ? r1(v / a.gp) : null);
  /** Team-context rates need enough court time to mean anything. */
  const rate = (a, fn) => (a.min >= MIN_MIN_FOR_RATE ? fn() : null);

  // info
  put("age", (a, m) => (m ? ageAt(m.player_bart_stats?.raw_row, season) : null));
  put("ht_in", (a, m) => (m ? heightInches(m.height) : null));
  const draftOf = (id) => draft.get(id) ?? null;
  put("draft_pick", (a, m) => {
    const d = m ? draftOf(m.bart_player_id) : null;
    return d && typeof d.pick === "number" ? d.pick : null;
  });
  // Round is DERIVED — nba-draftees.json stores no round. Right in a normal
  // 60-pick year, off by one slot in a year with forfeited picks (2024 had 58).
  put("draft_rd", (a, m) => {
    const d = m ? draftOf(m.bart_player_id) : null;
    return d && typeof d.pick === "number" ? (d.pick <= 30 ? 1 : 2) : null;
  });
  put("draft_rd_pick", (a, m) => {
    const d = m ? draftOf(m.bart_player_id) : null;
    return d && typeof d.pick === "number" ? (d.pick <= 30 ? d.pick : d.pick - 30) : null;
  });

  // playtime
  put("gp", (a) => a.gp);
  put("gs", (a) => a.gs);
  put("min", (a) => Math.round(a.min));
  put("min_pg", (a) => perG(a, a.min));
  put("win_pct", (a) => r3(div(a.w, a.w + a.l)));

  // box
  for (const [k, f] of [["pts", "pts"], ["reb", "reb"], ["orb", "orb"], ["drb", "drb"],
                        ["ast", "ast"], ["stl", "stl"], ["blk", "blk"], ["tov", "tov"]]) {
    put(k, (a) => a[f]);
    put(`${k}_40`, (a) => per40(a, a[f]));
  }
  put("pf", (a) => a.pf);
  put("pf_40", (a) => per40(a, a.pf));
  put("pf_pg", (a) => perG(a, a.pf));
  // Plus/minus is null, not zero, where the season has no lineup data at all.
  put("pm", (a) => (season >= PM_FIRST_YEAR && a.pmSeen > 0 ? a.pm : null));
  put("tech", (a) => a.tech);

  // shooting
  for (const [k, f] of [["fga", "fga"], ["fg2a", "fg2a"], ["fg3a", "fg3a"], ["fta", "fta"]]) {
    put(k, (a) => a[f]);
    put(`${k}_40`, (a) => per40(a, a[f]));
    put(`${k}_pg`, (a) => perG(a, a[f]));
  }
  put("fgm", (a) => a.fgm); put("fg2m", (a) => a.fg2m);
  put("fg3m", (a) => a.fg3m); put("ftm", (a) => a.ftm);
  // rTS% — true shooting against the season's own D-I mean, so a 56% in 2014
  // and a 56% in 2026 are not read as the same season. Baseline computed below.
  V.set("rts_pct", null); // filled after the league mean is known

  // context
  // pitp and fbp are allocated shares of an official team total, so they are
  // fractional by construction; scp is a straight count.
  for (const [k, f] of [["pitp", "pitp"], ["scp", "scp"], ["fbp", "fbp"]]) {
    put(k, (a) => (f === "scp" ? a[f] : r1(a[f])));
    put(`${k}_40`, (a) => per40(a, a[f]));
    put(`${k}_pg`, (a) => perG(a, a[f]));
    put(`${k}_share`, (a) => r3(div(a[f], a.pts)));
  }

  // advanced — offense
  put("pts2_share", (a) => r3(div(2 * a.fg2m, a.pts)));
  put("pts3_share", (a) => r3(div(3 * a.fg3m, a.pts)));
  put("ptsft_share", (a) => r3(div(a.ftm, a.pts)));
  put("ast_pct", (a) => rate(a, () => {
    const share = div(a.min, a.tmMp / 5);
    if (share == null) return null;
    const den = share * a.tmFgm - a.fgm;
    return den > 0 ? r1((100 * a.ast) / den) : null;
  }));
  put("ast_ratio", (a) => r1(div(100 * a.ast, a.fga + 0.44 * a.fta + a.ast + a.tov)));
  // ast_usg needs both ast_pct and a usage rate, so it is filled in below.
  put("ppr", (a) => rate(a, () => {
    const possPlayed = a.tmPoss * (a.min / (a.tmMp / 5 || 1));
    return possPlayed > 0 ? r1((100 * ((2 / 3) * a.ast - a.tov)) / possPlayed) : null;
  }));
  put("ftm_rate", (a) => r3(div(a.ftm, a.fga)));
  put("orb_pct", (a) => rate(a, () => {
    const den = a.min * (a.tmOrb + a.oppDrb);
    return den > 0 ? r1((100 * a.orb * (a.tmMp / 5)) / den) : null;
  }));
  put("reb_pct", (a) => rate(a, () => {
    const den = a.min * (a.tmReb + a.oppReb);
    return den > 0 ? r1((100 * a.reb * (a.tmMp / 5)) / den) : null;
  }));
  put("ast_pts", (a) => a.ast_pts);
  put("pts_created", (a) => a.pts + a.ast_pts);
  // Self-ORB%: of his own misses, how many he rebounded himself.
  put("self_orb_pct", (a) => (a.ownMiss >= 20 ? r1((100 * a.selfOrb) / a.ownMiss) : null));

  // advanced — defense
  put("blk_pct", (a) => rate(a, () => {
    const den = a.min * (a.oppFga - a.opp3pa);
    return den > 0 ? r1((100 * a.blk * (a.tmMp / 5)) / den) : null;
  }));
  put("stl_pct", (a) => rate(a, () => {
    const den = a.min * a.oppPoss;
    return den > 0 ? r1((100 * a.stl * (a.tmMp / 5)) / den) : null;
  }));
  put("drb_pct", (a) => rate(a, () => {
    const den = a.min * (a.tmDrb + a.oppOrb);
    return den > 0 ? r1((100 * a.drb * (a.tmMp / 5)) / den) : null;
  }));
  put("stl_tov", (a) => r2(div(a.stl, a.tov)));

  // fouls
  put("pf_eff", (a) => r2(div(a.stl + a.blk, a.pf)));
  put("blk_pf", (a) => r2(div(a.blk, a.pf)));
  put("stl_pf", (a) => r2(div(a.stl, a.pf)));
  put("fouled_out", (a) => a.fouled_out);

  // doubles + leaders — raw counts
  for (const [k] of [...GROUPS.doubles, ...GROUPS.leaders]) put(k, (a) => a[k]);

  // rTS% needs the season's own mean, so it is computed after the totals exist.
  {
    let tsNum = 0, tsDen = 0;
    for (const id of ids) {
      const a = A.get(id);
      const den = 2 * (a.fga + 0.44 * a.fta);
      if (den > 0 && a.min >= MIN_MIN_FOR_RATE) { tsNum += a.pts; tsDen += den; }
    }
    const leagueTs = tsDen > 0 ? tsNum / tsDen : null;
    V.set("rts_pct", ids.map((id) => {
      const a = A.get(id);
      const den = 2 * (a.fga + 0.44 * a.fta);
      if (!leagueTs || den <= 0 || a.min < MIN_MIN_FOR_RATE) return null;
      return r3(a.pts / den - leagueTs);
    }));
  }

  // AST/USG needs a usage rate; take it from the aggregate the site already
  // ships rather than recomputing a second, slightly different usage.
  {
    const advFp = path.join(ROOT, "public/data/player-season-adv.json");
    const adv = fs.existsSync(advFp) ? JSON.parse(fs.readFileSync(advFp, "utf8")) : {};
    const astPct = V.get("ast_pct");
    V.set("ast_usg", ids.map((id, i) => {
      const u = adv[`${id}|${season}`]?.usage_pct;
      const ap = astPct[i];
      return typeof u === "number" && u > 0 && ap != null ? r2(ap / (u * 100)) : null;
    }));
  }

  // ── The play-by-play gate. ──────────────────────────────────────────────
  //
  // Everything derived from the play feed is withheld wholesale when the
  // archive is too thin to support it. Plus/minus is not listed: it carries its
  // own, stricter gate (PM_FIRST_YEAR) because it needs `onFloor` rather than
  // merely enough games.
  const PBP_DERIVED = [
    "pitp", "pitp_40", "pitp_pg", "pitp_share",
    "scp", "scp_40", "scp_pg", "scp_share",
    "fbp", "fbp_40", "fbp_pg", "fbp_share",
    "tech",
    "ast_pts", "pts_created", "self_orb_pct",
  ];
  const boxGameIds = new Set([...tg.keys()].map((k) => Number(k.split("|")[0])));
  let covered = 0;
  for (const g of boxGameIds) if (pbpGamesPresent.has(g)) covered++;
  const pbpCoverage = boxGameIds.size > 0 ? covered / boxGameIds.size : 0;
  const pbpOk = pbpCoverage >= 0.9;
  if (!pbpOk) {
    for (const k of PBP_DERIVED) V.set(k, ids.map(() => null));
  }

  // ── Percentiles, and write. ─────────────────────────────────────────────
  const outDir = path.join(OUT_DIR, String(season));
  fs.mkdirSync(outDir, { recursive: true });

  let bytes = 0;
  for (const [group, defs] of Object.entries(GROUPS)) {
    const cols = defs.map(([k]) => k);
    const dirs = defs.map(([, d]) => d);
    const vals = cols.map((k) => V.get(k) ?? ids.map(() => null));
    const pcts = defs.map(([_k, d], ci) => {
      if (d === 0) return null;
      // Per-40 stats rank only over players past the floor. Everyone else is
      // already null in `vals`, so the ranker excludes them for free — but say
      // it out loud, because it is the reason the cohort is fixed at build time.
      return midrankPercentiles(vals[ci], d === 1);
    });
    const payload = { season, group, cols, dir: dirs, ids, vals, pcts, pbpCoverage: Math.round(pbpCoverage * 1000) / 1000 };
    const fp = path.join(outDir, `${group}.json`);
    fs.writeFileSync(fp, JSON.stringify(payload));
    bytes += fs.statSync(fp).size;
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  const rateP = matched + unmatched > 0 ? (100 * matched) / (matched + unmatched) : 0;
  console.log(
    `${season}: ${ids.length.toLocaleString()} players  ` +
    `${(bytes / 1024 / 1024).toFixed(2)} MB  ` +
    `box ${rateP.toFixed(1)}% joined  ` +
    `pbp ${pbpStats.plays.toLocaleString()} plays  ` +
    `pbp ${(pbpCoverage * 100).toFixed(1)}% of games${pbpOk ? "" : " — PBP STATS WITHHELD"}  ` +
    `${secs}s`,
  );
  return { season, players: ids.length, bytes, fb: pbpStats };
}

/** Built once — it walks every season to resolve name collisions. */
const DRAFT = draftByBartId();
console.log(
  `draft: ${DRAFT.stats.matched} matched, ${DRAFT.stats.ambiguous} left blank as ambiguous, ` +
  `${DRAFT.stats.unmatched} not in our player files`,
);

const done = [];
for (const y of SEASONS) {
  const r = buildSeason(y);
  if (r) done.push(r);
}
const totalMb = done.reduce((s, r) => s + r.bytes, 0) / 1024 / 1024;
console.log(`\n✓ ${done.length} seasons → ${path.relative(ROOT, OUT_DIR)}  (${totalMb.toFixed(1)} MB total)`);
