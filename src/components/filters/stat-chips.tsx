"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { isBoundActive, roundNice, type RangeState } from "@/components/filters/range-row";

/**
 * Removable read-out of what a stat drawer has selected.
 *
 * The drawer knows what you picked; nothing outside it did. A reader who came
 * back to a bookmarked URL had a table full of extra columns and a "Filters 3"
 * badge, with no way to see WHICH three without opening the panel and hunting
 * for ticked boxes.
 *
 * Shared by /players and /teams because the strip is pure presentation over
 * `cols` + a RangeState — the only page-specific part is how a key resolves to
 * a short label, which the caller passes in.
 */

export type StatChip = {
  key: string;
  /** Grid-short label — "TS%", not "True Shooting %". The strip is tight. */
  label: string;
  /** "≥ 55", "12–24", or null when the stat is a column with no bounds. */
  detail: string | null;
};

function boundText(lo: number | null, hi: number | null): string | null {
  const n = (v: number) => String(roundNice(v));
  if (lo !== null && hi !== null) return `${n(lo)}–${n(hi)}`;
  if (lo !== null) return `≥ ${n(lo)}`;
  if (hi !== null) return `≤ ${n(hi)}`;
  return null;
}

/**
 * One chip per stat, never two: a stat that is both pinned and bounded reads as
 * a single chip carrying its range. Pinned columns come first in pick order,
 * then any stat bounded without being pinned — an old bookmark, or a
 * filter-only stat that can never become a column at all.
 *
 * `order` is the page's canonical stat list, used only to keep the trailing
 * bounded-but-unpinned chips in a stable order rather than URL order.
 */
export function buildStatChips(
  cols: readonly string[],
  ranges: RangeState,
  order: readonly string[],
  labelOf: (key: string) => string,
): StatChip[] {
  const out: StatChip[] = [];
  const seen = new Set<string>();
  const push = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    const b = ranges[key];
    out.push({ key, label: labelOf(key), detail: boundText(b?.lo ?? null, b?.hi ?? null) });
  };
  for (const k of cols) push(k);
  for (const k of order) if (isBoundActive(ranges[k])) push(k);
  return out;
}

/**
 * The chip row. `max` caps it so a reader with fourteen columns doesn't push
 * the toolbar into three lines; the remainder collapses into a "+N more" that
 * opens the filter panel, where the full set is always shown uncapped.
 */
export function StatChipStrip({
  chips,
  onRemove,
  max,
  onOverflow,
  ariaLabel,
  className,
}: {
  chips: StatChip[];
  onRemove: (key: string) => void;
  max?: number;
  onOverflow?: () => void;
  ariaLabel: string;
  className?: string;
}) {
  if (chips.length === 0) return null;
  const shown = max && chips.length > max ? chips.slice(0, max) : chips;
  const hidden = chips.length - shown.length;
  return (
    <ul aria-label={ariaLabel} className={cn("flex items-center flex-wrap gap-1.5 min-w-0", className)}>
      {shown.map((c) => (
        <li key={c.key}>
          {/* Bounded stats wear coral, plain columns stay neutral — the strip
              should distinguish "narrowed the field" from "added a column" at a
              glance, since only the first changes the row count. */}
          <span
            className={cn(
              "inline-flex items-center gap-1 h-6 pl-2 pr-1 rounded-full border text-[0.68rem] font-semibold whitespace-nowrap",
              c.detail
                ? "border-coral/40 bg-coral/8 text-coral"
                : "border-ink/15 bg-paper-deep text-ink-soft",
            )}
          >
            {c.label}
            {c.detail && <span className="font-normal tabular opacity-80">{c.detail}</span>}
            <button
              type="button"
              onClick={() => onRemove(c.key)}
              aria-label={c.detail ? `Remove ${c.label} filter` : `Remove ${c.label} column`}
              className="w-4 h-4 inline-flex items-center justify-center rounded-full hover:bg-ink/12 transition-colors"
            >
              <X size={11} strokeWidth={2.6} />
            </button>
          </span>
        </li>
      ))}
      {hidden > 0 && (
        <li>
          <button
            type="button"
            onClick={onOverflow}
            className="h-6 px-2 rounded-full border border-dashed border-ink/25 text-[0.68rem] font-semibold text-ink-muted hover:text-ink hover:border-ink/40 transition-colors"
          >
            +{hidden} more
          </button>
        </li>
      )}
    </ul>
  );
}
