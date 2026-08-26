"use client";

import { useState } from "react";
import { TeamLogo } from "@/components/team-logo";
import { Select } from "@/components/select";
import type { PlayerRanksSeason } from "@/lib/static-data";
import { PlayerStatsGrid } from "./player-stats-grid";
import { usePlayerSplits } from "./player-splits";
import { useShotProfile } from "./player-shot-impact";
import { bucketLabel, seasonLabel } from "./where-they-rank";

/**
 * Player Overview — the full-season stats panel. Header surfaces the team +
 * year for the displayed season; a Year dropdown lets the user swap to any
 * other season they're ranked in (defaults to most-recent).
 *
 * Years that don't appear in the ranks data (e.g. didn't clear the
 * 18g/20mpg/5.3ppg eligibility floor) are hidden from the dropdown.
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
  // One fetch for every season the player has splits for; the year dropdown
  // then switches without another round trip.
  const splits = usePlayerSplits(bartPlayerId);
  if (!selected) return null;

  return (
    <>
      {/* Rank rings moved to the player-page hero (top right of the dossier
          card), so this heading is just a heading again. */}
      {/* One band: heading, the team and season it describes, and the cohort
          the percentiles are against. It was two — a tinted heading block under
          an accent strip, then a picker row — which is three horizontal rules
          before any content. */}
      <div className="px-5 lg:px-6 py-4 border-b border-hairline flex items-center justify-between gap-x-4 gap-y-2 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="font-display text-xl sm:text-2xl text-ink leading-none tracking-tight whitespace-nowrap">
            Player Overview
          </h2>
          <span className="flex items-center gap-2 min-w-0">
            <TeamLogo name={selected.team_name} size={20} />
            <span className="text-sm text-ink-soft truncate hidden sm:inline">{selected.team_name}</span>
            {options.length > 1 ? (
              <Select
                value={String(selected.year)}
                onChange={(v) => setSelectedYear(Number(v))}
                ariaLabel="Select season"
                // Same 14px as the career table's view picker at every width.
                // The two already matched on a desktop and only diverged on a
                // phone, where the site-wide 16px floor caught this one.
                className="field-sm-phone"
              >
                {options.map((o) => (
                  <option key={o.year} value={o.year}>{seasonLabel(o.year)}</option>
                ))}
              </Select>
            ) : (
              <span className="text-sm text-ink tabular">{seasonLabel(selected.year)}</span>
            )}
          </span>
        </div>
        <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted">
          Percentile rank within {selected.ranks.cohortSize.toLocaleString()} {bucketLabel(selected.ranks.bucket)}
        </span>
      </div>
      <div className="p-5 lg:p-6">
        <PlayerStatsGrid
          season={selected.ranks}
          shooting={shooting}
          splitSeason={splits === undefined ? undefined : splits?.seasons?.[String(selected.year)] ?? null}
        />
      </div>
    </>
  );
}
