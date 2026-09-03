import type { ReactNode } from "react";
import type { StaticTeamSeasonRow } from "@/lib/static-data";
import { PercentileChip, pctColor } from "@/components/percentile-chip";
import { BlurOverlay } from "@/components/teams/preview-blur";

/**
 * Distribution panel — a generic vs-D-I rank visualization. Each row shows
 * a stat label, the team's value, a colored rank pill, and a horizontal
 * gradient strip with a marker pinned at the team's percentile in the
 * year's national cohort. Used by both Shooting and Four Factors.
 *
 * Builders for specific stat sets live in this same file so the team page
 * does one import.
 */

/** "int" — a plain count or per-game figure, one decimal where there is one. */
export type DistributionFormat = "pct" | "intDiff" | "int";
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

type StatDef = {
  key: string;
  label: string;
  sub?: string;
  format: DistributionFormat;
  /**
   * The stat is better LOW, so rank ascending.
   *
   * Needed the moment shot rates arrived. Every stat in the two original sets
   * is better high, so buildRanks sorted descending and called it a percentile
   * — but a mid-range rate is the worst shot in basketball taken more often,
   * and a rim rate ALLOWED is a defence being carved up. Ranking those the
   * same way would have painted the two teams who do them least in coral and
   * called it a top-5 finish.
   */
  invert?: boolean;
};

