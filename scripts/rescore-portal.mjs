/**
 * rescore-portal.mjs — re-rank the transfer portal on EPM.
 *
 * Rewrites public/data/portal.json in place: attaches `epm` and `pvs` to every
 * entry, recomputes `stars`, and rebuilds `transfer_classes`. Reads only what's
 * already on disk — no On3 call, no Supabase — so it's safe to re-run and it
 * respects the data freeze.
 *
 *   node scripts/rescore-portal.mjs
 *
 * ---------------------------------------------------------------------------
 * THE SCORE
 *
 * Portal Value Score (PVS) = EPM × role weight.
 *
 *   EPM   points per 100 possessions the player adds over an average D-I
 *         player. Real play-by-play fit (epm-<year>.json) where we have it,
 *         box-score estimate (box-epm-<year>.json) filling the rest — the same
 *         precedence readImpactForYear and compute-player-ranks use, so the
 *         portal can never quote a different EPM than the player's own page.
 *
 *   role  min(1, MPG / 28) ^ 0.7. A rate stat alone would rank a 9-minute
 *         bench player off a hot 200-possession sample above a 32-minute
 *         starter. The exponent softens the taper: 14 MPG keeps ~62% of its
 *         weight rather than 50%, because a half-time contributor is worth
 *         appreciably more than half a starter, not exactly half.
 *
 * Negative EPM times a big role goes further negative, which is correct — a
 * below-average player who played 30 minutes did more damage than one who
 * played 12.
 *
 * NO CONFERENCE MULTIPLIER, and that's a measured decision rather than an
 * omission. Across all 4,953 ranked 2026 players, power-conference EPM averages
 * 1.65 against 0.37 for everyone else (p90: 3.85 vs 1.89) on effectively
 * identical possession counts. EPM already separates the tiers on its own, so
 * layering conf-tiers.ts on top — as BTA PRTG did — would count level of
 * competition twice and inflate every power-conference transfer.
 *
 * STAR TIERS are fixed cutoffs, not percentiles, so a player's tier doesn't
 * drift as other players enter or leave the portal. Chosen against the current
 * distribution to land roughly 2 / 12 / 28 / 32 / 27 percent.
 *
 * ---------------------------------------------------------------------------
 * CLASS NET is Σ eWins(in) − Σ eWins(out) over 2★-and-up moves, in WINS.
 *
 * It used to sum PVS. The reason it does not any more is not that eWins is a
 * different opinion — measured across 535 scored portal entries the two
 * correlate at 0.983, so the ordering barely moves. It is that a class total
 * has to be ADDITIVE, and only one of them is.
 *
 * EPM is a rate: points per 100 possessions. Adding five players' EPMs does not
 * produce a team quantity, and PVS is EPM times a hand-tuned minutes curve —
 * min(1, MPG/28)^0.7 — so summing it produces a number in no unit at all. eWins
 * is EPM times the possessions the player actually played, divided by points
 * per win, so it is already denominated in wins and summing it means something:
 * "this class added 4.2 wins over what an average player would have."
 *
 * The minutes curve was also wrong in a specific way. It reads MPG and never
 * sees GAMES, so a player who missed two thirds of the season was weighted like
 * one who played it all: Markus Burton (10 games, 30.1 MPG) ranked 32nd of 535
 * on PVS and 185th on eWins. For "what did this school actually gain or lose",
 * ten games is ten games.
 *
 * WHAT THIS DOES NOT BUY, stated plainly because it would be easy to imply
 * otherwise: eWins is not better at PREDICTING a transfer's next season. Over
 * 1,326 transfers with a real fit in both seasons, next-year eWins correlates
 * r=0.464 with prior eWins, 0.474 with prior PVS and 0.476 with prior EPM alone
 * — all the same number. On the partial-season subset (GP<=20, n=108) eWins is
 * the WEAKEST of the three, 0.335 against 0.385, which is the Burton case in
 * reverse: a class total should not credit him for games he did not play, but
 * an estimate of what he will do next year should not dock him for them either.
 * This file ranks what happened. It is not a projection.
 *
 * NO CLASS-DEVELOPMENT BUMP, and that is measured rather than assumed. The
 * freshman-to-sophomore leap is real in the raw numbers for transfers — Fr->So
 * +0.77 EPM against Jr->Sr +0.35 — and it disappears almost entirely once you
 * condition on where the player started:
 *
 *   start band     Fr->So     So->Jr     Jr->Sr
 *   below -1       +1.57      +1.45      +1.37
 *   -1 to +0.5     +0.51      +0.57      +0.51
 *   +0.5 to +2     -0.31      +0.02      -0.09
 *
 * Within a band every class moves the same amount, which is mean reversion, not
 * development — it would happen to a rock. The raw Fr->So edge is just that
 * freshmen start lower and so revert further up. Worse, in the +0.5 to +2 band —
 * exactly where a good freshman about to "leap" sits — the measured Fr->So
 * change is NEGATIVE. A flat sophomore bump would inflate precisely the players
 * it looks most obviously right for.
 *
 * NO STEP-UP DISCOUNT for mid-major players moving to a power league, and this
 * one is worth spelling out because the intuition behind it is CORRECT and the
 * conclusion still goes the other way.
 *
 * The role loss is real and large. Over 268 mid->power transfers, usage falls
 * 4.2 points and minutes 4.7 per game. So does the rate: among players who left
 * at EPM >= +1, mid->power lost 0.73 EPM against 0.17 for power->power movers
 * who started at essentially the same level (+2.20 vs +2.10). On a per-
 * possession basis, stepping up costs about half a point of EPM.
 *
 * It does not survive as a predictor of next-season VALUE. Regressing next-year
 * eWins on prior EPM gives R^2 = 0.2269; adding step-up and step-down
 * indicators gives 0.2304. Knowing the conference move is worth 0.35% of
 * explanatory power — and the mid->power coefficient comes out at +0.045, the
 * WRONG SIGN for a discount. Two things cancel the rate loss: power programs
 * play more games, so the same player banks more possessions, and the mid-major
 * players who get power offers are positively selected relative to their EPM.
 *
 * A discount here would be a knob that does not earn its place and points the
 * wrong way. The interesting finding is kept where it belongs — in the comment,
 * not in the score.
 */
