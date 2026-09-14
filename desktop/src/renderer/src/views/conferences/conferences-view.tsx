import { useEffect, useMemo, useRef } from "react";
import { conferenceExportCols, conferenceExportEntity } from "@/lib/conference-export";
import { EXPORT_ORIGIN, exportFields, exportSeasonLabel, type ExportInput, type ExportMeta, type MultiExportInput } from "@/lib/table-export";
import { confDisplay } from "@/lib/conf-display";
import { POWER_CONFS } from "@/lib/conf-tiers";
import { confPercentiles, confReader, type ConfPack, type ConfRow, type ConfSplitPack } from "@/lib/conference-rankings";
import { CONF_SPLITS, confCol, confViewBands, confViewCols, confViewsFor, fmtConfValue } from "@/lib/conference-views";
import { SEASON_CEIL } from "@/lib/seasons";
import { SOURCE_LABEL, useCorpus, useLoaded } from "~/data/use-corpus";
import { focusConf, useFocusSubject } from "~/focus/focus-mode";
import { Picker } from "~/shell/picker";
import { useShell } from "~/shell/shell-context";
import { useTabTitle } from "~/shell/tab-title";
import { useSetStatus } from "~/shell/status";
import { LoadError, NoMatches, TableSkeleton, ViewHeader } from "~/shell/view-parts";
import type { ViewProps } from "~/shell/views";
import { useActionEnv } from "~/objects/use-object-actions";
import { DataTable, type Column, type TableHandle } from "~/table/data-table";
import { DownloadMenu } from "~/table/download-menu";
import { sortText } from "~/table/export-meta";
import { StatCell } from "~/table/stat-cell";
import { ConfLogo } from "~/ui/conf-logo";
import { seasonLabel } from "~/ui/format";
import { TeamLogo } from "~/ui/logo";
import { logoIdOf } from "~/ui/logo-id";
import { usePersisted } from "~/ui/persisted";
import { scopedQuery } from "~/ui/scoped-query";
import { matchesQuery } from "~/ui/text";
import { ConferencePeekBody, type ConfHighlight } from "./conference-peek";

/**
 * Conference Power Rankings: every conference, every season, as the league
 * minus its two worst teams by adjusted net.
 *
 * THE SITE'S PAGE, IN THE APP'S TABLE. The rows are the site's build
 * (conference-rankings.json), the seven views and their bands are
 * lib/conference-views.ts, and the percentiles are lib/conference-rankings.ts
 * confPercentiles: within each season, never pooled, so a 2026 league is not
 * outranking every 2015 one on scoring inflation.
 *
 * WHAT THE APP ADDS. Peek shows the teams behind a row, with the dropped pair
 * marked, which the site can only say in a tooltip. Enter goes where the site's
 * link goes: this league, this season, in the Team Explorer.
 *
 * One season at a time by default, the tab's, so [ ] walk the seasons; or every
 * season at once, as the site's multi-season picker allows.
 */

const ROW_H = 42;

type Scope = "season" | "all";

const SCOPE_OPTIONS = [
  { key: "season", label: "One season", desc: "Every conference in the tab's season. [ and ] walk the seasons." },
  { key: "all", label: "Every season", desc: "Every conference-season, each colored against its own season." },
];

const SPLIT_OPTIONS = CONF_SPLITS.map((s) => ({
  key: s.key,
  label: s.key === "full" ? "Full season" : s.key === "conf" ? "Conference games" : "Non-conference games",
  desc:
    s.key === "full"
      ? "Every game the league's teams played."
      : s.key === "conf"
        ? "League games only: a conference mostly playing itself."
        : "Games outside the league.",
}));

/** The rule, said once, as the site says it in its note row. */
const NOTE: Record<string, string> = {
  full: "Each conference minus its bottom two teams by adjusted net.",
  conf: "League games only, so a conference is mostly playing itself: the margin that remains is what the rest of the league does to the two teams each row drops.",
  nonconf: "Non-conference games only. Each conference still drops its bottom two teams by adjusted net.",
};

const shapePack = (json: string): ConfPack => JSON.parse(json) as ConfPack;
const shapeSplits = (json: string): ConfSplitPack => JSON.parse(json) as ConfSplitPack;
const rowKey = (r: ConfRow) => `${r.year}|${r.conf}`;
/** The site's tie-break: newest season first, then the conference code. */
const tieBreak = (a: ConfRow, b: ConfRow) => b.year - a.year || a.conf.localeCompare(b.conf);
const confName = (r: ConfRow) => confDisplay(r.conf) || r.conf;
const isString = (v: unknown): v is string => typeof v === "string";
const isScope = (v: unknown): v is Scope => v === "season" || v === "all";

