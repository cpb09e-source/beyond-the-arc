/**
 * The contender zone — a trapezoid over adjusted tempo and adjusted net rating.
 *
 * THE IDEA IS RYAN HAMMER'S, not ours. His "Trapezoid of Excellence" plots pace
 * against adjusted net rating and draws a shape around the profiles national
 * champions have actually had: very efficient, and not living at either extreme
 * of tempo. The argument is that pace versatility survives six tournament games
 * against six different styles, so a team at an extreme has to be MORE efficient
 * to belong — which is why the shape is narrow at the bottom and widens as it
 * rises. A slow Houston qualifies because its efficiency is absurd; a fast
 * Alabama with merely very good efficiency does not.
 *
 * THE NUMBERS ARE OURS, and they have to be. Hammer's charts are drawn on CBB
 * Analytics' net rating; ours is a different column on a different scale — the
 * top of 2025 reads about four points hotter here than on his graphic, and the
 * same team sits in a different place. Copying his printed cutoff onto our axis
 * would draw a shape that means nothing about our data. So the zone is derived
 * from the season it is drawn on, by three rules:
 *
 *   FLOOR — the 12th-best adjusted net rating in Division I that season. A rank
 *   rather than a fixed number, because the ceiling of the sport moves: 2024's
 *   twelfth team was +23.4 and 2026's is +28.3. A fixed floor would have let in
 *   twenty-five teams in a strong year and six in a weak one, and the shape is
 *   meant to mean "the very top", not "above some number we picked in 2024".
 *
 *   CENTRE — the season's mean adjusted tempo, which is the definition of not
 *   being at an extreme. It sits near 67.4 every year and moves by a tenth or
 *   two, but deriving it costs nothing and removes the assumption.
 *
 *   WIDTH — 3.2 possessions either side at the floor, opening by 0.26 more per
 *   point of net rating above it. Both were fitted against the seasons we hold,
 *   not chosen for roundness: they are the narrowest pair that puts every 2025
 *   Final Four team inside — Houston at 61.8 possessions included, which is the
 *   whole point of the slant — while still cutting the fastest team in the
 *   country. They give nine to eleven teams a season across 2022, 2024, 2025 and
 *   2026, and the champion is inside in all three of those with one.
 *
 * There is no top edge. The shape is a wedge from the floor upward and the chart
 * clips it at the frame, which is what makes it read as a trapezoid — the same
 * way the original does.
 *
 * FIVE SEASONS CANNOT CARRY THIS SHAPE, and they take themselves off it. CBBD's
 * adjusted ratings are broken for 2014, 2017, 2018, 2020 and 2023 — 2023 fits
 * the whole league into seven points, 2020 looks normal and describes a season
 * that did not happen — so extractMetrics nulls `net_rtg_adj` there. buildZone
 * needs twelve finite values and will not find them, returns null, and the
 * chart falls back to a plain scatter with no zone. Nothing special-cases a
 * year. See lib/cbbd-rating-trust.ts.
 */

import type { Metric } from "@/lib/team-scatter-metrics";

/** The zone is only meaningful on these two axes, in this order. */
export const ZONE_X = "adjt";
export const ZONE_Y = "net_rtg_adj";

/** Nth-best net rating in D-I sets the floor. See the note above. */
const FLOOR_RANK = 12;
/** Possessions either side of mean tempo at the floor. */
const HALF_AT_FLOOR = 3.2;
/** Extra possessions of half-width per net-rating point above the floor. */
const WIDEN_PER_POINT = 0.26;

export type Zone = {
  /** Net rating of the bottom edge. */
  floor: number;
  /** Mean adjusted tempo — the shape's axis of symmetry. */
  centre: number;
  /** Half-width in possessions at a given net rating. */
  halfAt: (net: number) => number;
  contains: (tempo: number | null | undefined, net: number | null | undefined) => boolean;
};

type HasMetrics = { m: Record<string, number | null> };

/**
 * Build the zone from the WHOLE field, never from the selection.
 *
 * Both the floor and the centre are claims about Division I — "the twelfth-best
 * team in the country", "average pace" — and rederiving them from whichever
 * fourteen teams the reader has on screen would make the shape move when the
 * selection did. A landmark that follows you around is not a landmark.
 */
export function buildZone(all: HasMetrics[]): Zone | null {
  const tempos: number[] = [];
  const nets: number[] = [];
  for (const t of all) {
    const tempo = t.m[ZONE_X], net = t.m[ZONE_Y];
    if (typeof tempo === "number") tempos.push(tempo);
    if (typeof net === "number") nets.push(net);
  }
  if (tempos.length < 50 || nets.length < FLOOR_RANK) return null;

  const centre = tempos.reduce((s, v) => s + v, 0) / tempos.length;
  const floor = nets.sort((a, b) => b - a)[FLOOR_RANK - 1]!;
  const halfAt = (net: number) => HALF_AT_FLOOR + WIDEN_PER_POINT * Math.max(0, net - floor);

  return {
    floor,
    centre,
    halfAt,
    contains: (tempo, net) =>
      typeof tempo === "number" && typeof net === "number"
      && net >= floor && Math.abs(tempo - centre) <= halfAt(net),
  };
}

/** Does this pair of axes carry the zone? Order matters — tempo across. */
export function zoneAxes(xM: Metric, yM: Metric): boolean {
  return xM.key === ZONE_X && yM.key === ZONE_Y;
}

/**
 * The wedge as data-space corners, from the floor to `top`.
 *
 * Returned bottom-left, bottom-right, top-right, top-left so it maps straight to
 * a polygon. Null when the visible range never reaches the floor — there is no
 * shape to draw on a plot that stops below it.
 */
export function zonePolygon(z: Zone, top: number): [number, number][] | null {
  if (!(top > z.floor)) return null;
  const hb = z.halfAt(z.floor), ht = z.halfAt(top);
  return [
    [z.centre - hb, z.floor],
    [z.centre + hb, z.floor],
    [z.centre + ht, top],
    [z.centre - ht, top],
  ];
}
