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
      {/* Card heading with the leaderboard rings docked to its right — the
          rings track the year picker, which is why the heading lives in this
          client component rather than the page shell. The striped "Where they
          stack up" band they used to occupy is gone per Colin. */}
      <div className="px-5 lg:px-7 py-5 lg:py-6 border-b border-hairline bg-paper-deep/30 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div>
          <div className="text-[0.6rem] uppercase tracking-[0.18em] text-coral font-bold mb-1.5 flex items-center gap-2">
            <span className="h-px w-6 bg-coral" />
            Full-season stats
          </div>
          <h2 className="font-display text-3xl lg:text-4xl text-ink leading-none tracking-tight">Player Overview</h2>
        </div>
        <RankRings season={selected.ranks} />
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

/**
 * BTA PRTG leaderboard rings — one per rank dimension (bucket / overall /
 * mid-major when non-power), docked to the right of the card heading.
 */
function bucketSingular(b: "G" | "F" | "C"): string {
  return b === "G" ? "guard" : b === "F" ? "forward" : "center";
}
function RankRings({ season }: { season: PlayerRanksSeason }) {
  if (season.rank == null || season.rankOverall == null) return null;
  const showMidMajor = season.rankNonPower != null && season.cohortNonPower != null;
  return (
    <div className="flex items-start gap-5 sm:gap-7">
      <RankRing
        n={season.rank}
        denom={season.cohortSize}
        pct={season.stats.bta_portg?.percentile ?? null}
        label={bucketSingular(season.bucket)}
      />
      <RankRing
        n={season.rankOverall}
        denom={season.cohortOverall}
        pct={pctOfRank(season.rankOverall, season.cohortOverall)}
        label="overall"
        soft
      />
      {showMidMajor && (
        <RankRing
          n={season.rankNonPower!}
          denom={season.cohortNonPower}
          pct={pctOfRank(season.rankNonPower!, season.cohortNonPower)}
          label="mid major"
          soft
        />
      )}
    </div>
  );
}
function pctOfRank(rank: number, cohort: number | null): number {
  if (cohort == null || cohort < 2) return 100;
  return Math.max(0, Math.min(100, Math.round(((cohort - rank + 1) / cohort) * 100)));
}

/**
 * Rank ring — the site's percentile gauge grown up. The arc fills with the
 * player's percentile inside that cohort, the ordinal + cohort label sit in
 * the middle, and "of N" rides underneath. Replaced a numeral/micro-bar cell
 * per Colin: the ring nearly closing on itself IS the elite signal, so the
 * old tier styling (coral numerals, crown star) had nothing left to add.
 */
function RankRing({
  n, denom, pct, label, soft,
}: {
  n: number;
  denom: number | null;
  pct: number | null;
  label: string;
  /** Secondary cells (overall / mid-major) run the lighter accent. */
  soft?: boolean;
}) {
  const size = 92, stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const fill = Math.max(0, Math.min(100, pct ?? 0));
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-ink/8" />
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={c * (1 - fill / 100)}
            className={soft ? "stroke-coral-soft" : "stroke-coral"}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
          <span className="font-display text-2xl text-ink tabular tabular-nums tracking-tighter">
            <span className="text-[0.6em] align-top opacity-60 mr-px">#</span>{n}
          </span>
          <span className="mt-1 text-[0.5rem] uppercase tracking-[0.16em] font-bold text-ink-muted">{label}</span>
        </div>
      </div>
      {denom != null && (
        <div className="text-[0.55rem] uppercase tracking-[0.12em] text-ink-muted leading-none tabular tabular-nums">
          of {denom.toLocaleString()}
        </div>
      )}
    </div>
  );
}
