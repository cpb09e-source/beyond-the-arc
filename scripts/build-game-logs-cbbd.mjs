#!/usr/bin/env node
/**
 * build-game-logs-cbbd.mjs — public/data/game-logs-by-year/<season>.json,
 * built directly from the CBBD team box archive.
 *
 * REPLACES: the Supabase `game_logs` table (CBB Analytics' /team-game-stats),
 * which used to be exported by scripts/export-static-data.mts. See
 * docs/data-sources.md for why that source is gone.
 *
 * One row per TEAM PERSPECTIVE of a game — a D-I game produces two rows, one
 * from each side, which is what lets /calc ask "how often does a team win when
 * it loses the turnover battle" without a self-join.
 *
 * WHAT CHANGED vs THE OLD CBBA-SOURCED FILE
 *   - `cbba_game_id` → `game_id`, formatted "<cbbdGameId>-<teamId>". The shared
 *     numeric prefix still identifies the game, so gameKey() is unchanged and
 *     the per-game box/player sidecars key off it exactly as before.
 *   - ast_diff, stl_diff, blk_diff, ft_att_diff and fg3_pct_def were null in
 *     EVERY row of the old file (CBBA never populated them). CBBD carries all
 *     five, so they are now real numbers.
 *   - New: fg2_att_diff, fg_att_diff, pf_diff, pot_diff (points off turnovers),
 *     opp_conference, non_d1.
 *   - scp_diff (second-chance points) has no CBBD box equivalent. It is read
 *     from the play-by-play-derived sidecar written by
 *     scripts/build-second-chance.mjs, and is null for any season whose PBP
 *     has not been ingested.
 *
 * WHICH ROWS ARE EMITTED: only perspectives whose OWN team resolves to a Bart
 * D-I team (src/data/cbbd-team-map.json). CBBD also carries the non-D1 side of
 * every D-I-vs-non-D1 game; Bart's universe is D-I only, and emitting those
 * would double-count exhibition-grade opponents into every conference average.
 * The opponent may still be non-D1 — that row is kept and flagged `non_d1`.
 *
 * Usage:
 *   node scripts/build-game-logs-cbbd.mjs
 *   node scripts/build-game-logs-cbbd.mjs --season 2026
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { etDate } from "./lib/cbbd-join.mjs";
import { possessionsFor, trackedSplit } from "./lib/cbbd-stats.mjs";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "public/data/game-logs-by-year");
const SEASONS = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

const args = process.argv.slice(2);
const oneSeason = args.includes("--season") ? Number(args[args.indexOf("--season") + 1]) : null;

const TEAM_MAP = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/cbbd-team-map.json"), "utf8"));

/** (bart name|season) → Bart conference code, so realignment is respected. */
const CONF_BY_TEAM_YEAR = (() => {
  const m = new Map();
  const teams = JSON.parse(fs.readFileSync(path.join(ROOT, "public/data/teams-all.json"), "utf8"));
  for (const t of teams) if (t.name) m.set(`${t.name}|${t.year}`, t.conference ?? null);
  return m;
})();

const int = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
const n2 = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
/** CBBD sends percentages 0-100; every other surface on the site stores 0-1. */
const pct = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10) / 1000 : null);
/** a − b, but null unless BOTH sides are present (0 is a real value, null isn't). */
const diff = (a, b) => (typeof a === "number" && typeof b === "number" ? a - b : null);

function readTeamBox(season) {
  const fp = path.join(ROOT, "data/cbbd", String(season), "box-teams-full.json.gz");
  if (!fs.existsSync(fp)) return [];
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(fp)).toString());
}

/** gameId → { [teamId]: scpPoints }, from the PBP-derived sidecar if present. */
function readSecondChance(season) {
  const fp = path.join(ROOT, "data/cbbd", String(season), "second-chance.json.gz");
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(zlib.gunzipSync(fs.readFileSync(fp)).toString());
  } catch (e) {
    console.warn(`   ! could not parse second-chance for ${season}: ${e.message}`);
    return null;
  }
}

