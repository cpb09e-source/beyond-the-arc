/**
 * Which seasons of CBBD's adjusted ratings the site is willing to show.
 *
 * `ortg_adj`, `drtg_adj` and `net_rtg_adj` on a team-season row come straight
 * from CBBD's /ratings/adjusted. Five of the thirteen seasons we carry are
 * wrong, and they are wrong in two different ways:
 *
 *   COMPRESSED — 2014, 2017, 2018 and 2023 squeeze the whole country into a
 *   few points. 2023 puts 357 of 361 teams inside a seven-point band and calls
 *   Pittsburgh the best offense in the country at 160.4 against a league where
 *   nobody else clears 131. The ordering is roughly right; the numbers are not
 *   numbers. Purdue reads +8.8 where every other measure has it near +24.
 *
 *   DECORRELATED — 2020 is the dangerous one. Its spread is 24.5 points, every
 *   value is in range, and nothing about the file looks wrong. It correlates
 *   with Bart's adjusted margin at r = 0.22. It is not a scale problem; the
 *   season it describes did not happen.
 *
 * WHICH IS WHY THE TEST IS AGREEMENT, NOT SHAPE. Bart's adjusted offense minus
 * his adjusted defense is an independent model of the same quantity, sitting on
 * the same row. Where both sources work they agree at r > 0.96; where CBBD is
 * broken it collapses. The two groups are separated by a wide gap — 0.858
 * against 0.962 — so 0.93 is not a fine judgment call. Measured by
 * scripts/audit-cbbd-adjusted.mjs, which fails if this list drifts from it:
 *
 *     year    n   spread    ref   slope       r   verdict
 *     2014  348      6.3   39.6    1.70   0.501   REJECTED
 *     2015  348     26.7   39.7    1.39   0.962   trusted
 *     2016  348     38.9   39.1    0.99   0.988   trusted
 *     2017  347      6.0   40.8    5.62   0.858   REJECTED
 *     2018  348      7.2   38.5    3.82   0.742   REJECTED
 *     2019  350     24.6   37.5    1.41   0.965   trusted
 *     2020  351     24.5   36.3    0.07   0.216   REJECTED
 *     2021  345     32.4   37.6    1.08   0.962   trusted
 *     2022  356     37.6   36.7    0.97   0.990   trusted
 *     2023  361      5.8   36.6    1.64   0.469   REJECTED
 *     2024  362     37.4   38.9    1.01   0.991   trusted
 *     2025  364     41.6   41.2    0.98   0.992   trusted
 *     2026  365     48.1   44.1    0.92   0.993   trusted
 *
 * OUR OWN RAW NET RATING IS NOT A USABLE REFERENCE, and was tried first. 2024,
 * 2025 and 2026 correlate only ~0.82 with it, because opponent adjustment is
 * supposed to move teams a long way — a reference for an adjusted rating has to
 * be adjusted too. Against raw net, 2017 scores 0.945 and 2016 scores 0.880,
 * which is exactly backwards.
 *
 * 2015 AND 2019 ARE KEPT WITH A KNOWN FLAW. Both rank the season correctly
 * (r = 0.96) on a scale about 40% too narrow (slope 1.39 and 1.41). Anywhere the
 * value is z-scored inside its own season — BTA RTG averages these with Bart's
 * as a second opinion — the compression cancels out and they are fine. Plotted
 * raw on an axis they read low. That is a smaller lie than dropping two seasons
 * whose ordering is sound, and it is recorded here rather than left to be
 * rediscovered.
 *
 * THE REJECTION IS AT THE READ LAYER, NOT IN THE PIPELINE, and deliberately.
 * The check needs Bart and CBBD in the same hand; the script that writes these
 * columns has only CBBD, and Bart lives in Supabase. Filtering where the row is
 * read keeps the stored data faithful to what the vendor actually sent — the
 * file is evidence — while nothing downstream has to know that some of it is
 * unusable.
 */

/** Seasons whose CBBD adjusted ratings disagree with every other measure. */
const UNTRUSTED_SEASONS = new Set([2014, 2017, 2018, 2020, 2023]);

/** Can `ortg_adj` / `drtg_adj` / `net_rtg_adj` be believed for this season? */
export function trustsCbbdAdjusted(year: number | null | undefined): boolean {
  return year != null && !UNTRUSTED_SEASONS.has(year);
}

/** The value if the season is sound, null if it is not. */
export function cbbdAdjusted(year: number | null | undefined, v: number | null | undefined): number | null {
  return trustsCbbdAdjusted(year) && typeof v === "number" && Number.isFinite(v) ? v : null;
}
