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

/**
 * How often winning each of our four factors won the GAME, across a full
 * season of D-I play.
 *
 * GENERATED — run `node scripts/build-factor-winrates.mjs 2026`. Held static
 * on purpose: a rate computed from a completed season is a stable reference
 * for the season being played, and recomputing it live would move the goalposts
 * game by game. Restate it against the new season each summer.
 *
 * Measured per team-game (each game contributes both sides), non-D1 opponents
 * excluded, from the same game logs the Win Calculator reads.
 *
 * OREB% IS THE ODD ONE AND THE NUMBER IS NOT A BUG. Clearing the league's
 * offensive rebound rate won only 42.1% of the time — worse than a coin flip.
 * Offensive rebounds are only available off your own misses, so a high rate is
 * partly a symptom of poor shooting. It is the one factor here that is closer
 * to a warning than to an achievement, which is exactly why it is worth
 * printing beside the others rather than quietly dropping.
 */
export const FACTOR_WIN_RATE = {
  season: 2026,
  reb: 70.6,
  orb: 42.1,
  fbp: 65.6,
  tpm: 64.5,
  /** The tiebreak: a higher FTA rate than the opponent. */
  fta: 64.2,
  /** Taking more of the four than the opponent. */
  overall: 71.8,
} as const;

/** "2025-26" for a CBBD season label of 2026. */
export function seasonLabel(season: number): string {
  return `${season - 1}-${String(season).slice(2)}`;
}
