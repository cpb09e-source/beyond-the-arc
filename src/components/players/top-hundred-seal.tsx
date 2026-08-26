import type { PlayerRanksSeason } from "@/lib/static-data";
import { cn } from "@/lib/utils";

/**
 * Top-100 seal — the player hero's rank display.
 *
 * Two boards, a hundred deep each: overall, and mid-major (non-power
 * conferences). On the 25-26 season that is 100 + 100 with 28 players holding
 * both — 172 of 2,233 ranked players, and under 1% of everyone in the database.
 *
 * The scarcity IS the design. This replaced a set of percentile rings that
 * every ranked player carried, which meant they said nothing: a ring three
 * quarters full for a #693 looked much like a ring for a #3, and the shape
 * appeared so often it read as chrome. A mark almost nobody has is worth
 * drawing. Everyone below the line renders nothing at all and the masthead
 * closes up around it.
 *
 * Gold is the overall board and blue is the mid-major board, everywhere and
 * without exception, so the two honours can never be mistaken for each other.
 */

const CUTOFF = 100;

export function TopHundredSeal({
  season,
  size = 96,
  compact = false,
  className,
}: {
  season: PlayerRanksSeason;
  size?: number;
  /**
   * The small variant, for a phone. Drops the board label and stacks TOP over
   * 100 — at this diameter a one-line "TOP 100" would have to set at about
   * 4.5px to fit the inner circle, which is not type any more. Stacking buys
   * the words their size back, and the colour still says which board it is:
   * gold overall, blue mid-major, the same everywhere.
   *
   * The stacked label sets at 0.155 of the diameter, not 0.12. At the original
   * 54px mark that ratio put "TOP" and "100" at 6.5px — present, but not
   * readable at arm's length on a phone, which is the only place this variant
   * renders.
   */
  compact?: boolean;
  className?: string;
}) {
  const overall = season.rankOverall !== null && season.rankOverall <= CUTOFF ? season.rankOverall : null;
  // rankNonPower is populated only for players whose own conference is not a
  // power league, so this is already scoped — no need to re-check the conf.
  const mid = season.rankNonPower !== null && season.rankNonPower <= CUTOFF ? season.rankNonPower : null;
  if (overall === null && mid === null) return null;

  // A PAIR SHARES THE ROOM; ONE MARK TAKES IT.
  //
  // On a phone these sit on the name's line, right-aligned, so every pixel they
  // take comes off the name. One seal at full size leaves a comfortable line.
  // Two at full size do not: measured at 390px, a player holding both boards
  // had "Nolan Minessale" down to 85px and wrapping to three lines. The pair
  // steps down instead — still well clear of the 6.5px label this mark used to
  // set at, and the name gets its line back.
  //
  // Desktop is unaffected: there the mark sits in its own column with room for
  // two at full size.
  const both = overall !== null && mid !== null;
  const each = compact && both ? Math.round(size * 0.8) : size;

  return (
    // Tighter gap in the compact pair: on a 400px phone a player who holds both
    // marks has them, a headshot and their name competing for one line, and the
    // gap is the cheapest thing to give up.
    <div className={cn("flex items-center", compact ? "gap-1.5" : "gap-3", className)}>
      {overall !== null && (
        <Seal rank={overall} label="Overall" of={season.cohortOverall} size={each} compact={compact} />
      )}
      {mid !== null && (
        <Seal rank={mid} label="Mid-major" of={season.cohortNonPower} size={each} compact={compact} mid />
      )}
    </div>
  );
}

function Seal({
  rank,
  label,
  of,
  size,
  compact = false,
  mid = false,
}: {
  rank: number;
  label: string;
  of: number | null;
  size: number;
  compact?: boolean;
  mid?: boolean;
}) {
  // Everything scales off the diameter so one `size` prop drives the whole
  // mark — the hero renders it smaller on a phone than on a desktop.
  const accent = mid ? "var(--coral)" : "var(--court-ink)";
  const ring = mid
    ? "color-mix(in oklab, var(--coral) 45%, transparent)"
    : "color-mix(in oklab, var(--court) 78%, transparent)";
  // The compact mark stacks TOP over 100 over the rank, so it carries a taller
  // column of type than the desktop one does in a smaller circle. It gets a
  // thinner margin between the two rings to buy that column its clearance —
  // at the desktop inset the rank's cap was landing on the inner ring.
  // 8 rather than 10 on the compact mark: the ring margin is the cheapest
  // place to find room for the label now that it sets larger, and at this
  // diameter a 4px band still reads as two rings rather than one thick one.
  const inner = size - (compact ? 8 : 14);

  return (
    <div
      className="rounded-full flex items-center justify-center shrink-0 bg-paper"
      style={{ width: size, height: size, boxShadow: `inset 0 0 0 1.5px ${ring}` }}
      title={`Top 100 ${label.toLowerCase()}${of ? ` — ranked ${rank} of ${of.toLocaleString("en-US")}` : ` — ranked ${rank}`}`}
    >
      <div
        className="rounded-full flex flex-col items-center justify-center"
        style={{ width: inner, height: inner, boxShadow: `inset 0 0 0 1px ${ring}` }}
      >
        {compact ? (
          <>
            <span
              className="font-bold uppercase leading-none"
              style={{ fontSize: size * 0.155, letterSpacing: "0.12em", color: accent, textIndent: "0.12em" }}
            >
              Top
            </span>
            <span
              className="font-bold uppercase leading-none"
              style={{ fontSize: size * 0.155, letterSpacing: "0.04em", color: accent, textIndent: "0.04em", marginTop: size * 0.01 }}
            >
              100
            </span>
          </>
        ) : (
          <span
            className="font-bold uppercase leading-none"
            style={{ fontSize: size * 0.078, letterSpacing: "0.2em", color: accent, textIndent: "0.2em" }}
          >
            Top 100
          </span>
        )}
        <span className="flex items-baseline" style={{ gap: 1, marginTop: size * (compact ? 0.022 : 0.03) }}>
          <span
            className="font-display font-semibold leading-none"
            style={{ fontSize: size * (compact ? 0.125 : 0.125), color: accent, opacity: 0.6 }}
          >
            #
          </span>
          <span
            className="font-display font-bold leading-none text-ink"
            style={{ fontSize: size * (compact ? 0.30 : 0.315), letterSpacing: "-0.04em" }}
          >
            {rank}
          </span>
        </span>
        {/* The rule and the board name are the desktop mark's bottom half. On a
            phone the colour carries the board on its own, and dropping both
            gives the rank the room it needs. */}
        {!compact && (
          <>
            <span
              style={{
                width: size * 0.27,
                height: 1,
                background: ring,
                margin: `${size * 0.03}px 0`,
              }}
            />
            <span
              className="font-bold uppercase leading-none"
              style={{ fontSize: size * 0.073, letterSpacing: "0.16em", color: accent, textIndent: "0.16em" }}
            >
              {label}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
