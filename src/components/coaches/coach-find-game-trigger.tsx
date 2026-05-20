"use client";

import { useMemo, useState } from "react";
import { FindGameModal } from "@/components/teams/find-game-modal";
import type { SearchableOption } from "@/components/explorer/searchable-select";

/**
 * Coach-scoped Find-a-Game trigger. Mirrors the team-page button but the
 * underlying modal filters games to those that match any of the (team, year)
 * pairs the coach was on the bench for. So opening this on Rick Barnes'
 * page only returns Texas games from 2013-2015 and Tennessee games from
 * 2016-now — nothing else.
 *
 * Color: the button uses the coach's current/most-recent team accent color
 * so it visually ties to "their" school — Bill Self → Kansas blue, Few →
 * Gonzaga blue, etc.
 */
export function CoachFindGameTrigger({
  coachName,
  teamYears,
  defaultYear,
  accentColor,
  accentOnPrimary,
}: {
  coachName: string;
  /** Every (team_id, team name, year) pair the coach has been on the bench for. */
  teamYears: Array<{ teamId: number; teamName: string; year: number }>;
  /** Default year to populate in the modal — usually the coach's most recent. */
  defaultYear: number;
  /** Hex color (e.g. "#0051BA") for the current team. Falls back to coral. */
  accentColor?: string | null;
  /** Text color that's readable on top of accentColor. Falls back to white. */
  accentOnPrimary?: string | null;
}) {
  const [open, setOpen] = useState(false);

  // Build a Set of "team_id|year" keys for O(1) per-game membership checks.
  const teamYearKeys = useMemo(
    () => new Set(teamYears.map((p) => `${p.teamId}|${p.year}`)),
    [teamYears],
  );

  // Distinct team names → options for the in-modal Team multi-select. Only
  // surfaces in the modal when the coach has 2+ teams (else it's redundant).
  const teamOptions = useMemo<SearchableOption[]>(() => {
    const names = Array.from(new Set(teamYears.map((p) => p.teamName))).sort();
    return names.map((n) => ({ value: n, label: n }));
  }, [teamYears]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 text-xs uppercase tracking-widest font-bold rounded-md px-4 py-2 shadow-sm hover:shadow-md hover:-translate-y-px active:translate-y-0 active:shadow-sm transition-all duration-150 border border-transparent focus:outline-none focus:ring-2 focus:ring-coral/40"
        style={{
          backgroundColor: accentColor ?? "var(--color-coral)",
          color: accentOnPrimary ?? "#fff",
        }}
        aria-label={`Find a ${coachName} game`}
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
        <span>Find a {coachName} game</span>
        <span aria-hidden className="text-[0.65rem] opacity-80">→</span>
      </button>
      {open && (
        <FindGameModal
          matchGame={(g) => teamYearKeys.has(`${g.team_id}|${g.year}`)}
          displayName={coachName}
          defaultYear={defaultYear}
          teamOptions={teamOptions}
          teamYearPairs={teamYears.map((p) => ({ teamName: p.teamName, year: p.year }))}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
