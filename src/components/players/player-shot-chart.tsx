"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { hexbin as d3hexbin } from "d3-hexbin";
import { cn } from "@/lib/utils";
import { dataUrl } from "@/lib/data-url";
import { StatInfo } from "@/components/players/stat-info";
import { pctBg, pctColor } from "@/components/percentile-chip";
import {
  ShotProfileFallbackCard, useShotProfile, seasonLabel,
} from "@/components/players/player-shot-impact";
import {
  ZONES, zoneOf, percentileFrom,
  W, H, RIM_X, RIM_Y, THREE_R, CORNER_X, CORNER_Y, CLOSE_R,
  type Zone, type ZoneId,
} from "@/lib/shot-zones";

/**
 * Player-page "Shot Chart" card — two views of the same filtered shot set,
 * side by side over CBBD shot locations (public/data/shots/<bartId>.json,
 * seasons 2024+; see scripts/build-player-shots.mjs for the tuple layout):
 *
 *   LEFT  — volume. Where the shots come from, hex darkness = attempts.
 *   RIGHT — accuracy vs the player's OWN position group. Hex size = attempts,
 *           hex colour = FG% above/below what D-I guards (or forwards, or
 *           centres) shoot from that same spot. Comparing a centre's rim rate
 *           to "D-I average" flatters him by ~10 points; comparing him to other
 *           centres is the only version of this chart that says anything.
 *
 * The court is a light, grainy canvas in both themes — it's a data surface,
 * not a page surface. Colour means exactly one thing per chart: attempts on
 * the left, accuracy on the right, so the two never compete.
 *
 * Players with no shot file (careers ending before 2024) fall back to the
 * profile-only card so the zone stats never disappear from the page.
 */

// Tuple positions in the shots file. Positions are tenths of feet.
const CX = 0, CY = 1, MADE = 2, TYPE = 3, IS3 = 4, WON = 5, LOC = 6;

type ShotRow = number[];
type ShotsFile = { bart_player_id: number; seasons: Record<string, ShotRow[]> };
type Bucket = "G" | "F" | "C";
type Baselines = {
  r: number;
  seasons: Record<string, Record<Bucket, Record<string, [number, number]>>>;
};

const BUCKET_LABEL: Record<Bucket, string> = { G: "guards", F: "forwards", C: "centers" };

// Rim center in court units — distance derives from this.
// RIM_X / RIM_Y and the rest of the court geometry come from lib/shot-zones.

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

