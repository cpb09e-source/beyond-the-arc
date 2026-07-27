import type { PlayerRanksSeason } from "@/lib/static-data";

/**
 * BTA PRTG leaderboard rings — one per rank dimension (bucket / overall /
 * mid-major when non-power).
 *
 * Lives in its own module because it renders in the player-page hero, which is
 * a server component; it used to sit inside player-overview.tsx and importing
 * from there would have dragged that whole "use client" boundary into the hero
 * for a component that has no interactivity at all.
 */
export function bucketSingular(b: "G" | "F" | "C"): string {
  return b === "G" ? "guard" : b === "F" ? "forward" : "center";
}

export function pctOfRank(rank: number, cohort: number | null): number {
  if (cohort == null || cohort < 2) return 100;
  return Math.max(0, Math.min(100, Math.round(((cohort - rank + 1) / cohort) * 100)));
}

export function RankRings({ season, size }: { season: PlayerRanksSeason; size?: number }) {
  if (season.rank == null || season.rankOverall == null) return null;
  const showMidMajor = season.rankNonPower != null && season.cohortNonPower != null;
  return (
    <div className="flex items-start gap-4 sm:gap-6">
      <RankRing
        n={season.rank}
        denom={season.cohortSize}
        pct={season.stats.bta_portg?.percentile ?? null}
        label={bucketSingular(season.bucket)}
        size={size}
      />
      <RankRing
        n={season.rankOverall}
        denom={season.cohortOverall}
        pct={pctOfRank(season.rankOverall, season.cohortOverall)}
        label="overall"
        size={size}
        soft
      />
      {showMidMajor && (
        <RankRing
          n={season.rankNonPower!}
          denom={season.cohortNonPower}
          pct={pctOfRank(season.rankNonPower!, season.cohortNonPower)}
          label="mid major"
          size={size}
          soft
        />
      )}
    </div>
  );
}

/**
 * Rank ring — the site's percentile gauge grown up. The arc fills with the
 * player's percentile inside that cohort, the ordinal + cohort label sit in
 * the middle, and "of N" rides underneath. Replaced a numeral/micro-bar cell
 * per Colin: the ring nearly closing on itself IS the elite signal, so the
 * old tier styling (coral numerals, crown star) had nothing left to add.
 */
export function RankRing({
  n, denom, pct, label, soft, size = 78,
}: {
  n: number;
  denom: number | null;
  pct: number | null;
  label: string;
  /** Secondary cells (overall / mid-major) run the lighter accent. */
  soft?: boolean;
  size?: number;
}) {
  const stroke = Math.max(4, Math.round(size / 15.5));
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
        {/* px-2.5 keeps the label off the stroke, and mt-0.5 (was mt-1) sits it
            nearer the middle where the circle is widest — "OVERALL" is the
            longest label and was running right into the ring at both sizes.
            Tracking is tighter here than the site's usual 0.16em for the same
            reason; at 8px it costs nothing legible. */}
        <div className="absolute inset-0 flex flex-col items-center justify-center leading-none px-2.5">
          <span className="font-display text-xl text-ink tabular tabular-nums tracking-tighter">
            <span className="text-[0.6em] align-top opacity-60 mr-px">#</span>{n}
          </span>
          <span className="mt-0.5 text-[0.5rem] uppercase tracking-[0.08em] font-bold text-ink-muted whitespace-nowrap">
            {label}
          </span>
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
