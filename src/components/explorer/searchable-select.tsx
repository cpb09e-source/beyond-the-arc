"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { popoverStyle, usePopoverAnchor } from "@/components/explorer/use-popover-anchor";

export type SearchableOption = {
  value: string;
  label: string;
  group?: string;       // optional group key for section headers
  desc?: string;
};

/**
 * Grouped searchable single-select. Click → popover with inline search +
 * keyboard navigation. Use for the stat picker where the user wants to type
 * "diff" or "3p" instead of scrolling 50 options.
 */
export function SearchableSelect({
  value,
  options,
  groupLabels,
  onChange,
  placeholder = "Search…",
  className,
  ariaLabel,
}: {
  value: string;
  options: SearchableOption[];
  groupLabels?: Record<string, string>;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** Fixed and portalled, for the reason in use-popover-anchor. */
  const { anchorRef: containerRef, popRef, at } = usePopoverAnchor({ open, width: 288 });

  /**
   * Open, cleared, focused — in the handler, not in an effect.
   *
   * This was a useEffect on `open` that reset the query and the active index.
   * The reset is not a synchronisation with anything outside React; it is part
   * of what opening MEANS, and doing it in an effect made it a second render
   * pass after the popover had already painted with the old query in it.
   */
  const openMenu = useCallback(() => {
    setQuery("");
    setActiveIdx(0);
    setOpen(true);
    // Focus after the popover paints — the input does not exist until then.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  // Close on outside click / escape
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      // Both refs: the panel is portalled out of this wrapper.
      const t = e.target as Node;
      if (containerRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
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
  }, [open, containerRef, popRef]);

  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.toLowerCase();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q) ||
        (o.desc?.toLowerCase().includes(q) ?? false)
    );
  }, [options, query]);

  /**
   * The active row, clamped to the list that is actually on screen.
   *
   * DERIVED, not stored. Typing narrows `filtered`, and the old code chased
   * that with an effect that re-set the index — one render showing an index
   * past the end of the list, then another to fix it. The clamp is a function
   * of two things we already have, so it is computed rather than remembered:
   * `activeIdx` stays the reader's intent, `activeSafe` is what the list uses.
   */
  const activeSafe = Math.max(0, Math.min(activeIdx, filtered.length - 1));

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const picked = filtered[activeSafe];
      if (picked) {
        onChange(picked.value);
        setOpen(false);
      }
    }
  }

  const currentLabel = options.find((o) => o.value === value)?.label ?? value;

  // Group filtered options for display
  const grouped: Array<{ group: string | undefined; items: SearchableOption[] }> = [];
  for (const opt of filtered) {
    const last = grouped[grouped.length - 1];
    if (last && last.group === opt.group) last.items.push(opt);
    else grouped.push({ group: opt.group, items: [opt] });
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        ref={buttonRef}
        onClick={() => (open ? setOpen(false) : openMenu())}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="h-9 w-full min-w-40 px-2 rounded border border-hairline bg-card text-ink text-sm text-left flex items-center justify-between gap-2 focus:outline-none focus:ring-2 focus:ring-coral/40"
      >
        <span className="truncate">{currentLabel}</span>
        <span aria-hidden className="text-ink-muted text-xs">▾</span>
      </button>

      {open && at && typeof document !== "undefined" && createPortal(
        <div
          ref={popRef}
          className="z-60 flex flex-col bg-card border border-hairline rounded-lg shadow-lg overflow-hidden"
          style={popoverStyle(at)}
          role="listbox"
        >
          <div className="p-2 border-b border-hairline">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              className="w-full h-8 px-2 text-sm rounded border border-hairline bg-paper text-ink focus:outline-none focus:ring-2 focus:ring-coral/40"
            />
          </div>
          <div ref={listRef} className="flex-1 min-h-0 max-h-72 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-sm text-ink-muted text-center">No matches</div>
            ) : (
              grouped.map((g, gi) => (
                <div key={`${g.group ?? ""}-${gi}`}>
                  {g.group && groupLabels?.[g.group] && (
                    <div className="px-3 pt-2 pb-1 text-[0.65rem] uppercase tracking-widest text-coral font-medium">
                      {groupLabels[g.group]}
                    </div>
                  )}
                  {g.items.map((o) => {
                    const idx = filtered.indexOf(o);
                    const isActive = idx === activeSafe;
                    const isSelected = o.value === value;
                    return (
                      <button
                        key={o.value}
                        type="button"
                        onMouseEnter={() => setActiveIdx(idx)}
                        onClick={() => {
                          onChange(o.value);
                          setOpen(false);
                        }}
                        className={cn(
                          "w-full text-left px-3 py-1.5 text-sm flex items-center justify-between gap-2",
                          isActive && "bg-paper-deep",
                          isSelected && "text-coral font-medium"
                        )}
                      >
                        <span>{o.label}</span>
                        {isSelected && <span aria-hidden className="text-coral text-xs">✓</span>}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
