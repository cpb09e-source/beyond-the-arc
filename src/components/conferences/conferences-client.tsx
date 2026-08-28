"use client";

/**
 * Conference Power Rankings — one row per conference per season.
 *
 * WHAT MAKES THIS A POWER RANKING AND NOT A CONFERENCE AVERAGE: every row is
 * the league MINUS its two worst teams by adjusted NET. A conference's bottom
 * two say almost nothing about whether it is a good league, and they drag an
 * average hard enough to reorder the table. The rule is fixed at two rather
 * than a share, which is worth knowing while reading: it removes a quarter of
 * an 8-team league and a ninth of an 18-team one, so it lifts small conferences
 * more than large ones. The TEAMS column shows what fed each row, and the
 * dropped pair is on the conference cell's tooltip, so none of that is hidden.
 *
 * NO FILTER BUILDER AND NO COLUMN PICKER, by decision. The column set IS the
 * view, and a table of thirty-one rows does not need narrowing — seasons and
 * conferences are the only two questions worth asking of it.
 *
 * The aggregation itself happens at build time; see
 * scripts/build-conference-rankings.mjs and docs/conference-rankings-spec.md.
 * This file only picks, sorts and paints.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { midrankPercentileMap } from "@/lib/percentile";
import { PercentileChip } from "@/components/percentile-chip";
import { SortableTh } from "@/components/explorer/sortable-th";
import { MultiYearSelect } from "@/components/explorer/multi-year-select";
import { SearchableMultiSelect } from "@/components/explorer/searchable-multi-select";
import { confDisplay } from "@/lib/conf-display";
import { ConferenceLogo } from "@/components/conferences/conference-logo";
import {
  CONF_VIEWS, confViewByKey, confViewCols, type ConfCol,
} from "@/lib/conference-views";
import {
  confValue, loadConferenceRankings, type ConfPack, type ConfRow,
} from "@/lib/conference-rankings";

const ROW_HOVER = "group-hover:bg-[color-mix(in_oklab,var(--coral)_8%,var(--card))]";

/** The season the page opens on. */
const DEFAULT_YEAR = 2026;

function seasonLabel(y: number): string {
  return `${(y - 1).toString().slice(-2)}-${y.toString().slice(-2)}`;
}

// ---------------------------------------------------------------------------
// Number formatting
// ---------------------------------------------------------------------------
// Deliberately small and local. The team explorer's formatters are entangled
// with its row type; these take a number and a format name and nothing else.

