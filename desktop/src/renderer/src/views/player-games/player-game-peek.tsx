import { PercentileChip } from "@/components/percentile-chip";
import { TopHundredPill } from "@/components/portal/top-hundred-pill";
import { F, gameStat } from "@/lib/game-index";
import { NO_PCT } from "~/data/midrank-by-value";
import {
  longDate,
  siteOf,
  startedGame,
  statPercentiles,
  statValues,
  wonGame,
  type PlayerGame,
  type PlayerGameSeason,
} from "~/data/player-game-model";
import { seasonLabel } from "~/ui/format";
import { TeamLogo } from "~/ui/logo";
import { Cells, type Read } from "~/ui/peek-cells";
import { ClassBadge, PlayerPhoto } from "~/ui/player-photo";
import { fmtGameStat, NEUTRAL_CHIP, NO_CHIP } from "./player-game-columns";

/**
 * One player's night: who, against whom, the line as it would be read out,
 * the shooting as makes and attempts, and the rate stats.
 *
 * GAME SCORE LEADS, top right, because it is the number the table sorts by and
 * the one a box score argument is usually about.
 */

/** Every stat this Peek reads, so the view can rank them before the first Space. */
export const PEEK_KEYS = [
  "gmsc", "min", "pts", "reb", "ast", "stl", "blk", "tov", "pf",
  "fgm", "fga", "fg_pct", "fg3m", "fg3a", "fg3_pct", "ftm", "fta", "ft_pct",
  "ts", "efg", "usg", "ortg",
];

const SHOTS: Array<[label: string, made: string, att: string, pct: string]> = [
  ["Field goals", "fgm", "fga", "fg_pct"],
  ["Threes", "fg3m", "fg3a", "fg3_pct"],
  ["Free throws", "ftm", "fta", "ft_pct"],
];

export function PlayerGamePeekBody({ season, game }: { season: PlayerGameSeason; game: PlayerGame }) {
  const { pack } = season;
  const p = season.players[game.row[F.p]!]!;
  const o = season.opps[game.row[F.o]!]!;

  const read = (key: string): Read => {
    const st = gameStat(key)!;
    const v = statValues(pack, st)[game.idx]!;
    const pc = NO_CHIP.has(key) ? NO_PCT : statPercentiles(pack, st)[game.idx]!;
    return {
      label: st.label,
      text: fmtGameStat(st, Number.isNaN(v) ? null : v),
      pct: pc === NO_PCT ? null : pc,
      neutral: NEUTRAL_CHIP.has(key),
    };
  };

  const won = wonGame(game.row);
  const site = siteOf(game.row);
  const gmsc = read("gmsc");
  const context = [
    longDate(pack, game.row),
    startedGame(game.row) ? "Started" : "Off the bench",
    site === "neutral" ? "Neutral floor" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <header className="px-4 pb-3 pt-3.5">
        <div className="flex items-start gap-3">
          <PlayerPhoto bartId={p.bartId} hasPhoto={p.hasPhoto} name={p.name} size={46} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <h2 className="truncate text-[16px] font-semibold leading-tight tracking-[-0.01em] text-ink">{p.name}</h2>
              <ClassBadge cls={p.cls} />
              {p.rank > 0 && p.rank <= 100 && (
                <TopHundredPill rank={p.rank} title={`Top 100: #${p.rank} in the country in ${seasonLabel(season.year)}`} />
              )}
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[12px] text-ink-soft">
              <TeamLogo id={p.teamLogoId} name={p.team} size={14} />
              <span className="truncate">{p.team}</span>
              <span className="text-ink-muted">{site === "away" ? "at" : "vs"}</span>
              <TeamLogo id={o.logoId} name={o.name} size={14} />
              <span className="truncate">{o.name}</span>
              <span className={`ml-0.5 font-semibold ${won ? "text-good" : "text-bad"}`}>{won ? "W" : "L"}</span>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="text-[10.5px] text-ink-muted">Game Score</span>
            <span className="text-[20px] font-semibold leading-none text-ink tabular">{gmsc.text}</span>
            <PercentileChip pct={gmsc.pct} className="min-w-[30px] text-[11px]" />
          </div>
        </div>
        <div className="mt-2 truncate text-[12px] text-ink-muted">{context}</div>
      </header>

      <Cells title="The line" cells={["min", "pts", "reb", "ast", "stl", "blk", "tov", "pf"].map(read)} />

      <section className="border-t border-hairline px-4 py-2.5">
        <h3 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-muted">Shooting</h3>
        <ul className="grid gap-[5px]">
          {SHOTS.map(([label, made, att, pct]) => {
            const m = read(made);
            const a = read(att);
            const r = read(pct);
            return (
              <li key={label} className="grid grid-cols-[minmax(0,1fr)_64px_92px] items-center gap-2 text-[12.5px]">
                <span className="truncate text-ink-soft">{label}</span>
                <span className="text-right text-ink tabular">
                  {m.text}–{a.text}
                </span>
                <span className="flex items-center justify-end gap-2">
                  <span className="text-ink-soft tabular">{r.text}</span>
                  <PercentileChip pct={r.pct} className="min-w-[30px] text-[11px]" />
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <Cells title="Efficiency" cells={["ts", "efg", "usg", "ortg"].map(read)} />
    </>
  );
}
