"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { PercentileChip } from "@/components/percentile-chip";
import {
  LINEUP_VIEWS,
  ON_OFF_MIN_POSS,
  formatDiff,
  formatStat,
  percentileOf,
  statsForView,
  sumTotals,
  type LineupBenchmarks,
  type LineupStat,
  type LineupTotals,
  type LineupView,
} from "@/lib/lineup-stats";
import type { LineupFile } from "@/components/teams/lineup-explorer";

/**
 * On/Off: what the team does with each player on the floor against off it.
 *
 * NO NEW DATA. This is the lineup file read a different way — ON is every
 * five-man unit containing the player, OFF is every unit without him, both
 * summed as counts and then divided. The same operation the Lineups tab runs
 * for its filters, asked once per player instead of once per filter.
 *
 * THREE MODES OVER ONE TABLE. On, Off and Diff are the same columns showing
 * different numbers, rather than three columns per stat. Every stat tripled
 * would put four of them on a screen; a reader comparing rebounding with and
 * without a player can click twice instead of scrolling past twenty columns
 * they did not ask for.
 *
 * DIFFS RANK AGAINST DIFFS. A +7 net rating is a good lineup; a +7 net on/off
 * swing is an enormous one. The season file carries a second distribution
 * built from every qualifying player in D-I for exactly this, so a swing is
 * placed among swings — see `qd` in lineup-stats.
 *
 * WHAT THIS MEASURES, AND DOES NOT. An on/off split is not a rating of the
 * player. It is the team's performance with him and without him, which also
 * carries whoever replaced him, whoever he played alongside, and who the
 * opponent had on the floor at the time. It is evidence, not a verdict, and
 * the note under the table says so.
 */

type Mode = "on" | "off" | "diff";

const MODES: Array<{ key: Mode; label: string }> = [
  { key: "on", label: "On court" },
  { key: "off", label: "Off court" },
  { key: "diff", label: "Difference" },
];

type Row = {
  id: number;
  name: string;
  bart: number | null;
  on: LineupTotals;
  off: LineupTotals;
};

