"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Month calendar in the site's own styling.
 *
 * Replaces `<input type="date">`. The native control was the right first move —
 * free calendar, keyboard entry, OS picker on mobile — but it renders the
 * browser's chrome, which lands as a grey system panel in the middle of a page
 * that is otherwise entirely ours. This keeps the useful parts (click a day,
 * jump a month, "today") and drops the borrowed styling.
 *
 * Deliberately NOT a text field: every date on this page is reachable by
 * clicking, and a typed date is a parsing problem — 02/07 is February 7th to an
 * American reader and the 2nd of July to everyone else.
 */
export function DatePicker({ value, onChange }: { value: string; onChange: (d: string) => void }) {
  const [open, setOpen] = useState(false);
  // Which month the grid is showing — starts on the selected date's month and
  // moves independently, so browsing March doesn't change what's selected.
  const [cursor, setCursor] = useState(() => value.slice(0, 7));
  const wrapRef = useRef<HTMLDivElement>(null);

  // Re-anchor the grid when the selection changes from outside (week strip,
  // week arrows). This is React's sanctioned "adjust state during render"
  // pattern rather than an effect — an effect would paint the old month for a
  // frame first — and it tracks the previous value in state rather than a ref,
  // because reading a ref during render is exactly what it forbids.
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setCursor(value.slice(0, 7));
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const cells = monthCells(cursor);
  const today = todayET();

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="inline-flex items-center gap-2 h-9 px-3 rounded-md border border-ink/15 bg-card text-ink text-sm shadow-sm hover:border-ink/30 focus:outline-none focus:ring-2 focus:ring-coral/40 transition-colors"
      >
        <CalendarGlyph />
        <span className="tabular">{prettyDate(value)}</span>
        <svg viewBox="0 0 24 24" className={cn("w-3 h-3 text-ink-muted transition-transform", open && "rotate-180")} fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Choose a date"
          className="absolute right-0 z-50 mt-2 w-[19rem] rounded-xl border border-ink/10 bg-card shadow-xl ring-1 ring-ink/5 p-3"
        >
          <div className="flex items-center justify-between mb-2">
            <MonthNav label="Previous month" onClick={() => setCursor(shiftMonth(cursor, -1))}>‹</MonthNav>
            <span className="font-display text-lg text-ink leading-none">{monthLabel(cursor)}</span>
            <MonthNav label="Next month" onClick={() => setCursor(shiftMonth(cursor, 1))}>›</MonthNav>
          </div>

          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
              <span key={i} className="text-center text-[0.55rem] uppercase tracking-[0.1em] font-bold text-ink-muted py-1">{d}</span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((c, i) =>
              c === null ? (
                <span key={`e${i}`} />
              ) : (
                <button
                  key={c}
                  type="button"
                  onClick={() => { onChange(c); setOpen(false); }}
                  aria-current={c === value ? "date" : undefined}
                  className={cn(
                    "h-8 rounded-md text-sm tabular transition-colors",
                    c === value
                      ? "bg-coral text-white font-bold"
                      : c === today
                      ? "text-coral font-bold hover:bg-coral/10"
                      : "text-ink-soft hover:bg-paper-deep",
                  )}
                >
                  {Number(c.slice(8, 10))}
                </button>
              ),
            )}
          </div>

          <div className="mt-2.5 pt-2.5 border-t border-hairline flex justify-end">
            <button
              type="button"
              onClick={() => { onChange(today); setOpen(false); }}
              className="text-xs font-medium text-coral hover:underline"
            >
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MonthNav({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="w-8 h-8 rounded-md text-ink-muted hover:text-coral hover:bg-paper-deep transition-colors text-lg leading-none"
    >
      {children}
    </button>
  );
}

function CalendarGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-ink-muted" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" strokeLinecap="round" />
    </svg>
  );
}

// ---- date helpers, all UTC-noon anchored so DST can never shift a day ----

const ET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
function todayET(): string {
  return ET.format(new Date());
}

const MONTH = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" });
function monthLabel(ym: string): string {
  return MONTH.format(new Date(`${ym}-01T12:00:00Z`));
}

const PRETTY = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
function prettyDate(d: string): string {
  return PRETTY.format(new Date(`${d}T12:00:00Z`));
}

function shiftMonth(ym: string, by: number): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7)) - 1 + by;
  const d = new Date(Date.UTC(y, m, 1, 12));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Leading blanks then each day of the month, as ISO strings. */
function monthCells(ym: string): Array<string | null> {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7)) - 1;
  const first = new Date(Date.UTC(y, m, 1, 12));
  const days = new Date(Date.UTC(y, m + 1, 0, 12)).getUTCDate();
  const out: Array<string | null> = Array(first.getUTCDay()).fill(null);
  for (let d = 1; d <= days; d++) {
    out.push(`${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  return out;
}
