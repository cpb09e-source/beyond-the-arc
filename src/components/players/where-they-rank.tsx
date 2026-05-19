import type { PlayerRanksSeason } from "@/lib/static-data";

/**
 * Where-they-rank panels for a single player-season. Surfaces the player's
 * top 5 (where they shine) and bottom 5 (weakest categories) across the
 * ~20 ranked stats, cohorted within their year × position bucket.
 *
 * "Bottom 5" already accounts for stat direction — a player in the 5th
 * percentile of TOV% means they turn the ball over a lot (low rank is bad),
 * since the rank script flipped direction for low-is-better stats.
 *
 * Visual mirrors the team page's strengths/weaknesses cards.
 */
export type StatFormat = "num" | "pct" | "pct100";
export type StatMeta = { label: string; format: StatFormat };

export const STAT_META: Record<string, StatMeta> = {
  pts_pg: { label: "PTS/G", format: "num" },
  reb_pg: { label: "REB/G", format: "num" },
  ast_pg: { label: "AST/G", format: "num" },
  stl_pg: { label: "STL/G", format: "num" },
  blk_pg: { label: "BLK/G", format: "num" },
  ortg:    { label: "ORtg",  format: "num" },
  usage:   { label: "Usage%", format: "pct100" },
  efg_pct: { label: "eFG%",  format: "pct100" },
  ts_pct:  { label: "TS%",   format: "pct100" },
  orb_pct: { label: "OREB%", format: "pct100" },
  drb_pct: { label: "DREB%", format: "pct100" },
  ast_pct: { label: "AST%",  format: "pct100" },
  tov_pct: { label: "TOV%",  format: "pct100" },
  ft_pct:  { label: "FT%",   format: "pct" },
  fg2_pct: { label: "2P%",   format: "pct" },
  fg3_pct: { label: "3P%",   format: "pct" },
  blk_pct: { label: "BLK%",  format: "pct100" },
  stl_pct: { label: "STL%",  format: "pct100" },
  hkm_pct: { label: "HKM%",  format: "pct100" },
  ftr:     { label: "FT Rate", format: "num" },
  porpag:  { label: "PORPAG", format: "num" },
  pir:       { label: "PIR",      format: "num" },
  bta_portg: { label: "BTA PRTG", format: "num" },
};

export function fmtValue(v: number, format: StatFormat): string {
  if (format === "pct") return (v * 100).toFixed(1) + "%";
  if (format === "pct100") return v.toFixed(1) + "%";
  return v.toLocaleString("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
}

// Convert a 1-100 percentile (where 100 = best in cohort) into a 1-based rank
// against the cohort. e.g. 100th percentile in a cohort of 400 → rank #1.
function percentileToRank(percentile: number, cohortSize: number): number {
  return Math.max(1, Math.round(((100 - percentile) / 100) * cohortSize) + 1);
}

export function bucketLabel(b: "G" | "F" | "C"): string {
  return b === "G" ? "guards" : b === "F" ? "forwards" : "centers";
}

export function seasonLabel(y: number): string {
  return `${(y - 1).toString().slice(-2)}-${y.toString().slice(-2)}`;
}

export function WhereTheyRank({ season }: { season: PlayerRanksSeason }) {
  const ranked = Object.entries(season.stats)
    .filter(([k]) => STAT_META[k])
    .map(([k, s]) => ({
      key: k,
      value: s.value,
      percentile: s.percentile,
      rank: percentileToRank(s.percentile, season.cohortSize),
    }));
  const top5 = [...ranked].sort((a, b) => b.percentile - a.percentile).slice(0, 5);
  const bottom5 = [...ranked].sort((a, b) => a.percentile - b.percentile).slice(0, 5);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-hairline border border-hairline rounded-lg overflow-hidden">
      <RankPanel
        title="Where they rank best"
        tone="best"
        rows={top5}
        cohortSize={season.cohortSize}
        bucket={season.bucket}
        year={season.year}
      />
      <RankPanel
        title="Where they rank worst"
        tone="worst"
        rows={bottom5}
        cohortSize={season.cohortSize}
        bucket={season.bucket}
        year={season.year}
      />
    </div>
  );
}

function RankPanel({
  title, tone, rows, cohortSize, bucket, year,
}: {
  title: string;
  tone: "best" | "worst";
  rows: { key: string; value: number; percentile: number; rank: number }[];
  cohortSize: number;
  bucket: "G" | "F" | "C";
  year: number;
}) {
  const pillClass = tone === "best"
    ? "text-emerald-700 bg-emerald-50"
    : "text-rose-700 bg-rose-50";
  return (
    <div className="bg-card p-5 lg:p-6">
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="text-xs uppercase tracking-widest text-coral font-bold">{title}</h3>
        <span className="text-[0.6rem] text-ink-muted">of {cohortSize} {bucketLabel(bucket)} · {seasonLabel(year)}</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">Not enough data to rank.</p>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r) => {
            const meta = STAT_META[r.key]!;
            return (
              <div key={r.key} className="flex items-center gap-3">
                <span className={`inline-flex items-center justify-center font-display text-base tabular shrink-0 w-14 h-8 rounded-md ${pillClass}`}>
                  #{r.rank}
                </span>
                <span className="flex-1 text-sm text-ink">{meta.label}</span>
                <span className="text-sm tabular text-ink font-medium">{fmtValue(r.value, meta.format)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
