"use client";

import { useState } from "react";
import { FindGameModal } from "@/components/teams/find-game-modal";

/**
 * Tiny client-side wrapper for the FindGameModal. Renders an accent-colored
 * button in the team-page hero; clicking opens the per-team filter modal.
 * Lives as its own file so the team-page server component can import it
 * without pulling the modal's full client tree at the call site.
 */
export function FindGameTrigger({
  teamId,
  teamName,
  defaultYear,
}: {
  teamId: number;
  teamName: string;
  defaultYear: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        // Solid filled with the team's accent color, white text, shadow +
        // hover lift. Reads unambiguously as a clickable CTA in the hero.
        className="inline-flex items-center gap-2 text-xs uppercase tracking-widest font-bold rounded-md px-4 py-2 shadow-sm hover:shadow-md hover:-translate-y-px active:translate-y-0 active:shadow-sm transition-all duration-150 text-white border border-transparent focus:outline-none focus:ring-2 focus:ring-coral/40"
        style={{
          backgroundColor: "var(--accent, var(--color-coral))",
        }}
        aria-label={`Find a ${teamName} game`}
      >
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          width={14}
          height={14}
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx={11} cy={11} r={7} />
          <line x1={20} y1={20} x2={16.65} y2={16.65} />
        </svg>
        <span>Find a {teamName} game</span>
        <span aria-hidden className="text-[0.65rem] opacity-80">→</span>
      </button>
      {open && (
        <FindGameModal
          matchGame={(g) => g.team_id === teamId}
          displayName={teamName}
          logoName={teamName}
          defaultYear={defaultYear}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
