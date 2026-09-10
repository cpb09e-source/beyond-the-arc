"use client";

import { useRef } from "react";
import { useDragPan } from "@/lib/use-drag-pan";
import { cn } from "@/lib/utils";

/**
 * A horizontally scrolling box you can grab and drag.
 *
 * WHY THIS IS A COMPONENT AND NOT THREE LINES INLINE. useDragPan needs a ref to
 * the element it pans, and a ref declared in a parent is ONE ref. The on/off
 * explorer renders its table three times from a `SECTIONS.map(...)`, so all
 * three boxes were handed the same one: whichever mounted last won it, and
 * dragging either of the other two moved nothing at all — which is exactly how
 * it behaved. Owning the ref here gives every instance its own.
 *
 * `overscroll-x-none` is the X AXIS ONLY. Never bare `overscroll-none` on one
 * of these: an `overflow-x: auto` box is a scroll container in BOTH axes, so
 * the unqualified form also refuses to pass a vertical gesture to the page, and
 * the table becomes a place the page cannot be scrolled from.
 *
 * useDragPan ignores touch on purpose — a finger already gets native momentum
 * scrolling, and hijacking it makes the gesture worse. So this is a
 * mouse-and-pen affordance; phones lose nothing by it.
 */
export function PanScroller({
  className, children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const panHandlers = useDragPan(ref);
  return (
    <div
      ref={ref}
      {...panHandlers}
      className={cn("overflow-x-auto overscroll-x-none cursor-grab", className)}
    >
      {children}
    </div>
  );
}
