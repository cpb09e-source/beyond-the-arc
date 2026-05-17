"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ALL_YEARS } from "@/lib/team-filters";

const YEAR_LABEL: Record<number, string> = {
  2026: "2025-26",
  2025: "2024-25",
  2024: "2023-24",
  2023: "2022-23",
  2022: "2021-22",
  2021: "2020-21",
  2020: "2019-20",
  2019: "2018-19",
  2018: "2017-18",
  2017: "2016-17",
  2016: "2015-16",
  2015: "2014-15",
  2014: "2013-14",
  2013: "2012-13",
};

/**
 * Multi-select popover for season years. Supports both discrete picks
 * (2020 + 2022 + 2024) and contiguous ranges (2022→2025) via "Select range".
 */
export function MultiYearSelect({
  years,
  onChange,
  className,
}: {
  years: number[];
  onChange: (years: number[]) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle(year: number) {
    const has = years.includes(year);
    const next = has ? years.filter((y) => y !== year) : [...years, year];
    // never allow empty — keep at least the current season selected
    onChange(next.length === 0 ? [2026] : next.sort((a, b) => b - a));
  }

  function selectAll() {
    onChange([...ALL_YEARS]);
  }

  // Button label: compact for many years, explicit for a few
  let buttonLabel: string;
  if (years.length === 0) buttonLabel = "—";
  else if (years.length === 1) buttonLabel = YEAR_LABEL[years[0]!];
  else if (years.length === ALL_YEARS.length) buttonLabel = "All seasons";
  else if (isContiguousRange(years)) {
    const sorted = [...years].sort((a, b) => a - b);
    buttonLabel = `${YEAR_LABEL[sorted[0]!]} → ${YEAR_LABEL[sorted[sorted.length - 1]!]}`;
  } else buttonLabel = `${years.length} seasons`;

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="h-9 min-w-44 px-2 rounded border border-hairline bg-white text-ink text-sm text-left flex items-center justify-between gap-2 focus:outline-none focus:ring-2 focus:ring-coral/40"
      >
        <span className="truncate">{buttonLabel}</span>
        <span aria-hidden className="text-ink-muted text-xs">▾</span>
      </button>

      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 w-60 bg-white border border-hairline rounded-lg shadow-lg overflow-hidden">
          <div className="px-3 pt-2 pb-1 text-[0.65rem] uppercase tracking-widest text-coral font-medium">
            Seasons (pick any combination)
          </div>
          <div className="py-1">
            {ALL_YEARS.map((y) => {
              const checked = years.includes(y);
              return (
                <label
                  key={y}
                  className="flex items-center gap-3 px-3 py-1.5 text-sm cursor-pointer hover:bg-paper-deep"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(y)}
                    className="accent-coral"
                  />
                  <span>{YEAR_LABEL[y]}</span>
                  {checked && <span aria-hidden className="ml-auto text-coral text-xs">✓</span>}
                </label>
              );
            })}
          </div>
          <div className="border-t border-hairline p-2 flex flex-wrap gap-1.5 text-xs">
            <Chip onClick={selectAll}>All</Chip>
          </div>
        </div>
      )}
    </div>
  );
}

function Chip({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-2 py-1 rounded border border-hairline text-ink-soft hover:text-coral hover:border-coral/40 transition-colors"
    >
      {children}
    </button>
  );
}

function isContiguousRange(ys: number[]): boolean {
  if (ys.length < 2) return false;
  const sorted = [...ys].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]! - sorted[i - 1]! !== 1) return false;
  }
  return true;
}
