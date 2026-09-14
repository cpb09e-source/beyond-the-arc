import { Check, ChevronDown, Minus } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { ALL_SEASONS, isFlaggedSeason, seasonFlagNote } from "@/lib/seasons";
import { seasonLabel } from "~/ui/format";

/**
 * The season control in every view header.
 *
 * A LISTBOX, NOT A NATIVE <select>. The native one opens a Windows-drawn menu
 * that ignores the app's theme and type, which is the single most "this is a
 * web page" moment a desktop app can have. This one is keyboard-complete:
 * ↑ ↓ move, Enter picks, Esc closes, and `[` / `]` step seasons from anywhere
 * without opening it at all.
 *
 * Its keys stop at the listbox, so arrowing through seasons never also moves
 * the table underneath.
 */
export function SeasonSwitcher({ year, onChange }: { year: number; onChange: (y: number) => void }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(year);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    setActive(year);
    requestAnimationFrame(() => listRef.current?.focus());
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open, year]);

  const choose = (y: number) => {
    onChange(y);
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Season, ${seasonLabel(year)}`}
        title="Season  ·  [ older  ·  ] newer"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-[26px] items-center gap-1.5 rounded-md border border-hairline bg-card px-2 text-[12.5px] font-medium text-ink tabular transition-colors hover:border-ink-muted"
      >
        {seasonLabel(year)}
        <ChevronDown size={14} className={`text-ink-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <ul
          ref={listRef}
          role="listbox"
          tabIndex={-1}
          aria-label="Season"
          aria-activedescendant={`${id}-${active}`}
          onKeyDown={(e) => {
            const i = ALL_SEASONS.indexOf(active);
            let handled = true;
            if (e.key === "ArrowDown") setActive(ALL_SEASONS[Math.min(ALL_SEASONS.length - 1, i + 1)] ?? active);
            else if (e.key === "ArrowUp") setActive(ALL_SEASONS[Math.max(0, i - 1)] ?? active);
            else if (e.key === "Enter" || e.key === " ") choose(active);
            else if (e.key === "Escape") setOpen(false);
            else handled = false;
            if (handled) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          className="menu-in absolute left-0 top-[calc(100%+6px)] z-30 w-[176px] rounded-lg border border-hairline bg-card p-1 outline-none"
          style={{ boxShadow: "var(--overlay-shadow)" }}
        >
          {ALL_SEASONS.map((y) => (
            <li
              key={y}
              id={`${id}-${y}`}
              role="option"
              aria-selected={y === year}
              onMouseEnter={() => setActive(y)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(y)}
              className={`flex h-[28px] cursor-default items-center justify-between rounded-md px-2 text-[12.5px] tabular ${
                y === active ? "bg-[var(--menu-active)] text-ink" : "text-ink-soft"
              }`}
            >
              <span className="flex items-center gap-2">
                <Check size={13} className={y === year ? "text-accent" : "invisible"} />
                {seasonLabel(y)}
              </span>
              {isFlaggedSeason(y) && (
                <span
                  className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-muted"
                  title={seasonFlagNote(y) ?? undefined}
                >
                  Covid
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The picker's words, as the site's explorers put them: "2025-26", "All seasons", "2022-23 → 2025-26", "4 seasons". */
export function seasonsLabel(years: readonly number[]): string {
  const ys = [...new Set(years)].sort((a, b) => a - b);
  if (ys.length === 1) return seasonLabel(ys[0]!);
  if (ys.length === ALL_SEASONS.length) return "All seasons";
  const consecutive = ys.every((y, i) => i === 0 || y === ys[i - 1]! + 1);
  return consecutive ? `${seasonLabel(ys[0]!)} → ${seasonLabel(ys[ys.length - 1]!)}` : `${ys.length} seasons`;
}

/**
 * The explorers' season control: one season, several, or every one, as the
 * site's Team and Player Explorers pick them.
 *
 * A ROW ADDS OR REMOVES ITS SEASON. "Only", on a row, keeps just that one, and so
 * does Enter; All and One season sit at the foot. Never empty: the last season
 * picked stays picked. Space toggles, ↑ ↓ move, Esc closes, and `[` / `]` still
 * step one season from anywhere.
 *
 * Each row of a table that spans seasons keeps its own season's percentiles, as
 * on the site: a 2015 team is ranked against 2015.
 */
export function SeasonsPicker({ years, onChange }: { years: readonly number[]; onChange: (years: number[]) => void }) {
  const [open, setOpen] = useState(false);
  const newest = [...years].sort((a, b) => b - a)[0] ?? ALL_SEASONS[0]!;
  const [active, setActive] = useState(newest);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const id = useId();
  const picked = new Set(years);

  useEffect(() => {
    if (!open) return;
    setActive(newest);
    requestAnimationFrame(() => listRef.current?.focus());
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
    // Opening reads where the selection starts; picking inside keeps the list where it is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (y: number) => {
    if (picked.has(y)) {
      if (years.length > 1) onChange(years.filter((x) => x !== y));
    } else {
      onChange([...years, y].sort((a, b) => b - a));
    }
  };
  const only = (y: number) => {
    onChange([y]);
    setOpen(false);
  };
  const label = seasonsLabel(years);
  const all = years.length === ALL_SEASONS.length;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Season, ${label}`}
        title="Seasons: one, several or all  ·  [ older  ·  ] newer"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex h-[26px] items-center gap-1.5 rounded-md border px-2 text-[12.5px] font-medium text-ink tabular transition-colors hover:border-ink-muted ${
          years.length > 1 ? "border-[color-mix(in_oklab,var(--accent)_45%,var(--hairline))] bg-[var(--accent-wash)]" : "border-hairline bg-card"
        }`}
      >
        {label}
        <ChevronDown size={14} className={`text-ink-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="menu-in absolute left-0 top-[calc(100%+6px)] z-30 w-[212px] rounded-lg border border-hairline bg-card p-1" style={{ boxShadow: "var(--overlay-shadow)" }}>
          <ul
            ref={listRef}
            role="listbox"
            tabIndex={-1}
            aria-label="Seasons"
            aria-multiselectable="true"
            aria-activedescendant={`${id}-${active}`}
            onKeyDown={(e) => {
              const i = ALL_SEASONS.indexOf(active);
              let handled = true;
              if (e.key === "ArrowDown") setActive(ALL_SEASONS[Math.min(ALL_SEASONS.length - 1, i + 1)] ?? active);
              else if (e.key === "ArrowUp") setActive(ALL_SEASONS[Math.max(0, i - 1)] ?? active);
              else if (e.key === " ") toggle(active);
              else if (e.key === "Enter") only(active);
              else if (e.key === "Escape") setOpen(false);
              else handled = false;
              if (handled) {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
            className="max-h-[360px] overflow-y-auto outline-none"
          >
            {ALL_SEASONS.map((y) => {
              const on = picked.has(y);
              return (
                <li
                  key={y}
                  id={`${id}-${y}`}
                  role="option"
                  aria-selected={on}
                  data-season={y}
                  onMouseEnter={() => setActive(y)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => toggle(y)}
                  className={`group flex h-[28px] cursor-default items-center gap-2 rounded-md px-2 text-[12.5px] tabular ${
                    y === active ? "bg-[var(--menu-active)] text-ink" : "text-ink-soft"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`grid size-[14px] shrink-0 place-items-center rounded-[4px] border transition-colors ${
                      on ? "border-accent bg-accent text-white" : "border-[color-mix(in_oklab,var(--ink-muted)_55%,transparent)]"
                    }`}
                  >
                    {on && <Check size={10} strokeWidth={3} />}
                  </span>
                  <span className="flex-1">{seasonLabel(y)}</span>
                  {isFlaggedSeason(y) && (
                    <span className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-muted" title={seasonFlagNote(y) ?? undefined}>
                      Covid
                    </span>
                  )}
                  <button
                    type="button"
                    tabIndex={-1}
                    data-only
                    title={`Only ${seasonLabel(y)}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                      e.stopPropagation();
                      only(y);
                    }}
                    className={`rounded px-1 text-[11px] text-ink-muted transition-opacity hover:text-ink ${y === active ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                  >
                    Only
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-1 flex items-center gap-1 border-t border-hairline px-1 pt-1">
            <button
              type="button"
              disabled={all}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onChange([...ALL_SEASONS].sort((a, b) => b - a))}
              className="h-[24px] rounded-md px-2 text-[12px] text-ink-soft transition-colors hover:bg-[var(--row-hover)] hover:text-ink disabled:opacity-40"
            >
              All
            </button>
            <button
              type="button"
              disabled={years.length === 1}
              title={`Only ${seasonLabel(newest)}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => only(newest)}
              className="inline-flex h-[24px] items-center gap-1 rounded-md px-2 text-[12px] text-ink-soft transition-colors hover:bg-[var(--row-hover)] hover:text-ink disabled:opacity-40"
            >
              <Minus size={12} strokeWidth={2} />
              One season
            </button>
            <span className="ml-auto pr-1 text-[11px] text-ink-muted tabular">{years.length === 1 ? "1 season" : `${years.length} seasons`}</span>
          </div>
        </div>
      )}
    </div>
  );
}
