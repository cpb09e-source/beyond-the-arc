"use client";

import { useMemo, useState } from "react";
import { TeamLogo } from "@/components/team-logo";
import { Select } from "@/components/select";
import { cn } from "@/lib/utils";

/**
 * Game log — one row per game, with the columns grouped the way a box score is
 * read rather than all thirty at once.
 *
 * THREE CONTROLS, THREE DIFFERENT JOBS. Season picks the year. Split picks
 * which games. Columns picks which numbers. They compose, and the row count
 * under the heading always states what survived the split, because a table
 * showing eleven of thirty-one games with no note is a table that looks wrong.
 *
 * WHAT IS NOT HERE, AND WHY. No plus-minus column and no Quad 1/2/3 splits: the
 * player box carries neither, and there is no NET quadrant anywhere in the
 * data. Both are omitted rather than approximated — a +/- reconstructed from
 * team scores would be wrong for every player who did not play the whole game,
 * which is every player.
 *
 * The percentile heat-map shading a commercial box score puts behind these
 * numbers is deliberately absent. It ranks a player against a cohort, and this
 * table is one player against himself across a season; the same 39% would be
 * green in one cohort and red in another, which is a claim the table has no
 * business making.
 */

export type GameLogRow = {
  year: number;
  game_date: string | null;
  opp_team_market: string | null;
  is_home: boolean | null;
  is_neutral: boolean | null;
  won: boolean | null;
  is_starter: boolean | null;
  mins: number | null;
  pts_scored: number | null;
  fgm: number | null; fga: number | null;
  fgm3: number | null; fga3: number | null;
  ftm: number | null; fta: number | null;
  reb: number | null; orb: number | null; drb: number | null;
  ast: number | null; stl: number | null; blk: number | null;
  tov: number | null; pf: number | null;
  efg_pct: number | null; ts_pct: number | null; usage_pct: number | null;
  ortg: number | null; drtg: number | null; game_score: number | null;
  /** Joined from the team log — see readTeamGameScores. Null where unmatched. */
  tm: number | null;
  op: number | null;
  /** True when the opponent is in the player's own conference that season. */
  isConf: boolean | null;
};

type Group = "box" | "shooting" | "advanced";
type SplitKey =
  | "all" | "last5" | "last10"
  | "home" | "away" | "neutral" | "awayNeutral"
  | "wins" | "losses" | "conf" | "nonconf";

const GROUPS: Array<{ key: Group; label: string }> = [
  { key: "box", label: "Traditional boxscore" },
  { key: "shooting", label: "Traditional shooting" },
  { key: "advanced", label: "Advanced boxscore" },
];

/**
 * Only splits the data can actually answer. Quadrants would need a NET rating
 * per opponent per season and nothing in this corpus carries one; postseason
 * would need a round flag the game log does not have.
 */
const SPLITS: Array<{ key: SplitKey; label: string }> = [
  { key: "all", label: "Full season" },
  { key: "last5", label: "Last 5 games" },
  { key: "last10", label: "Last 10 games" },
  { key: "conf", label: "Conference games" },
  { key: "nonconf", label: "Non-conference" },
  { key: "home", label: "Home games" },
  { key: "away", label: "Away games" },
  { key: "neutral", label: "Neutral games" },
  { key: "awayNeutral", label: "Away + neutral" },
  { key: "wins", label: "Games won" },
  { key: "losses", label: "Games lost" },
];

function fmtInt(x: number | null): string {
  return x === null || x === undefined ? "—" : String(Math.round(x));
}
function fmt1(x: number | null): string {
  return x === null || x === undefined ? "—" : x.toFixed(1);
}
/** Rates arrive as 0..1 decimals; every percentage on this table is one. */
function fmtPct(x: number | null): string {
  return x === null || x === undefined ? "—" : `${(x * 100).toFixed(1)}%`;
}
/** Made over attempted, for the columns the source does not pre-compute. */
function rate(made: number | null, att: number | null): number | null {
  if (made === null || att === null || att === 0) return null;
  return made / att;
}
function shortDate(iso: string | null): string {
  if (!iso) return "—";
  const [, m, d] = iso.split("-");
  return m && d ? `${Number(m)}/${Number(d)}` : iso;
}

type Col = { key: string; label: string; get: (r: GameLogRow) => string; wide?: boolean };

