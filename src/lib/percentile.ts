/**
 * Percentile rank, with ties handled the one correct way.
 *
 * ── THE BUG THIS EXISTS TO PREVENT ────────────────────────────────────────
 *
 * Every surface on this site used to compute percentiles the same wrong way:
 * sort the values, then use the POSITION IN THE SORTED ARRAY as the rank.
 *
 *     vals.sort(...);
 *     vals.forEach(([id], i) => out.set(id, Math.round(i / (n - 1) * 100)));
 *
 * That is fine until two rows share a value, at which point they are separated
 * by nothing but wherever Array.sort happened to leave them. Losses Leading
 * 20+ in 2025-26 is the clearest case: 340 of 365 teams have zero — the best
 * possible value — and they were handed every percentile from 7 to 100. Two
 * teams with identical records rendered one red and one green.
 *
 * Ties are not an edge case here. Counting stats (wins, wire-to-wire losses,
 * comebacks) have hundreds of them, and those are exactly the columns where
 * the reader most expects two equal numbers to look equal.
 *
 * ── WHY MIDRANK, AND NOT THE TOP OR BOTTOM OF THE TIED BLOCK ──────────────
 *
 * A tie means the stat did not separate those rows, and only the midpoint says
 * so. Taking the block's best rank would put all 340 of those teams at the
 * 100th percentile; taking its worst would put them at the 7th. Both assert a
 * distinction the data does not contain — and the second one paints the best
 * available value red, which is how this was noticed.
 *
 * Midrank puts them at 53, in the neutral band of the colour ramp, which reads
 * correctly as "this stat does not separate you from the field".
 *
 * It is also the standard definition of percentile rank — (values below, plus
 * half the ties) / total — and the one that keeps a cohort's mean percentile
 * near 50, which is the property the ramp is built around.
 *
 * ── KEEP IN STEP ──────────────────────────────────────────────────────────
 *
 * scripts/lib/percentile.mjs is the same function for the build scripts, which
 * run under plain node and cannot import this file. If the convention changes
 * here, change it there.
 */

/**
 * Percentiles for `values`, aligned to the input array by index.
 *
 * Non-finite entries (null, undefined, NaN) return null and take no part in
 * the ranking, so a stat that only half the cohort has is ranked against the
 * half that has it.
 *
 * Fewer than two ranked values returns all nulls: a percentile against a
 * population of one is not a statement about anything.
 *
 * @param higherBetter false to invert, so the LOWEST value scores 100 (turnover
 *   rate, losses, defensive rating).
 */
export function midrankPercentiles(
  values: ReadonlyArray<number | null | undefined>,
  higherBetter = true,
): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null);

  const idx: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (typeof v === "number" && Number.isFinite(v)) idx.push(i);
  }
  const n = idx.length;
  if (n < 2) return out;

  // Ascending when higher is better, so the largest value lands at the top of
  // the range; flipped otherwise. The comparator reads the ORIGINAL array
  // rather than a copied pair list — one allocation instead of n.
  idx.sort((a, b) => {
    const d = (values[a] as number) - (values[b] as number);
    return higherBetter ? d : -d;
  });

  for (let start = 0; start < n; ) {
    let end = start;
    // Walk the whole run of equal values. Strict equality is right: these are
    // the same numbers, not computed approximations of each other.
    while (end + 1 < n && values[idx[end + 1]!] === values[idx[start]!]) end++;
    const pct = Math.round((((start + end) / 2) / (n - 1)) * 100);
    for (let k = start; k <= end; k++) out[idx[k]!] = pct;
    start = end + 1;
  }

  return out;
}

/**
 * The same thing keyed by id, for callers holding `[id, value]` pairs rather
 * than an array parallel to their rows.
 *
 * Ids whose value is missing are absent from the map, which is what every
 * caller already expected of its own hand-rolled version.
 */
export function midrankPercentileMap<K>(
  entries: ReadonlyArray<readonly [K, number | null | undefined]>,
  higherBetter = true,
): Map<K, number> {
  const pcts = midrankPercentiles(entries.map((e) => e[1]), higherBetter);
  const out = new Map<K, number>();
  for (let i = 0; i < entries.length; i++) {
    const p = pcts[i];
    if (p !== null && p !== undefined) out.set(entries[i]![0], p);
  }
  return out;
}