const FULL = confReader("full", null);
const PEEK_COLS = ["a_net", "a_ortg", "a_drtg"].map((k) => confCol(k)!);
/** Stats with no better end: tempo and pace. */
const NEUTRAL = new Set(["adjt", "cbb_pace"]);

export function ConferencesView({ year, setYear, query, setQuery }: ViewProps) {
  const { openView } = useShell();
  const setStatus = useSetStatus();
  const [state, retry] = useCorpus("conference-rankings", SEASON_CEIL, shapePack);
  const [viewKey, setViewKey] = usePersisted("bta.conferences.view", "overview", isString);
  const [split, setSplit] = usePersisted("bta.conferences.split", "full", isString);
  const [scope, setScope] = usePersisted<Scope>("bta.conferences.scope", "season", isScope);

  // The splits are a second file, fetched the first time one is picked, as on the site.
  const [splitState] = useLoaded(split === "full" ? "conference-splits|none" : `conference-splits|${SEASON_CEIL}`, async () => {
    if (split === "full") return { value: null, source: "memory" as const };
    const { json, source } = await window.bta.data("conference-splits", SEASON_CEIL);
    return { value: shapeSplits(json), source };
  });

  const pack = state.status === "ready" ? state.value : null;
  const splitPack = splitState.status === "ready" ? splitState.value : null;
  const splitKey = CONF_SPLITS.some((s) => s.key === split) ? split : "full";

  // A view the split cannot fill falls back to the first one it can, as on the site.
  const offered = confViewsFor(splitKey);
  const view = offered.find((v) => v.key === viewKey) ?? offered[0]!;
  const cols = useMemo(() => confViewCols(view, splitKey), [view, splitKey]);
  const bands = useMemo(() => confViewBands(view, splitKey), [view, splitKey]);
  const read = useMemo(() => confReader(splitKey, splitPack), [splitKey, splitPack]);

  const cohort = useMemo(
    () => (!pack ? [] : scope === "all" ? pack.rows : pack.rows.filter((r) => r.year === year)),
    [pack, scope, year],
  );
  const pcts = useMemo(() => confPercentiles(cohort, cols, read), [cohort, cols, read]);
  const peekPcts = useMemo(() => (pack ? confPercentiles(pack.rows, PEEK_COLS, FULL) : null), [pack]);
  const rows = useMemo(
    () => cohort.filter((r) => matchesQuery(query, confName(r), r.conf, scope === "all" ? seasonLabel(r.year) : "")),
    [cohort, query, scope],
  );

  // Focus lights a conference: the one focused, or a focused team's or player's.
  const focusSubject = useFocusSubject();
  const spotKey = useMemo(() => {
    const c = focusConf(focusSubject);
    if (!c || !focusSubject) return null;
    const hit = cohort.find((r) => (scope !== "all" || r.year === focusSubject.year) && (r.conf === c.conf || confName(r) === c.label));
    return hit ? rowKey(hit) : null;
  }, [cohort, focusSubject, scope]);

  // The view's own sort, or the first column a split kept. Nothing sorts by a
  // column the table does not show.
  const sortKey = cols.some((c) => c.key === view.sortBy) ? view.sortBy : (cols[0]?.key ?? "conf");

  const columns = useMemo<Column<ConfRow>[]>(() => {
    const bandOf = new Map<string, { label: string; accent: boolean }>();
    for (const b of bands) for (const k of b.keys) bandOf.set(k, { label: b.label, accent: !!b.accent });
    const out: Column<ConfRow>[] = [
      {
        key: "pos", label: "#", title: "Position in this sort", width: 44, align: "right", first: 1, pin: true,
        cell: (_r, i) => <span className="text-ink-muted tabular">{i + 1}</span>,
      },
      {
        key: "conf", label: "Conference", width: 212, align: "left", first: 1, pin: true,
        sortValue: confName,
        cell: (r) => (
          <span className="flex min-w-0 items-center gap-2.5">
            <ConfLogo conf={r.conf} size={22} />
            <span className="truncate font-medium text-ink">{confName(r)}</span>
            {POWER_CONFS.has(r.conf) && (
              <span className="shrink-0 rounded-[4px] bg-paper-deep px-1 py-px text-[10px] font-medium text-ink-muted">Power</span>
            )}
          </span>
        ),
      },
    ];
    if (scope === "all") {
      out.push({
        key: "year", label: "Season", width: 72, align: "left", first: -1,
        sortValue: (r) => r.year,
        cell: (r) => <span className="text-ink-soft tabular">{seasonLabel(r.year)}</span>,
      });
    }
    out.push({
      key: "teams", label: "Teams", width: 62, align: "right", first: -1,
      title: "Teams counted, of the conference's total. The bottom two by adjusted net are dropped; Peek shows which.",
      sortValue: (r) => r.teams,
      cell: (r) => (
        <span className="tabular" title={r.dropped.length ? `Dropped: ${r.dropped.join(", ")}` : undefined}>
          <span className="text-ink-soft">{r.kept}</span>
          <span className="text-ink-muted">/{r.teams}</span>
        </span>
      ),
    });
    for (const c of cols) {
      const band = bandOf.get(c.key);
      out.push({
        key: c.key,
        label: c.label,
        title: c.title,
        // Room for the label and the sort arrow beside it.
        width: Math.min(128, Math.max(70, Math.round(c.label.length * 7.2 + 40))),
        align: "right",
        first: c.lowerBetter ? 1 : -1,
        band: band?.label,
        bandAccent: band?.accent,
        sortValue: (r) => read(r, c.key),
        cell: (r) => {
          // THE CHAMPION AS A CREST, as the site draws it: the column's only
          // non-zero value is 1, and the crest answers "who?".
          if (c.key === "ncaa_nc") {
            const champ = typeof r.ncaa_champ === "string" ? r.ncaa_champ : null;
            return champ ? (
              <span title={`${champ}, national champion`}>
                <TeamLogo id={logoIdOf(champ)} name={champ} size={22} />
              </span>
            ) : (
              <span className="text-ink-muted">—</span>
            );
          }
          const v = read(r, c.key);
          // Pace has no good end, as the Team Explorer paints tempo: the chip
          // says how unusual, in the ramp's neutral middle.
          return (
            <StatCell
              value={fmtConfValue(v, c.fmt)}
              pct={c.noPct ? null : (pcts.get(c.key)?.get(rowKey(r)) ?? null)}
              neutral={NEUTRAL.has(c.key)}
            />
          );
        },
      });
    }
    return out;
  }, [bands, cols, scope, read, pcts]);

  const highlightsFor = (r: ConfRow): ConfHighlight[] =>
    PEEK_COLS.map((c) => ({
      label: c.label,
      title: c.title,
      value: fmtConfValue(FULL(r, c.key), c.fmt),
      pct: peekPcts?.get(c.key)?.get(rowKey(r)) ?? null,
    }));

  useEffect(() => {
    if (state.status === "ready") setStatus(`${SOURCE_LABEL[state.source]} in ${state.ms} ms`);
    else if (state.status === "loading") setStatus("Loading…");
  }, [state, setStatus]);

  const seasons = pack?.seasons ?? [];
  const hasSeason = seasons.includes(year);
  const noun = scope === "all" ? "conference-seasons" : "conferences";
  useTabTitle(query.trim() ? `Conferences: ${query.trim()}` : null);

  // ── Download: the site's file, read off the table, split and percentiles included ──
  const env = useActionEnv();
  const handle = useRef<TableHandle<ConfRow> | null>(null);
  const exportEntity = useMemo(() => conferenceExportEntity(read, pcts), [read, pcts]);
  const exportRows = () => handle.current?.rows ?? rows;
  const metaFor = (viewLabel: string): ExportMeta => {
    const sort = handle.current?.sort;
    const col = sort ? columns.find((c) => c.key === sort.key) : undefined;
    return {
      viewLabel,
      seasons: scope === "all" ? `${seasons.length} seasons` : exportSeasonLabel(year),
      conference: "All conferences",
      teams: "Each conference minus its bottom 2 by NET",
      filters: [CONF_SPLITS.find((s) => s.key === splitKey)?.label ?? "Full Season"],
      sort: sortText(col?.label, sort?.dir ?? -1),
      search: query.trim(),
      url: `${EXPORT_ORIGIN}/conferences`,
    };
  };
  const buildExport = (): ExportInput<ConfRow> => ({ cols: conferenceExportCols(view, splitKey), rows: exportRows(), entity: exportEntity, meta: metaFor(view.label) });
  const buildExportAll = (keys: string[]): MultiExportInput<ConfRow> => {
    const chosen = offered.filter((v) => keys.includes(v.key));
    return {
      sheets: chosen.map((v) => ({ name: v.label, cols: conferenceExportCols(v, splitKey) })),
      rows: exportRows(),
      entity: exportEntity,
      meta: metaFor("Multiple views"),
      slug: chosen.length === offered.length ? "all-views" : "views",
    };
  };
  const meta = pack
    ? `${query.trim() && rows.length !== cohort.length ? `${rows.length} of ${cohort.length}` : cohort.length} ${noun}`
    : undefined;

  return (
    <>
      <ViewHeader
        kicker="Teams"
        title="Conference Power Rankings"
        year={year}
        setYear={setYear}
        meta={meta}
        controls={
          <>
            <Picker
              label="View"
              value={view.key}
              options={offered.map((v) => ({ key: v.key, label: v.label, desc: v.desc }))}
              onChange={setViewKey}
            />
            <Picker label="Games" value={splitKey} options={SPLIT_OPTIONS} onChange={setSplit} />
            <Picker label="Seasons" value={scope} options={SCOPE_OPTIONS} onChange={(k) => setScope(isScope(k) ? k : "season")} />
          </>
        }
        filter={{ value: query, onChange: setQuery, placeholder: "Filter conferences" }}
        actions={
          <DownloadMenu
            rows={rows.length}
            columns={exportFields(conferenceExportCols(view, splitKey), exportEntity).length}
            views={offered.map((v) => ({ key: v.key, label: v.label, desc: v.desc }))}
            buildExport={buildExport}
            buildExportAll={buildExportAll}
            copyTable={() => {
              const h = handle.current;
              if (h) env.copyTable(h.tsv(), h.rows.length);
            }}
          />
        }
      />
      <p className="flex h-[30px] shrink-0 items-center border-t border-hairline px-5 text-[12px] text-ink-muted">
        <span className="truncate" title={NOTE[splitKey]}>
          {NOTE[splitKey]}
        </span>
      </p>
      <div className="relative min-h-0 flex-1 border-t border-hairline">
        {state.status === "error" ? (
          <LoadError year={year} reason={state.reason} message={state.message} what="Conference rankings" onRetry={retry} />
        ) : splitState.status === "error" ? (
          <LoadError year={year} reason="failed" message={splitState.message} what="The game splits" onRetry={retry} />
        ) : !pack || (splitKey !== "full" && !splitPack) ? (
          <TableSkeleton rowHeight={ROW_H} label="Loading conferences" />
        ) : scope === "season" && !hasSeason ? (
          <div className="grid h-full place-content-center gap-2 px-6 text-center">
            <p className="text-[14px] font-medium text-ink">No conference rankings for {seasonLabel(year)}.</p>
            <p className="mx-auto max-w-[48ch] text-[12.5px] text-ink-muted">
              The rankings cover {seasonLabel(seasons[0]!)} to {seasonLabel(seasons[seasons.length - 1]!)}
              {seasons.length < seasons[seasons.length - 1]! - seasons[0]! + 1 ? ", without 2020-21" : ""}. Pick another season, or
              every season at once.
            </p>
          </div>
        ) : (
          <DataTable
            key={`${view.key}|${splitKey}|${scope}`}
            rows={rows}
            columns={columns}
            rowKey={rowKey}
            rowHeight={ROW_H}
            defaultSort={{ key: sortKey, dir: view.sortDir === "asc" ? 1 : -1 }}
            tieBreak={tieBreak}
            ariaLabel="Conferences"
            empty={<NoMatches query={query} noun="conference" />}
            peek={{
              label: (r) => `${confName(r)} ${seasonLabel(r.year)}`,
              body: (r) => <ConferencePeekBody row={r} highlights={highlightsFor(r)} />,
            }}
            id="conferences"
            handle={handle}
            spotlight={spotKey}
            object={(r) => ({ kind: "conference", conf: r.conf, label: confName(r), year: r.year })}
            onOpen={(r, how) => openView("team-explorer", { newTab: how.newTab, side: how.side, year: r.year, query: scopedQuery("conf", confName(r)) })}
          />
        )}
      </div>
    </>
  );
}
