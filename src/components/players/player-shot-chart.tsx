"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { hexbin as d3hexbin } from "d3-hexbin";
import { cn } from "@/lib/utils";
import { dataUrl } from "@/lib/data-url";
import { StatInfo } from "@/components/players/stat-info";
import {
  ShotProfileFallbackCard, useShotProfile, seasonLabel,
} from "@/components/players/player-shot-impact";

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
  // and the right-hand chart simply sits out if it never arrives.
  useEffect(() => {
    let cancelled = false;
    fetch(dataUrl("/data/shot-baselines.json"))
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Baselines | null) => { if (!cancelled) setBase(j); })
      .catch(() => { if (!cancelled) setBase(null); });
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
    <section className="mx-auto max-w-7xl px-6 lg:px-10 mt-8">
      <div className="bg-card border-y border-x-0 lg:border-x border-ink/10 rounded-none lg:rounded-xl shadow-md overflow-hidden ring-1 ring-ink/5 -mx-6 lg:mx-0">
        <div className="h-1 w-full bg-gradient-to-r from-coral via-coral to-coral/60" />
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
                    cells={cells}
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
const W = 500, H = 400;
// NCAA line work: 12ft lane, 19ft FT line, 6ft FT circle, 4ft restricted arc,
// 22'1.75" arc with corner lines 3.35ft off each sideline.
const THREE_R = 221.5, CORNER_X = 33.5;
// Where the corner line meets the arc: sqrt(r² − (250−33.5)²) below the rim.
const CORNER_Y = RIM_Y + Math.sqrt(THREE_R * THREE_R - (RIM_X - CORNER_X) * (RIM_X - CORNER_X));

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
 * THIRTEEN NAMED ZONES, replacing the hex grid on the accuracy court.
 *
 * The hexes were honest but they answered the wrong question. A hex is an
 * arbitrary patch of floor, so "you are cold in this hex" is not a sentence
 * about basketball, and a player's attempts scatter across dozens of them
 * thinly enough that most cells were mostly shrinkage. Zones are how shooting
 * is actually discussed — corner three, left wing, at the rim — and pooling a
 * whole zone's attempts means the rate underneath the colour is worth reading.
 *
 * LEFT AND RIGHT ARE THE VIEWER'S, matching the court as drawn: x below the rim
 * is left. That is the same convention as every public shot chart, and it is
 * the opposite of the shooter's own left, which is why it is stated here.
 */
const CLOSE_R = 80; // 8 ft — the paint, near enough

const ZONES = [
  // The close trio sits wider apart than the shots themselves do. A big man
  // takes most of his attempts here, so all three pucks run near maximum radius
  // and anything tighter overlaps into one blob.
  { id: "close_l",      label: "Close Left",     short: "Close L",  x: 156, y: 66 },
  { id: "close_m",      label: "Close Middle",   short: "Close M",  x: 250, y: 104 },
  { id: "close_r",      label: "Close Right",    short: "Close R",  x: 344, y: 66 },
  { id: "mid_corner_l", label: "Mid Corner Left",  short: "Mid Cnr L",  x: 62,  y: 72 },
  { id: "mid_wing_l",   label: "Mid Wing Left",    short: "Mid Wing L", x: 112, y: 172 },
  { id: "mid_mid",      label: "Mid Middle",       short: "Mid M",      x: 250, y: 196 },
  { id: "mid_wing_r",   label: "Mid Wing Right",   short: "Mid Wing R", x: 388, y: 172 },
  { id: "mid_corner_r", label: "Mid Corner Right", short: "Mid Cnr R",  x: 438, y: 72 },
  { id: "3_corner_l",   label: "3PT Corner Left",  short: "3 Cnr L",  x: 17,  y: 60 },
  { id: "3_wing_l",     label: "3PT Wing Left",    short: "3 Wing L", x: 68,  y: 258 },
  { id: "3_mid",        label: "3PT Middle",       short: "3 Mid",    x: 250, y: 305 },
  { id: "3_wing_r",     label: "3PT Wing Right",   short: "3 Wing R", x: 432, y: 258 },
  { id: "3_corner_r",   label: "3PT Corner Right", short: "3 Cnr R",  x: 483, y: 60 },
] as const;

type ZoneId = (typeof ZONES)[number]["id"];

/**
 * Which zone a shot came from.
 *
 * `is3` comes from the data flag rather than the geometry wherever we have it,
 * because the feed knows what the officials counted and a shot taken with a toe
 * on the line should not be re-adjudicated by trigonometry.
 */
function zoneOf(x: number, y: number, is3: boolean): ZoneId {
  const dx = x - RIM_X;
  // Shots from behind the backboard get clamped onto the baseline rather than
  // wrapping past 180 degrees into the wrong side of the court.
  const dy = Math.max(y - RIM_Y, 0);
  const t = (Math.atan2(dy, dx) * 180) / Math.PI; // 180 = far left, 0 = far right

  if (is3) {
    // Corner threes are the strip outside the straight segment, so they are
    // bounded by where the arc meets it — not by an angle.
    if (y <= CORNER_Y) return x < RIM_X ? "3_corner_l" : "3_corner_r";
    if (t >= 112.5) return "3_wing_l";
    if (t <= 67.5) return "3_wing_r";
    return "3_mid";
  }
  if (Math.hypot(dx, dy) <= CLOSE_R) {
    if (t >= 120) return "close_l";
    if (t <= 60) return "close_r";
    return "close_m";
  }
  if (t >= 157.5) return "mid_corner_l";
  if (t >= 112.5) return "mid_wing_l";
  if (t > 67.5) return "mid_mid";
  if (t > 22.5) return "mid_wing_r";
  return "mid_corner_r";
}

