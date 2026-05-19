import type { ReactNode } from "react";
import type { StaticTeamSeasonRow } from "@/lib/static-data";
import { cn } from "@/lib/utils";

/**
 * Distribution panel — a generic vs-D-I rank visualization. Each row shows
 * a stat label, the team's value, a colored rank pill, and a horizontal
 * gradient strip with a marker pinned at the team's percentile in the
 * year's national cohort. Used by both Shooting and Four Factors.
 *
 * Builders for specific stat sets live in this same file so the team page
 * does one import.
 */

export type DistributionFormat = "pct" | "intDiff";
export type DistributionRank = {
  key: string;
  label: string;
  sub?: string;            // optional inline subhead (e.g. "fast-break points vs allowed")
  value: number | null;
  rank: number | null;
  total: number;
  percentile: number;      // 0-100, higher = better
  format: DistributionFormat;
};

// ---------- Stat-set definitions ----------

type StatDef = { key: string; label: string; sub?: string; format: DistributionFormat };

const SHOOTING_STATS: StatDef[] = [
  { key: "ts_pct",    label: "True Shooting %", format: "pct" },
  { key: "efg_pct",   label: "Effective FG %",  format: "pct" },
  { key: "fg3_pct",   label: "3-Point %",       format: "pct" },
  { key: "fg3a_rate", label: "3PA Rate",        format: "pct" },
  { key: "fta_rate",  label: "FTA Rate",        format: "pct" },
  { key: "ast_pct",   label: "Assist %",        format: "pct" },
];

const FOUR_FACTOR_STATS: StatDef[] = [
  { key: "reb_diff",      label: "REB Diff",  sub: "total rebounds vs allowed",   format: "intDiff" },
  { key: "orb_pct",       label: "OREB %",    sub: "offensive rebound rate",      format: "pct" },
  { key: "fbpts_diff",    label: "FBP Diff",  sub: "fast-break points vs allowed", format: "intDiff" },
  { key: "fg3_made_diff", label: "3PM Diff",  sub: "3-pointers made vs allowed",  format: "intDiff" },
];

// ---------- Builders ----------

function buildRanks(
  current: StaticTeamSeasonRow,
  cohort: StaticTeamSeasonRow[],
  defs: StatDef[],
): DistributionRank[] {
  return defs.map((stat) => {
    const cStats = current.team_cbba_stats as unknown as Record<string, number | null> | null;
    const value = cStats?.[stat.key] ?? null;

    const allVals = cohort
      .map((t) => {
        const ts = t.team_cbba_stats as unknown as Record<string, number | null> | null;
        return ts?.[stat.key] ?? null;
      })
      .filter((v): v is number => typeof v === "number");
    allVals.sort((a, b) => b - a); // higher = better

    const total = allVals.length;
    let rank: number | null = null;
    let percentile = 50;
    if (value !== null && total > 0) {
      rank = allVals.indexOf(value) + 1;
      percentile = Math.round(((total - rank + 1) / total) * 100);
    }
    return { key: stat.key, label: stat.label, sub: stat.sub, value, rank, total, percentile, format: stat.format };
  });
}

export function buildShootingRanks(
  current: StaticTeamSeasonRow,
  cohort: StaticTeamSeasonRow[],
): DistributionRank[] {
  return buildRanks(current, cohort, SHOOTING_STATS);
}

export function buildFourFactorRanks(
  current: StaticTeamSeasonRow,
  cohort: StaticTeamSeasonRow[],
): DistributionRank[] {
  return buildRanks(current, cohort, FOUR_FACTOR_STATS);
}

// ---------- Component ----------

export function DistributionPanel({
  title,
  eyebrow = "vs D-I",
  ranks,
  children,
}: {
  title: string;
  eyebrow?: string;
  ranks: DistributionRank[];
  children?: ReactNode;
}) {
  return (
    <div className="bg-paper-deep/25 border border-hairline rounded-xl shadow-sm p-6">
      <div className="flex items-baseline justify-between mb-5">
        <h3 className="font-display text-xl text-ink">{title}</h3>
        <span className="text-[0.65rem] uppercase tracking-widest text-ink-muted">
          {eyebrow}
        </span>
      </div>
      <div className="space-y-4">
        {ranks.map((r) => <StatRow key={r.key} stat={r} />)}
      </div>
      {children && (
        <div className="mt-5 pt-5 border-t border-hairline/60">
          {children}
        </div>
      )}
    </div>
  );
}

function StatRow({ stat }: { stat: DistributionRank }) {
  if (stat.value === null) {
    return (
      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-ink-soft">{stat.label}</span>
          <span className="text-ink-muted text-sm">—</span>
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5 gap-3">
        <span className="text-sm text-ink-soft min-w-0">
          {stat.label}
          {stat.sub && <span className="text-ink-muted text-xs ml-2">{stat.sub}</span>}
        </span>
        <div className="flex items-baseline gap-2.5 shrink-0">
          <span className="text-base tabular font-semibold text-ink">
            {formatValue(stat.value, stat.format)}
          </span>
          {stat.rank !== null && (
            <span
              className={cn(
                "inline-flex items-center text-[0.65rem] tabular font-semibold px-1.5 py-0.5 rounded leading-none whitespace-nowrap",
                chipClasses(stat.percentile),
              )}
              title={`#${stat.rank} of ${stat.total}`}
            >
              #{stat.rank}
            </span>
          )}
        </div>
      </div>
      <DistributionBar percentile={stat.percentile} />
    </div>
  );
}

function formatValue(v: number, format: DistributionFormat): string {
  if (format === "intDiff") return v > 0 ? `+${v}` : String(v);
  return (v * 100).toFixed(1) + "%";
}

function DistributionBar({ percentile }: { percentile: number }) {
  const left = Math.max(2, Math.min(98, percentile));
  return (
    <div
      className="relative h-2 rounded-full bg-gradient-to-r from-rose-200/70 via-paper-deep to-emerald-200/70"
      role="img"
      aria-label={`${percentile}th percentile in D-I`}
    >
      <div
        className={cn(
          "absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full border-2 border-paper shadow ring-1 ring-hairline/40",
          markerBg(percentile),
        )}
        style={{ left: `${left}%` }}
        aria-hidden
      />
    </div>
  );
}

function markerBg(p: number): string {
  if (p >= 90) return "bg-emerald-500";
  if (p >= 75) return "bg-emerald-400";
  if (p >= 60) return "bg-emerald-300";
  if (p >= 40) return "bg-ink-soft";
  if (p >= 25) return "bg-rose-300";
  if (p >= 10) return "bg-rose-400";
  return "bg-rose-500";
}

function chipClasses(p: number): string {
  if (p >= 90) return "bg-emerald-500 text-white";
  if (p >= 75) return "bg-emerald-200 text-emerald-900";
  if (p >= 60) return "bg-emerald-100 text-emerald-800";
  if (p >= 40) return "bg-paper-deep text-ink-soft";
  if (p >= 25) return "bg-rose-100 text-rose-800";
  if (p >= 10) return "bg-rose-200 text-rose-900";
  return "bg-rose-500 text-white";
}
