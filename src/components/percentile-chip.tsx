import { cn } from "@/lib/utils";

/**
 * Site-wide percentile color ramp + chip component. Single source of truth
 * for every percentile-colored UI element (explorer table, player tables,
 * team dossier distribution panels, rank badges).
 *
 * Ramp: 0=red → 120=green hue, 70% saturation. Background lightness pushes
 * to a noticeably tinted shade at the extremes (<25 / >75) and stays near-
 * neutral in the middle so mid-cohort values read past easily. Text lightness
 * goes darker at the extremes to lift them out of the muddy middle.
 */

export function pctColor(pct: number | null): string {
  if (pct === null) return "transparent";
  const hue = (pct / 100) * 120;
  const lightness = pct < 30 || pct > 70 ? 26 : 32;
  return `hsl(${hue}, 70%, ${lightness}%)`;
}

export function pctBg(pct: number | null): string {
  if (pct === null) return "transparent";
  const hue = (pct / 100) * 120;
  const lightness = pct < 25 ? 84 : pct > 75 ? 84 : 90;
  return `hsl(${hue}, 70%, ${lightness}%)`;
}

/**
 * Compact percentile chip — small square badge colored by percentile.
 * Default content is the percentile number itself; pass `children` to show
 * something else (e.g. `#{rank}`) while keeping the same color treatment.
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
        "text-xs font-medium tabular inline-flex items-center justify-center min-w-7 px-1.5 py-1 rounded-none leading-none",
        className,
      )}
      style={{ color: pctColor(pct), background: pctBg(pct) }}
      aria-label={ariaLabel ?? `${pct}th percentile`}
    >
      {children ?? pct}
    </span>
  );
}
