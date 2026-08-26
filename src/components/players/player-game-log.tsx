"use client";

import { useMemo, useState } from "react";
import { TeamLogo } from "@/components/team-logo";
import { Select } from "@/components/select";
import { PercentileChip } from "@/components/percentile-chip";
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
 * The team and opponent scores are not here either, and that is a choice
 * rather than a gap — they are the GAME's result, not the player's line, and
 * every row already says which way it went in the W/L column. The join that
 * fetched them stays, because the conference split still needs to know who the
 * opponent was.
 *
 * ITS TOTALS CAN DIFFER FROM THE CAREER TABLE'S BY A HAIR, and that is the
 * sources disagreeing rather than a bug here. This table sums the CBBD box
 * archive game by game; the career table reads Bart's season row. Measured on
 * Bradley's 25-26: both say 170 makes, the box archive says 368 attempts and
 * Bart says 367, so 46.2% against 46.3%. Do not "fix" one to match the other —
 * each is internally consistent, and the game log has to add up to its own rows
 * or the totals line is a lie about the table it sits under.
 *
 * THE CHIPS ARE NATIONAL, and only on the shooting rates. Each one ranks that
 * NIGHT against every D-I player-game of the same season and position bucket —
 * the same thing the Player Overview chips do for a season, one level down. A
 * shading of the cell was tried first and does not work at this ramp: its
 * middle bands are near-paper by design, so an average night read as no
 * shading, and a tint says "good" without saying how good. The chip prints the
 * number, stacked under the rate it qualifies rather than beside it — six
 * shooting columns each dragging a chip column behind them doubled the width
 * of the widest group.
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
  /**
   * True when the opponent is in the player's own conference that season.
   * Joined from the team log — see readTeamGameScores. Null where the join
   * missed, which is not the same as false.
   */
  isConf: boolean | null;
};

type Group = "box" | "shooting" | "advanced";
type SplitKey =
  | "all" | "last5" | "last10"
  | "home" | "away" | "neutral" | "awayNeutral"
  | "wins" | "losses" | "conf" | "nonconf";

/**
 * One word each. A native select cannot ellipsize — it clips — and "Traditional
 * boxscore" needs about 140px of text in a box that is 111px wide once two of
 * these share a phone row. The qualifier was carrying nothing anyway: there is
 * one boxscore group and one shooting group, so "traditional" only ever
 * distinguished them from "advanced", which is the third option in the same
 * list.
 */
const GROUPS: Array<{ key: Group; label: string }> = [
  { key: "box", label: "Boxscore" },
  { key: "shooting", label: "Shooting" },
  { key: "advanced", label: "Advanced" },
];

/**
 * Only splits the data can actually answer. Quadrants would need a NET rating
 * per opponent per season and nothing in this corpus carries one; postseason
 * would need a round flag the game log does not have.
 */
const SPLITS: Array<{ key: SplitKey; label: string }> = [
  { key: "all", label: "Full season" },
  { key: "last5", label: "Last 5" },
  { key: "last10", label: "Last 10" },
  { key: "conf", label: "Conference" },
  { key: "nonconf", label: "Non-conference" },
  { key: "home", label: "Home" },
  { key: "away", label: "Away" },
  { key: "neutral", label: "Neutral" },
  { key: "awayNeutral", label: "Away + neutral" },
  { key: "wins", label: "Wins" },
  { key: "losses", label: "Losses" },
];

function fmtInt(x: number | null): string {
  return x === null || x === undefined ? "—" : String(Math.round(x));
}
function fmt1(x: number | null): string {
  return x === null || x === undefined ? "—" : x.toFixed(1);
}
/**
 * Offensive and defensive rating, to the whole point.
 *
 * They are points per 100 possessions over a SINGLE GAME, where the
 * denominator is about seventy possessions — the tenth of a point the source
 * carries is far inside the noise of that estimate, and printing it invites a
 * reader to tell 112.3 from 112.4. Whole numbers in both column groups: the
 * same stat formatted two ways across two tabs reads as a fault.
 */
