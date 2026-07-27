"use client";

import { useRef, type RefObject, type PointerEvent as ReactPointerEvent } from "react";

/**
 * Click-and-drag panning for a horizontally scrolling table.
 *
 * Grab anywhere in the data area and drag left/right. A 4px threshold keeps
 * plain clicks (links, copy buttons, sort headers) working, and interactive
 * elements never start a pan at all — a drag that began on an <a> would fight
 * the browser's native link-drag, and one that began on a sortable header would
 * fight the column-reorder drag.
 *
 * Returns props to spread on the scroll container. Pair with `cursor-grab` on
 * that element; the hook adds `cursor-grabbing` for the duration of the drag.
 */
export function useDragPan(ref: RefObject<HTMLElement | null>) {
  const pan = useRef<{ x: number; left: number; active: boolean } | null>(null);

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest("a,button,input,select,[data-no-pan]")) return;
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
    }
    pan.current = null;
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: onPointerEnd,
    onPointerCancel: onPointerEnd,
  };
}
