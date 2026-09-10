"use client";

import { useMemo, useRef, useState } from "react";
import { sideColors } from "@/components/box/game-box-modal";
import { cn } from "@/lib/utils";
import { longDate } from "./types";
import { ScoreHeader } from "./score-header";
import { OverviewTab } from "./overview-tab";
import { PlayersTab } from "./players-tab";
import type { GameLinks } from "@/lib/game-team-links";
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

export function GameDetail({ b, partial = false, detailFailed = false, links }: {
  b: GameBundle;
  /** Team and coach links, resolved at build time by the game page. */
  links?: GameLinks;
  /** The box score could not be loaded. The scoreline above is still real. */
  detailFailed?: boolean;
  /**
   * The scoreline is real but the box score has not arrived yet — the state an
   * archived game page renders in for the moment between its HTML and its
   * bundle. The tabs say so rather than drawing empty tables, which read as a
   * game nobody has stats for.
   */
  partial?: boolean;
}) {
  const [tab, setTab] = useState<TabKey>("overview");
  const tabsTopRef = useRef<HTMLDivElement>(null);

  /**
   * Land the reader on the tab bar when they switch tabs from further down.
   *
   * Switching tabs does not move the scroll position, so "Full box score" —
   * a button sitting well below the fold inside Game leaders — swapped the
   * content underneath and left the reader stranded in the middle of a table
   * they had not seen the top of, with no header row and no tabs in sight.
   *
   * ONLY WHEN THE BAR HAS ALREADY SCROLLED OFF. Scrolling unconditionally
   * would be worse than the bug: tap a tab while the scoreline is on screen
   * and the page would jump down past it. `top >= 0` means the bar is still
   * visible, so there is nothing to fix.
   *
   * The anchor is a separate zero-height div rather than the <nav>, because
   * the nav is `sticky top-0` — once it is pinned its rect reports the pinned
   * position, not its place in the document, and scrolling to that is a no-op.
   * A static sibling directly above it always reports the real one.
   */
  const snapToTabs = () => {
    const el = tabsTopRef.current;
    if (!el || el.getBoundingClientRect().top >= 0) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  };

  const openTab = (k: TabKey) => { setTab(k); snapToTabs(); };
  const [hc, ac] = useMemo(
    () => sideColors(b.game.home.team, b.game.away.team),
    [b.game.home.team, b.game.away.team],
  );

  // Season records entering the game, read off the standings tables. Taken
  // from there rather than counted from `form`, which only holds five games —
  // a "5-0" beside a team that is 21-1 is worse than no record at all.
  /**
   * Nothing has happened yet. `status` is what the feed says; the points
   * check catches a stale "scheduled" on a game that has plainly started.
   */
  const notStarted = b.game.status === "scheduled"
    && b.game.home.points === null && b.game.away.points === null;

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
      <ScoreHeader b={b} records={records} />

      <div ref={tabsTopRef} aria-hidden className="h-0" />
      <nav className="sticky top-0 z-30 border-b border-hairline bg-paper/95 backdrop-blur">
        <div className="mx-auto max-w-[var(--page-narrow)] px-5 lg:px-10">
          <div className="flex gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => openTab(t.key)}
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

      <div className="mx-auto max-w-[var(--page-narrow)] px-5 lg:px-10 pt-6">
        {/* A GAME THAT HAS NOT TIPPED HAS NOTHING TO SHOW, and must say that
            rather than spin. These pages are built from the fixture list
            months ahead, so "Loading the box score…" would be the honest
            answer to a question nobody asked — the box score is not late, it
            does not exist yet. */}
        {notStarted ? (
          <div className="py-16 text-center">
            <p className="text-sm text-ink-soft">This game has not been played yet.</p>
            <p className="mt-1.5 text-xs text-ink-muted">
              {longDate(b.game.startDate)}
              {b.game.venue ? ` · ${b.game.venue}` : ""}
              {b.game.tbd ? " · tip time to be announced" : ""}
            </p>
            <p className="mt-4 text-xs text-ink-muted">
              The box score, four factors and play-by-play appear here once it tips.
            </p>
          </div>
        ) : detailFailed ? (
          <p className="py-16 text-center text-sm text-ink-muted">
            The box score for this game could not be loaded. The result above is final.
          </p>
        ) : partial ? (
          <p className="py-16 text-center text-sm text-ink-muted">Loading the box score…</p>
        ) : (
          <>
            {tab === "overview" && <OverviewTab b={b} hc={hc} ac={ac} onOpenBox={() => openTab("players")} />}
            {tab === "players" && <PlayersTab b={b} hc={hc} ac={ac} links={links} />}
            {tab === "plays" && <PlaysTab b={b} />}
          </>
        )}
      </div>
    </div>
  );
}
