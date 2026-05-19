"use client";

import { useEffect, useRef } from "react";
import type { CoachSeason, TourneyRound } from "@/lib/coaches";

/**
 * Career-at-a-glance strip — one cell per season, sized equally across the
 * width on desktop and drag-/swipe-scrollable when the row would otherwise
 * squeeze cells below readability. Each cell carries the season year, the
 * W-L record, and (when the team made the tournament) the round reached.
 *
 * Background color encodes season quality on a red→green scale derived from
 * win %, so a great year reads as green and a struggling year as red without
 * the viewer having to parse numbers. Championship seasons get a gold
 * underline as an additional celebratory marker.
 */

const SHORT_ROUND: Record<TourneyRound, string> = {
  "First Four": "FF",
  "R64": "R1",
  "R32": "R2",
  "Sweet 16": "S16",
  "Elite Eight": "E8",
  "Final Four": "F4",
  "Runner-up": "Final",
  "Champion": "Champ",
};

// Red → green color ramp keyed on win %. Range tuned to the realistic
// distribution for D-I head coaches who hold a job long enough to appear in
// our 13-year window: 40% (firing-line) → red, 60% (mediocre) → orange-yellow,
// 75% (good) → light green, 88%+ (elite) → deep green. Saturation higher
// at the extremes so a 33-5 season visually pops vs a 25-10 one.
function colorForWinPct(pct: number | null): string {
  if (pct == null) return "rgba(0,0,0,0.04)";
  const t = Math.max(0, Math.min(1, (pct - 0.4) / 0.48));
  const hue = Math.round(t * 130); // 0 = red, 130 = green
  // Boost saturation at the edges of the scale (great or terrible seasons
  // look more saturated than middling ones — visual reward for variance).
  const distFromMid = Math.abs(t - 0.5) * 2; // 0 in middle, 1 at ends
  const sat = 50 + distFromMid * 25; // 50% middle → 75% edges
  return `hsl(${hue}, ${sat}%, 76%)`;
}

function seasonLabel(yearEnd: number): string {
  return `${(yearEnd - 1).toString().slice(-2)}-${yearEnd.toString().slice(-2)}`;
}

const DRAG_THRESHOLD_PX = 6;

export function SeasonHeatStrip({ seasons }: { seasons: CoachSeason[] }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const dragState = useRef({ down: false, startX: 0, startScrollLeft: 0, moved: 0 });

  // Drag-to-scroll on desktop. Mobile uses native touch scroll which the
  // overflow-x-auto container handles for free. Mirrors the schedule ticker's
  // gesture handling.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    function onMouseDown(e: MouseEvent) {
      dragState.current = {
        down: true,
        startX: e.pageX,
        startScrollLeft: el!.scrollLeft,
        moved: 0,
      };
      el!.style.cursor = "grabbing";
    }
    function onMouseMove(e: MouseEvent) {
      const s = dragState.current;
      if (!s.down) return;
      const dx = e.pageX - s.startX;
      s.moved = Math.max(s.moved, Math.abs(dx));
      el!.scrollLeft = s.startScrollLeft - dx;
    }
    function onMouseUp() {
      dragState.current.down = false;
      el!.style.cursor = "grab";
    }
    function onMouseLeave() {
      if (dragState.current.down) {
        dragState.current.down = false;
        el!.style.cursor = "grab";
      }
    }

    el.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    el.addEventListener("mouseleave", onMouseLeave);
    return () => {
      el.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      el.removeEventListener("mouseleave", onMouseLeave);
    };
  }, []);

  const data = [...seasons]
    .filter((s) => s.wins !== null && s.losses !== null)
    .sort((a, b) => a.year - b.year);
  if (data.length === 0) return null;

  // Suppress drag-noop threshold — strip cells aren't clickable so we don't
  // need to suppress click events post-drag.
  void DRAG_THRESHOLD_PX;

  return (
    <div>
      <div
        ref={scrollerRef}
        className="overflow-x-auto select-none cursor-grab [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden rounded-md border border-hairline"
        style={{ scrollSnapType: "x proximity" }}
      >
        <div className="flex items-stretch gap-px min-w-min">
          {data.map((s, i) => {
            const games = (s.wins ?? 0) + (s.losses ?? 0);
            const pct = games > 0 ? (s.wins ?? 0) / games : null;
            const bg = colorForWinPct(pct);
            const round = s.round ? SHORT_ROUND[s.round] : null;
            const isTitle = s.round === "Champion";
            return (
              <div
                key={`${s.year}-${i}`}
                className="flex-1 min-w-[78px] shrink-0 flex flex-col items-center justify-center gap-0.5 px-1 py-2 relative"
                style={{ backgroundColor: bg }}
                title={`${seasonLabel(s.year)} · ${s.team} · ${s.wins}-${s.losses}${pct != null ? ` (${(pct * 100).toFixed(1)}%)` : ""}${s.round ? ` · ${s.round}` : ""}`}
              >
                <span className="text-[0.55rem] uppercase tracking-widest text-ink-soft font-medium tabular leading-none">
                  {seasonLabel(s.year)}
                </span>
                <span className="font-display text-base sm:text-lg tabular text-ink leading-none">
                  {s.wins}-{s.losses}
                </span>
                {round ? (
                  <span
                    className={`text-[0.55rem] uppercase tracking-widest font-bold tabular leading-none ${isTitle ? "text-amber-700" : "text-ink-soft"}`}
                  >
                    {round}
                  </span>
                ) : (
                  <span className="text-[0.55rem] leading-none opacity-0">·</span>
                )}
                {isTitle && (
                  <span className="absolute inset-x-1 bottom-0 h-0.5 bg-amber-500/80 rounded-t" />
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex justify-end text-[0.55rem] uppercase tracking-widest text-ink-muted/70 font-medium mt-1.5">
        Color: win % (red → green) · underline: title year
      </div>
    </div>
  );
}
