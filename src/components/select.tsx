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
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <span className={cn("relative inline-block", className)}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        className="h-10 w-full pl-3 pr-8 rounded-md border border-ink/15 bg-white text-ink text-sm appearance-none capitalize shadow-sm hover:border-ink/25 focus:outline-none focus:ring-2 focus:ring-coral/40 focus:border-coral/40 transition-colors"
      >
        {children}
      </select>
      <span
        aria-hidden
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted text-[0.7rem]"
      >
        ▾
      </span>
    </span>
  );
}
