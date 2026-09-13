import { getTeamColors } from "@/lib/team-colors";

/**
 * Two colors for one matchup, each team in its own palette wherever the two can
 * be told apart. Out of src/components/box/game-box-modal.tsx, which re-exports
 * it, so the desktop app's game page draws the same two sides as the site's.
 */

/**
 * Fallback side colors, used when a team has no palette entry. Real team
 * colors come from getTeamColors() — the same source the team pages use — so
 * a Michigan/UCLA box reads maize vs blue rather than generic coral vs steel.
 */
export const SIDE_A = "var(--coral)";
export const SIDE_B = "#3e7cb1";

/**
 * Neutral second-side colors, spread around the hue wheel. Reached only when
 * NO combination of the two teams' own palettes is distinguishable, which is
 * now rare — see sideColors().
 */
const FALLBACK_HUES: string[] = ["#c8553d", "#2d8a8a", "#c98a2d", "#6b5ca5", "#4a7c59", SIDE_B];

/**
 * Two visually distinguishable colors for one matchup, keeping BOTH teams in
 * their own palette wherever that is possible.
 *
 * Blue-on-blue is the norm in this sport, not the exception: Duke/North
 * Carolina, Kansas/Kentucky, Michigan/UCLA and Gonzaga/Saint Mary's all
 * resolve to two blues. The old rule handed the second team a neutral fallback
 * hue as soon as the primaries clashed, which is why a Duke bar came out
 * brick-red — a color Duke has never worn.
 *
 * Most of those clashes have a better answer inside the two palettes. Carolina
 * pairs a very dark navy primary with sky blue; against Duke's royal blue the
 * navy is unreadable but the sky blue is unmistakable, and both teams stay in
 * their own colors. So the pairs are tried in preference order — both
 * primaries, then one side's secondary, then the other's — and only a matchup
 * with no workable combination falls through to a neutral hue.
 */
export function sideColors(teamA: string, teamB: string): [string, string] {
  const a = getTeamColors(teamA);
  const b = getTeamColors(teamB);
  const aP = a?.primary, aS = a?.secondary;
  const bP = b?.primary, bS = b?.secondary;

  const pairs: Array<[string | undefined, string | undefined]> = [
    [aP, bP], [aP, bS], [aS, bP], [aS, bS],
  ];
  for (const [x, y] of pairs) {
    if (!usable(x) || !usable(y)) continue;
    if (!tooClose(x!, y!)) return [x!, y!];
  }

  // No combination of the two palettes works. Keep side A honest and walk the
  // neutral hues for side B rather than making both teams wrong.
  const ca = usable(aP) ? aP! : SIDE_A;
  const cb = FALLBACK_HUES.find((c) => !tooClose(ca, c)) ?? SIDE_B;
  return [ca, cb];
}

/**
 * Can this color carry meaning on the page at all?
 *
 * Rejects the near-whites that half the palettes list as a secondary — white
 * on warm paper is not a color, it is an absence — and anything with no hue
 * to speak of, which would read as a gray bar rather than as a team.
 */
function usable(hex: string | undefined): boolean {
  if (typeof hex !== "string" || hex.length === 0) return false;
  const c = hsl(hex);
  if (!c) return false;
  return c.l <= 0.82 && (c.s >= 0.12 || c.l <= 0.35);
}

/**
 * Are two colors too similar to tell apart across a chart?
 *
 * Compares HUE, not RGB distance. RGB distance passes pairs like Michigan navy
 * (#00274C) against a mid-blue: numerically far apart because one is much
 * darker, but both unmistakably "blue" once they're two bars in the same row.
 * Hue catches that; a low-saturation color (near-black, near-white, gray) has
 * no meaningful hue, so those are compared on lightness instead.
 */
function hsl(h: string): { h: number; s: number; l: number } | null {
  const s = h.replace("#", "");
  if (s.length !== 6) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const sat = d / (1 - Math.abs(2 * l - 1));
  let hue: number;
  if (max === r) hue = ((g - b) / d) % 6;
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  return { h: ((hue * 60) + 360) % 360, s: sat, l };
}

function tooClose(x: string, y: string): boolean {
  const p = hsl(x), q = hsl(y);
  if (!p || !q) return false;
  const dl = Math.abs(p.l - q.l);
  // Either color effectively grayscale → judge on lightness only.
  if (p.s < 0.15 || q.s < 0.15) return dl < 0.25;
  const dh = Math.min(Math.abs(p.h - q.h), 360 - Math.abs(p.h - q.h));
  // A big lightness gap separates two colors even at the same hue —
  // Carolina sky blue against Duke royal is four degrees apart and nobody has
  // ever confused them. Judging on hue alone was what pushed same-family
  // matchups onto fallback colors neither team wears.
  if (dl >= 0.24) return false;
  return dh < 45;
}
