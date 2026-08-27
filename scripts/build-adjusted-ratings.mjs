#!/usr/bin/env node
/**
 * build-adjusted-ratings.mjs — schedule-adjusted team efficiency ratings,
 * computed from our own game logs.
 *
 *   public/data/team-adjusted-ratings.json  →  { "<team>|<year>": {...} }
 *
 * WHY THIS EXISTS: BTA RTG used to be a z-score composite that averaged TWO
 * rented providers' adjusted ratings (Bart's adjoe/adjde and CBB Analytics'
 * ortg_adj/drtg_adj) and folded in SoS. That was a sensible hedge while we were
 * renting numbers, but it is hard to explain, impossible for a reader to audit,
 * and it silently changes whenever a vendor changes their model. This computes
 * the rating ourselves from the box scores we already archive.
 *
 * ── THE MODEL ──────────────────────────────────────────────────────────────
 * The standard schedule-adjustment (what Sports-Reference calls SRS and what
 * Dunks & Threes labels "SRS Team Ratings"). For every team-perspective row of
 * every game we have points scored and possessions used, so:
 *
 *   pts_per_100(o, d) ≈ mean + off[o] − def[d] + hca · venue
 *
 * `off[t]` is how many points per 100 possessions team t generates against an
 * average defense; `def[t]` is how many it allows against an average offense.
 * Both are solved simultaneously across every game in the season, so beating a
 * good defense counts for more than beating a bad one — that *is* the schedule
 * adjustment. `hca` is the home-court effect, fit rather than assumed.
 *
 * Solved by ridge-regularized least squares via coordinate descent (Gauss-
 * Seidel). Ridge matters for two reasons:
 *   1. The design matrix is singular without it — off[] and def[] are only
 *      identified up to a constant (add 5 to every offense and subtract 5 from
 *      every defense and every prediction is unchanged), so an unregularized
 *      solve has no unique answer.
 *   2. It shrinks teams with few games toward average, which is what keeps a
 *      3-game non-D1 schedule from producing a #1 offense.
 *
 * Each observation is WEIGHTED BY POSSESSIONS. A 90-possession game carries more
 * information about a team's efficiency than a 55-possession one, and weighting
 * by possessions is what makes the fitted values true per-100 rates rather than
 * an average of per-game rates.
 *
 * ── WHAT WE DELIBERATELY DO NOT COPY ───────────────────────────────────────
 * Dunks & Threes blends a PRE-SEASON PRIOR (their EPM projections plus Vegas
 * lines) into the in-season rating, weighting it down as games accumulate. We
 * have no Vegas line archive, and it would not help if we did: that prior exists
 * to stabilize a rating after 3 games, and every season here is complete. So the
 * prior is omitted rather than approximated.
 *
 * ── NON-D1 OPPONENTS ───────────────────────────────────────────────────────
 * Games against non-D1 teams are KEPT, with all such opponents collapsed into a
 * single synthetic "__NOND1__" entity. Dropping them would discard real results
 * (and a team's record would stop reconciling with its games); giving each its
 * own rating would fit a parameter to one or two blowouts. Pooling them lets the
 * model learn one "non-D1 opponent" strength and discount those wins correctly.
 *
 * ── WHAT ELSE THIS FITS, AND WHY IT LIVES HERE ─────────────────────────────
 * Adjusted tempo, record, split schedule strength and wins-above-bubble were
 * all rented from Bart Torvik's CSVs. Every one of them is a function of the
 * same two things this file already has — the season's game log and the fitted
 * ratings — so computing them anywhere else would mean either re-reading the
 * log or re-solving the model. They are added here instead:
 *
 *   adjt        a second ridge solve, on tempo rather than efficiency
 *   wins/losses counted off the log; verified 37-3 against Bart on 2026 Michigan
 *   nc_sos      the existing SOS, partitioned by conference matchup
 *   conf_sos
 *   wab         actual wins minus a bubble-quality team's expected wins
 *   sos_wp      that same bubble team's expected win% against this schedule
 *
 * The last two need a win-probability model, which is built here from the
 * ratings plus the fitted home-court effect and a residual sigma measured off
 * the season's own games. See the notes at winProb().
 *
 * Usage: node scripts/build-adjusted-ratings.mjs [--season 2026]
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public/data/team-adjusted-ratings.json");
const SEASONS = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

const args = process.argv.slice(2);
const oneSeason = args.includes("--season") ? Number(args[args.indexOf("--season") + 1]) : null;

/** Pooled identity for every opponent outside Bart's D-I universe. */
const NON_D1 = "__NOND1__";
/**
 * Ridge strength, in units of "possessions of average-team evidence" added to
 * each team. ~200 possessions ≈ 3 games, so a full 30-game season is barely
 * shrunk while a 2-game sample is pulled hard toward the mean.
 */
