import { cn } from "@/lib/utils";

/**
 * Site-wide percentile color ramp + chip component. Single source of truth
 * for every percentile-colored UI element (explorer table, player tables,
 * team dossier distribution panels, rank badges).
 *
 * SEVEN STEPS — seven discrete bands rather than a continuous sweep.
 *
 * The previous ramp interpolated hue 0→120 in HSL at a fixed 70% saturation.
 * Two things were wrong with that. HSL yellow is far lighter than HSL red or
 * green at the same nominal lightness, so the ramp spent its loudest, most
 * forward color on the middle of the distribution — average stats shouted over
 * good ones. And because neighbouring percentiles differed by a fraction of a
 * degree of hue, a 44th and a 60th were indistinguishable in practice.
 *
 * Banding fixes both. A percentile is already a rank, so a continuous fill was
 * claiming a precision it never had; the gauge carries the exact number. Each
 * band is far enough from its neighbours to read instantly, the middle band is
 * near-neutral paper so "average" recedes, and the ends stay light enough to
 * keep dark text — no switching to white type partway across the grid.
 *
 * Values were authored in OKLCH (perceptually even lightness — that's what
 * stops yellow outshining the ends) and are baked to sRGB here so nothing
 * depends on oklch() support or on gamut-clipping behaving identically across
 * engines. To retune, edit the OKLCH triples in the comment and re-bake.
 *
 * Measured on the shipped values: the band text clears 4.81–6.37 contrast on
 * its own fill and body ink clears 7.83–13.97, so every band passes AA.
 */

// Upper bound (exclusive) of each band, with its fill and its text color.
//   oklch(L C H):  .800/.128/27  .868/.092/44  .925/.050/70  .958/.014/95
//                  .925/.050/124 .868/.092/140 .800/.128/150
//   text is the same hue at L .400 (ends) / .455 (rest), C .125
const BANDS: Array<{ upto: number; bg: string; fg: string }> = [
  { upto: 14,  bg: "#ff9c91", fg: "#7d231f" },
  { upto: 29,  bg: "#ffc1a2", fg: "#8d3a0c" },
  { upto: 43,  bg: "#fce1c3", fg: "#814600" },
  { upto: 57,  bg: "#f4f1e7", fg: "#6d5400" },
  { upto: 71,  bg: "#dfecc8", fg: "#486100" },
  { upto: 86,  bg: "#b4e3a9", fg: "#2a661b" },
  { upto: 101, bg: "#7dd591", fg: "#00591e" },
];

function band(pct: number) {
  const v = Math.max(0, Math.min(100, pct));
  return BANDS.find((b) => v < b.upto) ?? BANDS[BANDS.length - 1]!;
}

export function pctColor(pct: number | null): string {
  if (pct === null) return "transparent";
  return band(pct).fg;
}

export function pctBg(pct: number | null): string {
  if (pct === null) return "transparent";
  return band(pct).bg;
}

/**
 * Compact percentile chip — small badge colored by percentile, matching the
 * Player Overview stat tiles. Default content is the percentile number itself;
 * pass `children` to show something else (e.g. `#{rank}`) with the same color.
 */
export function PercentileChip({
  pct,
  className,
  ariaLabel,
  children,
}: {
  pct: number | null;
  className?: string;
  ariaLabel?: string;
  children?: React.ReactNode;
}) {
  if (pct === null) return null;
  return (
    <span
      className={cn(
        "text-xs font-medium tabular inline-flex items-center justify-center min-w-7 px-1.5 py-0.5 rounded-none leading-none",
        className,
      )}
      style={{ color: pctColor(pct), background: pctBg(pct) }}
      aria-label={ariaLabel ?? `${pct}th percentile`}
    >
      {children ?? pct}
    </span>
  );
}