/** Geometry-only 3PT test, for baseline cells — they carry no made/3PT flag. */
const cellIs3 = (x: number, y: number) =>
  y <= CORNER_Y
    ? x <= CORNER_X || x >= W - CORNER_X
    : Math.hypot(x - RIM_X, y - RIM_Y) >= THREE_R;

type ZoneBin = {
  zone: (typeof ZONES)[number];
  made: number;
  att: number;
  baseRate: number | null;
  diff: number | null;
};

/**
 * Player attempts and cohort baseline, both pooled by zone.
 *
 * The baseline arrives as per-hex [made, attempts] pairs, so it is re-pooled
 * through the same classifier — summing the cohort's counts rather than
 * averaging its rates, so a zone's baseline is weighted by where the cohort
 * actually shoots inside it.
 */
function zoneBins(shots: ShotRow[], cells: Record<string, [number, number]>): ZoneBin[] {
  const own = new Map<ZoneId, { made: number; att: number }>();
  for (const s of shots) {
    const z = zoneOf(s[CX], s[CY], s[IS3] === 1);
    const cur = own.get(z) ?? { made: 0, att: 0 };
    cur.made += s[MADE];
    cur.att += 1;
    own.set(z, cur);
  }

  const base = new Map<ZoneId, { made: number; att: number }>();
  for (const [key, [m, a]] of Object.entries(cells)) {
    const comma = key.indexOf(",");
    const x = Number(key.slice(0, comma));
    const y = Number(key.slice(comma + 1));
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const z = zoneOf(x, y, cellIs3(x, y));
    const cur = base.get(z) ?? { made: 0, att: 0 };
    cur.made += m;
    cur.att += a;
    base.set(z, cur);
  }

  return ZONES.map((zone) => {
    const o = own.get(zone.id) ?? { made: 0, att: 0 };
    const b = base.get(zone.id);
    const baseRate = b && b.att > 0 ? b.made / b.att : null;
    // Same stabilizer as the hexes used: equals the raw difference once the
    // attempts pile up, and collapses toward zero when they don't.
    const diff =
      baseRate === null || o.att === 0
        ? null
        : (o.made - o.att * baseRate) / (o.att + SHRINK_K);
    return { zone, made: o.made, att: o.att, baseRate, diff };
  });
}

function ZoneAccuracyChart({
  shots, cells, label,
}: {
  shots: ShotRow[]; cells: Record<string, [number, number]>; label: string;
}) {
  const bins = useMemo(() => zoneBins(shots, cells), [shots, cells]);
  // Radius tracks attempts by area, against the busiest zone, with a floor big
  // enough to still hold a percentage and a ceiling that keeps the rim puck
  // from swallowing its neighbours.
  const maxAtt = useMemo(() => bins.reduce((m, b) => Math.max(m, b.att), 0), [bins]);
  const [hover, setHover] = useState<ZoneId | null>(null);
  const active = hover === null ? null : bins.find((b) => b.zone.id === hover) ?? null;

  return (
    <div className="relative" onMouseLeave={() => setHover(null)}>
      <Court label="Shooting accuracy by zone versus position-group average">
        {bins.map((b) => {
          const t = maxAtt > 0 ? Math.sqrt(b.att / maxAtt) : 0;
          const rr = 15 + 19 * t;
          const on = hover === b.zone.id;
          const empty = b.att === 0;
          // Corner zones sit close enough to the sideline that a busy one would
          // hang off the court. Nudge any puck back inside rather than letting
          // it clip — the position is a label, not a measurement.
          const cx = Math.min(Math.max(b.zone.x, rr + 2), W - rr - 2);
          const cy = Math.min(Math.max(b.zone.y, rr + 2), H - rr - 2);
          return (
            <g
              key={b.zone.id}
              transform={`translate(${cx},${cy})`}
              onMouseEnter={() => setHover(b.zone.id)}
              role="img"
              aria-label={zoneSummary(b, label)}
            >
              <circle
                r={empty ? 13 : rr}
                fill={b.diff === null ? "rgba(26,34,56,0.05)" : diffColor(b.diff)}
                stroke={on ? "rgba(26,34,56,0.85)" : "rgba(26,34,56,0.22)"}
                strokeWidth={on ? 2 : 0.8}
              />
              {!empty && (
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="pointer-events-none select-none"
                  style={{
                    fontSize: Math.max(11, Math.min(15, rr * 0.62)),
                    fontWeight: 700,
                    fill: "#12203c",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {Math.round((100 * b.made) / b.att)}
                </text>
              )}
            </g>
          );
        })}
      </Court>
      {active && <ZoneTooltip b={active} label={label} />}
    </div>
  );
}

/** Same card as the hex tooltip, reading a zone instead of a patch of floor. */
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
        </>
      )}
    </div>
  );
}

function zoneSummary(b: ZoneBin, label: string): string {
  if (b.att === 0) return `${b.zone.label}: no attempts`;
  const own = `${b.made} of ${b.att} (${pct1(b.made / b.att)})`;
  return b.baseRate === null
    ? `${b.zone.label}: ${own}, no baseline here`
    : `${b.zone.label}: ${own} versus D-I ${label} at ${pct1(b.baseRate)}`;
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