import fs from "node:fs";
import path from "node:path";

const DATA = path.resolve("public/data");
const PORTAL = path.join(DATA, "portal.json");

// Minutes that count as a full-time role. A 28+ MPG player carries full weight.
const FULL_MPG = 28;
const ROLE_EXP = 0.7;

// Same production baseline the portal table filters on, so a player can't be
// starred without also being visible.
const MIN_GP = 10, MIN_MPG = 12, MIN_PPG = 4;

/**
 * RECALIBRATED when EPM's zero point moved (export-epm-json.mjs, 2026-08).
 *
 * These are fixed cutoffs on a PVS built from EPM, so they are only meaningful
 * relative to where EPM's zero sits — and EPM's zero was wrong by +1.18 to
 * +1.31 depending on the season. Re-running the rescore against the corrected
 * scale without touching these took the distribution from
 *
 *     12 / 64 / 156 / 177 / 149      (2.2 / 11.5 / 28.0 / 31.7 / 26.7 %)
 * to  8 / 21 /  74 / 103 / 331       (1.5 /  3.9 / 13.8 / 19.2 / 61.6 %)
 *
 * — 328 players demoted and 10 promoted, none of whom had played a game in
 * between. The old numbers were calibrated against an inflated scale; leaving
 * them would have silently marked most of the portal down.
 *
 * Re-chosen against the corrected PVS to restore the distribution this file
 * already documents as the intent (2 / 12 / 28 / 32 / 27), which lands at
 * 1.9 / 12.7 / 27.6 / 30.7 / 27.2. Still FIXED, not percentiles, so a player's
 * tier does not drift as others enter or leave the portal — the calibration is
 * a one-off against a corrected scale, not a change of method.
 *
 * If EPM's zero point ever moves again, these move with it. That is the tell
 * that they are scale-bound constants rather than free parameters.
 */
function starsForPvs(v) {
  if (v >= 3.1) return 5;
  if (v >= 1.7) return 4;
  if (v >= 0.5) return 3;
  if (v >= -0.4) return 2;
  return 1;
}

/**
 * Possessions per minute of court time, the median over the 552 portal
 * player-seasons that have both a fitted possession count and 200+ minutes.
 * The distribution is tight — p5 1.539, p95 1.872 — which is what makes it
 * usable as a repair below.
 */
const POSS_PER_MIN = 1.70;
/** College points of margin per marginal win — same constant as the EPM export. */
const PTS_PER_WIN = 30;
/**
 * Below this share of the possessions a player's own minutes imply, the fitted
 * possession count is not a small sample, it is wrong. Two of 567 portal
 * entries trip it: CJ Brown is recorded at 14.3 possessions against 906 minutes
 * over 34 games, and Isaiah Johnson at 70.1 against ~980. eWins is EPM times
 * possessions, so left alone those two silently score 0.00 wins for a full
 * starting season, and a school's class total quietly loses a starter.
 */
