/**
 * Player height for display.
 *
 * Bart stores feet-inches hyphenated ("6-0", "7-2"), which reads as a range or
 * a score rather than a measurement. Prime marks are how a height is written.
 *
 * Anything that is not exactly feet-hyphen-inches is passed through untouched —
 * the source is a scraped string and a value we do not recognise is more useful
 * verbatim than mangled.
 */
export function formatHeight(h: string | null | undefined): string | null {
  if (!h) return null;
  const m = /^(\d+)-(\d+)$/.exec(h.trim());
  return m ? `${m[1]}'${m[2]}"` : h;
}
