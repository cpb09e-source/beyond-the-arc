"use client";

import { useEffect, useRef, useState } from "react";
import type { PlayerGameRow } from "@/lib/static-data";
import { pctBg } from "@/components/percentile-chip";
import { shortDate, opponentOf } from "@/lib/game-log";

/**
 * Game-by-game columns for the player hero.
 *
 * Built from divs rather than an SVG. The SVG version had to stretch a fixed
 * viewBox to fill the module, which is fine for rectangles but makes any text
 * inside it unreadable — and the whole point of a game log is that a bar can
 * tell you WHICH game it is.
 *
 * The readout is positioned against the CHART, not against the bar, so a bar at
 * either end never pushes its label off the card.
 *
 * Client-side only because of touch. Hover alone leaves a phone with no way to
 * read a bar, so a tap selects one and a tap anywhere else clears it. Desktop
 * hover stays pure CSS — it costs no render, and the selected state is drawn on
 * top of it rather than replacing it.
 */

/** Ends of the site percentile ramp (percentile-chip.tsx), used exactly as the
 *  chips use them so a green here and a green on a chip are the same green.
 *  Read through pctBg rather than pasted, so a retune of the ramp reaches the
 *  charts too. */
const ABOVE_FILL = pctBg(100);
const BELOW_FILL = pctBg(0);

function gameTip(
  g: PlayerGameRow | undefined,
  value: number | null,
  unit: string,
  decimals: number,
): string {
  const parts = [shortDate(g?.game_date ?? null), opponentOf(g)].filter(Boolean);
  const result = g?.won === true ? "W" : g?.won === false ? "L" : null;
  // A null rate is "took no shot", which is not the same statement as 0%.
  const figure = value === null ? "no shot" : `${value.toFixed(decimals)} ${unit}`;
  return `${parts.join(" ")}${result ? ` · ${result}` : ""} · ${figure}`;
}

export function GameBars({
  games,
  values,
  unit,
  decimals = 0,
  avg,
}: {
  games: PlayerGameRow[];
  values: Array<number | null>;
  unit: string;
  decimals?: number;
  /** The player's own season average for this stat. It is both the dashed
   *  reference line and the threshold the colours encode, so the chart answers
   *  "which nights was he better than himself" without a legend. */
  avg: number | null;
}) {
  const [sel, setSel] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // A tap outside the chart clears the selection — including a tap on a
  // different chart, since each mounts its own copy of this listener and only
  // the one that owns the tapped bar keeps its selection.
  useEffect(() => {
    if (sel === null) return;
    function onDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) setSel(null);
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [sel]);

  const n = values.length;
  if (n === 0) return null;
  const max = Math.max(...values.map((v) => v ?? 0), avg ?? 0, 1);
  // Geometry is fixed — a 1rem readout band above a 3.5rem bar row — so the
  // average line can be placed against the OUTER box by arithmetic. It has to
  // hang off the outer box: a positioned bar row would become the anchor for
  // the hover readouts inside it, dropping every label down into the bars.
  const BAND = 1;
  const ROW = 3.5; // rem

  return (
    <div className="relative pt-4" ref={ref}>
      <div className="flex items-end gap-px h-14">
        {values.map((v, i) => {
          const tip = gameTip(games[i], v, unit, decimals);
          // A game with no attempt is neither above nor below — it sits out of
          // the comparison rather than being scored as a bad night.
          const above = v !== null && avg !== null ? v >= avg : null;
          const on = sel === i;
          return (
            <button
              key={i}
              type="button"
              onClick={() => setSel(on ? null : i)}
              className={`group/bar flex-1 min-w-0 h-full flex items-end rounded-[1px] hover:bg-ink/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-coral ${
                on ? "bg-ink/5" : ""
              }`}
              title={tip}
              aria-label={tip}
            >
              <span
                className="block w-full rounded-[1px]"
                style={{
                  // Floor the height so a scoreless night still reads as a game
                  // played rather than as a gap in the schedule. A null — no shot
                  // taken at all — gets the floor and nothing more.
                  height: v === null ? "3%" : `${Math.max(3, (v / max) * 100)}%`,
                  background:
                    above === null ? "var(--ink-muted)" : above ? ABOVE_FILL : BELOW_FILL,
                  opacity: above === null ? 0.25 : 1,
                }}
              />
              <span
                className={`pointer-events-none absolute top-0 left-0 right-0 text-right tabular text-[0.625rem] text-ink-soft truncate group-hover/bar:opacity-100 ${
                  on ? "opacity-100" : "opacity-0"
                }`}
              >
                {tip}
              </span>
            </button>
          );
        })}
      </div>
      {/* Last, and above the columns — a reference line the bars paint over is
          no reference at all. */}
      {avg !== null && (
        <span
          className="pointer-events-none absolute left-0 right-0 border-t border-dashed"
          style={{
            top: `${BAND + ROW * (1 - Math.min(1, avg / max))}rem`,
            borderColor: "var(--ink)",
            opacity: 0.45,
          }}
        />
      )}
    </div>
  );
}
