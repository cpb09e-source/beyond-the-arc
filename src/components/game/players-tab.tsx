"use client";

import { useMemo, useState } from "react";
import { TeamLogo } from "@/components/team-logo";
import { cn } from "@/lib/utils";
import type { BoxPlayer, GameBundle, GameSide, Play, TeamStats } from "./types";

/**
 * Full player box, both sides.
 *
 * MIN / PTS / REB / AST is the table everyone has. The two columns after it are
 * the ones that say whether the points were worth what they cost: usage (the
 * share of his team's possessions a player finished) and true shooting (points
 * per possession spent). A 24-point night on 21 shots and a 24-point night on
 * 12 read identically in the first four columns.
 *
 * PLUS-MINUS IS COMPUTED, NOT COPIED. CBBD reports a `netRating`, which is a
 * margin per 100 possessions — a different quantity from the plus-minus a box
 * score means, and printing a rating under a "+/-" heading would misstate the
 * units by a factor of about four. The real figure is derived from the
 * play-by-play instead: every scoring play carries the ten athletes on the
 * floor, so each basket is credited to the five who were actually out there.
 */

type SortKey = "min" | "pts" | "reb" | "ast" | "ts" | "usg" | "pm";

/**
 * athleteId → plus-minus, in HOME terms (home margin gained while on court).
 * The away side negates it.
 *
 * Returns an empty map when the feed carries no on-floor data, which is how
 * the column knows to render an em dash rather than a wrong zero.
 */
function plusMinus(plays: Play[]): Map<number, number> {
  const out = new Map<number, number>();
  let prevH = 0, prevA = 0;
  for (const p of plays) {
    if (!p.sc) continue;
    const swing = (p.hs - prevH) - (p.as - prevA);
    prevH = p.hs; prevA = p.as;
    if (!p.on?.length || swing === 0) continue;
    for (const id of p.on) out.set(id, (out.get(id) ?? 0) + swing);
  }
  return out;
}

export function PlayersTab({ b, hc, ac }: { b: GameBundle; hc: string; ac: string }) {
  const pm = useMemo(() => plusMinus(b.plays), [b.plays]);
  const hasPm = pm.size > 0;
  return (
    <div className="space-y-6">
      <TeamBox side={b.game.away} players={b.players.away} stats={b.teamStats.away}
        color={ac} pm={pm} pmSign={-1} hasPm={hasPm} />
      <TeamBox side={b.game.home} players={b.players.home} stats={b.teamStats.home}
        color={hc} pm={pm} pmSign={1} hasPm={hasPm} />
    </div>
  );
}