const RIDGE = 200;
const MAX_ITERS = 300;
const TOLERANCE = 1e-7;

/**
 * Ridge for the tempo fit, in "games of average-tempo evidence".
 *
 * A different unit and a different number from RIDGE above, because the tempo
 * model is weighted per GAME rather than per possession — a game contributes
 * one pace observation regardless of how many possessions it contained. Three
 * games of shrinkage is the same intent as RIDGE's ~3-game equivalent.
 */
const TEMPO_RIDGE = 3;

/**
 * Which rank counts as "the bubble" for WAB.
 *
 * 45th by adjusted net rating. The tournament takes 68 teams, roughly 31 of
 * them automatic bids from one-bid leagues, so the last few at-large seats sit
 * around here. It is a CHOICE and it is stated rather than tuned: WAB is only
 * as meaningful as its baseline, and a baseline picked to make the numbers look
 * agreeable is not a measurement.
 *
 * Bart's WAB uses his own bubble definition, which is not published in a form
 * we could reproduce, so ours will not equal his. It answers the same question
 * with a stated baseline instead of a borrowed one.
 */
const BUBBLE_RANK = 45;

const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);

/**
 * Fit off[]/def[]/hca for one season.
 *
 * Observations: one per team-perspective row, i.e. each game contributes twice
 * (once from each side). That is intentional — the two rows are not redundant,
 * they constrain different parameters (A's offense vs B's defense, and vice
 * versa).
 */
function fitSeason(rows) {
  const teams = [...new Set(rows.flatMap((r) => [r.team, r.opp]))];
  const idx = new Map(teams.map((t, i) => [t, i]));
  const n = teams.length;

  // Possession-weighted mean points per 100 — the model's intercept.
  let wSum = 0, wpSum = 0;
  for (const r of rows) { wSum += r.poss; wpSum += r.poss * r.rate; }
  const mean = wpSum / wSum;

  const off = new Float64Array(n);
  const def = new Float64Array(n);
  let hca = 0;

  // Per-parameter denominators are constant across iterations; precompute.
  const offDen = new Float64Array(n);
  const defDen = new Float64Array(n);
  let hcaDen = 0;
  for (const r of rows) {
    offDen[idx.get(r.team)] += r.poss;
    defDen[idx.get(r.opp)] += r.poss;
    hcaDen += r.poss * r.venue * r.venue;
  }
  for (let i = 0; i < n; i++) { offDen[i] += RIDGE; defDen[i] += RIDGE; }

  for (let iter = 0; iter < MAX_ITERS; iter++) {
    let maxDelta = 0;

    // Residual accumulators, rebuilt each sweep.
    const offNum = new Float64Array(n);
    const defNum = new Float64Array(n);
    let hcaNum = 0;

    for (const r of rows) {
      const o = idx.get(r.team), d = idx.get(r.opp);
      // Partial residual for each parameter: the observation minus everything
      // EXCEPT the parameter being updated.
      const base = r.rate - mean - hca * r.venue;
      offNum[o] += r.poss * (base + def[d]);
      defNum[d] -= r.poss * (base - off[o]);
      hcaNum += r.poss * r.venue * (r.rate - mean - off[o] + def[d]);
    }

    for (let i = 0; i < n; i++) {
      const nOff = offNum[i] / offDen[i];
      const nDef = defNum[i] / defDen[i];
      maxDelta = Math.max(maxDelta, Math.abs(nOff - off[i]), Math.abs(nDef - def[i]));
      off[i] = nOff;
      def[i] = nDef;
    }
    const nHca = hcaDen > 0 ? hcaNum / hcaDen : 0;
    maxDelta = Math.max(maxDelta, Math.abs(nHca - hca));
    hca = nHca;

    if (maxDelta < TOLERANCE) break;
  }

  return { teams, idx, mean, off, def, hca };
}

