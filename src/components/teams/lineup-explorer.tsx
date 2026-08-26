"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { PercentileChip } from "@/components/percentile-chip";
import { SearchableMultiSelect } from "@/components/explorer/searchable-multi-select";
import { PlayerChips } from "@/components/teams/player-chips";
import {
  LINEUP_STATS,
  LINEUP_VIEWS,
  MIN_POSS,
  statsForView,
  formatStat,
  percentileOf,
  sumTotals,
  type LineupBenchmarks,
  type LineupStat,
  type LineupTotals,
  type LineupView,
} from "@/lib/lineup-stats";

/**
 * The lineup explorer: every combination this team played, filtered by who was
 * on the floor and who was not.
 *
 * ONE OPERATION UNDERNEATH ALL OF IT. Picking a combo size, requiring a player
 * on the court, excluding one from it, and reading the Totals row are the same
 * computation: select the five-man rows that match, sum their counting stats,
 * derive the rates from the sums. That is why the payload holds no percentages
 * and why a 2-man combo is not stored anywhere — it is the sum of every
 * five-man row containing both players, computed here.
 *
 * DNQ IS A STATE, NOT A FILTER. Every unit renders, including the ones with
 * three possessions. Below MIN_POSS a row keeps its numbers and loses its
 * chips, reading DNQ instead: Vermont's qualifying units are under half its
 * possessions, so hiding the rest would silently shrink the season, and a
 * Totals row built from qualified units alone would be wrong rather than
 * merely noisy.
 *
 * CHIPS ARE LEAGUE-SCALED, NOT TEAM-SCALED. A unit's percentile is its place
 * among every qualifying unit in Division I that season, which is the only
 * comparison that means anything: ranked inside a team, the worst of twelve
 * good lineups reads as a disaster. The breakpoints ship with the page and
 * every row goes through the same binary search, so a filtered total and a
 * real lineup are placed identically.
 */

/** Column bands, in render order. Mirrors the stat model's `group`. */
const BANDS: Array<{ key: LineupStat["group"]; label: string; accent?: boolean }> = [
  { key: "volume", label: "Workload" },
  { key: "efficiency", label: "Efficiency", accent: true },
  { key: "four", label: "Four Factors" },
  { key: "opp", label: "Opponent", accent: true },
  { key: "shooting", label: "Shooting" },
  { key: "playmaking", label: "Playmaking", accent: true },
  { key: "defense", label: "Defense" },
];

const COMBO_SIZES = [2, 3, 4, 5] as const;
type ComboSize = (typeof COMBO_SIZES)[number];

export type LineupFile = {
  season: number;
  team: string;
  cols: string[];
  /** `b` is the bart player id, or null when the name did not resolve. */
  players: Array<{ id: number; name: string; b: number | null }>;
  lineups: Array<{ p: number[]; s: number[] }>;
};

type Row = { ids: number[]; totals: LineupTotals };

/** Every k-sized subset of a sorted id list. k is 2-5, so this stays tiny. */
function combinations(ids: number[], k: number): number[][] {
  if (k >= ids.length) return [ids];
  const out: number[][] = [];
  const pick = (start: number, acc: number[]) => {
    if (acc.length === k) { out.push(acc.slice()); return; }
    for (let i = start; i < ids.length; i++) { acc.push(ids[i]!); pick(i + 1, acc); acc.pop(); }
  };
  pick(0, []);
  return out;
}

