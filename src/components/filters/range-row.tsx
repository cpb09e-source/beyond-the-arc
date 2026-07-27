"use client";

import { memo } from "react";

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
}: {
  st: RangeStat;
  lo: number | null;
  hi: number | null;
  setBound: (key: string, lo: number | null, hi: number | null) => void;
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
  const boxCls =
    "h-8 w-16 px-1.5 rounded-md border border-ink/15 bg-card text-ink text-xs text-center tabular shadow-sm placeholder:text-ink-muted/70 focus:outline-none focus:ring-2 focus:ring-coral/40 focus:border-coral/40";
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="text-sm text-ink truncate">
          {st.label}
          {st.pct && <span className="text-ink-muted"> %</span>}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
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
      <RangeDual st={st} lo={lo} hi={hi} onChange={onChange} />
    </div>
  );
});

// Dual-thumb slider over one stat. Sitting a thumb at its extreme clears that
// bound (→ null), so a full-width slider emits no filter. See .bta-range in
// globals.css for the thumb styling + pointer-events trick.
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
  const effLo = lo ?? min;
  const effHi = hi ?? max;
  const span = max - min || 1;
  const leftPct = ((effLo - min) / span) * 100;
  const rightPct = ((max - effHi) / span) * 100;
  return (
    <div className="relative h-4 mx-1.5">
      <div className="absolute top-1/2 -translate-y-1/2 inset-x-0 h-1 rounded-full bg-ink/12" />
      <div className="absolute top-1/2 -translate-y-1/2 h-1 rounded-full bg-coral" style={{ left: `${leftPct}%`, right: `${rightPct}%` }} />
      <input
        type="range" min={min} max={max} step={step} value={effLo}
        onChange={(e) => { const n = Number(e.target.value); onChange(n <= min ? null : Math.min(n, effHi), hi); }}
        className="bta-range z-30" aria-label={`${st.label} minimum slider`}
      />
      <input
        type="range" min={min} max={max} step={step} value={effHi}
        onChange={(e) => { const n = Number(e.target.value); onChange(lo, n >= max ? null : Math.max(n, effLo)); }}
        className="bta-range z-20" aria-label={`${st.label} maximum slider`}
      />
    </div>
  );
}
