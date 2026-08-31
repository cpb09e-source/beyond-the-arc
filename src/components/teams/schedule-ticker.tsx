"use client";

import { useEffect, useRef, useState } from "react";
import { TeamLogo } from "@/components/team-logo";
import type { GameLog } from "@/lib/static-data";
import { ScheduleGameModal } from "@/components/teams/schedule-game-modal";
import { BlurOverlay } from "@/components/teams/preview-blur";
import { cn } from "@/lib/utils";

/**
 * Minimal schedule strip — opponent logos in date order with a soft W/L pill
 * above. Flat on the page (no card wrapper). Drag-to-scroll with the mouse
 * (or swipe on touch). Clicking a cell opens a game-summary modal.
 *
 * Drag detection: we suppress the click that fires after the user dragged
 * more than a few pixels, so a clean tap/click still works as a click.
 */

const DRAG_THRESHOLD_PX = 6;

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map((s) => parseInt(s, 10));
  if (!y || !m || !d) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[m - 1]} ${d}`;
}

// Compute the season-end year for a game date. Games in Nov/Dec belong to the
// next calendar year's season (Nov 2025 → 25-26 → 2026); Jan-Apr stay in the
// current calendar year's season (Mar 2026 → 25-26 → 2026).
function seasonEndYearOf(date: string | null): number | null {
  if (!date) return null;
  const m = date.match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  const y = parseInt(m[1]!, 10);
  const mon = parseInt(m[2]!, 10);
  if (!Number.isFinite(y) || !Number.isFinite(mon)) return null;
  return mon >= 11 ? y + 1 : y;
}
function seasonLabel(yearEnd: number): string {
  return `${(yearEnd - 1).toString().slice(-2)}-${yearEnd.toString().slice(-2)}`;
}

export function ScheduleTicker({
  games,
  teamName,
  eyebrow = "Schedule",
  helpText = "click + drag to scroll · click a game for box score",
  helpTextMobile = "swipe to scroll · tap a game",
  showSeasonLabels = false,
  blurBody = false,
}: {
  games: GameLog[];
  teamName: string;
  eyebrow?: string;
  helpText?: string;
  helpTextMobile?: string;
  /** Group games by season-end year, with a small year label under each cluster. */
  showSeasonLabels?: boolean;
  /** Preview mode — blur the ticker + overlay the "no games yet" note; header stays sharp. */
  blurBody?: boolean;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const dragState = useRef({ down: false, startX: 0, startScrollLeft: 0, moved: 0 });
  const suppressClickRef = useRef(false);
  const [openGame, setOpenGame] = useState<GameLog | null>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    function onMouseDown(e: MouseEvent) {
      dragState.current = {
        down: true,
        startX: e.pageX,
        startScrollLeft: el!.scrollLeft,
        moved: 0,
      };
      el!.style.cursor = "grabbing";
    }
    function onMouseMove(e: MouseEvent) {
      const s = dragState.current;
      if (!s.down) return;
      const dx = e.pageX - s.startX;
      s.moved = Math.max(s.moved, Math.abs(dx));
      el!.scrollLeft = s.startScrollLeft - dx;
      // Suppress the click that would fire on release once we've moved past
      // the threshold — otherwise a drag would also open the modal.
      if (s.moved > DRAG_THRESHOLD_PX) suppressClickRef.current = true;
    }
    function onMouseUp() {
      dragState.current.down = false;
      el!.style.cursor = "grab";
    }
    function onMouseLeave() {
      if (dragState.current.down) {
        dragState.current.down = false;
        el!.style.cursor = "grab";
      }
    }

    el.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    el.addEventListener("mouseleave", onMouseLeave);
    return () => {
      el.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      el.removeEventListener("mouseleave", onMouseLeave);
    };
  }, []);

  // Open at the END of the schedule — the most recent game — and let the reader
  // scroll left into the season. A ticker parked at November opens on games
  // nobody is looking for; the interesting end of a season is the end of it.
  //
  // Written directly rather than via scrollTo({behavior:"smooth"}) so the strip
  // is simply already there on first paint instead of visibly animating past
  // every game on the way.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollLeft = el.scrollWidth;
  }, [games]);

  function handleCellClick(game: GameLog) {
    // If the user just finished dragging, swallow this click.
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    setOpenGame(game);
  }

  if (games.length === 0) return null;

  // Group consecutive games by season-end year. We assume games arrive in
  // chronological order — caller's responsibility.
  const groups: { year: number; games: GameLog[] }[] = [];
  for (const g of games) {
    const yr = seasonEndYearOf(g.game_date) ?? 0;
    const last = groups[groups.length - 1];
    if (last && last.year === yr) last.games.push(g);
    else groups.push({ year: yr, games: [g] });
  }

  return (
    <>
      <div>
        <div className="flex items-baseline gap-3 mb-3">
          <span className="text-[0.65rem] uppercase tracking-widest text-coral font-bold">
            {eyebrow}
          </span>
          <span className="text-[0.6rem] text-ink-muted hidden sm:inline">
            {helpText}
          </span>
          <span className="text-[0.6rem] text-ink-muted sm:hidden">
            {helpTextMobile}
          </span>
        </div>
        {(() => {
        const scroller = (
        <div
          ref={scrollerRef}
          // py-1 -my-1 IS NOT SPACING, it is headroom for the tournament tiles.
          // overflow-x-auto forces the other axis to compute as auto too (CSS
          // overflow: one axis non-visible makes the other non-visible), so this
          // box clips vertically — and the tourney cells' ring sat exactly on the
          // edge, shaving the top and bottom of every green and red box. The
          // padding gives them room inside the scroller; the negative margin gives
          // it back to the layout, so nothing else moves.
          className="overflow-x-auto overscroll-x-contain select-none cursor-grab py-1 -my-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          style={{ scrollSnapType: "x proximity" }}
        >
          <div className={cn("flex items-start min-w-min", showSeasonLabels ? "gap-2" : "gap-1.5")}>
            {showSeasonLabels
              ? groups.map((group) => (
                  <div
                    key={group.year}
                    // Subtle tinted card per year cluster so adjacent groups
                    // read as distinct seasons at a glance. Use the existing
                    // paper-deep tone (consistent with site's card palette).
                    className="flex flex-col items-center gap-1.5 shrink-0 rounded-md bg-paper-deep/40 px-1.5 pt-1.5 pb-1 border border-hairline/40"
                  >
                    <div className="flex items-start gap-1">
                      {group.games.map((g, i) => (
                        <GameCell
                          key={`${g.game_date}-${i}`}
                          game={g}
                          onClick={() => handleCellClick(g)}
                        />
                      ))}
                    </div>
                    <span className="text-[0.55rem] uppercase tracking-widest text-ink-muted font-medium tabular">
                      {group.year > 0 ? seasonLabel(group.year) : ""}
                    </span>
                  </div>
                ))
              : games.map((g, i) => (
                  <GameCell
                    key={`${g.game_date}-${i}`}
                    game={g}
                    onClick={() => handleCellClick(g)}
                  />
                ))}
          </div>
        </div>
        );
        return blurBody ? <BlurOverlay subtext={null}>{scroller}</BlurOverlay> : scroller;
        })()}
      </div>
      {openGame && (
        <ScheduleGameModal
          game={openGame}
          // Prefer the game's own team_name so the modal sorts the box-score
          // correctly when a single ticker spans multiple schools (e.g. a
          // coach's career-resume ticker covering past programs).
          teamName={openGame.team_name ?? teamName}
          onClose={() => setOpenGame(null)}
        />
      )}
    </>
  );
}

function GameCell({
  game,
  onClick,
}: {
  game: GameLog;
  onClick: () => void;
}) {
  const opp = game.opp_team_market ?? "TBD";
  const venue = game.is_neutral ? "vs" : game.is_home ? "vs" : "@";
  const scoreStr =
    game.pts_scored !== null && game.pts_against !== null
      ? `${game.pts_scored}-${game.pts_against}`
      : "";
  const isTourney = !!game.tournamentRound;
  const title = `${fmtDate(game.game_date)} ${venue} ${opp}${scoreStr ? ` · ${scoreStr}` : ""}${game.won === true ? " W" : game.won === false ? " L" : ""}${isTourney ? ` · ${game.tournamentRound}` : ""}`;

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      // Disable drag from native browser so it doesn't try to drag the image.
      draggable={false}
      className={cn(
        "flex flex-col items-center gap-1 shrink-0 w-9 rounded p-0.5 hover:bg-[var(--accent-tint)] transition-colors cursor-pointer",
        // Tournament cells get a subtle inset wash + hairline ring colored
        // by result — green for a win, red for a loss — so the March
        // Madness stretch reads as a color-coded mini-bracket.
        isTourney && game.won === true && "bg-good/12 ring-1 ring-good/35",
        isTourney && game.won === false && "bg-bad/12 ring-1 ring-bad/35",
        isTourney && game.won === null && "bg-paper-deep ring-1 ring-hairline",
      )}
    >
      {/* Round badge — only present on tournament-themed tickers (R1/R2/S16/E8/F4/NC).
          Label color follows the win/loss color so the round + result read together. */}
      {game.tournamentRound && (
        <span
          className={cn(
            "text-[0.5rem] tabular font-bold uppercase tracking-wider leading-none pointer-events-none",
            game.won === true && "text-good",
            game.won === false && "text-bad",
            game.won === null && "text-ink-muted",
          )}
        >
          {game.tournamentRound}
        </span>
      )}
      <span
        className={cn(
          "inline-flex items-center justify-center text-[0.55rem] font-semibold tabular w-6 h-4 rounded-sm leading-none pointer-events-none",
          game.won === true && "bg-good/15 text-good",
          game.won === false && "bg-bad/15 text-bad",
          game.won === null && "bg-paper-deep text-ink-muted",
        )}
      >
        {game.won === true ? "W" : game.won === false ? "L" : "—"}
      </span>
      <span className="pointer-events-none">
        <TeamLogo name={opp} size={28} />
      </span>
    </button>
  );
}