function fmtValue(v: number | null, fmt: ConfCol["fmt"]): string {
  if (v === null) return "—";
  switch (fmt) {
    case "pct1": return `${(v * 100).toFixed(1)}%`;
    case "num2": return v.toFixed(2);
    case "int": return Math.round(v).toLocaleString();
    // A margin has to carry its sign, including when it is positive — that is
    // the whole information in the column.
    case "signed": return `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
    default: return v.toFixed(1);
  }
}

// ---------------------------------------------------------------------------
// URL state
// ---------------------------------------------------------------------------

type ConfSpec = {
  years: number[];
  confs: string[];
  view: string;
  sortBy: string;
  sortDir: "asc" | "desc";
};

function parseConfSpec(params: URLSearchParams, pack: ConfPack | null): ConfSpec {
  const known = new Set(pack?.seasons ?? []);
  const years = (params.get("ys") ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && (known.size === 0 || known.has(n)));
  const view = confViewByKey(params.get("view")).key;
  const sortInUrl = params.get("sort");
  const orderInUrl = params.get("order");
  return {
    years: years.length ? years : [DEFAULT_YEAR],
    confs: (params.get("conf") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    view,
    sortBy: sortInUrl ?? confViewByKey(view).sortBy,
    sortDir: orderInUrl === "asc" ? "asc" : orderInUrl === "desc" ? "desc" : confViewByKey(view).sortDir,
  };
}

export function ConferencesClient() {
  const router = useRouter();
  const search = useSearchParams();
  const [pack, setPack] = useState<ConfPack | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    loadConferenceRankings().then((p) => {
      if (!live) return;
      setPack(p);
      setLoading(false);
    });
    return () => { live = false; };
  }, []);

  const params = useMemo(() => new URLSearchParams(search.toString()), [search]);
  const spec = useMemo(() => parseConfSpec(params, pack), [params, pack]);
  const view = useMemo(() => confViewByKey(spec.view), [spec.view]);
  const cols = useMemo(() => confViewCols(view), [view]);

  /** Write the URL. Sorting goes through SortableTh's own links, not this. */
  const update = useCallback((next: Partial<ConfSpec>) => {
    const p = new URLSearchParams(params);
    if (next.years) {
      const ys = next.years.length ? next.years : [DEFAULT_YEAR];
      p.set("ys", ys.join(","));
    }
    if (next.confs) {
      if (next.confs.length) p.set("conf", next.confs.join(","));
      else p.delete("conf");
    }
    if (next.view) {
      const v = confViewByKey(next.view);
      if (v.key === CONF_VIEWS[0]!.key) p.delete("view");
      else p.set("view", v.key);
      // A view carries its own sort. Without this the table stays ordered by a
      // column the new view may not have, and Record & Outcomes arrives sorted
      // by a paint figure it does not show.
      p.delete("sort");
      p.delete("order");
    }
    const qs = p.toString();
    router.replace(qs ? `/conferences?${qs}` : "/conferences", { scroll: false });
  }, [params, router]);

  /**
   * THE COHORT IS EVERY CONFERENCE IN THE SELECTED SEASONS, not the conferences
   * left after the picker. A percentile that moved when you filtered down to
   * two leagues would be answering a different question every time — "best of
   * the two you kept" rather than "where this sits in the sport".
   */
  const cohort = useMemo(() => {
    if (!pack) return [];
    const years = new Set(spec.years);
    return pack.rows.filter((r) => years.has(r.year));
  }, [pack, spec.years]);

  /**
   * Percentiles per stat, computed WITHIN EACH SEASON and then merged.
   *
   * Same rule the team explorer uses for teams: a conference is compared to the
   * conferences it actually played that year. Pooling twelve seasons would let
   * scoring inflation decide the colours — every 2026 league would outrank
   * every 2015 one on points per game, which is a fact about the era.
   */
  const pcts = useMemo(() => {
    const out = new Map<string, Map<string, number>>();
    const byYear = new Map<number, ConfRow[]>();
    for (const r of cohort) {
      const arr = byYear.get(r.year) ?? [];
      arr.push(r);
      byYear.set(r.year, arr);
    }
    for (const c of cols) {
      const merged = new Map<string, number>();
      for (const rows of byYear.values()) {
        const m = midrankPercentileMap(
          rows.map((r) => [`${r.year}|${r.conf}`, confValue(r, c.key)] as const),
          !c.lowerBetter,
        );
        for (const [k, v] of m) merged.set(k, v);
      }
      out.set(c.key, merged);
    }
    return out;
  }, [cohort, cols]);

  const rows = useMemo(() => {
    const keep = new Set(spec.confs);
    const picked = keep.size ? cohort.filter((r) => keep.has(r.conf)) : [...cohort];
    const dir = spec.sortDir === "asc" ? 1 : -1;
    picked.sort((a, b) => {
      const va = confValue(a, spec.sortBy);
      const vb = confValue(b, spec.sortBy);
      // Nulls last in both directions: a conference with no number for a stat
      // has not earned the top of the table by lacking one.
      if (va === null && vb === null) return a.year !== b.year ? b.year - a.year : a.conf.localeCompare(b.conf);
      if (va === null) return 1;
      if (vb === null) return -1;
      if (va !== vb) return (va - vb) * dir;
      return b.year - a.year || a.conf.localeCompare(b.conf);
    });
    return picked;
  }, [cohort, spec.confs, spec.sortBy, spec.sortDir]);

  /** Conference options come from the seasons on screen, so a defunct league
   *  only offers itself where it existed. */
  const confOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of cohort) if (!seen.has(r.conf)) seen.set(r.conf, confDisplay(r.conf) || r.conf);
    return [...seen.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [cohort]);

  const multiYear = spec.years.length > 1;
  /**
   * Band captions with the column index each one starts at, so the dividing
   * rules land on the right cells. Built with a loop rather than a map over a
   * running total - the closure form reassigns its accumulator after render,
   * which the React compiler rejects, and rightly.
   */
  const bands = useMemo(() => {
    const out: Array<{ label: string; accent?: boolean; span: number; start: number }> = [];
    let at = 0;
    for (const b of view.bands) {
      const span = b.keys.filter((k) => cols.some((c) => c.key === k)).length;
      if (span > 0) out.push({ label: b.label, accent: b.accent, span, start: at });
      at += span;
    }
    return out;
  }, [view, cols]);
  const groupStarts = useMemo(() => new Set(bands.map((b) => b.start)), [bands]);

  return (
    <div id="conference-table" className="bg-card border border-ink/10 border-x-0 lg:border-x rounded-none lg:rounded-xl shadow-md overflow-hidden ring-0 lg:ring-1 ring-ink/5 mt-6 max-md:mt-2 -mx-6 lg:mx-0">
      {/* Toolbar. Three controls and a count — there is nothing else to ask. */}
      <div className="px-3 lg:px-4 py-2.5 border-b border-hairline flex items-center flex-wrap gap-x-3 gap-y-2">
        <label className="inline-flex items-center gap-1.5 min-w-0">
          <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium whitespace-nowrap">Seasons</span>
          <MultiYearSelect
            years={spec.years}
            onChange={(years) => update({ years })}
            availableYears={pack?.seasons ? [...pack.seasons].sort((a, b) => b - a) : undefined}
            className="w-32"
          />
        </label>

        <label className="inline-flex items-center gap-1.5 min-w-0">
          <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium whitespace-nowrap">Conf</span>
          <SearchableMultiSelect
            value={spec.confs}
            options={confOptions}
            onChange={(confs) => update({ confs })}
            emptyLabel="All"
            ariaLabel="Conferences"
            className="w-36"
          />
        </label>

        <label className="inline-flex items-center gap-1.5 min-w-0">
          <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium whitespace-nowrap">View</span>
          <select
            value={view.key}
            onChange={(e) => update({ view: e.target.value })}
            aria-label="Table view"
            className="h-8 max-w-44 rounded-md border border-ink/15 bg-card text-ink text-sm px-2 shadow-sm hover:border-ink/25 focus:outline-none focus:ring-2 focus:ring-coral/40 transition-colors"
          >
            {CONF_VIEWS.map((v) => (
              <option key={v.key} value={v.key} title={v.desc}>{v.label}</option>
            ))}
          </select>
        </label>

        <span className="hidden sm:inline text-xs text-ink-muted tabular whitespace-nowrap">
          {loading ? "loading…" : `${rows.length.toLocaleString()} ${rows.length === 1 ? "row" : "rows"}`}
        </span>

        {/* The rule, said once, where the numbers are. Without it a reader has
            no way to know the table is not a plain conference average. */}
        <span className="hidden lg:inline text-xs text-ink-muted whitespace-nowrap">
          · bottom 2 teams by NET dropped from every conference
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            {/* Band row, same two-tier header as the other tables. */}
            <tr>
              <th className="sticky top-0 left-0 z-40 w-10 min-w-10 bg-paper-deep h-6 p-0" />
              <th className="sticky top-0 z-40 bg-paper-deep h-6 p-0" />
              {multiYear && <th className="sticky top-0 z-30 bg-paper-deep h-6 p-0" />}
              {bands.map((b) => (
                <th
                  key={b.label}
                  colSpan={b.span}
                  className={cn(
                    "sticky top-0 z-30 bg-paper-deep h-6 p-0 px-2 text-[0.58rem] uppercase tracking-[0.15em]",
                    "font-semibold text-center border-l border-hairline align-middle",
                    b.accent ? "text-coral" : "text-ink-muted",
                  )}
                >
                  {b.label}
                </th>
              ))}
              <th aria-hidden className="sticky top-0 z-30 bg-paper-deep h-6 p-0 w-full" />
            </tr>
            <tr>
              <th className="sticky top-6 left-0 z-40 w-10 min-w-10 bg-paper-deep border-b border-hairline px-1 sm:px-2 py-3 sm:py-2 text-xs uppercase tracking-widest text-ink-muted font-medium text-center align-middle">#</th>
              <th className="sticky top-6 z-40 bg-paper-deep border-b border-hairline px-2 sm:px-3 py-3 sm:py-2 text-xs uppercase tracking-widest text-ink-muted font-medium text-left align-middle">Conference</th>
              {multiYear && <th className="sticky top-6 z-30 bg-paper-deep border-b border-hairline px-2 py-3 sm:py-2 text-xs uppercase tracking-widest text-ink-muted font-medium text-left align-middle">Season</th>}
              {cols.map((c, i) => (
                <SortableTh
                  key={c.key}
                  statKey={c.key}
                  label={c.label}
                  title={c.title}
                  defaultDir={c.lowerBetter ? "asc" : "desc"}
                  basePath="/conferences"
                  defaultSort={view.sortBy}
                  idleArrows
                  className={cn(
                    "sticky top-6 z-30 w-[8%] bg-paper-deep border-b border-hairline",
                    groupStarts.has(i) && "border-l border-hairline",
                  )}
                />
              ))}
              <th aria-hidden className="sticky top-6 z-30 bg-paper-deep border-b border-hairline w-full p-0" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={cols.length + 3} className="px-4 py-16 text-center text-ink-muted">Loading conferences…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={cols.length + 3} className="px-4 py-12 text-center text-ink-soft">No conferences match this selection.</td></tr>
            ) : (
              rows.map((r, i) => {
                const zebra = i % 2 === 0 ? "bg-paper" : "bg-card";
                const id = `${r.year}|${r.conf}`;
                return (
                  <tr key={id} className={cn("group", zebra)}>
                    <td className={cn("sticky left-0 z-20 w-10 min-w-10 px-1 sm:px-2 py-1.5 text-center text-ink-muted tabular text-xs font-semibold transition-colors", zebra, ROW_HOVER)}>
                      {i + 1}
                    </td>
                    <td
                      className={cn("sticky z-20 px-2 sm:px-3 py-1.5 font-medium text-ink whitespace-nowrap transition-colors", zebra, ROW_HOVER)}
                      /* WHAT FED THE ROW, AND WHAT DID NOT, on the name cell.
                         The count used to be a column of its own; it is one
                         number that never changes within a season and it was
                         costing a column beside the logo. Both halves are here
                         because a reader cannot work either out for himself. */
                      title={`${r.kept} of ${r.teams} teams${r.dropped.length ? ` · dropped ${r.dropped.join(", ")}` : ""}`}
                    >
                      <span className="inline-flex items-center gap-2 min-w-0">
                        {/* 28. Half these marks are wordmarks rather than shields -
                            Ivy, C-USA, WAC - so they need real width before
                            they read as anything; at 18 they were a smudge.
                            The rows are already two lines tall (value over
                            percentile chip), so this costs no height, and the
                            files are 128px so it costs no sharpness either. */}
                        <ConferenceLogo conf={r.conf} size={28} />
                        {confDisplay(r.conf) || r.conf}
                      </span>
                    </td>
                    {multiYear && (
                      <td className={cn("px-2 py-1.5 text-ink-muted tabular text-xs transition-colors", ROW_HOVER)}>
                        {seasonLabel(r.year)}
                      </td>
                    )}
                    {cols.map((c, ci) => {
                      const v = confValue(r, c.key);
                      const pct = pcts.get(c.key)?.get(id) ?? null;
                      return (
                        <td
                          key={c.key}
                          className={cn(
                            "px-2 py-1.5 text-right tabular transition-colors",
                            groupStarts.has(ci) && "border-l border-hairline",
                            ROW_HOVER,
                          )}
                        >
                          <span className="inline-flex flex-col items-end gap-0.5">
                            <span className={v === null ? "text-ink-muted" : "text-ink"}>{fmtValue(v, c.fmt)}</span>
                            {pct !== null
                              ? <PercentileChip pct={pct} />
                              : <span className="h-5" aria-hidden="true" />}
                          </span>
                        </td>
                      );
                    })}
                    <td aria-hidden className={cn("p-0 transition-colors", zebra, ROW_HOVER)} />
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
