/**
 * Tier-colored seed bubble used across the coach profile: appearance rows in
 * March Madness, opponent seeds in the game rows, and the box-score modal.
 *
 *   Seeds 1-4   → blue   (elite / chalk)
 *   Seeds 5-8   → green  (high but beatable)
 *   Seeds 9-12  → amber  (the upset zone)
 *   Seeds 13-16 → red    (cinderellas)
 *
 * Size variants: "sm" (5×5) for inline use in game rows, "md" (7×7) for
 * appearance headers.
 */
export function SeedChip({ seed, size = "md" }: { seed: number; size?: "sm" | "md" }) {
  let classes: string;
  if (seed <= 4) classes = "bg-coral/15 text-coral";
  else if (seed <= 8) classes = "bg-good/15 text-good";
  else if (seed <= 12) classes = "bg-court/25 text-court-ink";
  else classes = "bg-bad/15 text-bad";
  const sizeClasses =
    size === "sm" ? "text-[0.6rem] w-5 h-5" : "text-xs w-7 h-7";
  return (
    <span
      className={`inline-flex items-center justify-center tabular font-semibold rounded-full shrink-0 ${sizeClasses} ${classes}`}
      title={`#${seed} seed`}
      aria-label={`Seed ${seed}`}
    >
      {seed}
    </span>
  );
}
