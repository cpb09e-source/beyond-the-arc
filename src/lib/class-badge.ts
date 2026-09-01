/**
 * The class-year badge palette — one teal freshman, one violet sophomore, one
 * amber junior, one magenta senior, everywhere they appear.
 *
 * EXTRACTED BECAUSE THERE WERE TWO COPIES AND A THIRD WAS ABOUT TO BE WRITTEN.
 * players-client and player-atlas each carried this map, character for
 * character, each with a comment explaining that the other one had to match.
 * That is a contract written twice, and the teammate picker needed it as well.
 *
 * THE VALUES LIVE IN globals.css. They were fixed hex once, which meant the
 * pastel fills stayed pastel on the dark theme and each badge read as a small
 * headlight — the same failure the percentile ramp documents. They are tokens
 * now, with a deep-fill dark set.
 *
 * NO ENTRY FOR "Gr". A graduate season is styled as plain text by every caller,
 * which is deliberate: the four undergraduate years are a progression a reader
 * can rank at a glance, and a fifth colour outside that sequence would imply a
 * fifth step rather than a different kind of thing.
 */
export const CLASS_BADGE: Record<string, { bg: string; fg: string }> = {
  Fr: { bg: "var(--cls-fr-bg)", fg: "var(--cls-fr-fg)" },   // teal
  So: { bg: "var(--cls-so-bg)", fg: "var(--cls-so-fg)" },   // violet
  Jr: { bg: "var(--cls-jr-bg)", fg: "var(--cls-jr-fg)" },   // amber
  Sr: { bg: "var(--cls-sr-bg)", fg: "var(--cls-sr-fg)" },   // magenta
};

/** The inline style for a class badge, or undefined for a class with no colour. */
export function classBadgeStyle(cls: string | null | undefined) {
  const c = cls ? CLASS_BADGE[cls] : undefined;
  return c ? { background: c.bg, color: c.fg } : undefined;
}
