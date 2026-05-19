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

function contrastOn(hex: string): string {
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
