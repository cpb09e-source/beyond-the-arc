"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";

/**
 * Viewport placement for a popover that has to escape its card.
 *
 * WHY ANY OF THIS EXISTS. Every table on the site sits in a rounded card that
 * carries `overflow-hidden` to clip the table's square corners to it. That
 * clip applies to absolutely-positioned descendants too, so a dropdown in the
 * toolbar is cropped at the card's bottom edge — invisible while the table is
 * long, and obvious the moment a filter cuts it to three rows, which is
 * exactly when somebody is reaching for the dropdown again.
 *
 * `position: fixed` is not clipped by an ancestor's overflow (only by an
 * ancestor that establishes a containing block for fixed elements — a
 * transform, a filter, `contain` — and these cards have none). So the panel is
 * fixed, positioned off the trigger's own rect, and portalled to the body so
 * no ancestor stacking context can bury it either.
 *
 * THIS IS NOT A NEW PATTERN HERE. stat-picker, download-menu and
 * saved-filters-menu each arrived at it independently and each wrote their own
 * copy of the arithmetic; stat-picker's comment records the same bug being
 * found the hard way ("the first build of this rendered exactly one visible
 * option and a stray scrollbar"). This is that arithmetic, once.
 *
 * WHAT IT DOES BEYOND POSITIONING: it bounds the panel. The older copies each
 * hardcode a guess at their own height — 320, 340 — and flip above the trigger
 * when the guess does not fit. A guess is wrong for a list whose length is the
 * caller's business, so this measures the real gap instead and hands back a
 * `maxHeight`; the panel scrolls inside it rather than running off the screen.
 * It flips above only when that genuinely buys room.
 *
 * The caller owns the close-on-outside-click, and must test BOTH refs: the
 * panel is no longer a DOM descendant of the trigger, so a `contains` check
 * against the wrapper alone treats every click inside the panel as a click
 * outside it.
 */
export type PopoverAt = {
  left: number;
  /** Exactly one of `top` / `bottom` is set — the other side is the anchor. */
  top?: number;
  bottom?: number;
  width: number;
  maxHeight: number;
};

/** Clear of the trigger, and clear of the viewport edge. */
const GAP = 6;
const MARGIN = 8;
/** Below this, a drop-down is not worth showing downward — flip it. */
const MIN_BELOW = 180;

export function usePopoverAnchor({
  open,
  width,
  align = "left",
}: {
  open: boolean;
  /** A fixed panel width, or "trigger" to match the control it hangs off. */
  width: number | "trigger";
  align?: "left" | "right";
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<PopoverAt | null>(null);

  const place = useCallback(() => {
    const r = anchorRef.current?.getBoundingClientRect();
    if (!r) return;
    const w = width === "trigger" ? r.width : width;
    const wanted = align === "right" ? r.right - w : r.left;
    const left = Math.max(MARGIN, Math.min(wanted, window.innerWidth - w - MARGIN));

    const below = window.innerHeight - r.bottom - GAP - MARGIN;
    const above = r.top - GAP - MARGIN;
    // Flip only when it actually helps: a cramped gap below is still the
    // better side if the gap above is no better, and a panel that jumps
    // sides on a scroll of a few pixels is worse than a short one.
    const flip = below < MIN_BELOW && above > below;
    setAt(
      flip
        ? { left, bottom: window.innerHeight - r.top + GAP, width: w, maxHeight: above }
        : { left, top: r.bottom + GAP, width: w, maxHeight: below },
    );
  }, [width, align]);

  /**
   * useLayoutEffect: this is the panel's position, and measuring it after
   * paint is a visible jump from wherever it first landed.
   *
   * Capture-phase scroll, because the thing that scrolls under a popover is
   * usually not the window — the table's own horizontal scroller counts, and
   * scroll events from it do not bubble.
   */
  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  return { anchorRef, popRef, at, place };
}

/** The inline style for a placed panel. Keeps the ternary out of the JSX. */
export function popoverStyle(at: PopoverAt): React.CSSProperties {
  return {
    position: "fixed",
    left: at.left,
    top: at.top,
    bottom: at.bottom,
    width: at.width,
    maxHeight: at.maxHeight,
  };
}