/**
 * Fit adjusted tempo for one season.
 *
 * ONE COEFFICIENT PER TEAM, not the off/def pair the efficiency model needs,
 * and that is forced by the thing being measured: both teams in a basketball
 * game play very nearly the same number of possessions. Pace is a property of
 * the MATCHUP, so the model is
 *
 *     pace(a vs b) ≈ mean + t[a] + t[b]
 *
 * and a team's adjusted tempo is what it would play at against an average
 * opponent — mean + t[a], since an average opponent has t = 0. Fitting separate
 * "tempo offense" and "tempo defense" terms would be fitting two parameters to
 * one shared observation.
 *
 * WEIGHTED PER GAME, not per possession. Weighting a pace observation by its
 * own possession count would give fast games more say in how fast a team plays,
 * which is the assumption in the conclusion.
 *
 * Home court is left out. It moves scoring but not the number of trips, and
 * measuring it here on the 2026 season put it under 0.2 possessions — below the
 * resolution anyone reads a tempo number at.
 */
function fitTempo(rows) {
  const teams = [...new Set(rows.flatMap((r) => [r.team, r.opp]))];
  const idx = new Map(teams.map((t, i) => [t, i]));
  const n = teams.length;

  let mean = 0;
  for (const r of rows) mean += r.pace;
  mean /= rows.length;

  const t = new Float64Array(n);
  const den = new Float64Array(n);
  for (const r of rows) { den[idx.get(r.team)]++; den[idx.get(r.opp)]++; }
  for (let i = 0; i < n; i++) den[i] += TEMPO_RIDGE;

  for (let iter = 0; iter < MAX_ITERS; iter++) {
    let maxDelta = 0;
    const num = new Float64Array(n);
    for (const r of rows) {
      const a = idx.get(r.team), b = idx.get(r.opp);
      // Each row is one team's view of a game, and the log carries both views,
      // so every game contributes to both of its teams exactly once here.
      num[a] += r.pace - mean - t[b];
      num[b] += r.pace - mean - t[a];
    }
    for (let i = 0; i < n; i++) {
      const next = num[i] / den[i];
      maxDelta = Math.max(maxDelta, Math.abs(next - t[i]));
      t[i] = next;
    }
    if (maxDelta < TOLERANCE) break;
  }
  return { idx, mean, t };
}

/**
 * Normal CDF, via the Abramowitz & Stegun 7.1.26 erf approximation.
 *
 * Max error ~1.5e-7, which is four orders of magnitude finer than anything a
 * win probability is read to. Written out rather than pulled in because it is
 * the only special function this file needs.
 */
function normCdf(z) {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const tt = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * tt - 1.453152027) * tt + 1.421413741) * tt
    - 0.284496736) * tt + 0.254829592) * tt * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * Probability that a team with rating `mine` beats one with `theirs`.
 *
 * The margin comes out of the same model the ratings do: each side's expected
 * points per 100 against the other, scaled by the tempo the two would play at,
 * plus the fitted home-court effect. Nothing new is assumed — every input is a
 * parameter already estimated above.
 *
 * `sigma` is the standard deviation of (actual − predicted) margin, MEASURED on
 * the season's own games rather than assumed. It lands near 11 points, which is
 * the number the basketball literature reports, and measuring it per season is
 * what keeps a low-scoring era from being handed a high-scoring era's spread.
 */
function winProb(mine, theirs, tempo, hca, venue, sigma) {
  const expMine = ((mine.ortg + theirs.drtg - mine.mean) / 100) * tempo;
  const expTheirs = ((theirs.ortg + mine.drtg - mine.mean) / 100) * tempo;
  const margin = expMine - expTheirs + hca * venue;
  return normCdf(margin / sigma);
}

