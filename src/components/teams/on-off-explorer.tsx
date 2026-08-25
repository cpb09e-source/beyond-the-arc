"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { PercentileChip } from "@/components/percentile-chip";
import { SearchableMultiSelect } from "@/components/explorer/searchable-multi-select";
import { PlayerChips } from "@/components/teams/player-chips";
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
 * THREE STACKED TABLES, not three columns per stat. Difference first, then
 * On-Court, then Off-Court, each the same columns over the same players.
 * Tripling every column would put four stats on a screen; stacking keeps every
 * column full width and puts the comparison a scroll away rather than a click.
 *
 * ONE COLUMN CONTROL FOR ALL THREE. They are the same table asked three ways,
 * so letting them fall out of step — Four Factors above, Shooting below —
 * would break the only thing that makes them comparable.
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

const SECTIONS: Array<{ key: Mode; title: string; blurb: string }> = [
  {
    key: "diff",
    title: "ON/OFF Difference",
    blurb: "How the team's numbers change with each player on the floor. Ranked against every qualifying player in Division I.",
  },
  {
    key: "on",
    title: "Player ON",
    blurb: "What the team did while each player was on the floor.",
  },
  {
    key: "off",
    title: "Player OFF",
    blurb: "What the team did while each player sat.",
  },
];

