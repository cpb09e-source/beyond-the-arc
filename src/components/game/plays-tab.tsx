"use client";

import { useMemo, useState } from "react";
import { TeamLogo } from "@/components/team-logo";
import { cn } from "@/lib/utils";
import { periodLabel, type GameBundle, type Play } from "./types";

/**
 * Play by play.
 *
 * GROUPED BY POSSESSION-ISH RUN, NOT FLAT. A flat log of 365 rows is a wall;
 * breaking on the scoring plays gives the eye somewhere to land and makes a
 * 9-0 run visible as a run rather than as nine consecutive lines.
 *
 * The running score sits on the scoring plays only. Repeating an unchanged
 * score on every rebound and substitution is noise that makes the changes
 * harder to spot, which is the opposite of what a score column is for.
 */
export function PlaysTab({ b }: { b: GameBundle }) {
  const [side, setSide] = useState<"all" | "home" | "away">("all");
  const [kind, setKind] = useState<"all" | "scoring" | "shots" | "turnovers">("all");
  const [half, setHalf] = useState(0);

  const periods = useMemo(
    () => [...new Set(b.plays.map((p) => p.per))].sort((a, c) => a - c),
    [b.plays],
  );

  const rows = useMemo(() => {
    return b.plays.filter((p) => {
      if (half !== 0 && p.per !== half) return false;
      if (side === "home" && !p.h) return false;
      if (side === "away" && p.h) return false;
      if (kind === "scoring") return p.sc;
      if (kind === "shots") return p.sh;
      if (kind === "turnovers") return /turnover|steal/i.test(p.t);
      return true;
    });
  }, [b.plays, side, kind, half]);

  return (
    <div className="rounded-xl border border-hairline bg-card overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 border-b border-hairline bg-paper-deep/30">
        <Seg opts={[["all", "Both"], ["away", b.game.away.team], ["home", b.game.home.team]]} v={side} on={(x) => setSide(x as never)} />
        <span className="w-px h-5 bg-hairline hidden sm:block" />
        <Seg opts={[["all", "Everything"], ["scoring", "Scoring"], ["shots", "Shots"], ["turnovers", "Turnovers"]]} v={kind} on={(x) => setKind(x as never)} />
        <span className="w-px h-5 bg-hairline hidden sm:block" />
        <Seg
          opts={[["0", "Full game"], ...periods.map((p) => [String(p), periodLabel(p)] as [string, string])]}
          v={String(half)} on={(x) => setHalf(Number(x))}
        />
        <span className="ml-auto text-[0.65rem] tabular text-ink-muted">{rows.length} plays</span>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-8 text-sm text-ink-muted">Nothing matches those filters.</p>
      ) : (
        // Sized off the viewport rather than a fixed height: the log is the
        // point of this tab, and a short window means scrolling a 365-row list
        // through a letterbox. Capped so the filter bar above stays on screen.
        <ol className="max-h-[calc(100vh-14rem)] min-h-[32rem] overflow-y-auto divide-y divide-hairline/50">
          {rows.map((p) => <PlayRow key={p.i} p={p} home={b.game.home.team} away={b.game.away.team} />)}
        </ol>
      )}
    </div>
  );
}

/**
 * The acting team is carried by its logo rather than a coloured dot. A dot
 * needs a legend and two navy programmes make it useless; a mark you already
 * recognise from the scoreboard needs neither.
 *
 * Some rows belong to no team — end of period, official timeouts — and those
 * keep an empty slot so the text column still lines up.
 */
function PlayRow({ p, home, away }: { p: Play; home: string; away: string }) {
  const team = p.tm || (p.h ? home : away);
  const neutral = /end period|end game|official|tv timeout/i.test(p.t);
  return (
    <li className={cn("grid grid-cols-[3.4rem_auto_1fr_auto] gap-x-3 items-center px-4 py-2", p.sc && "bg-paper-deep/25")}>
      <span className="text-[0.62rem] tabular text-ink-muted whitespace-nowrap">
        {p.per <= 2 ? `${p.per}H` : periodLabel(p.per)} {p.clk}
      </span>
      <span className="w-5 flex justify-center shrink-0">
        {neutral || !team ? null : <TeamLogo name={team} size={18} />}
      </span>
      <span className="text-[0.8rem] text-ink-soft leading-snug min-w-0">{p.txt}</span>
      <span className="text-[0.78rem] tabular whitespace-nowrap">
        {p.sc ? (
          <span className="font-semibold text-ink">
            {p.as}<span className="text-ink-muted mx-1">–</span>{p.hs}
          </span>
        ) : (
          <span className="text-ink-muted/30">·</span>
        )}
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
