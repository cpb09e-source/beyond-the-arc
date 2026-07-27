"use client";

import { useEffect, useMemo, useState } from "react";
import { hexbin as d3hexbin } from "d3-hexbin";
import { cn } from "@/lib/utils";
import { dataUrl } from "@/lib/data-url";
import {
  ShotProfileFallbackCard, ZoneBars, ProfileMinis, useShotProfile, seasonLabel,
} from "@/components/players/player-shot-impact";

/**
 * Player-page "Shot Chart" card — hexbin favorite-spots view over CBBD shot
 * locations (public/data/shots/<bartId>.json, seasons 2024+ only; see
 * scripts/build-player-shots.mjs for the tuple layout), with the shot-profile
 * zone stats (rim/mid/3PT diet + FG%) in the right rail and the shot filters
 * in a band below the court.
 *
 * Rendering follows the perthirtysix.com treatment: a fixed dark half-court
 * (both themes — it's a data canvas, not a surface), one accent hue, and
 * per-hex OPACITY encoding shot frequency, so favorite spots glow and one-off
 * attempts fade into the floor. Hexagon geometry comes from d3-hexbin;
 * everything is plain SVG in court units (tenths of feet).
 *
 * Players with no shot file (careers ending before 2024) fall back to the
 * profile-only card so the zone stats never disappear from the page.
 */

// Tuple positions in the shots file. Positions are tenths of feet.
const CX = 0, CY = 1, MADE = 2, TYPE = 3, IS3 = 4, WON = 5, LOC = 6;

type ShotRow = number[];
type ShotsFile = { bart_player_id: number; seasons: Record<string, ShotRow[]> };

// Rim center in court units — distance derives from this.
const RIM_X = 250, RIM_Y = 52.5;

type Filters = {
  types: [boolean, boolean, boolean, boolean]; // jump, layup, dunk, tip
  pts2: boolean; pts3: boolean;
  make: boolean; miss: boolean;
  win: boolean; loss: boolean;
  home: boolean; away: boolean; neutral: boolean;
  distLo: number | null; distHi: number | null; // feet; null = unbounded
};

const DEFAULT_FILTERS: Filters = {
  types: [true, true, true, true],
  pts2: true, pts3: true,
  make: true, miss: true,
  win: true, loss: true,
  home: true, away: true, neutral: true,
  distLo: null, distHi: null,
};

const dist = (s: ShotRow) => Math.hypot(s[CX] - RIM_X, s[CY] - RIM_Y) / 10;

function applyFilters(rows: ShotRow[], f: Filters): ShotRow[] {
  return rows.filter((s) => {
    if (!f.types[s[TYPE]]) return false;
    if (s[IS3] === 1 ? !f.pts3 : !f.pts2) return false;
    if (s[MADE] === 1 ? !f.make : !f.miss) return false;
    // Unknown result (-1) passes as long as either result is enabled.
    if (s[WON] === 1 && !f.win) return false;
    if (s[WON] === 0 && !f.loss) return false;
    if (s[LOC] === 0 && !f.home) return false;
    if (s[LOC] === 1 && !f.away) return false;
    if (s[LOC] === 2 && !f.neutral) return false;
    const d = dist(s);
    if (f.distLo !== null && d < f.distLo) return false;
    // A right thumb parked at 40 means "40+" — no upper bound.
    if (f.distHi !== null && d > f.distHi) return false;
    return true;
  });
}

