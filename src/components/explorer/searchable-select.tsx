"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

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
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset search when reopening
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
      // focus the search input after the popover paints
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Close on outside click / escape
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

  // Re-clamp active index whenever filter shrinks
  useEffect(() => {
    setActiveIdx((i) => Math.max(0, Math.min(i, filtered.length - 1)));
  }, [filtered.length]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const picked = filtered[activeIdx];
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
        onClick={() => setOpen((o) => !o)}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="h-9 w-full min-w-40 px-2 rounded border border-hairline bg-white text-ink text-sm text-left flex items-center justify-between gap-2 focus:outline-none focus:ring-2 focus:ring-coral/40"
      >
        <span className="truncate">{currentLabel}</span>
        <span aria-hidden className="text-ink-muted text-xs">▾</span>
      </button>

      {open && (
        <div
          className="absolute z-50 top-full left-0 mt-1 w-72 max-w-[calc(100vw-2rem)] bg-white border border-hairline rounded-lg shadow-lg overflow-hidden"
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
          <div ref={listRef} className="max-h-72 overflow-y-auto py-1">
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
                    const isActive = idx === activeIdx;
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
        </div>
      )}
    </div>
  );
}
