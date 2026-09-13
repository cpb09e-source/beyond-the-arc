import { useMemo, useState } from "react";
import type { BoxPlayer, GameBundle, GameSide, TeamStats } from "@/components/game/types";
import { playerPlusMinus, plusMinus, sortBoxPlayers, type BoxSortKey } from "@/lib/game-stats";
import { TeamLogo } from "~/ui/logo";
import { PlayerPhoto } from "~/ui/player-photo";
import { hasPhoto, sideOf, type TeamNames } from "~/views/scoreboard/board-model";
import type { Links } from "./game-model";
import { NameLink } from "./game-parts";

/**
 * The full box, away then home.
 *
 * MIN, PTS, REB, AST is the table everyone has; usage and true shooting beside it
 * say what the points cost. PLUS-MINUS IS WORKED OUT from the play by play, each
 * scoring play credited to the ten players on the floor (src/lib/game-stats.ts),
 * and is a dash for a feed that never recorded who was on.
 *
 * Starters in ink, the bench a step back. A name opens its profile when the
 * season's index knows who it is. Both teams' headers wear the same quiet wash,
 * like everything else on the game page: no school's color.
 */
export function GameBox({ b, names, links }: { b: GameBundle; names: TeamNames | null; links: Links }) {
  const pm = useMemo(() => plusMinus(b.plays), [b.plays]);
  return (
    <div className="flex flex-col gap-6">
      <TeamBox side={b.game.away} players={b.players.away} stats={b.teamStats.away} pm={pm} sign={-1} names={names} links={links} />
      <TeamBox side={b.game.home} players={b.players.home} stats={b.teamStats.home} pm={pm} sign={1} names={names} links={links} />
    </div>
  );
}

type Col = { key: string; label: string; sort?: BoxSortKey; title?: string };

const COLS: Col[] = [
  { key: "min", label: "Min", sort: "min", title: "Minutes" },
  { key: "pts", label: "Pts", sort: "pts", title: "Points" },
  { key: "fg", label: "FG", title: "Field goals made-attempted" },
  { key: "3p", label: "3P", title: "Threes made-attempted" },
  { key: "ft", label: "FT", title: "Free throws made-attempted" },
  { key: "reb", label: "Reb", sort: "reb", title: "Rebounds" },
  { key: "orb", label: "Off", title: "Offensive rebounds" },
  { key: "ast", label: "Ast", sort: "ast", title: "Assists" },
  { key: "to", label: "TO", title: "Turnovers" },
  { key: "stl", label: "Stl", title: "Steals" },
  { key: "blk", label: "Blk", title: "Blocks" },
  { key: "pf", label: "PF", title: "Personal fouls" },
  { key: "usg", label: "Usg%", sort: "usg", title: "Share of the team's possessions he used" },
  { key: "ts", label: "TS%", sort: "ts", title: "True shooting: points per shooting possession" },
  { key: "pm", label: "+/−", sort: "pm", title: "Margin while he was on the floor, from the play by play" },
];

const round = (v: number | null | undefined): string => (typeof v === "number" && Number.isFinite(v) ? String(Math.round(v)) : "–");

