/**
 * A readable color for each side of a matchup, told apart from the other.
 *
 * Used by the site's Matchup Predictor and the desktop app's, so both pick the
 * same two colors for the same pairing.
 */

import { getTeamColors, readableInk, readableOnPaper } from "@/lib/team-colors";

export type Ink = { light: string; dark: string; brand: string };

function inkOf(hex: string | undefined): Ink {
  if (!hex) return { light: "var(--coral)", dark: "var(--coral)", brand: "var(--coral)" };
  // Light: the site's contrast-targeted clamp against the cream paper. Dark:
  // the same hue lifted into a lightness band that clears 4.5:1 on #1C1C1C.
  // Brand: the color as printed, for fills that nobody has to read.
  return { light: readableOnPaper(hex), dark: readableInk(hex, { min: 0.6, max: 0.78 }), brand: hex };
}

/** Hue in degrees, or null for a color with no hue to speak of. */
function hueOf(hex: string): number | null {
  const s = hex.replace("#", "");
  if (s.length !== 6) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255) as [number, number, number];
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d < 0.08) return null;                       // effectively gray
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

/** Shortest distance around the hue circle. */
const hueDist = (a: number, b: number) => { const d = Math.abs(a - b); return Math.min(d, 360 - d); };

/**
 * Would these two read as the same color?
 *
 * Two grays do. A gray against a real color does not — that pair is already
 * as separated as it needs to be. Otherwise it is a question of hue.
 */
function collides(x: string, y: string): boolean {
  const a = hueOf(x), b = hueOf(y);
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return hueDist(a, b) < 22;
}

/**
 * A COLOR FOR EACH SIDE THAT CAN BE TOLD APART.
 *
 * The whole card is two washes meeting at a seam, which only works if the two
 * washes are different colors. Across the 365 teams on offer, 19% of possible
 * pairings have primary hues within 20° of each other — Illinois and Wake
 * Forest are 2° apart, Iowa and Northern Iowa are both gold — and those
 * matchups drew as one continuous block with a line through it.
 *
 * The left team always keeps its primary; it is the one the reader picked
 * first. The right team gives way, in order: its own secondary when that has
 * a real hue and separates, otherwise a neutral chosen to sit as far from the
 * left team's hue as the small set allows. The neutrals belong to no school,
 * so nobody is given a color they do not own, and the logo and the name still
 * say who it is.
 *
 * The neutral has to be PICKED, not fixed. A single slate is itself a navy,
 * so Duke against New Hampshire — two navies, whose only other color is a
 * light gray that cannot carry text on cream — would have swapped one
 * collision for another.
 */
const NEUTRALS = ["#8a6a4a", "#5b6472", "#6b4a6b"];

function neutralAgainst(pa: string): string {
  const ha = hueOf(pa);
  if (ha == null) return NEUTRALS[1]!;
  let best = NEUTRALS[0]!, bestD = -1;
  for (const f of NEUTRALS) {
    const hf = hueOf(f);
    const d = hf == null ? 0 : hueDist(ha, hf);
    if (d > bestD) { bestD = d; best = f; }
  }
  return best;
}

export function pairInks(aName: string, bName: string): { a: Ink; b: Ink } {
  const ca = getTeamColors(aName), cb = getTeamColors(bName);
  const pa = ca?.primary, pb = cb?.primary;
  if (!pa || !pb) return { a: inkOf(pa), b: inkOf(pb) };
  if (!collides(pa, pb)) return { a: inkOf(pa), b: inkOf(pb) };
  // A gray secondary is not a substitute: readableOnPaper has no hue to
  // rebuild from and falls back to near-black, which is not a team color at
  // all and reads as broken next to a real one.
  const usable = (c?: string) => !!c && hueOf(c) != null;
  const sb = cb?.secondary, sa = ca?.secondary;
  if (usable(sb) && !collides(pa, sb!)) return { a: inkOf(pa), b: inkOf(sb) };
  // TRY THE LEFT TEAM'S SECONDARY BEFORE GIVING ANYONE A NEUTRAL. Iowa and
  // Northern Iowa are both gold; Iowa's other color is black, which is not
  // usable, but Northern Iowa's is purple. Moving the team that HAS a second
  // color keeps two real ones on the card, and it stops the result depending
  // on which side of the swap button you happen to be looking at.
  if (usable(sa) && !collides(sa!, pb)) return { a: inkOf(sa), b: inkOf(pb) };
  return { a: inkOf(pa), b: inkOf(neutralAgainst(pa)) };
}
