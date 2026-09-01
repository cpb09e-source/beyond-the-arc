import cbbTeams from "@/data/cbb-team-ids.json";

/**
 * Per-team color theming, automatically derived from `cbb-team-ids.json`
 * (which has color1/color2 for all 366 D-I teams) with a hand-curated
 * override map for teams where the source primary isn't the canonical
 * brand color (e.g. Kansas's color1 is the gold accent, not the iconic
 * Kansas Blue).
 *
 * Used on team pages for: eyebrow + accent line, BTA Rank badge background,
 * current-season row tint, link hover/text color, and any --accent /
 * --accent-tint CSS variable references throughout the page.
 */

export type TeamColors = {
  primary: string;
  secondary?: string;
  onPrimary: string;
};

type CbbEntry = {
  bart_name: string;
  color1: string;
  color2: string;
};

const TEAMS = cbbTeams as Record<string, CbbEntry>;

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Hand-curated overrides — teams whose source colors aren't the canonical
// brand primary (e.g. Kansas's c1 is gold, not Kansas Blue). Use sparingly:
// the brand-score heuristic already prefers chromatic over near-black, so
// only override when the auto-pick still misses (e.g. teams whose two
// source colors are both shades of the same family, or where the canonical
// brand color isn't in the cbb-team-ids entry at all).
const OVERRIDES: Record<string, TeamColors> = {
  // Brand primary is the alternate color (not c1 of cbb-team-ids).
  "Kansas":          { primary: "#0051BA", secondary: "#E8000D", onPrimary: "#fff" },
  "Michigan":        { primary: "#00274C", secondary: "#FFCB05", onPrimary: "#fff" },
  "Gonzaga":         { primary: "#041E42", secondary: "#C8102E", onPrimary: "#fff" },
  "Creighton":       { primary: "#0d3576", secondary: "#bbbbbb", onPrimary: "#fff" },
  "Baylor":          { primary: "#154734", secondary: "#FFB81C", onPrimary: "#fff" },
  "Butler":          { primary: "#13294B", secondary: "#A0A0A0", onPrimary: "#fff" },
  "North Carolina":  { primary: "#13294B", secondary: "#7BAFD4", onPrimary: "#fff" },
  "Mississippi St.": { primary: "#5D1725", secondary: "#FFFFFF", onPrimary: "#fff" },
  "Marquette":       { primary: "#003366", secondary: "#FFD700", onPrimary: "#fff" },
  "Virginia":        { primary: "#232D4B", secondary: "#F84C1E", onPrimary: "#fff" },
  "Texas A&M":       { primary: "#500000", secondary: "#FFFFFF", onPrimary: "#fff" },

  // cbb-team-ids has the wrong primary or both source colors are dark.
  "Florida":         { primary: "#FA4616", secondary: "#0021A5", onPrimary: "#fff" },
  "Iowa":            { primary: "#FFCD00", secondary: "#000000", onPrimary: "#000" },
  "Wake Forest":     { primary: "#9E7E38", secondary: "#000000", onPrimary: "#fff" },
  "Ohio St.":        { primary: "#BB0000", secondary: "#666666", onPrimary: "#fff" },
  "N.C. State":      { primary: "#CC0000", secondary: "#000000", onPrimary: "#fff" },
  "Georgia":         { primary: "#BA0C2F", secondary: "#000000", onPrimary: "#fff" },
  "Bellarmine":      { primary: "#862633", secondary: "#b8b8b8", onPrimary: "#fff" },
  "Towson":          { primary: "#FFB81C", secondary: "#000000", onPrimary: "#000" },
  "Niagara":         { primary: "#4C2882", secondary: "#d1cad8", onPrimary: "#fff" },
  "Northern Illinois": { primary: "#CC0000", secondary: "#000000", onPrimary: "#fff" },
  "New Mexico St.":  { primary: "#8E1B3B", secondary: "#FFFFFF", onPrimary: "#fff" },
};

