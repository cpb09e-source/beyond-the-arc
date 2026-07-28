"use client";

import Link from "next/link";
import { TeamLogo } from "@/components/team-logo";
import { cn } from "@/lib/utils";
import {
  isFinal, isLive, longDate, periodHeadings, periodLabel, tipLabel, lineLabel,
  type GameBundle, type GameSide,
} from "./types";

/**
 * The scoreline. Sits above the tabs on every view and never changes with
 * them — it is the one thing a reader came for, and having it move or vanish
 * when you switch to the play-by-play is the fastest way to lose your place.
 *
 * Laid out as a ledger — team rows, period columns, total on the right — for
 * the same reason the scoreboard cards are: it is the shape a box score has
 * had for a century, and two stacked rows never read as two separate games
 * the way a left/right split can.
 *
 * THREE STATES. Scheduled shows the tip time and no columns, because empty
 * period cells look like a game where nobody scored. Live shows the clock, a
 * pulsing marker and only the periods actually played. Final shows everything
 * plus the winner.
 */
export function ScoreHeader({ b, records }: { b: GameBundle; records?: { home: string; away: string } }) {
  const g = b.game;
  const live = isLive(g), final = isFinal(g);
  const cols = Math.max(g.home.periods.length, g.away.periods.length);
  const heads = periodHeadings(cols);
  const line = lineLabel(b);

  const venue = [g.venue, [g.city, g.state].filter(Boolean).join(", ")].filter(Boolean).join(", ");
  const tv = b.broadcasts.find((x) => x.broadcastType === "TV")?.broadcastName;
  const meta = [
    venue || null,
    g.attendance ? `${g.attendance.toLocaleString()} in the building` : null,
    tv,
    line ? `Line ${line}` : null,
  ].filter(Boolean);

  return (
    <header className="border-b border-hairline bg-card">
      <div className="mx-auto max-w-[92rem] px-5 lg:px-10 pt-5 pb-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.62rem] uppercase tracking-[0.16em] font-bold text-ink-muted">
          <span>{g.conferenceGame && g.home.conference ? g.home.conference : g.neutralSite ? "Neutral site" : "Non-conference"}</span>
          <span aria-hidden>·</span>
          <span>{longDate(g.startDate)}</span>
          {live ? (
            <span className="ml-auto inline-flex items-center gap-1.5 text-coral">
              <span className="relative flex h-1.5 w-1.5" aria-hidden>
                <span className="absolute inline-flex h-full w-full rounded-full bg-coral opacity-75 motion-safe:animate-ping" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-coral" />
              </span>
              {g.clock ?? "Live"}{g.period != null && ` · ${periodLabel(g.period)}`}
            </span>
          ) : (
            <span className="ml-auto">{final ? "Final" : tipLabel(g.startDate)}</span>
          )}
        </div>

        <table className="w-full mt-3">
          <thead>
            <tr className="text-[0.55rem] uppercase tracking-[0.12em] font-bold text-ink-muted">
              <th className="text-left" />
              {heads.map((h) => <th key={h} className="w-9 sm:w-11 text-right pb-1 font-bold">{h}</th>)}
              <th className="w-12 sm:w-16 text-right pb-1 font-bold">T</th>
            </tr>
          </thead>
          <tbody>
            <TeamRow side={g.away} periods={g.away.periods} cols={cols} record={records?.away} final={final} />
            <TeamRow side={g.home} periods={g.home.periods} cols={cols} record={records?.home} final={final}
              at={!g.neutralSite} />
          </tbody>
        </table>

        {meta.length > 0 && (
          <p className="mt-3 text-[0.68rem] text-ink-muted">{meta.join(" · ")}</p>
        )}
      </div>
    </header>
  );
}

function TeamRow({
  side, periods, cols, record, final, at = false,
}: {
  side: GameSide; periods: number[]; cols: number;
  record?: string; final: boolean; at?: boolean;
}) {
  const won = final && side.winner === true;
  const lost = final && side.winner === false;
  return (
    <tr className="border-t border-hairline">
      <td className="py-2.5 pr-3">
        <div className="flex items-center gap-2.5 min-w-0">
          {/* The at-sign belongs to the HOME team — it is where the game is
              being played, not who is travelling. Neutral sites get none. */}
          <span className="w-3 shrink-0 text-ink-muted text-sm" aria-hidden>{at ? "@" : ""}</span>
          <TeamLogo name={side.team} size={28} />
          {side.rank != null && (
            <span className="shrink-0 inline-flex items-center justify-center min-w-[1.25rem] h-[1.25rem] px-1 rounded bg-coral text-white text-[0.62rem] font-bold tabular leading-none">
              {side.rank}
            </span>
          )}
          <Link
            href={`/teams/${teamSlug(side.team)}/`}
            className={cn(
              "font-display text-lg sm:text-xl leading-none truncate hover:text-coral transition-colors",
              lost ? "text-ink-muted" : "text-ink",
            )}
          >
            {side.team}
          </Link>
          {record && <span className="text-[0.68rem] tabular text-ink-muted shrink-0">{record}</span>}
        </div>
      </td>
      {Array.from({ length: cols }, (_, i) => (
        <td key={i} className={cn("text-right tabular text-sm", lost ? "text-ink-muted" : "text-ink-soft")}>
          {periods[i] ?? "—"}
        </td>
      ))}
      <td className={cn(
        "text-right tabular font-display text-2xl sm:text-3xl leading-none",
        won ? "text-ink" : lost ? "text-ink-muted" : "text-ink",
      )}>
        {side.points ?? "—"}
      </td>
    </tr>
  );
}

function teamSlug(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