function fmtRtg(x: number | null): string {
  return x === null || x === undefined ? "—" : String(Math.round(x));
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

type Col = {
  key: string;
  label: string;
  get: (r: GameLogRow) => string;
  /**
   * What the column sorts ON, which is not what it prints. FG% shows "46.3%"
   * and sorts on 0.463; the date shows "4/4" and sorts on the ISO string.
   * Sorting the rendered text would put 9 above 18 and April above January.
   */
  sortVal: (r: GameLogRow) => number | string | null;
  /**
   * Shooting rates only, and they carry the attempts that produced them.
   *
   * The shade is a percentile WITHIN THIS TABLE — this player's other games in
   * the current split — not against a national cohort. There is no per-game
   * cohort anywhere in the data to rank against, and inventing one would be the
   * exact claim the note at the top of this file refuses to make. Ranking a
   * player against himself is a statement the table can actually support: this
   * was one of his better shooting nights.
   *
   * `att` gates it. A one-for-one night is 100% and would shade darker than a
   * 9-for-14, which is noise dressed as a career game.
   */
  shade?: { att: (r: GameLogRow) => number | null };
  wide?: boolean;
};

function colsFor(group: Group): Col[] {
  if (group === "shooting") {
    return [
      // Points lead the shooting group too. Twelve columns of makes and
      // attempts with no total is a table that never says what came of them.
      { key: "pts", label: "PTS", get: (r) => fmtInt(r.pts_scored) , sortVal: (r) => r.pts_scored },
      { key: "fgm", label: "FGM", get: (r) => fmtInt(r.fgm) , sortVal: (r) => r.fgm },
      { key: "fga", label: "FGA", get: (r) => fmtInt(r.fga) , sortVal: (r) => r.fga },
      { key: "fgp", label: "FG%", get: (r) => fmtPct(rate(r.fgm, r.fga)), sortVal: (r) => rate(r.fgm, r.fga), shade: { att: (r) => r.fga }, wide: true },
      // Bart stores threes and totals; twos are the subtraction.
      { key: "2pm", label: "2PM", get: (r) => fmtInt(sub(r.fgm, r.fgm3)) , sortVal: (r) => sub(r.fgm, r.fgm3) },
      { key: "2pa", label: "2PA", get: (r) => fmtInt(sub(r.fga, r.fga3)) , sortVal: (r) => sub(r.fga, r.fga3) },
      { key: "2pp", label: "2P%", get: (r) => fmtPct(rate(sub(r.fgm, r.fgm3), sub(r.fga, r.fga3))), sortVal: (r) => rate(sub(r.fgm, r.fgm3), sub(r.fga, r.fga3)), shade: { att: (r) => sub(r.fga, r.fga3) }, wide: true },
      { key: "3pm", label: "3PM", get: (r) => fmtInt(r.fgm3) , sortVal: (r) => r.fgm3 },
      { key: "3pa", label: "3PA", get: (r) => fmtInt(r.fga3) , sortVal: (r) => r.fga3 },
      { key: "3pp", label: "3P%", get: (r) => fmtPct(rate(r.fgm3, r.fga3)), sortVal: (r) => rate(r.fgm3, r.fga3), shade: { att: (r) => r.fga3 }, wide: true },
      { key: "ftm", label: "FTM", get: (r) => fmtInt(r.ftm) , sortVal: (r) => r.ftm },
      { key: "fta", label: "FTA", get: (r) => fmtInt(r.fta) , sortVal: (r) => r.fta },
      { key: "ftp", label: "FT%", get: (r) => fmtPct(rate(r.ftm, r.fta)), sortVal: (r) => rate(r.ftm, r.fta), shade: { att: (r) => r.fta }, wide: true },
    ];
  }
  if (group === "advanced") {
    return [
      { key: "efg", label: "eFG%", get: (r) => fmtPct(r.efg_pct), sortVal: (r) => r.efg_pct, shade: { att: (r) => r.fga }, wide: true },
      { key: "ts", label: "TS%", get: (r) => fmtPct(r.ts_pct), sortVal: (r) => r.ts_pct, shade: { att: (r) => r.fga }, wide: true },
      { key: "usg", label: "USG%", get: (r) => fmtPct(r.usage_pct), wide: true , sortVal: (r) => r.usage_pct },
      { key: "ortg", label: "ORtg", get: (r) => fmtRtg(r.ortg), wide: true , sortVal: (r) => r.ortg },
      { key: "drtg", label: "DRtg", get: (r) => fmtRtg(r.drtg), wide: true , sortVal: (r) => r.drtg },
      { key: "gmsc", label: "GmSc", get: (r) => fmt1(r.game_score), wide: true , sortVal: (r) => r.game_score },
    ];
  }
  return [
    { key: "pts", label: "PTS", get: (r) => fmtInt(r.pts_scored) , sortVal: (r) => r.pts_scored },
    // The two headline shooting rates sit beside points, not off at the end:
    // they are what turns 13 points into a good or a bad 13, and the reader
    // comparing them is looking at the scoring number when he wants them.
    // Recomputed from makes and attempts rather than read off fg_pct, so this
    // column and the shooting group's can never disagree.
    { key: "fgp", label: "FG%", get: (r) => fmtPct(rate(r.fgm, r.fga)), sortVal: (r) => rate(r.fgm, r.fga), shade: { att: (r) => r.fga }, wide: true },
    { key: "3pp", label: "3P%", get: (r) => fmtPct(rate(r.fgm3, r.fga3)), sortVal: (r) => rate(r.fgm3, r.fga3), shade: { att: (r) => r.fga3 }, wide: true },
    { key: "ast", label: "AST", get: (r) => fmtInt(r.ast) , sortVal: (r) => r.ast },
    { key: "orb", label: "ORB", get: (r) => fmtInt(r.orb) , sortVal: (r) => r.orb },
    { key: "drb", label: "DRB", get: (r) => fmtInt(r.drb) , sortVal: (r) => r.drb },
    { key: "reb", label: "REB", get: (r) => fmtInt(r.reb) , sortVal: (r) => r.reb },
    { key: "stl", label: "STL", get: (r) => fmtInt(r.stl) , sortVal: (r) => r.stl },
    { key: "blk", label: "BLK", get: (r) => fmtInt(r.blk) , sortVal: (r) => r.blk },
    { key: "tov", label: "TOV", get: (r) => fmtInt(r.tov) , sortVal: (r) => r.tov },
    { key: "pf", label: "PF", get: (r) => fmtInt(r.pf) , sortVal: (r) => r.pf },
    // The two ratings ride along with the counting stats as well as with the
    // advanced group. They are the one pair on this table that says whether a
    // line was any good rather than how big it was, and a reader scanning the
    // box should not have to change groups to see it.
    { key: "ortg", label: "ORtg", get: (r) => fmtRtg(r.ortg), wide: true , sortVal: (r) => r.ortg },
    { key: "drtg", label: "DRtg", get: (r) => fmtRtg(r.drtg), wide: true , sortVal: (r) => r.drtg },
  ];
}

/**
 * The four columns left of the group. Declared rather than hardcoded in the
 * markup so they can be sorted on like any other — a reader who wants the
 * season in date order after sorting by points has to be able to click Date.
 */
const FIXED: Array<{ key: string; label: string; align: "left" | "center" | "right"; sortVal: (r: GameLogRow) => number | string | null }> = [
  // The ISO date, not the "4/4" the cell prints: month-first text sorts April
  // above January.
  { key: "date", label: "Date", align: "left", sortVal: (r) => r.game_date },
  // Won sorts above lost, and an unknown result sorts below both.
  { key: "wl", label: "W/L", align: "center", sortVal: (r) => (r.won === true ? 1 : r.won === false ? 0 : null) },
  { key: "opp", label: "Opp", align: "left", sortVal: (r) => r.opp_team_market },
  { key: "min", label: "MIN", align: "right", sortVal: (r) => r.mins },
];

type SortState = { key: string; dir: "asc" | "desc" };

/**
 * Sort, with nulls always last.
 *
 * A player who did not record a rating that night has no ORtg, and floating a
 * run of dashes to the top of a descending sort would bury exactly the games
 * the sort was meant to surface. They sink in both directions instead, which
 * means the order is not a strict reversal — deliberately.
 */
function sortRows(rows: GameLogRow[], sort: SortState, cols: Col[]): GameLogRow[] {
  const fixed = FIXED.find((f) => f.key === sort.key);
  const col = cols.find((c) => c.key === sort.key);
  const val = fixed?.sortVal ?? col?.sortVal;
  if (!val) return rows;
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = val(a), y = val(b);
    if (x === null || x === undefined) return y === null || y === undefined ? 0 : 1;
    if (y === null || y === undefined) return -1;
    if (typeof x === "string" || typeof y === "string") {
      return sign * String(x).localeCompare(String(y));
    }
    return sign * (x - y);
  });
}

