"use client";

import { useState } from "react";
import { TeamLogo } from "@/components/team-logo";
import { Select } from "@/components/select";
import type { PlayerRanksSeason } from "@/lib/static-data";
import { PlayerStatsGrid } from "./player-stats-grid";
import { useShotProfile } from "./player-shot-impact";
import { bucketLabel, seasonLabel } from "./where-they-rank";

/**
 * Player Overview — the full-season stats panel. Header surfaces the team +
 * year for the displayed season; a Year dropdown lets the user swap to any
 * other season they're ranked in (defaults to most-recent).
 *
 * Years that don't appear in the ranks data (e.g. didn't clear the
 * 18g/18mpg/5ppg eligibility floor) are hidden from the dropdown.
 */
export type PlayerOverviewOption = {
  year: number;
  team_name: string;
  ranks: PlayerRanksSeason;
};

export function PlayerOverview({
  options,
  bartPlayerId,
}: {
  options: PlayerOverviewOption[];
  bartPlayerId: number;
}) {
  // options arrive newest-first; default selection is the latest year.
  const [selectedYear, setSelectedYear] = useState<number>(options[0]?.year ?? 0);
  const selected = options.find((o) => o.year === selectedYear) ?? options[0];
  // Zone splits for the Shot Diet panel. Hook order has to stay stable, so this
  // runs before the early return and takes null when there's no season.
  const shooting = useShotProfile(bartPlayerId, selected?.year ?? null);
  if (!selected) return null;

  return (
    <>
      {/* Rank rings moved to the player-page hero (top right of the dossier
          card), so this heading is just a heading again. */}
      <div className="px-5 lg:px-7 py-5 lg:py-6 border-b border-hairline bg-paper-deep/30">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-coral font-bold mb-1.5 flex items-center gap-2">
          <span className="h-px w-6 bg-coral" />
          Full-season stats
        </div>
        <h2 className="font-display text-3xl lg:text-4xl text-ink leading-none tracking-tight">Player Overview</h2>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 lg:px-6 py-3 border-b border-hairline bg-paper/50">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <TeamLogo name={selected.team_name} size={24} />
          <span className="text-sm font-medium text-ink truncate">{selected.team_name}</span>
          <span className="text-ink-muted">·</span>
          {options.length > 1 ? (
            <Select
              value={String(selected.year)}
              onChange={(v) => setSelectedYear(Number(v))}
              ariaLabel="Select season"
            >
              {options.map((o) => (
                <option key={o.year} value={o.year}>{seasonLabel(o.year)}</option>
              ))}
            </Select>
          ) : (
            <span className="text-sm text-ink tabular">{seasonLabel(selected.year)}</span>
          )}
        </div>
        <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted">
          Percentile rank within {selected.ranks.cohortSize.toLocaleString()} {bucketLabel(selected.ranks.bucket)}
        </span>
      </div>
      <div className="p-5 lg:p-6">
        <PlayerStatsGrid season={selected.ranks} shooting={shooting} />
      </div>
    </>
  );
}
