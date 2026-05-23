"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

function seasonLabel(y: number): string {
  return `${(y - 1).toString().slice(-2)}-${y.toString().slice(-2)}`;
}

/**
 * Inline season picker that lives inside the hero eyebrow. The trigger reads
 * as part of the eyebrow text (e.g. "BIG 12 · 25-26 ▾"), and clicking opens a
 * custom popover styled to match the page (cream bg + hairline border).
 *
 * Custom popover instead of a native <select> so the dropdown UI matches the
 * site palette (the native menu is OS-styled and out of our control). Click
 * outside or Esc closes.
 */
export function SeasonSwitcher({
  slug,
  currentYear,
  years,
}: {
  slug: string;
  currentYear: number;
  years: number[];
}) {
  const router = useRouter();
  const sorted = [...years].sort((a, b) => b - a);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (sorted.length <= 1) {
    return <span>{seasonLabel(currentYear)}</span>;
  }

  return (
    <span ref={wrapperRef} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Switch season"
        className="inline-flex items-center gap-1.5 cursor-pointer rounded-md border border-current/30 hover:border-current/60 bg-current/[0.06] hover:bg-current/[0.12] px-2 py-0.5 transition-colors"
      >
        <span>{seasonLabel(currentYear)}</span>
        <ChevronDown size={12} strokeWidth={2.5} className={cn("transition-transform opacity-70", open && "rotate-180")} />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute top-full left-0 mt-1.5 z-30 bg-paper-deep border border-hairline rounded-md shadow-lg py-1 min-w-[6rem] max-h-[28rem] overflow-y-auto normal-case tracking-normal [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        >
          {sorted.map((y) => {
            const isCurrent = y === currentYear;
            return (
              <button
                key={y}
                type="button"
                role="option"
                aria-selected={isCurrent}
                onClick={() => {
                  setOpen(false);
                  router.push(`/teams/${slug}/${y}/`);
                }}
                className={cn(
                  "block w-full text-left px-3 py-1.5 text-sm tabular font-medium transition-colors whitespace-nowrap",
                  "hover:bg-[var(--accent-tint)]",
                  isCurrent ? "text-[color:var(--accent)]" : "text-ink",
                )}
              >
                {seasonLabel(y)}
              </button>
            );
          })}
        </div>
      )}
    </span>
  );
}