function run(season) {
  const fp = path.join(ROOT, `public/data/game-logs-by-year/${season}.json`);
  if (!fs.existsSync(fp)) { console.log(`${season}: no game log — skipped`); return {}; }
  const logs = JSON.parse(fs.readFileSync(fp, "utf8"));

  // Build observations. A row needs its own possessions and points; rows without
  // possessions can't be expressed as a per-100 rate and are dropped.
  const rows = [];
  for (const g of logs) {
    if (typeof g.pts_scored !== "number" || typeof g.poss !== "number" || g.poss <= 0) continue;
    rows.push({
      team: g.team_name,
      opp: g.non_d1 ? NON_D1 : (g.opp_team_market ?? NON_D1),
      poss: g.poss,
      rate: (100 * g.pts_scored) / g.poss,
      // +1 home, -1 away, 0 neutral. is_neutral is tested FIRST because a
      // neutral-site game has is_home set on the nominal host (see the note in
      // build-game-logs-cbbd.mjs).
      venue: g.is_neutral ? 0 : g.is_home ? 1 : -1,
      // Possessions per 40, for the tempo fit. Falls back to the raw count when
      // the log has no pace, which is the same thing in a regulation game.
      pace: typeof g.pace === "number" && g.pace > 0 ? g.pace : g.poss,
      won: g.won === true,
      lost: g.won === false,
      margin: typeof g.pts_against === "number" ? g.pts_scored - g.pts_against : null,
      // A conference game is inferred from the two conferences matching, because
      // the game log carries no flag of its own. The one case this misreads is
      // an early-season neutral tournament pairing two league-mates, which is
      // rare enough not to move a season average.
      confGame: !!g.team_conference && g.team_conference === g.opp_conference,
    });
  }
  if (rows.length === 0) { console.log(`${season}: no usable rows`); return {}; }

  const { teams, idx, mean, off, def, hca } = fitSeason(rows);
  const tempo = fitTempo(rows);

  /**
   * Residual sigma for the win-probability model, measured on this season.
   *
   * Predicted margin comes from the fitted parameters; sigma is the spread of
   * what actually happened around it. Measuring rather than assuming is what
   * lets a slow, low-scoring era carry a tighter spread than a fast one.
   *
   * Each game appears twice in the log, once per side, and the two residuals
   * are exact negatives — which leaves the mean at zero and the standard
   * deviation unchanged, so the duplication is harmless here.
   */
  const sigma = (() => {
    let n = 0, ss = 0;
    for (const r of rows) {
      if (r.margin === null) continue;
      const a = idx.get(r.team), b = idx.get(r.opp);
      const pace = tempo.mean + tempo.t[tempo.idx.get(r.team)] + tempo.t[tempo.idx.get(r.opp)];
      const expA = ((mean + off[a] + (mean - def[b]) - mean) / 100) * pace;
      const expB = ((mean + off[b] + (mean - def[a]) - mean) / 100) * pace;
      const pred = expA - expB + hca * r.venue;
      const e = r.margin - pred;
      ss += e * e; n++;
    }
    return n > 1 ? Math.sqrt(ss / (n - 1)) : 11;
  })();

  /** Every D-I team's rating, for the bubble baseline and the win-prob calls. */
  const ratingOf = (team) => {
    const i = idx.get(team);
    return { ortg: mean + off[i], drtg: mean - def[i], mean };
  };
  const d1Teams = teams.filter((t) => t !== NON_D1);
  const ranked = d1Teams
    .map((t) => ({ team: t, net: off[idx.get(t)] + def[idx.get(t)] }))
    .sort((a, b) => b.net - a.net);
  // Clamped, so a thin season (2021) still resolves to a real team rather than
  // falling off the end of the list.
  const bubbleTeam = ranked[Math.min(BUBBLE_RANK - 1, ranked.length - 1)]?.team;
  const bubble = bubbleTeam ? ratingOf(bubbleTeam) : null;

  // Games + opponent lists per team, for SOS and game counts.
  // The whole row is kept now, not just the opponent name: venue, conference
  // flag and result are all needed downstream for the schedule splits and WAB.
  const gamesFor = new Map();
  for (const r of rows) {
    let a = gamesFor.get(r.team);
    if (!a) { a = []; gamesFor.set(r.team, a); }
    a.push(r);
  }

  const out = {};
  let nd1 = 0;
  for (const team of teams) {
    if (team === NON_D1) continue;
    const i = idx.get(team);
    const opps = gamesFor.get(team) ?? [];
    if (opps.length === 0) continue;
    nd1++;

    // aORTG / aDRTG are expressed on the familiar points-per-100 scale by
    // adding the league mean back, so 112.4 reads like a rating rather than the
    // raw "+5.1 above average" coefficient.
    const aortg = mean + off[i];
    const adrtg = mean - def[i];

    // Strength of schedule = how good this team's opponents were, averaged over
    // the games actually played (so a team that played Duke twice gets Duke
    // counted twice). oSOS is the average opponent OFFENSE faced — i.e. how
    // hard this team's DEFENSE had it — and dSOS the average opponent defense.
    let oSosSum = 0, dSosSum = 0;
    // Net schedule strength, kept separately for conference and non-conference
    // games. Split from one loop rather than three passes so a game can never
    // land in a different bucket in one figure than in another.
    let ncSum = 0, ncN = 0, confSum = 0, confN = 0;
    let wins = 0, losses = 0;
    let bubbleWins = 0;
    for (const r of opps) {
      const j = idx.get(r.opp);
      const oOff = mean + off[j];
      const oDef = mean - def[j];
      oSosSum += oOff;
      dSosSum += oDef;
      const net = oOff - oDef;
      if (r.confGame) { confSum += net; confN++; } else { ncSum += net; ncN++; }
      if (r.won) wins++;
      if (r.lost) losses++;
      if (bubble) {
        const pace = tempo.mean + tempo.t[tempo.idx.get(team)] + tempo.t[tempo.idx.get(r.opp)];
        // The bubble team is dropped into THIS team's schedule — same opponent,
        // same venue — so the only thing that differs between the two records
        // is quality, which is exactly what WAB is asking about.
        bubbleWins += winProb(bubble, ratingOf(r.opp), pace, hca, r.venue, sigma);
      }
    }
    const oSos = oSosSum / opps.length;
    const dSos = dSosSum / opps.length;

    out[`${team}|${season}`] = {
      games: opps.length,
      a_ortg: r1(aortg),
      a_drtg: r1(adrtg),
      a_net: r1(aortg - adrtg),
      /** Average opponent adjusted offense faced (higher = tougher offenses). */
      o_sos: r1(oSos),
      /** Average opponent adjusted defense faced (LOWER = tougher defenses). */
      d_sos: r1(dSos),
      /** Net schedule strength: opponents' net rating, opponent-average = 0. */
      sos: r1(oSos - dSos),
      /** The same figure over non-conference and conference games only. */
      nc_sos: ncN ? r1(ncSum / ncN) : null,
      conf_sos: confN ? r1(confSum / confN) : null,
      /** Possessions per 40 against an average opponent. */
      adjt: r1(tempo.mean + tempo.t[tempo.idx.get(team)]),
      wins,
      losses,
      /**
       * Straight from the counts above, so it can never disagree with them.
       *
       * THREE DECIMALS, not two. The column renders as a percentage to one
       * decimal place, so storing 0.93 turns 37-3 into "93.0%" when it is
       * 92.5% — the display rounding and the storage rounding were compounding.
       */
      win_pct: opps.length ? r3(wins / opps.length) : null,
      /**
       * Wins above bubble: actual wins minus what a BUBBLE_RANK-quality team
       * would have been expected to win against this exact schedule.
       *
       * Not comparable to Bart's WAB — his bubble baseline is his own and is not
       * published in a reproducible form. Same question, our stated baseline.
       */
      wab: bubble ? r1(wins - bubbleWins) : null,
      /**
       * That bubble team's expected win PERCENTAGE against this schedule — the
       * win-probability framing of schedule strength, on our own numbers.
       * Reads high for a soft schedule, which is the opposite direction to
       * `sos` above; both are labelled accordingly in the UI.
       */
      sos_wp: bubble && opps.length ? r2(bubbleWins / opps.length) : null,
    };
  }

  console.log(
    `${season}: ${nd1} D-I teams  ` +
    `mean ${mean.toFixed(1)} pts/100  tempo ${tempo.mean.toFixed(1)}  ` +
    `hca ${hca >= 0 ? "+" : ""}${hca.toFixed(2)}  sigma ${sigma.toFixed(2)}  ` +
    `bubble #${BUBBLE_RANK} ${bubbleTeam ?? "—"}  (${rows.length} obs)`,
  );
  return out;
}

const list = oneSeason ? [oneSeason] : SEASONS;
console.log(`Fitting schedule-adjusted ratings for ${list.length} season(s)…\n`);
const all = {};
for (const s of list) Object.assign(all, run(s));

// Merge rather than clobber when run for a single season.
let existing = {};
if (oneSeason && fs.existsSync(OUT)) {
  try { existing = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch { existing = {}; }
}
fs.writeFileSync(OUT, JSON.stringify({ ...existing, ...all }));
console.log(`\n✓ ${Object.keys({ ...existing, ...all }).length} team-seasons → ${path.relative(ROOT, OUT)}`);