export function PlayerShotChart({ bartPlayerId, years }: { bartPlayerId: number; years: number[] }) {
  const [data, setData] = useState<ShotsFile | "none" | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);

  useEffect(() => {
    let cancelled = false;
    fetch(dataUrl(`/data/shots/${bartPlayerId}.json`))
      .then((r) => (r.ok ? r.json() : null))
      .then((j: ShotsFile | null) => {
        if (cancelled) return;
        const yrs = j ? Object.keys(j.seasons).map(Number).sort((a, b) => b - a) : [];
        if (!j || yrs.length === 0) { setData("none"); return; }
        setData(j);
        setYear(yrs[0]);
      })
      .catch(() => { if (!cancelled) setData("none"); });
    return () => { cancelled = true; };
  }, [bartPlayerId]);

  // Zone splits for the chart's season, shown in the right rail.
  const profile = useShotProfile(bartPlayerId, data && data !== "none" ? year : null);

  const rows = useMemo(() => {
    if (!data || data === "none" || year === null) return [];
    return data.seasons[String(year)] ?? [];
  }, [data, year]);

  const shown = useMemo(() => applyFilters(rows, filters), [rows, filters]);

  if (data === null) return null;
  // No located shots at all → the old profile-only card, minus nothing the
  // page used to show (the Impact block is retired everywhere).
  if (data === "none") return <ShotProfileFallbackCard bartPlayerId={bartPlayerId} years={years} />;

  const yrs = Object.keys(data.seasons).map(Number).sort((a, b) => b - a);

  const fgm = shown.reduce((n, s) => n + s[MADE], 0);
  const tpa = shown.filter((s) => s[IS3] === 1);
  const tpm = tpa.reduce((n, s) => n + s[MADE], 0);
  const pct = (m: number, a: number) => (a === 0 ? "—" : ((100 * m) / a).toFixed(1) + "%");

  return (
    <section className="mx-auto max-w-7xl px-6 lg:px-10 mt-8">
      <div className="bg-card border-y border-x-0 lg:border-x border-ink/10 rounded-none lg:rounded-xl shadow-md overflow-hidden ring-1 ring-ink/5 -mx-6 lg:mx-0">
        <div className="h-1 w-full bg-gradient-to-r from-coral via-coral to-coral/60" />
        <div className="px-5 lg:px-7 py-5 border-b border-hairline bg-paper-deep/30 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[0.6rem] uppercase tracking-[0.18em] text-coral font-bold mb-1.5 flex items-center gap-2">
              <span className="h-px w-6 bg-coral" />{year !== null && seasonLabel(year)} · shot profile &amp; locations
            </div>
            <h2 className="font-display text-3xl lg:text-4xl text-ink leading-none tracking-tight">Shot Chart</h2>
          </div>
          {yrs.length > 1 && (
            <select
              value={year ?? undefined}
              onChange={(e) => setYear(Number(e.target.value))}
              className="h-9 px-2.5 rounded-md border border-ink/15 bg-card text-ink text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-coral/40"
              aria-label="Season"
            >
              {yrs.map((y) => <option key={y} value={y}>{seasonLabel(y)}</option>)}
            </select>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 lg:gap-8 px-5 lg:px-7 py-6">
          {/* Court */}
          <div className="lg:col-span-3">
            <CourtChart shots={shown} />
            <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
              <p className="text-sm text-ink tabular">
                <span className="font-bold">{fgm} / {shown.length}</span>
                <span className="text-ink-muted"> FG ({pct(fgm, shown.length)})</span>
                <span className="text-ink-muted mx-2">·</span>
                <span className="font-bold">{tpm} / {tpa.length}</span>
                <span className="text-ink-muted"> 3PT ({pct(tpm, tpa.length)})</span>
              </p>
              {shown.length !== rows.length && (
                <p className="text-xs text-ink-muted tabular">{shown.length.toLocaleString()} of {rows.length.toLocaleString()} charted shots</p>
              )}
            </div>
            <p className="mt-1 text-xs text-ink-muted">
              Brighter hexes = more attempts from that spot. Shots without a tracked location aren&apos;t plotted; free throws excluded.
            </p>
          </div>

          {/* Shot profile rail — season splits for the same year the chart shows. */}
          <div className="lg:col-span-2 lg:border-l lg:border-hairline lg:pl-8">
            <div className="text-[0.62rem] uppercase tracking-[0.18em] text-ink-muted font-semibold mb-4">Shot diet · FG% by zone</div>
            {profile ? (
              <>
                <ZoneBars s={profile} />
                <div className="mt-5"><ProfileMinis s={profile} /></div>
              </>
            ) : (
              <p className="text-sm text-ink-muted">No zone splits for this season.</p>
            )}
          </div>
        </div>

        {/* Filters band */}
        <div className="px-5 lg:px-7 py-5 border-t border-hairline bg-paper-deep/20">
          <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
            <ChipGroup label="Shot types">
              {(["Jump shots", "Layups", "Dunks", "Tip-ins"] as const).map((label, i) => (
                <Chip
                  key={label} label={label} on={filters.types[i]}
                  toggle={() => setFilters((f) => {
                    const types = [...f.types] as Filters["types"];
                    types[i] = !types[i];
                    return { ...f, types };
                  })}
                />
              ))}
            </ChipGroup>
            <ChipGroup label="Point values">
              <Chip label="2PT" on={filters.pts2} toggle={() => setFilters((f) => ({ ...f, pts2: !f.pts2 }))} />
              <Chip label="3PT" on={filters.pts3} toggle={() => setFilters((f) => ({ ...f, pts3: !f.pts3 }))} />
            </ChipGroup>
            <ChipGroup label="Shot outcomes">
              <Chip label="Make" on={filters.make} toggle={() => setFilters((f) => ({ ...f, make: !f.make }))} />
              <Chip label="Miss" on={filters.miss} toggle={() => setFilters((f) => ({ ...f, miss: !f.miss }))} />
            </ChipGroup>
            <ChipGroup label="Game outcomes">
              <Chip label="Win" on={filters.win} toggle={() => setFilters((f) => ({ ...f, win: !f.win }))} />
              <Chip label="Loss" on={filters.loss} toggle={() => setFilters((f) => ({ ...f, loss: !f.loss }))} />
            </ChipGroup>
            <ChipGroup label="Game locations">
              <Chip label="Home" on={filters.home} toggle={() => setFilters((f) => ({ ...f, home: !f.home }))} />
              <Chip label="Away" on={filters.away} toggle={() => setFilters((f) => ({ ...f, away: !f.away }))} />
              <Chip label="Neutral" on={filters.neutral} toggle={() => setFilters((f) => ({ ...f, neutral: !f.neutral }))} />
            </ChipGroup>

            <div className="min-w-56 flex-1 max-w-xs">
              <DistanceSlider
                lo={filters.distLo} hi={filters.distHi}
                onChange={(lo, hi) => setFilters((f) => ({ ...f, distLo: lo, distHi: hi }))}
              />
            </div>

            <button
              type="button"
              onClick={() => setFilters(DEFAULT_FILTERS)}
              className="h-8 text-xs text-ink-muted hover:text-coral transition-colors underline underline-offset-2 ml-auto"
            >
              Reset filters
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------- court ---------------------------------- */

// Court constants, tenths of feet. Baseline (and rim) at the TOP of the SVG.
// The canvas crops at 40ft — a real half court runs 47, but everything past
// ~35ft is a heave and the extra 7ft was just empty floor pushing the card
// taller (perthirtysix crops at ~38 for the same reason). Cropped shots still
// count in the totals; their hexes clip at the edge.
const W = 500, H = 400;
// NCAA line work: 12ft lane, 19ft FT line, 6ft FT circle, 4ft restricted arc,
// 22'1.75" arc with corner lines 3.35ft off each sideline.
const THREE_R = 221.5, CORNER_X = 33.5;
// Where the corner line meets the arc: sqrt(r² − (250−33.5)²) below the rim.
const CORNER_Y = RIM_Y + Math.sqrt(THREE_R * THREE_R - (RIM_X - CORNER_X) * (RIM_X - CORNER_X));

const HEX_FILL = "#e8794e"; // brand coral tuned brighter for the dark floor
const COURT_BG = "#1f2937";
const LINE = "rgba(255,255,255,0.22)";

function CourtChart({ shots }: { shots: ShotRow[] }) {
  const bins = useMemo(() => {
    const gen = d3hexbin<ShotRow>()
      .x((s) => s[CX]).y((s) => s[CY])
      .radius(9)
      .extent([[0, 0], [W, H]]);
    return gen(shots);
  }, [shots]);

  // Opacity ramp: linear in bin count against a cap well below the max, so a
  // player's top handful of spots all saturate (that's what makes favorite
  // zones read as zones instead of a single hottest hex).
  const cap = useMemo(() => {
    const max = bins.reduce((m, b) => Math.max(m, b.length), 0);
    return Math.max(3, max * 0.4);
  }, [bins]);

  const hexPath = useMemo(() => d3hexbin().radius(9).hexagon(), []);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto rounded-lg" role="img" aria-label="Shot chart">
      <rect width={W} height={H} rx={8} fill={COURT_BG} />

      {/* Shots go under the line work so the court stays legible. */}
      <g>
        {bins.map((b) => (
          <path
            key={`${Math.round(b.x)}-${Math.round(b.y)}`}
            d={hexPath}
            transform={`translate(${b.x},${b.y})`}
            fill={HEX_FILL}
            opacity={Math.min(1, 0.14 + b.length / cap)}
          >
            <title>{`${b.length} shot${b.length === 1 ? "" : "s"} · ${b.reduce((n, s) => n + s[MADE], 0)} made`}</title>
          </path>
        ))}
      </g>

      {/* Line work */}
      <g stroke={LINE} strokeWidth={2} fill="none">
        {/* Lane + free-throw circle */}
        <rect x={RIM_X - 60} y={0} width={120} height={190} />
        <circle cx={RIM_X} cy={190} r={60} />
        {/* Backboard + rim + restricted arc */}
        <line x1={RIM_X - 30} y1={40} x2={RIM_X + 30} y2={40} strokeWidth={3} />
        <circle cx={RIM_X} cy={RIM_Y} r={7.5} />
        <path d={`M ${RIM_X - 40} ${RIM_Y} A 40 40 0 0 0 ${RIM_X + 40} ${RIM_Y}`} />
        {/* Three-point line: corner segments + arc */}
        <line x1={CORNER_X} y1={0} x2={CORNER_X} y2={CORNER_Y} />
        <line x1={W - CORNER_X} y1={0} x2={W - CORNER_X} y2={CORNER_Y} />
        <path d={`M ${CORNER_X} ${CORNER_Y} A ${THREE_R} ${THREE_R} 0 0 0 ${W - CORNER_X} ${CORNER_Y}`} />
      </g>
    </svg>
  );
}

/* --------------------------------- filters --------------------------------- */

function ChipGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium mb-1.5">{label}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({ label, on, toggle }: { label: string; on: boolean; toggle: () => void }) {
  return (
    <button
      type="button" onClick={toggle} aria-pressed={on}
      className={cn(
        "h-8 px-3 rounded-md border text-xs font-medium transition-colors shadow-sm",
        on
          ? "border-coral/50 bg-coral/10 text-coral"
          : "border-ink/15 bg-card text-ink-muted hover:text-ink hover:border-ink/25",
      )}
    >
      {label}
    </button>
  );
}

/**
 * Dual-thumb distance slider, 0–40 ft. Same .bta-range markup as the /players
 * filter drawer (globals.css owns the thumb styling + pointer-events trick).
 * A thumb parked at its extreme clears that bound; 40 on the right reads 40+.
 */
function DistanceSlider({
  lo, hi, onChange,
}: {
  lo: number | null; hi: number | null;
  onChange: (lo: number | null, hi: number | null) => void;
}) {
  const MIN = 0, MAX = 40;
  const effLo = lo ?? MIN, effHi = hi ?? MAX;
  const leftPct = ((effLo - MIN) / (MAX - MIN)) * 100;
  const rightPct = ((MAX - effHi) / (MAX - MIN)) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <div className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">Shot distance (ft)</div>
        <div className="text-xs text-ink tabular">
          {effLo} – {hi === null ? "40+" : effHi}
        </div>
      </div>
      <div className="relative h-4 mx-1.5">
        <div className="absolute top-1/2 -translate-y-1/2 inset-x-0 h-1 rounded-full bg-ink/12" />
        <div className="absolute top-1/2 -translate-y-1/2 h-1 rounded-full bg-coral" style={{ left: `${leftPct}%`, right: `${rightPct}%` }} />
        <input
          type="range" min={MIN} max={MAX} step={1} value={effLo}
          onChange={(e) => { const n = Number(e.target.value); onChange(n <= MIN ? null : Math.min(n, effHi), hi); }}
          className="bta-range z-30" aria-label="Minimum shot distance"
        />
        <input
          type="range" min={MIN} max={MAX} step={1} value={effHi}
          onChange={(e) => { const n = Number(e.target.value); onChange(lo, n >= MAX ? null : Math.max(n, effLo)); }}
          className="bta-range z-20" aria-label="Maximum shot distance"
        />
      </div>
    </div>
  );
}
