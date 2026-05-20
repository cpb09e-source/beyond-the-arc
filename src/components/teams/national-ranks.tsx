import type { RankedStat } from "@/lib/static-data";
import { PercentileChip } from "@/components/percentile-chip";

/**
 * Hero-level "barbell" of a team's national ranks for the season.
 * Two side-by-side columns: top-5 strengths on the left, bottom-5 weaknesses
 * on the right. Each entry's left chip is colored by percentile so the
 * visual tone of each column tells the story before you read a label.
 */
export function NationalRanks({
  top, bottom, total,
}: {
  top: RankedStat[];
  bottom: RankedStat[];
  total: number;
}) {
  if (top.length === 0 && bottom.length === 0) return null;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      <Column kicker="Where they rank best" items={top} total={total} />
      <Column kicker="Where they rank worst" items={bottom} total={total} />
    </div>
  );
}

function Column({ kicker, items, total }: { kicker: string; items: RankedStat[]; total: number }) {
  return (
    <div className="bg-paper-deep/25 border border-hairline rounded-xl shadow-sm p-5 lg:p-6">
      <div className="flex items-baseline justify-between mb-4">
        <span className="text-xs uppercase tracking-widest text-coral font-medium">{kicker}</span>
        <span className="text-[0.65rem] text-ink-muted tabular">of {total} D-I teams</span>
      </div>
      <ul className="divide-y divide-hairline/40">
        {items.map((s) => (
          <li key={s.key} className="flex items-center gap-4 py-2.5 px-1 -mx-1 rounded transition-colors hover:bg-[var(--accent-tint)]">
            <RankBadge rank={s.rank} total={s.total} />
            <span className="flex-1 min-w-0 text-ink-soft text-sm">{s.label}</span>
            <span className="flex-none font-medium text-ink tabular text-sm">{formatStat(s.value, s.format)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RankBadge({ rank, total }: { rank: number; total: number }) {
  // rank 1 = best → percentile 100 (green); rank=total → percentile 0 (red).
  const pct = total > 1 ? Math.round(((total - rank) / (total - 1)) * 100) : 100;
  return (
    <PercentileChip pct={pct} className="flex-none" ariaLabel={`Rank ${rank} of ${total}`}>
      #{rank}
    </PercentileChip>
  );
}

function formatStat(v: number, format: RankedStat["format"]): string {
  switch (format) {
    case "num1":    return v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    case "num2":    return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case "pct1":    return (v * 100).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";
    case "intDiff": return v > 0 ? `+${v}` : String(v);
  }
}
