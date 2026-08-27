#!/usr/bin/env node
/**
 * build-team-season-stats.mjs — per-team-season aggregate stats, summed from
 * the CBBD game logs and joined to CBBD's adjusted ratings.
 *
 *   public/data/team-season-stats.json  →  { "<team>|<year>": { …32 stats… } }
 *
 * REPLACES: the Supabase `team_cbba_stats` table (CBB Analytics'
 * /team-agg-stats), which supplied 32 of the 49 stats in the team explorer.
 * See docs/data-sources.md.
 *
 * WHY SUM THE GAME LOGS RATHER THAN CALL A SEASON-STATS ENDPOINT: CBBD does
 * expose /stats/team/season, but it aggregates over EVERY game including the
 * non-D1 tune-ups, while our game logs have already had cancelled games and
 * pre-season exhibitions filtered out. Summing the logs guarantees the season
 * totals and the per-game rows on /calc can never disagree — a team's "REB
 * Diff" on the explorer is exactly the sum of the REB Diffs the calculator
 * shows for the same team.
 *
 * RATE STATS ARE COMPUTED FROM SEASON TOTALS, NOT AVERAGED FROM PER-GAME RATES.
 * A mean of per-game percentages weights a 40-shot game the same as a 70-shot
 * game; the ratio of the summed counts is the actual season rate.
 *
 * THE ONE STAT THAT ISN'T HERE: `pace_adj`. CBB Analytics had an adjusted pace
 * and Bart's `adjt` (Adjusted Tempo) is the same concept from a source we
 * already carry, so the explorer uses adjt and the duplicate column is gone.
 *
 * Usage: node scripts/build-team-season-stats.mjs
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { possessionsFor, plausibleRating, trackedSplit } from "./lib/cbbd-stats.mjs";

const ROOT = process.cwd();
const SEASONS = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
const OUT = path.join(ROOT, "public/data/team-season-stats.json");

const TEAM_MAP = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/cbbd-team-map.json"), "utf8"));

const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);
/** Ratio guarded against a zero/absent denominator. */
const rate = (num, den) => (den > 0 && Number.isFinite(num) ? num / den : null);

/** Coverage a split needs before its SHARE is worth reporting. */
const SHARE_MIN_COVERAGE = 0.5;
/**
 * Coverage a split needs before its season TOTAL is reported.
 *
 * Set by measurement, not taste. 2026 has ~99% coverage, so its totals are
 * effectively ground truth; simulating thinner coverage on it and extrapolating
 * back gives the error you would ship at that coverage:
 *
 *   coverage   median error   estimates with the WRONG SIGN
 *      44%          34                    16%
 *      60%          26                    13%
 *      75%          18                    11%
 *      90%          10                     6%
 *
 * A typical season fast-break differential is about ±62, so at 44% the error is
 * more than half the signal and one team in six would be shown winning a battle
 * it lost. At 90% the estimate is close enough to be worth having.
 */
const TOTAL_MIN_COVERAGE = 0.90;

/** Split share (e.g. fast-break points / points scored) over tracked games. */
function splitShare(b, games) {
  if (games === 0 || b.n / games < SHARE_MIN_COVERAGE) return null;
  return r3(rate(b.own, b.pts));
}

/**
 * Season split differential, scaled to the full season, or null when coverage is
 * too thin to be worth estimating.
 *
 * EXTRAPOLATED, NOT SUMMED. Returning the raw sum over tracked games would
 * systematically UNDERCOUNT — a team with 92% coverage would show ~92% of its
 * real differential, and the shortfall would vary team to team, which is exactly
 * the kind of quiet bias that makes a leaderboard wrong in a way nobody notices.
 * Scaling the per-tracked-game rate up to the games actually played is unbiased.
 * Above the coverage floor the two barely differ; below it, neither is offered.
 */
function splitTotal(b, games) {
  if (games === 0 || b.n === 0 || b.n / games < TOTAL_MIN_COVERAGE) return null;
  return Math.round(((b.own - b.opp) / b.n) * games);
}