const POSS_SANITY = 0.25;

// ---- EPM + eWins, real fit first then box estimate ----
// eWins exists ONLY in the play-by-play fit — box-epm carries none — so a
// box-only player gets an EPM and a null eWins rather than a fabricated zero.
// That costs almost nothing here: of 569 portal entries with an EPM, 567 come
// from the real fit.
const epmCache = new Map();
function epmForYear(year) {
  if (epmCache.has(year)) return epmCache.get(year);
  const out = new Map();
  for (const [file, fillOnly] of [[`epm-${year}.json`, false], [`box-epm-${year}.json`, true]]) {
    const p = path.join(DATA, file);
    if (!fs.existsSync(p)) continue;
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    for (const [id, v] of Object.entries(j.players ?? {})) {
      if (typeof v?.epm !== "number" || !Number.isFinite(v.epm)) continue;
      const k = Number(id);
      if (fillOnly && out.has(k)) continue;
      out.set(k, {
        epm: v.epm,
        ewins: typeof v.ewins === "number" && Number.isFinite(v.ewins) ? v.ewins : null,
        poss: typeof v.poss === "number" && Number.isFinite(v.poss) ? v.poss : null,
      });
    }
  }
  epmCache.set(year, out);
  return out;
}

const portal = JSON.parse(fs.readFileSync(PORTAL, "utf8"));
const entries = portal.entries ?? [];

let joined = 0, scored = 0, withEwins = 0, repaired = 0;
const repairs = [];
for (const e of entries) {
  const hit =
    e.last_year != null && e.bart_player_id != null
      ? epmForYear(e.last_year).get(e.bart_player_id) ?? null
      : null;
  const epm = hit?.epm ?? null;
  e.epm = epm;

  // eWins, with the possession repair described at POSS_SANITY.
  let ewins = hit?.ewins ?? null;
  const minutes = (e.gp ?? 0) * (e.mpg ?? 0);
  if (epm !== null && minutes >= 200 && hit?.poss != null && hit.poss < minutes * POSS_PER_MIN * POSS_SANITY) {
    const estPoss = minutes * POSS_PER_MIN;
    ewins = (epm / 100) * estPoss / PTS_PER_WIN;
    repaired++;
    repairs.push(`${e.name} (${e.gp} gp, ${(e.mpg ?? 0).toFixed(1)} mpg): fitted poss ${hit.poss} → est ${Math.round(estPoss)}, eWins ${ewins.toFixed(2)}`);
  }
  e.ewins = ewins === null ? null : Math.round(ewins * 1000) / 1000;
  if (e.ewins !== null) withEwins++;

  const eligible =
    epm !== null && (e.gp ?? 0) >= MIN_GP && (e.mpg ?? 0) >= MIN_MPG && (e.ppg ?? 0) >= MIN_PPG;
  if (epm !== null) joined++;
  if (eligible) {
    const role = Math.pow(Math.min(1, (e.mpg ?? 0) / FULL_MPG), ROLE_EXP);
    e.pvs = Math.round(epm * role * 1000) / 1000;
    e.stars = starsForPvs(e.pvs);
    scored++;
  } else {
    e.pvs = null;
    e.stars = 0;
  }
}

// ---- transfer classes ----
const perSchool = new Map();
function bucket(name, conf) {
  let b = perSchool.get(name);
  if (!b) { b = { school: name, conference: conf ?? null, in_players: [], out_players: [] }; perSchool.set(name, b); }
  return b;
}
for (const e of entries) {
  if (!e.team_from || !e.team_to) continue;
  /**
   * WHO COUNTS. A class total should be a statement about players who will
   * change a rotation, so the same three-part production baseline the table
   * filters on (GP>=10, MPG>=12, PPG>=4, via `pvs` being non-null) plus the
   * 2★ floor gates entry. Walk-ons, one-week cameos and end-of-bench moves are
   * out — not scaled down, out.
   *
   * A player with no eWins is also out, and that is the one exclusion worth
   * naming: eWins comes only from the play-by-play fit, so a box-only player
   * cannot contribute to a total denominated in wins. It affects 2 of 569.
   */
  if (typeof e.pvs !== "number" || e.stars < 2) continue;
  if (typeof e.ewins !== "number") continue;
  const base = {
    cbba_player_id: e.cbba_player_id,
    bart_player_id: e.bart_player_id,
    name: e.name,
    epm: e.epm,
    pvs: e.pvs,
    ewins: e.ewins,
    stars: e.stars,
  };
  bucket(e.team_from, e.conf_from).out_players.push({ ...base, counter_team: e.team_to, counter_conf: e.conf_to });
  bucket(e.team_to, e.conf_to).in_players.push({ ...base, counter_team: e.team_from, counter_conf: e.conf_from });
}