function run(season) {
  const rows = readTeamBox(season);
  if (rows.length === 0) { console.log(`${season}: no team box — skipped`); return; }
  const scp = readSecondChance(season);

  // Exhibitions and closed scrimmages predate opening night; the old exporter
  // filtered them by date downstream, so do it once here at the source.
  const floor = `${season - 1}-11-01`;

  const out = [];
  let skippedNonD1Side = 0, skippedNoStats = 0, skippedExhib = 0, skippedCancelled = 0, withScp = 0;

  for (const r of rows) {
    const mine = TEAM_MAP[r.teamId];
    if (!mine) { skippedNonD1Side++; continue; }

    const t = r.teamStats, o = r.opponentStats;
    if (!t || !o || typeof t.points?.total !== "number" || typeof o.points?.total !== "number") {
      skippedNoStats++; continue;
    }

    // Cancelled / postponed games are carried by CBBD as a real row with an
    // all-zero stat line. A 0-0 basketball game does not exist, so this is the
    // reliable tell — and it has to be an explicit check, because `0` passes
    // the typeof-number guard above. Left in, they became 34 phantom losses
    // per season in every win-rate the calculator computes.
    if (t.points.total === 0 && o.points.total === 0) { skippedCancelled++; continue; }

    const date = r.startDate ? etDate(r.startDate) : null;
    if (!date || date < floor) { skippedExhib++; continue; }

    const opp = TEAM_MAP[r.opponentId] ?? null;
    const pts = t.points.total, oppPts = o.points.total;
    const poss = possessionsFor(t);

    const scpMine = scp?.[r.gameId]?.[r.teamId];
    const scpOpp = scp?.[r.gameId]?.[r.opponentId];
    const scpDiff = diff(scpMine, scpOpp);
    if (scpDiff !== null) withScp++;

    out.push({
      game_id: `${r.gameId}-${r.teamId}`,
      year: season,
      game_date: date,
      team_id: r.teamId,
      team_name: mine.name,
      team_conference: CONF_BY_TEAM_YEAR.get(`${mine.name}|${season}`) ?? null,
      opp_team_market: opp?.name ?? r.opponent ?? null,
      opp_conference: opp ? CONF_BY_TEAM_YEAR.get(`${opp.name}|${season}`) ?? null : null,
      /** Opponent is outside Bart's D-I universe (exhibition-grade tune-up). */
      non_d1: !opp,
      // `is_home` is the NOMINAL home designation and stays true even for a
      // neutral-site game, which is the convention the old file used and the one
      // every consumer is written against: venue is rendered by testing
      // is_neutral FIRST, then is_home (see the note at calc-client.tsx:36).
      // Zeroing is_home on neutral games here would read the same in the UI but
      // throws away which side was the designated host.
      is_home: !!r.isHome,
      is_neutral: !!r.neutralSite,
      won: pts > oppPts,
      pts_scored: pts,
      pts_against: oppPts,
      pts_diff: pts - oppPts,
      poss: n2(poss),
      pace: n2(r.pace ?? (poss !== null && r.gameMinutes ? (poss * 40) / r.gameMinutes : null)),

      // ---- count differentials (own − allowed; positive = better) ----
      fg3_made_diff: diff(t.threePointFieldGoals?.made, o.threePointFieldGoals?.made),
      fg3_att_diff: diff(t.threePointFieldGoals?.attempted, o.threePointFieldGoals?.attempted),
      fg2_made_diff: diff(t.twoPointFieldGoals?.made, o.twoPointFieldGoals?.made),
      fg2_att_diff: diff(t.twoPointFieldGoals?.attempted, o.twoPointFieldGoals?.attempted),
      fg_made_diff: diff(t.fieldGoals?.made, o.fieldGoals?.made),
      fg_att_diff: diff(t.fieldGoals?.attempted, o.fieldGoals?.attempted),
      ft_made_diff: diff(t.freeThrows?.made, o.freeThrows?.made),
      ft_att_diff: diff(t.freeThrows?.attempted, o.freeThrows?.attempted),
      reb_diff: diff(t.rebounds?.total, o.rebounds?.total),
      orb_diff: diff(t.rebounds?.offensive, o.rebounds?.offensive),
      drb_diff: diff(t.rebounds?.defensive, o.rebounds?.defensive),
      // EVERY diff on this row is own − opponent, with no per-stat sign
      // flipping. That is the convention the old CBBA file used and the one the
      // whole product is written against: "TOV Diff < 0" reads as "committed
      // fewer turnovers than the opponent", which is how /calc conditions,
      // the saved-query semantics and the docs all describe it. Flipping the
      // sign here to make "positive = good" uniform would silently invert
      // every existing turnover and foul condition on the site.
      tov_diff: diff(t.turnovers?.total, o.turnovers?.total),
      ast_diff: diff(t.assists, o.assists),
      stl_diff: diff(t.steals, o.steals),
      blk_diff: diff(t.blocks, o.blocks),
      pf_diff: diff(t.fouls?.total, o.fouls?.total),
      // Null, not 0, when the arena didn't track the split — see trackedSplit.
      fbpts_diff: diff(...trackedSplit(t, o, "fastBreak")),
      pitp_diff: diff(...trackedSplit(t, o, "inPaint")),
      pot_diff: diff(...trackedSplit(t, o, "offTurnovers")),
      scp_diff: scpDiff,

      // ---- own shooting rates ----
      fg3_pct: pct(t.threePointFieldGoals?.pct),
      fg2_pct: pct(t.twoPointFieldGoals?.pct),
      ft_pct: pct(t.freeThrows?.pct),
      efg_pct: pct(t.fourFactors?.effectiveFieldGoalPct),
      ts_pct: pct(t.trueShooting),

      // ---- opponent shooting rates (all five were null in the old file) ----
      fg3_pct_def: pct(o.threePointFieldGoals?.pct),
      efg_pct_def: pct(o.fourFactors?.effectiveFieldGoalPct),
      ts_pct_def: pct(o.trueShooting),
    });
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const json = JSON.stringify(out);
  fs.writeFileSync(path.join(OUT_DIR, `${season}.json`), json);
  console.log(
    `${season}: ${String(out.length).padStart(6)} rows` +
    `  (skipped: ${skippedNonD1Side} non-D1 side, ${skippedNoStats} no stats, ` +
    `${skippedCancelled} cancelled, ${skippedExhib} pre-season)` +
    `  scp=${withScp}  ${(json.length / 1024 / 1024).toFixed(1)} MB`,
  );
}

const list = oneSeason ? [oneSeason] : SEASONS;
console.log(`Building CBBD-sourced game logs for ${list.length} season(s)…\n`);
for (const s of list) run(s);
console.log("\nDone.");