/**
 * Split differential PER TRACKED GAME.
 *
 * A season total is only meaningful at near-complete coverage — a partial sum
 * isn't a smaller version of the real number, it's a different quantity — which
 * left fbpts_diff on 1,194 of 4,631 team-seasons and scp_diff on 302, because
 * CBBD's play-by-play reaches only ~52% of 2014 games and untracked splits come
 * back as 0 for a third of pre-2024 games.
 *
 * An average over the games we DO have is a valid estimate at partial coverage,
 * and it is the better comparison anyway: teams play different numbers of games,
 * so a season total quietly rewards the team that went deeper into March. Same
 * 50% floor as the shares — below that the sample is too thin to rank on.
 */
function splitPerGame(b, games) {
  if (games === 0 || b.n === 0 || b.n / games < SHARE_MIN_COVERAGE) return null;
  return r2((b.own - b.opp) / b.n);
}

/** CBBD adjusted ratings for a season, keyed by Bart team name. */
function adjustedRatings(season) {
  const fp = path.join(ROOT, "data/cbbd", String(season), "ratings-adjusted.json.gz");
  const out = new Map();
  if (!fs.existsSync(fp)) return out;
  for (const r of JSON.parse(zlib.gunzipSync(fs.readFileSync(fp)).toString())) {
    const mapped = TEAM_MAP[r.teamId];
    if (!mapped) continue;
    // Reject corrupt ratings rather than average them into BTA RTG — see
    // plausibleRating in lib/cbbd-stats.mjs. net_rtg_adj is only kept when both
    // components survived, since a difference of two numbers is meaningless if
    // either one was garbage.
    const o = plausibleRating(r.offensiveRating);
    const d = plausibleRating(r.defensiveRating);
    out.set(mapped.name, {
      ortg_adj: r1(o),
      drtg_adj: r1(d),
      net_rtg_adj: o !== null && d !== null ? r1(o - d) : null,
    });
  }
  return out;
}

/**
 * Running totals for one team-season. Every field here is a raw count so the
 * rates can be derived from season sums at the end.
 */
function blank() {
  return {
    games: 0,
    // own
    pts: 0, fgm: 0, fga: 0, fg3m: 0, fg3a: 0, fg2m: 0, fg2a: 0, ftm: 0, fta: 0,
    orb: 0, drb: 0, reb: 0, tov: 0, ast: 0, stl: 0, blk: 0, pf: 0,
    poss: 0,
    /** Total game seconds, for possession length. Includes overtime. */
    secs: 0,
    // opponent
    o_pts: 0, o_fgm: 0, o_fga: 0, o_fg3m: 0, o_fg3a: 0, o_fg2m: 0, o_fg2a: 0,
    o_ftm: 0, o_fta: 0, o_orb: 0, o_drb: 0, o_reb: 0, o_tov: 0, o_ast: 0,
    o_stl: 0, o_blk: 0, o_pf: 0, o_poss: 0,
    /**
     * Point splits are accumulated ONLY over the games where they were actually
     * tracked, with their own game count and their own points-scored total. A
     * blind season sum would silently mix "scored zero" with "not recorded" —
     * see trackedSplit in lib/cbbd-stats.mjs for the measured coverage by era.
     * `pts` here is own points IN THE TRACKED GAMES, so the share (fbpts/pts)
     * has a denominator that matches its numerator.
     */
    fastBreak: { n: 0, own: 0, opp: 0, pts: 0 },
    inPaint: { n: 0, own: 0, opp: 0, pts: 0 },
    offTurnovers: { n: 0, own: 0, opp: 0, pts: 0 },
    // second-chance points come from the PBP sidecar and may be absent
    scp: 0, o_scp: 0, scpGames: 0,
    /**
     * Bench scoring, from the PLAYER box rather than the team box.
     *
     * `starter` is a per-player-game boolean on every CBBD box line, so bench
     * points are exact rather than inferred from a season games-started count.
     * That distinction matters precisely for the teams worth asking about: a
     * player who started 20 of 35 contributed to both totals, and a season-level
     * `gs` cannot say which points landed on which side.
     *
     * Sanity-checked on 2026: 62,957 of 127,480 box lines carry starter=true,
     * 49.4%, against the 50% five-of-ten expectation.
     */
    bench_pts: 0, benchGames: 0,
  };
}

