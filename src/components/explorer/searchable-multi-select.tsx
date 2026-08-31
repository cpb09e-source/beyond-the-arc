"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { popoverStyle, usePopoverAnchor } from "@/components/explorer/use-popover-anchor";
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
  groupLabels,
  align = "left",
  inlineSearch = false,
  renderIcon,
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
  /** Maps option.group → section header label. Sections render in the order
   *  groups first appear in `options`, so sort `options` accordingly before
   *  passing in. */
  groupLabels?: Record<string, string>;
  /** Which edge of the trigger to anchor the popover to. Default "left" matches
   *  the existing behavior. Use "right" for triggers placed near the right edge
   *  of a narrow viewport (e.g. mobile grid right column) to keep the 288px
   *  popover from overflowing. */
  align?: "left" | "right";
  /**
   * Type in the TRIGGER instead of in a search box inside the popover.
   *
   * Opt-in, because the default two-part shape is right for the explorer's
   * filter bar, where a trigger has to keep showing which conferences are
   * selected while the list is open. It is wrong for a picker that IS the
   * question being asked: there, the field you clicked and the field you type
   * into being different boxes reads as two controls stacked by accident.
   *
   * The popover also drops to the trigger's own width in this mode and skips
   * the viewport-shift measurement, since a full-width trigger cannot overflow
   * the way a 240px panel hanging off a narrow control can.
   */
  inlineSearch?: boolean;
  /**
   * An icon for each row, and for the trigger when one option is chosen.
   *
   * A prop rather than a field on the option, because the option lists are
   * built in useMemo over hundreds of teams and constructing three hundred
   * crests to render six of them is work thrown away on every keystroke. This
   * runs per RENDERED row.
   */
  renderIcon?: (opt: SearchableOption) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /**
   * Fixed and portalled — see use-popover-anchor for why the card's
   * overflow-hidden makes that necessary. This replaces a `shiftX` that
   * nudged the panel left when it would bleed off a narrow viewport: the
   * anchor clamps to both edges, so the nudge is now part of the placement
   * rather than a transform applied after it, and the same measurement also
   * bounds the panel's height instead of letting a 360-team list run past the
   * bottom of the screen.
   *
   * The inline mode matches the trigger's width, which is what `w-full` meant
   * when the panel was still a child of it.
   */
  const { anchorRef: containerRef, popRef, at } = usePopoverAnchor({
    open,
    width: inlineSearch ? "trigger" : 240,
    align,
  });
  // Ties the inline combobox to the list it controls. useId so two pickers on
  // one page never collide.
  const listboxId = useId();

  /**
   * Open, cleared, focused — in the handler rather than in an effect on
   * `open`. Clearing the query is part of what opening means, not a
   * synchronisation with anything outside React, and as an effect it cost a
   * second render after the popover had already painted the old query.
   */
  const openMenu = useCallback(() => {
    setQuery("");
    setActiveIdx(0);
    setOpen(true);
    // The input does not exist until the popover paints.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      // Both refs — the panel is portalled, so it is no longer inside the
      // wrapper and a wrapper-only test closes the menu on its own options.
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
        (o.desc?.toLowerCase().includes(q) ?? false),
    );
  }, [options, query]);

  /**
   * The active row, clamped to the list actually on screen — DERIVED, not
   * stored. Typing narrows `filtered`, and chasing that with an effect meant
   * one render with an index past the end of the list and another to correct
   * it. `activeIdx` stays the reader's intent; `activeSafe` is what the list
   * and the keyboard handler use.
   */
  const activeSafe = Math.max(0, Math.min(activeIdx, filtered.length - 1));

  /**
   * Keep the highlighted row on screen.
   *
   * The list scrolls at 18rem and the arrow keys move a highlight, not the
   * scroll position — so past the sixth row the keyboard was moving something
   * the reader could no longer see. `block: "nearest"` scrolls only when the
   * row is actually out of view, which is what stops every keypress from
   * re-centring a list that was already fine.
   */
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector(`[data-opt-idx="${activeSafe}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, activeSafe]);

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
      const picked = filtered[activeSafe];
      if (picked) toggle(picked.value);
      setQuery("");
      setActiveIdx(0);
      // Enter closes the dropdown in the default shape: type → arrow → enter →
      // done, which is what a filter you set once wants.
      //
      // It stays OPEN in inlineSearch mode, with the caret still in the field.
      // That picker is a list you build — two or three players on the court,
      // one off it — and closing after each pick meant reopening between every
      // name, losing the typing position each time. Escape and clicking away
      // both still close it.
      if (!inlineSearch) setOpen(false);
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

  /** The one selected option, when there is exactly one. */
  const soleOption = value.length === 1 ? options.find((o) => o.value === value[0]) : undefined;

  const FIELD =
    "h-10 w-full px-3 pr-8 rounded-md border text-ink text-sm text-left shadow-sm focus:outline-none focus:ring-2 focus:ring-coral/40 focus:border-coral/40 transition-colors relative";

  return (
    <div ref={containerRef} className={cn("relative", inlineSearch ? "block w-full" : "inline-block", className)}>
      {inlineSearch && open ? (
        // The trigger becomes the search field in place, keeping its box, its
        // height and its position so nothing moves when it is clicked. The
        // caret lands where the label was.
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label={ariaLabel}
          // A text input that owns a popup list is a combobox, and the role has
          // to be explicit: without it the implicit role is textbox, which does
          // not support aria-expanded, so assistive tech is told the field is
          // expandable by an attribute it will ignore.
          role="combobox"
          aria-expanded={true}
          aria-controls={listboxId}
          aria-activedescendant={filtered.length ? `${listboxId}-opt-${activeSafe}` : undefined}
          aria-autocomplete="list"
          className={cn(FIELD, "bg-card border-coral/40")}
        />
      ) : (
        <button
          type="button"
          onClick={() => (open ? setOpen(false) : openMenu())}
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cn(FIELD, "bg-card border-ink/15 hover:border-ink/25")}
        >
          {/* The crest rides along on a single pick — the one case where the
              trigger is naming a specific team rather than a count. */}
          {renderIcon && value.length === 1 && soleOption ? (
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="shrink-0 flex items-center">{renderIcon(soleOption)}</span>
              <span className="truncate">{triggerLabel}</span>
            </span>
          ) : (
            <span className="truncate block">{triggerLabel}</span>
          )}
          <span aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted text-[0.7rem]">▾</span>
        </button>
      )}

      {open && at && typeof document !== "undefined" && createPortal(
        <div
          ref={popRef}
          className="z-60 flex flex-col bg-card border border-hairline rounded-lg shadow-lg overflow-hidden"
          id={listboxId}
          style={popoverStyle(at)}
          role="listbox"
        >
          {!inlineSearch && (
            <div className="p-2 border-b border-hairline">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={placeholder}
                role="combobox"
                aria-expanded={true}
                aria-controls={listboxId}
                aria-activedescendant={filtered.length ? `${listboxId}-opt-${activeSafe}` : undefined}
                aria-autocomplete="list"
                className="w-full h-8 px-2 text-sm rounded border border-hairline bg-paper text-ink focus:outline-none focus:ring-2 focus:ring-coral/40"
              />
            </div>
          )}
          <div ref={listRef} className="flex-1 min-h-0 max-h-72 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-sm text-ink-muted text-center">No matches</div>
            ) : (
              (() => {
                // Bucket filtered options into adjacency-run groups so each
                // section's header renders once. activeIdx is a flat index into
                // `filtered`, so we recompute it per row.
                const groups: Array<{ group: string | undefined; items: SearchableOption[] }> = [];
                for (const opt of filtered) {
                  const last = groups[groups.length - 1];
                  if (last && last.group === opt.group) last.items.push(opt);
                  else groups.push({ group: opt.group, items: [opt] });
                }
                return groups.map((g, gi) => (
                  <div key={`${g.group ?? ""}-${gi}`}>
                    {g.group && groupLabels?.[g.group] && (
                      <div className="px-3 pt-2 pb-1 text-[0.65rem] uppercase tracking-widest text-coral font-medium">
                        {groupLabels[g.group]}
                      </div>
                    )}
                    {g.items.map((o) => {
                      const idx = filtered.indexOf(o);
                      const isActive = idx === activeSafe;
                      const isSelected = value.includes(o.value);
                      const isDisabled = disabledValues?.has(o.value) ?? false;
                      return (
                        <label
                          key={o.value}
                          id={`${listboxId}-opt-${idx}`}
                          data-opt-idx={idx}
                          onMouseEnter={() => { if (!isDisabled) setActiveIdx(idx); }}
                          className={cn(
                            "flex items-center gap-2.5 px-3 py-1.5 text-sm",
                            isDisabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
                            // THE HIGHLIGHT HAS TO SURVIVE DARK MODE. It was
                            // bg-paper-deep, which is a hair off the card on a
                            // dark ground — so the arrow keys moved something
                            // invisible and the list looked like it had no
                            // keyboard support at all. A coral wash plus an
                            // inset rail reads on both grounds.
                            isActive && !isDisabled &&
                              "bg-[color-mix(in_oklab,var(--coral)_14%,var(--card))] shadow-[inset_2px_0_0_var(--coral)]",
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={isDisabled}
                            onChange={() => toggle(o.value)}
                            className="accent-coral shrink-0"
                          />
                          {renderIcon && <span className="shrink-0 flex items-center">{renderIcon(o)}</span>}
                          <span className={cn("truncate", isSelected && "font-medium text-coral")}>{o.label}</span>
                        </label>
                      );
                    })}
                  </div>
                ));
              })()
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
        </div>,
        document.body,
      )}
    </div>
  );
}