function TeamBox({
  side,
  players,
  stats,
  pm,
  sign,
  names,
  links,
}: {
  side: GameSide;
  players: BoxPlayer[];
  stats: TeamStats | null;
  pm: Map<number, number>;
  sign: 1 | -1;
  names: TeamNames | null;
  links: Links;
}) {
  const [sort, setSort] = useState<BoxSortKey>("min");
  const rows = sortBoxPlayers(players, sort, pm, sign);
  const s = sideOf(names, side.team);

  return (
    <section className="overflow-hidden rounded-lg border border-hairline bg-card">
      <header className="flex h-[46px] items-center gap-2.5 border-b border-hairline bg-[color-mix(in_oklab,var(--ink)_4%,var(--card))] px-3.5">
        <TeamLogo id={s.logoId} name={side.team} size={22} />
        <NameLink text={side.team} open={links.team(side.team)} className="truncate text-[14px] font-semibold text-ink" />
        <span className="shrink-0 text-[12px] text-ink-muted">{players.length} players</span>
        <span className={`ml-auto text-[22px] font-semibold tabular ${side.winner === false ? "text-ink-muted" : "text-ink"}`}>{side.points ?? "–"}</span>
      </header>

      {players.length === 0 ? (
        <p className="px-3.5 py-6 text-[12.5px] text-ink-muted">No player lines for {side.team} in this box score.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-[12.5px]">
            <thead>
              <tr className="h-[32px] border-b border-hairline text-[11px] text-ink-muted">
                <th className="sticky left-0 z-[1] bg-card pl-3.5 text-left font-medium">Player</th>
                {COLS.map((c) => (
                  <th key={c.key} title={c.title} className="px-2 text-right font-medium">
                    {c.sort ? (
                      <button
                        type="button"
                        aria-pressed={sort === c.sort}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => setSort(c.sort!)}
                        className={`transition-colors hover:text-ink ${sort === c.sort ? "font-semibold text-ink" : ""}`}
                      >
                        {c.label}
                        {sort === c.sort ? " ↓" : ""}
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                ))}
                <th className="w-3.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const who = links.player(p.name);
                const plus = playerPlusMinus(p, pm, sign);
                return (
                  <tr key={p.athleteId} className="group h-[38px] border-b border-hairline/60 last:border-b-0 hover:bg-[var(--row-hover)]">
                    <td className="sticky left-0 z-[1] bg-card pl-3.5 group-hover:bg-[var(--row-hover)]">
                      <span className="flex min-w-[220px] items-center gap-2.5">
                        <PlayerPhoto bartId={who?.bartId ?? null} hasPhoto={hasPhoto(who?.bartId ?? null)} name={p.name} size={24} />
                        <NameLink text={p.name} open={who?.open} className={`truncate ${p.starter ? "font-medium text-ink" : "text-ink-soft"}`} />
                        {p.position && <span className="shrink-0 text-[11px] text-ink-muted">{p.position}</span>}
                        {p.ejected && <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.05em] text-bad">Ejected</span>}
                      </span>
                    </td>
                    <Cell v={round(p.minutes)} tone="muted" />
                    <Cell v={round(p.points)} tone="strong" />
                    <Cell v={`${p.fieldGoals.made}-${p.fieldGoals.attempted}`} />
                    <Cell v={`${p.threePointFieldGoals.made}-${p.threePointFieldGoals.attempted}`} />
                    <Cell v={`${p.freeThrows.made}-${p.freeThrows.attempted}`} />
                    <Cell v={round(p.rebounds.total)} tone="strong" />
                    <Cell v={round(p.rebounds.offensive)} tone="muted" />
                    <Cell v={round(p.assists)} tone="strong" />
                    <Cell v={round(p.turnovers)} />
                    <Cell v={round(p.steals)} />
                    <Cell v={round(p.blocks)} />
                    <Cell v={round(p.fouls)} tone="muted" />
                    <Cell v={p.usage == null ? "–" : `${round(p.usage)}%`} />
                    <Cell v={round(p.trueShootingPct)} />
                    <td
                      className="px-2 text-right font-medium tabular"
                      style={{ color: plus == null || plus === 0 ? "var(--ink-muted)" : plus > 0 ? "var(--good)" : "var(--bad)" }}
                    >
                      {plus == null ? "–" : plus > 0 ? `+${plus}` : String(plus)}
                    </td>
                    <td />
                  </tr>
                );
              })}
            </tbody>
            {stats && (
              <tfoot>
                <tr className="h-[38px] border-t border-hairline bg-[color-mix(in_oklab,var(--ink)_3%,var(--card))]">
                  <td className="sticky left-0 z-[1] bg-[color-mix(in_oklab,var(--ink)_3%,var(--card))] pl-3.5 font-medium text-ink">Team</td>
                  <Cell v={round(players.reduce((n, p) => n + (p.minutes ?? 0), 0))} tone="muted" />
                  <Cell v={String(stats.points.total)} tone="strong" />
                  <Cell v={`${stats.fieldGoals.made}-${stats.fieldGoals.attempted}`} />
                  <Cell v={`${stats.threePointFieldGoals.made}-${stats.threePointFieldGoals.attempted}`} />
                  <Cell v={`${stats.freeThrows.made}-${stats.freeThrows.attempted}`} />
                  <Cell v={String(stats.rebounds.total)} tone="strong" />
                  <Cell v={String(stats.rebounds.offensive)} tone="muted" />
                  <Cell v={String(stats.assists)} tone="strong" />
                  <Cell v={String(stats.turnovers.total)} />
                  <Cell v={String(stats.steals)} />
                  <Cell v={String(stats.blocks)} />
                  <Cell v={String(stats.fouls.total)} tone="muted" />
                  <Cell v="–" tone="muted" />
                  <Cell v={round(stats.trueShooting)} tone="muted" />
                  <Cell v="–" tone="muted" />
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </section>
  );
}

function Cell({ v, tone = "normal" }: { v: string; tone?: "strong" | "muted" | "normal" }) {
  return (
    <td className={`px-2 text-right tabular ${tone === "strong" ? "font-medium text-ink" : tone === "muted" ? "text-ink-muted" : "text-ink-soft"}`}>{v}</td>
  );
}
