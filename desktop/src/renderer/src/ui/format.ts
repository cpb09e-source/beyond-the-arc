import type { RankedStat } from "@/lib/static-data";

const MINUS = "−";
const MISSING = "–";

/** "2025-26" from 2026, the form every season label on the site uses. */
export const seasonLabel = (y: number): string => `${y - 1}-${String(y).slice(2)}`;

export const num1 = (v: number | null): string => (v == null ? MISSING : v.toFixed(1));

/** Table cells: the header carries the %, so the cell does not repeat it. */
export const pct1 = (v: number | null): string => (v == null ? MISSING : (v * 100).toFixed(1));

/** A real minus sign, so negative values line up with positive ones in tabular figures. */
export const signed1 = (v: number | null): string =>
  v == null ? MISSING : `${v > 0 ? "+" : v < 0 ? MINUS : ""}${Math.abs(v).toFixed(1)}`;

/** A national-rank stat in the format the site's ranks declare for it. */
export function fmtRanked(s: Pick<RankedStat, "format" | "value">): string {
  switch (s.format) {
    case "pct1":
      return `${(s.value * 100).toFixed(1)}%`;
    case "num2":
      return s.value.toFixed(2);
    case "intDiff": {
      const v = Math.round(s.value);
      return `${v > 0 ? "+" : v < 0 ? MINUS : ""}${Math.abs(v)}`;
    }
    default:
      return s.value.toFixed(1);
  }
}
