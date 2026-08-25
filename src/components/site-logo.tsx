import { cn } from "@/lib/utils";

/**
 * The wordmark, in whichever ink the current ground needs.
 *
 * TWO FILES, SWAPPED IN CSS — not one file recoloured. The mark is flat
 * artwork with its fill baked in (`#111` on paper, `#f4f4f4` on the dark
 * ground), and an <img> cannot be restyled from outside: no currentColor, no
 * fill override, nothing. Inlining the SVG would allow that, but it is ~4.5KB
 * of path data repeated at three call sites and it would stop being cacheable.
 *
 * So both ship and CSS picks. `display: none` is doing the choosing, which
 * matters for more than layout: a hidden image is out of the accessibility
 * tree entirely, so exactly one wordmark is announced at a time even though
 * both carry the same alt text. Swapping a `src` in JS would have cost a
 * hydration round-trip and shown the wrong mark for a frame.
 *
 * No flash on load, because the pre-hydration script in layout.tsx stamps
 * data-theme before first paint — the correct file is the only one ever drawn.
 */
export function SiteLogo({ className }: { className?: string }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/btalogo_final-01.svg"
        alt="Beyond the Arc"
        className={cn("bta-logo-light", className)}
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/newbtalogo-white-01.svg"
        alt="Beyond the Arc"
        className={cn("bta-logo-dark", className)}
      />
    </>
  );
}
