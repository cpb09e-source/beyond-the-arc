"use client";

import { useMemo, useState } from "react";
import { sideColors } from "@/components/box/game-box-modal";
import { cn } from "@/lib/utils";
import { ScoreHeader } from "./score-header";
import { OverviewTab } from "./overview-tab";
import { PlayersTab } from "./players-tab";
import { PlaysTab } from "./plays-tab";
import type { GameBundle } from "./types";

/**
 * One game, in full.
 *
 * The scoreline is fixed above the tabs and never changes with them — it is
 * what the reader came for, and having it move when you open the play-by-play
 * loses their place. The tab bar sticks instead, so you can jump back out of a
 * 365-row log without scrolling to the top.
 */

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "players", label: "Player Stats" },
  { key: "plays", label: "Play by Play" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export function GameDetail({ b }: { b: GameBundle }) {
  const [tab, setTab] = useState<TabKey>("overview");
  const [hc, ac] = useMemo(
    () => sideColors(b.game.home.team, b.game.away.team),
    [b.game.home.team, b.game.away.team],
  );

  // Season records entering the game, read off the standings tables. Taken
  // from there rather than counted from `form`, which only holds five games —
  // a "5-0" beside a team that is 21-1 is worse than no record at all.
  const records = useMemo(() => {
    const find = (team: string) => {
      for (const rows of Object.values(b.standings)) {
        const hit = rows.find((r) => r.team === team);
        if (hit) return `${hit.w}-${hit.l}`;
      }
      return "";
    };
    return { home: find(b.game.home.team), away: find(b.game.away.team) };
  }, [b.standings, b.game.home.team, b.game.away.team]);

  return (
    <div className="pb-20">
      <ScoreHeader b={b} records={records} hc={hc} ac={ac} />

      <nav className="sticky top-0 z-30 border-b border-hairline bg-paper/95 backdrop-blur">
        <div className="mx-auto max-w-[92rem] px-5 lg:px-10">
          <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                aria-current={t.key === tab ? "page" : undefined}
                className={cn(
                  "relative shrink-0 px-3.5 h-11 text-sm transition-colors whitespace-nowrap",
                  t.key === tab ? "text-ink font-semibold" : "text-ink-muted hover:text-ink-soft",
                )}
              >
                {t.label}
                {t.key === tab && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-coral" />}
              </button>
            ))}
          </div>
        </div>
      </nav>

      <div className="mx-auto max-w-[92rem] px-5 lg:px-10 pt-6">
        {tab === "overview" && <OverviewTab b={b} hc={hc} ac={ac} onOpenBox={() => setTab("players")} />}
        {tab === "players" && <PlayersTab b={b} hc={hc} ac={ac} />}
        {tab === "plays" && <PlaysTab b={b} />}
      </div>
    </div>
  );
}
