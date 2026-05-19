"use client";

import { useEffect, useRef, useState } from "react";
import { TeamLogo } from "@/components/team-logo";
import type { GameLog } from "@/lib/static-data";
import { ScheduleGameModal } from "@/components/teams/schedule-game-modal";
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

export function ScheduleTicker({
  games,
  teamName,
}: {
  games: GameLog[];
  teamName: string;
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

  function handleCellClick(game: GameLog) {
    // If the user just finished dragging, swallow this click.
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    setOpenGame(game);
  }

  if (games.length === 0) return null;

  return (
    <>
      <div>
        <div className="flex items-baseline gap-3 mb-3">
          <span className="text-[0.65rem] uppercase tracking-widest text-coral font-bold">
            Schedule
          </span>
          <span className="text-[0.6rem] text-ink-muted hidden sm:inline">
            click + drag to scroll · click a game for details
          </span>
          <span className="text-[0.6rem] text-ink-muted sm:hidden">
            swipe to scroll · tap a game
          </span>
        </div>
        <div
          ref={scrollerRef}
          className="overflow-x-auto select-none cursor-grab [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          style={{ scrollSnapType: "x proximity" }}
        >
          <div className="flex items-start gap-1.5 min-w-min">
            {games.map((g, i) => (
              <GameCell
                key={`${g.game_date}-${i}`}
                game={g}
                onClick={() => handleCellClick(g)}
              />
            ))}
          </div>
        </div>
      </div>
      {openGame && (
        <ScheduleGameModal
          game={openGame}
          teamName={teamName}
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
  const title = `${fmtDate(game.game_date)} ${venue} ${opp}${scoreStr ? ` · ${scoreStr}` : ""}${game.won === true ? " W" : game.won === false ? " L" : ""}`;

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      // Disable drag from native browser so it doesn't try to drag the image.
      draggable={false}
      className="flex flex-col items-center gap-1 shrink-0 w-9 rounded p-0.5 hover:bg-[var(--accent-tint)] transition-colors cursor-pointer"
    >
      <span
        className={cn(
          "inline-flex items-center justify-center text-[0.55rem] font-semibold tabular w-6 h-4 rounded-sm leading-none pointer-events-none",
          game.won === true && "bg-emerald-100 text-emerald-800",
          game.won === false && "bg-rose-100 text-rose-800",
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
