"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Tiny `?` button that opens a popover with a stat definition. Click toggles
 * (works on mobile tap); hover opens too (desktop affordance). Clicking
 * elsewhere or pressing Escape closes.
 *
 * The popover renders via a portal to document.body so it escapes any
 * ancestor with overflow-hidden (the stat tile + Player Overview card
 * both clip their children for rounded corners + gradient strips, and
 * an inline-positioned popover would get cropped). Position is computed
 * from the trigger's bounding rect with right-edge flipping so tiles on
 * the rightmost column don't push the popover off-screen.
 */
export function StatInfo({ definition }: { definition: string }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; right?: number } | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLSpanElement>(null);
  const POPOVER_WIDTH = 240; // matches w-60

  // Compute popover position from the trigger's bounding rect. Re-run on
  // open and on scroll/resize so the popover stays anchored.
  useLayoutEffect(() => {
    if (!open) return;
    function compute() {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      // Default: anchor LEFT to the trigger's left edge. If that would
      // push the popover past the viewport right edge, anchor RIGHT to
      // the trigger's right edge instead.
      const wouldOverflow = r.left + POPOVER_WIDTH + 12 > window.innerWidth;
      if (wouldOverflow) {
        setCoords({ top: r.bottom + 6, left: -1, right: window.innerWidth - r.right });
      } else {
        setCoords({ top: r.bottom + 6, left: r.left });
      }
    }
    compute();
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);
    return () => {
      window.removeEventListener("scroll", compute, true);
      window.removeEventListener("resize", compute);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDocPointer(e: PointerEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onDocPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <span
        ref={triggerRef}
        className="relative inline-flex"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }}
          aria-label="Stat definition"
          aria-expanded={open}
          className="relative inline-flex items-center justify-center w-4 h-4 text-[0.7rem] leading-none font-bold rounded-full border border-ink-muted text-ink-muted hover:text-coral hover:border-coral transition-colors before:absolute before:-inset-2.5 before:content-['']"
        >
          i
        </button>
      </span>
      {open && coords && typeof document !== "undefined" &&
        createPortal(
          <span
            ref={popoverRef}
            role="tooltip"
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
            className="fixed z-50 w-60 max-w-[calc(100vw-1.5rem)] bg-paper border border-hairline rounded-md shadow-lg px-3 py-2 text-xs text-ink-soft leading-relaxed normal-case tracking-normal text-left"
            style={
              coords.right !== undefined
                ? { top: coords.top, right: coords.right }
                : { top: coords.top, left: coords.left }
            }
          >
            {definition}
          </span>,
          document.body,
        )
      }
    </>
  );
}
