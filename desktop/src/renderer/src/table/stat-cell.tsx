import { PercentileChip } from "@/components/percentile-chip";

/**
 * A number over its percentile chip, the cell every stat column uses.
 *
 * The chip is the site's own component. The percentile comes from wherever the
 * site computes it for that table, so a color here can never disagree with the
 * same cell on the site. A missing percentile draws no chip rather than a gray
 * one, which is how the site says "this number is not a judgment".
 *
 * `neutral` is for stats with no good direction (tempo, pace): the chip still
 * says how unusual a value is, painted in the ramp's middle band.
 */
export function StatCell({
  value,
  pct,
  strong = false,
  neutral = false,
}: {
  value: string;
  pct?: number | null;
  strong?: boolean;
  neutral?: boolean;
}) {
  return (
    <span className="inline-flex flex-col items-end gap-[3px] leading-none">
      <span className={strong ? "font-semibold text-ink tabular" : "text-ink-soft tabular"}>{value}</span>
      <PercentileChip pct={pct ?? null} neutral={neutral} className="min-w-[26px] px-1 py-[2px] text-[10.5px]" />
    </span>
  );
}
