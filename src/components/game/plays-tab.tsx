"use client";

import { useMemo, useState } from "react";
import { TeamLogo } from "@/components/team-logo";
import { cn } from "@/lib/utils";
import { periodLabel, type GameBundle, type Play } from "./types";

/**
 * Play by play, grouped by period.
 *
 * A flat log of 365 rows is a wall. Breaking it into collapsible halves gives
 * the eye somewhere to land and makes "what happened in the second half" one
 * click rather than a scroll hunt. The period heading also carries the clock
 * context, so each row can drop its own "1H" prefix and the times line up.
 *
 * The running score sits on scoring plays only, in two columns — away then
 * home, matching the order the header and every card on the site use. A score
 * repeated on every rebound and substitution is noise that makes the changes
 * harder to find, which is the opposite of what a score column is for.
 */
export function PlaysTab({ b }: { b: GameBundle }) {
  const [side, setSide] = useState<"all" | "home" | "away">("all");
  const [kind, setKind] = useState<"all" | "scoring" | "shots" | "turnovers">("all");
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());

  const rows = useMemo(
    () =>
      b.plays.filter((p) => {
        if (side === "home" && !p.h) return false;
        if (side === "away" && p.h) return false;
        if (kind === "scoring") return p.sc;
        if (kind === "shots") return p.sh;
        if (kind === "turnovers") return /turnover|steal/i.test(p.t);
        return true;
      }),
    [b.plays, side, kind],
  );

  // Periods in play order, each with its own rows.
  const groups = useMemo(() => {
    const m = new Map<number, Play[]>();
    for (const p of rows) {
      if (!m.has(p.per)) m.set(p.per, []);
      m.get(p.per)!.push(p);
    }
    return [...m.entries()].sort((a, c) => a[0] - c[0]);
  }, [rows]);

  const toggle = (per: number) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(per)) next.delete(per); else next.add(per);
      return next;
    });

  return (
    <div className="rounded-xl border border-hairline bg-card overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 border-b border-hairline bg-paper-deep/30">
        <Seg opts={[["all", "Both"], ["away", b.game.away.team], ["home", b.game.home.team]]} v={side} on={(x) => setSide(x as never)} />
        <span className="w-px h-5 bg-hairline hidden sm:block" />
        <Seg opts={[["all", "Everything"], ["scoring", "Scoring"], ["shots", "Shots"], ["turnovers", "Turnovers"]]} v={kind} on={(x) => setKind(x as never)} />
        <span className="ml-auto text-[0.65rem] tabular text-ink-muted">{rows.length} plays</span>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-8 text-sm text-ink-muted">Nothing matches those filters.</p>
      ) : (
        // Sized off the viewport rather than a fixed height: the log is the
        // point of this tab, and a short window means scrolling hundreds of
        // rows through a letterbox.
        <div className="max-h-[calc(100vh-13rem)] min-h-[34rem] overflow-y-auto">
          {groups.map(([per, list]) => {
            const shut = collapsed.has(per);
            return (
              <section key={per}>
                <h3 className="sticky top-0 z-10 bg-paper-deep/95 backdrop-blur border-y border-hairline">
                  <button
                    type="button"
                    onClick={() => toggle(per)}
                    aria-expanded={!shut}
                    className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-paper-deep transition-colors"
                  >
                    <span className="text-[0.72rem] uppercase tracking-[0.14em] font-bold text-ink">{periodLabel(per)} half</span>
                    <span className="text-[0.6rem] tabular text-ink-muted">{list.length}</span>
                    <svg viewBox="0 0 24 24" aria-hidden
                      className={cn("ml-auto w-3.5 h-3.5 text-ink-muted transition-transform", shut && "-rotate-90")}
                      fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </h3>
                {!shut && (
                  <ol className="divide-y divide-hairline/50">
                    {list.map((p) => (
                      <PlayRow key={p.i} p={p} home={b.game.home.team} away={b.game.away.team} />
                    ))}
                  </ol>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * The acting team is carried by its logo rather than a coloured dot: a dot
 * needs a legend, and two navy programmes make it useless. Rows belonging to
 * no team — end of period, official timeouts — keep the empty slot so the text
 * column still lines up.
 */
function PlayRow({ p, home, away }: { p: Play; home: string; away: string }) {
  const team = p.tm || (p.h ? home : away);
  const neutral = /end period|end game|official|tv timeout/i.test(p.t);
  return (
    <li className={cn(
      "grid grid-cols-[1.75rem_3rem_1fr_2.25rem_2.25rem] gap-x-3 items-center px-4 py-2",
      p.sc && "bg-paper-deep/20",
    )}>
      <span className="flex justify-center">
        {neutral || !team ? null : <TeamLogo name={team} size={18} />}
      </span>
      <span className="text-[0.68rem] tabular text-ink-muted">{p.clk}</span>
      <span className={cn("text-[0.8rem] leading-snug min-w-0", p.sc ? "text-ink font-medium" : "text-ink-soft")}>
        {p.txt}
      </span>
      {/* Away then home, the order every other surface on the site uses. */}
      <span className={cn("text-right text-[0.8rem] tabular", p.sc ? "text-ink font-semibold" : "text-transparent")}>
        {p.sc ? p.as : "·"}
      </span>
      <span className={cn("text-right text-[0.8rem] tabular", p.sc ? "text-ink font-semibold" : "text-transparent")}>
        {p.sc ? p.hs : "·"}
      </span>
    </li>
  );
}

function Seg({ opts, v, on }: { opts: [string, string][]; v: string; on: (x: string) => void }) {
  return (
    <div className="flex gap-0.5">
      {opts.map(([k, label]) => (
        <button key={k} type="button" onClick={() => on(k)}
          className={cn(
            "px-2.5 h-7 rounded text-[0.68rem] transition-colors whitespace-nowrap max-w-32 truncate",
            k === v ? "bg-ink text-paper font-semibold" : "text-ink-soft hover:bg-paper-deep",
          )}>
          {label}
        </button>
      ))}
    </div>
  );
}
