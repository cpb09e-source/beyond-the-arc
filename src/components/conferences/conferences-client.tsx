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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { Select } from "@/components/select";
import { midrankPercentileMap } from "@/lib/percentile";
import { PercentileChip } from "@/components/percentile-chip";
import { SortableTh } from "@/components/explorer/sortable-th";
import { MultiYearSelect } from "@/components/explorer/multi-year-select";
import { SearchableMultiSelect } from "@/components/explorer/searchable-multi-select";
import { confDisplay } from "@/lib/conf-display";
import { useDragPan } from "@/lib/use-drag-pan";
import { DownloadMenu } from "@/components/explorer/download-menu";
import {
  numField, type ExportCol, type ExportEntity, type ExportInput, type MultiExportInput,
} from "@/lib/table-export";
import { POWER_CONFS } from "@/lib/conf-tiers";
import { ConferenceLogo } from "@/components/conferences/conference-logo";
import { TeamLogo } from "@/components/team-logo";
import Link from "next/link";
import {
  CONF_VIEWS, confCol, confViewByKey, confViewCols, confViewBands, confViewsFor, type ConfCol,
} from "@/lib/conference-views";
import {
  confValue, loadConferenceRankings, loadConferenceSplits, splitValue,
  type ConfPack, type ConfRow, type ConfSplitPack,
} from "@/lib/conference-rankings";

const ROW_HOVER = "group-hover:bg-[color-mix(in_oklab,var(--coral)_8%,var(--card))]";

/** The season the page opens on. */
const DEFAULT_YEAR = 2026;

/**
 * The game splits, in the order the control offers them.
 *
 * READ THE CONFERENCE SPLIT WITH ITS THUMB ON THE SCALE. In league games the
 * conference is mostly playing itself, so its margin collapses towards zero —
 * one team's points scored are another's allowed. It does not land ON zero,
 * and the gap is informative: the rows are the league minus its worst two,
 * and those two are exactly who the rest beat in league play. Pace, shooting
 * and the rate stats are unaffected and say real things.
 */
const SPLITS = [
  { key: "full", label: "Full Season" },
  { key: "conf", label: "All Conference Games" },
  { key: "nonconf", label: "All Non-Conference Games" },
] as const;

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
  split: string;
  sortBy: string;
  sortDir: "asc" | "desc";
};

