/**
 * Shared derivations over CBBD box-score rows.
 *
 * Both the per-game log builder and the season aggregator need the same answers
 * to "how many possessions was this?" and "is this adjusted rating real?". When
 * those lived in two places they disagreed, and the disagreement showed up as a
 * team whose season pace didn't match the mean of its own game rows.
 */

/**
 * Standard possession estimator: FGA − OREB + TOV + 0.475·FTA.
 * Returns null when the row is too empty to estimate from.
 */
export function estimatePossessions(s) {
  const fga = s?.fieldGoals?.attempted;
  const fta = s?.freeThrows?.attempted;
  const orb = s?.rebounds?.offensive;
  const tov = s?.turnovers?.total;
  if ([fga, fta, orb, tov].some((v) => typeof v !== "number")) return null;
  const est = fga - orb + tov + 0.475 * fta;
  return est > 0 ? est : null;
}

/**
 * Possessions for one side of one game.
 *
 * CBBD's `possessions` field cannot be taken at face value. Two failure modes:
 *
 *   1. null — 5.5% of sides across 2014-2026 (16,952 of 307,190), concentrated
 *      in the older seasons.
 *   2. Present but corrupt — 0.35% overall, 2.90% in 2018. These are small
 *      integers on rows whose box score plainly contradicts them: William &
 *      Mary vs James Madison on 2020-01-24 reports `possessions: 1` alongside
 *      57 field-goal attempts and 88 points.
 *
 * Mode 2 is the dangerous one, because `typeof x === "number"` accepts it. Left
 * unguarded it deflated William & Mary's 2020 season pace to 53.0 (actual ~66.7) and
 * inflated their ORtg to 134.8 and DRtg to 158.8 — a team-season that looked
 * like a historic outlier purely because seven games contributed ~1 possession
 * each.
 *
 * So the provider's number is used only when it agrees with the estimator to
 * within 35%; otherwise the estimator wins. The threshold is deliberately loose
 * — the estimator is an approximation and legitimately differs by a few
 * possessions — but 35% is far tighter than the 50× errors it is there to catch.
 */
export function possessionsFor(s) {
  const est = estimatePossessions(s);
  const given = s?.possessions;
  if (typeof given !== "number" || !Number.isFinite(given) || given <= 0) return est;
  if (est === null) return given;
  return Math.abs(given - est) > 0.35 * est ? est : given;
}

/**
 * Plausibility band for an opponent-adjusted efficiency rating.
 *
 * D-I adjusted ORtg/DRtg sit roughly in 85-125; the widest real extremes are
 * still inside 60-150. CBBD ships 13 team-seasons outside that band, and they
 * are unambiguously corrupt rather than extreme — William & Mary 2020 at
 * ORtg 1148.5 is simultaneously ranked #1 in offense and #351 in defense, and
 * four of its CAA rivals are broken in the same season.
 *
 * Rejected ratings become null, which makes bta_ortg/bta_drtg fall back to
 * Bart's adjoe/adjde alone for that team-season (avgIfPresent skips nulls)
 * rather than averaging in a number that is off by an order of magnitude.
 */
export function plausibleRating(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 60 && v <= 150 ? v : null;
}

/** Point-split keys CBBD nests under `points`. */
export const SPLIT_KEYS = ["fastBreak", "inPaint", "offTurnovers"];

/**
 * One point-split for one side, or null if the value can't be trusted.
 *
 * CBBD ships splits that exceed the team's own final score: Mid-Atlantic
 * Christian is credited with 854 fast-break points in a 55-point game against
 * Campbell on 2025-11-14. That single row produced a −786 season fast-break
 * differential for Campbell, which is why this is a hard bound rather than a
 * warning.
 */
function splitValue(side, key) {
  const v = side?.points?.[key];
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
  const total = side?.points?.total;
  if (typeof total === "number" && v > total) return null;
  return v;
}

/**
 * A point-split for BOTH sides of a game, or [null, null] when the split wasn't
 * tracked for that game.
 *
 * THE UNTRACKED-AS-ZERO PROBLEM: CBBD does not distinguish "no fast-break
 * points" from "this arena didn't record fast-break points" — both arrive as 0.
 * Measured share of games where BOTH sides report 0:
 *
 *          fastBreak   inPaint   offTurnovers
 *   2014     56.9%      52.8%       35.0%
 *   2018     32.6%      29.2%       21.4%
 *   2022     38.3%      36.5%       18.8%
 *   2024      0.3%       0.1%        0.1%
 *   2026      0.5%       0.3%        0.3%
 *
 * A game in which neither team scored a single point in the paint does not
 * happen, so both-sides-zero is a reliable "untracked" signal. Summing those as
 * real zeros is what dropped 2014's league-median fast-break share to 0.069
 * against 0.129 in 2026 — an artifact that reads as a decade of tactical change.
 *
 * Returning nulls pushes the decision up to the caller: the per-game logs emit
 * null (so /calc shows "no data" instead of a fake even battle), and the season
 * aggregator accumulates only tracked games and reports its coverage.
 */
export function trackedSplit(own, opp, key) {
  const a = splitValue(own, key), b = splitValue(opp, key);
  if (a === null || b === null) return [null, null];
  if (a === 0 && b === 0) return [null, null];
  return [a, b];
}
