"use client";

import { Children, isValidElement, useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { popoverStyle, usePopoverAnchor } from "@/components/explorer/use-popover-anchor";
import { cn } from "@/lib/utils";

/**
 * The site's dropdown.
 *
 * ── WHY IT IS NO LONGER A NATIVE <select> ─────────────────────────────────
 *
 * A native select's LIST is drawn by the operating system, not by the page.
 * On Windows that is a white panel with a system-blue highlight, which no CSS
 * on our side reaches — so on the dark theme every dropdown on the site opened
 * a bright rectangle that looked like it belonged to a different product. The
 * teammate picker hit this first and was rewritten; this is that fix applied
 * once, everywhere.
 *
 * The CONTROL keeps the exact styling it had. Only the panel changes.
 *
 * ── THE API IS UNCHANGED, DELIBERATELY ────────────────────────────────────
 *
 * It still takes <option> children, and it reads them rather than asking every
 * one of its ~15 call sites to pass an options array. That is not laziness: an
 * option's label here is sometimes an expression rather than a string —
 * `{s}{s === "Active" && ` (${activeCount})`}` — and a data API would have
 * flattened those to text or forced each caller to restate them. The children
 * are rendered as given, so anything that worked in an <option> still works.
 *
 * <optgroup> is supported for the one caller that has five sections of views.
 *
 * ── IT IS A LISTBOX, WHICH MEANS THE KEYBOARD IS OURS NOW ─────────────────
 *
 * A native select gets arrows, Home/End, Escape and type-ahead from the
 * browser. Replacing it means providing them; anything less is a regression
 * for a keyboard reader, and "it looks right" is not worth that trade.
 */

type Row = { value: string; label: ReactNode; title?: string; group?: string };

/** Flatten <option> and <optgroup> children into rows, in document order. */
function readOptions(children: ReactNode): Row[] {
  const rows: Row[] = [];
  const walk = (nodes: ReactNode, group?: string) => {
    for (const child of Children.toArray(nodes)) {
      if (!isValidElement(child)) continue;
      const props = child.props as { value?: string | number; title?: string; label?: string; children?: ReactNode };
      if (child.type === "optgroup") {
        walk(props.children, props.label);
      } else if (child.type === "option") {
        rows.push({ value: String(props.value ?? ""), label: props.children, title: props.title, group });
      }
    }
  };
  walk(children);
  return rows;
}

export function Select({
  value,
  onChange,
  children,
  className,
  ariaLabel,
  compact = false,
  disabled = false,
  align = "left",
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  className?: string;
  ariaLabel?: string;
  compact?: boolean;
  /** Greys the control and refuses to open it. Mirrors a native select's own. */
  disabled?: boolean;
  /**
   * Centre the value. For the comparator picker, whose whole label is one
   * glyph in a 56px box — left-aligned it reads as a stray character rather
   * than a chosen value.
   */
  align?: "left" | "center";
}) {
  const rows = useMemo(() => readOptions(children), [children]);
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(0, rows.findIndex((r) => r.value === value));
  const [active, setActive] = useState(selectedIndex);
  const listId = useId();

  const { anchorRef, popRef, at } = usePopoverAnchor({ open, width: "trigger" });

  const choose = useCallback((v: string) => {
    onChange(v);
    setOpen(false);
  }, [onChange]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      // Both refs — the panel is portalled out of the wrapper.
      if (anchorRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, anchorRef, popRef]);

  // Keep the highlighted row on screen when the list is longer than the panel.
  useEffect(() => {
    if (!open) return;
    popRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open, popRef]);

  /**
   * Contiguous runs of one optgroup, so its heading can stick.
   *
   * sticky is bounded by the element's own parent, so a heading rendered
   * inside a single option's <li> would have that one row's height to stick
   * within. The heading and its options have to share a box.
   */
  const sections = useMemo(() => {
    const out: Array<{ group: string | undefined; items: Array<{ r: Row; i: number }> }> = [];
    rows.forEach((r, i) => {
      const last = out[out.length - 1];
      if (last && last.group === r.group) last.items.push({ r, i });
      else out.push({ group: r.group, items: [{ r, i }] });
    });
    return out;
  }, [rows]);

  const current = rows.find((r) => r.value === value);

  return (
    <span className={cn("relative inline-block", className)}>
      <span ref={anchorRef} className="block">
        <button
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          aria-label={ariaLabel}
          disabled={disabled}
          onClick={() => { setOpen((o) => !o); setActive(selectedIndex); }}
          onKeyDown={(e) => {
            if (disabled) return;
            if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
              if (!open) { e.preventDefault(); setOpen(true); setActive(selectedIndex); return; }
            }
            if (!open) return;
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, rows.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
            if (e.key === "Home") { e.preventDefault(); setActive(0); }
            if (e.key === "End") { e.preventDefault(); setActive(rows.length - 1); }
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); const r = rows[active]; if (r) choose(r.value); }
            if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
          }}
          className={cn(
            // Unchanged from the native control it replaces, so nothing on the
            // page moves by a pixel. text-left because a button centres by
            // default and a select does not.
            "w-full rounded-md border border-ink/15 bg-card text-ink appearance-none capitalize shadow-sm hover:border-ink/25 focus:outline-none focus:ring-2 focus:ring-coral/40 focus:border-coral/40 transition-colors",
            // Compact selects carry short values in narrow boxes, so they get
            // their own padding. The shared pl-3/pr-8 spent 44px of a 64px
            // w-16 box on padding and clipped "100" to "10C" on the row-count
            // control. The caret moves in to match.
            compact ? "h-8 text-xs pl-2 pr-6" : "h-10 text-sm pl-3 pr-8",
            // text-left because a button centres by default and a select does not.
            align === "center" ? "text-center" : "text-left",
            disabled && "opacity-50 cursor-not-allowed",
            // A select clips its value; a button would wrap it and grow the row.
            "truncate whitespace-nowrap",
          )}
        >
          {current?.label ?? " "}
        </button>
      </span>
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-1/2 -translate-y-1/2 text-ink-muted text-[0.7rem]",
          compact ? "right-1.5" : "right-2.5",
        )}
      >
        ▾
      </span>

      {open && at && typeof document !== "undefined" && createPortal(
        <div
          ref={popRef}
          style={{ ...popoverStyle(at), width: undefined, minWidth: at.width }}
          className="z-60 overflow-y-auto rounded-lg border border-hairline bg-popover shadow-xl py-1"
        >
          <ul id={listId} role="listbox" aria-label={ariaLabel}>
            {sections.map((section) => (
              <li key={section.group ?? "all"}>
                {/* STICKY, and therefore OPAQUE — a see-through sticky header
                    lets the rows passing under it show through. The heading is
                    a sibling of its options inside this <li> rather than a row
                    of its own, which is both what lets it stick for the whole
                    section and what keeps an arrow key from ever landing on
                    it. */}
                {section.group && (
                  <div className="sticky top-0 z-10 bg-popover px-2.5 pt-2 pb-1 text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">
                    {section.group}
                  </div>
                )}
                {section.items.map(({ r, i }) => (
                <button
                  key={r.value}
                  type="button"
                  role="option"
                  aria-selected={r.value === value}
                  data-idx={i}
                  title={r.title}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(r.value)}
                  className={cn(
                    "w-full text-left px-2.5 py-1.5 capitalize transition-colors",
                    compact ? "text-xs" : "text-sm",
                    r.value === value ? "text-ink font-semibold" : "text-ink",
                    i === active ? "bg-ink/[0.06]" : "hover:bg-ink/[0.04]",
                  )}
                >
                  {r.label}
                </button>
                ))}
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )}
    </span>
  );
}