export function LineupExplorer({
  data,
  benchmarks,
  accentColor,
}: {
  data: LineupFile;
  benchmarks: LineupBenchmarks | null;
  accentColor?: string | null;
}) {
  const [onCourt, setOnCourt] = useState<string[]>([]);
  const [offCourt, setOffCourt] = useState<string[]>([]);
  const [size, setSize] = useState<ComboSize>(5);
  const [view, setView] = useState<LineupView>(LINEUP_VIEWS[0]!);
  const [sortKey, setSortKey] = useState<string>("poss");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  /** The columns this view shows, in its order. */
  const cols = useMemo(() => statsForView(view), [view]);

  /**
   * Band spans for the header, computed from the visible columns rather than
   * the full model. A view that shows two of the four shooting columns must
   * caption two, or the band row and the header row stop lining up.
   */
  const bands = useMemo(() => {
    const out: Array<{ key: LineupStat["group"]; label: string; span: number; accent: boolean }> = [];
    for (const c of cols) {
      const last = out[out.length - 1];
      if (last && last.key === c.group) { last.span++; continue; }
      const meta = BANDS.find((b) => b.key === c.group);
      out.push({ key: c.group, label: meta?.label ?? "", span: 1, accent: !!meta?.accent });
    }
    return out;
  }, [cols]);

  const nameOf = useMemo(
    () => new Map(data.players.map((p) => [p.id, p.name])),
    [data.players],
  );

  /**
   * "G. Yalden" — initial and surname, for every player rather than only where
   * a roster has two of the same surname.
   *
   * Five full names run about sixty characters and the column was taking half
   * the table's width, pushing the stats off the right edge. Adding the initial
   * only on a collision was more compact still, but it made the label format
   * depend on who else happens to be on the roster: the same player read
   * "Yalden" one season and "G. Yalden" the next. One shape everywhere is
   * worth the two characters. The full name stays on each link's title.
   */
  const shortOf = useMemo(() => {
    const out = new Map<number, string>();
    for (const p of data.players) {
      const parts = p.name.trim().split(/\s+/);
      const last = parts.slice(1).join(" ");
      out.set(p.id, last ? `${parts[0]![0]}. ${last}` : p.name.trim());
    }
    return out;
  }, [data.players]);

  /** CBBD id -> bart id, for linking a name to its player page. */
  const bartOf = useMemo(
    () => new Map(data.players.map((p) => [p.id, p.b])),
    [data.players],
  );

  /** Unpack the flat `s` array once, against the file's own column order. */
  const base = useMemo(() => {
    const idx = data.cols;
    return data.lineups.map((l) => {
      const t = {} as Record<string, number>;
      for (let i = 0; i < idx.length; i++) t[idx[i]!] = l.s[i] ?? 0;
      return { ids: l.p, totals: t as unknown as LineupTotals };
    });
  }, [data]);

  const onIds = useMemo(() => new Set(onCourt.map(Number)), [onCourt]);
  const offIds = useMemo(() => new Set(offCourt.map(Number)), [offCourt]);

  /**
   * The five-man rows that satisfy the on/off filter. Everything else — the
   * combo table and the Totals row — is built from this, so the two can never
   * disagree about what is being shown.
   */
  const matching = useMemo(
    () => base.filter((r) =>
      [...onIds].every((id) => r.ids.includes(id)) &&
      ![...offIds].some((id) => r.ids.includes(id))
    ),
    [base, onIds, offIds],
  );

  /**
   * Rows at the requested combo size.
   *
   * At five this is the matching lineups themselves. Below five each lineup
   * contributes every k-subset of its players, and subsets that appear in more
   * than one lineup accumulate — which is the whole point: a 2-man combo's
   * numbers are every possession those two shared, however the other three
   * spots were filled.
   *
   * A required on-court player is forced into every subset. Without that, a
   * 2-man table filtered to "Hurley on" would list pairs that exclude Hurley,
   * each carrying his minutes but not his name.
   */
  const rows = useMemo<Row[]>(() => {
    if (size === 5) return matching;
    const acc = new Map<string, Row>();
    for (const r of matching) {
      const forced = r.ids.filter((id) => onIds.has(id));
      const free = r.ids.filter((id) => !onIds.has(id));
      if (forced.length > size) continue;
      for (const rest of combinations(free, size - forced.length)) {
        const ids = [...forced, ...rest].sort((a, b) => a - b);
        const key = ids.join("|");
        const hit = acc.get(key);
        if (hit) hit.totals = sumTotals([hit.totals, r.totals]);
        else acc.set(key, { ids, totals: r.totals });
      }
    }
    return [...acc.values()];
  }, [matching, size, onIds]);

  /**
   * TOTALS COME FROM `matching`, NEVER FROM THE VISIBLE ROWS.
   *
   * Two independent reasons, either one sufficient. Rows below the possession
   * floor are hidden but their possessions still happened, so a total built
   * from what is on screen would quietly under-report the season. And below
   * five, one possession belongs to several overlapping subsets — summing the
   * visible combos would multiply it.
   */
  const totals = useMemo(() => sumTotals(matching.map((r) => r.totals)), [matching]);

  /**
   * Rows are hidden below the possession floor rather than shown greyed.
   *
   * Vermont has 226 five-man units and 13 that clear 30 possessions; the other
   * 213 are a handful of possessions each and mostly noise. They still count —
   * see the Totals note above — they are just not worth a row.
   */
  const visible = useMemo(() => rows.filter((r) => r.totals.poss >= MIN_POSS), [rows]);

  const sorted = useMemo(() => {
    const stat = LINEUP_STATS.find((s) => s.key === sortKey);
    const dir = sortDir === "asc" ? 1 : -1;
    return [...visible].sort((a, b) => {
      const av = stat ? stat.value(a.totals) : null;
      const bv = stat ? stat.value(b.totals) : null;
      // Nulls sink both ways: a unit with no attempts is not the best or the
      // worst at a shooting rate, it is absent from the question.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av - bv) * dir;
    });
  }, [visible, sortKey, sortDir]);

  const options = useMemo(
    () => data.players.map((p) => ({ value: String(p.id), label: p.name })),
    [data.players],
  );

  function toggleSort(k: string, defaultDir: "asc" | "desc") {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(defaultDir); }
  }

  const accent = accentColor ?? undefined;

  return (
    <div>
      {/* ---- controls. A bar, not a sidebar: three inputs do not earn a
              column, and the table is the thing being read. */}
      <div className="border border-hairline rounded-xl bg-paper-deep/25 p-4 lg:p-5">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-4 lg:gap-5 items-start">
          <Field label="On the court">
            <SearchableMultiSelect
              value={onCourt}
              options={options}
              onChange={setOnCourt}
              placeholder="Search players…"
              // The trigger states the action rather than the current value.
              // "Anyone" is accurate but reads as a filter already set to a
              // permissive value; this reads as a control you have not used
              // yet, which is what an empty selection means.
              emptyLabel="Select On-Court Players"
              ariaLabel="Players required on the court"
              inlineSearch
              disabledValues={offIds.size ? new Set(offCourt) : undefined}
            />
            <PlayerChips ids={onCourt} nameOf={nameOf} onRemove={(v) => setOnCourt(onCourt.filter((x) => x !== v))} accent={accent} />
          </Field>

          <Field label="Off the court">
            <SearchableMultiSelect
              value={offCourt}
              options={options}
              onChange={setOffCourt}
              placeholder="Search players…"
              emptyLabel="Select Off-Court Players"
              ariaLabel="Players required off the court"
              inlineSearch
              disabledValues={onIds.size ? new Set(onCourt) : undefined}
            />
            <PlayerChips ids={offCourt} nameOf={nameOf} onRemove={(v) => setOffCourt(offCourt.filter((x) => x !== v))} accent={accent} />
          </Field>

          {/* Segmented, not a select. Four fixed options that the reader
              switches between constantly; a dropdown would hide three of them
              behind a click and give no sense of where you are. */}
          <Field label="Combo size">
            <div className="inline-flex h-10 rounded-md border border-ink/15 bg-card overflow-hidden shadow-sm">
              {COMBO_SIZES.map((n) => {
                const active = n === size;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setSize(n)}
                    aria-pressed={active}
                    className={cn(
                      "w-11 text-sm tabular font-medium border-r border-ink/10 last:border-r-0 transition-colors",
                      active ? "text-white" : "text-ink-muted hover:text-ink hover:bg-paper-deep/60",
                    )}
                    style={active ? { backgroundColor: accent ?? "var(--color-coral)" } : undefined}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
          </Field>
        </div>
      </div>

      {/* ---- column views. Pills, not the underline the page tabs use: this
              switches what the table shows, the strip above switches the page,
              and two identical-looking strips a few hundred pixels apart would
              read as one navigation with an arbitrary split.

              It sits attached to the table rather than in the control bar
              above because it changes the table's shape, not the set of rows
              in it. The controls answer "which units"; this answers "which
              numbers about them". */}
      <div className="mt-6 flex items-center gap-2 overflow-x-auto overscroll-x-contain px-4 lg:px-0 pb-1">
        <span className="text-xs uppercase tracking-widest text-ink-muted font-medium shrink-0 mr-1">
          Columns
        </span>
        {LINEUP_VIEWS.map((v) => {
          const active = v.key === view.key;
          return (
            <button
              key={v.key}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={active}
              className={cn(
                "shrink-0 px-3 py-1.5 rounded-md text-sm font-medium border transition-colors",
                active
                  ? "text-white border-transparent"
                  : "text-ink-muted border-ink/15 bg-card hover:text-ink hover:border-ink/30",
              )}
              style={active ? { backgroundColor: accent ?? "var(--color-coral)" } : undefined}
            >
              {v.label}
            </button>
          );
        })}
      </div>

      {/* ---- table */}
      <div className="mt-3 border-y border-x-0 lg:border-x border-hairline rounded-none lg:rounded-xl shadow-sm overflow-hidden bg-paper-deep/25 -mx-4 lg:mx-0">
        {visible.length === 0 ? (
          <p className="px-5 lg:px-7 py-12 text-sm text-ink-muted max-w-2xl leading-relaxed">
            {rows.length === 0
              ? `No ${size}-player combination matches that filter. ${
                  onCourt.length > 0 && offCourt.length > 0
                    ? "Try removing a player from one of the two lists."
                    : "Try a different player."
                }`
              : `${rows.length.toLocaleString()} ${size}-player ${rows.length === 1 ? "combination" : "combinations"} match, but none reached ${MIN_POSS} possessions together. The Totals above still cover all of them.`}
          </p>
        ) : (
          // overscroll-x-contain ONLY. `none` also suppresses the vertical
          // rubber-band, and overflow-x:auto makes this a scroll container in
          // both axes, so `none` would stop the page scrolling from any finger
          // that lands on the table. Documented at the other grids too.
          <div className="overflow-x-auto overscroll-x-contain">
            <table className="w-full text-sm border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="sticky left-0 z-30 bg-paper-deep h-6 p-0 border-r border-hairline" />
                  {bands.map((b, bi) => {
                    return (
                      <th
                        key={`${b.key}-${bi}`}
                        colSpan={b.span}
                        className={cn(
                          "bg-paper-deep h-6 p-0 px-2 text-[0.58rem] uppercase tracking-[0.15em] font-semibold text-center border-l border-hairline align-middle",
                          b.accent ? "text-coral" : "text-ink-muted",
                        )}
                        style={b.accent && accent ? { color: accent } : undefined}
                      >
                        {b.label}
                      </th>
                    );
                  })}
                </tr>
                <tr>
                  <th className="sticky left-0 z-30 bg-paper-deep border-b border-r border-hairline px-2 sm:px-3 py-3 sm:py-2 text-xs uppercase tracking-wide sm:tracking-widest text-ink-muted font-medium text-left align-middle">
                    {size === 5 ? "Lineup" : `${size}-man`}
                  </th>
                  {cols.map((s, i) => (
                    <StatTh
                      key={s.key}
                      stat={s}
                      active={sortKey === s.key}
                      dir={sortDir}
                      onClick={() => toggleSort(s.key, s.lowerBetter ? "asc" : "desc")}
                      bandStart={i === 0 || cols[i - 1]!.group !== s.group}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* Totals first, and always from the five-man matches rather
                    than the combo rows: at sizes below five the same
                    possession is counted in several subsets, so summing the
                    visible rows would multiply the season. */}
                <StatRow
                  label={<span className="font-semibold text-ink">Totals</span>}
                  cols={cols}
                  totals={totals}
                  benchmarks={benchmarks}
                  accent={accent}
                  emphasis
                />
                {sorted.map((r) => (
                  <StatRow
                    key={r.ids.join("|")}
                    label={<LineupNames ids={r.ids} shortOf={shortOf} nameOf={nameOf} bartOf={bartOf} />}
                    cols={cols}
                    totals={r.totals}
                    benchmarks={benchmarks}
                    accent={accent}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="mt-3 px-4 lg:px-0 text-xs text-ink-muted leading-relaxed">
        Only combinations that played at least <span className="tabular">{MIN_POSS}</span>{" "}
        possessions together are listed. Percentiles rank each row against every Division I
        five-man unit that cleared the same floor in {data.season - 1}-
        {String(data.season).slice(-2)}
        {benchmarks ? <> ({benchmarks.n.toLocaleString()} of them)</> : null}. +/-, GP, POSS,
        MINS and Pace are unranked: they scale with playing time, so a combination and a single
        lineup are not comparable on them.
      </p>
    </div>
  );
}

/**
 * A lineup's players, each linking to its own page.
 *
 * Unresolved names render as plain text rather than a dead link. About 2% of
 * D-I players do not resolve to a bart id, and effectively all of a non-D-I
 * opponent's roster does not — those have no player page to point at.
 *
 * The separator sits outside the links so a click cannot land on it, and it is
 * marked aria-hidden: read aloud, "Hurley middot Long" is worse than the pause
 * the surrounding elements already imply.
 */
function LineupNames({
  ids, shortOf, nameOf, bartOf,
}: {
  ids: number[];
  shortOf: Map<number, string>;
  nameOf: Map<number, string>;
  bartOf: Map<number, number | null>;
}) {
  return (
    <span className="text-ink">
      {ids.map((id, i) => {
        const short = shortOf.get(id) ?? `#${id}`;
        const full = nameOf.get(id) ?? short;
        const bart = bartOf.get(id);
        return (
          <span key={id}>
            {i > 0 && <span aria-hidden className="text-ink-muted/60"> · </span>}
            {bart != null ? (
              <Link
                href={`/players/${bart}/`}
                prefetch={false}
                title={full}
                // Colour shift only, no underline — the same treatment the
                // roster table one tab over gives a player link. Five links to
                // a cell and thirteen cells to a screen, an underline on each
                // turns the column into a ruled block on hover.
                className="hover:text-coral transition-colors"
              >
                {short}
              </Link>
            ) : (
              <span title={full}>{short}</span>
            )}
          </span>
        );
      })}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-ink-muted font-medium mb-1.5">{label}</div>
      {children}
    </div>
  );
}

function StatTh({
  stat, active, dir, onClick, bandStart,
}: {
  stat: LineupStat;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  bandStart: boolean;
}) {
  return (
    <th
      title={stat.title}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn(
        "bg-paper-deep border-b border-hairline p-0 text-xs uppercase tracking-wide sm:tracking-widest font-medium text-right align-middle whitespace-nowrap select-none cursor-pointer hover:bg-paper-deep/60 transition-colors",
        active ? "text-ink" : "text-ink-muted",
        bandStart && "border-l border-hairline",
      )}
    >
      {/* Padding on the button, not the cell: on the <th> the button's
          w-full/h-full fills only the content box and the tappable area is the
          text alone. `uppercase` is repeated because Preflight resets
          text-transform on button. Both documented in season-grid.tsx. */}
      <button type="button" onClick={onClick} className="block w-full h-full uppercase px-1.5 sm:px-2 py-3 sm:py-2 text-right">
        <span className="inline-flex items-center gap-1 justify-end">
          {stat.label}
          {active ? (
            <span className="text-coral text-[0.65rem] leading-none">{dir === "asc" ? "↑" : "↓"}</span>
          ) : (
            <span className="text-ink-muted/50 text-[0.6rem] leading-none tracking-tighter" aria-hidden>↑↓</span>
          )}
        </span>
      </button>
    </th>
  );
}

function StatRow({
  label, cols, totals, benchmarks, accent, emphasis = false,
}: {
  label: React.ReactNode;
  /** The active view's columns, so every row matches the header exactly. */
  cols: LineupStat[];
  totals: LineupTotals;
  benchmarks: LineupBenchmarks | null;
  accent?: string;
  emphasis?: boolean;
}) {
  const qualified = totals.poss >= MIN_POSS;
  const bg = emphasis ? "" : "bg-paper odd:bg-card";
  // OPAQUE, mixed against the card surface rather than laid over it at 8%
  // alpha. This cell is sticky: a translucent fill lets the stat columns scroll
  // visibly through it, so POSS and MINS smeared across the lineup name as soon
  // as the table was scrolled right. Same trap the explorer's honour cells hit
  // — see the note in explorer-client.tsx.
  const rowStyle = emphasis
    ? { backgroundColor: `color-mix(in oklab, ${accent ?? "var(--color-coral)"} 10%, var(--card))` }
    : undefined;
  return (
    <tr
      className={cn("group transition-colors", bg)}
      style={rowStyle}
    >
      <td
        style={rowStyle}
        className={cn(
          // WRAPPED AND CAPPED BELOW sm. Five names joined by separators is
          // ~620px of unbreakable text, and this cell is sticky, so on a 390px
          // phone the frozen column was wider than the screen: scrolling right
          // moved the stats behind a name list that never moved, and not one
          // stat column was ever visible. Capping the column and letting it
          // wrap costs row height and buys back the entire rest of the table.
          // 42vw leaves ~226px for stats, which is three columns and their
          // percentile chips.
          "sticky left-0 z-20 px-2 sm:px-3 py-1.5 border-r border-hairline transition-colors",
          // Tighter type below sm too: five wrapped names at the table's
          // normal size and leading made a 152px row, so an 80svh window held
          // four of them. This brings it back under control without touching
          // the desktop cell.
          "max-w-[42vw] whitespace-normal text-[0.72rem] leading-[1.15] sm:max-w-none sm:whitespace-nowrap sm:text-inherit sm:leading-normal",
          !emphasis && "bg-paper group-odd:bg-card",
          emphasis && "border-b border-hairline",
        )}
      >
        {label}
      </td>
      {cols.map((s, i) => {
        const v = s.value(totals);
        const pct = qualified ? percentileOf(s, v, benchmarks) : null;
        const bandStart = i === 0 || cols[i - 1]!.group !== s.group;
        return (
          <td
            key={s.key}
            className={cn(
              // px-1.5 rather than px-2: at thirteen columns those 4px each
              // put the default Four Factors view 9px over its shell, which
              // bought a horizontal scrollbar for nothing.
              "px-1 sm:px-1.5 py-1.5 text-right tabular whitespace-nowrap transition-colors",
              bandStart && "border-l border-hairline",
              emphasis && "border-b border-hairline",
            )}
          >
            <span className="inline-flex flex-col items-end gap-0.5 leading-tight">
              <span className={cn(s.key === "net" && "font-semibold text-ink")}>
                {formatStat(v, s.format)}
              </span>
              {s.ranked && (
                pct !== null ? (
                  <PercentileChip pct={pct} />
                ) : (
                  // The row is real; it is just too small to place. Saying so
                  // beats an empty cell, which reads as missing data.
                  <span className="text-[0.6rem] uppercase tracking-wider text-ink-muted/60">
                    {qualified ? "—" : "DNQ"}
                  </span>
                )
              )}
            </span>
          </td>
        );
      })}
    </tr>
  );
}
