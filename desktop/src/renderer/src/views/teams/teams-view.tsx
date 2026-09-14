import { ListChecks } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StaticTeamSeasonRow } from "@/lib/static-data";
import { TEAM_ENTITY, exportFields, type ExportInput, type MultiExportInput } from "@/lib/table-export";
import { exportColsForView, pinnedColumn, type TeamCol } from "@/lib/team-explorer-columns";
import { FILTER_COLUMNS, GROUP_LABEL, teamStatColumn, type TeamRow } from "@/lib/team-filters";
import { TABLE_VIEWS, viewByKey } from "@/lib/team-views";
import { loadTeamGameSeason } from "~/data/team-game-model";
import { shapeSeason, type Season, type Team } from "~/data/team-model";
import { loadOnce, SOURCE_LABEL, useCorpus } from "~/data/use-corpus";
import type { Obj } from "~/objects/object";
import { useActionEnv } from "~/objects/use-object-actions";
import { focusTeam, useFocusSubject } from "~/focus/focus-mode";
import { teamLens } from "~/lens/stat-lens";
import { useEcho, useSelection, type SelectMode } from "~/selection/selection";
import { Picker } from "~/shell/picker";
import { useTabTitle } from "~/shell/tab-title";
import { useSetStatus } from "~/shell/status";
import { LoadError, NoMatches, TableSkeleton, ViewHeader } from "~/shell/view-parts";
import type { ViewProps } from "~/shell/views";
import { DataTable, type Column, type TableHandle } from "~/table/data-table";
import { DownloadMenu, SaveViewButton } from "~/table/download-menu";
import { exportMeta, sortText } from "~/table/export-meta";
import { FilterRows, TableBar } from "~/table/filter-rows";
import { conferenceOptions, ScopeSelect, type ScopeOption } from "~/table/scope-select";
import { StatCell } from "~/table/stat-cell";
import { catalogStats, conditionTest, filterHelp, filterProblem, parseFilter, pinnedStatKeys, sortedNames, statIndex } from "~/ui/filter-query";
import { seasonLabel, signed1 } from "~/ui/format";
import { TeamLogo } from "~/ui/logo";
import { nameIn, sameName, scopedNames, scopedQuery, type Scope } from "~/ui/scoped-query";
import { matchesQuery, normalizeText } from "~/ui/text";
import { TeamPeekBody } from "./team-peek";

/**
 * Team Explorer: every team in a season, as the site's explorer shows them.
 *
 * THE SITE'S TABLE, COLUMN FOR COLUMN. The fourteen views and their bands are
 * src/lib/team-views.ts, each column is src/lib/team-explorer-columns.ts, and
 * the numbers and percentile chips are the site's own processTeams row. Stats a
 * reader adds lead the table as "Your columns", and a stat filtered on is added
 * the moment it is, as on the site.
 *
 * THE FILTERS ARE WORDS. Team and Conference pickers, the filter rows and Add
 * columns all write the filter box ("conf: SEC net>20 tempo<68"), and the view
 * and added columns ride with the tab, so favorites, history and Esc keep all of
 * it (~/ui/filter-query.ts, ~/shell/table-layout.ts).
 *
 * A ROW IS A TEAM OBJECT, so its menu, C, F, drag and Enter are the registry's
 * (~/objects/actions.tsx), and its picked rows are the shared selection that
 * Team Scatter and every other team view read.
 *
 * DOWNLOAD writes the site's files: the formatted workbook, one tab per view,
 * or the raw CSV (~/table/download-menu.tsx).
 */

const ROW_H = 42;
const MINUS = "−";

const shapeTeams = (json: string, year: number): Season => shapeSeason(year, JSON.parse(json) as StaticTeamSeasonRow[]);
const teamKey = (t: Team) => t.id;
const byBtaRank = (a: Team, b: Team) => (a.btaRank ?? 1e9) - (b.btaRank ?? 1e9);

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const statOf = (t: Team, key: string): number | null => num((t.explorer as Record<string, unknown> | null)?.[key]);

