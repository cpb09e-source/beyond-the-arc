import { useLayoutEffect, useRef } from "react";
import type { RankedStat } from "@/lib/static-data";
import { ranksFor, type Season, type Team } from "~/data/team-model";
import { fmtRanked, seasonLabel } from "~/ui/format";
import { Kbd } from "~/ui/kbd";
import { TeamLogo } from "~/ui/logo";

/**
 * The team Peek: who they are, what they are best and worst at nationally, and
 * whether they sit inside the contender zone.
 *
 * BEST AND WEAKEST ARE THE SITE'S OWN RANKS, the same list a team page shows,
 * so a Peek can never tell a different story from the page it previews.
 */
export function TeamPeek({
  season,
  team,
  pinned,
  top,
  onHeight,
}: {
  season: Season;
  team: Team;
  pinned: boolean;
  top: number;
  onHeight: (px: number) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const ranks = ranksFor(season, team);

  // The table clamps the panel inside its viewport, which needs the panel's
  // real height. Content length varies by team, so it is measured, not assumed.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    onHeight(el.offsetHeight);
    const ro = new ResizeObserver(() => onHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [onHeight]);

  return (
    <aside
      ref={ref}
      aria-label={`${team.name} preview`}
      className="peek-panel absolute right-4 top-0 z-20 w-[372px] overflow-hidden rounded-[10px] border border-hairline bg-card"
      style={{ transform: `translate3d(0, ${top}px, 0)` }}
    >
      <header className="flex items-start gap-3 px-4 pb-3 pt-3.5">
        <TeamLogo id={team.logoId} name={team.name} size={34} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="truncate text-[16px] font-semibold leading-tight tracking-[-0.01em] text-ink">
              {team.name}
            </h2>
            {team.btaRank != null && (
              <span className="shrink-0 rounded-[5px] bg-[var(--accent-wash)] px-1.5 py-[3px] font-mono text-[10.5px] font-semibold text-accent tabular">
                BTA #{team.btaRank}
              </span>
            )}
          </div>
          <div className="mt-0.5 text-[12px] text-ink-muted tabular">
            {team.wins}–{team.losses} · {team.confLabel} · {seasonLabel(season.year)}
          </div>
        </div>
      </header>

      {ranks ? (
        <>
          <RankList title="Best nationally" stats={ranks.top} tone="good" />
          <RankList title="Weakest nationally" stats={ranks.bottom.slice(0, 3)} tone="weak" />
        </>
      ) : (
        <p className="border-t border-hairline px-4 py-2.5 text-[12px] text-ink-muted">
          No national ranks for this season.
        </p>
      )}

      <ZoneLine season={season} team={team} />

      <footer className="flex items-center gap-3 border-t border-hairline bg-paper-deep/40 px-4 py-2 text-[11px] text-ink-muted">
        <span className="flex items-center gap-1.5">
          <Kbd>Space</Kbd>
          {pinned ? "close" : "release to close"}
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          next team
        </span>
        {pinned && (
          <span className="ml-auto flex items-center gap-1.5">
            <Kbd>Esc</Kbd>
          </span>
        )}
      </footer>
    </aside>
  );
}

function RankList({ title, stats, tone }: { title: string; stats: RankedStat[]; tone: "good" | "weak" }) {
  return (
    <section className="border-t border-hairline px-4 py-2.5">
      <h3 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-muted">{title}</h3>
      <ul className="grid gap-[5px]">
        {stats.map((s) => {
          // Where the rank sits in the field, 1.0 = first. The bar is the
          // comparability cue; the number beside it is the fact.
          const standing = s.total > 1 ? 1 - (s.rank - 1) / (s.total - 1) : 1;
          return (
            <li key={s.key} className="grid grid-cols-[minmax(0,1fr)_auto_64px] items-center gap-3 text-[12.5px]">
              <span className="truncate text-ink-soft">{s.label}</span>
              <span className="text-ink tabular">{fmtRanked(s)}</span>
              <span className="flex items-center justify-end gap-2">
                <span className="relative h-[3px] w-[22px] overflow-hidden rounded-full bg-hairline">
                  <span
                    className={`absolute inset-y-0 left-0 rounded-full ${tone === "good" ? "bg-good" : "bg-bad"}`}
                    style={{ width: `${Math.max(8, standing * 100)}%` }}
                  />
                </span>
                <span
                  className={`w-[34px] text-right font-mono text-[11px] font-semibold tabular ${
                    tone === "good" ? "text-good" : "text-ink-muted"
                  }`}
                  title={`${s.rank} of ${s.total}`}
                >
                  #{s.rank}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ZoneLine({ season, team }: { season: Season; team: Team }) {
  if (!season.zone) {
    return (
      <div className="border-t border-hairline px-4 py-2.5 text-[12px] text-ink-muted">
        No contender zone this season: its adjusted net rating is withheld.
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between border-t border-hairline px-4 py-2.5 text-[12.5px]">
      <span className="text-ink-soft">Contender zone</span>
      {team.inZone ? (
        <span className="font-medium text-good">Inside the trapezoid</span>
      ) : (
        <span className="text-ink-muted">Outside the trapezoid</span>
      )}
    </div>
  );
}
