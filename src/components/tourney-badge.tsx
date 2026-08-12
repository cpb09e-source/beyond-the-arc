import { tourneyBadge } from "@/data/tournament-results";
import { cn } from "@/lib/utils";

/**
 * Visual marker for tournament accomplishments — a hardwood chip reading
 * "Champion" or "F4". Returns null when the team didn't reach the Final Four
 * that season.
 *
 * WHAT THIS REPLACED, and why: the champion used to be a filled circle holding
 * a trophy glyph while everyone else got a saturated coral "F4" pill. Two
 * unrelated visual languages for one idea, and the circle's amber was
 * Tailwind's stock `amber-500` — a colour that appeared nowhere else in the
 * palette. Now both honours share a shape, a type treatment and the site's own
 * `--court` hardwood token; only the fill separates them. Ink-on-tint rather
 * than white-on-saturated keeps the chip from outshouting the team name it sits
 * beside, which matters on a table where three of the top four rows can carry
 * one.
 *
 * The two tiers are deliberately distinguished by FILL, not hue, so the pair
 * still reads correctly for anyone who can't separate the two browns.
 */

// Shared geometry + type. Small caps, tight, sized to sit on one line of table
// text without changing the row's height.
//
// Deliberately built from Tailwind's standard scale (px-1.5, py-0.5, rounded,
// tracking-widest) rather than one-off arbitrary values. Bespoke lengths like
// `h-[1.15rem]` are generated only if the scanner has seen this exact file, so
// they silently no-op after a stale rescan — which is precisely how the first
// cut of this chip rendered at half height with no padding. Scale utilities are
// already present in the stylesheet, so they cannot fail that way, and the chip
// now grows from its own padding instead of a fixed height.
//
// Sized down on phones on top of the shortened labels: padding, type and
// tracking step down together, because shrinking type alone leaves a chip that
// is mostly padding.
const CHIP =
  "inline-flex items-center rounded border font-bold uppercase leading-none whitespace-nowrap align-middle " +
  "px-1 py-px text-[0.5rem] tracking-wider " +
  "sm:px-1.5 sm:py-0.5 sm:text-[0.6rem] sm:tracking-widest";

export function TourneyBadge({
  teamName,
  year,
  className,
}: {
  teamName: string;
  year: number;
  className?: string;
}) {
  const kind = tourneyBadge(teamName, year);
  if (!kind) return null;

  const season = `${year - 1}-${String(year).slice(-2)}`;
  const champion = kind === "champion";

  return (
    <span
      className={cn(
        CHIP,
        // Colours come from the registered --court token with opacity
        // modifiers, the way every other border on the site is written
        // (border-coral/40, border-ink/15). An arbitrary
        // `border-[color-mix(...)]` does NOT work here with or without a
        // `color:` hint — it never produces a rule, so the chip silently fell
        // back to the global `* { border-color: var(--border) }` hairline while
        // the matching bg and text mixes applied fine.
        champion
          ? // Filled: the title is the louder of the two.
            "bg-court/25 border-court/70 text-court-ink"
          : // Outlined: same chip, no fill. Text is ink softened toward the
            // hardwood so it reads as kin to the champion chip, not a grey pill.
            "bg-transparent border-court/55 text-ink-soft",
        className,
      )}
      title={champion ? `${season} national champion` : `${season} Final Four`}
    >
      {/* One token at every width. "Final Four" was two words of
          tracking-widest type sitting next to a 20px logo, which made it the
          widest thing in the column and pushed RECORD toward the fold; the
          honour is context, not the row's subject, so it yields first.
          Champion keeps its word because it already is one and reads instantly;
          Final Four becomes the "F4" that everyone writing about the tournament
          already uses. Both still share one chip, one type treatment and one
          hardwood token — the abbreviation is a length change, not a second
          visual language. Full wording stays in the title. */}
      {champion ? "Champion" : "F4"}
    </span>
  );
}
