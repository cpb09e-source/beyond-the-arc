"use client";

import Link from "next/link";
import { TeamLogo } from "@/components/team-logo";
import { readableInk } from "@/lib/team-colors";
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
 * hinge. The line score sits centred underneath, where it is detail rather than
 * headline.
 *
 * Venue, attendance, television and the betting line are deliberately NOT here.
 * They live in Game Info on the Overview tab, and printing them twice made the
 * header carry a paragraph of small grey text under a poster-scale score.
 *
 * THREE STATES. Scheduled drops the numbers entirely and puts the tip time in
 * the middle, because a pair of 7xl em-dashes reads as a game nobody scored in.
 * Live shows the clock, a pulsing marker and only the periods actually played.
 * Final shows everything, with the loser dimmed.
 */
export function ScoreHeader({
  b, records, hc, ac,
}: {
  b: GameBundle;
  records?: { home: string; away: string };
  /** Home and away display colours, already de-conflicted by `sideColors`. */
  hc: string; ac: string;
}) {
  const g = b.game;
  const final = isFinal(g);
  const started = g.away.points != null || g.home.points != null;

  return (
    <header className="border-b border-hairline bg-card">
      <div className="mx-auto max-w-[92rem] px-5 lg:px-10 pt-5 pb-6">
        <p className="text-center text-[0.6rem] uppercase tracking-[0.22em] font-bold text-ink-muted">
          {g.conferenceGame && g.home.conference
            ? g.home.conference
            : g.neutralSite ? "Neutral site" : "Non-conference"}
          {" · "}
          {longDate(g.startDate)}
        </p>

        <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3 sm:gap-5 lg:gap-8">
          <TeamBlock side={g.away} record={records?.away} align="right" final={final} />

          <div className="flex items-center gap-3 sm:gap-5 lg:gap-7">
            {started && <Num v={g.away.points} dim={final && g.away.winner === false} color={ac} />}
            <div className="text-center min-w-14 sm:min-w-18">
              <Status b={b} />
            </div>
            {started && <Num v={g.home.points} dim={final && g.home.winner === false} color={hc} />}
          </div>

          <TeamBlock side={g.home} record={records?.home} align="left" final={final}
            at={!g.neutralSite} />
        </div>

        <LineScore b={b} />
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
      {tipLabel(g.startDate)}
    </span>
  );
}

/**
 * A total, in the sans face rather than the display one.
 *
 * The display face draws `1` as a bare stem with no flag or foot, which at
 * poster scale turns 81 into "8I" and 11 into "||". At 24px it is a quirk; at
 * 96px it is a misprint. Weight and tabular figures carry the emphasis instead.
 */
function Num({ v, dim, color }: { v: number | null; dim: boolean; color: string }) {
  return (
    <span
      className="text-5xl sm:text-6xl lg:text-7xl font-bold leading-none tabular tracking-tight"
      style={{
        color: dim ? "var(--ink-muted)" : readableInk(color, { min: 0.28, max: 0.46 }),
        opacity: dim ? 0.45 : 1,
      }}
    >
      {v ?? "—"}
    </span>
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
          {side.rank != null && (
            <span className="shrink-0 inline-flex items-center justify-center min-w-[1.3rem] h-[1.3rem] px-1 rounded bg-coral text-white text-[0.65rem] font-bold tabular leading-none">
              {side.rank}
            </span>
          )}
          <Link
            href={`/teams/${teamSlug(side.team)}/`}
            className={cn(
              // Sans, like the numbers beside it. The display face was the odd
              // one out in a header that is otherwise all one voice.
              "text-lg sm:text-2xl lg:text-3xl font-semibold tracking-tight leading-none truncate hover:text-coral transition-colors",
              lost ? "text-ink-muted" : "text-ink",
            )}
          >
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
 * 1H / 2H / T, centred under the score. Absent until periods exist — an empty
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
