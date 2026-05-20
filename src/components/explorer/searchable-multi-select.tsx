"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { SearchableOption } from "./searchable-select";

/**
 * Multi-select variant of SearchableSelect. Same search + keyboard nav, but
 * each row is a checkbox-style toggle and the trigger summarizes selected
 * values as a chip count. Pressing Enter on the search input toggles the
 * currently-focused row. Empty value array displays as "All".
 */
export function SearchableMultiSelect({
  value,
  options,
  onChange,
  placeholder = "Search…",
  emptyLabel = "All",
  className,
  ariaLabel,
  disabledValues,
}: {
  /** Selected values. Empty array = "All". */
  value: string[];
  options: SearchableOption[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  emptyLabel?: string;
  className?: string;
  ariaLabel?: string;
  /** Values that can't be toggled (cross-filtered by another picker). They
   *  still render but are visually muted and non-interactive. */
  disabledValues?: Set<string>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

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
        (o.desc?.toLowerCase().includes(q) ?? false),
    );
  }, [options, query]);

  useEffect(() => {
    setActiveIdx((i) => Math.max(0, Math.min(i, filtered.length - 1)));
  }, [filtered.length]);

  function toggle(v: string) {
    if (disabledValues?.has(v)) return;
    if (value.includes(v)) onChange(value.filter((x) => x !== v));
    else onChange([...value, v]);
  }

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
      if (picked) toggle(picked.value);
      setQuery("");
    }
  }

  // Trigger label: empty → "All"; every option selected → also "All"
  // (it's the same constraint); 1 → that option's label; otherwise "N selected".
  let triggerLabel: string;
  if (value.length === 0 || (options.length > 0 && value.length === options.length)) {
    triggerLabel = emptyLabel;
  } else if (value.length === 1) {
    triggerLabel = options.find((o) => o.value === value[0])?.label ?? value[0]!;
  } else {
    triggerLabel = `${value.length} selected`;
  }

  return (
    <div ref={containerRef} className={cn("relative inline-block", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="h-10 min-w-44 px-3 pr-8 rounded-md border border-ink/15 bg-white text-ink text-sm text-left shadow-sm hover:border-ink/25 focus:outline-none focus:ring-2 focus:ring-coral/40 focus:border-coral/40 transition-colors relative"
      >
        <span className="truncate block">{triggerLabel}</span>
        <span aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted text-[0.7rem]">▾</span>
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
          <div className="max-h-72 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-sm text-ink-muted text-center">No matches</div>
            ) : (
              filtered.map((o, idx) => {
                const isActive = idx === activeIdx;
                const isSelected = value.includes(o.value);
                const isDisabled = disabledValues?.has(o.value) ?? false;
                return (
                  <label
                    key={o.value}
                    onMouseEnter={() => { if (!isDisabled) setActiveIdx(idx); }}
                    className={cn(
                      "flex items-center gap-3 px-3 py-1.5 text-sm",
                      isDisabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
                      isActive && !isDisabled && "bg-paper-deep",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={isDisabled}
                      onChange={() => toggle(o.value)}
                      className="accent-coral"
                    />
                    <span className={cn(isSelected && "font-medium text-coral")}>{o.label}</span>
                  </label>
                );
              })
            )}
          </div>
          <div className="border-t border-hairline p-2 flex flex-wrap gap-1.5 text-xs">
            <button
              type="button"
              onClick={() => onChange(options.map((o) => o.value))}
              className="px-2 py-1 rounded border border-hairline text-ink-soft hover:text-coral hover:border-coral/40 transition-colors"
            >
              All
            </button>
            <button
              type="button"
              onClick={() => onChange([])}
              className="px-2 py-1 rounded border border-hairline text-ink-soft hover:text-coral hover:border-coral/40 transition-colors"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