/** What "net>20" can name: the BTA rank, and every stat the site's explorer filters on, by its header. */
const TEAM_STATS = statIndex<Team>([
  { name: "rank", aliases: ["bta", "btarank"], label: "BTA rank", digits: 0, get: (t) => t.btaRank },
  ...catalogStats(FILTER_COLUMNS, {
    get: (c) => (t: Team) => statOf(t, c.key),
    fmt: (c) =>
      c.format === "pct1" || c.format === "pct0"
        ? "pct1"
        : c.format === "int" || c.format === "rank"
          ? "int"
          : c.format === "num2" || c.format === "num3"
            ? c.format
            : "num1",
    desc: (c) => c.desc,
    group: (c) => GROUP_LABEL[c.group],
    aliases: {
      a_net: ["net", "adjnet"],
      a_ortg: ["adjo", "ortg"],
      a_drtg: ["adjd", "drtg"],
      adjt: ["tempo"],
      cbb_efg_def: ["efgd"],
      cbb_orb: ["orb"],
      cbb_fg3: ["fg3", "3pt"],
      wins: ["w"],
      losses: ["l"],
    },
  }),
]);
const TEAM_SCOPES: Scope[] = ["team", "teams", "conf", "opponents"];
const NO_OPPONENTS: Set<string>[] = [];

/** The two pickers' list: every stat that can stand as a column, in the site's sections. */
const PICKS = TEAM_STATS.all.flatMap((s) => (s.key && pinnedColumn(s.key) ? [{ key: s.key, label: s.label, desc: s.desc, group: s.group }] : []));

const VIEW_OPTIONS = TABLE_VIEWS.map((v) => ({ key: v.key, label: v.label, desc: v.desc, group: v.group }));
/** An empty view is no tab in a workbook, as on the site. */
const DOWNLOAD_VIEWS = TABLE_VIEWS.filter((v) => !v.custom).map((v) => ({ key: v.key, label: v.label, desc: v.desc, group: v.group }));

/** Margins and ratings that read with their sign. */
const SIGNED = new Set(["a_net", "prev_a_net", "wab"]);
/** Chips in the ramp's middle band: how fast is unusual or ordinary, never good or bad. */
const NEUTRAL = new Set(["adjt", "cbb_pace"]);

const signed = (v: number, digits: number) => `${v > 0 ? "+" : v < 0 ? MINUS : ""}${Math.abs(v).toFixed(digits)}`;

/** A cell as the app prints it: the header carries the %, and a missing total falls back to its per-game figure. */
function shown(c: TeamCol, t: Team): string {
  const v = statOf(t, c.total as string);
  if (v == null) {
    const pg = c.perGame ? statOf(t, c.perGame as string) : null;
    return pg == null ? "–" : `${signed(pg, 1)}/g`;
  }
  if (c.fmt === "pct1") return (v * 100).toFixed(1);
  if (c.fmt === "int") return Math.round(v).toLocaleString();
  if (c.fmt === "signed") return signed(v, teamStatColumn(c.total as string)?.format === "num2" ? 2 : 0);
  return SIGNED.has(c.total as string) ? signed1(v) : v.toFixed(1);
}

function statColumn(c: TeamCol, band: string, accent: boolean): Column<Team> {
  const key = c.total as string;
  return {
    key,
    label: c.label,
    title: c.title,
    width: Math.max(64, Math.round(c.label.length * 7.7) + 40),
    align: "right",
    first: c.lowerBetter ? 1 : -1,
    band,
    bandAccent: accent,
    sortValue: (t) => statOf(t, key) ?? (c.perGame ? statOf(t, c.perGame as string) : null),
    cell: (t) => <StatCell value={shown(c, t)} pct={t.explorer?.pct[c.pct] ?? null} strong={key === "a_net"} neutral={NEUTRAL.has(key)} />,
    text: (t) => shown(c, t),
  };
}

const IDENTITY: Column<Team>[] = [
  {
    key: "rank", label: "#", title: "BTA rank", width: 48, align: "right", first: 1, pin: true,
    sortValue: (t) => t.btaRank,
    cell: (t) => <span className="text-ink-muted tabular">{t.btaRank ?? "–"}</span>,
  },
  {
    key: "name", label: "Team", width: 216, align: "left", first: 1, pin: true,
    sortValue: (t) => t.name,
    cell: (t) => (
      <span className="flex min-w-0 items-center gap-2">
        <TeamLogo id={t.logoId} name={t.name} size={20} />
        <span className="truncate font-medium text-ink">{t.name}</span>
      </span>
    ),
  },
  {
    key: "conf", label: "Conf", width: 100, align: "left", first: 1,
    sortValue: (t) => t.confLabel,
    cell: (t) => <span className="block truncate text-ink-soft">{t.confLabel}</span>,
  },
  {
    key: "record", label: "W-L", width: 64, align: "right", first: -1,
    sortValue: (t) => t.wins - t.losses,
    cell: (t) => <StatCell value={`${t.wins}-${t.losses}`} pct={t.pct.win_pct} />,
    text: (t) => `${t.wins}-${t.losses}`,
  },
];

