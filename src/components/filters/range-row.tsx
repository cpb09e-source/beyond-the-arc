"use client";

import { memo, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The dual-thumb stat range control, shared by the /players and team-explorer
 * filter drawers.
 *
 * It lived inside player-filter-bar.tsx first. It moved here when the team
 * explorer adopted the same drawer: the brief was "real continuity" between the
 * two pages, and the only way two surfaces stay identical through later edits is
 * for them to render the same component rather than two copies that agree today.
 *
 * Semantics worth knowing before reusing it: a thumb parked at its extreme means
 * "no bound" and reports null, so a full-width slider emits no filter at all.
 * That is what lets a drawer full of sliders default to filtering nothing.
 */

export type RangeStat = {
  key: string;    // matches a stat column key on the owning page
  label: string;
  min: number;    // slider lower bound (display units)
  max: number;    // slider upper bound (display units)
  step: number;
  pct?: boolean;  // display 0–100 %, store fraction
};

export type Bound = { lo: number | null; hi: number | null };
export type RangeState = Record<string, Bound>;

export function isBoundActive(b: Bound | undefined): boolean {
  return !!b && (b.lo !== null || b.hi !== null);
}

export function roundNice(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// One stat: label + min/max number boxes + dual-thumb slider. Memoized so a
// drag only re-renders the row being dragged (setBound must be stable upstream).
export const RangeRow = memo(function RangeRow({
  st,
  lo,
  hi,
  setBound,
  pinned,
  onTogglePin,
  dense = false,
}: {
  st: RangeStat;
  lo: number | null;
  hi: number | null;
  setBound: (key: string, lo: number | null, hi: number | null) => void;
  /**
   * When onTogglePin is supplied the label becomes a toggle that adds the stat
   * to the table as a column. Pinning is independent of the range: a reader can
   * pin a stat to look at it without narrowing anything, which is the whole
   * point — the old drawer could only answer "which teams", never "show me this".
   */
  pinned?: boolean;
  onTogglePin?: (key: string) => void;
  /**
   * Narrow-cell layout for a multi-column grid on phones.
   *
   * The default row puts the label and both number boxes on one line, which
   * needs ~180px for the boxes alone — more than a half-width cell on a 414px
   * screen has to give. Dense stacks the label above the boxes and lets them
   * share the width below `sm`, and is a no-op from `sm` up, where the cells
   * are wide enough for the normal row again.
   *
   * Opt-in rather than automatic: /players and /coaches render this same row in
   * a single column on phones, where stacking would only make each row taller
   * for nothing.
   */
  dense?: boolean;
}) {
  const onChange = (lo: number | null, hi: number | null) => setBound(st.key, lo, hi);
  const clamp = (n: number) => Math.min(Math.max(n, st.min), st.max);
  const setLo = (raw: string) => {
    if (raw === "") return onChange(null, hi);
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    let v = clamp(n);
    if (hi !== null && v > hi) v = hi;
    onChange(v, hi);
  };
  const setHi = (raw: string) => {
    if (raw === "") return onChange(lo, null);
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    let v = clamp(n);
    if (lo !== null && v < lo) v = lo;
    onChange(lo, v);
  };
  const boxCls = cn(
    "h-8 px-1.5 rounded-md border border-ink/15 bg-card text-ink text-xs text-center tabular shadow-sm placeholder:text-ink-muted/70 focus:outline-none focus:ring-2 focus:ring-coral/40 focus:border-coral/40",
    // min-w-0 lets the boxes actually shrink inside the flex row; without it
    // they hold their intrinsic width and overflow the cell instead.
    dense ? "w-full min-w-0 sm:w-16" : "w-16",
  );
  return (
    <div>
      <div className={cn(
        "mb-2",
        dense
          ? "flex flex-col items-stretch gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
          : "flex items-center justify-between gap-3",
      )}>
        {onTogglePin ? (
          <button
            type="button"
            onClick={() => onTogglePin(st.key)}
            aria-pressed={!!pinned}
            title={pinned ? `Remove ${st.label} column` : `Show ${st.label} as a column`}
            className={cn(
              "group/pin inline-flex items-center gap-1.5 min-w-0 text-sm rounded transition-colors text-left",
              pinned ? "text-coral font-medium" : "text-ink hover:text-coral",
            )}
          >
            {/* Checkbox, not an icon-on-hover: the affordance has to be visible
                before the pointer arrives or nobody discovers it. */}
            <span
              aria-hidden
              className={cn(
                "shrink-0 w-3.5 h-3.5 rounded-[3px] border inline-flex items-center justify-center text-[0.6rem] leading-none transition-colors",
                pinned
                  ? "bg-coral border-coral text-white"
                  : "border-ink/25 group-hover/pin:border-coral/60",
              )}
            >
              {pinned ? "✓" : ""}
            </span>
            <span className="truncate">
              {st.label}
              {st.pct && <span className={pinned ? "text-coral/70" : "text-ink-muted"}> %</span>}
            </span>
          </button>
        ) : (
          <span className="text-sm text-ink truncate">
            {st.label}
            {st.pct && <span className="text-ink-muted"> %</span>}
          </span>
        )}
        <div className={cn("flex items-center gap-1.5", dense ? "w-full min-w-0 sm:w-auto sm:shrink-0" : "shrink-0")}>
          <input
            type="number" inputMode="decimal" min={st.min} max={st.max} step={st.step}
            value={lo ?? ""} placeholder="min" aria-label={`${st.label} minimum`}
            onChange={(e) => setLo(e.target.value)} className={boxCls}
          />
          <span className="text-ink-muted text-xs">–</span>
          <input
            type="number" inputMode="decimal" min={st.min} max={st.max} step={st.step}
            value={hi ?? ""} placeholder="max" aria-label={`${st.label} maximum`}
            onChange={(e) => setHi(e.target.value)} className={boxCls}
          />
        </div>
      </div>
      {/* PHONE: number boxes only. A dual-thumb track is a pointer control —
          at phone width the two thumbs sit within a few pixels of each other
          and grabbing the one you meant is a coin flip, while the boxes above
          already set the same two numbers exactly. Returns from `md` up. */}
      <div className="hidden md:block">
        <RangeDual st={st} lo={lo} hi={hi} onChange={onChange} />
      </div>
    </div>
  );
});

/**
 * Dual-thumb slider over one stat. Sitting a thumb at its extreme clears that
 * bound (→ null), so a full-width slider emits no filter. See .bta-range in
 * globals.css for the thumb styling + pointer-events trick.
 *
 * WHY THE THUMB IS NOT A CONTROLLED VALUE MID-DRAG
 *
 * These inputs used to be plain controlled inputs: every mouse move ran
 * input → setBound → the whole drawer re-renders → React writes `value` back.
 * The thumb's position was therefore owned by React, and could never be further
 * along than the last committed render — so on a fast drag the cursor visibly
 * pulled ahead and the thumb caught up behind it.
 *
 * Now the DOM owns the thumb while you're dragging. `drag` holds the live
 * value, it is seeded straight from the input event, and the parent is told on
 * the SAME event — but the thumb no longer waits on that round trip to paint.
 * On release `drag` clears and the props take over again, so the committed
 * state stays the single source of truth everywhere outside the gesture.
 *
 * The filled track between the thumbs reads the same live values, so it tracks
 * the thumb rather than trailing it.
 */
function RangeDual({
  st,
  lo,
  hi,
  onChange,
}: {
  st: RangeStat;
  lo: number | null;
  hi: number | null;
  onChange: (lo: number | null, hi: number | null) => void;
}) {
  const { min, max, step } = st;
  // Live override while a thumb is held; null when the gesture is over.
  const [drag, setDrag] = useState<{ lo: number; hi: number } | null>(null);

  const propLo = lo ?? min;
  const propHi = hi ?? max;
  const effLo = drag ? drag.lo : propLo;
  const effHi = drag ? drag.hi : propHi;

  const span = max - min || 1;
  const leftPct = ((effLo - min) / span) * 100;
  const rightPct = ((max - effHi) / span) * 100;
  const endDrag = () => setDrag(null);

  return (
    <div className="relative h-4 mx-1.5">
      <div className="absolute top-1/2 -translate-y-1/2 inset-x-0 h-1 rounded-full bg-ink/12" />
      <div className="absolute top-1/2 -translate-y-1/2 h-1 rounded-full bg-coral" style={{ left: `${leftPct}%`, right: `${rightPct}%` }} />
      <input
        type="range" min={min} max={max} step={step} value={effLo}
        onChange={(e) => {
          const n = Math.min(Number(e.target.value), effHi);
          setDrag({ lo: n, hi: effHi });
          onChange(n <= min ? null : n, hi);
        }}
        onPointerUp={endDrag} onPointerCancel={endDrag} onBlur={endDrag}
        className="bta-range z-30" aria-label={`${st.label} minimum slider`}
      />
      <input
        type="range" min={min} max={max} step={step} value={effHi}
        onChange={(e) => {
          const n = Math.max(Number(e.target.value), effLo);
          setDrag({ lo: effLo, hi: n });
          onChange(lo, n >= max ? null : n);
        }}
        onPointerUp={endDrag} onPointerCancel={endDrag} onBlur={endDrag}
        className="bta-range z-20" aria-label={`${st.label} maximum slider`}
      />
    </div>
  );
}