const SHOOTING_STATS: StatDef[] = [
  { key: "ts_pct",    label: "True Shooting %", format: "pct" },
  { key: "efg_pct",   label: "Effective FG %",  format: "pct" },
  { key: "fg3_pct",   label: "3-Point %",       format: "pct" },
  { key: "fg3a_rate", label: "3PAR",            format: "pct" },
  { key: "fta_rate",  label: "FTAR",            format: "pct" },
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
    const cStats = current.team_season_stats as unknown as Record<string, number | null> | null;
    const value = cStats?.[stat.key] ?? null;

    const allVals = cohort
      .map((t) => {
        const ts = t.team_season_stats as unknown as Record<string, number | null> | null;
        return ts?.[stat.key] ?? null;
      })
      .filter((v): v is number => typeof v === "number");
    // Sorted BEST-FIRST, whichever direction that is, so rank 1 always means
    // best and the percentile the chip colours by always means the same thing.
    allVals.sort((a, b) => (stat.invert ? a - b : b - a));

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

/**
 * WHERE THE SHOTS COME FROM, AND WHETHER THEY GO IN.
 *
 * Every value here is reconstructed from the play-by-play archive — nobody
 * reports it — which is why it is the part of the Shooting tab that exists
 * nowhere else. The columns have been computed per five-man lineup and per
 * player for a while; this is the first time the team itself has been asked.
 *
 * THE DIRECTIONS ARE OPINIONS AND ARE STATED AS SUCH:
 *
 *   Rim rate, higher better. The rim is the most efficient shot in the game,
 *   and getting there more is the single clearest sign of an offence creating
 *   advantages rather than settling.
 *
 *   Mid-range rate, LOWER better. The long two is the least efficient shot in
 *   basketball — worth two points at roughly three-point difficulty. A team
 *   taking many is usually being forced into them.
 *
 *   Corner-three share, higher better. The corner three is the shortest three
 *   on the floor and converts several points per hundred better than one above
 *   the break, so taking a larger share of threes from there is shot quality
 *   rather than volume.
 *
 * The FG% rows carry no direction argument — making shots is better.
 *
 * COVERAGE DIFFERS INSIDE THIS PANEL and that is not a bug. The three RATES go
 * back to 2014; the four ZONE percentages start in 2022, because the shot
 * coordinates they need are not in the earlier play-by-play. An older season
 * shows the rates and a dash for the rest, which is the honest answer.
 */
const SHOT_PROFILE_STATS: StatDef[] = [
  { key: "rim_rate",        label: "Rim rate",      sub: "share of shots at the rim",   format: "pct" },
  { key: "rim_fg_pct",      label: "Rim FG %",                                          format: "pct" },
  { key: "mid_rate",        label: "Mid-range rate", sub: "the least efficient shot",   format: "pct", invert: true },
  { key: "mid_fg_pct",      label: "Mid-range FG %",                                    format: "pct" },
  { key: "corner3_share",   label: "Corner 3 share", sub: "of all threes taken",        format: "pct" },
  { key: "corner3_fg_pct",  label: "Corner 3 FG %",                                     format: "pct" },
  { key: "atb3_fg_pct",     label: "Above-break 3 FG %",                                format: "pct" },
];

/**
 * WHAT THE DEFENCE FORCES — the same three rates, from the other side.
 *
 * Read as a defensive philosophy rather than a scoreline. Allowing few rim
 * attempts and many mid-range ones is the shape of a defence doing its job:
 * protect the paint, run shooters off the line, live with the long two. So rim
 * and three rates allowed are better LOW, and the mid-range rate allowed is
 * better HIGH — the one row on the team page where a bigger number being green
 * is the whole point.
 *
 * There are no defensive zone percentages to pair with these. CBBD's shot
 * locations attach to the shooter, not to who contested, so "rim FG% allowed"
 * is not derivable from this archive.
 */
const SHOT_DEFENSE_STATS: StatDef[] = [
  { key: "rim_rate_def",   label: "Rim rate allowed",       sub: "shots conceded at the rim", format: "pct", invert: true },
  { key: "mid_rate_def",   label: "Mid-range rate forced",  sub: "higher is better here",     format: "pct" },
  { key: "three_rate_def", label: "3-point rate allowed",                                     format: "pct", invert: true },
];

export function buildShotProfileRanks(
  current: StaticTeamSeasonRow,
  cohort: StaticTeamSeasonRow[],
): DistributionRank[] {
  return buildRanks(current, cohort, SHOT_PROFILE_STATS);
}

export function buildShotDefenseRanks(
  current: StaticTeamSeasonRow,
  cohort: StaticTeamSeasonRow[],
): DistributionRank[] {
  return buildRanks(current, cohort, SHOT_DEFENSE_STATS);
}

/** True when a rank set has nothing to show, so the caller can omit the panel. */
export function ranksAreEmpty(ranks: DistributionRank[]): boolean {
  return ranks.every((r) => r.value === null);
}

// ---------- Component ----------

export function DistributionPanel({
  title,
  eyebrow = "vs D-I",
  ranks,
  children,
  blurBody = false,
}: {
  title: string;
  eyebrow?: string;
  ranks: DistributionRank[];
  children?: ReactNode;
  /** Preview mode — blur the stat rows + overlay the "no games yet" note; title stays sharp. */
  blurBody?: boolean;
}) {
  const body = (
    <>
      <div className="space-y-4">
        {ranks.map((r) => <StatRow key={r.key} stat={r} />)}
      </div>
      {children && (
        <div className="mt-5 pt-5 border-t border-hairline/60">
          {children}
        </div>
      )}
    </>
  );
  return (
    <div className="bg-paper-deep/25 -mx-6 lg:mx-0 rounded-none lg:rounded-xl border-y border-x-0 lg:border-x border-hairline shadow-sm p-6">
      <div className="flex items-baseline justify-between mb-5">
        <h3 className="font-display text-xl text-ink">{title}</h3>
        <span className="text-[0.65rem] uppercase tracking-widest text-ink-muted">
          {eyebrow}
        </span>
      </div>
      {blurBody ? <BlurOverlay>{body}</BlurOverlay> : body}
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
            <PercentileChip pct={stat.percentile} ariaLabel={`#${stat.rank} of ${stat.total}`}>
              #{stat.rank}
            </PercentileChip>
          )}
        </div>
      </div>
      <DistributionBar percentile={stat.percentile} />
    </div>
  );
}

function formatValue(v: number, format: DistributionFormat): string {
  if (format === "intDiff") return v > 0 ? `+${v}` : String(v);
  if (format === "int") return Number.isInteger(v) ? String(v) : v.toFixed(1);
  return (v * 100).toFixed(1) + "%";
}

function DistributionBar({ percentile }: { percentile: number }) {
  const left = Math.max(2, Math.min(98, percentile));
  return (
    <div
      className="ttz-ffbar relative h-2 rounded-full"
      role="img"
      aria-label={`${percentile}th percentile in D-I`}
    >
      <div
        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full border-2 border-paper shadow ring-1 ring-hairline/40"
        style={{ left: `${left}%`, background: pctColor(percentile) }}
        aria-hidden
      />
    </div>
  );
}

