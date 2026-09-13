import { Check, ChevronDown } from "lucide-react";
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
