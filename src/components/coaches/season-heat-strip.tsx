import type { CoachSeason } from "@/lib/coaches";

/**
 * Compact horizontal strip: one cell per season, colored by win %. Reads as
 * a career signature at a glance — bright coral = winning seasons clustered
 * together; muted = down years. Tooltips on each cell carry the full record.
 *
 * Pure SSR, no JS, no chart library.
 */
export function SeasonHeatStrip({ seasons }: { seasons: CoachSeason[] }) {
  const data = [...seasons]
    .filter((s) => s.wins !== null && s.losses !== null)
    .sort((a, b) => a.year - b.year);
  if (data.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-px h-7 rounded overflow-hidden border border-hairline">
        {data.map((s, i) => {
          const games = (s.wins ?? 0) + (s.losses ?? 0);
          const pct = games > 0 ? (s.wins ?? 0) / games : 0;
          // 0.35 baseline opacity so down-years are still visible. Pushes to
          // 1.0 at perfect winning seasons. The cell width grows with the
          // strip width via flex-1.
          const opacity = 0.35 + 0.65 * Math.min(1, Math.max(0, pct));
          return (
            <span
              key={`${s.year}-${i}`}
              className="flex-1 h-full bg-coral"
              style={{ opacity }}
              title={`${s.year - 1}-${String(s.year).slice(2)} · ${s.team} · ${s.wins}-${s.losses} (${(pct * 100).toFixed(1)}%)`}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium tabular mt-1.5">
        <span>{(data[0]!.year - 1).toString().slice(-2)}–{String(data[0]!.year).slice(2)}</span>
        <span className="text-ink-muted/60">Every season as one cell, color tracks win %.</span>
        <span>{(data[data.length - 1]!.year - 1).toString().slice(-2)}–{String(data[data.length - 1]!.year).slice(2)}</span>
      </div>
    </div>
  );
}