/**
 * The game logs carry differentials, not both sides' raw counts, so the box
 * archive is re-read here to get own AND opponent totals. The logs are still
 * the authority on WHICH games count: a box row whose game_id isn't in the log
 * was filtered upstream (cancelled, exhibition, non-D1 perspective) and must be
 * skipped so the two surfaces stay reconcilable.
 */
function accumulate(season, totals) {
  const logFp = path.join(ROOT, `public/data/game-logs-by-year/${season}.json`);
  if (!fs.existsSync(logFp)) return 0;
  const eligible = new Set(JSON.parse(fs.readFileSync(logFp, "utf8")).map((g) => g.game_id));

  const boxFp = path.join(ROOT, "data/cbbd", String(season), "box-teams-full.json.gz");
  if (!fs.existsSync(boxFp)) return 0;
  const rows = JSON.parse(zlib.gunzipSync(fs.readFileSync(boxFp)).toString());

  const scpFp = path.join(ROOT, "data/cbbd", String(season), "second-chance.json.gz");
  let scp = null;
  if (fs.existsSync(scpFp)) {
    try { scp = JSON.parse(zlib.gunzipSync(fs.readFileSync(scpFp)).toString()); } catch { scp = null; }
  }

  let used = 0;
  for (const r of rows) {
    const mapped = TEAM_MAP[r.teamId];
    if (!mapped) continue;
    if (!eligible.has(`${r.gameId}-${r.teamId}`)) continue;
    const t = r.teamStats, o = r.opponentStats;
    if (!t || !o) continue;

    const key = `${mapped.name}|${season}`;
    let a = totals.get(key);
    if (!a) { a = blank(); totals.set(key, a); }
    used++;
    a.games++;

    const add = (pre, s) => {
      a[`${pre}pts`] += s.points?.total ?? 0;
      a[`${pre}fgm`] += s.fieldGoals?.made ?? 0;
      a[`${pre}fga`] += s.fieldGoals?.attempted ?? 0;
      a[`${pre}fg3m`] += s.threePointFieldGoals?.made ?? 0;
      a[`${pre}fg3a`] += s.threePointFieldGoals?.attempted ?? 0;
      a[`${pre}fg2m`] += s.twoPointFieldGoals?.made ?? 0;
      a[`${pre}fg2a`] += s.twoPointFieldGoals?.attempted ?? 0;
      a[`${pre}ftm`] += s.freeThrows?.made ?? 0;
      a[`${pre}fta`] += s.freeThrows?.attempted ?? 0;
      a[`${pre}orb`] += s.rebounds?.offensive ?? 0;
      a[`${pre}drb`] += s.rebounds?.defensive ?? 0;
      a[`${pre}reb`] += s.rebounds?.total ?? 0;
      a[`${pre}tov`] += s.turnovers?.total ?? 0;
      a[`${pre}ast`] += s.assists ?? 0;
      a[`${pre}stl`] += s.steals ?? 0;
      a[`${pre}blk`] += s.blocks ?? 0;
      a[`${pre}pf`] += s.fouls?.total ?? 0;
      // Shared with the per-game log build so a team's season pace is always
      // the mean of the pace values /calc shows for its own games.
      a[`${pre}poss`] += possessionsFor(s) ?? 0;
    };
    add("", t);
    add("o_", o);
    // gameMinutes is per-game elapsed clock (40, or 45/50/… with overtime), so
    // this accumulates real playing time rather than assuming 40 every game.
    a.secs += (typeof r.gameMinutes === "number" ? r.gameMinutes : 40) * 60;

    for (const key of ["fastBreak", "inPaint", "offTurnovers"]) {
      const [mine, theirs] = trackedSplit(t, o, key);
      if (mine === null) continue;
      const b = a[key];
      b.n++; b.own += mine; b.opp += theirs; b.pts += t.points?.total ?? 0;
    }

    const mine = scp?.[r.gameId]?.[r.teamId];
    const theirs = scp?.[r.gameId]?.[r.opponentId];
    if (typeof mine === "number" && typeof theirs === "number") {
      a.scp += mine; a.o_scp += theirs; a.scpGames++;
    }
  }

  // Bench points need the PLAYER box, which is a separate archive file. Gated
  // on the same `eligible` set as the team pass so a game that was filtered
  // upstream cannot contribute bench points to a season it is not part of.
  const pbFp = path.join(ROOT, "data/cbbd", String(season), "box-players-full.json.gz");
  if (fs.existsSync(pbFp)) {
    for (const r of JSON.parse(zlib.gunzipSync(fs.readFileSync(pbFp)).toString())) {
      const mapped = TEAM_MAP[r.teamId];
      if (!mapped) continue;
      if (!eligible.has(`${r.gameId}-${r.teamId}`)) continue;
      const a = totals.get(`${mapped.name}|${season}`);
      if (!a) continue;
      let any = false;
      for (const p of r.players ?? []) {
        if (typeof p.starter !== "boolean") continue;
        any = true;
        if (!p.starter) a.bench_pts += p.points ?? 0;
      }
      if (any) a.benchGames++;
    }
  }
  return used;
}

