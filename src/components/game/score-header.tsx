"use client";

import { Fragment } from "react";
import Link from "next/link";
import { TeamLogo } from "@/components/team-logo";
import { cn } from "@/lib/utils";
import {
  isFinal, isLive, longDate, periodHeadings, periodLabel, tipLabel,
  type GameBundle, type GameSide,
} from "./types";

/**
 * The scoreline. Sits above the tabs on every view and never changes with
 * them — it is the one thing a reader came for, and having it move or vanish
 * when you switch to the play-by-play is the fastest way to lose your place.
 *
 * The two totals are pulled to the MIDDLE so they sit side by side, because the
 * question the page answers is "by how much", and that is a comparison the eye
 * should not have to carry across a header's full width the way a ledger row
 * makes it. Teams open outward from the numbers; the status column is the
 * hinge. The line score sits centered underneath, where it is detail rather than
 * headline.
 *
 * Venue, attendance, television and the betting line are deliberately NOT here.
 * They live in Game Info on the Overview tab, and printing them twice made the
 * header carry a paragraph of small gray text under a poster-scale score.
 *
 * THREE STATES. Scheduled drops the numbers entirely and puts the tip time in
 * the middle, because a pair of 7xl em-dashes reads as a game nobody scored in.
 * Live shows the clock, a pulsing marker and only the periods actually played.
 * Final shows everything, with the loser dimmed.
 */
export function ScoreHeader({
  b, records,
}: {
  b: GameBundle;
  records?: { home: string; away: string };
}) {
  const g = b.game;
  const final = isFinal(g);
  const started = g.away.points != null || g.home.points != null;

  return (
    // paper-deep, not card. `--card` is pure #ffffff, and a full-width sheet of
    // it above a warm off-white page glared — the banner read as a hole in the
    // paper rather than a masthead on it. The deeper tone also gives the white
    // panels below it something to sit against.
    <header className="border-b border-hairline bg-paper-deep/70">
      <div className="mx-auto max-w-[var(--page-narrow)] px-5 lg:px-10 pt-5 pb-6">
        <p className="text-center text-[0.6rem] uppercase tracking-[0.22em] font-bold text-ink-muted">
          {g.conferenceGame && g.home.conference
            ? g.home.conference
            : g.neutralSite ? "Neutral site" : "Non-conference"}
          {" · "}
          {longDate(g.startDate)}
        </p>

        {/* TWO LAYOUTS, BECAUSE THE OPEN-OUTWARD ONE CANNOT SURVIVE A PHONE.
            The grid below is [1fr auto 1fr] with the totals in the middle. At
            390px the middle column is two 5xl numerals plus the status —
            about 230px of the ~350px available — so each team column gets
            roughly 48px, which is exactly the width of the logo sitting in
            it. The names truncated to nothing and the record rendered as a
            lone "3…". Clamping the type would not fix it; the arrangement is
            what does not fit.

            A phone gets a scoreboard row per side instead: logo, name and
            record running the full width, score right-aligned. It is the
            shape every reader already knows from a scoreboard, and the record
            has ~250px to sit in rather than 48.

            Wrapped in plain divs rather than putting max-sm:hidden on the
            grid itself. A utility that flips `display` competing with the
            `grid` utility on one element is the bug that cost an afternoon on
            .matchup-split, and a wrapper cannot lose that fight. */}
        <div className="max-sm:hidden">
          <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-5 lg:gap-8">
            <TeamBlock side={g.away} record={records?.away} align="right" final={final} />

            <div className="flex items-center gap-3 sm:gap-5 lg:gap-7">
              {started && <Num v={g.away.points} dim={final && g.away.winner === false} />}
              <div className="text-center min-w-14 sm:min-w-18">
                <Status b={b} />
              </div>
              {started && <Num v={g.home.points} dim={final && g.home.winner === false} />}
            </div>

            <TeamBlock side={g.home} record={records?.home} align="left" final={final}
              at={!g.neutralSite} />
          </div>
        </div>

        <div className="sm:hidden">
          <MobileScore b={b} records={records} final={final} started={started} />
        </div>

        {/* Desktop only — a phone gets these numbers inline on each team's
            row instead, in MobileScore. */}
        <div className="max-sm:hidden">
          <LineScore b={b} />
        </div>
      </div>
    </header>
  );
}