function colsFor(group: Group): Col[] {
  if (group === "shooting") {
    return [
      { key: "fgm", label: "FGM", get: (r) => fmtInt(r.fgm) },
      { key: "fga", label: "FGA", get: (r) => fmtInt(r.fga) },
      { key: "fgp", label: "FG%", get: (r) => fmtPct(rate(r.fgm, r.fga)), wide: true },
      // Bart stores threes and totals; twos are the subtraction.
      { key: "2pm", label: "2PM", get: (r) => fmtInt(sub(r.fgm, r.fgm3)) },
      { key: "2pa", label: "2PA", get: (r) => fmtInt(sub(r.fga, r.fga3)) },
      { key: "2pp", label: "2P%", get: (r) => fmtPct(rate(sub(r.fgm, r.fgm3), sub(r.fga, r.fga3))), wide: true },
      { key: "3pm", label: "3PM", get: (r) => fmtInt(r.fgm3) },
      { key: "3pa", label: "3PA", get: (r) => fmtInt(r.fga3) },
      { key: "3pp", label: "3P%", get: (r) => fmtPct(rate(r.fgm3, r.fga3)), wide: true },
      { key: "ftm", label: "FTM", get: (r) => fmtInt(r.ftm) },
      { key: "fta", label: "FTA", get: (r) => fmtInt(r.fta) },
      { key: "ftp", label: "FT%", get: (r) => fmtPct(rate(r.ftm, r.fta)), wide: true },
    ];
  }
  if (group === "advanced") {
    return [
      { key: "efg", label: "eFG%", get: (r) => fmtPct(r.efg_pct), wide: true },
      { key: "ts", label: "TS%", get: (r) => fmtPct(r.ts_pct), wide: true },
      { key: "usg", label: "USG%", get: (r) => fmtPct(r.usage_pct), wide: true },
      { key: "ortg", label: "ORtg", get: (r) => fmt1(r.ortg), wide: true },
      { key: "drtg", label: "DRtg", get: (r) => fmt1(r.drtg), wide: true },
      { key: "gmsc", label: "GmSc", get: (r) => fmt1(r.game_score), wide: true },
    ];
  }
  return [
    { key: "pts", label: "PTS", get: (r) => fmtInt(r.pts_scored) },
    { key: "ast", label: "AST", get: (r) => fmtInt(r.ast) },
    { key: "orb", label: "ORB", get: (r) => fmtInt(r.orb) },
    { key: "drb", label: "DRB", get: (r) => fmtInt(r.drb) },
    { key: "reb", label: "REB", get: (r) => fmtInt(r.reb) },
    { key: "stl", label: "STL", get: (r) => fmtInt(r.stl) },
    { key: "blk", label: "BLK", get: (r) => fmtInt(r.blk) },
    { key: "tov", label: "TOV", get: (r) => fmtInt(r.tov) },
    { key: "pf", label: "PF", get: (r) => fmtInt(r.pf) },
  ];
}

function sub(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a - b;
}

function applySplit(rows: GameLogRow[], split: SplitKey): GameLogRow[] {
  // Rows arrive newest first, which is the order the table shows. "Last 5"
  // therefore takes from the FRONT, not the back.
  switch (split) {
    case "last5": return rows.slice(0, 5);
    case "last10": return rows.slice(0, 10);
    case "home": return rows.filter((r) => r.is_home === true && r.is_neutral !== true);
    case "away": return rows.filter((r) => r.is_home === false && r.is_neutral !== true);
    case "neutral": return rows.filter((r) => r.is_neutral === true);
    case "awayNeutral": return rows.filter((r) => r.is_neutral === true || r.is_home === false);
    case "wins": return rows.filter((r) => r.won === true);
    case "losses": return rows.filter((r) => r.won === false);
    case "conf": return rows.filter((r) => r.isConf === true);
    case "nonconf": return rows.filter((r) => r.isConf === false);
    default: return rows;
  }
}

/** The totals line. Counts sum; rates are totals over totals, never a mean. */
function totalsOf(rows: GameLogRow[]) {
  const sum = (f: (r: GameLogRow) => number | null) =>
    rows.reduce((n, r) => n + (f(r) ?? 0), 0);
  const n = rows.length;
  return {
    n,
    mins: sum((r) => r.mins), pts: sum((r) => r.pts_scored),
    fgm: sum((r) => r.fgm), fga: sum((r) => r.fga),
    fgm3: sum((r) => r.fgm3), fga3: sum((r) => r.fga3),
    ftm: sum((r) => r.ftm), fta: sum((r) => r.fta),
    reb: sum((r) => r.reb), orb: sum((r) => r.orb), drb: sum((r) => r.drb),
    ast: sum((r) => r.ast), stl: sum((r) => r.stl), blk: sum((r) => r.blk),
    tov: sum((r) => r.tov), pf: sum((r) => r.pf),
  };
}