/** Who each named team played in a season, read off the Team Game Log's file when a filter asks; null while it loads. */
function useOpponents(year: number, teams: string[]): Set<string>[] | null {
  const [found, setFound] = useState<{ key: string; sets: Set<string>[] } | null>(null);
  const key = `${year}|${teams.join("|")}`;
  useEffect(() => {
    if (teams.length === 0) return;
    let stale = false;
    loadOnce(`team-games|${year}`, () => loadTeamGameSeason(year)).then(
      (s) => {
        if (!stale) setFound({ key, sets: teams.map((team) => new Set(s.games.filter((g) => sameName(g.team, team)).map((g) => g.opp))) });
      },
      () => {
        if (!stale) setFound({ key, sets: teams.map(() => new Set()) });
      },
    );
    return () => {
      stale = true;
    };
    // `teams` is read through `key`, which changes exactly when it does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, key]);
  if (teams.length === 0) return NO_OPPONENTS;
  return found?.key === key ? found.sets : null;
}

export function TeamsView({ year, setYear, query, setQuery, focus, onLanded, table, setTable, saved, toggleSaved }: ViewProps) {
  const [state, retry] = useCorpus("teams", year, shapeTeams);
  const setStatus = useSetStatus();
  const env = useActionEnv();
  useTabTitle(query.trim() ? `Teams: ${query.trim()}` : null);
  const { namesIn, select, clear } = useSelection();
  const picked = namesIn(year);
  const [onlyPicked, setOnlyPicked] = useState(false);
  const { nameIn: echoIn, publish } = useEcho();
  const handle = useRef<TableHandle<Team> | null>(null);

  const season = state.status === "ready" ? state.value : null;
  const view = viewByKey(table.view);
  const cols = useMemo(() => table.cols ?? [], [table.cols]);
  const parsed = useMemo(() => parseFilter(query), [query]);
  const pinned = useMemo(() => pinnedStatKeys(query, cols, TEAM_STATS), [query, cols]);
  const opponentsOf = parsed.scopes.filter((s) => s.scope === "opponents").map((s) => s.value);
  const opponents = useOpponents(year, opponentsOf);
  // A Ctrl K result for a team in this season, and its row if the season has one.
  const target = focus?.kind === "team" && focus.year === year ? focus : null;
  const landing = target && season ? season.teams.find((t) => t.name === target.name) : undefined;

  const rows = useMemo(() => {
    if (!season) return [];
    const base = onlyPicked && picked.size > 0 ? season.teams.filter((t) => picked.has(t.name)) : season.teams;
    if (!opponents) return [];
    let nth = 0;
    const scopes = parsed.scopes.map((s): ((t: Team) => boolean) => {
      const v = s.value;
      if (s.scope === "conf") return (t) => nameIn(v, t.confLabel, t.conf);
      if (s.scope === "team") return (t) => sameName(t.name, v);
      if (s.scope === "teams") {
        const names = new Set(scopedNames(v).map(normalizeText));
        return (t) => names.has(normalizeText(t.name));
      }
      if (s.scope === "opponents") {
        const played = opponents[nth++];
        return (t) => !!played?.has(t.name);
      }
      return () => false;
    });
    const stats = conditionTest(TEAM_STATS, parsed.conditions);
    return base.filter(
      (t) => matchesQuery(parsed.words, t.name, t.confLabel, t.conf) && scopes.every((f) => f(t)) && (!stats || stats(t)),
    );
  }, [season, parsed, opponents, onlyPicked, picked]);

  const columns = useMemo(() => {
    const inView = new Set<string>(view.bands.flatMap((b) => b.keys as string[]));
    const out = [...IDENTITY];
    // A stat the view already shows keeps its place in the view's band, as on the site.
    for (const k of pinned) {
      const c = inView.has(k) ? null : pinnedColumn(k);
      if (c) out.push(statColumn(c, "Your columns", true));
    }
    for (const b of view.bands) {
      for (const k of b.keys) {
        const c = pinnedColumn(k);
        if (c) out.push(statColumn(c, b.label, !!b.accent));
      }
    }
    return out;
  }, [view, pinned]);

  const help = useMemo(() => {
    if (!season) return undefined;
    const byRank = () => [...season.teams].sort(byBtaRank).map((t) => t.name);
    return filterHelp({
      noun: "teams",
      index: TEAM_STATS,
      rows: season.teams,
      scopes: TEAM_SCOPES,
      names: { team: byRank, teams: byRank, opponents: byRank, conf: () => sortedNames(season.teams.map((t) => t.confLabel)) },
    });
  }, [season]);

  const teamOptions = useMemo<ScopeOption[]>(
    () => (season ? [...season.teams].sort(byBtaRank).map((t) => ({ name: t.name, meta: t.confLabel, keywords: t.conf })) : []),
    [season],
  );
  const confOptions = useMemo(() => conferenceOptions(season?.teams ?? []), [season]);

  useEffect(() => {
    if (state.status === "ready") setStatus(`${SOURCE_LABEL[state.source]} in ${state.ms} ms`);
    else if (state.status === "loading") setStatus("Loading…");
    else setStatus("Not loaded");
  }, [state, setStatus]);

  const selection = useMemo(
    () => ({
      isSelected: (t: Team) => picked.has(t.name),
      change: (list: Team[], mode: SelectMode) => select(year, list.map((t) => t.name), mode),
      clear,
      size: picked.size,
    }),
    [picked, select, clear, year],
  );
  const onFocusRow = useCallback((t: Team | undefined) => publish(year, t?.name ?? null), [publish, year]);
  const echoName = echoIn(year);
  const echoKey = echoName && season ? (season.teams.find((t) => t.name === echoName)?.id ?? null) : null;
  // Focus lights the focused team's row, or a focused player's team; a conference narrows the table instead.
  const focusName = focusTeam(useFocusSubject());
  const spotKey = focusName && season ? (season.teams.find((t) => t.name === focusName)?.id ?? null) : null;

  const total = season?.teams.length ?? 0;
  const meta = !season
    ? undefined
    : target && !landing
      ? `${target.name} has no row in ${seasonLabel(year)}`
      : !opponents
        ? "Finding opponents…"
        : opponentsOf.length === 1 && parsed.clauses.length === 1
          ? `${rows.length} opponents of ${opponentsOf[0]}`
          : `${rows.length !== total ? `${rows.length} of ${total}` : total} teams${picked.size > 0 ? ` · ${picked.size} selected` : ""} · Final`;

  const object = (t: Team): Obj => ({ kind: "team", name: t.name, logoId: t.logoId, year, conf: t.conf });
  // Alt-click or right-click a number: the games behind it.
  const statLens = useCallback(
    (t: Team, key: string) => {
      const col = columns.find((c) => c.key === key);
      const value = col?.text?.(t, 0);
      return teamLens(key, { kind: "team", name: t.name, logoId: t.logoId, year }, col && typeof value === "string" ? { label: col.label, value } : undefined);
    },
    [columns, year],
  );

  // ── Download: the site's files, built on click from the table as it stands ──
  const exportRows = (): TeamRow[] => (handle.current?.rows ?? rows).flatMap((t) => (t.explorer ? [t.explorer] : []));
  const metaFor = (viewLabel: string) => {
    const sort = handle.current?.sort;
    const col = sort ? columns.find((c) => c.key === sort.key) : undefined;
    return exportMeta({
      viewLabel,
      year,
      query,
      index: TEAM_STATS,
      sort: sortText(col?.label, sort?.dir ?? -1),
      path: `/?ys=${year}${view.key !== "overview" ? `&view=${view.key}` : ""}${pinned.length ? `&cols=${pinned.join(",")}` : ""}`,
    });
  };
  const buildExport = (): ExportInput<TeamRow> => ({ cols: exportColsForView(view, pinned), rows: exportRows(), entity: TEAM_ENTITY, meta: metaFor(view.label) });
  const buildExportAll = (keys: string[]): MultiExportInput<TeamRow> => {
    const chosen = TABLE_VIEWS.filter((v) => keys.includes(v.key));
    return {
      sheets: chosen.map((v) => ({ name: v.label, cols: exportColsForView(v, pinned) })),
      rows: exportRows(),
      entity: TEAM_ENTITY,
      meta: metaFor("Multiple views"),
      slug: chosen.length === DOWNLOAD_VIEWS.length ? "all-views" : chosen.length === 1 ? chosen[0]!.label : `${chosen.length}-views`,
    };
  };
  const exportColumns = exportFields(exportColsForView(view, pinned), TEAM_ENTITY).length;
  const saveLabel = `Teams, ${view.label}${query.trim() ? ` · ${query.trim()}` : ""}`;

  return (
    <>
      <ViewHeader
        kicker="Teams"
        title="Team Explorer"
        year={year}
        setYear={setYear}
        meta={meta}
        controls={
          <>
            <Picker label="View" value={view.key} options={VIEW_OPTIONS} onChange={(key) => setTable({ ...table, view: key === "overview" ? undefined : key })} />
            {picked.size > 0 && (
              <button
                type="button"
                aria-pressed={onlyPicked}
                title="Show only the selected teams"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setOnlyPicked((v) => !v)}
                className={`inline-flex h-[26px] items-center gap-1.5 rounded-md border px-2 text-[12.5px] transition-colors ${
                  onlyPicked
                    ? "border-[color-mix(in_oklab,var(--accent)_45%,var(--hairline))] bg-[var(--accent-wash)] text-ink"
                    : "border-hairline bg-card text-ink-soft hover:border-ink-muted hover:text-ink"
                }`}
              >
                <ListChecks size={13} strokeWidth={2} />
                Selected only
                <span className="text-ink-muted tabular">{picked.size}</span>
              </button>
            )}
          </>
        }
        filter={{ value: query, onChange: setQuery, placeholder: "Filter teams", help }}
        actions={
          <>
            <SaveViewButton saved={saved} onToggle={() => toggleSaved(saveLabel)} />
            <DownloadMenu
              rows={rows.length}
              columns={exportColumns}
              views={DOWNLOAD_VIEWS}
              buildExport={buildExport}
              buildExportAll={buildExportAll}
              copyTable={() => {
                const h = handle.current;
                if (h) env.copyTable(h.tsv(), h.rows.length);
              }}
            />
          </>
        }
      />
      {help && (
        <TableBar>
          <ScopeSelect
            label="Team"
            scopes={["team", "teams"]}
            options={teamOptions}
            query={query}
            setQuery={setQuery}
            write={(names) => (names.length === 1 ? scopedQuery("team", names[0]!) : scopedQuery("teams", names.join(", ")))}
          />
          <ScopeSelect label="Conference" scopes={["conf"]} options={confOptions} query={query} setQuery={setQuery} write={(names) => scopedQuery("conf", names.join(", "))} />
          <span aria-hidden className="mx-1 h-4 w-px bg-hairline" />
          <FilterRows
            help={help}
            stats={PICKS}
            query={query}
            setQuery={setQuery}
            cols={cols}
            setCols={(next) => setTable({ ...table, cols: next.length > 0 ? next : undefined })}
          />
        </TableBar>
      )}
      <div className="relative min-h-0 flex-1 border-t border-hairline">
        {state.status === "ready" ? (
          <DataTable
            key={`${year}:${view.key}`}
            id="team-explorer"
            rows={rows}
            columns={columns}
            rowKey={teamKey}
            rowHeight={ROW_H}
            defaultSort={{ key: view.sortBy, dir: view.sortDir === "asc" ? 1 : -1 }}
            tieBreak={byBtaRank}
            ariaLabel="Teams"
            empty={
              onlyPicked && picked.size > 0 ? (
                <p className="px-5 py-10 text-[13px] text-ink-muted">None of the selected teams match the filter.</p>
              ) : (
                <NoMatches query={query} noun="team or conference" problem={filterProblem(parsed, TEAM_STATS, TEAM_SCOPES)} />
              )
            }
            peek={{ label: (t) => t.name, body: (t) => <TeamPeekBody season={state.value} team={t} /> }}
            landOn={landing && target ? { key: landing.id, nonce: target.nonce } : undefined}
            onLanded={onLanded}
            object={object}
            selection={selection}
            echo={echoKey}
            spotlight={spotKey}
            statLens={statLens}
            onFocusRow={onFocusRow}
            handle={handle}
          />
        ) : state.status === "loading" ? (
          <TableSkeleton rowHeight={ROW_H} label="Loading teams" />
        ) : (
          <LoadError year={year} reason={state.reason} message={state.message} what="Teams" onRetry={retry} />
        )}
      </div>
    </>
  );
}