export function PlayerShotChart({
  bartPlayerId,
  years,
  positionByYear,
  suppressFallback,
}: {
  bartPlayerId: number;
  years: number[];
  /** Season → position bucket, from the player file's Bart role note. */
  positionByYear?: Record<string, Bucket>;
  /** Set when the Player Overview already shows zone splits (Shot Diet). */
  suppressFallback?: boolean;
}) {
  const [data, setData] = useState<ShotsFile | "none" | null>(null);
  const [base, setBase] = useState<Baselines | null>(null);
  const [zoneBase, setZoneBase] = useState<ZoneBaselines | null>(null);
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

  // League baselines are one small shared file (~56 KB) — fetched alongside,
  // and the volume chart simply sits out if it never arrives.
  useEffect(() => {
    let cancelled = false;
    fetch(dataUrl("/data/shot-baselines.json"))
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Baselines | null) => { if (!cancelled) setBase(j); })
      .catch(() => { if (!cancelled) setBase(null); });
    return () => { cancelled = true; };
  }, []);

  // Zone cohorts: the same rates pooled by zone, PLUS the distribution behind
  // them, which is what makes a percentile possible. ~119 KB, served from
  // /public rather than R2 — it is one file every player page wants.
  useEffect(() => {
    let cancelled = false;
    fetch("/data/shot-zone-baselines.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: ZoneBaselines | null) => { if (!cancelled) setZoneBase(j); })
      .catch(() => { if (!cancelled) setZoneBase(null); });
    return () => { cancelled = true; };
  }, []);

  // Zone splits for the chart's season, shown in the band below.
  const profile = useShotProfile(bartPlayerId, data && data !== "none" ? year : null);

  const rows = useMemo(() => {
    if (!data || data === "none" || year === null) return [];
    return data.seasons[String(year)] ?? [];
  }, [data, year]);

  const shown = useMemo(() => applyFilters(rows, filters), [rows, filters]);
  // The accuracy chart needs both makes and misses to have a percentage at
  // all, so it ignores the make/miss toggles and honours every other filter.
  const outcomeFiltered = !filters.make || !filters.miss;
  const forAccuracy = useMemo(
    () => (outcomeFiltered ? applyFilters(rows, { ...filters, make: true, miss: true }) : shown),
    [rows, filters, outcomeFiltered, shown],
  );

  const bucket = year !== null ? positionByYear?.[String(year)] : undefined;
  const cells = base && year !== null && bucket ? base.seasons[String(year)]?.[bucket] : undefined;
  const zoneCells = zoneBase && year !== null && bucket
    ? zoneBase.seasons[String(year)]?.[bucket] ?? null
    : null;

  if (data === null) return null;
  // No located shots at all → the old profile-only card, minus nothing the
  // page used to show (the Impact block is retired everywhere).
  if (data === "none") {
    return suppressFallback
      ? null
      : <ShotProfileFallbackCard bartPlayerId={bartPlayerId} years={years} />;
  }

  const yrs = Object.keys(data.seasons).map(Number).sort((a, b) => b - a);

  const fgm = shown.reduce((n, s) => n + s[MADE], 0);
  const tpa = shown.filter((s) => s[IS3] === 1);
  const tpm = tpa.reduce((n, s) => n + s[MADE], 0);
  const pct = (m: number, a: number) => (a === 0 ? "—" : ((100 * m) / a).toFixed(1) + "%");

  return (
    <section className="mx-auto max-w-[88rem] px-6 lg:px-10 mt-8">
      <div className="bg-card border-y border-x-0 lg:border-x border-ink/10 rounded-none lg:rounded-xl shadow-md overflow-hidden ring-1 ring-ink/5 -mx-6 lg:mx-0">
        <div className="px-5 lg:px-7 py-5 border-b border-hairline bg-paper-deep/30 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[0.6rem] uppercase tracking-[0.18em] text-coral font-bold mb-1.5 flex items-center gap-2">
              <span className="h-px w-6 bg-coral" />{year !== null && seasonLabel(year)} · shot profile &amp; locations
            </div>
            <h2 className="font-display text-3xl lg:text-4xl text-ink leading-none tracking-tight">
              Shot Chart
              {/* Three counts can be in play and they are NOT the same number:
                    profile.tracked — every shot the season's play-by-play has
                                      for this player (from shooting-<year>.json)
                    rows.length     — those that carry x/y and can be plotted
                                      (from shots/<id>.json)
                    shown.length    — what survives the chip + distance filters
                  Location coverage is a per-game property of the source feed,
                  and in the weaker seasons it is brutal: league-wide 2021-22
                  only 49.7% of shots have coordinates, and Kansas' whole roster
                  that year sits near 11%. Quoting "418 tracked shots" over a
                  court holding 47 read as a plotting bug, so when the two
                  diverge the headline now says so outright. */}
              <span className="font-sans text-sm lg:text-base font-normal text-ink-muted tracking-normal ml-2.5 tabular">
                {profile?.tracked != null && rows.length < profile.tracked ? (
                  <span title={`Only shots with a tracked court location can be plotted. ${(profile.tracked - rows.length).toLocaleString()} of this season's ${profile.tracked.toLocaleString()} shots have no location in the play-by-play feed.`}>
                    {rows.length.toLocaleString()} of {profile.tracked.toLocaleString()} shots located
                  </span>
                ) : profile?.tracked != null ? (
                  <>{profile.tracked.toLocaleString()} tracked shots</>
                ) : null}
                {shown.length !== rows.length && (
                  <>
                    {profile?.tracked != null && " · "}
                    showing {shown.length.toLocaleString()}
                  </>
                )}
              </span>
            </h2>
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

        <div className="px-5 lg:px-7 py-6">
          {/* Distance sits above the courts rather than down in the chip band:
              it's the one control that reshapes what both charts are OF, so it
              reads as a lens on them rather than another toggle. */}
          <div className="mb-6 max-w-md">
            <DistanceSlider
              lo={filters.distLo} hi={filters.distHi}
              onChange={(lo, hi) => setFilters((f) => ({ ...f, distLo: lo, distHi: hi }))}
            />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-7 lg:gap-8">
            {/* ---- Volume ---- */}
            <div>
              <PanelHead
                title="Shot Volume"
                sub="Where the attempts come from"
                info="Darker hexes = more attempts from that spot. Shots without a tracked location aren't plotted; free throws excluded."
              />
              <VolumeChart shots={shown} />
              <VolumeLegend />
              <p className="mt-2.5 text-sm text-ink tabular">
                <span className="font-bold">{fgm} / {shown.length}</span>
                <span className="text-ink-muted"> FG ({pct(fgm, shown.length)})</span>
                <span className="text-ink-muted mx-2">·</span>
                <span className="font-bold">{tpm} / {tpa.length}</span>
                <span className="text-ink-muted"> 3PT ({pct(tpm, tpa.length)})</span>
              </p>
            </div>

            {/* ---- Accuracy vs position ---- */}
            <div>
              <PanelHead
                title="Accuracy vs Position"
                sub={bucket ? `Against D-I ${BUCKET_LABEL[bucket]}` : "Against the same position group"}
                info={
                  `Thirteen zones — three close, five mid-range, five from three. The number in each is FG% there, the size is how often he shoots it, and the colour is that FG% above or below what D-I ${
                    bucket ? BUCKET_LABEL[bucket] : "players at this position"
                  } shoot from the same zone. Rates are pulled toward the baseline in proportion to how few attempts back them, so a lone make doesn't read as a hot zone. Left and right are the viewer's, as drawn.` +
                  (outcomeFiltered ? " The make/miss filter is ignored here — a percentage needs both." : "")
                }
              />
              {cells ? (
                <>
                  <ZoneAccuracyChart
                    shots={forAccuracy}
                    base={zoneCells}
                    label={bucket ? BUCKET_LABEL[bucket] : "position"}
                  />
                  <AccuracyLegend label={bucket ? BUCKET_LABEL[bucket] : "position"} />
                </>
              ) : (
                <div className="rounded-lg border border-dashed border-ink/15 bg-paper-deep/20 px-5 py-10 text-center">
                  <p className="text-sm text-ink-muted">
                    {base === null
                      ? "League baselines unavailable."
                      : "No position on file for this season, so there's no cohort to compare against."}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Zone splits, assisted rate and FT rate all used to sit here. They
              live in the Player Overview now — Shot Diet and Shooting — so the
              card is only the two courts and their controls. */}
        </div>

        {/* Filters band */}
        <div className="px-5 lg:px-7 py-5 border-t border-hairline bg-paper-deep/20">
          <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
            {/* Tip-ins (TYPE 3) have no chip: they're 2% of all attempts, so
                the control was clutter. They stay ON permanently — they're
                field goals and belong in the totals, same as any putback. */}
            <ChipGroup label="Shot types">
              {(["Jump shots", "Layups", "Dunks"] as const).map((label, i) => (
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

// NCAA line work: 12ft lane, 19ft FT line, 6ft FT circle, 4ft restricted arc,
// 22'1.75" arc with corner lines 3.35ft off each sideline.

// Where the corner line meets the arc: sqrt(r² − (250−33.5)²) below the rim.


// Light, grainy canvas. The court used to be a navy slab, which forced every
// mark to be a glow on darkness; on warm paper the same marks read as ink and
// the line work stops fighting the shots.
const COURT_BG = "#e8e3d8";
const LINE = "rgba(26,34,56,0.30)";

// Volume ramp — pale sand through to deep brick. Single hue, so it reads as
// one quantity getting bigger; the accuracy chart beside it is the only place
// hue itself carries meaning.
const VOL_RAMP: [number, number, number][] = [
  [0xf2, 0xe3, 0xcd],
  [0xe2, 0x82, 0x4a],
  [0x9c, 0x2f, 0x1d],
];
/**
 * Accuracy diverging scale: blue = cold (below the cohort), red = hot (above).
 *
 * This deliberately inverts the site's --good/--bad semantics, where red means
 * trouble. On a shot chart red-is-hot is the older and stronger convention
 * (it's what every heat map in the sport uses), and the scale is read as
 * temperature, not as a verdict. The aggregate delta under the chart is tinted
 * off these same two poles so the card can't contradict itself.
 */
const COLD: [number, number, number] = [0x1f, 0x5e, 0x9e];
const NEUTRAL: [number, number, number] = [0xf4, 0xf1, 0xe8];
const HOT: [number, number, number] = [0xbd, 0x2f, 0x24];
const COLD_HEX = "#1f5e9e";
const HOT_HEX = "#bd2f24";

/**
 * Half-width of the colour scale, in percentage points of FG%.
 *
 * Measured, not guessed, and re-measured whenever the bin radius moves — a
 * coarser grid puts more attempts behind each cell, which survives shrinkage
 * and widens the spread. At the current r=22, across 600 qualifying 2026
 * players (38,050 cells), the shrunk difference is |1.9| points at the median,
 * |4.7| at p90, |5.8| at p95. An early ±10 domain left the typical cell using
 * 16% of the scale, which is exactly why the court first read as washed out.
 */
const DIFF_DOMAIN = 0.06;
/**
 * Slight gamma on the ramp, lifting mid-range cells further out of the paper.
 * Safe to apply because the legend is drawn by this same function over evenly
 * spaced values — any monotone curve stays self-consistent, so matching a hex
 * against the legend still reads the right number off it.
 */
const DIFF_GAMMA = 0.8;

const mix = (a: [number, number, number], b: [number, number, number], t: number) =>
  `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;

function volColor(t: number): string {
  const c = Math.max(0, Math.min(1, t));
  return c < 0.5 ? mix(VOL_RAMP[0]!, VOL_RAMP[1]!, c * 2) : mix(VOL_RAMP[1]!, VOL_RAMP[2]!, (c - 0.5) * 2);
}
function diffColor(d: number): string {
  const t = Math.max(-1, Math.min(1, d / DIFF_DOMAIN));
  const s = Math.pow(Math.abs(t), DIFF_GAMMA);
  return t < 0 ? mix(NEUTRAL, COLD, s) : mix(NEUTRAL, HOT, s);
}

/** Shared court frame: grainy floor, then children (the marks), then line work. */
function Court({ children, label }: { children: React.ReactNode; label: string }) {
  // useId keeps the filter unique — two of these render side by side, and a
  // duplicated id would make both courts share one (or neither) grain.
  const uid = useId().replace(/:/g, "");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto rounded-lg" role="img" aria-label={label}>
      <defs>
        {/* TV-static floor. fractalNoise + full desaturation gives grey grain;
            the rect's low opacity keeps it a texture rather than a pattern. */}
        <filter id={`grain-${uid}`} x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <clipPath id={`clip-${uid}`}><rect width={W} height={H} rx={8} /></clipPath>
      </defs>

      <g clipPath={`url(#clip-${uid})`}>
        <rect width={W} height={H} fill={COURT_BG} />
        <rect width={W} height={H} filter={`url(#grain-${uid})`} opacity={0.22} />
        {/* Marks sit under the line work so the court stays legible. */}
        {children}
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
      </g>
      <rect width={W} height={H} rx={8} fill="none" stroke="rgba(26,34,56,0.14)" />
    </svg>
  );
}

const VOL_R = 9;

function VolumeChart({ shots }: { shots: ShotRow[] }) {
  const bins = useMemo(() => {
    const gen = d3hexbin<ShotRow>()
      .x((s) => s[CX]).y((s) => s[CY])
      .radius(VOL_R)
      .extent([[0, 0], [W, H]]);
    return gen(shots);
  }, [shots]);

  // Ramp is linear in bin count against a cap well below the max, so a
  // player's top handful of spots all saturate (that's what makes favorite
  // zones read as zones instead of a single hottest hex).
  const cap = useMemo(() => {
    const max = bins.reduce((m, b) => Math.max(m, b.length), 0);
    return Math.max(3, max * 0.35);
  }, [bins]);

  const hexPath = useMemo(() => d3hexbin().radius(VOL_R).hexagon(), []);

  return (
    <Court label="Shot volume by court location">
      {bins.map((b) => (
        <path
          key={`${Math.round(b.x)}-${Math.round(b.y)}`}
          d={hexPath}
          transform={`translate(${b.x},${b.y})`}
          fill={volColor(b.length / cap)}
        >
          <title>{`${b.length} shot${b.length === 1 ? "" : "s"} · ${b.reduce((n, s) => n + s[MADE], 0)} made`}</title>
        </path>
      ))}
    </Court>
  );
}

/**
 * Shrinkage constant, in attempts — the strength of a Beta prior centred on
 * the league baseline. Without it the chart's loudest cells are its emptiest
 * ones: 2-for-2 from the corner would paint bright green.
 *
 * Sized from the spread it's meant to model rather than picked by eye. Player
 * FG% from a given spot scatters around the baseline with sd ≈ 0.08, so for
 * p ≈ 0.35 the matching prior strength is p(1−p)/σ² − 1 ≈ 25 attempts. An
 * earlier value of 8 was far too weak — it still let 2-for-2 saturate, which
 * is the exact failure the shrinkage exists to prevent.
 */
const SHRINK_K = 25;

/* ------------------------------ shot zones -------------------------------- */

/**
 * THE ZONE MAP, replacing first the hex grid and then the bubbles that replaced it.
 *
 * The hexes were honest but answered the wrong question: a hex is an arbitrary
 * patch of floor, so "cold in this hex" is not a sentence about basketball, and
 * attempts scattered thinly enough that most cells were mostly shrinkage.
 * Bubbles fixed the pooling and introduced their own problem — a circle floating
 * over a court asserts a location it does not actually occupy, and on a busy
 * player the close trio grew until they collided.
 *
 * So the zones are drawn as the regions they always were: real shapes, tiled
 * edge to edge, each one carrying its FG% and a percentile chip. Nothing floats
 * and nothing overlaps.
 *
 * Geometry and the classifier live in src/lib/shot-zones.ts, shared with
 * scripts/build-shot-zone-baselines.mts, so the cohort and the player are pooled
 * by one definition of "left wing" rather than two that can drift apart.
 */

/**
 * Attempts required before a percentile is shown.
 *
 * Matches MIN_ZONE_ATT in the baselines builder, and has to: the cohort
 * distribution was assembled from players with at least this many attempts in a
 * zone, so placing a player into it on fewer is reading a rank off a scale he
 * was not measured against. One corner three that misses is not the 0th
 * percentile, it is one shot, and the chip is withheld and the count shown.
 */
const MIN_RANK_ATT = 10;

type ZoneBin = {
  zone: Zone;
  made: number;
  att: number;
  baseRate: number | null;
  pct: number | null;
  /** Shrunk difference vs the cohort, still what drives the fill. */
  diff: number | null;
};

/** Per-zone cohort rate and distribution, from shot-zone-baselines.json. */
type ZoneBaseline = { made: number; att: number; q?: number[] };
type ZoneBaselines = {
  minAtt: number;
  seasons: Record<string, Record<Bucket, Record<string, ZoneBaseline>>>;
};

function zoneBins(shots: ShotRow[], base: Record<string, ZoneBaseline> | null): ZoneBin[] {
  const own = new Map<string, { made: number; att: number }>();
  for (const s of shots) {
    const z = zoneOf(s[CX], s[CY], s[IS3] === 1);
    const cur = own.get(z) ?? { made: 0, att: 0 };
    cur.made += s[MADE];
    cur.att += 1;
    own.set(z, cur);
  }
  return ZONES.map((zone) => {
    const o = own.get(zone.id) ?? { made: 0, att: 0 };
    const b = base?.[zone.id];
    const baseRate = b && b.att > 0 ? b.made / b.att : null;
    const rate = o.att > 0 ? o.made / o.att : null;
    // Same stabilizer the hexes used: equals the raw difference once attempts
    // pile up, and collapses toward zero when they don't.
    const diff =
      baseRate === null || rate === null
        ? null
        : (o.made - o.att * baseRate) / (o.att + SHRINK_K);
    return {
      zone,
      made: o.made,
      att: o.att,
      baseRate,
      pct: o.att >= MIN_RANK_ATT ? percentileFrom(b?.q, rate) : null,
      diff,
    };
  });
}

/* ---- region geometry ----
 *
 * Every zone is a sector of the rim circle, deliberately drawn long enough to
 * overrun the court, then CLIPPED to the two-point or three-point side of the
 * arc. Clipping is what gives the corner zones their real edges: the corner
 * three is bounded by the straight segment, which no angle from the rim can
 * express, and building the paths by hand instead would mean hand-authoring the
 * arc/line junction thirteen times.
 */
const BIG_R = 620;

function sector(t1: number, t2: number, r0: number, r1: number): string {
  const pt = (r: number, t: number) =>
    [RIM_X + r * Math.cos((t * Math.PI) / 180), RIM_Y + r * Math.sin((t * Math.PI) / 180)] as const;
  const [x1, y1] = pt(r0, t1);
  const [x2, y2] = pt(r0, t2);
  const [x3, y3] = pt(r1, t2);
  const [x4, y4] = pt(r1, t1);
  const inner = r0 <= 0.01 ? `M ${RIM_X} ${RIM_Y}` : `M ${x1} ${y1} A ${r0} ${r0} 0 0 1 ${x2} ${y2}`;
  return `${inner} L ${x3} ${y3} A ${r1} ${r1} 0 0 0 ${x4} ${y4} Z`;
}

/** The two-point side: baseline, both corner segments, then the arc. */
const INSIDE_3 =
  `M ${CORNER_X} 0 L ${CORNER_X} ${CORNER_Y} ` +
  `A ${THREE_R} ${THREE_R} 0 0 0 ${W - CORNER_X} ${CORNER_Y} L ${W - CORNER_X} 0 Z`;

type Clip = "in" | "out" | "cornerL" | "cornerR";

/**
 * Sweeps.
 *
 * THE CLOSE BAND IS A FULL CIRCLE ON THE RIM. Its three zones tile all 360
 * degrees: middle takes the front, left and right split everything behind the
 * hoop between them. That is exactly what the classifier does with those shots
 * — it clamps dy to zero, so anything level with or behind the rim lands at
 * t=0 or t=180 and belongs to a side by which side of the hoop it came from.
 *
 * Earlier passes carved the back of the circle out, on the argument that nobody
 * shoots from behind the glass. True, and it cost more than it bought: every
 * patch left the wrong shape somewhere, and a zone with no attempts already
 * reads as empty without being cut out of the diagram. The mid corners wrap the
 * same way, so the floor behind the rim tiles cleanly from the circle outward.
 */
const BEHIND_L = 270;   // straight up from the rim, sweeping left-to-behind
const BEHIND_R = -90;   // the same ray, approached from the right


const ZONE_GEOM: Record<ZoneId, { t: [number, number]; r: [number, number]; clip: Clip }> = {
  close_l: { t: [120, BEHIND_L], r: [0, CLOSE_R], clip: "in" },
  close_m: { t: [60, 120], r: [0, CLOSE_R], clip: "in" },
  close_r: { t: [BEHIND_R, 60], r: [0, CLOSE_R], clip: "in" },
  mid_corner_l: { t: [157.5, BEHIND_L], r: [CLOSE_R, BIG_R], clip: "in" },
  mid_wing_l: { t: [112.5, 157.5], r: [CLOSE_R, BIG_R], clip: "in" },
  mid_mid: { t: [67.5, 112.5], r: [CLOSE_R, BIG_R], clip: "in" },
  mid_wing_r: { t: [22.5, 67.5], r: [CLOSE_R, BIG_R], clip: "in" },
  mid_corner_r: { t: [BEHIND_R, 22.5], r: [CLOSE_R, BIG_R], clip: "in" },
  // The corner threes are rectangle-clipped to the strip outside the straight
  // segment, so they already reach the baseline without extending the sweep.
  "3_corner_l": { t: [140, BEHIND_L], r: [0, BIG_R], clip: "cornerL" },
  "3_wing_l": { t: [112.5, 180], r: [0, BIG_R], clip: "out" },
  "3_mid": { t: [67.5, 112.5], r: [0, BIG_R], clip: "out" },
  "3_wing_r": { t: [0, 67.5], r: [0, BIG_R], clip: "out" },
  "3_corner_r": { t: [BEHIND_R, 40], r: [0, BIG_R], clip: "cornerR" },
};

function ZoneAccuracyChart({
  shots, base, label,
}: {
  shots: ShotRow[]; base: Record<string, ZoneBaseline> | null; label: string;
}) {
  const bins = useMemo(() => zoneBins(shots, base), [shots, base]);
  const [hover, setHover] = useState<ZoneId | null>(null);
  const active = hover === null ? null : bins.find((b) => b.zone.id === hover) ?? null;

  return (
    <div className="relative" onMouseLeave={() => setHover(null)}>
      <Court label="Shooting accuracy by zone versus position-group average">
        <defs>
          <clipPath id="z-in"><path d={INSIDE_3} /></clipPath>
          {/* Outside the arc AND outside both corner strips.
              A corner-three point is outside the arc too, so clipping the wings
              to "not the two-point region" handed them the corners — and since
              the wings paint after the corners, they covered them. At x=15,
              y=95, inside the left corner and above the junction, the floor was
              being coloured Wing Left. Punching the two corner rectangles out
              with the same even-odd rule keeps each side of the junction to its
              own zone. */}
          <clipPath id="z-out" clipRule="evenodd">
            <path
              d={
                `M0 0 H${W} V${H} H0 Z ${INSIDE_3} ` +
                `M0 0 H${CORNER_X} V${CORNER_Y} H0 Z ` +
                `M${W - CORNER_X} 0 H${W} V${CORNER_Y} H${W - CORNER_X} Z`
              }
              clipRule="evenodd"
            />
          </clipPath>
          <clipPath id="z-cornerL"><rect x={0} y={0} width={CORNER_X} height={CORNER_Y} /></clipPath>
          <clipPath id="z-cornerR"><rect x={W - CORNER_X} y={0} width={CORNER_X} height={CORNER_Y} /></clipPath>
          {/* Under the attempt floor: hatched, so "not enough shots" cannot be
              mistaken for "average", which any flat fill would imply. */}
          <pattern id="z-thin" width={7} height={7} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width={7} height={7} fill="rgba(26,34,56,0.035)" />
            <line x1={0} y1={0} x2={0} y2={7} stroke="rgba(26,34,56,0.13)" strokeWidth={2} />
          </pattern>
        </defs>

        {bins.map((b) => {
          const g = ZONE_GEOM[b.zone.id];
          const on = hover === b.zone.id;
          return (
            <g key={b.zone.id} clipPath={`url(#z-${g.clip})`}>
              <path
                d={sector(g.t[0], g.t[1], g.r[0], g.r[1])}
                fill={b.att < MIN_RANK_ATT ? "url(#z-thin)" : b.diff === null ? "rgba(26,34,56,0.05)" : diffColor(b.diff)}
                stroke={on ? "rgba(26,34,56,0.85)" : "rgba(250,247,242,0.9)"}
                strokeWidth={on ? 3 : 2.25}
                onMouseEnter={() => setHover(b.zone.id)}
                role="img"
                aria-label={zoneSummary(b, label)}
              />
            </g>
          );
        })}

        {/* No line work here on purpose: Court renders the lane, rim and arc
            AFTER its children, so the markings already sit above these fills.
            Drawing the three-point line again only thickened it. */}
        <g pointerEvents="none">
          {bins.map((b) => <ZoneLabel key={b.zone.id} b={b} />)}
        </g>
      </Court>
      {active && <ZoneTooltip b={active} label={label} />}
    </div>
  );
}

/**
 * The rate, and under it the percentile as a chip.
 *
 * The chip is drawn from the same pctBg/pctColor ramp as every percentile chip
 * on the site rather than from the court's own hot/cold scale. Two encodings in
 * one graphic is the risk, and the answer is that they say different things: the
 * FILL is this player against the cohort AVERAGE, the CHIP is where he lands in
 * the cohort's SPREAD. A zone can be barely above average and still 80th, if the
 * field is tight there, and the pair is what shows it.
 */
function ZoneLabel({ b }: { b: ZoneBin }) {
  if (b.att === 0) {
    return (
      <text
        x={b.zone.x} y={b.zone.y} textAnchor="middle" dominantBaseline="central"
        style={{ fontSize: 12, fill: "rgba(26,34,56,0.35)" }}
      >
        —
      </text>
    );
  }
  const hot = b.diff !== null && Math.abs(b.diff) > 0.055;
  const ink = hot ? "#fff8f0" : "#12203c";
  const ranked = b.pct !== null;
  // Corner strips get the small treatment; everywhere else has room.
  const sm = b.zone.compact === true;
  const RATE = sm ? 14 : 21;
  const CW = sm ? 24 : 34;
  const CH = sm ? 12 : 15;
  const chipY = sm ? 2 : 5;
  return (
    <g transform={`translate(${b.zone.x},${b.zone.y})`}>
      <text
        textAnchor="middle" y={ranked ? (sm ? -6 : -4) : 3}
        style={{
          fontSize: RATE, fontWeight: 700, fill: ink,
          fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em",
        }}
      >
        {Math.round((100 * b.made) / b.att)}%
      </text>
      {ranked ? (
        <>
          <rect
            x={-CW / 2} y={chipY} width={CW} height={CH} rx={3}
            fill={pctBg(b.pct)} stroke="rgba(26,34,56,0.14)" strokeWidth={0.75}
          />
          <text
            textAnchor="middle" x={0} y={chipY + CH / 2 + 0.4} dominantBaseline="middle"
            style={{
              fontSize: sm ? 9 : 10.5, fontWeight: 700, fill: pctColor(b.pct),
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {b.pct}
          </text>
        </>
      ) : (
        <text
          textAnchor="middle" y={sm ? 12 : 15}
          style={{
            fontSize: sm ? 8 : 9.5,
            fill: hot ? "rgba(255,248,240,0.85)" : "rgba(26,34,56,0.5)",
            letterSpacing: "0.06em",
          }}
        >
          {b.att} ATT
        </text>
      )}
    </g>
  );
}

/** Hover card for one zone, positioned off its own representative point. */
function ZoneTooltip({ b, label }: { b: ZoneBin; label: string }) {
  const leftPct = (b.zone.x / W) * 100;
  const topPct = (b.zone.y / H) * 100;
  const below = topPct < 34;
  const xAlign = leftPct < 24 ? "0%" : leftPct > 76 ? "-100%" : "-50%";
  const accent = b.diff === null || b.att === 0 ? "var(--ink-muted)" : b.diff >= 0 ? HOT_HEX : COLD_HEX;
  const raw = b.att > 0 && b.baseRate !== null ? b.made / b.att - b.baseRate : null;
  return (
    <div
      className="pointer-events-none absolute z-20 rounded-md border border-hairline bg-paper px-2.5 py-1.5 shadow-lg whitespace-nowrap"
      style={{
        left: `${leftPct}%`,
        top: `${topPct}%`,
        transform: `translate(${xAlign}, ${below ? "0.75rem" : "calc(-100% - 0.75rem)"})`,
      }}
    >
      <div className="text-[0.62rem] uppercase tracking-widest font-bold" style={{ color: accent }}>
        {b.zone.label}
      </div>
      {b.att === 0 ? (
        <div className="text-[0.7rem] text-ink-muted">No attempts</div>
      ) : (
        <>
          <div className="text-[0.75rem] text-ink tabular">
            {b.made} of {b.att} ({pct1(b.made / b.att)})
          </div>
          <div className="text-[0.68rem] text-ink-muted tabular">
            {b.baseRate === null
              ? "no baseline here"
              : `D-I ${label} ${pct1(b.baseRate)} · ${raw !== null ? signed(100 * raw) : "—"} raw`}
          </div>
          <div className="text-[0.68rem] tabular" style={{ color: b.pct === null ? "var(--ink-muted)" : accent }}>
            {b.pct === null
              ? `under ${MIN_RANK_ATT} attempts, unranked`
              : `${b.pct}th percentile among ${label}`}
          </div>
        </>
      )}
    </div>
  );
}

function zoneSummary(b: ZoneBin, label: string): string {
  if (b.att === 0) return `${b.zone.label}: no attempts`;
  const own = `${b.made} of ${b.att} (${pct1(b.made / b.att)})`;
  const rank = b.pct === null ? "unranked" : `${b.pct}th percentile`;
  return b.baseRate === null
    ? `${b.zone.label}: ${own}, no baseline here`
    : `${b.zone.label}: ${own} versus D-I ${label} at ${pct1(b.baseRate)}, ${rank}`;
}


const pct1 = (v: number) => (100 * v).toFixed(1) + "%";
const signed = (v: number) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(1);

function PanelHead({ title, sub, info }: { title: string; sub: string; info?: string }) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-1.5">
        <h3 className="text-sm font-semibold text-ink leading-tight">{title}</h3>
        {info && <StatInfo definition={info} />}
      </div>
      <p className="text-[0.7rem] text-ink-muted uppercase tracking-[0.12em] mt-0.5">{sub}</p>
    </div>
  );
}

function Swatches({ colors }: { colors: string[] }) {
  return (
    <div className="flex h-2.5 flex-1 min-w-24 overflow-hidden rounded-sm">
      {colors.map((c, i) => <span key={i} className="flex-1" style={{ background: c }} />)}
    </div>
  );
}

function VolumeLegend() {
  const steps = Array.from({ length: 9 }, (_, i) => volColor(i / 8));
  return (
    <div className="mt-2.5 flex items-center gap-2.5 text-[0.62rem] uppercase tracking-widest text-ink-muted">
      <span className="shrink-0">Fewer</span>
      <Swatches colors={steps} />
      <span className="shrink-0">More attempts</span>
    </div>
  );
}

function AccuracyLegend({ label }: { label: string }) {
  // Drawn with diffColor over evenly spaced values across the domain, so the
  // strip is a true key even with the gamma applied.
  const D = DIFF_DOMAIN * 100;
  const steps = Array.from({ length: 13 }, (_, i) => diffColor((i / 12) * 2 * DIFF_DOMAIN - DIFF_DOMAIN));
  return (
    <div className="mt-2.5">
      <div className="flex items-center gap-2.5 text-[0.62rem] uppercase tracking-widest text-ink-muted">
        <span className="shrink-0 tabular">−{D}</span>
        <Swatches colors={steps} />
        <span className="shrink-0 tabular">+{D}</span>
      </div>
      <div className="mt-1 text-[0.62rem] text-ink-muted text-center">FG% vs D-I {label} from the same spot</div>
    </div>
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