function sub(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a - b;
}

/**
 * Where a rate sits on the national ladder for its season and position, 0-100.
 *
 * The ladder is 101 ascending breakpoints, so the index IS the percentile — a
 * scan for the last breakpoint at or below the value gives the answer with no
 * arithmetic. Built by scripts/build-game-percentiles.mjs over every D-I
 * player-game; see that file for why it cannot be computed here.
 */
function nationalPct(ladder: number[] | undefined, v: number | null): number | null {
  if (!ladder || ladder.length === 0 || v === null) return null;
  let lo = 0;
  for (let i = 0; i < ladder.length; i++) {
    if (ladder[i]! <= v) lo = i;
    else break;
  }
  return lo;
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
  ladders,
  minAtt,
}: {
  /** Every logged game the player has, newest first. */
  rows: GameLogRow[];
  playerName: string;
  /**
   * season -> stat -> 101 breakpoints, already narrowed to this player's
   * position bucket on the server. Empty when the season predates the box
   * archive, in which case no chips render.
   */
  ladders: Record<string, Record<string, number[]>>;
  /** Attempts a night needs before it gets a chip. Matches the ladder's own. */
  minAtt: number;
}) {
  const years = useMemo(
    () => [...new Set(rows.map((r) => r.year))].sort((a, b) => b - a),
    [rows],
  );
  const [year, setYear] = useState<number>(years[0] ?? 0);
  const [split, setSplit] = useState<SplitKey>("all");
  const [group, setGroup] = useState<Group>("box");
  // Date descending is the order the rows arrive in and the order a game log
  // is read in, so it is the default rather than a state the reader has to ask
  // for.
  const [sort, setSort] = useState<SortState>({ key: "date", dir: "desc" });

  const seasonRows = useMemo(() => rows.filter((r) => r.year === year), [rows, year]);
  const cols = useMemo(() => colsFor(group), [group]);
  const shown = useMemo(
    () => sortRows(applySplit(seasonRows, split), sort, cols),
    [seasonRows, split, sort, cols],
  );

  /**
   * First click on a new column sorts DESCENDING for a number and ASCENDING
   * for text. Nobody opening a points column wants the two-point nights first,
   * and nobody opening an opponent column wants Xavier first.
   */
  function toggleSort(key: string, numeric: boolean) {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: numeric ? "desc" : "asc" },
    );
  }
  const t = useMemo(() => totalsOf(shown), [shown]);
  const seasonLadder = ladders[String(year)] ?? {};

  if (rows.length === 0) {
    return (
      <div className="px-5 lg:px-7 py-8 text-sm text-ink-muted">
        No game log for {playerName}. The box archive starts in 2013-14 and does not
        cover every season.
      </div>
    );
  }

  return (
    <>
      {/* The heading shares the control band rather than sitting in a tinted
          block above it under an accent strip. See the same note on the career
          card: three horizontal rules of chrome before a single number is the
          thing being fixed. */}
      {/* The three controls. They wrap on a phone rather than scrolling, so no
          control is ever off screen with nothing to say so. */}
      {/* TWO ROWS, HEADING THEN CONTROLS. The heading shared a line with the
          pickers and read as a fourth field beside them; a card title is not a
          control. The season picker stays on the heading's line because it says
          WHICH game log this is, where split and columns only change how the
          same one is shown. */}
      <div className="px-5 lg:px-6 py-4 border-b border-hairline flex flex-col gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="font-display text-xl sm:text-2xl text-ink leading-none tracking-tight whitespace-nowrap">
            Game Log
          </h2>
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
        </div>

        {/* Split and Columns share a row at every width. Below sm the caption
            moves ABOVE its select and each takes half the line — side by side
            with the captions still inline, two selects plus two captions need
            more than a 390px phone has, and the pair would wrap to two rows
            again. From sm there is room for the inline form. */}
        <div className="flex items-end sm:items-center gap-3 min-w-0">
          <label className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 flex-1 sm:flex-none min-w-0">
            <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">Split</span>
            <Select
              value={split}
              onChange={(v) => setSplit(v as SplitKey)}
              ariaLabel="Game split"
              className="field-sm-phone w-full sm:w-auto"
            >
              {SPLITS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </Select>
          </label>
          <label className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 flex-1 sm:flex-none min-w-0">
            <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">Columns</span>
            <Select
              value={group}
              onChange={(v) => setGroup(v as Group)}
              ariaLabel="Column group"
              className="field-sm-phone w-full sm:w-auto"
            >
              {GROUPS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
            </Select>
          </label>
        </div>
      </div>

      <div className="overflow-x-auto [-webkit-overflow-scrolling:touch] overscroll-x-contain">
        <table className="w-full min-w-[42rem] text-sm">
          <thead className="bg-paper-deep/70 text-left">
            <tr>
              {FIXED.map((f) => (
                <Th
                  key={f.key}
                  align={f.align}
                  sort={sort.key === f.key ? sort.dir : null}
                  onSort={() => toggleSort(f.key, f.key === "min" || f.key === "wl")}
                >
                  {f.label}
                </Th>
              ))}
              {cols.map((c) => (
                <Th
                  key={c.key}
                  align="right"
                  sort={sort.key === c.key ? sort.dir : null}
                  onSort={() => toggleSort(c.key, true)}
                >
                  {c.label}
                </Th>
              ))}
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
                <Td title={r.opp_team_market ?? undefined}>
                  <span className="flex items-center gap-2 whitespace-nowrap">
                    {/* @ for away, blank for home, N for neutral — the
                        shorthand every box score in the sport already uses.
                        Capital N: lowercase sat below the @ beside it and read
                        as part of the crest rather than as a marker. */}
                    <span className="text-ink-muted text-xs w-3 shrink-0">
                      {r.is_neutral ? "N" : r.is_home === false ? "@" : ""}
                    </span>
                    {r.opp_team_market && <TeamLogo name={r.opp_team_market} size={18} />}
                    {/* CREST ONLY ON A PHONE. The name is the widest thing in
                        the row and this table already scrolls sideways there,
                        so dropping it buys several stat columns into view.
                        sr-only rather than hidden: the crest is an image, and
                        hiding the text outright would leave a screen reader
                        with only its alt — which TeamLogo does set, but the
                        visible column would then have no accessible name of
                        its own. Absolutely positioned, so it costs the flex row
                        nothing. */}
                    <span className="sr-only sm:not-sr-only text-ink-soft">
                      {r.opp_team_market ?? "—"}
                    </span>
                  </span>
                </Td>
                <Td align="right" className="tabular">{fmtInt(r.mins)}</Td>
                {cols.map((c) => {
                  const att = c.shade ? c.shade.att(r) : null;
                  const v = c.shade ? c.sortVal(r) : null;
                  const pct =
                    c.shade && att !== null && att >= minAtt && typeof v === "number"
                      ? nationalPct(seasonLadder[c.key], v)
                      : null;
                  return (
                    <Td key={c.key} align="right" className="tabular">
                      {/* THE CHIP STACKS UNDER ITS RATE rather than taking a
                          column of its own. Six shooting columns each dragging
                          a second column behind them doubled the width of the
                          widest group, and a chip a whole cell away from the
                          number it qualifies has to be re-associated by eye on
                          every row. Under it, the pair reads as one figure. */}
                      {c.shade ? (
                        <span className="inline-flex flex-col items-end gap-1">
                          <span>{c.get(r)}</span>
                          {/* Desktop only. The chip is a second line in every
                              one of these cells, and on a phone that is thirty
                              rows made half again as tall for a number the
                              table is already too narrow to want. */}
                          <span className="hidden lg:inline-flex h-4">
                            {pct !== null && <PercentileChip pct={pct} />}
                          </span>
                        </span>
                      ) : (
                        c.get(r)
                      )}
                    </Td>
                  );
                })}
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={4 + cols.length} className="px-3 py-6 text-center text-sm text-ink-muted">
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
                {/* Blank. A count here read as though it were an opponent,
                    and the row is already labelled Totals. */}
                <Td />
                <Td align="right" className="tabular">{fmtInt(t.mins)}</Td>
                {/* No chip on the totals row. The ladder ranks a NIGHT, and a
                    season aggregate is not a night — putting it on the same
                    scale would say a 46% season was a median game. */}
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
    // ORtg and DRtg have no makes and attempts to re-divide, and a mean of
    // per-game ratings would weight a four-minute night like a forty-minute
    // one. They fall through to the dash below rather than assert a season
    // figure this table cannot compute.
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
  children, align = "left", sort = null, onSort,
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
  /** The direction this column is sorted, or null when it is not the sort. */
  sort?: "asc" | "desc" | null;
  onSort?: () => void;
}) {
  return (
    <th
      // aria-sort is what tells a screen reader the table is ordered and by
      // which column; the arrow below only tells someone who can see it.
      aria-sort={sort === "asc" ? "ascending" : sort === "desc" ? "descending" : "none"}
      className={cn(
        "px-1.5 sm:px-3 py-2 text-xs uppercase tracking-widest font-medium whitespace-nowrap",
        sort ? "text-ink" : "text-ink-muted",
        align === "right" && "text-right",
        align === "center" && "text-center",
      )}
    >
      <button
        type="button"
        onClick={onSort}
        className={cn(
          "inline-flex items-center gap-1 uppercase tracking-widest hover:text-coral transition-colors",
          align === "right" && "flex-row-reverse",
        )}
      >
        {children}
        {/* The caret holds its space whether or not this is the sorted column,
            so clicking a header never shifts the row of headings sideways. */}
        <span aria-hidden className={cn("text-[0.6em]", sort ? "opacity-100" : "opacity-0")}>
          {sort === "asc" ? "▲" : "▼"}
        </span>
      </button>
    </th>
  );
}

function Td({
  children, align = "left", className = "", title,
}: {
  /** Optional so a spacer cell can be written as <Td />. */
  children?: React.ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
  /** Used by the opponent cell, whose name is crest-only on a phone. */
  title?: string;
}) {
  return (
    <td
      title={title}
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
