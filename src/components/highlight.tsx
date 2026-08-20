import { cn } from "@/lib/utils";

/**
 * Highlight — a marker swipe behind a word or figure, the way you would run a
 * highlighter over a number on a printout.
 *
 * The swipe is a separate layer behind the glyphs rather than a `background` on
 * the text itself, which buys three things a background cannot: it can sit a
 * touch off level, it can overhang the text at either end the way a real stroke
 * overshoots, and its corners can be uneven. Those three details are most of
 * what separates a marker from a rectangle.
 *
 * One deliberate difference from the Basecamp annotation this is modelled on:
 * theirs marks a social-proof count ("2,700 organizations signed up last
 * week"). Ours has no subscribers to count yet, so this only ever goes over
 * something already true and checkable. The device draws the eye to whatever it
 * marks, which is exactly why it must not mark a number we cannot stand behind.
 */
export function Highlight({
  children,
  className,
  /**
   * The ink. Defaults to the hardwood accent, mixed rather than made
   * transparent so the swipe keeps its own value on either theme instead of
   * letting the page ground bleed through and shift its hue.
   */
  color = "color-mix(in oklab, var(--court) 46%, transparent)",
  /** How far the stroke overhangs the text horizontally, in em. */
  overhang = 0.18,
  /** Degrees off level. Small — past about a degree it reads as broken, not drawn. */
  tilt = -0.7,
}: {
  children: React.ReactNode;
  className?: string;
  color?: string;
  overhang?: number;
  tilt?: number;
}) {
  return (
    <span className={cn("relative inline-block whitespace-nowrap", className)}>
      <span
        aria-hidden="true"
        className="highlight-swipe pointer-events-none absolute"
        style={{
          // The keyframes rotate as well as scale, so they need the same tilt
          // this element settles at — otherwise a custom tilt animates at the
          // default and snaps on the last frame.
          ["--swipe-tilt" as string]: `${tilt}deg`,
          left: `${-overhang}em`,
          right: `${-overhang}em`,
          // Insets rather than a full-height block: a highlighter covers the
          // x-height and a little of the ascenders, not the whole line box.
          top: "0.12em",
          bottom: "0.02em",
          background: color,
          transform: `rotate(${tilt}deg)`,
          // Four different radii — a stroke does not end square, and it does not
          // end the same way twice.
          borderRadius: "2px 5px 3px 6px",
          zIndex: 0,
        }}
      />
      <span className="relative" style={{ zIndex: 1 }}>
        {children}
      </span>
    </span>
  );
}
