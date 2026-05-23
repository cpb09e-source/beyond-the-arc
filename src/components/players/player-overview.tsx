"use client";

import { useState } from "react";
import { TeamLogo } from "@/components/team-logo";
import { Select } from "@/components/select";
import { cn } from "@/lib/utils";
import type { PlayerRanksSeason } from "@/lib/static-data";
import { PlayerStatsGrid } from "./player-stats-grid";
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

export function PlayerOverview({ options }: { options: PlayerOverviewOption[] }) {
  // options arrive newest-first; default selection is the latest year.
  const [selectedYear, setSelectedYear] = useState<number>(options[0]?.year ?? 0);
  const selected = options.find((o) => o.year === selectedYear) ?? options[0];
  if (!selected) return null;

  return (
    <>
      <BtaRankCard season={selected.ranks} />
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
        <PlayerStatsGrid season={selected.ranks} />
      </div>
    </>
  );
}

/**
 * BTA PRTG leaderboard rank — full-width band above the Player Overview
 * grid. Coral diagonal-stripe motif sits behind big display-font numerals,
 * one cell per rank dimension (bucket / overall / mid-major when non-power).
 * Elite ranks (top 25) earn an inverted coral fill on the numeral; top-3
 * also gets a tiny crown glyph. Each cell shows its denominator + a
 * micro-progress bar that fills with the player's percentile within that
 * cohort so the rank reads as "how far up the list you are" at a glance.
 */
function bucketSingular(b: "G" | "F" | "C"): string {
  return b === "G" ? "guard" : b === "F" ? "forward" : "center";
}
function BtaRankCard({ season }: { season: PlayerRanksSeason }) {
  if (season.rank == null || season.rankOverall == null) return null;
  const showMidMajor = season.rankNonPower != null && season.cohortNonPower != null;
  return (
    <div className="relative overflow-hidden border-b border-hairline">
      {/* Coral gradient wash + diagonal stripe motif behind the numerals */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(135deg, var(--coral) 0, var(--coral) 1px, transparent 1px, transparent 12px)",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(90deg, color-mix(in srgb, var(--coral) 10%, transparent) 0%, transparent 60%)",
        }}
      />
      <div className="relative px-5 lg:px-7 py-4 lg:py-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex flex-col gap-1">
          <div className="text-[0.55rem] uppercase tracking-[0.2em] text-coral font-bold flex items-center gap-2">
            <span className="h-px w-6 bg-coral" />
            BTA PRTG · {seasonLabel(season.year)} leaderboard
          </div>
          <div className="font-display text-lg lg:text-xl text-ink tracking-tight leading-none">
            Where they stack up
          </div>
        </div>
        <div className="flex items-stretch gap-0">
          <RankCell
            n={season.rank}
            denom={season.cohortSize}
            pct={season.stats.bta_portg?.percentile ?? null}
            label={bucketSingular(season.bucket)}
          />
          <RankDivider />
          <RankCell
            n={season.rankOverall}
            denom={season.cohortOverall}
            pct={pctOfRank(season.rankOverall, season.cohortOverall)}
            label="overall"
          />
          {showMidMajor && (
            <>
              <RankDivider />
              <RankCell
                n={season.rankNonPower!}
                denom={season.cohortNonPower}
                pct={pctOfRank(season.rankNonPower!, season.cohortNonPower)}
                label="mid major"
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
function pctOfRank(rank: number, cohort: number | null): number {
  if (cohort == null || cohort < 2) return 100;
  return Math.max(0, Math.min(100, Math.round(((cohort - rank + 1) / cohort) * 100)));
}
function RankDivider() {
  return <span className="w-px self-stretch bg-hairline mx-2 sm:mx-3 hidden sm:block" aria-hidden />;
}
function RankCell({
  n, denom, pct, label,
}: {
  n: number;
  denom: number | null;
  pct: number | null;
  label: string;
}) {
  // Tier-based treatment so the eye lands on the most notable rank first.
  //   top 3   → inverted coral fill on a chip, gold crown
  //   top 25  → coral numeral, no fill
  //   else    → ink numeral, neutral
  const tier = n <= 3 ? "elite" : n <= 25 ? "good" : "base";
  return (
    <div className="flex flex-col items-center justify-end min-w-[5rem] sm:min-w-[5.5rem] gap-1">
      <div className="relative flex items-start gap-1 leading-none">
        {tier === "elite" && (
          <span aria-hidden className="absolute -top-2.5 right-0 text-amber-500 text-[0.7rem] leading-none">★</span>
        )}
        <span
          className={cn(
            "font-display tabular tabular-nums leading-[0.85] tracking-[-0.05em] block",
            tier === "base" && "text-ink",
            tier === "good" && "text-coral",
            tier === "elite" && "text-coral drop-shadow-[0_1px_0_rgba(231,99,62,0.25)]",
          )}
          style={{ fontSize: tier === "elite" ? "2.6rem" : "2.2rem" }}
        >
          <span className="text-[0.45em] align-top font-semibold opacity-70 mr-[1px]">#</span>
          {n}
        </span>
      </div>
      <div className={cn(
        "text-[0.6rem] uppercase tracking-[0.18em] font-bold leading-none",
        tier === "base" ? "text-ink" : "text-coral",
      )}>
        {label}
      </div>
      {denom != null && (
        <div className="text-[0.5rem] uppercase tracking-[0.12em] text-ink-muted leading-none tabular tabular-nums">
          of {denom.toLocaleString()}
        </div>
      )}
      {/* Micro-progress bar — how far up the cohort the rank sits. */}
      {pct != null && (
        <div className="w-12 h-[3px] mt-1 rounded-full bg-ink/10 overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full",
              tier === "base" ? "bg-ink/40" : "bg-coral",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}
