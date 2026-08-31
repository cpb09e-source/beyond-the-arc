"use client";

import { useEffect, useRef, useState } from "react";
import { SeasonFlag } from "@/components/season-flag";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

function seasonLabel(y: number): string {
  return `${(y - 1).toString().slice(-2)}-${y.toString().slice(-2)}`;
}

/**
 * The season picker in the team hero — and the way into thirteen years of a
 * programme's history, which is most of what the site knows.
 *
 * IT USED TO READ AS PART OF THE EYEBROW, and that was the problem. Set at
 * 12px uppercase on 0.18em tracking, tinted at six per cent of the accent and
 * parked in the eyebrow — the one line on a page readers are trained to skim —
 * it was indistinguishable from the conference label beside it. Nobody found
 * it, so nobody knew the older seasons were there at all.
 *
 * So it is a CONTROL now, not a word. It carries a "Season" label so it says
 * what it does without being clicked, a real surface instead of a tint, the
 * value in normal case so it reads as data rather than as another caption, and
 * a count in the popover header so the depth behind it is stated rather than
 * discovered. It still sits beside the conference, because that is where the
 * question "which season am I looking at?" actually gets asked.
 *
 * Custom popover instead of a native <select> so the menu matches the site
 * palette rather than the OS. Click outside or Esc closes.
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
    return <span>{seasonLabel(currentYear)}<SeasonFlag year={currentYear} /></span>;
  }

  return (
    <span ref={wrapperRef} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Season ${seasonLabel(currentYear)}. Choose from ${sorted.length} seasons`}
        className={cn(
          "group inline-flex items-center gap-2 cursor-pointer rounded-lg",
          // A real surface. The old 6% tint of an accent on cream was below the
          // threshold at which anything reads as pressable.
          "border border-current/45 hover:border-current/80 bg-current/[0.10] hover:bg-current/[0.18]",
          "px-2.5 py-1.5 transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/50",
        )}
      >
        <span className="text-[0.58rem] uppercase tracking-[0.16em] opacity-70 leading-none">
          Season
        </span>
        {/* normal-case and tabular: the eyebrow is uppercase and tracked, and a
            value dressed as a caption is what made this invisible before. */}
        <span className="text-sm font-semibold tabular normal-case tracking-normal leading-none">
          {seasonLabel(currentYear)}<SeasonFlag year={currentYear} />
        </span>
        <ChevronDown
          size={14}
          strokeWidth={2.5}
          className={cn("transition-transform shrink-0", open && "rotate-180")}
        />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute top-full left-0 mt-1.5 z-30 bg-paper-deep border border-hairline rounded-lg shadow-lg py-1 min-w-[9rem] max-h-[28rem] overflow-y-auto normal-case tracking-normal [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        >
          {/* Says how deep the archive goes. A reader who opens this once
              should not have to count the list to learn it. */}
          <div className="px-3 pt-1.5 pb-2 text-[0.58rem] uppercase tracking-[0.16em] text-ink-muted border-b border-hairline mb-1">
            {sorted.length} seasons
          </div>
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
                  "flex w-full items-center justify-between gap-3 text-left px-3 py-2 text-sm tabular font-medium transition-colors whitespace-nowrap",
                  "hover:bg-[var(--accent-tint)]",
                  isCurrent ? "text-[color:var(--accent)]" : "text-ink",
                )}
              >
                <span>{seasonLabel(y)}<SeasonFlag year={y} /></span>
                {isCurrent && (
                  <span className="text-[0.55rem] uppercase tracking-[0.14em] opacity-70">
                    Showing
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </span>
  );
}