// Standard relative luminance — for picking a readable text color on top of
// the primary and as one input to the brand-likeness score.
function luminance(hex: string): number {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return 0.5;
  const v = parseInt(m[1]!, 16);
  const r = (v >> 16) & 0xff;
  const g = (v >> 8) & 0xff;
  const b = v & 0xff;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

// HSV-style saturation. Used to favor chromatic colors over near-black or
// near-white when picking a team's primary.
function saturation(hex: string): number {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return 0;
  const v = parseInt(m[1]!, 16);
  const r = ((v >> 16) & 0xff) / 255;
  const g = ((v >> 8) & 0xff) / 255;
  const b = (v & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

// Brand-likeness score. Higher = better candidate for the team's primary.
// Heavily penalizes near-black (lum < 0.12) and near-white/gray (lum > 0.8 &&
// sat < 0.15) since those are almost always accents/backgrounds, not brand
// primaries. For everything else, saturation is the dominant signal with a
// small bonus for mid-darkness (reads better as a badge background than a
// pastel).
function brandScore(hex: string): number {
  const lum = luminance(hex);
  const sat = saturation(hex);
  if (lum < 0.12) return sat - 0.8;
  if (lum > 0.8 && sat < 0.15) return -0.5;
  return sat * 1.5 + (1 - lum) * 0.3;
}

function pickPrimary(c1: string, c2: string): string {
  if (!c1) return c2;
  if (!c2) return c1;
  return brandScore(c1) >= brandScore(c2) ? c1 : c2;
}

/**
 * WCAG relative luminance, and the contrast ratio built on it.
 *
 * DELIBERATELY NOT the `luminance()` above. That one is the 0.299/0.587/0.114
 * perceived-brightness average, which is the right tool for ranking two brand
 * colours against each other and the wrong one for asking whether text can be
 * read: the sRGB gamma step below is what makes a saturated yellow measure as
 * the very bright colour it looks like. Iowa's #FFCD00 is 0.79 by the average
 * and 0.66 by this — and against the cream page that is the difference between
 * "probably fine" and a measured 1.41.
 */
function wcagLuminance(hex: string): number {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return 0;
  const v = parseInt(m[1]!, 16);
  const ch = [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff].map((c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [wcagLuminance(a), wcagLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The light theme's page colour. Mirrors --paper in globals.css. */
const LIGHT_PAPER = "#faf7f2";

/**
 * A brand colour dark enough to READ on the cream page, and otherwise itself.
 *
 * The mirror of the dark theme's clamp, and it has to exist for the same
 * reason: a brand primary is chosen to look like the school, not to sit on our
 * background. Warm and pale ones vanish — Iowa's gold measures 1.41 against
 * --paper, Wichita St. 1.43, Missouri 1.82, Army 1.89, Tennessee 2.62 — which
 * is the same complaint as San Diego's navy on the dark ground, one theme over.
 *
 * A CONTRAST TARGET, NOT A LIGHTNESS CAP, and that is the whole design. A cap
 * moves every colour above it, including the hundreds that were already
 * legible, and repaints the site for no reason. This returns the colour
 * untouched the moment it clears the bar and otherwise walks lightness down
 * only as far as it must, so a team changes exactly if it was failing and by
 * exactly as much as it was failing by. Hue and saturation are preserved
 * throughout — a dark Iowa gold is still gold.
 *
 * ONLY FOR TEXT. --accent-tint and --accent-fill keep the true colour: a 10%
 * hover wash and a badge with its own chosen foreground are surfaces, and
 * nothing has to be read off them. That is also what keeps the schedule ticker
 * out of this — it reads --accent-tint and never --accent.
 */
export function readableOnPaper(hex: string, target = 4.5): string {
  if (contrastRatio(hex, LIGHT_PAPER) >= target) return hex;
  for (let cap = 0.48; cap >= 0.04; cap -= 0.02) {
    const c = readableInk(hex, { min: 0, max: cap });
    if (contrastRatio(c, LIGHT_PAPER) >= target) return c;
  }
  // Unreachable for any hue: lightness 0.04 is near-black. A GREYSCALE input
  // is the one that can arrive here, because readableInk returns those
  // untouched (it has no hue to rebuild from), so it gets a neutral ink.
  return "#2b2b2b";
}

/**
 * Black or white, whichever can be read on this colour.
 *
 * Exported because the team pages need it for a colour this module never sees:
 * the dark theme's accent FILL is derived at render time, and it lands
 * anywhere in a lightness band wide enough that neither ink works across all
 * of it. Fixing the foreground instead of picking it put near-black on San
 * Diego's #205cca at 2.82 — under the bar for large text, let alone small.
 */
export function contrastOn(hex: string): string {
  return luminance(hex) > 0.55 ? "#1a2238" : "#ffffff";
}

function isValidHex(s: string | undefined | null): s is string {
  return typeof s === "string" && /^#[0-9a-fA-F]{6}$/.test(s);
}

export function getTeamColors(teamName: string | null | undefined): TeamColors | null {
  if (!teamName) return null;
  if (OVERRIDES[teamName]) return OVERRIDES[teamName]!;
  const entry = TEAMS[normalize(teamName)];
  if (!entry) return null;
  const c1 = isValidHex(entry.color1) ? entry.color1 : "";
  const c2 = isValidHex(entry.color2) ? entry.color2 : "";
  if (!c1 && !c2) return null;
  const primary = pickPrimary(c1, c2);
  if (!isValidHex(primary)) return null;
  return {
    primary,
    secondary: primary === c1 ? (c2 || undefined) : (c1 || undefined),
    onPrimary: contrastOn(primary),
  };
}

/**
 * A team colour clamped into a band that stays readable as TEXT on either
 * theme's ground.
 *
 * Brand colours span the whole lightness range — Carolina sky blue sits at
 * L 0.66, Michigan navy at L 0.15 — and both extremes fail as small type: the
 * pale one washes out on warm paper, the dark one disappears on the dark
 * theme's near-black. Clamping lightness while holding hue and saturation
 * keeps the colour unmistakably the team's while guaranteeing it can be read.
 *
 * Use for text and numerals. Bars, swatches and fills should use the raw
 * colour — a large block of it has no legibility problem and the true shade is
 * what makes the chart look like the team.
 */
export function readableInk(hex: string, opts?: { min?: number; max?: number }): string {
  const min = opts?.min ?? 0.34;
  const max = opts?.max ?? 0.56;
  const s = hex.replace("#", "");
  if (s.length !== 6) return hex;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255) as [number, number, number];
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2, d = mx - mn;
  if (d === 0) return hex; // greyscale: no hue to preserve
  const sat = d / (1 - Math.abs(2 * l - 1));
  let hue: number;
  if (mx === r) hue = ((g - b) / d) % 6;
  else if (mx === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  hue = ((hue * 60) + 360) % 360;

  const nl = Math.min(max, Math.max(min, l));
  if (nl === l) return hex;

  const c = (1 - Math.abs(2 * nl - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = nl - c / 2;
  let p: [number, number, number];
  if (hue < 60) p = [c, x, 0];
  else if (hue < 120) p = [x, c, 0];
  else if (hue < 180) p = [0, c, x];
  else if (hue < 240) p = [0, x, c];
  else if (hue < 300) p = [x, 0, c];
  else p = [c, 0, x];
  const hex2 = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${hex2(p[0])}${hex2(p[1])}${hex2(p[2])}`;
}