function TeamBox({
  side, players, stats, color, pm, pmSign, hasPm,
}: {
  side: GameSide; players: BoxPlayer[]; stats: TeamStats | null; color: string;
  pm: Map<number, number>; pmSign: 1 | -1; hasPm: boolean;
}) {
  const [sort, setSort] = useState<SortKey>("min");

  // A player who appeared but was never on the floor for a scoring play really
  // is 0, so a missing id is only unknown when the whole feed is missing.
  const pmOf = (p: BoxPlayer): number | null =>
    !hasPm ? null : (pm.get(p.athleteId) ?? 0) * pmSign;

  const val = (p: BoxPlayer, k: SortKey): number => {
    switch (k) {
      case "min": return p.minutes ?? -1;
      case "pts": return p.points ?? -1;
      case "reb": return p.rebounds.total ?? -1;
      case "ast": return p.assists ?? -1;
      case "ts": return p.trueShootingPct ?? -1;
      case "usg": return p.usage ?? -1;
      case "pm": return pmOf(p) ?? -999;
    }
  };
  const rows = [...players].sort((a, c) => val(c, sort) - val(a, sort));

  return (
    <section className="rounded-xl border border-hairline bg-card overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-hairline" style={{ background: `${color}12` }}>
        <TeamLogo name={side.team} size={22} />
        <h2 className="font-display text-lg text-ink">{side.team}</h2>
        {stats && (
          <span className="text-[0.65rem] tabular text-ink-muted hidden sm:inline">
            {stats.fieldGoals.made}-{stats.fieldGoals.attempted} FG ·{" "}
            {stats.threePointFieldGoals.made}-{stats.threePointFieldGoals.attempted} 3P ·{" "}
            {stats.freeThrows.made}-{stats.freeThrows.attempted} FT · {stats.possessions} poss
          </span>
        )}
        <span className="ml-auto font-display text-2xl tabular" style={{ color }}>{side.points ?? "—"}</span>
      </div>

      <div className="overflow-x-auto overscroll-x-contain">
        <table className="w-full text-[0.74rem] tabular min-w-[44rem]">
          <thead>
            <tr className="text-[0.52rem] uppercase tracking-[0.08em] text-ink-muted border-b border-hairline">
              <th className="text-left font-bold px-3 py-2 sticky left-0 bg-card">Player</th>
              <Th k="min" sort={sort} on={setSort}>Min</Th>
              <Th k="pts" sort={sort} on={setSort}>Pts</Th>
              <th className="text-right font-bold px-2">FG</th>
              <th className="text-right font-bold px-2">3P</th>
              <th className="text-right font-bold px-2">FT</th>
              <Th k="reb" sort={sort} on={setSort}>Reb</Th>
              <th className="text-right font-bold px-2">Off</th>
              <Th k="ast" sort={sort} on={setSort}>Ast</Th>
              <th className="text-right font-bold px-2">TO</th>
              <th className="text-right font-bold px-2">Stl</th>
              <th className="text-right font-bold px-2">Blk</th>
              <th className="text-right font-bold px-2">PF</th>
              <Th k="usg" sort={sort} on={setSort}>Usg%</Th>
              <Th k="ts" sort={sort} on={setSort}>TS%</Th>
              <Th k="pm" sort={sort} on={setSort}>+/&minus;</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.athleteId} className="border-b border-hairline/60 last:border-b-0 hover:bg-paper-deep/40">
                <td className="px-3 py-1.5 whitespace-nowrap sticky left-0 bg-card">
                  <span className={p.starter ? "text-ink font-medium" : "text-ink-soft"}>{p.name}</span>
                  {p.position && <span className="text-ink-muted/70 ml-1.5 text-[0.58rem]">{p.position}</span>}
                  {p.ejected && <span className="ml-1.5 text-[0.55rem] uppercase tracking-wider font-bold text-bad">ej</span>}
                </td>
                <Td v={p.minutes} muted />
                <Td v={p.points} strong />
                <td className="text-right px-2 text-ink-soft">{p.fieldGoals.made}-{p.fieldGoals.attempted}</td>
                <td className="text-right px-2 text-ink-soft">{p.threePointFieldGoals.made}-{p.threePointFieldGoals.attempted}</td>
                <td className="text-right px-2 text-ink-soft">{p.freeThrows.made}-{p.freeThrows.attempted}</td>
                <Td v={p.rebounds.total} />
                <Td v={p.rebounds.offensive} muted />
                <Td v={p.assists} />
                <Td v={p.turnovers} />
                <Td v={p.steals} />
                <Td v={p.blocks} />
                <Td v={p.fouls} muted />
                <td className="text-right px-2 text-ink-soft">{p.usage === null ? "—" : `${num(p.usage)}%`}</td>
                <Td v={p.trueShootingPct} round />
                <PlusMinus v={pmOf(p)} />
              </tr>
            ))}
          </tbody>
          {stats && (
            <tfoot>
              <tr className="border-t-2 border-ink/15 text-[0.72rem]">
                <td className="px-3 py-2 font-semibold text-ink sticky left-0 bg-card">Team</td>
                <td className="text-right px-2 text-ink-muted">{sumOf(players, (p) => p.minutes)}</td>
                <td className="text-right px-2 font-semibold text-ink">{stats.points.total}</td>
                <td className="text-right px-2 text-ink-soft">{stats.fieldGoals.made}-{stats.fieldGoals.attempted}</td>
                <td className="text-right px-2 text-ink-soft">{stats.threePointFieldGoals.made}-{stats.threePointFieldGoals.attempted}</td>
                <td className="text-right px-2 text-ink-soft">{stats.freeThrows.made}-{stats.freeThrows.attempted}</td>
                <td className="text-right px-2 text-ink-soft">{stats.rebounds.total}</td>
                <td className="text-right px-2 text-ink-muted">{stats.rebounds.offensive}</td>
                <td className="text-right px-2 text-ink-soft">{stats.assists}</td>
                <td className="text-right px-2 text-ink-soft">{stats.turnovers.total}</td>
                <td className="text-right px-2 text-ink-soft">{stats.steals}</td>
                <td className="text-right px-2 text-ink-soft">{stats.blocks}</td>
                <td className="text-right px-2 text-ink-muted">{stats.fouls.total}</td>
                <td className="text-right px-2 text-ink-muted">—</td>
                <td className="text-right px-2 text-ink-muted">{num(stats.trueShooting)}</td>
                <td className="text-right px-2 text-ink-muted">—</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}

function Th({ k, sort, on, children }: { k: SortKey; sort: SortKey; on: (k: SortKey) => void; children: React.ReactNode }) {
  return (
    <th className="text-right font-bold px-2">
      <button type="button" onClick={() => on(k)}
        className={cn("uppercase tracking-[0.08em] hover:text-coral transition-colors", sort === k && "text-coral")}>
        {children}
      </button>
    </th>
  );
}

function Td({ v, strong, muted, round }: { v: number | null; strong?: boolean; muted?: boolean; round?: boolean }) {
  return (
    <td className={cn("text-right px-2", strong ? "font-semibold text-ink" : muted ? "text-ink-muted" : "text-ink-soft")}>
      {round ? num(v) : v ?? "—"}
    </td>
  );
}

/** Zero is neither good nor bad; colouring it green would read as a positive. */
function PlusMinus({ v }: { v: number | null }) {
  return (
    <td className="text-right px-2 font-semibold"
      style={{ color: v === null || v === 0 ? "var(--ink-muted)" : v > 0 ? "var(--good)" : "var(--bad)" }}>
      {v === null ? "—" : v > 0 ? `+${v}` : String(v)}
    </td>
  );
}

function num(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v) ? String(Math.round(v)) : "—";
}

function sumOf(players: BoxPlayer[], pick: (p: BoxPlayer) => number | null): number {
  return players.reduce((s, p) => s + (pick(p) ?? 0), 0);
}
