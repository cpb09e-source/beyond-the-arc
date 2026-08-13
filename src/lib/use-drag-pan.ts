"use client";

import { useRef, type RefObject, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from "react";

/**
 * Click-and-drag panning for a horizontally scrolling surface.
 *
 * MOUSE AND PEN ONLY. Touch is left entirely to the browser — see the guard in
 * onPointerDown for what happened when it was not.
 *
 * Grab anywhere in the data area and drag left/right. A 4px threshold keeps
 * plain clicks working, and by default interactive elements never start a pan
 * at all — a drag that began on an <a> would fight the browser's native
 * link-drag, and one that began on a sortable header would fight the
 * column-reorder drag.
 *
 * `fromLinks` OPTS OUT OF THE INTERACTIVE-ELEMENT GUARD, for surfaces made
 * ENTIRELY of links.
 * The score ticker is the case: once every cell became a link to its game, the
 * default guard matched every pointerdown and silently disabled panning
 * altogether. There the two gestures have to coexist, so the hook pans from
 * anchors and then swallows the click that the drag would otherwise fire —
 * without that, letting go after a drag navigates to whichever game happened
 * to be under the cursor.
 *
 * Returns props to spread on the scroll container. Pair with `cursor-grab` on
 * that element; the hook adds `cursor-grabbing` for the duration of the drag.
 */
export function useDragPan(
  ref: RefObject<HTMLElement | null>,
  opts?: { fromLinks?: boolean },
) {
  const fromLinks = opts?.fromLinks ?? false;
  const pan = useRef<{ x: number; left: number; active: boolean } | null>(null);
  /** Set when a drag actually moved, so the trailing click can be cancelled. */
  const swallowClick = useRef(false);

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    // Touch already scrolls an overflow container natively, and better —
    // momentum, rubber-banding, the lot. Hijacking it would only make the
    // gesture worse and risks eating taps on the links.
    //
    // THIS GUARD USED TO BE GATED BEHIND `fromLinks`, which meant it only ever
    // ran for the score ticker — the two biggest tables on the site (the player
    // grid and the team explorer) pass fromLinks: false, so every finger swipe
    // on them started a pan. Measured on the real page with a synthetic touch
    // pointer: setPointerCapture fired on the scroll container, cursor-grabbing
    // was added, and scrollLeft was driven by hand from 0 to 140. The effect on
    // a phone is a horizontal scroll with no momentum and no flick — position
    // assigned per pointermove on the main thread instead of handed to the
    // compositor — while the captured pointer interferes with the vertical
    // gesture underneath it. That is the "rough" feeling, and the comment above
    // was already the correct policy; it just was not being applied.
    //
    // Pen keeps panning: it is a pointing device, not a finger, and there is no
    // native pen-scroll gesture to defer to.
    if (e.pointerType === "touch") return;
    const t = e.target as HTMLElement;
    const blocked = fromLinks ? "button,input,select,[data-no-pan]" : "a,button,input,select,[data-no-pan]";
    if (t.closest(blocked)) return;
    swallowClick.current = false;
    pan.current = { x: e.clientX, left: ref.current?.scrollLeft ?? 0, active: false };
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const el = ref.current;
    if (!pan.current || !el) return;
    const dx = e.clientX - pan.current.x;
    if (!pan.current.active && Math.abs(dx) < 4) return;
    if (!pan.current.active) {
      pan.current.active = true;
      el.setPointerCapture(e.pointerId);
      el.classList.add("select-none", "cursor-grabbing");
    }
    // Clamp to the valid range so dragging past an edge can't push scrollLeft
    // out of bounds (which momentarily shifts the sticky columns → a glitchy
    // truncation). Round to whole pixels: a fractional scrollLeft leaves the
    // sticky cells snapped to integers while the scrolled content sits
    // sub-pixel, which reads as a 1px shimmy on the frozen columns.
    const max = el.scrollWidth - el.clientWidth;
    el.scrollLeft = Math.round(Math.min(max, Math.max(0, pan.current.left - dx)));
  };

  const onPointerEnd = (e: ReactPointerEvent) => {
    const el = ref.current;
    if (pan.current?.active && el) {
      el.releasePointerCapture?.(e.pointerId);
      el.classList.remove("select-none", "cursor-grabbing");
      // A click always follows pointerup on the same element. Mark it.
      if (fromLinks) swallowClick.current = true;
    }
    pan.current = null;
  };

  /**
   * Cancel the click that ends a drag. Capture phase, on the container, so it
   * runs before the link's own handler — by the bubble phase Next's Link has
   * already begun navigating.
   */
  const onClickCapture = (e: ReactMouseEvent) => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: onPointerEnd,
    onPointerCancel: onPointerEnd,
    ...(fromLinks ? { onClickCapture } : {}),
  };
}
