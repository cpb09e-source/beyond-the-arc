"use client";

import { cn } from "@/lib/utils";

/**
 * Shared dropdown used across the site. Wraps a native `<select>` so the
 * value and options are accessible & keyboard-navigable, with paper-card
 * styling, a chevron caret on the right (matches MultiYearSelect /
 * SearchableSelect), and `capitalize` so the displayed value never starts
 * with a lowercase letter.
 */
export function Select({
  value,
  onChange,
  children,
  className,
  ariaLabel,
  compact = false,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  className?: string;
  ariaLabel?: string;
  compact?: boolean;
}) {
  return (
    <span className={cn("relative inline-block", className)}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        className={cn(
          "w-full rounded-md border border-ink/15 bg-card text-ink appearance-none capitalize shadow-sm hover:border-ink/25 focus:outline-none focus:ring-2 focus:ring-coral/40 focus:border-coral/40 transition-colors",
          // Compact selects carry short values in narrow boxes, so they get
          // their own padding. The shared pl-3/pr-8 spent 44px of a 64px
          // w-16 box on padding and clipped "100" to "10C" on the row-count
          // control. The caret moves in to match — reducing the right padding
          // alone would have run the text under it.
          compact ? "h-8 text-xs pl-2 pr-6" : "h-10 text-sm pl-3 pr-8",
        )}
      >
        {children}
      </select>
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-1/2 -translate-y-1/2 text-ink-muted text-[0.7rem]",
          compact ? "right-1.5" : "right-2.5",
        )}
      >
        ▾
      </span>
    </span>
  );
}
