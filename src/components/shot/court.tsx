"use client";

import { useId } from "react";
import { W, H, RIM_X, RIM_Y, THREE_R, CORNER_X, CORNER_Y } from "@/lib/shot-zones";

/**
 * The half court, and the two colour scales drawn on it.
 *
 * Extracted from the player-page chart when the team chart arrived, for the
 * same reason lib/shot-zones.ts exists: a court drawn in two files is a court
 * that will eventually disagree with itself. The lane, the arc and the
 * restricted area are geometry, not styling — a second copy that drifts by a
 * few units would put a team's threes on a different line from its own
 * players' threes, on pages a reader moves between in one click.
 *
 * Both charts also have to agree on what a colour MEANS. Red is hot on both,
 * the volume ramp is one hue on both, and the diverging domain is the same
 * number of percentage points on both — otherwise the same shade would say
 * different things one page apart.
 */

// Light, grainy canvas. The court used to be a navy slab, which forced every
// mark to be a glow on darkness; on warm paper the same marks read as ink and
// the line work stops fighting the shots.
export const COURT_BG = "#e8e3d8";
export const LINE = "rgba(26,34,56,0.30)";

// Volume ramp — pale sand through to deep brick. Single hue, so it reads as
// one quantity getting bigger; the accuracy view is the only place hue itself
// carries meaning.
export const VOL_RAMP: [number, number, number][] = [
  [0xf2, 0xe3, 0xcd],
  [0xe2, 0x82, 0x4a],
  [0x9c, 0x2f, 0x1d],
];

/**
 * Accuracy diverging scale: blue = cold (below the comparison), red = hot.
 *
 * This deliberately inverts the site's --good/--bad semantics, where red means
 * trouble. On a shot chart red-is-hot is the older and stronger convention
 * (it's what every heat map in the sport uses), and the scale is read as
 * temperature, not as a verdict.
 *
 * ON A DEFENSIVE CHART THE VERDICT FLIPS BUT THE SCALE DOES NOT. Red still
 * means shots are going in from there; for the defence that is bad. Recolouring
 * defence would break the one thing a reader can carry between the two views —
 * that red is where the ball goes in — so the label says whose shooting it is
 * and the colour keeps meaning the same physical fact.
 */
export const COLD: [number, number, number] = [0x1f, 0x5e, 0x9e];
export const NEUTRAL: [number, number, number] = [0xf4, 0xf1, 0xe8];
export const HOT: [number, number, number] = [0xbd, 0x2f, 0x24];
export const COLD_HEX = "#1f5e9e";
export const HOT_HEX = "#bd2f24";

/**
 * Half-width of the colour scale, in percentage points of FG%.
 *
 * Measured, not guessed, and re-measured whenever the bin radius moves — a
 * coarser grid puts more attempts behind each cell, which survives shrinkage
 * and widens the spread. At r=22, across 600 qualifying 2026 players (38,050
 * cells), the shrunk difference is |1.9| points at the median, |4.7| at p90,
 * |5.8| at p95. An early ±10 domain left the typical cell using 16% of the
 * scale, which is exactly why the court first read as washed out.
 */
export const DIFF_DOMAIN = 0.06;

/**
 * Slight gamma on the ramp, lifting mid-range cells further out of the paper.
 * Safe to apply because every legend is drawn by this same function over evenly
 * spaced values — any monotone curve stays self-consistent, so matching a hex
 * against the legend still reads the right number off it.
 */
export const DIFF_GAMMA = 0.8;

export const mix = (a: [number, number, number], b: [number, number, number], t: number) =>
  `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;

export function volColor(t: number): string {
  const c = Math.max(0, Math.min(1, t));
  return c < 0.5 ? mix(VOL_RAMP[0]!, VOL_RAMP[1]!, c * 2) : mix(VOL_RAMP[1]!, VOL_RAMP[2]!, (c - 0.5) * 2);
}

export function diffColor(d: number): string {
  const t = Math.max(-1, Math.min(1, d / DIFF_DOMAIN));
  const s = Math.pow(Math.abs(t), DIFF_GAMMA);
  return t < 0 ? mix(NEUTRAL, COLD, s) : mix(NEUTRAL, HOT, s);
}

/** Shared court frame: grainy floor, then children (the marks), then line work. */
export function Court({
  children, label, overlay, onPointerLeave,
}: {
  children: React.ReactNode;
  label: string;
  /** Drawn ABOVE the line work — hover rings, callouts, anything that must not
   *  be buried under the court markings. */
  overlay?: React.ReactNode;
  onPointerLeave?: () => void;
}) {
  // useId keeps the filter unique — several of these can render at once, and a
  // duplicated id would make them share one (or neither) grain.
  const uid = useId().replace(/:/g, "");
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-auto rounded-lg"
      role="img"
      aria-label={label}
      onPointerLeave={onPointerLeave}
    >
      <defs>
        {/* TV-static floor. fractalNoise + full desaturation gives gray grain;
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
        {overlay}
      </g>
      <rect width={W} height={H} rx={8} fill="none" stroke="rgba(26,34,56,0.14)" />
    </svg>
  );
}