export function OnOffExplorer({
  data,
  benchmarks,
  accentColor,
}: {
  data: LineupFile;
  benchmarks: LineupBenchmarks | null;
  accentColor?: string | null;
}) {
  const [mode, setMode] = useState<Mode>("diff");
  const [view, setView] = useState<LineupView>(LINEUP_VIEWS[0]!);
  const [sortKey, setSortKey] = useState<string>("net");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const accent = accentColor ?? undefined;

  /**
   * Volume columns are dropped from every view here. POSS and MINS are pinned
   * into the lineup views as sample size, and this table already carries
   * sample size as its own two identity columns — one for each side of the
   * split, which is the number that actually matters when reading an on/off.
   */
  const cols = useMemo(
    () => statsForView(view).filter((s) => s.group !== "volume"),
    [view],
  );

  const bands = useMemo(() => {
    const out: Array<{ key: LineupStat["group"]; label: string; span: number; accent: boolean }> = [];
    const LABEL: Record<string, [string, boolean]> = {
      efficiency: ["Efficiency", true], four: ["Four Factors", false],
      opp: ["Opponent", true], shooting: ["Shooting", false],
      playmaking: ["Playmaking", true], defense: ["Defense", false],
    };
    for (const c of cols) {
      const last = out[out.length - 1];
      if (last && last.key === c.group) { last.span++; continue; }
      const [label, isAccent] = LABEL[c.group] ?? ["", false];
      out.push({ key: c.group, label, span: 1, accent: isAccent });
    }
    return out;
  }, [cols]);

  const { rows, hidden } = useMemo(() => {
    const idx = data.cols;
    const lineups = data.lineups.map((l) => {
      const t = {} as Record<string, number>;
      for (let i = 0; i < idx.length; i++) t[idx[i]!] = l.s[i] ?? 0;
      return { ids: l.p, totals: t as unknown as LineupTotals };
    });
    const out: Row[] = [];
    let skipped = 0;
    for (const p of data.players) {
      const on = sumTotals(lineups.filter((l) => l.ids.includes(p.id)).map((l) => l.totals));
      const off = sumTotals(lineups.filter((l) => !l.ids.includes(p.id)).map((l) => l.totals));
      // Both sides, not either: a starter who never sits has no off-court
      // sample, and his "difference" would be the team against nothing.
      if (on.poss < ON_OFF_MIN_POSS || off.poss < ON_OFF_MIN_POSS) { skipped++; continue; }
      out.push({ id: p.id, name: p.name, bart: p.b, on, off });
    }
    return { rows: out, hidden: skipped };
  }, [data]);

  // useCallback so the sort memo can depend on it honestly. Left as a plain
  // function it was recreated every render, and the memo either lied about its
  // dependencies or re-sorted on every keystroke elsewhere on the page.
  const valueOf = useCallback((r: Row, stat: LineupStat): number | null => {
    if (mode === "on") return stat.value(r.on);
    if (mode === "off") return stat.value(r.off);
    const a = stat.value(r.on), b = stat.value(r.off);
    return a === null || b === null ? null : a - b;
  }, [mode]);

  const sorted = useMemo(() => {
    const stat = cols.find((s) => s.key === sortKey) ?? cols[0];
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sortKey === "onPoss") return (a.on.poss - b.on.poss) * dir;
      if (sortKey === "offPoss") return (a.off.poss - b.off.poss) * dir;
      if (sortKey === "name") return a.name.localeCompare(b.name) * dir;
      if (!stat) return 0;
      const av = valueOf(a, stat), bv = valueOf(b, stat);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av - bv) * dir;
    });
  }, [rows, sortKey, sortDir, cols, valueOf]);

  function toggleSort(k: string, defaultDir: "asc" | "desc") {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(defaultDir); }
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-ink-muted leading-relaxed max-w-2xl">
        No player reached {ON_OFF_MIN_POSS} possessions both on and off the floor this
        season. An on/off split needs a real sample on each side; with a short rotation
        or a heavily-used starter there may not be one.
      </p>
    );
  }

  return (
    <div>
      {/* Two controls, two rows, different jobs: the first says which numbers
          you are reading, the second which columns they fill. Kept apart
          rather than merged into one strip because switching mode changes
          every value in the table and switching view changes none of them. */}
      <div className="flex flex-wrap items-center gap-2 px-4 lg:px-0">
        <span className="text-xs uppercase tracking-widest text-ink-muted font-medium shrink-0 mr-1">
          Showing
        </span>
        {MODES.map((m) => {
          const active = m.key === mode;
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => setMode(m.key)}
              aria-pressed={active}
              className={cn(
                "shrink-0 px-3 py-1.5 rounded-md text-sm font-medium border transition-colors",
                active ? "text-white border-transparent" : "text-ink-muted border-ink/15 bg-card hover:text-ink hover:border-ink/30",
              )}
              style={active ? { backgroundColor: accent ?? "var(--color-coral)" } : undefined}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 px-4 lg:px-0">
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
                active ? "text-white border-transparent" : "text-ink-muted border-ink/15 bg-card hover:text-ink hover:border-ink/30",
              )}
              style={active ? { backgroundColor: accent ?? "var(--color-coral)" } : undefined}
            >
              {v.label}
            </button>
          );
        })}
      </div>

      <div className="mt-4 border-y border-x-0 lg:border-x border-hairline rounded-none lg:rounded-xl shadow-sm overflow-hidden bg-paper-deep/25 -mx-4 lg:mx-0">
        {/* overscroll-x-contain ONLY — `none` also kills the vertical
            rubber-band and this box scrolls in both axes. Documented at the
            other grids. */}
        <div className="overflow-x-auto overscroll-x-contain">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky left-0 z-30 bg-paper-deep h-6 p-0 border-r border-hairline" />
                <th colSpan={2} className="bg-paper-deep h-6 p-0 px-2 text-[0.58rem] uppercase tracking-[0.15em] font-semibold text-ink-muted text-center align-middle">
                  Possessions
                </th>
                {bands.map((b, bi) => (
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
                ))}
              </tr>
              <tr>
                <Th sticky label="Player" align="left" active={sortKey === "name"} dir={sortDir} onClick={() => toggleSort("name", "asc")} />
                <Th label="On" align="right" title="Possessions with this player on the floor" active={sortKey === "onPoss"} dir={sortDir} onClick={() => toggleSort("onPoss", "desc")} />
                <Th label="Off" align="right" title="Possessions with this player off the floor" active={sortKey === "offPoss"} dir={sortDir} onClick={() => toggleSort("offPoss", "desc")} />
                {cols.map((s, i) => (
                  <Th
                    key={s.key}
                    label={s.label}
                    align="right"
                    title={s.title}
                    active={sortKey === s.key}
                    dir={sortDir}
                    onClick={() => toggleSort(s.key, s.lowerBetter && mode !== "diff" ? "asc" : "desc")}
                    bandStart={i === 0 || cols[i - 1]!.group !== s.group}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} className="group transition-colors bg-paper odd:bg-card">
                  <td className="sticky left-0 z-20 px-2 sm:px-3 py-1.5 border-r border-hairline whitespace-nowrap transition-colors bg-paper group-odd:bg-card">
                    {r.bart != null ? (
                      <Link href={`/players/${r.bart}/`} prefetch={false} className="text-ink hover:text-coral transition-colors">
                        {r.name}
                      </Link>
                    ) : (
                      <span className="text-ink">{r.name}</span>
                    )}
                  </td>
                  <td className="px-2 sm:px-3 py-1.5 text-right tabular text-ink-soft whitespace-nowrap">
                    {Math.round(r.on.poss).toLocaleString()}
                  </td>
                  <td className="px-2 sm:px-3 py-1.5 text-right tabular text-ink-muted whitespace-nowrap">
                    {Math.round(r.off.poss).toLocaleString()}
                  </td>
                  {cols.map((s, i) => {
                    const v = valueOf(r, s);
                    const pct = percentileOf(s, v, benchmarks, mode === "diff" ? "diff" : "value");
                    return (
                      <td
                        key={s.key}
                        className={cn(
                          "px-1 sm:px-1.5 py-1.5 text-right tabular whitespace-nowrap transition-colors",
                          (i === 0 || cols[i - 1]!.group !== s.group) && "border-l border-hairline",
                        )}
                      >
                        <span className="inline-flex flex-col items-end gap-0.5 leading-tight">
                          <span className={cn(s.key === "net" && "font-semibold text-ink")}>
                            {mode === "diff" ? formatDiff(v, s.format) : formatStat(v, s.format)}
                          </span>
                          {pct !== null ? <PercentileChip pct={pct} /> : (
                            <span className="text-[0.6rem] uppercase tracking-wider text-ink-muted/60">—</span>
                          )}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-3 px-4 lg:px-0 text-xs text-ink-muted leading-relaxed max-w-4xl">
        Players need <span className="tabular">{ON_OFF_MIN_POSS}</span> possessions both on
        and off the floor to appear
        {hidden > 0 && <> ({hidden} did not)</>}. In Difference, percentage columns are shown
        as points of difference and each row is ranked against every qualifying player in
        Division I
        {benchmarks?.nd ? <> ({benchmarks.nd.toLocaleString()} of them)</> : null}; in On and
        Off they are ranked against D-I five-man units.
        {" "}
        <span className="text-ink-soft">
          An on/off split is not a rating of the player. It is what the team did with him and
          without him, which also carries whoever replaced him, whoever he played alongside,
          and who the opponent had on the floor.
        </span>
      </p>
    </div>
  );
}

function Th({
  label, align = "right", title, active, dir, onClick, sticky = false, bandStart = false,
}: {
  label: string;
  align?: "left" | "right";
  title?: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  sticky?: boolean;
  bandStart?: boolean;
}) {
  return (
    <th
      title={title ?? label}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn(
        "bg-paper-deep border-b border-hairline p-0 text-xs uppercase tracking-wide sm:tracking-widest font-medium align-middle whitespace-nowrap select-none cursor-pointer hover:bg-paper-deep/60 transition-colors",
        align === "right" ? "text-right" : "text-left",
        active ? "text-ink" : "text-ink-muted",
        sticky && "sticky left-0 z-30 border-r",
        bandStart && "border-l border-hairline",
      )}
    >
      {/* Padding on the button and `uppercase` repeated: Preflight resets
          text-transform on button, and on the <th> the button's w-full/h-full
          fills only the content box. Both documented in season-grid.tsx. */}
      <button type="button" onClick={onClick} className={cn("block w-full h-full uppercase px-1.5 sm:px-2 py-3 sm:py-2", align === "right" ? "text-right" : "text-left")}>
        <span className={cn("inline-flex items-center gap-1", align === "right" ? "justify-end" : "justify-start")}>
          {label}
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
