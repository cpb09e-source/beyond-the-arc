import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { dayNum, monthCells, monthLabel, shiftDay, shiftMonth, todayEastern } from "@/lib/scoreboard-core";
import { Popover } from "~/ui/popover";
import { ListFooterButton } from "~/ui/search-list";
import { isKnownDay, latestDay, nextSeasonOpener } from "./board-model";

/**
 * A month of days to jump to, the days with games in ink and the rest receding.
 *
 * THE KEYBOARD OF A CALENDAR. Arrows move a day or a week, Page Up and Page
 * Down a month, Enter takes the day under the cursor, Esc closes. A day with no
 * games cannot be taken; there is nothing there to see.
 */

const WEEK = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function daysIn(ym: string): number {
  return new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
}

export function DayPicker({
  anchor,
  value,
  onPick,
  onClose,
}: {
  anchor: { readonly current: HTMLElement | null };
  value: string;
  onPick: (day: string) => void;
  onClose: () => void;
}) {
  const [cursor, setCursor] = useState(value);
  const gridRef = useRef<HTMLDivElement>(null);
  const ym = cursor.slice(0, 7);
  const today = todayEastern();
  const opener = nextSeasonOpener();

  useEffect(() => {
    gridRef.current?.focus({ preventScroll: true });
  }, []);

  const month = (by: number) =>
    setCursor((c) => {
      const next = shiftMonth(c.slice(0, 7), by);
      const day = Math.min(Number(c.slice(8, 10)), daysIn(next));
      return `${next}-${String(day).padStart(2, "0")}`;
    });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.key === "ArrowLeft") setCursor((c) => shiftDay(c, -1));
    else if (e.key === "ArrowRight") setCursor((c) => shiftDay(c, 1));
    else if (e.key === "ArrowUp") setCursor((c) => shiftDay(c, -7));
    else if (e.key === "ArrowDown") setCursor((c) => shiftDay(c, 7));
    else if (e.key === "PageUp") month(-1);
    else if (e.key === "PageDown") month(1);
    else if (e.key === "Enter" || e.key === " ") {
      if (isKnownDay(cursor)) onPick(cursor);
    } else if (e.key === "Escape" || e.key === "Tab") onClose();
    else return;
    e.preventDefault();
  };

  return (
    <Popover anchor={anchor} onClose={onClose} width={286} label="Choose a day">
      <div ref={gridRef} tabIndex={0} onKeyDown={onKeyDown} className="p-2.5 outline-none">
        <div className="mb-2 flex items-center justify-between">
          <MonthButton label="Previous month" onClick={() => month(-1)}>
            <ChevronLeft size={15} strokeWidth={2} />
          </MonthButton>
          <span className="text-[13px] font-medium text-ink">{monthLabel(ym)}</span>
          <MonthButton label="Next month" onClick={() => month(1)}>
            <ChevronRight size={15} strokeWidth={2} />
          </MonthButton>
        </div>
        <div className="grid grid-cols-7 pb-1 text-center text-[10.5px] text-ink-muted">
          {WEEK.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
        <div role="grid" aria-label={monthLabel(ym)} className="grid grid-cols-7 gap-0.5">
          {monthCells(ym).map((d, i) => {
            if (!d) return <span key={`blank-${i}`} />;
            const games = isKnownDay(d);
            const chosen = d === value;
            const under = d === cursor;
            return (
              <button
                key={d}
                type="button"
                tabIndex={-1}
                disabled={!games}
                aria-current={chosen ? "date" : undefined}
                aria-label={games ? d : `${d}, no games`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setCursor(d)}
                onClick={() => onPick(d)}
                className={`relative grid h-[32px] place-items-center rounded-md text-[12.5px] tabular transition-colors ${
                  chosen
                    ? "bg-accent font-semibold text-white"
                    : games
                      ? `text-ink ${under ? "bg-[var(--menu-active)]" : "hover:bg-[var(--row-hover)]"}`
                      : "text-[color-mix(in_oklab,var(--ink-muted)_45%,transparent)]"
                } ${under && !chosen && !games ? "ring-1 ring-hairline" : ""}`}
              >
                {dayNum(d)}
                {d === today && (
                  <span aria-hidden className={`absolute bottom-[4px] size-[3px] rounded-full ${chosen ? "bg-white" : "bg-accent"}`} />
                )}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex items-center gap-1 border-t border-hairline pt-1.5">
          <ListFooterButton onClick={() => onPick(latestDay())}>Latest night</ListFooterButton>
          {opener && <ListFooterButton onClick={() => onPick(opener)}>Next season opens</ListFooterButton>}
        </div>
      </div>
    </Popover>
  );
}

function MonthButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="grid size-[26px] place-items-center rounded-md text-ink-muted transition-colors hover:bg-[var(--row-hover)] hover:text-ink"
    >
      {children}
    </button>
  );
}
