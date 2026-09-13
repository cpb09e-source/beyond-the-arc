import { periodHeadings } from "@/components/game/types";
import { gameStatusLabel, isFinal, isLive, isSeed, lineLabel, recordLabel, type ScoreGame, type ScoreTeam } from "@/lib/scoreboard-core";
import type { MouseEvent as ReactMouseEvent } from "react";
import { beginDrag } from "~/objects/drag";
import type { DragSpec } from "~/objects/object";
import { TeamLogo } from "~/ui/logo";
import { sideOf, type TeamNames } from "./board-model";

/**
 * One game on the board: status, the two teams, the halves and the result, and
 * the pre-tip line when there was one.
 *
 * THE RESULT READS DOWN THE RIGHT EDGE. Totals line up in one column across the
 * whole grid, the winner's in ink and the loser's receding, so a night of scores
 * can be scanned without reading a single name. Halves sit just inside the
 * total, headed once per card.
 *
 * AWAY ABOVE HOME, and the home team carries the @: the game is played at their
 * building. A neutral floor has no @, and says so where the venue goes.
 *
 * A CARD IS A PLACE TO GO. Click or Enter opens the game; Ctrl opens it in a new
 * tab and Shift beside this one. The board moves focus between cards with the
 * arrow keys (see the view), so only the focused card is in the tab order.
 */
export function GameCard({
  g,
  names,
  focused,
  onFocus,
  onOpen,
  onMenu,
  drag,
  focus,
}: {
  g: ScoreGame;
  names: TeamNames | null;
  focused: boolean;
  onFocus: () => void;
  onOpen: (how: { newTab: boolean; side: boolean }) => void;
  /** Right-click: the game's own menu (~/objects/actions.tsx). */
  onMenu?: (e: ReactMouseEvent) => void;
  /** What the card carries when dragged: the game, to the tabs or the other pane. */
  drag?: DragSpec;
  /** Focus: true lights the card, false steps it back, undefined leaves it be. */
  focus?: boolean;
}) {
  const live = isLive(g);
  const final = isFinal(g);
  const halves = Math.max(g.home.periods.length, g.away.periods.length);
  const heads = periodHeadings(halves);
  const line = lineLabel(g);
  const cols = `minmax(0,1fr) repeat(${halves}, 26px) 38px`;
  const where = g.neutralSite ? (g.venue ? `${g.venue} · neutral` : "Neutral floor") : (g.venue ?? "");

  return (
    <div
      data-card={g.id}
      role="button"
      tabIndex={focused ? 0 : -1}
      aria-label={`${g.away.team} ${g.neutralSite ? "versus" : "at"} ${g.home.team}, ${gameStatusLabel(g)}`}
      onFocus={onFocus}
      onContextMenu={onMenu}
      draggable={drag ? true : undefined}
      onDragStart={drag ? (e) => beginDrag(e, drag) : undefined}
      onClick={(e) => onOpen({ newTab: e.ctrlKey || e.metaKey, side: e.shiftKey })}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        e.stopPropagation();
        onOpen({ newTab: e.ctrlKey || e.metaKey, side: e.shiftKey });
      }}
      className={`group flex cursor-default flex-col rounded-lg border bg-card px-3 pb-2.5 pt-2 outline-none transition-colors focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent)_22%,transparent)] ${
        live ? "border-[color-mix(in_oklab,var(--accent)_55%,var(--hairline))]" : "border-hairline hover:border-[color-mix(in_oklab,var(--ink-muted)_60%,var(--hairline))]"
      } ${focus === true ? "shadow-[0_0_0_2px_var(--accent)]" : focus === false ? "opacity-35" : ""}`}
    >
      <div className="flex h-[20px] items-center justify-between gap-3 text-[11.5px]">
        <span className={`flex shrink-0 items-center gap-1.5 font-medium ${live ? "text-accent" : final ? "text-ink-soft" : "text-ink-muted"}`}>
          {live && <span className="live-dot" aria-hidden />}
          {gameStatusLabel(g)}
          {final && halves > 2 && <span className="font-normal text-ink-muted">{halves === 3 ? "OT" : `${halves - 2}OT`}</span>}
        </span>
        <span className="min-w-0 truncate text-ink-muted" title={where}>
          {where}
        </span>
      </div>

      <div className="mt-1">
        {halves > 0 && (
          <div className="grid h-[14px] items-end text-[9.5px] font-medium uppercase tracking-[0.06em] text-ink-muted" style={{ gridTemplateColumns: cols }}>
            <span />
            {heads.map((h) => (
              <span key={h} className="text-center">
                {h}
              </span>
            ))}
            <span className="text-right">T</span>
          </div>
        )}
        <TeamLine t={g.away} names={names} cols={cols} halves={halves} final={final} at={false} />
        <TeamLine t={g.home} names={names} cols={cols} halves={halves} final={final} at={!g.neutralSite} />
      </div>

      {line && (
        <div className="mt-1.5 truncate border-t border-hairline pt-1.5 text-[11.5px] text-ink-muted" title={`Closing line, ${g.line?.provider ?? ""}`}>
          {line}
        </div>
      )}
    </div>
  );
}

function TeamLine({
  t,
  names,
  cols,
  halves,
  final,
  at,
}: {
  t: ScoreTeam;
  names: TeamNames | null;
  cols: string;
  halves: number;
  final: boolean;
  at: boolean;
}) {
  const side = sideOf(names, t.team);
  const lost = final && t.winner === false;
  const won = final && t.winner === true;
  const rec = recordLabel(t);
  return (
    <div className="grid h-[28px] items-center" style={{ gridTemplateColumns: cols }}>
      <span className="flex min-w-0 items-center gap-2">
        <TeamLogo id={side.logoId} name={t.team} size={20} />
        {/* Poll rank displaces a seed where a team has both: two numerals by one name read as a score. */}
        {t.rank != null ? (
          <span className="w-[14px] shrink-0 text-right text-[10.5px] font-semibold text-ink-muted tabular">{t.rank}</span>
        ) : isSeed(t.seed) ? (
          <span className="w-[14px] shrink-0 text-right text-[10.5px] text-ink-muted tabular" title={`${t.seed} seed`}>
            {t.seed}
          </span>
        ) : null}
        {at && (
          <span className="shrink-0 text-[11px] text-ink-muted" aria-label="at">
            @
          </span>
        )}
        <span className={`truncate text-[13px] ${won ? "font-semibold text-ink" : lost ? "text-ink-muted" : "text-ink-soft"}`}>{t.team}</span>
        {rec && <span className="shrink-0 text-[11px] text-ink-muted tabular">{rec}</span>}
      </span>
      {Array.from({ length: halves }, (_, i) => (
        <span key={i} className="text-center text-[11.5px] text-ink-muted tabular">
          {t.periods[i] ?? "–"}
        </span>
      ))}
      <span className={`text-right text-[16px] leading-none tabular ${won ? "font-semibold text-ink" : lost ? "text-ink-muted" : "font-medium text-ink"}`}>
        {t.points ?? ""}
      </span>
    </div>
  );
}
