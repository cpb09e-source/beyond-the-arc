"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Navigation for a player page's three sections.
 *
 * CLIENT STATE, NOT ROUTES — and that is a build-cost decision, not a taste
 * one. The team page gets real sub-routes because there are a few thousand
 * team-seasons; this route already prebuilds around 15,700 pages, and three
 * routes each would be roughly 47,000 on a build that already takes ten
 * minutes and has been seen using 1.75GB. Every panel is rendered into the
 * page and switched here instead.
 *
 * What that costs is honest to state: no per-tab URL to share, and each page
 * carries all three panels' markup. What it buys is instant switching, no
 * second data read, and a build that does not triple.
 *
 * TWO SHAPES, ONE LIST: a bar fixed to the bottom of the screen below lg, a
 * strip above the content at lg and up. Both render the same TABS array in the
 * same order, so there is one place to add a section.
 *
 * THE BAR IS TYPE, NOT ICONS, for the same reason the team bar is: three
 * section names in small caps under an accent rule reads as an index, which is
 * what a page of tables wants. With only three tabs there is room for the full
 * names, so nothing is abbreviated here.
 */

export type PlayerTab = "overview" | "log" | "shooting";

const TABS: Array<{ key: PlayerTab; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "log", label: "Game Log" },
  { key: "shooting", label: "Shooting" },
];

export function PlayerTabs({
  overview,
  log,
  shooting,
}: {
  overview: React.ReactNode;
  log: React.ReactNode;
  shooting: React.ReactNode;
}) {
  const [active, setActive] = useState<PlayerTab>("overview");
  const panels: Record<PlayerTab, React.ReactNode> = { overview, log, shooting };

  return (
    <div
      // Marks the document for the footer-clearance rule in globals.css, the
      // same one the team bar uses. The bar is fixed and the site footer is a
      // sibling of this page rather than a child, so padding this wrapper adds
      // space BEFORE the footer and the footer is still under the bar.
      data-player-bottom-bar=""
    >
      <TabStrip active={active} onSelect={setActive} />

      {/* EVERY PANEL STAYS MOUNTED. Switching with `hidden` rather than by
          unmounting keeps each panel's own state alive across a tab change —
          the game log's season and split pickers, the overview's year picker —
          and means no panel pays to re-render when you come back to it. It also
          leaves all three in the HTML for a reader with no JavaScript, who gets
          the whole page as one scroll. */}
      {TABS.map((t) => (
        <div key={t.key} hidden={t.key !== active}>
          {panels[t.key]}
        </div>
      ))}

      <PlayerBottomBar active={active} onSelect={setActive} />
    </div>
  );
}

/**
 * The desktop control. A strip above the content rather than the rail the team
 * pages carry, and that is a scope decision: a rail has to sit beside the
 * content, which means every section on the page has to agree on one container
 * width first. The team page paid that cost — ten sections normalised from
 * three different max-widths — because a rail that moves when you change tabs
 * is worse than no rail. This page's sections have not been through that yet,
 * so the strip goes above them where container width does not matter.
 */
function TabStrip({
  active,
  onSelect,
}: {
  active: PlayerTab;
  onSelect: (t: PlayerTab) => void;
}) {
  return (
    <nav
      aria-label="Player sections"
      className="hidden lg:block mx-auto max-w-[88rem] px-10 pt-6"
    >
      <ul className="flex items-stretch gap-1 border-b border-hairline">
        {TABS.map((t) => {
          const isActive = t.key === active;
          return (
            <li key={t.key}>
              <button
                type="button"
                onClick={() => onSelect(t.key)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "relative px-4 py-2.5 text-sm font-semibold transition-colors",
                  isActive ? "text-coral" : "text-ink-muted hover:text-ink",
                )}
              >
                {t.label}
                {/* Sits ON the container's rule rather than above it, so the
                    marked tab reads as continuous with the panel below. */}
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-x-2 -bottom-px h-[2.5px] rounded-t-sm bg-coral",
                    isActive ? "opacity-100" : "opacity-0",
                  )}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function PlayerBottomBar({
  active,
  onSelect,
}: {
  active: PlayerTab;
  onSelect: (t: PlayerTab) => void;
}) {
  return (
    <nav
      aria-label="Player sections"
      className={cn(
        "lg:hidden fixed inset-x-0 bottom-0 z-40",
        "border-t border-hairline bg-card/95 backdrop-blur",
        // A CONSTANT reserve, not env(safe-area-inset-bottom) — that value is
        // 0 while iOS Safari's toolbar is on screen and about 34px once it
        // collapses, so a bar padded by it grows partway down the page and
        // shrinks on the way back. See the same note on the team bar.
        "pb-3",
      )}
    >
      <ul className="flex items-stretch">
        {TABS.map((t) => {
          const isActive = t.key === active;
          return (
            <li key={t.key} className="flex-1 min-w-0">
              <button
                type="button"
                onClick={() => onSelect(t.key)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "relative w-full flex items-center justify-center h-[2.875rem] px-0.5 transition-colors",
                  "text-[0.625rem] font-bold uppercase tracking-[0.04em] whitespace-nowrap truncate",
                  isActive ? "text-coral" : "text-ink-muted",
                )}
              >
                {/* Inset from the cell edges: a rule spanning the full cell
                    meets its neighbour's and the three read as one line with a
                    coloured segment rather than as one marked tab. */}
                <span
                  aria-hidden
                  className={cn(
                    "absolute left-[22%] right-[22%] top-0 h-[2.5px] rounded-b-sm bg-coral",
                    isActive ? "opacity-100" : "opacity-0",
                  )}
                />
                {t.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
