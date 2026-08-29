"use client";

import { cn } from "@/lib/utils";

/**
 * The top-100 mark, at table scale.
 *
 * NOT THE SEAL. The player page's mark is a dial of a hundred ticks around the
 * rank — a good object at 72px and mush at 20, which is all a table row has.
 * This says the same thing in the space available: the board position, in the
 * tier colour the seal would have used, so the two read as the same fact
 * without one pretending to be the other.
 *
 * The tiers are the seal's own, and the tokens are shared with it (globals.css)
 * so a change to the palette moves both: 1-10, 11-25, 26-100.
 */
function tierOf(rank: number): "ov1" | "ov2" | "ov3" {
  if (rank <= 10) return "ov1";
  if (rank <= 25) return "ov2";
  return "ov3";
}

export function TopHundredPill({
  rank,
  className,
}: {
  /** Overall board position, 1-100. */
  rank: number;
  className?: string;
}) {
  const tier = tierOf(rank);
  return (
    <span
      title={`Top 100 — #${rank} in the country last season`}
      className={cn(
        // SQUARED OFF, not a pill. A capsule reads as a status chip -
        // "transferred", "committed" - and this is a number. The small
        // radius keeps it a plate with a rank stamped on it.
        "inline-flex items-center gap-0.5 rounded-[3px] px-1 h-4 shrink-0",
        "text-[0.6rem] font-bold tabular leading-none align-middle",
        className,
      )}
      style={{
        color: `var(--seal-${tier}-ink)`,
        background: `color-mix(in oklab, var(--seal-${tier}-tick) 14%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklab, var(--seal-${tier}-tick) 35%, transparent)`,
      }}
    >
      <span className="opacity-70">#</span>{rank}
    </span>
  );
}