const totals = new Map();
for (const season of SEASONS) {
  const used = accumulate(season, totals);
  console.log(`${season}: ${used} team-game rows aggregated`);
}

// Adjusted ratings are per-season files; load each once.
const adjBySeason = new Map();
for (const season of SEASONS) adjBySeason.set(season, adjustedRatings(season));

/**
 * Our own schedule-adjusted ratings (scripts/build-adjusted-ratings.mjs), merged
 * in so the UI has a single file to read. Optional: if the file isn't built yet
 * the a_* / *_sos columns are simply absent rather than fatal.
 */
const OWN_ADJ = (() => {
  const fp = path.join(ROOT, "public/data/team-adjusted-ratings.json");
  if (!fs.existsSync(fp)) {
    console.warn("   ! team-adjusted-ratings.json missing — run build-adjusted-ratings.mjs for a_ortg/a_drtg/a_net/SOS");
    return {};
  }
  return JSON.parse(fs.readFileSync(fp, "utf8"));
})();

/**
 * Shot-location mix (build-shot-distribution.mjs), merged in for the same
 * reason the adjusted ratings are: the explorer reads one file per team-season,
 * and a second fetch to colour one column is not worth the request.
 *
 * These are the glossary's "Shot Frequency" — the share of a team's field-goal
 * attempts from each zone, plus the same for what it allowed. Reconstructed
 * from play-by-play `shotInfo.range`, so coverage is 2014-2026 minus 2021,
 * which is the COVID season the whole site excludes.
 *
 * Three zones, not thirteen: this file is the PBP range flag, which only
 * distinguishes rim / mid / three. Corner-versus-above-the-break needs shot
 * COORDINATES, which live per-player in public/data/shots and are a separate
 * build.
 */
const SHOT_MIX = (() => {
  const fp = path.join(ROOT, "public/data/shot-distribution.json");
  if (!fs.existsSync(fp)) {
    console.warn("   ! shot-distribution.json missing — rim/mid/three shares will be null");
    return {};
  }
  return JSON.parse(fs.readFileSync(fp, "utf8"));
})();

/**
 * Shooting accuracy by zone (build-team-shot-zones.mts), merged for the same
 * one-fetch reason as the two above.
 *
 * 2022-2026 ONLY — the shot-coordinate archive does not go back further, so
 * these are null on 2014-2021 by construction rather than by omission.
 */
const SHOT_ZONES = (() => {
  const fp = path.join(ROOT, "public/data/team-shot-zones.json");
  if (!fs.existsSync(fp)) {
    console.warn("   ! team-shot-zones.json missing — zone FG% columns will be null");
    return {};
  }
  return JSON.parse(fs.readFileSync(fp, "utf8"));
})();

/**
 * Roster shape (build-team-roster-splits.mjs) and lead-state records
 * (build-team-outcomes.mjs), merged for the same one-fetch reason as the
 * ratings and the shot files above.
 *
 * The outcomes file is the thinner of the two: it is play-by-play derived, so
 * it has no 2021 at all and its per-season game coverage runs well short of the
 * box archive on the older years. Its own `pbp_games` carries that, which is
 * why it is passed through rather than dropped.
 */