function parseConfSpec(params: URLSearchParams, pack: ConfPack | null): ConfSpec {
  const known = new Set(pack?.seasons ?? []);
  const years = (params.get("ys") ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && (known.size === 0 || known.has(n)));
  const splitInUrl = params.get("split") ?? "full";
  const split = SPLITS.some((s) => s.key === splitInUrl) ? splitInUrl : "full";
  // A view the split cannot fill falls back to the first one it can, so a
  // bookmarked Record & Outcomes URL plus a split is a table rather than a
  // row of dashes.
  const asked = confViewByKey(params.get("view"));
  const offered = confViewsFor(split);
  const view = (offered.some((v) => v.key === asked.key) ? asked : offered[0]!).key;
  const sortInUrl = params.get("sort");
  const orderInUrl = params.get("order");
  return {
    years: years.length ? years : [DEFAULT_YEAR],
    confs: (params.get("conf") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    view,
    split,
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
  const cols = useMemo(() => confViewCols(view, spec.split), [view, spec.split]);
  const viewOptions = useMemo(() => confViewsFor(spec.split), [spec.split]);

  /**
   * The sort the table can actually run.
   *
   * A split drops the columns it has no numbers for, and the sort key is
   * usually one of them — Overview sorts on aNET, which no split has. Left
   * alone the comparator read null for every row and the table came out
   * alphabetical, which looks like a bug and is one. Falls back to the
   * view's own default if the split kept it, then to its first column.
   */
  const sortBy = useMemo(() => {
    // Season is sortable in every view and under every split, so it never
    // falls through to the "this split cannot fill it" rescue below.
    if (spec.sortBy === "year") return spec.sortBy;
    if (cols.some((c) => c.key === spec.sortBy)) return spec.sortBy;
    if (cols.some((c) => c.key === view.sortBy)) return view.sortBy;
    return cols[0]?.key ?? spec.sortBy;
  }, [cols, spec.sortBy, view.sortBy]);

  /**
   * The splits, fetched the first time one is picked and then kept.
   *
   * The table shows full-season numbers while this is in flight rather than
   * emptying itself: a half-second of the right shape beats a blank.
   */
  const [splitPack, setSplitPack] = useState<ConfSplitPack | null>(null);
  useEffect(() => {
    if (spec.split === "full" || splitPack) return;
    let live = true;
    loadConferenceSplits().then((p) => { if (live) setSplitPack(p); });
    return () => { live = false; };
  }, [spec.split, splitPack]);

  /** The view registry, in the shape the download menu wants. */
  const downloadViews = useMemo(
    () => viewOptions.map((v) => ({ key: v.key, label: v.label, group: "Views", desc: v.desc })),
    [viewOptions],
  );

  /** One row's numbers under the active split — the row itself on Full. */
  const readValue = useCallback((r: ConfRow, key: string): number | null => {
    // The season is a property of the row, not of a split of its games.
    if (key === "year") return r.year;
    if (spec.split === "full") return confValue(r, key);
    const block = splitPack?.rows[`${r.year}|${r.conf}`]?.[spec.split];
    return splitValue(block, key);
  }, [spec.split, splitPack]);

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
    if (next.split) {
      if (next.split === "full") p.delete("split");
      else p.set("split", next.split);
      // A split the current view cannot fill moves the reader to one it can,
      // rather than handing them an empty table and no explanation.
      const offered = confViewsFor(next.split);
      if (!offered.some((v) => v.key === spec.view)) {
        const fallback = offered[0]!;
        if (fallback.key === CONF_VIEWS[0]!.key) p.delete("view");
        else p.set("view", fallback.key);
        p.delete("sort");
        p.delete("order");
      }
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
  }, [params, router, spec.view]);

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
      if (c.noPct) continue;
      const merged = new Map<string, number>();
      for (const rows of byYear.values()) {
        const m = midrankPercentileMap(
          rows.map((r) => [`${r.year}|${r.conf}`, readValue(r, c.key)] as const),
          !c.lowerBetter,
        );
        for (const [k, v] of m) merged.set(k, v);
      }
      out.set(c.key, merged);
    }
    return out;
  }, [cohort, cols, readValue]);

  const rows = useMemo(() => {
    const keep = new Set(spec.confs);
    const picked = keep.size ? cohort.filter((r) => keep.has(r.conf)) : [...cohort];
    const dir = spec.sortDir === "asc" ? 1 : -1;
    picked.sort((a, b) => {
      const va = readValue(a, sortBy);
      const vb = readValue(b, sortBy);
      // Nulls last in both directions: a conference with no number for a stat
      // has not earned the top of the table by lacking one.
      if (va === null && vb === null) return a.year !== b.year ? b.year - a.year : a.conf.localeCompare(b.conf);
      if (va === null) return 1;
      if (vb === null) return -1;
      if (va !== vb) return (va - vb) * dir;
      return b.year - a.year || a.conf.localeCompare(b.conf);
    });
    return picked;
  }, [cohort, spec.confs, sortBy, spec.sortDir, readValue]);

  /**
   * Conference options, POWER FIRST, from the seasons on screen — so a
   * defunct league only offers itself where it existed, and the Pac-12 shows
   * up under Power for the seasons it was one.
   *
   * The tier split is POWER_CONFS, the same set /portal and the /coaches Tier
   * filter use, so "power" means one thing on this site. It is a fixed set
   * rather than a per-season judgement: the Big East is in it on the strength
   * of the whole 2014-26 window, and re-deciding that year by year would make
   * the header move under the reader for no gain.
   *
   * Sections render in the order the groups first appear, so the sort has to
   * put every power conference ahead of every other one.
   */
  const confOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of cohort) if (!seen.has(r.conf)) seen.set(r.conf, confDisplay(r.conf) || r.conf);
    return [...seen.entries()]
      .map(([value, label]) => ({ value, label, group: POWER_CONFS.has(value) ? "power" : "mid" }))
      .sort((a, b) => (a.group === b.group ? a.label.localeCompare(b.label) : a.group === "power" ? -1 : 1));
  }, [cohort]);

  const gridScrollRef = useRef<HTMLDivElement>(null);
  const panHandlers = useDragPan(gridScrollRef);
  /**
   * The export reads THE TABLE, not the file: same split, same percentiles,
   * same rows in the same order. A workbook that quietly reverted to
   * full-season numbers because that is what the row object holds would be
   * the worst kind of wrong — right-looking and different.
   */
  const exportEntity = useMemo((): ExportEntity<ConfRow> => ({
    title: "Conference Power Rankings",
    sheetName: "Conferences",
    wideHeader: "Conference",
    fileStem: "conferences",
    identity: [
      { header: "Conference", width: 22, get: (r) => confDisplay(r.conf) || r.conf },
      { header: "Season", get: (r) => seasonLabel(r.year) },
      { header: "Teams", get: (r) => r.kept },
      { header: "Of", get: (r) => r.teams },
      { header: "Dropped", width: 28, get: (r) => r.dropped.join(", ") },
    ],
    num: (r, key) => (key ? readValue(r, key) : numField(r, key)),
    pctOf: (r, key) => pcts.get(key)?.get(`${r.year}|${r.conf}`) ?? null,
  }), [readValue, pcts]);

  const exportCols = useCallback((v: typeof view): ExportCol[] =>
    confViewBands(v, spec.split).flatMap((b) =>
      b.keys
        .map((k) => confViewCols(v, spec.split).find((c) => c.key === k))
        .filter((c): c is ConfCol => !!c)
        .map((c) => ({
          label: c.label,
          total: c.key,
          pct: c.key,
          // The workbook has no num2; a second decimal is display polish.
          fmt: c.fmt === "num2" ? "num1" : c.fmt,
          band: b.label,
        })),
    ), [spec.split]);

  const exportMeta = useCallback((label: string) => ({
    viewLabel: label,
    seasons: spec.years.length === 1 ? seasonLabel(spec.years[0]!) : `${spec.years.length} seasons`,
    conference: spec.confs.length ? spec.confs.join(", ") : "All conferences",
    teams: `Each conference minus its bottom 2 by NET`,
    filters: [SPLITS.find((sp) => sp.key === spec.split)?.label ?? "Full Season"],
    sort: `${confCol(sortBy)?.label ?? sortBy} — ${spec.sortDir === "desc" ? "high to low" : "low to high"}`,
    search: "",
    url: typeof window === "undefined" ? "" : window.location.href,
  }), [spec.years, spec.confs, spec.split, spec.sortDir, sortBy]);

  const buildExport = useCallback((): ExportInput<ConfRow> => ({
    cols: exportCols(view),
    rows,
    entity: exportEntity,
    meta: exportMeta(view.label),
  }), [exportCols, view, rows, exportEntity, exportMeta]);

  const buildExportAll = useCallback((viewKeys: string[]): MultiExportInput<ConfRow> => {
    const wanted = new Set(viewKeys);
    return {
      sheets: viewOptions.filter((v) => wanted.has(v.key)).map((v) => ({ name: v.label, cols: exportCols(v) })),
      rows,
      entity: exportEntity,
      meta: exportMeta("Multiple views"),
      slug: wanted.size === viewOptions.length ? "all-views" : "views",
    };
  }, [viewOptions, exportCols, rows, exportEntity, exportMeta]);

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
    for (const b of confViewBands(view, spec.split)) {
      const span = b.keys.filter((k) => cols.some((c) => c.key === k)).length;
      if (span > 0) out.push({ label: b.label, accent: b.accent, span, start: at });
      at += span;
    }
    return out;
  }, [view, cols, spec.split]);
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
            groupLabels={{ power: "Power", mid: "Mid Major" }}
            className="w-36"
          />
        </label>

        <label className="inline-flex items-center gap-1.5 min-w-0">
          <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium whitespace-nowrap">View</span>
          <Select
            value={view.key}
            onChange={(v) => update({ view: v })}
            ariaLabel="Table view"
            compact
            className="max-w-44"
          >
            {viewOptions.map((v) => (
              <option key={v.key} value={v.key} title={v.desc}>{v.label}</option>
            ))}
          </Select>
        </label>

        <label className="inline-flex items-center gap-1.5 min-w-0">
          <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium whitespace-nowrap">Split</span>
          <Select
            value={spec.split}
            onChange={(v) => update({ split: v })}
            ariaLabel="Stat split"
            compact
            className="max-w-52"
          >
            {SPLITS.map((sp) => (
              <option key={sp.key} value={sp.key}>{sp.label}</option>
            ))}
          </Select>
        </label>

        <DownloadMenu
          views={downloadViews}
          noun="conferences"
          // The PAGE is free and the DOWNLOAD is not — decided 2026-08-30.
          // Thirty-one rows on screen is a shop window; the same rows as a
          // formatted workbook is the product, and it is the one thing in this
          // toolbar shaped like something to sell.
          build={buildExport}
          buildAll={buildExportAll}
          rowCount={rows.length}
          colCount={cols.length * 2 + 5}
          disabled={loading || rows.length === 0}
        />

        <span className="hidden sm:inline text-xs text-ink-muted tabular whitespace-nowrap">
          {loading ? "loading…" : `${rows.length.toLocaleString()} ${rows.length === 1 ? "row" : "rows"}`}
        </span>
      </div>

      {/* THE RULE, ON ITS OWN LINE. Sharing the toolbar row it was the first
          thing dropped at narrow widths, and it is the one sentence without
          which the table reads as a plain conference average. Under the
          conference split it also has to explain why the margins are small. */}
      <div className="px-3 lg:px-4 py-2 border-b border-hairline bg-paper-deep/30 text-xs text-ink-muted leading-snug">
        {spec.split === "conf"
          ? "League games only, so a conference is mostly playing itself — the margin that remains is what the rest of the league does to the two teams each row drops."
          : spec.split === "nonconf"
            ? "Non-conference games only. Bottom 2 teams by NET still dropped from every conference."
            : "Bottom 2 teams by NET dropped from every conference."}
      </div>

      {/* Click-and-drag panning over the stat columns, same gesture as the
          team explorer and /players. Touch is left alone — it already
          scrolls natively, and better. */}
      <div
        ref={gridScrollRef}
        className="overflow-x-auto overscroll-x-contain cursor-grab"
        {...panHandlers}
      >
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
              {multiYear && (
                <SortableTh
                  statKey="year"
                  label="Season"
                  title="Sort by season"
                  defaultDir="desc"
                  align="left"
                  basePath="/conferences"
                  defaultSort={sortBy}
                  idleArrows
                  className="sticky top-6 z-30 bg-paper-deep border-b border-hairline"
                />
              )}
              {cols.map((c, i) => (
                <SortableTh
                  key={c.key}
                  statKey={c.key}
                  label={c.label}
                  title={c.title}
                  defaultDir={c.lowerBetter ? "asc" : "desc"}
                  basePath="/conferences"
                  defaultSort={sortBy}
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
                      title={`${r.kept} of ${r.teams} teams${r.dropped.length ? ` · dropped ${r.dropped.join(", ")}` : ""} · open in the Team Explorer`}
                    >
                      {/* STRAIGHT INTO THE TEAM EXPLORER, on this league and
                          this season. The row says how a conference did; the
                          obvious next question is which of its teams did it,
                          and that table already exists. */}
                      <Link
                        href={`/?ys=${r.year}&conf=${encodeURIComponent(r.conf)}`}
                        className="inline-flex items-center gap-2 min-w-0 hover:text-coral transition-colors"
                      >
                        {/* 28. Half these marks are wordmarks rather than shields -
                            Ivy, C-USA, WAC - so they need real width before
                            they read as anything; at 18 they were a smudge.
                            The rows are already two lines tall (value over
                            percentile chip), so this costs no height, and the
                            files are 128px so it costs no sharpness either. */}
                        <ConferenceLogo conf={r.conf} size={28} />
                        {confDisplay(r.conf) || r.conf}
                      </Link>
                    </td>
                    {multiYear && (
                      <td className={cn("px-2 py-1.5 text-ink-muted tabular text-xs transition-colors", ROW_HOVER)}>
                        {seasonLabel(r.year)}
                      </td>
                    )}
                    {cols.map((c, ci) => {
                      const v = readValue(r, c.key);
                      const pct = pcts.get(c.key)?.get(id) ?? null;
                      /**
                       * THE CHAMPION AS A CREST, not as the number 1.
                       *
                       * NC is the one column whose only non-zero value is 1,
                       * so the number carries no information the crest does
                       * not carry better — and the crest answers the question
                       * a 1 immediately raises, which is "who?".
                       */
                      const champ = c.key === "ncaa_nc" ? (r.ncaa_champ as string | undefined) : undefined;
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
                            {c.key === "ncaa_nc" ? (
                              champ
                                ? <span className="inline-flex items-center" title={`${champ} — national champion`}>
                                    <TeamLogo name={champ} size={22} />
                                  </span>
                                // An em dash, not a 0. Every other row in this
                                // column did not win it, and thirty zeroes down
                                // a column is noise around the one that did.
                                : <span className="text-ink-muted">—</span>
                            ) : (
                              <span className={v === null ? "text-ink-muted" : "text-ink"}>{fmtValue(v, c.fmt)}</span>
                            )}
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
