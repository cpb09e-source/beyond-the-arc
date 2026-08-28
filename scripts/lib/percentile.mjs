/**
 * Percentile rank with ties sharing a midrank — the build-script copy of
 * src/lib/percentile.ts.
 *
 * DUPLICATED ON PURPOSE, and this is the whole reason it is a separate file
 * rather than an import: these scripts run under plain `node`, not tsx, so
 * they cannot load a .ts module. Two small files that agree beat one shared
 * file that half the callers cannot reach.
 *
 * The full argument for midrank is in src/lib/percentile.ts. The short version:
 * ranking by position in the sorted array gives tied values different
 * percentiles depending on where Array.sort left them, and taking either end
 * of a tied block asserts a distinction the data does not contain. If the
 * convention changes there, change it here.
 */

/**
 * Percentiles for `values`, aligned to the input array by index.
 * Non-finite entries return null and take no part in the ranking.
 *
 * @param {ReadonlyArray<number|null|undefined>} values
 * @param {boolean} [higherBetter=true] false inverts, so the LOWEST value scores 100.
 * @returns {Array<number|null>}
 */
export function midrankPercentiles(values, higherBetter = true) {
  const out = new Array(values.length).fill(null);

  const idx = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (typeof v === "number" && Number.isFinite(v)) idx.push(i);
  }
  const n = idx.length;
  if (n < 2) return out;

  idx.sort((a, b) => {
    const d = values[a] - values[b];
    return higherBetter ? d : -d;
  });

  for (let start = 0; start < n; ) {
    let end = start;
    while (end + 1 < n && values[idx[end + 1]] === values[idx[start]]) end++;
    const pct = Math.round((((start + end) / 2) / (n - 1)) * 100);
    for (let k = start; k <= end; k++) out[idx[k]] = pct;
    start = end + 1;
  }

  return out;
}

/**
 * The same thing keyed by id, for callers holding `[id, value]` pairs.
 * Ids with a missing value are absent from the map.
 *
 * @param {ReadonlyArray<readonly [unknown, number|null|undefined]>} entries
 * @param {boolean} [higherBetter=true]
 * @returns {Map<unknown, number>}
 */
export function midrankPercentileMap(entries, higherBetter = true) {
  const pcts = midrankPercentiles(entries.map((e) => e[1]), higherBetter);
  const out = new Map();
  for (let i = 0; i < entries.length; i++) {
    if (pcts[i] !== null) out.set(entries[i][0], pcts[i]);
  }
  return out;
}