function seasonLabel(y: number): string {
  return `${(y - 1).toString().slice(-2)}-${y.toString().slice(-2)}`;
}

export function PlayerGameLog({
  rows,
  playerName,
}: {
  /** Every logged game the player has, newest first. */
  rows: GameLogRow[];
  playerName: string;
}) {
  const years = useMemo(
    () => [...new Set(rows.map((r) => r.year))].sort((a, b) => b - a),
    [rows],
  );
  const [year, setYear] = useState<number>(years[0] ?? 0);
  const [split, setSplit] = useState<SplitKey>("all");
  const [group, setGroup] = useState<Group>("box");

  const seasonRows = useMemo(() => rows.filter((r) => r.year === year), [rows, year]);
  const shown = useMemo(() => applySplit(seasonRows, split), [seasonRows, split]);
  const cols = useMemo(() => colsFor(group), [group]);
  const t = useMemo(() => totalsOf(shown), [shown]);

  if (rows.length === 0) {
    return (
      <div className="px-5 lg:px-7 py-8 text-sm text-ink-muted">
        No game log for {playerName}. The box archive starts in 2013-14 and does not
        cover every season.
      </div>
    );
  }

  const splitLabel = SPLITS.find((s) => s.key === split)?.label ?? "";

  return (
    <>
      <div className="px-5 lg:px-7 py-5 lg:py-6 border-b border-hairline bg-paper-deep/30">
        {/* Desktop only, matching the other two cards on this page. */}
        <div className="hidden sm:flex text-[0.6rem] uppercase tracking-[0.18em] text-coral font-bold mb-1.5 items-center gap-2">
          <span className="h-px w-6 bg-coral" />
          Game by game
        </div>
        <h2 className="font-display text-3xl lg:text-4xl text-ink leading-none tracking-tight">
          Game Log
        </h2>
      </div>

      {/* The three controls. They wrap on a phone rather than scrolling, so no
          control is ever off screen with nothing to say so. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 lg:px-6 py-3 border-b border-hairline bg-paper/50">
        {years.length > 1 && (
          <label className="flex items-center gap-2">
            <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">Season</span>
            <Select
              value={String(year)}
              onChange={(v) => setYear(Number(v))}
              ariaLabel="Season"
              className="field-sm-phone"
            >
              {years.map((y) => <option key={y} value={y}>{seasonLabel(y)}</option>)}
            </Select>
          </label>
        )}
        <label className="flex items-center gap-2">
          <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">Split</span>
          <Select value={split} onChange={(v) => setSplit(v as SplitKey)} ariaLabel="Game split" className="field-sm-phone">
            {SPLITS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </Select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">Columns</span>
          <Select value={group} onChange={(v) => setGroup(v as Group)} ariaLabel="Column group" className="field-sm-phone">
            {GROUPS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
          </Select>
        </label>
        {/* Always states what the split left, because eleven rows where there
            were thirty-one reads as a fault otherwise. */}
        <span className="text-xs text-ink-muted ml-auto whitespace-nowrap">
          <span className="tabular text-ink font-semibold">{shown.length}</span>
          {shown.length === 1 ? " game" : " games"}
          {split !== "all" && <span className="hidden sm:inline"> · {splitLabel.toLowerCase()}</span>}
        </span>
      </div>

      <div className="overflow-x-auto [-webkit-overflow-scrolling:touch] overscroll-x-contain">
        <table className="w-full min-w-[42rem] text-sm">
          <thead className="bg-paper-deep/70 text-left">
            <tr>
              <Th>Date</Th>
              <Th align="center">W/L</Th>
              <Th>Opp</Th>
              <Th align="right">Tm</Th>
              <Th align="right">Op</Th>
              <Th align="right">MIN</Th>
              {cols.map((c) => <Th key={c.key} align="right">{c.label}</Th>)}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr
                key={`${r.game_date}-${r.opp_team_market}-${i}`}
                className={cn("transition-colors hover:bg-coral/[0.06]", i % 2 === 0 ? "bg-paper/70" : "bg-transparent")}
              >
                <Td className="tabular whitespace-nowrap text-ink-soft">{shortDate(r.game_date)}</Td>
                <Td align="center">
                  <span
                    className="font-semibold text-xs"
                    style={{ color: r.won === true ? "var(--good)" : r.won === false ? "var(--bad)" : "var(--ink-muted)" }}
                  >
                    {r.won === true ? "W" : r.won === false ? "L" : "—"}
                  </span>
                </Td>
                <Td>
                  <span className="flex items-center gap-2 whitespace-nowrap">
                    {/* @ for away, blank for home, n for neutral — the shorthand
                        every box score in the sport already uses. */}
                    <span className="text-ink-muted text-xs w-3 shrink-0">
                      {r.is_neutral ? "n" : r.is_home === false ? "@" : ""}
                    </span>
                    {r.opp_team_market && <TeamLogo name={r.opp_team_market} size={18} />}
                    <span className="text-ink-soft">{r.opp_team_market ?? "—"}</span>
                  </span>
                </Td>
                <Td align="right" className="tabular">{fmtInt(r.tm)}</Td>
                <Td align="right" className="tabular">{fmtInt(r.op)}</Td>
                <Td align="right" className="tabular">{fmtInt(r.mins)}</Td>
                {cols.map((c) => (
                  <Td key={c.key} align="right" className="tabular">{c.get(r)}</Td>
                ))}
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={6 + cols.length} className="px-3 py-6 text-center text-sm text-ink-muted">
                  No games in this split.
                </td>
              </tr>
            )}
          </tbody>
          {shown.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-ink/15 bg-paper-deep/40 font-medium">
                <Td className="font-semibold text-ink">Totals</Td>
                <Td align="center" className="text-ink-muted">—</Td>
                <Td className="text-ink-muted">{t.n} {t.n === 1 ? "game" : "games"}</Td>
                <Td align="right" className="text-ink-muted">—</Td>
                <Td align="right" className="text-ink-muted">—</Td>
                <Td align="right" className="tabular">{fmtInt(t.mins)}</Td>
                {cols.map((c) => (
                  <Td key={c.key} align="right" className="tabular">{totalFor(c.key, t)}</Td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}

/**
 * The totals cell for a column.
 *
 * Counting columns sum. Rate columns are recomputed from the summed makes and
 * attempts — never averaged across games, which would weight a 1-for-1 night
 * the same as a 9-for-18 one. The advanced rates have no makes-and-attempts to
 * sum, so they show a dash rather than a mean that would misstate them.
 */
function totalFor(key: string, t: ReturnType<typeof totalsOf>): string {
  switch (key) {
    case "pts": return fmtInt(t.pts);
    case "ast": return fmtInt(t.ast);
    case "orb": return fmtInt(t.orb);
    case "drb": return fmtInt(t.drb);
    case "reb": return fmtInt(t.reb);
    case "stl": return fmtInt(t.stl);
    case "blk": return fmtInt(t.blk);
    case "tov": return fmtInt(t.tov);
    case "pf": return fmtInt(t.pf);
    case "fgm": return fmtInt(t.fgm);
    case "fga": return fmtInt(t.fga);
    case "fgp": return fmtPct(rate(t.fgm, t.fga));
    case "2pm": return fmtInt(t.fgm - t.fgm3);
    case "2pa": return fmtInt(t.fga - t.fga3);
    case "2pp": return fmtPct(rate(t.fgm - t.fgm3, t.fga - t.fga3));
    case "3pm": return fmtInt(t.fgm3);
    case "3pa": return fmtInt(t.fga3);
    case "3pp": return fmtPct(rate(t.fgm3, t.fga3));
    case "ftm": return fmtInt(t.ftm);
    case "fta": return fmtInt(t.fta);
    case "ftp": return fmtPct(rate(t.ftm, t.fta));
    default: return "—";
  }
}

function Th({
  children, align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
}) {
  return (
    <th
      className={cn(
        "px-1.5 sm:px-3 py-2 text-xs uppercase tracking-widest text-ink-muted font-medium whitespace-nowrap",
        align === "right" && "text-right",
        align === "center" && "text-center",
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children, align = "left", className = "",
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
}) {
  return (
    <td
      className={cn(
        "px-1.5 sm:px-3 py-2.5",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className,
      )}
    >
      {children}
    </td>
  );
}