/** FINAL, a live clock, or a tip time. */
function Status({ b }: { b: GameBundle }) {
  const g = b.game;
  if (isLive(g)) {
    return (
      <span className="inline-flex items-center gap-1.5 text-coral text-[0.62rem] uppercase tracking-[0.16em] font-bold">
        <span className="relative flex h-1.5 w-1.5" aria-hidden>
          <span className="absolute inline-flex h-full w-full rounded-full bg-coral opacity-75 motion-safe:animate-ping" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-coral" />
        </span>
        {g.clock ?? "Live"}
        {g.period != null && <span className="block text-ink-muted font-semibold">{periodLabel(g.period)}</span>}
      </span>
    );
  }
  if (isFinal(g)) {
    return <span className="text-[0.62rem] uppercase tracking-[0.16em] font-bold text-ink-muted">Final</span>;
  }
  // Scheduled: this IS the middle of the header, so it carries more weight than
  // the one-line status a played game needs.
  return (
    <span className="block text-base sm:text-lg font-semibold tabular text-ink whitespace-nowrap">
      {/* CBBD dates a fixture whose time nobody has set at midnight Eastern.
          Printing that would put a confident "12:00 AM ET" on every game in a
          schedule released months before tip-off. */}
      {g.tbd ? "Time TBD" : tipLabel(g.startDate)}
    </span>
  );
}

/**
 * A total, in the sans face rather than the display one.
 *
 * The display face draws `1` as a bare stem with no flag or foot, which at
 * poster scale turns 81 into "8I" and 11 into "||". At 24px it is a quirk; at
 * 96px it is a misprint. Weight and tabular figures carry the emphasis instead.
 *
 * INK, NOT TEAM COLOR. These used to be drawn in each side's color, which put
 * two loud unrelated hues at the largest point size on the page and made the
 * header read as a logo rather than a result. The line score below it already
 * had the right answer — ink for the winner, muted for the loser — and the
 * team name beside it uses the same pair. Now all three agree, and the only
 * thing color says on this page is which side won.
 */
function Num({ v, dim }: { v: number | null; dim: boolean }) {
  return (
    <span
      className={cn(
        "text-5xl sm:text-6xl lg:text-7xl font-bold leading-none tabular tracking-tight",
        dim ? "text-ink-muted" : "text-ink",
      )}
    >
      {v ?? "—"}
    </span>
  );
}

/** The rank chip. Shared so the two layouts cannot drift on it. */
function Rank({ n }: { n: number }) {
  return (
    <span className="shrink-0 inline-flex items-center justify-center min-w-[1.3rem] h-[1.3rem] px-1 rounded bg-coral text-white text-[0.65rem] font-bold tabular leading-none">
      {n}
    </span>
  );
}

/**
 * The whole scoreline on a phone: a team per row, the halves inline, the total
 * at the end.
 *
 * WHY THE PERIODS MOVED UP HERE. They used to be a separate centered table
 * below (LineScore, still what a desktop gets). That put four numbers a full
 * band away from the two they belong to, keyed only by a 22px logo, so reading
 * "how did UConn get to 63" meant matching marks across a gap. Inline, each
 * half sits on its own team's row and the total is the last column — the shape
 * of a newspaper line score, which is where this convention comes from.
 *
 * ONE GRID, NOT A ROW COMPONENT PER SIDE. The half columns have to align
 * between the two teams and under their headings, and independent flex rows
 * only line up by luck. Every cell below is a direct child of this grid, so
 * the track widths are decided once.
 */
