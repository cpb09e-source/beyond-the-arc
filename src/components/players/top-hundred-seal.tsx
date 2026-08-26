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
 * THE MARK IS A DIAL — a ring of a hundred ticks, one per place, with the rank
 * set inside it. It replaced a pair of concentric rules, which were decoration:
 * they drew the same shape for #1 and for #97, so the ring said nothing the
 * number inside it had not already said. The dial makes the ring carry the
 * standing.
 *
 * COLOUR IS THE TIER, NOT THE BOARD. Five hues for five tiers — overall 1-10,
 * 11-25, 26-100, mid-major 1-10, 11-100 — which means the word under the rank
 * is the only thing separating the two boards. That is a deliberate trade: the
 * tier is what a reader wants at a glance and the board is what they want on a
 * second look. The values are tokens in globals.css; see the note there.
 */

const CUTOFF = 100;

type Tier = "ov1" | "ov2" | "ov3" | "mm1" | "mm2";

function tierOf(rank: number, mid: boolean): Tier {
  if (mid) return rank <= 10 ? "mm1" : "mm2";
  if (rank <= 10) return "ov1";
  if (rank <= 25) return "ov2";
  return "ov3";
}

/**
 * How much of the ring a rank lights, as a fraction of it.
 *
 * ONE TICK PER PLACE, COUNTING DOWN FROM THE TOP. #1 lights all hundred, #10
 * lights ninety-one, #100 lights one. The ring is a literal readout: the arc
 * you can see is how many of the hundred this player is ahead of.
 *
 * THIS IS A DELIBERATE REPLACEMENT FOR A CURVE. The fill used to be
 * `1 - sqrt((rank-1)/99)`, which spread the top of the board out so the top ten
 * took about a third of the ring instead of a twentieth. It made #1 and #5
 * visibly different, which the linear model cannot — but it also meant the arc
 * did not mean anything you could state: #10 lit 70% of the ring and read as
 * something nearer 25th. A gauge that cannot be checked against the number
 * printed inside it is worse than a gauge with a crowded top end.
 *
 * The cost is real and known: the entire top ten now sits in the last 9% of the
 * arc, so #1 and #5 are four ticks apart at 96px and two at 58px, where each
 * tick stands for two places. Telling those apart is the TIER COLOUR's job —
 * 1-10 has its own hue on both boards — not the ring's.
 *
 * It still fills down from #1 rather than up from #100. One tick per place
 * counted the other way would run backwards against every other coloured thing
 * on this site, where a fuller bar means a better number.
 */
function litFraction(rank: number) {
  return (CUTOFF + 1 - rank) / CUTOFF;
}

export function TopHundredSeal({
  season,
  size = 96,
  compact = false,
  className,
}: {
  season: PlayerRanksSeason;
  size?: number;
  /**
   * The small variant, for a phone. Same words as the desktop mark, set far
   * larger in proportion — at the desktop ratio "MID-MAJOR" lands at about 4px
   * here, which is not type any more. The board is the one thing colour cannot
   * say on this mark, because colour is spent on the tier, so the word has to
   * be readable rather than merely present.
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
  // steps down instead, and the compact label ratio keeps it readable there.
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
  const tier = tierOf(rank, mid);
  const tick = `var(--seal-${tier}-tick)`;
  const ink = `var(--seal-${tier}-ink)`;

  // A hundred ticks below 72px is texture rather than a count — halve the
  // resolution there and let each tick stand for two places.
  const total = size >= 72 ? 100 : 50;
  const lit = Math.min(total, Math.max(1, Math.round(litFraction(rank) * total)));

  // Everything scales off the diameter so one `size` prop drives the whole
  // mark — the hero renders it smaller on a phone than on a desktop.
  const outer = 47;
  const len = size >= 72 ? 6 : 5;
  const ticks = Array.from({ length: total }, (_, i) => {
    const a = (i / total) * Math.PI * 2;
    const on = i < lit;
    const reach = outer - (on ? len : len * 0.55);
    return {
      x1: 50 + Math.cos(a) * outer,
      y1: 50 + Math.sin(a) * outer,
      x2: 50 + Math.cos(a) * reach,
      y2: 50 + Math.sin(a) * reach,
      on,
    };
  });

  const boardWord = mid ? "Mid-major" : "Top 100";
  // SIZED BY LENGTH, NOT BY VARIANT. The label has to fit a CHORD of the inner
  // circle rather than its diameter, and nine characters of MID-MAJOR need a
  // smaller setting than seven of TOP 100 to clear the same arc. One ratio for
  // both meant either a cramped mid-major mark or a small overall one.
  //
  // The compact mark briefly shortened these to TOP and MID so they could set
  // larger. That reads as a different mark rather than a smaller one — the
  // board is what the word is there to say — so they are full again, and the
  // ratios below are what makes them fit: measured against the chord at the
  // label's own band, every combination clears with room at 58px, the smallest
  // this mark is ever drawn.
  const labelSize = compact
    ? size * (mid ? 0.095 : 0.13)
    : size * (mid ? 0.068 : 0.078);
  // The compact mark also gives up most of its letter-spacing. MEASURED at
  // 58px: MID-MAJOR set 46.4px wide against a 40.5px chord, and 8.6 of those
  // 46.4 were tracking. Wide tracking is what makes a 7px label read as a label
  // rather than as a word, but it is the first thing that has to go when nine
  // characters have to clear an arc — dropping the glyphs another point to keep
  // the air would have put this at 5px, which is not type.
  const labelTracking = compact ? "0.04em" : "0.16em";

  return (
    <div
      className="relative grid place-items-center shrink-0"
      style={{ width: size, height: size }}
      title={`Top 100 ${label.toLowerCase()}${of ? ` — ranked ${rank} of ${of.toLocaleString("en-US")}` : ` — ranked ${rank}`}`}
    >
      {/* Rotated a quarter turn so the dial opens at twelve and fills clockwise. */}
      <svg
        viewBox="0 0 100 100"
        aria-hidden="true"
        className="absolute inset-0 h-full w-full"
        style={{ transform: "rotate(-90deg)" }}
      >
        {ticks.map((t, i) => (
          <line
            key={i}
            x1={t.x1}
            y1={t.y1}
            x2={t.x2}
            y2={t.y2}
            stroke={tick}
            strokeOpacity={t.on ? 1 : 0.2}
            strokeWidth={t.on ? 2.2 : 1.4}
            strokeLinecap="round"
          />
        ))}
      </svg>
      <div className="relative flex flex-col items-center leading-none">
        <span
          className="font-display font-extrabold leading-none text-ink"
          style={{
            fontSize: Math.round(size * (String(rank).length > 2 ? 0.26 : 0.3)),
            letterSpacing: "-0.05em",
          }}
        >
          {rank}
        </span>
        <span
          className="font-semibold uppercase leading-none"
          style={{
            fontSize: Math.max(5, Math.round(labelSize)),
            letterSpacing: labelTracking,
            textIndent: labelTracking,
            color: ink,
            marginTop: 2,
          }}
        >
          {boardWord}
        </span>
      </div>
    </div>
  );
}
