/**
 * D-I season means, for the rates that need a league baseline rather than a
 * head-to-head comparison.
 *
 * GENERATED — run `node scripts/build-league-averages.mjs` and paste the
 * output when the season data is refreshed. A dozen numbers that move a tenth
 * of a point a year live better in code than in a file the browser has to
 * fetch to render one panel.
 */

/**
 * Unweighted mean offensive rebound rate across D-I teams, by season, as a
 * percentage.
 *
 * Offensive rebound rate is the one of our four factors that is not a
 * differential: both teams have their own, and both can be good or both bad in
 * the same game. A 34% and a 33% night is two teams crashing the glass, not
 * one winning a category — so it is scored against the league rather than
 * against the opponent.
 *
 * The drift is real and worth carrying per season: 31.6% in 2014 down to 28.0%
 * in 2021 and back to 31.0% in 2026. A single fixed threshold would quietly
 * mis-score a decade of games.
 */
export const OREB_PCT_D1: Record<number, number> = {
  2014: 31.6,
  2015: 31.2,
  2016: 30.0,
  2017: 29.4,
  2018: 28.9,
  2019: 28.6,
  2020: 28.2,
  2021: 28.0,
  2022: 28.4,
  2023: 28.9,
  2024: 29.3,
  2025: 30.2,
  2026: 31.0,
};

/** The baseline for a season, falling back to the nearest one we hold. */
export function orebBaseline(season: number): number {
  const hit = OREB_PCT_D1[season];
  if (typeof hit === "number") return hit;
  const seasons = Object.keys(OREB_PCT_D1).map(Number).sort((a, b) => a - b);
  if (seasons.length === 0) return 30;
  const nearest = seasons.reduce((best, s) =>
    Math.abs(s - season) < Math.abs(best - season) ? s : best, seasons[0]!);
  return OREB_PCT_D1[nearest]!;
}
