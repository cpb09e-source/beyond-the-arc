"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** Matches the 280ms on .bta-drawer so every filter surface opens at one speed. */
const DURATION = 320;

/**
 * An expanding region that actually expands.
 *
 * Every mobile filter bar on the site toggled `hidden` / `flex`, which is a
 * jump cut: the controls are absent for one frame and present the next, and
 * the whole page below them teleports down by however tall they turned out to
 * be. Nothing tells the reader that the thing that moved is the same thing
 * they just tapped.
 *
 * WHY GRID AND NOT max-height. The usual trick is a `max-height` guess large
 * enough to fit the content, which makes the timing a lie — the ease runs
 * against the guess, not the real height, so a short panel snaps open early
 * and a tall one is cut off. `grid-template-rows: 0fr -> 1fr` animates to the
 * content's OWN height, whatever it is, with no measurement and no JS.
 *
 * HEIGHT ALONE DOES NOT READ AS MOTION. Growing the row reveals the content
 * from the top down, but the content itself never moves — the first row of
 * controls is simply there, at its final position, in the first frame. Several
 * people will tell you nothing animated. So the content also slides in from
 * -10px and fades up: the height carries the page below, the transform carries
 * the controls, and the two together are what reads as sliding down.
 *
 * THE OVERFLOW DANCE. The inner box has to clip while the row is growing or
 * the controls spill out of a box that has not finished opening. So the clip
 * is released a beat after the transition ends, and re-applied the instant a
 * close begins.
 *
 * IT USED TO BE LOAD-BEARING FOR THE MENUS TOO, and is not any more. These
 * bars hold SearchableMultiSelect and MultiYearSelect, whose panels were
 * absolutely positioned: clipping them opened the team picker into a sliver,
 * so the release had to happen or the filter bar was broken. Both now render
 * fixed and portalled to the body (see use-popover-anchor), which no ancestor
 * overflow can reach. The release is kept because the clip is only wanted
 * during the growth anyway — but a menu appearing cut off is no longer a
 * symptom to look for here.
 *
 * The settle is on a TIMER rather than `transitionend`: reduced-motion users
 * get no transition and therefore no event, and a menu that never un-clips for
 * them is a broken filter bar, not a subtler animation.
 */
export function Collapse({
  open,
  children,
  className,
  desktop,
}: {
  open: boolean;
  children: React.ReactNode;
  /** Classes for the content box — padding and layout that should move with it. */
  className?: string;
  /**
   * The classes that switch this off above the breakpoint where the region is
   * always open. Passed in rather than derived because Tailwind cannot see a
   * class name built at runtime — `md:block` has to appear as a literal.
   *
   * `content` is not optional politeness: without it the closed state's
   * `opacity-0` would follow the region up to the desktop layout and hide a
   * filter bar that is supposed to be permanently visible there.
   */
  desktop: { outer: string; inner: string; content: string };
}) {
  const [settled, setSettled] = useState(open);

  useEffect(() => {
    // One deferred setState in both directions: opening waits out the
    // transition before un-clipping, closing clips again on the next tick so
    // the content is already contained when the row starts shrinking.
    const t = window.setTimeout(() => setSettled(open), open ? DURATION + 20 : 0);
    return () => window.clearTimeout(t);
  }, [open]);

  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows] ease-out motion-reduce:transition-none",
        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        desktop.outer,
      )}
      style={{ transitionDuration: `${DURATION}ms` }}
    >
      <div className={cn(open && settled ? "overflow-visible" : "overflow-hidden", desktop.inner)}>
        <div
          className={cn(
            // `translate`, not `transform`: Tailwind v4 compiles translate-y-* to
            // the standalone `translate` property, so a transition list naming
            // only `transform` animates nothing and the slide silently drops.
            "transition-[opacity,translate] ease-out motion-reduce:transition-none",
            // AND IT MUST LAND ON `none`, NOT ON ZERO. Any non-none `translate`
            // makes this a stacking context, and the team picker's menu — z-50,
            // and taller than the region it hangs out of — then gets trapped
            // inside it and painted over by the table's z-40 sticky header. So
            // the resting state drops the property entirely. Safe to swap at
            // settle: the transition has already finished at 0, and 0 to none
            // is not a visible change.
            open
              ? (settled ? "opacity-100 translate-none" : "opacity-100 translate-y-0")
              : "opacity-0 -translate-y-2.5",
            desktop.content,
            className,
          )}
          style={{ transitionDuration: `${DURATION}ms` }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