function MobileScore({
  b, records, final, started,
}: {
  b: GameBundle; records?: { home: string; away: string }; final: boolean; started: boolean;
}) {
  const g = b.game;
  const cols = Math.max(g.home.periods.length, g.away.periods.length);
  const heads = periodHeadings(cols);
  const sides: Array<[GameSide, string | undefined, boolean]> = [
    [g.away, records?.away, false],
    [g.home, records?.home, !g.neutralSite],
  ];

  return (
    <div className="mt-4">
      <div
        className="grid items-center gap-x-2.5 gap-y-2.5"
        style={{
          // auto logo · flexible team · one narrow track per half · auto total.
          // minmax(0,1fr) rather than 1fr so the team cell can actually shrink
          // and let its name truncate; a bare 1fr floors at max-content and
          // pushes the total off the right edge on a long school name.
          gridTemplateColumns: `auto minmax(0,1fr) repeat(${cols}, 1.6rem) auto`,
        }}
      >
        {cols > 0 && (
          <>
            <span aria-hidden />
            <span aria-hidden />
            {heads.map((h) => (
              <span key={h} className="text-center text-[0.5rem] uppercase tracking-[0.1em] font-bold text-ink-muted">
                {h}
              </span>
            ))}
            <span aria-hidden />
          </>
        )}

        {sides.map(([side, record, at]) => {
          const lost = final && side.winner === false;
          return (
            <Fragment key={side.team}>
              <span className="shrink-0">
                <TeamLogo name={side.team} size={38} />
              </span>

              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  {at && <span className="text-ink-muted text-xs shrink-0" aria-hidden>@</span>}
                  {side.rank != null && <Rank n={side.rank} />}
                  <Link
                    href={`/teams/${teamSlug(side.team)}/`}
                    className={cn(
                      "text-lg font-semibold tracking-tight leading-tight truncate hover:text-coral transition-colors",
                      lost ? "text-ink-muted" : "text-ink",
                    )} prefetch={false}>
                    {side.team}
                  </Link>
                </div>
                <p className="mt-0.5 text-[0.68rem] tabular text-ink-muted truncate">
                  {record}
                  {side.conference && <span className="ml-2">{side.conference}</span>}
                </p>
              </div>

              {Array.from({ length: cols }, (_, i) => (
                <span
                  key={i}
                  className={cn(
                    "text-center text-sm font-semibold tabular",
                    lost ? "text-ink-muted" : "text-ink-soft",
                  )}
                >
                  {side.periods[i] ?? "—"}
                </span>
              ))}

              {/* pl-5 pulls the halves LEFT. The total's track is `auto`, so
                  padding widens it, the 1fr team track gives up that width,
                  and the half columns slide over with it — one number to
                  change instead of a spacer column in every row. */}
              <span
                className={cn(
                  "pl-5 text-right text-4xl font-bold leading-none tabular tracking-tight",
                  lost ? "text-ink-muted" : "text-ink",
                )}
              >
                {started ? side.points ?? "—" : ""}
              </span>
            </Fragment>
          );
        })}
      </div>

      {/* Under the rows, not between them: the two totals have to sit in one
          vertical column to be compared, and a status band across the middle
          breaks that column. A scheduled game has no totals to separate
          anyway, and this is where its tip time goes. */}
      <div className="mt-3 text-center">
        <Status b={b} />
      </div>
    </div>
  );
}

function TeamBlock({
  side, record, align, final, at = false,
}: {
  side: GameSide; record?: string;
  align: "left" | "right"; final: boolean; at?: boolean;
}) {
  const lost = final && side.winner === false;
  return (
    // Logo outermost, name nearest the number, on both sides. Mirroring the
    // away block put the mark between the name and the score, which reads as
    // the logo belonging to the number rather than to the team.
    <div className={cn("flex items-center gap-2.5 sm:gap-4 min-w-0", align === "right" && "justify-end")}>
      <span className="shrink-0">
        <TeamLogo name={side.team} size={48} />
      </span>
      <div className={cn("min-w-0", align === "right" && "text-right")}>
        <div className={cn("flex items-center gap-1.5 sm:gap-2", align === "right" && "justify-end")}>
          {at && <span className="text-ink-muted text-sm" aria-hidden>@</span>}
          {side.rank != null && <Rank n={side.rank} />}
          <Link
            href={`/teams/${teamSlug(side.team)}/`}
            className={cn(
              // Sans, like the numbers beside it. The display face was the odd
              // one out in a header that is otherwise all one voice.
              "text-lg sm:text-2xl lg:text-3xl font-semibold tracking-tight leading-none truncate hover:text-coral transition-colors",
              lost ? "text-ink-muted" : "text-ink",
            )} prefetch={false}>
            {side.team}
          </Link>
        </div>
        <p className="mt-1.5 text-[0.68rem] tabular text-ink-muted truncate">
          {record}
          {side.conference && <span className="ml-2">{side.conference}</span>}
        </p>
      </div>
    </div>
  );
}

/**
 * 1H / 2H / T, centered under the score. Absent until periods exist — an empty
 * column set under a scheduled game is a table of dashes.
 */
function LineScore({ b }: { b: GameBundle }) {
  const g = b.game;
  const cols = Math.max(g.home.periods.length, g.away.periods.length);
  if (cols === 0) return null;
  const heads = periodHeadings(cols);
  return (
    <table className="mt-5 mx-auto tabular text-sm">
      <thead>
        <tr className="text-[0.55rem] uppercase tracking-[0.12em] font-bold text-ink-muted">
          <th className="pr-4" />
          {heads.map((h) => <th key={h} className="w-10 text-right font-bold pb-1">{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {[g.away, g.home].map((s) => {
          const lost = isFinal(g) && s.winner === false;
          return (
            <tr key={s.team}>
              {/* The mark, not the name. Both schools are already spelled out at
                  3xl a few inches above; repeating them here in small caps made
                  a four-number table carry two extra words of chrome. */}
              <td className="pr-4 py-0.5">
                <span className="flex justify-center" title={s.team}>
                  <TeamLogo name={s.team} size={22} />
                </span>
              </td>
              {Array.from({ length: cols }, (_, i) => (
                <td key={i} className={cn("text-right font-semibold", lost ? "text-ink-muted" : "text-ink")}>
                  {s.periods[i] ?? "—"}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function teamSlug(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
