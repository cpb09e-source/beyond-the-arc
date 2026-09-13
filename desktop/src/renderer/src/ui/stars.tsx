import { Star } from "lucide-react";

/**
 * A portal tier, as five stars. The tiers come from the rating's cutoffs
 * (scripts/rescore-portal.mjs), so five stars means exactly a top-100 player.
 */
export function Stars({ stars, size = 12 }: { stars: number; size?: number }) {
  if (stars <= 0) return <span className="text-ink-muted">–</span>;
  return (
    <span role="img" aria-label={`${stars} of 5 stars`} className="inline-flex items-center gap-[2px]">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={size}
          strokeWidth={2}
          fill={n <= stars ? "currentColor" : "none"}
          className={n <= stars ? "text-accent" : "text-ink-muted/35"}
        />
      ))}
    </span>
  );
}
