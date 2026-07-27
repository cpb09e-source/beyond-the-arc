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

const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

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
    });
  }
  if (rows.length === 0) { console.log(`${season}: no usable rows`); return {}; }

  const { teams, idx, mean, off, def, hca } = fitSeason(rows);

  // Games + opponent lists per team, for SOS and game counts.
  const gamesFor = new Map();
  for (const r of rows) {
    let a = gamesFor.get(r.team);
    if (!a) { a = []; gamesFor.set(r.team, a); }
    a.push(r.opp);
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
    for (const o of opps) {
      const j = idx.get(o);
      oSosSum += mean + off[j];
      dSosSum += mean - def[j];
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
    };
  }

  console.log(
    `${season}: ${nd1} D-I teams  ` +
    `league mean ${mean.toFixed(1)} pts/100  home-court ${hca >= 0 ? "+" : ""}${hca.toFixed(2)}  ` +
    `(${rows.length} observations)`,
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
