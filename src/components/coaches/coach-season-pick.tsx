"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TeamLogo } from "@/components/team-logo";
import { cn } from "@/lib/utils";

type SeasonOption = {
  /** Bart-side team name (used as the visible label). */
  team: string;
  /** /teams/<slug> URL segment for this team. */
  teamSlug: string;
  /** Season-end year (e.g. 2026 for the 25-26 season). */
  year: number;
};

/**
 * Year-pick dropdown for the coach profile hero — lists every team-year the
 * coach has been at (newest first) and routes to /teams/<slug>/<year>/ on
 * selection. Use case: someone reading Rick Barnes' page who wants to drop
 * into the 2014 Texas team page, or Bill Self's 21-22 Kansas title year.
 */
export function CoachSeasonPick({
  seasons,
}: {
  seasons: SeasonOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(s: SeasonOption) {
    setOpen(false);
    router.push(`/teams/${s.teamSlug}/${s.year}/`);
  }

  if (seasons.length === 0) return null;

  // Newest first.
  const sorted = [...seasons].sort((a, b) => b.year - a.year);

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-2 text-xs uppercase tracking-widest font-bold rounded-md px-4 py-2 shadow-sm hover:shadow-md hover:-translate-y-px active:translate-y-0 active:shadow-sm transition-all duration-150 text-ink border border-ink/15 bg-card focus:outline-none focus:ring-2 focus:ring-coral/40"
      >
        <span>Select a year</span>
        <span aria-hidden className="text-[0.6rem] text-ink-muted">▾</span>
      </button>

      {open && (
        <div
          className="absolute z-50 top-full left-0 mt-1 w-64 bg-card border border-hairline rounded-lg shadow-lg overflow-hidden"
          role="listbox"
        >
          <div className="max-h-72 overflow-y-auto sm:max-h-none sm:overflow-visible py-1">
            {sorted.map((s) => (
              <button
                key={`${s.team}-${s.year}`}
                type="button"
                onClick={() => pick(s)}
                className={cn(
                  "w-full text-left px-3 py-2 text-sm flex items-center gap-2.5 hover:bg-paper-deep transition-colors",
                )}
              >
                <TeamLogo name={s.team} size={20} />
                <span className="tabular text-xs text-ink-muted w-12">{seasonLabel(s.year)}</span>
                <span className="text-ink">{s.team}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function seasonLabel(yearEnd: number): string {
  return `${(yearEnd - 1).toString().slice(-2)}-${yearEnd.toString().slice(-2)}`;
}
