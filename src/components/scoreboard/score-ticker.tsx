"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { TeamLogo } from "@/components/team-logo";
import { cn } from "@/lib/utils";
import { useDragPan } from "@/lib/use-drag-pan";
import {
  EMPTY_SLATE, POLL_MS, fetchSlate, gameHref, isFinal, isLive, slateIsSettled, tipLabel,
  type ScoreGame, type Slate,
} from "@/lib/scoreboard";

/**
 * Site-wide score rail, directly under the nav.
 *
 * RENDERS NOTHING WITHOUT GAMES. It is chrome on every page of the site, so an
 * empty slate — the offseason, a dark Monday, or plain `next dev` where the
 * Netlify function isn't mounted — must collapse to zero height rather than
 * leave an empty bar above every page.
 *
 * POLLING IS CONDITIONAL, in three ways, because this runs everywhere and the
 * CBBD call budget is finite (see netlify/functions/scoreboard.mts):
 *   - a settled slate (every game final) stops polling entirely; last night's
 *     scores cannot change
 *   - a hidden tab stops polling; nobody is reading it
 *   - the interval matches the function's edge cache, so an extra poll would
 *     only re-serve identical cached bytes
 */
export function ScoreTicker() {
  const [slate, setSlate] = useState<Slate>(EMPTY_SLATE);
  const railRef = useRef<HTMLDivElement>(null);
  // Same click-and-drag gesture as the teams and players tables, so the rail
  // behaves the way every other horizontally scrolling surface here does.
  //
  // fromLinks, because every cell here IS a link: the hook's default guard
  // skips a pan that starts on an <a>, which on this rail meant every pointer
  // down. It also swallows the click that ends a drag, so dragging past a game
  // doesn't open it.
  const panHandlers = useDragPan(railRef, { fromLinks: true });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ctrl = new AbortController();

    const tick = async () => {
      const next = await fetchSlate(undefined, ctrl.signal);
      if (cancelled) return;
      setSlate(next);
      // Stop once every game is final — the answer can't change until tomorrow,
      // and a poll a minute through the night is pure waste against the quota.
      if (!slateIsSettled(next)) timer = setTimeout(tick, POLL_MS);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        if (timer) clearTimeout(timer);
        void tick();
      } else if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    };

    void tick();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      ctrl.abort();
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  if (slate.games.length === 0) return null;

  const liveCount = slate.games.filter(isLive).length;

  return (
    <div className="border-b border-hairline bg-paper-deep/40">
      <div className="relative flex items-stretch">
        {/* Label rail — sticky at the left edge so you always know what the
            numbers are, even mid-scroll. */}
        <Link
          href="/scoreboard"
          className="shrink-0 z-10 flex items-center gap-1.5 pl-4 lg:pl-6 pr-3 bg-paper-deep/40 backdrop-blur-sm border-r border-hairline text-[0.6rem] uppercase tracking-[0.14em] font-bold text-ink-muted hover:text-coral transition-colors"
        >
          {liveCount > 0 ? (
            <>
              <span className="relative flex h-1.5 w-1.5" aria-hidden>
                <span className="absolute inline-flex h-full w-full rounded-full bg-coral opacity-75 motion-safe:animate-ping" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-coral" />
              </span>
              <span className="text-coral">{liveCount} live</span>
            </>
          ) : (
            <span>Scores</span>
          )}
        </Link>

        {/* The rail itself. Horizontal scroll with the scrollbar hidden — the
            games run off the right edge as an affordance that there are more. */}
        <div
          ref={railRef}
          className="flex-1 min-w-0 overflow-x-auto overscroll-x-contain cursor-grab [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          {...panHandlers}
        >
          <div className="flex items-stretch w-max">
            {slate.games.map((g) => <TickerGame key={g.id} g={g} />)}
            <Link
              href="/scoreboard"
              className="shrink-0 flex items-center px-4 text-[0.62rem] uppercase tracking-[0.12em] font-semibold text-coral hover:underline whitespace-nowrap"
            >
              Full scoreboard →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function TickerGame({ g }: { g: ScoreGame }) {
  const live = isLive(g);
  const final = isFinal(g);
  return (
    // A link, not a div: each cell opens that game. `draggable={false}` matters
    // — without it the browser's native link-drag hijacks the pointer and the
    // rail stops panning the moment you start a drag on a game.
    <Link
      href={gameHref(g)}
      draggable={false}
      className="shrink-0 flex items-center gap-2.5 px-3.5 py-2.5 border-r border-hairline/60 last:border-r-0 hover:bg-paper-deep/60 transition-colors">
      <div className="flex flex-col gap-1 leading-none">
        <TickerSide side={g.away} won={final && g.away.winner === true} />
        <TickerSide side={g.home} won={final && g.home.winner === true} />
      </div>
      <div className="shrink-0 w-11 text-[0.55rem] uppercase tracking-[0.1em] font-semibold tabular">
        {live ? (
          <span className="text-coral">
            {g.clock ?? "Live"}
            {g.period != null && <span className="block text-ink-muted font-normal">{ordinalPeriod(g.period)}</span>}
          </span>
        ) : final ? (
          <span className="text-ink-muted">Final</span>
        ) : (
          <span className="text-ink-muted normal-case tracking-normal font-normal">{tipLabel(g.startDate)}</span>
        )}
      </div>
    </Link>
  );
}

function TickerSide({ side, won }: { side: ScoreGame["home"]; won: boolean }) {
  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap">
      <TeamLogo name={side.team} size={14} />
      {/* AP rank ahead of the name, the way a broadcast ticker writes it.
          Tournament seed only shows when there is no poll rank — in March both
          exist and two small numbers next to one team read as a score. */}
      {side.rank != null ? (
        <span className="shrink-0 inline-flex items-center justify-center min-w-4 h-3.5 px-0.5 rounded-sm bg-coral text-white text-[0.5rem] font-bold tabular leading-none">
          {side.rank}
        </span>
      ) : side.seed != null ? (
        <span className="text-[0.5rem] text-ink-muted tabular">{side.seed}</span>
      ) : null}
      <span className={cn("text-[0.68rem] max-w-28 truncate", won ? "text-ink font-semibold" : "text-ink-soft")}>
        {side.team}
      </span>
      <span className={cn("text-[0.68rem] tabular ml-auto pl-1.5", won ? "text-ink font-bold" : "text-ink-muted")}>
        {side.points ?? "—"}
      </span>
    </div>
  );
}

/** "2nd" / "OT" / "2OT" — college basketball plays two halves, then overtimes. */
function ordinalPeriod(p: number): string {
  if (p <= 1) return "1st";
  if (p === 2) return "2nd";
  return p === 3 ? "OT" : `${p - 2}OT`;
}
