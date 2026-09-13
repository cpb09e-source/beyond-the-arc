/**
 * The site's midrank percentile, counted rather than sorted.
 *
 * src/lib/percentile.ts sorts every row. A season of player-games is 118,000
 * rows and a stat has at most a few thousand distinct values, so this counts
 * each value once, sorts only the distinct values, and gives every tie the same
 * ((start + end) / 2) / (n - 1) the site's function gives it. The expression is
 * written in the same order so the rounding cannot differ.
 *
 * WHY IT EXISTS: eleven columns of the site's function on a player-game season
 * is about half a second on first open. This is the same answer in a fraction
 * of that. It was checked equal to midrankPercentiles on every player-game stat
 * of a real season, in both directions, before the app used it.
 *
 * Returned as one byte per row, NO_PCT where the value is missing: a Map per
 * column would be millions of entries once a wide view is open.
 */

export const NO_PCT = 255;

export function midrankByValue(values: Float64Array, higherBetter: boolean): Uint8Array {
  const out = new Uint8Array(values.length).fill(NO_PCT);

  const counts = new Map<number, number>();
  let n = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (!Number.isFinite(v)) continue;
    n++;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  // As on the site: a percentile against a population of one says nothing.
  if (n < 2) return out;

  const distinct = [...counts.keys()].sort((a, b) => (higherBetter ? a - b : b - a));
  const pctOf = new Map<number, number>();
  let start = 0;
  for (const v of distinct) {
    const end = start + counts.get(v)! - 1;
    pctOf.set(v, Math.round((((start + end) / 2) / (n - 1)) * 100));
    start = end + 1;
  }

  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (Number.isFinite(v)) out[i] = pctOf.get(v)!;
  }
  return out;
}