/**
 * Class-score points per net win. Chosen against the real distribution: at 20,
 * this cycle runs -112 to +86 with a median of -1, so the scale uses its range
 * without anything pinning at the top. At 25 the best classes clear 100 and the
 * number stops meaning anything.
 */
const POINTS_PER_WIN = 20;

const POWER = new Set(["ACC", "B10", "B12", "SEC", "BE"]);
const allRows = [];
for (const b of perSchool.values()) {
  const sum = (a) => a.reduce((s, p) => s + (p.ewins ?? 0), 0);
  b.in_players.sort((x, y) => (y.ewins ?? 0) - (x.ewins ?? 0));
  b.out_players.sort((x, y) => (y.ewins ?? 0) - (x.ewins ?? 0));
  const net = sum(b.in_players) - sum(b.out_players);
  allRows.push({
    school: b.school,
    conference: b.conference,
    net: Math.round(net * 100) / 100,
    /**
     * The same number on a 0-100 reading scale: POINTS_PER_WIN points per win,
     * so a class that adds five wins scores 100 and an average one scores 0.
     *
     * Fixed constant, not a percentile or a normalisation against this year's
     * best class — same reasoning as the star cutoffs above. A percentile would
     * make 100 mean "best available this cycle", so a weak year's best class
     * would score the same as a historic one, and every school's number would
     * move when an unrelated school signed someone. A fixed scale means a 60
     * is a 60 in any year.
     *
     * Unclamped, and negatives are the point: the current spread runs +86 to
     * -112, and a school that lost five wins of production to the portal has
     * earned a number that says so.
     */
    score: Math.round(net * POINTS_PER_WIN),
    in_count: b.in_players.length,
    out_count: b.out_players.length,
    in_players: b.in_players,
    out_players: b.out_players,
  });
}
const top_overall = [...allRows].sort((a, b) => b.net - a.net).slice(0, 10);
const worst_power = allRows
  .filter((r) => r.conference && POWER.has(r.conference))
  .sort((a, b) => a.net - b.net)
  .slice(0, 10);
const by_school = {};
for (const r of allRows) by_school[r.school] = r;

portal.transfer_classes = { top_overall, worst_power, by_school };
portal.scoring = {
  // Two metrics doing two jobs, deliberately. `pvs` tiers the PLAYER (how good
  // is he, per minute he plays) and drives the stars. `ewins` totals the CLASS
  // (how much did the school actually gain), because only a wins-denominated
  // quantity can be summed across players.
  metric: "ewins",
  class_formula: "sum(eWins in) - sum(eWins out), over 2-star-and-up moves with a play-by-play eWins",
  class_score_formula: `round(net eWins * ${POINTS_PER_WIN})`,
  star_metric: "pvs",
  star_formula: "EPM * min(1, MPG/28)^0.7",
  star_cutoffs: [-0.4, 0.5, 1.7, 3.1],
  rescored_at: new Date().toISOString(),
};
fs.writeFileSync(PORTAL, JSON.stringify(portal));

const tiers = [0, 0, 0, 0, 0, 0];
for (const e of entries) tiers[e.stars ?? 0]++;
console.log(`portal rescored — stars on PVS, classes on eWins`);
console.log(`  ${entries.length.toLocaleString()} entries · ${joined.toLocaleString()} joined an EPM · ${withEwins.toLocaleString()} joined an eWins · ${scored.toLocaleString()} cleared the baseline and were starred`);
if (repaired) console.log(`  ${repaired} possession count(s) repaired:\n${repairs.map((r) => `    ${r}`).join("\n")}`);
console.log(`  tiers  5★ ${tiers[5]}  4★ ${tiers[4]}  3★ ${tiers[3]}  2★ ${tiers[2]}  1★ ${tiers[1]}  unrated ${tiers[0]}`);
console.log(`  ${allRows.length} schools ranked · best ${top_overall[0]?.school} ${top_overall[0]?.net.toFixed(1)} wins (score ${top_overall[0]?.score}) · worst power ${worst_power[0]?.school} ${worst_power[0]?.net.toFixed(1)} (score ${worst_power[0]?.score})`);
