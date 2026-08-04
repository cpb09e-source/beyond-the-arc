/**
 * The thirteen shot zones, in one place.
 *
 * Imported by BOTH the player-page chart and scripts/build-shot-zone-baselines.mts,
 * because a classifier that lives in two files is a classifier that will
 * eventually disagree with itself: the cohort baseline would be pooled by one
 * definition of "left wing" and the player's own attempts by another, and the
 * comparison would quietly stop being a comparison.
 *
 * Court units are tenths of a foot on a 500x400 half court, matching the shot
 * files. LEFT AND RIGHT ARE THE VIEWER'S, as the court is drawn: x below the rim
 * is left. That is the usual shot-chart convention and the opposite of the
 * shooter's own left, which is why it is written down.
 */

export const W = 500;
export const H = 400;
export const RIM_X = 250;
export const RIM_Y = 52.5;
export const THREE_R = 221.5;
export const CORNER_X = 33.5;
export const CORNER_Y = RIM_Y + Math.sqrt(THREE_R * THREE_R - (RIM_X - CORNER_X) * (RIM_X - CORNER_X));

/** 8 ft: the paint, near enough. */
export const CLOSE_R = 80;

export type ZoneId =
  | "close_l" | "close_m" | "close_r"
  | "mid_corner_l" | "mid_wing_l" | "mid_mid" | "mid_wing_r" | "mid_corner_r"
  | "3_corner_l" | "3_wing_l" | "3_mid" | "3_wing_r" | "3_corner_r";

export type Zone = {
  id: ZoneId;
  /** Full name, for tooltips and table rows. */
  label: string;
  /** Compact name, for tight labels on the court. */
  short: string;
  /** Which band it belongs to, for grouping in list-shaped layouts. */
  band: "close" | "mid" | "three";
  /**
   * Where this zone's label sits. These are INSIDE the zone's own region, which
   * sounds obvious and was not true of the first pass: the points were tuned
   * when zones were drawn as floating bubbles, and close_l at (156, 66) is 95
   * units from the rim, outside the 80-unit close radius. Drawn as regions, its
   * label printed on top of the mid-range zone next door.
   *
   * Derived from the geometry rather than nudged by eye: mid-angle of the
   * wedge, at a radius comfortably inside the band.
   */
  x: number;
  y: number;
  /**
   * A corner-three strip is 3.35 ft of a 50 ft floor, about 33 units wide, and
   * a full-size number with a chip under it does not fit. These render smaller.
   */
  compact?: boolean;
};

export const ZONES: Zone[] = [
  // Close: mid-angle at r≈48, well inside CLOSE_R.
  { id: "close_l", label: "Close Left", short: "Close L", band: "close", x: 208, y: 77 },
  { id: "close_m", label: "Close Middle", short: "Close M", band: "close", x: 250, y: 104 },
  { id: "close_r", label: "Close Right", short: "Close R", band: "close", x: 292, y: 77 },
  // Mid: mid-angle at r≈150, between CLOSE_R and the arc.
  { id: "mid_corner_l", label: "Mid Corner Left", short: "Cnr L", band: "mid", x: 103, y: 81 },
  { id: "mid_wing_l", label: "Mid Wing Left", short: "Wing L", band: "mid", x: 144, y: 158 },
  { id: "mid_mid", label: "Mid Middle", short: "Middle", band: "mid", x: 250, y: 202 },
  { id: "mid_wing_r", label: "Mid Wing Right", short: "Wing R", band: "mid", x: 356, y: 158 },
  { id: "mid_corner_r", label: "Mid Corner Right", short: "Cnr R", band: "mid", x: 397, y: 81 },
  // Three: mid-angle at r≈245-265, outside the arc and inside the court.
  { id: "3_corner_l", label: "3PT Corner Left", short: "Cnr L", band: "three", x: 17, y: 58, compact: true },
  { id: "3_wing_l", label: "3PT Wing Left", short: "Wing L", band: "three", x: 77, y: 226 },
  { id: "3_mid", label: "3PT Top", short: "Top", band: "three", x: 250, y: 315 },
  { id: "3_wing_r", label: "3PT Wing Right", short: "Wing R", band: "three", x: 423, y: 226 },
  { id: "3_corner_r", label: "3PT Corner Right", short: "Cnr R", band: "three", x: 483, y: 58, compact: true },
];

export const BAND_LABEL: Record<Zone["band"], string> = {
  close: "Close",
  mid: "Mid-range",
  three: "Three",
};

/**
 * Which zone a shot came from.
 *
 * `is3` should come from the data's own flag wherever it exists rather than
 * from the geometry: the feed knows what the officials counted, and a shot
 * taken with a toe on the line should not be re-adjudicated by trigonometry.
 * Pass `geomIs3(x, y)` only for points that carry no flag, such as cohort cells.
 */
export function zoneOf(x: number, y: number, is3: boolean): ZoneId {
  const dx = x - RIM_X;
  // Shots from behind the backboard clamp onto the baseline rather than
  // wrapping past 180 degrees into the wrong side of the court.
  const dy = Math.max(y - RIM_Y, 0);
  const t = (Math.atan2(dy, dx) * 180) / Math.PI; // 180 = far left, 0 = far right

  if (is3) {
    // A corner three is the strip outside the straight segment, so it is
    // bounded by where the arc meets that segment, not by an angle.
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

/** Geometry-only 3PT test, for points that carry no flag of their own. */
export function geomIs3(x: number, y: number): boolean {
  return y <= CORNER_Y
    ? x <= CORNER_X || x >= W - CORNER_X
    : Math.hypot(x - RIM_X, y - RIM_Y) >= THREE_R;
}

/**
 * Percentile of `rate` against a sorted ascending array of cohort rates,
 * carried in the baselines file as 101 breakpoints (p0 … p100).
 *
 * Linear scan rather than a binary search: 101 elements, called 13 times.
 */
export function percentileFrom(q: number[] | undefined, rate: number | null): number | null {
  if (!q || q.length === 0 || rate === null) return null;
  let lo = 0;
  while (lo < q.length && q[lo]! < rate) lo++;
  return Math.round((100 * lo) / (q.length - 1));
}