/** Share of the team's possessions this player was on the floor for. */
const share = (r: Row): number => (r.on.poss + r.off.poss > 0 ? r.on.poss / (r.on.poss + r.off.poss) : 0);

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
  const [view, setView] = useState<LineupView>(LINEUP_VIEWS[0]!);
  const [picked, setPicked] = useState<string[]>([]);
  // Sorting is shared across the three tables and carries which one was
  // clicked: sorting the Difference table by Net Rtg reorders On-Court and
  // Off-Court to match, so a player stays on the same line in all three. Three
  // independent orders would make them impossible to read against each other,
  // which is the entire reason they are stacked.
  const [sort, setSort] = useState<{ key: string; mode: Mode; dir: "asc" | "desc" }>({
    // On-court possessions, descending: the rotation in the order it actually
    // played. Opening on a stat instead put whoever had the largest swing on
    // top, which on a table where sample size decides whether a swing means
    // anything is the wrong thing to lead with.
    key: "onPoss", mode: "diff", dir: "desc",
  });

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

  const { rows } = useMemo(() => {
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
  const valueOf = useCallback((r: Row, stat: LineupStat, m: Mode): number | null => {
    if (m === "on") return stat.value(r.on);
    if (m === "off") return stat.value(r.off);
    const a = stat.value(r.on), b = stat.value(r.off);
    return a === null || b === null ? null : a - b;
  }, []);

  const sorted = useMemo(() => {
    const stat = cols.find((s) => s.key === sort.key);
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sort.key === "onPoss") return (a.on.poss - b.on.poss) * dir;
      if (sort.key === "offPoss") return (a.off.poss - b.off.poss) * dir;
      if (sort.key === "share") return (share(a) - share(b)) * dir;
      if (sort.key === "name") return a.name.localeCompare(b.name) * dir;
      if (!stat) return 0;
      const av = valueOf(a, stat, sort.mode), bv = valueOf(b, stat, sort.mode);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av - bv) * dir;
    });
  }, [rows, sort, cols, valueOf]);

  /**
   * Options are the players who actually have a row, not the whole roster.
   * Offering someone below the possession floor would let a reader pick a name
   * and get an empty table, with nothing to say why.
   */
  const options = useMemo(
    () => rows.map((r) => ({ value: String(r.id), label: r.name }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [rows],
  );
  const nameOf = useMemo(() => new Map(rows.map((r) => [r.id, r.name])), [rows]);

  const shown = useMemo(() => {
    if (picked.length === 0) return sorted;
    const keep = new Set(picked.map(Number));
    return sorted.filter((r) => keep.has(r.id));
  }, [sorted, picked]);

  function toggleSort(key: string, mode: Mode, defaultDir: "asc" | "desc") {
    setSort((s) =>
      s.key === key && s.mode === mode
        ? { key, mode, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, mode, dir: defaultDir },
    );
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
      {/* Player picker, same control the Lineups tab uses: type in the field
          itself, chips underneath for what is chosen. Empty means everyone,
          which is the useful default here — the question is usually "how does
          this team look by player", and only sometimes "these two". */}
      <div className="px-4 lg:px-0 mb-5 max-w-md">
        <div className="text-xs uppercase tracking-widest text-ink-muted font-medium mb-1.5">
          Players
        </div>
        <SearchableMultiSelect
          value={picked}
          options={options}
          onChange={setPicked}
          placeholder="Search players…"
          emptyLabel="Select Players"
          ariaLabel="Players to show"
          inlineSearch
        />
        <PlayerChips
          ids={picked}
          nameOf={nameOf}
          onRemove={(v) => setPicked(picked.filter((x) => x !== v))}
          accent={accent}
        />
      </div>

      {/* One column control for all three tables — see the note at the top. */}
      <div className="flex flex-wrap items-center gap-2 px-4 lg:px-0">
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

      {SECTIONS.map((sec) => (
        <section key={sec.key} className="mt-8 first:mt-6">
          <div className="px-4 lg:px-0 mb-3">
            <h3 className="font-display text-2xl lg:text-3xl text-ink leading-none tracking-tight">
              {sec.title}
            </h3>
            <p className="mt-1.5 text-xs text-ink-muted max-w-2xl leading-relaxed">{sec.blurb}</p>
          </div>

          <div className="border-y border-x-0 lg:border-x border-hairline rounded-none lg:rounded-xl shadow-sm overflow-hidden bg-paper-deep/25 -mx-4 lg:mx-0">
            {/* overscroll-x-contain ONLY — `none` also kills the vertical
                rubber-band and this box scrolls in both axes. Documented at the
                other grids. */}
            <div className="overflow-x-auto overscroll-x-contain">
              <table className="w-full text-sm border-separate border-spacing-0">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-30 bg-paper-deep h-6 p-0 border-r border-hairline" />
                    <th colSpan={3} className="bg-paper-deep h-6 p-0 px-2 text-[0.58rem] uppercase tracking-[0.15em] font-semibold text-ink-muted text-center align-middle">
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
                    <Th sticky label="Player" align="left" active={sort.key === "name"} dir={sort.dir} onClick={() => toggleSort("name", sec.key, "asc")} />
                    <Th label="On" title="Possessions with this player on the floor" active={sort.key === "onPoss"} dir={sort.dir} onClick={() => toggleSort("onPoss", sec.key, "desc")} />
                    <Th label="Off" title="Possessions with this player off the floor" active={sort.key === "offPoss"} dir={sort.dir} onClick={() => toggleSort("offPoss", sec.key, "desc")} />
                    <Th label="Pct" title="Share of team possessions this player was on the floor for" active={sort.key === "share"} dir={sort.dir} onClick={() => toggleSort("share", sec.key, "desc")} />
                    {cols.map((st, i) => (
                      <Th
                        key={st.key}
                        label={st.label}
                        title={st.title}
                        active={sort.key === st.key && sort.mode === sec.key}
                        dir={sort.dir}
                        onClick={() => toggleSort(st.key, sec.key, st.lowerBetter && sec.key !== "diff" ? "asc" : "desc")}
                        bandStart={i === 0 || cols[i - 1]!.group !== st.group}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
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
                      <td className="px-2 sm:px-3 py-1.5 text-right tabular text-ink-muted whitespace-nowrap">
                        {(share(r) * 100).toFixed(1)}%
                      </td>
                      {cols.map((st, i) => {
                        const v = valueOf(r, st, sec.key);
                        const pct = percentileOf(st, v, benchmarks, sec.key === "diff" ? "diff" : "value");
                        return (
                          <td
                            key={st.key}
                            className={cn(
                              "px-1 sm:px-1.5 py-1.5 text-right tabular whitespace-nowrap transition-colors",
                              (i === 0 || cols[i - 1]!.group !== st.group) && "border-l border-hairline",
                            )}
                          >
                            <span className="inline-flex flex-col items-end gap-0.5 leading-tight">
                              <span className={cn(st.key === "net" && "font-semibold text-ink")}>
                                {sec.key === "diff" ? formatDiff(v, st.format) : formatStat(v, st.format)}
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
        </section>
      ))}

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