const ROSTER = (() => {
  const fp = path.join(ROOT, "public/data/team-roster-splits.json");
  if (!fs.existsSync(fp)) { console.warn("   ! team-roster-splits.json missing"); return {}; }
  return JSON.parse(fs.readFileSync(fp, "utf8"));
})();
const OUTCOMES = (() => {
  const fp = path.join(ROOT, "public/data/team-outcomes.json");
  if (!fs.existsSync(fp)) { console.warn("   ! team-outcomes.json missing"); return {}; }
  return JSON.parse(fs.readFileSync(fp, "utf8"));
})();

const final = {};
for (const [key, a] of totals) {
  const [name, yearStr] = key.split("|");
  const season = Number(yearStr);
  const adj = adjBySeason.get(season)?.get(name) ?? null;

  // eFG% = (FGM + 0.5·3PM) / FGA — verified to match CBBD's own fourFactors
  // value exactly on all 12,594 rows of 2026, so deriving it here is safe.
  const efg = rate(a.fgm + 0.5 * a.fg3m, a.fga);
  const efgDef = rate(a.o_fgm + 0.5 * a.o_fg3m, a.o_fga);
  // TS% = PTS / (2 · (FGA + 0.475·FTA))
  const ts = rate(a.pts, 2 * (a.fga + 0.475 * a.fta));
  // OREB% = own OREB / (own OREB + opponent DREB) — the share of available
  // offensive boards actually collected, not OREB per game.
  const orbPct = rate(a.orb, a.orb + a.o_drb);
  const orbPctDef = rate(a.o_orb, a.o_orb + a.drb);

  final[key] = {
    games: a.games,

    // ---- scoring / offense ----
    ts_pct: r3(ts),
    efg_pct: r3(efg),
    fg3_pct: r3(rate(a.fg3m, a.fg3a)),
    ft_pct: r3(rate(a.ftm, a.fta)),
    fg3a_rate: r3(rate(a.fg3a, a.fga)),
    fta_rate: r3(rate(a.fta, a.fga)),
    orb_pct: r3(orbPct),
    tov_pct: r3(rate(a.tov, a.poss)),
    ast_pct: r3(rate(a.ast, a.fgm)),
    // Shares are computed over the tracked games only, which makes them a valid
    // rate estimate at partial coverage — but below half a season the estimate
    // is too thin to rank teams by, so it becomes null rather than misleading.
    fbpts_pct: splitShare(a.fastBreak, a.games),
    pitp_pct: splitShare(a.inPaint, a.games),
    pot_pct: splitShare(a.offTurnovers, a.games),
    ortg: r1(rate(a.pts, a.poss) * 100),

    // ---- defense ----
    efg_pct_def: r3(efgDef),
    tov_pct_def: r3(rate(a.o_tov, a.o_poss)),
    orb_pct_def: r3(orbPctDef),
    fg3_pct_def: r3(rate(a.o_fg3m, a.o_fg3a)),
    drtg: r1(rate(a.o_pts, a.o_poss) * 100),

    // ---- season count differentials (own − allowed) ----
    fg3_made_diff: a.fg3m - a.o_fg3m,
    fg3_att_diff: a.fg3a - a.o_fg3a,
    fg2_made_diff: a.fg2m - a.o_fg2m,
    fg_made_diff: a.fgm - a.o_fgm,
    ft_made_diff: a.ftm - a.o_ftm,
    orb_diff_ct: a.orb - a.o_orb,
    drb_diff: a.drb - a.o_drb,
    reb_diff: a.reb - a.o_reb,
    tov_diff_ct: a.tov - a.o_tov,

    // ---- BTA's Four Factors, per game ----
    // REB / 3PM / FBP / TOV differential. These come from the box and so have
    // full coverage as season totals, but they are ALSO published per-game
    // because the fourth factor (fast break) only exists per-game — CBBD's
    // untracked-split problem means its season total is honest on ~1,200 of
    // 4,631 team-seasons. Showing "+416 REB" beside "+1.82 FBP" in one group
    // would be incoherent, so the group is uniformly per-game.
    reb_diff_pg: a.games > 0 ? r2((a.reb - a.o_reb) / a.games) : null,
    fg3m_diff_pg: a.games > 0 ? r2((a.fg3m - a.o_fg3m) / a.games) : null,
    tov_diff_pg: a.games > 0 ? r2((a.tov - a.o_tov) / a.games) : null,
    // Season TOTALS, so they are only emitted at effectively full coverage. A
    // partial sum is not a smaller version of the real differential — it is a
    // different quantity — and these feed BTA's Four Factors (REB / 3PM / FBP /
    // TOV Diff), where a silently short-summed FBP Diff would misrank teams.
    // `*_games` carries the coverage so the UI can say why a cell is empty.
    fbpts_diff: splitTotal(a.fastBreak, a.games),
    pitp_diff: splitTotal(a.inPaint, a.games),
    potov_diff: splitTotal(a.offTurnovers, a.games),
    // Per-tracked-game averages. These are the ones with broad coverage — the
    // season totals above go null on most pre-2023 seasons because the split
    // simply wasn't recorded for enough games to total up.
    fbpts_diff_pg: splitPerGame(a.fastBreak, a.games),
    pitp_diff_pg: splitPerGame(a.inPaint, a.games),
    potov_diff_pg: splitPerGame(a.offTurnovers, a.games),
    fbpts_games: a.fastBreak.n,
    pitp_games: a.inPaint.n,
    potov_games: a.offTurnovers.n,
    pts_diff: a.pts - a.o_pts,
    // Same 90% floor and extrapolation as every other split total. This used
    // to demand a.scpGames === a.games exactly, which is a far harsher rule
    // than it looks: one game CBBD has no play-by-play for nulls the whole
    // season. After the 2024/25 archive backfill the game logs carry scp on
    // 98% of rows and 98-100% of teams clear 90% coverage, yet exact equality
    // still published scp_diff for only 71% of 2024 and 49% of 2025
    // team-seasons. Nothing about second-chance points justifies a stricter
    // rule than fast-break or points-in-paint get.
    scp_diff: splitTotal({ n: a.scpGames, own: a.scp, opp: a.o_scp }, a.games),
    scp_diff_pg: splitPerGame({ n: a.scpGames, own: a.scp, opp: a.o_scp }, a.games),
    scp_games: a.scpGames,

    // =====================================================================
    // GLOSSARY SET — every stat below is one CBB Analytics publishes a written
    // definition for, computed here from counts this accumulator already held.
    //
    // SCOPED TO WHAT IS DEFINED, deliberately. Their UI also offers class-year
    // splits, roster continuity, effective height and wire-to-wire records, and
    // none of those appear in their glossary — so the denominators are
    // unknowable and any number we shipped under those names would disagree
    // with theirs for reasons neither side could point at. Skipped rather than
    // guessed.
    //
    // Rates are ratios of season SUMS, never means of per-game rates, for the
    // same reason the block above is: a mean weights a 40-shot game like a
    // 70-shot one.
    // =====================================================================

    // ---- shooting ----
    fg_pct: r3(rate(a.fgm, a.fga)),
    fg2_pct: r3(rate(a.fg2m, a.fg2a)),
    fga_pg: r1(rate(a.fga, a.games)),
    fg2a_pg: r1(rate(a.fg2a, a.games)),
    fg3a_pg: r1(rate(a.fg3a, a.games)),
    fta_pg: r1(rate(a.fta, a.games)),

    // ---- box score, per game ----
    pts_pg: r1(rate(a.pts, a.games)),
    ast_pg: r1(rate(a.ast, a.games)),
    orb_pg: r1(rate(a.orb, a.games)),
    drb_pg: r1(rate(a.drb, a.games)),
    reb_pg: r1(rate(a.reb, a.games)),
    stl_pg: r1(rate(a.stl, a.games)),
    blk_pg: r1(rate(a.blk, a.games)),
    tov_pg: r1(rate(a.tov, a.games)),
    pf_pg: r1(rate(a.pf, a.games)),
    // Fouls DRAWN is the opponent's foul count. No play-by-play needed — the
    // team box carries both sides, and a foul committed by them is one drawn
    // by us by definition.
    pfd_pg: r1(rate(a.o_pf, a.games)),

    // ---- misc scoring: own totals, not differentials ----
    // Over TRACKED games only, with the same 50% coverage floor the shares use.
    // The existing fbpts_diff_pg answers "what was the edge"; these answer
    // "how many did they score", which is the glossary's question.
    fbpts_pg: a.fastBreak.n / (a.games || 1) >= SHARE_MIN_COVERAGE ? r1(rate(a.fastBreak.own, a.fastBreak.n)) : null,
    pitp_pg: a.inPaint.n / (a.games || 1) >= SHARE_MIN_COVERAGE ? r1(rate(a.inPaint.own, a.inPaint.n)) : null,
    potov_pg: a.offTurnovers.n / (a.games || 1) >= SHARE_MIN_COVERAGE ? r1(rate(a.offTurnovers.own, a.offTurnovers.n)) : null,
    scp_pg: a.scpGames / (a.games || 1) >= SHARE_MIN_COVERAGE ? r1(rate(a.scp, a.scpGames)) : null,
    // Share of points from second chances. Denominator is points in the games
    // where the split existed, matching how fbpts_pct/pitp_pct are built —
    // except scp comes from the PBP sidecar, which carries no points total of
    // its own, so full-season points are scaled to the tracked share.
    scp_pct: a.scpGames / (a.games || 1) >= SHARE_MIN_COVERAGE
      ? r3(rate(a.scp, a.pts * (a.scpGames / a.games)))
      : null,
    bench_pts_pg: a.benchGames > 0 ? r1(rate(a.bench_pts, a.benchGames)) : null,
    bench_pts_pct: a.benchGames > 0
      ? r3(rate(a.bench_pts, a.pts * (a.benchGames / a.games)))
      : null,

    // ---- advanced offense ----
    // UNASSISTED field goals. The glossary's "Assisted FGs" is just assists by
    // definition — an assist IS an assisted made field goal — so it is already
    // ast_pg above and is not duplicated under a second name. The unassisted
    // half is the one that carries information the box does not otherwise
    // state: how much of the offence created its own shot.
    unast_pg: r1(rate(a.fgm - a.ast, a.games)),
    unast_share: r3(rate(a.fgm - a.ast, a.fgm)),
    ast_to: r2(rate(a.ast, a.tov)),
    ppp: r3(rate(a.pts, a.poss)),

    // ---- advanced defense ----
    // DRB% mirrors OREB%: the share of available defensive boards taken, where
    // "available" is our defensive rebounds plus their offensive ones.
    drb_pct: r3(rate(a.drb, a.drb + a.o_orb)),
    // Against OPPONENT possessions — a steal happens on their trip, not ours.
    stl_pct: r3(rate(a.stl, a.o_poss)),
    // Against opponent TWO-POINT attempts, per the glossary. Threes are
    // blocked rarely enough that including them just deflates every team by a
    // similar factor and tells you nothing extra.
    blk_pct: r3(rate(a.blk, a.o_fg2a)),
    // Hakeem% = STL% + BLK%. Both are already per-opponent-opportunity rates,
    // so the sum is a combined defensive-event rate rather than a mixed unit.
    hakeem_pct: r3(
      rate(a.stl, a.o_poss) !== null && rate(a.blk, a.o_fg2a) !== null
        ? rate(a.stl, a.o_poss) + rate(a.blk, a.o_fg2a)
        : NaN,
    ),
    stl_pf: r2(rate(a.stl, a.pf)),
    blk_pf: r2(rate(a.blk, a.pf)),
    pf_eff: r2(rate(a.stl + a.blk, a.pf)),

    // ---- misc ----
    pace: r1(rate(a.poss, a.games)),
    // Average possession length in seconds: how long this team's trip down the
    // floor lasted (opl) and how long it made opponents work (dpl).
    //
    // The game clock is HALVED first. Both teams share one clock, so a team only
    // holds the ball for roughly its own share of elapsed time — dividing full
    // game time by one team's possessions double-counts and yields ~35s, which is
    // above the 30-second shot clock and therefore obviously wrong. Halving puts
    // it at the real ~17-18s.
    //
    // This is an APPROXIMATION, not a measurement: it assumes each team held the
    // ball for half the clock. The asymmetry it does capture is genuine — a team
    // with more possessions than its opponents fits more trips into the same half,
    // so its trips were shorter. Measuring true per-possession durations needs
    // play-by-play timestamps (`secondsRemaining`), which is a later refinement
    // once the PBP archive covers every season.
    opl: r2(rate(a.secs / 2, a.poss)),
    dpl: r2(rate(a.secs / 2, a.o_poss)),
    net_rtg: r1((rate(a.pts, a.poss) - rate(a.o_pts, a.o_poss)) * 100),

    // ---- opponent-adjusted, CBBD's own model (/ratings/adjusted) ----
    // Retained because BTA RTG averages these with Bart's adjoe/adjde as its
    // second opinion. Kept separate from our a_* ratings on purpose: mixing a
    // vendor's model output with our own under one column name would make the
    // number unauditable.
    ortg_adj: adj?.ortg_adj ?? null,
    drtg_adj: adj?.drtg_adj ?? null,
    net_rtg_adj: adj?.net_rtg_adj ?? null,

    // ---- shot mix (shares of FGA by zone, own and allowed) ----
    // `shot_games` is deliberately not re-exported: shot-distribution.json
    // carries its own game count and it is not the box game count these stats
    // are computed over. Mixing the two under one `games` key is how a column
    // quietly starts describing a different denominator than its neighbours.
    rim_rate: SHOT_MIX[key]?.rim_rate ?? null,
    mid_rate: SHOT_MIX[key]?.mid_rate ?? null,
    three_rate: SHOT_MIX[key]?.three_rate ?? null,
    rim_rate_def: SHOT_MIX[key]?.rim_rate_def ?? null,
    mid_rate_def: SHOT_MIX[key]?.mid_rate_def ?? null,
    three_rate_def: SHOT_MIX[key]?.three_rate_def ?? null,

    // ---- shooting accuracy by zone (2022+, coordinates) ----
    rim_fg_pct: SHOT_ZONES[key]?.rim_fg_pct ?? null,
    mid_fg_pct: SHOT_ZONES[key]?.mid_fg_pct ?? null,
    corner3_fg_pct: SHOT_ZONES[key]?.corner3_fg_pct ?? null,
    atb3_fg_pct: SHOT_ZONES[key]?.atb3_fg_pct ?? null,
    corner3_share: SHOT_ZONES[key]?.corner3_share ?? null,

    /**
     * LAST SEASON'S adjusted net rating, carried on this season's row.
     *
     * Roster continuity is a statement about a team that has not played yet, so
     * the only rating that can sit beside it is the one it earned last year.
     * On the upcoming season that is the ONLY rating there is; on a played
     * season it is still the right one, because "how good were they before this
     * roster changed" is the question continuity is asking.
     *
     * Read from the ratings file rather than joined downstream so every surface
     * gets the same number from the same place.
     */
    prev_a_net: OWN_ADJ[`${name}|${season - 1}`]?.a_net ?? null,

    // ---- roster shape ----
    ...(ROSTER[key] ?? {}),
    // ---- lead-state records (play-by-play) ----
    ...(OUTCOMES[key] ?? {}),

    // ---- opponent-adjusted, OUR model (build-adjusted-ratings.mjs) ----
    // Ridge-regularized least squares over every game in the season. Validated
    // against Bart's independently-computed T-Rank at r = 0.986 on net rating.
    // `games` is destructured off deliberately: the ratings file carries its own
    // count and this spread is last, so it would silently shadow the box-derived
    // `games` above. They should agree, but "should" isn't a guarantee and the
    // box count is the one every other stat here is computed over.
    ...(({ games: _ratingGames, ...rest }) => rest)(
      OWN_ADJ[key] ?? { a_ortg: null, a_drtg: null, a_net: null, sos: null, o_sos: null, d_sos: null },
    ),
  };
}

fs.writeFileSync(OUT, JSON.stringify(final));
const withAdj = Object.values(final).filter((v) => v.ortg_adj !== null).length;
console.log(`\n✓ ${Object.keys(final).length} team-seasons → ${path.relative(ROOT, OUT)}`);
console.log(`  with adjusted ratings: ${withAdj}`);
console.log(`  ${(fs.statSync(OUT).size / 1024 / 1024).toFixed(2)} MB`);
