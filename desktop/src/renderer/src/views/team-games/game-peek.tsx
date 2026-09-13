import { PercentileChip } from "@/components/percentile-chip";
import { seasonPercentiles, teamGameStat } from "@/lib/team-game-index";
import { longDate, type TeamGame, type TeamGameSeason } from "~/data/team-game-model";
import { TeamLogo } from "~/ui/logo";
import { Cells, type Read } from "~/ui/peek-cells";
import { fmtStat, NEUTRAL_PCT } from "./game-columns";

/**
 * A game at a glance: who, where, the result, and how it was won or lost.
 *
 * EVERY CHIP IS AGAINST EVERY GAME OF THE SEASON, the cohort of the table beside
 * it and of the site's game log, so a 95 here is a 95 there.
 *
 * THE FOUR FACTORS SIT OFFENSE AGAINST DEFENSE, because that is how they are
 * read: most games are explained by one line of that little table.
 */

const FACTORS: Array<[label: string, off: string, def: string]> = [
  ["eFG%", "efg", "efgd"],
  ["TOV%", "tovr", "tovd"],
  ["ORB%", "orbr", "orbd"],
  ["FT rate", "ftr", "ftrd"],
];

const BOX = [
  ["REB", "reb"],
  ["AST", "ast"],
  ["STL", "stl"],
  ["BLK", "blk"],
  ["TOV", "tov"],
] as const;

export function GamePeekBody({ season, game }: { season: TeamGameSeason; game: TeamGame }) {
  const read = (key: string): Read => {
    const st = teamGameStat(key)!;
    return {
      label: st.label,
      text: fmtStat(st, st.get(game.row)),
      pct: st.pct === false ? null : (seasonPercentiles(season.pack, st).get(game.idx) ?? null),
      neutral: NEUTRAL_PCT.has(key),
    };
  };

  const kind = game.tourney
    ? "NCAA tournament"
    : game.post
      ? "Postseason"
      : game.conference
        ? "Conference game"
        : "Non-conference";
  const context = [longDate(season, game), kind, game.site === "neutral" ? "Neutral floor" : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <header className="px-4 pb-3 pt-3.5">
        <div className="flex items-center gap-3">
          <TeamLogo id={game.teamLogoId} name={game.team} size={30} />
          <div className="min-w-0 flex-1">
            <h2 className="flex min-w-0 items-baseline gap-1.5 text-[16px] font-semibold leading-tight tracking-[-0.01em] text-ink">
              {game.ap > 0 && <span className="text-[12px] font-medium text-ink-muted tabular">{game.ap}</span>}
              <span className="truncate">{game.team}</span>
            </h2>
            <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[12px] text-ink-soft">
              <span className="text-ink-muted">{game.site === "away" ? "at" : "vs"}</span>
              <TeamLogo id={game.oppLogoId} name={game.opp} size={14} />
              {game.oppAp > 0 && <span className="text-ink-muted tabular">{game.oppAp}</span>}
              <span className="truncate">{game.opp}</span>
            </div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[20px] font-semibold leading-none tabular">
              <span className={game.won ? "text-good" : "text-bad"}>{game.won ? "W" : "L"}</span>{" "}
              <span className="text-ink">
                {game.pts}–{game.pa}
              </span>
            </div>
            {game.ot && (
              <div className="mt-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Overtime</div>
            )}
          </div>
        </div>
        <div className="mt-2 truncate text-[12px] text-ink-muted">{context}</div>
      </header>

      <Cells title="Efficiency" cells={["net", "ortg", "drtg", "pace"].map(read)} />

      <section className="border-t border-hairline px-4 py-2.5">
        <div className="mb-1.5 grid grid-cols-[minmax(0,1fr)_96px_96px] items-baseline gap-2">
          <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-muted">Four factors</h3>
          <span className="text-right text-[10.5px] text-ink-muted">Offense</span>
          <span className="text-right text-[10.5px] text-ink-muted">Defense</span>
        </div>
        <ul className="grid gap-[5px]">
          {FACTORS.map(([label, off, def]) => (
            <li key={label} className="grid grid-cols-[minmax(0,1fr)_96px_96px] items-center gap-2 text-[12.5px]">
              <span className="truncate text-ink-soft">{label}</span>
              <Pair r={read(off)} />
              <Pair r={read(def)} />
            </li>
          ))}
        </ul>
      </section>

      <Cells title="Shooting" cells={["fg_pct", "fg3_pct", "ft_pct", "ts"].map(read)} />

      <div className="flex items-center gap-4 border-t border-hairline px-4 py-2.5 text-[12px] text-ink-muted">
        {BOX.map(([label, key]) => (
          <span key={key} className="tabular">
            <span className="text-ink">{read(key).text}</span> {label}
          </span>
        ))}
      </div>
    </>
  );
}

function Pair({ r }: { r: Read }) {
  return (
    <span className="flex items-center justify-end gap-2">
      <span className="text-ink tabular">{r.text}</span>
      <PercentileChip pct={r.pct} neutral={r.neutral} className="min-w-[30px] text-[11px]" />
    </span>
  );
}
