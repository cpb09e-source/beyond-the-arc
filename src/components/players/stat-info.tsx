"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Tiny `?` button that opens a popover with a stat definition. Click toggles
 * (works on mobile tap); hover opens too (desktop affordance). Clicking
 * elsewhere or pressing Escape closes. Sized to sit inline next to a stat
 * label without bumping row height.
 */
export function StatInfo({ definition }: { definition: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocPointer(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
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
    <span
      ref={ref}
      className="relative inline-flex group"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }}
        aria-label="Stat definition"
        aria-expanded={open}
        className="relative inline-flex items-center justify-center w-3.5 h-3.5 text-[0.55rem] leading-none font-semibold rounded-full border border-ink-muted/50 text-ink-muted hover:text-coral hover:border-coral transition-colors before:absolute before:-inset-2.5 before:content-['']"
      >
        i
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-0 top-full mt-1.5 z-20 w-60 max-w-[calc(100vw-2.5rem)] bg-paper border border-hairline rounded-md shadow-lg px-3 py-2 text-xs text-ink-soft leading-relaxed normal-case tracking-normal text-left"
        >
          {definition}
        </span>
      )}
    </span>
  );
}
