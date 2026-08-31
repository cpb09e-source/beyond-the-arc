"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { popoverStyle, usePopoverAnchor } from "@/components/explorer/use-popover-anchor";
import { ALL_YEARS } from "@/lib/team-filters";
import { PREVIEW_SEASON } from "@/lib/seasons";
import { seasonLabel } from "@/lib/league-averages";

/**
 * Season labels come from seasonLabel(), not a hand-kept map.
 *
 * There was a literal Record<number, string> here listing every year. It went
 * stale the moment the preview season was added — 2027 had no entry, so the
 * picker button rendered blank and the option had no text. A label that is a
 * pure function of the year should never have been a table.
 *
 * The preview season is marked, because a reader who picks it is going to see a
 * table of dashes and deserves to know that before clicking rather than after.
 */
function labelFor(y: number): string {
  return y === PREVIEW_SEASON ? `${seasonLabel(y)} (preview)` : seasonLabel(y);
}

/**
 * Multi-select popover for season years. Supports both discrete picks
 * (2020 + 2022 + 2024) and contiguous ranges (2022→2025) via "Select range".
 */
export function MultiYearSelect({
  years,
  onChange,
  className,
  availableYears,
  disabledYears,
  lockedNotice,
}: {
  years: number[];
  onChange: (years: number[]) => void;
  className?: string;
  /** When provided, only these years render in the popover. Use for
   *  coach-scoped pickers where most of ALL_YEARS would be irrelevant. */
  availableYears?: number[];
  /** Currently-disabled subset (e.g. cross-filtered by another picker).
   *  Disabled options render but can't be toggled on. */
  disabledYears?: Set<number>;
  /**
   * Shown inside the popover after the reader's FIRST change, once per
   * opening. Pass null for readers it does not apply to.
   *
   * WHY THE PICKER OWNS THE TIMING AND THE CALLER OWNS THE WORDS. "Once per
   * opening" is a fact about this popover — it needs the open state, which
   * only lives here. Whether the reader is limited at all is a fact about the
   * reader, which this component has no business knowing. Splitting it that
   * way also keeps the message reusable: the coach picker will want the same
   * behaviour with different words.
   *
   * ONCE, NOT EVERY CLICK. A reader working through a list of thirteen
   * seasons does not need telling thirteen times, and a notice that reappears
   * on every tick reads as an error rather than as an offer.
   */
  lockedNotice?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  /** Whether the notice has been shown during THIS opening. */
  const [noticed, setNoticed] = useState(false);
  /**
   * The panel is fixed and portalled, because the toolbar this sits in is
   * inside a card with `overflow-hidden` — see use-popover-anchor. As an
   * absolutely-positioned child it was cropped at the card's bottom edge, so
   * on a table filtered down to a few rows the season list lost everything
   * below about the fifth season.
   */
  const { anchorRef: containerRef, popRef, at } = usePopoverAnchor({ open, width: 240 });
  /**
   * Every open and every close resets it, so the next visit says it again.
   *
   * Done in the handlers rather than an effect on `open`: each of these is a
   * deliberate act that already has a handler, and reacting to state this
   * component just set is the cascading-render pattern React now flags.
   */
  const setOpenReset = (v: boolean | ((o: boolean) => boolean)) => {
    setOpen(v);
    setNoticed(false);
  };
  /** Called by every control that changes the selection. */
  const flagNotice = () => { if (lockedNotice) setNoticed(true); };

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      // BOTH refs. The panel is portalled to the body, so it is not a
      // descendant of the wrapper any more and a wrapper-only test reads
      // every click on a season as a click outside the picker — which closed
      // it on the first tick of the first checkbox.
      if (containerRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false); setNoticed(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { setOpen(false); setNoticed(false); }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, containerRef, popRef]);

  function toggle(year: number) {
    flagNotice();
    const has = years.includes(year);
    const next = has ? years.filter((y) => y !== year) : [...years, year];
    // never allow empty — keep at least the current season selected
    onChange(next.length === 0 ? [2026] : next.sort((a, b) => b - a));
  }

  function selectAll() {
    flagNotice();
    onChange([...ALL_YEARS]);
  }
  // Counterpart to "All" — collapses the selection back to a single season
  // (the most recent year). We never allow truly empty since downstream
  // consumers all expect at least one selection.
  function clearAll() {
    flagNotice();
    onChange([Math.max(...ALL_YEARS)]);
  }

  // Button label: compact for many years, explicit for a few
  let buttonLabel: string;
  if (years.length === 0) buttonLabel = "—";
  else if (years.length === 1) buttonLabel = labelFor(years[0]!);
  else if (years.length === ALL_YEARS.length) buttonLabel = "All seasons";
  else if (isContiguousRange(years)) {
    const sorted = [...years].sort((a, b) => a - b);
    buttonLabel = `${labelFor(sorted[0]!)} → ${labelFor(sorted[sorted.length - 1]!)}`;
  } else buttonLabel = `${years.length} seasons`;

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpenReset((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        // Matches the global Select + SearchableMultiSelect chrome so all
        // three controls line up at the same height across the site.
        // w-full lets the parent control sizing (grid cell, flex item, etc.)
        // so this button shrinks/stretches like its siblings.
        className="h-10 w-full px-3 pr-8 rounded-md border border-ink/15 bg-card text-ink text-sm text-left shadow-sm hover:border-ink/25 focus:outline-none focus:ring-2 focus:ring-coral/40 focus:border-coral/40 transition-colors relative"
      >
        <span className="truncate block">{buttonLabel}</span>
        <span aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted text-[0.7rem]">▾</span>
      </button>

      {open && at && typeof document !== "undefined" && createPortal(
        <div
          ref={popRef}
          style={popoverStyle(at)}
          // overflow-y-auto, not overflow-hidden: the anchor hands back the
          // real gap to the viewport edge as maxHeight, and thirteen seasons
          // do not always fit in it.
          className="z-60 bg-card border border-hairline rounded-lg shadow-lg overflow-y-auto overflow-x-hidden"
        >
          <div className="px-3 pt-2 pb-1 text-[0.65rem] uppercase tracking-widest text-coral font-medium">
            Seasons
          </div>
          <div className="py-1">
            {(availableYears ?? ALL_YEARS).map((y) => {
              const checked = years.includes(y);
              const isDisabled = disabledYears?.has(y) ?? false;
              return (
                <label
                  key={y}
                  className={cn(
                    "flex items-center gap-3 px-3 py-1.5 text-sm",
                    isDisabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:bg-paper-deep",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={isDisabled}
                    onChange={() => { if (!isDisabled) toggle(y); }}
                    className="accent-coral"
                  />
                  <span>{labelFor(y)}</span>
                  {checked && <span aria-hidden className="ml-auto text-coral text-xs">✓</span>}
                </label>
              );
            })}
          </div>
          {/* Under the list and above the chips — the reader's eye is already
              in the list, and this is the answer to what just happened
              there. */}
          {noticed && lockedNotice && (
            <div className="border-t border-coral/25 bg-coral/[0.07] px-3 py-2 text-xs leading-snug text-ink-soft">
              {lockedNotice}
            </div>
          )}
          <div className="border-t border-hairline p-2 flex flex-wrap gap-1.5 text-xs">
            <Chip onClick={selectAll}>All</Chip>
            <Chip onClick={clearAll}>Clear</Chip>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

function Chip({
  onClick,
  children,
  className,
}: {
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-2 py-1 rounded border border-hairline text-ink-soft hover:text-coral hover:border-coral/40 transition-colors",
        className,
      )}
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
