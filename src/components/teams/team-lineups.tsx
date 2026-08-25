"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Team-page "Top lineups" card. Client-fetches the 5-man unit ratings
 * (/data/lineups-<year>.json, from compute-epm-extras) and shows the team's
 * best units by net rating. Only present for seasons with play-by-play stint
 * data (2024+); renders nothing otherwise, so it's safe on every team-year page.
 */
type Unit = { players: string[]; poss: number; off: number; def: number; net: number };

const normTeam = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/\buniversity\b|\bthe\b/g, "").replace(/\bstate\b/g, "st").replace(/[^a-z0-9]+/g, "");

export function TeamLineups({
  teamName,
  year,
  standalone = false,
}: {
  teamName: string;
  year: number;
  /**
   * True when this card IS the page (the Lineups tab) rather than one block
   * among many. Returning null is right for a section that is simply absent
   * from a page full of other things; it is wrong for a tab, where it leaves
   * a reader who clicked "Lineups" looking at nothing and unable to tell the
   * difference between no data and a broken page.
   */
  standalone?: boolean;
}) {
  const [units, setUnits] = useState<Unit[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/data/lineups-${year}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled) setUnits(j?.byTeam?.[normTeam(teamName)] ?? []); })
      .catch(() => { if (!cancelled) setUnits([]); });
    return () => { cancelled = true; };
  }, [teamName, year]);

  if (!units || units.length === 0) {
    if (!standalone) return null;
    return (
      <div className="bg-card border-y border-x-0 lg:border-x border-ink/10 rounded-none lg:rounded-xl shadow-md overflow-hidden ring-1 ring-ink/5 -mx-6 lg:mx-0">
        <div className="h-1 w-full bg-gradient-to-r from-[color:var(--accent,#ed5a4f)] via-[color:var(--accent,#ed5a4f)] to-transparent" />
        <div className="px-5 lg:px-7 py-5 border-b border-hairline bg-paper-deep/30">
          <div className="text-[0.6rem] uppercase tracking-[0.18em] text-[color:var(--accent,#0c6bd6)] font-bold mb-1.5 flex items-center gap-2">
            <span className="h-px w-6 bg-[color:var(--accent,#0c6bd6)]" />
            Five-man units
          </div>
          <h2 className="font-display text-2xl lg:text-3xl text-ink leading-none tracking-tight">Top Lineups</h2>
        </div>
        <p className="px-5 lg:px-7 py-8 text-sm text-ink-muted">
          {units ? "No five-man unit reached 40 possessions this season." : "Loading lineups…"}
        </p>
      </div>
    );
  }

  const sign = (v: number) => (v >= 0 ? "+" : "") + v.toLocaleString("en-US", { maximumFractionDigits: 1 });

  return (
    <div className="bg-card border-y border-x-0 lg:border-x border-ink/10 rounded-none lg:rounded-xl shadow-md overflow-hidden ring-1 ring-ink/5 -mx-6 lg:mx-0">
      <div className="h-1 w-full bg-gradient-to-r from-[color:var(--accent,#ed5a4f)] via-[color:var(--accent,#ed5a4f)] to-transparent" />
      <div className="px-5 lg:px-7 py-5 border-b border-hairline bg-paper-deep/30">
        <div className="text-[0.6rem] uppercase tracking-[0.18em] text-[color:var(--accent,#0c6bd6)] font-bold mb-1.5 flex items-center gap-2">
          <span className="h-px w-6 bg-[color:var(--accent,#0c6bd6)]" />
          Five-man units
        </div>
        <h2 className="font-display text-2xl lg:text-3xl text-ink leading-none tracking-tight">Top Lineups</h2>
        <p className="mt-1.5 text-xs text-ink-muted">Best five-man combinations by net rating (points per 100 possessions), min 40 possessions.</p>
      </div>
      <div className="overflow-x-auto overscroll-x-contain">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr className="text-[0.62rem] uppercase tracking-widest text-ink-muted">
              <th className="text-left font-medium px-5 lg:px-7 py-2.5">Lineup</th>
              <th className="text-right font-medium px-3 py-2.5 whitespace-nowrap">Poss</th>
              <th className="text-right font-medium px-3 py-2.5">ORtg</th>
              <th className="text-right font-medium px-3 py-2.5">DRtg</th>
              <th className="text-right font-medium px-5 lg:px-7 py-2.5">Net</th>
            </tr>
          </thead>
          <tbody>
            {units.map((u, i) => (
              <tr key={i} className={cn("border-t border-hairline", i % 2 ? "bg-paper/40" : "")}>
                <td className="px-5 lg:px-7 py-2.5">
                  <span className="text-ink leading-snug">{u.players.join(" · ")}</span>
                </td>
                <td className="text-right px-3 py-2.5 tabular text-ink-muted">{Math.round(u.poss)}</td>
                <td className="text-right px-3 py-2.5 tabular text-ink-soft">{u.off.toFixed(1)}</td>
                <td className="text-right px-3 py-2.5 tabular text-ink-soft">{u.def.toFixed(1)}</td>
                <td className={cn("text-right px-5 lg:px-7 py-2.5 tabular font-semibold", u.net >= 0 ? "text-ink" : "text-ink-muted")}>{sign(u.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
