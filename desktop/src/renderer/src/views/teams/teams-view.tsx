import { ListChecks } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StaticTeamSeasonRow } from "@/lib/static-data";
import { TEAM_ENTITY, exportFields, exportSeasonLabel, type ExportInput, type MultiExportInput } from "@/lib/table-export";
import { exportColsForView, pinnedColumn, type TeamCol } from "@/lib/team-explorer-columns";
import { FILTER_COLUMNS, GROUP_LABEL, teamStatColumn, type TeamRow } from "@/lib/team-filters";
import { TABLE_VIEWS, viewByKey } from "@/lib/team-views";
import { loadTeamGameSeason } from "~/data/team-game-model";
import { shapeSeason, type Season, type Team } from "~/data/team-model";
import { loadOnce, SOURCE_LABEL, useLoadedMany } from "~/data/use-corpus";
import type { Obj } from "~/objects/object";
import { useActionEnv } from "~/objects/use-object-actions";
import { focusTeam, useFocusSubject } from "~/focus/focus-mode";
import { teamLens } from "~/lens/stat-lens";
import { useEcho, useSelection, type SelectMode } from "~/selection/selection";
import { Picker } from "~/shell/picker";
import { seasonsLabel } from "~/shell/season-switcher";
import { tableSeasons } from "~/shell/table-layout";
import { useTabTitle } from "~/shell/tab-title";
import { useSetStatus } from "~/shell/status";
import { LoadError, NoMatches, TableSkeleton, ViewHeader } from "~/shell/view-parts";
import type { ViewProps } from "~/shell/views";
import { DataTable, type Column, type TableHandle } from "~/table/data-table";
import { DownloadMenu, SaveViewButton } from "~/table/download-menu";
import { exportMeta, sortText } from "~/table/export-meta";
import { FilterRows, TableBar } from "~/table/filter-rows";
import { conferenceOptions, ScopeSelect, type ScopeOption } from "~/table/scope-select";
import { SEASON_COLUMN_TITLE, SeasonCell } from "~/table/season-cell";
import { StatCell } from "~/table/stat-cell";
import { catalogStats, conditionTest, filterHelp, filterProblem, parseFilter, pinnedStatKeys, sortedNames, statIndex } from "~/ui/filter-query";
import { seasonLabel, signed1 } from "~/ui/format";
import { TeamLogo } from "~/ui/logo";
import { nameIn, sameName, scopedNames, scopedQuery, type Scope } from "~/ui/scoped-query";
import { matchesQuery, normalizeText } from "~/ui/text";
import { TeamPeekBody } from "./team-peek";

/**
 * Team Explorer: every team in a season, or in several, as the site's explorer
 * shows them.
 *
 * THE SITE'S TABLE, COLUMN FOR COLUMN. The fourteen views and their bands are
 * src/lib/team-views.ts, each column is src/lib/team-explorer-columns.ts, and
 * the numbers and percentile chips are the site's own processTeams row. Stats a
 * reader adds lead the table as "Your columns", and a stat filtered on is added
 * the moment it is, as on the site.
 *
 * ONE SEASON, SEVERAL, OR ALL, as the site's explorer picks them. With more than
 * one, the rows are team-seasons: a Season column appears, each row keeps its
 * own season's percentiles and BTA rank (never pooled), and the shared team
 * selection, which belongs to one season, steps aside until one season is back.
 *
 * THE FILTERS ARE WORDS. Team and Conference pickers, the filter rows and Add
 * columns all write the filter box ("conf: SEC net>20 tempo<68"), and the view,
 * added columns and seasons ride with the tab, so favorites, history and Esc
 * keep all of it (~/ui/filter-query.ts, ~/shell/table-layout.ts).
 *
 * A ROW IS A TEAM OBJECT, so its menu, C, F, drag and Enter are the registry's
 * (~/objects/actions.tsx), and in one season its picked rows are the shared
 * selection that Team Scatter and every other team view read.
 *
 * DOWNLOAD writes the site's files: the formatted workbook, one tab per view,
 * or the raw CSV (~/table/download-menu.tsx).
 */

const ROW_H = 42;
const MINUS = "−";

const loadTeams = async (key: string) => {
  const year = Number(key.slice(key.indexOf("|") + 1));
  const { json, source } = await window.bta.data("teams", year);
  return { value: shapeSeason(year, JSON.parse(json) as StaticTeamSeasonRow[]), source };
};
const teamKey = (t: Team) => `${t.year}|${t.id}`;
const byBtaRank = (a: Team, b: Team) => (a.btaRank ?? 1e9) - (b.btaRank ?? 1e9) || b.year - a.year;
const NO_PICKS: ReadonlySet<string> = new Set();

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
const NO_OPPONENTS = new Map<number, Set<string>[]>();

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
    key: "rank", label: "#", title: "BTA rank, within the row's season", width: 48, align: "right", first: 1, pin: true,
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

const SEASON_COLUMN: Column<Team> = {
  key: "season", label: "Season", title: SEASON_COLUMN_TITLE, width: 84, align: "left", first: -1,
  sortValue: (t) => t.year,
  cell: (t) => <SeasonCell year={t.year} />,
  text: (t) => seasonLabel(t.year),
};

/** Who each named team played, season by season, read off the Team Game Log's files when a filter asks; null while they load. */
function useOpponents(years: readonly number[], teams: string[]): Map<number, Set<string>[]> | null {
  const [found, setFound] = useState<{ key: string; sets: Map<number, Set<string>[]> } | null>(null);
  const key = `${years.join(",")}|${teams.join("|")}`;
  useEffect(() => {
    if (teams.length === 0) return;
    let stale = false;
    void Promise.all(
      years.map((y) =>
        loadOnce(`team-games|${y}`, () => loadTeamGameSeason(y)).then(
          (s): [number, Set<string>[]] => [y, teams.map((team) => new Set(s.games.filter((g) => sameName(g.team, team)).map((g) => g.opp)))],
          (): [number, Set<string>[]] => [y, teams.map(() => new Set<string>())],
        ),
      ),
    ).then((pairs) => {
      if (!stale) setFound({ key, sets: new Map(pairs) });
    });
    return () => {
      stale = true;
    };
    // `years` and `teams` are read through `key`, which changes exactly when they do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (teams.length === 0) return NO_OPPONENTS;
  return found?.key === key ? found.sets : null;
}

const yearOfKey = (key: string) => Number(key.slice(key.indexOf("|") + 1));

export function TeamsView({ year, setYear, query, setQuery, focus, onLanded, table, setTable, savedAs, saveView, unsaveView }: ViewProps) {
  const years = useMemo(() => tableSeasons(table, year), [table, year]);
  const multi = years.length > 1;
  const keys = useMemo(() => years.map((y) => `teams|${y}`), [years]);
  const [many, retry] = useLoadedMany(keys, loadTeams);
  const setStatus = useSetStatus();
  const env = useActionEnv();
  useTabTitle(query.trim() ? `Teams: ${query.trim()}` : multi ? `Teams, ${seasonsLabel(years)}` : null);
  const { namesIn, select, clear } = useSelection();
  const picked = multi ? NO_PICKS : namesIn(year);
  const [onlyPicked, setOnlyPicked] = useState(false);
  const { nameIn: echoIn, publish } = useEcho();
  const handle = useRef<TableHandle<Team> | null>(null);

  const seasons = useMemo<Season[]>(() => many.values.map((v) => v.value), [many]);
  const seasonByYear = useMemo(() => new Map(seasons.map((s) => [s.year, s])), [seasons]);
  const allTeams = useMemo(() => seasons.flatMap((s) => s.teams), [seasons]);
  const loadedAll = many.loading.length === 0;

  // A season stepped to with [ or ] that is not among the picked ones leaves several seasons for that one.
  useEffect(() => {
    if (table.seasons && table.seasons.length > 1 && !table.seasons.includes(year)) setTable({ ...table, seasons: undefined });
  }, [table, year, setTable]);

  const pickSeasons = (next: number[]) => {
    const sorted = [...new Set(next)].sort((a, b) => b - a);
    if (sorted.length === 0) return;
    const anchor = sorted.includes(year) ? year : sorted[0]!;
    if (anchor !== year) setYear(anchor);
    setTable({ ...table, seasons: sorted.length > 1 ? sorted : undefined });
  };

  const view = viewByKey(table.view);
  const cols = useMemo(() => table.cols ?? [], [table.cols]);
  const parsed = useMemo(() => parseFilter(query), [query]);
  const pinned = useMemo(() => pinnedStatKeys(query, cols, TEAM_STATS), [query, cols]);
  const opponentsOf = parsed.scopes.filter((s) => s.scope === "opponents").map((s) => s.value);
  const opponents = useOpponents(years, opponentsOf);
  // A Ctrl K result for a team in one of these seasons, and its row if that season has one.
  const target = focus?.kind === "team" && years.includes(focus.year) ? focus : null;
  const landing = target ? seasonByYear.get(target.year)?.teams.find((t) => t.name === target.name) : undefined;

  const rows = useMemo(() => {
    if (!opponents) return [];
    const base = onlyPicked && picked.size > 0 ? allTeams.filter((t) => picked.has(t.name)) : allTeams;
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
        const i = nth++;
        return (t) => !!opponents.get(t.year)?.[i]?.has(t.name);
      }
      return () => false;
    });
    const stats = conditionTest(TEAM_STATS, parsed.conditions);
    return base.filter(
      (t) => matchesQuery(parsed.words, t.name, t.confLabel, t.conf) && scopes.every((f) => f(t)) && (!stats || stats(t)),
    );
  }, [allTeams, parsed, opponents, onlyPicked, picked]);

  const columns = useMemo(() => {
    const inView = new Set<string>(view.bands.flatMap((b) => b.keys as string[]));
    const out = multi ? [IDENTITY[0]!, IDENTITY[1]!, SEASON_COLUMN, ...IDENTITY.slice(2)] : [...IDENTITY];
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
  }, [view, pinned, multi]);

  const help = useMemo(() => {
    if (allTeams.length === 0) return undefined;
    const byRank = () => [...new Set([...allTeams].sort(byBtaRank).map((t) => t.name))];
    return filterHelp({
      noun: multi ? "team-seasons" : "teams",
      index: TEAM_STATS,
      rows: allTeams,
      scopes: TEAM_SCOPES,
      names: { team: byRank, teams: byRank, opponents: byRank, conf: () => sortedNames(allTeams.map((t) => t.confLabel)) },
    });
  }, [allTeams, multi]);

  const teamOptions = useMemo<ScopeOption[]>(() => {
    const seen = new Map<string, ScopeOption>();
    for (const t of [...allTeams].sort(byBtaRank)) if (!seen.has(t.name)) seen.set(t.name, { name: t.name, meta: t.confLabel, keywords: t.conf });
    return [...seen.values()];
  }, [allTeams]);
  const confOptions = useMemo(() => conferenceOptions(allTeams), [allTeams]);

  useEffect(() => {
    if (many.loading.length > 0) setStatus(multi ? `Loading ${many.loading.length} of ${years.length} seasons…` : "Loading…");
    else if (many.values.length === 0) setStatus("Not loaded");
    else if (!multi) setStatus(`${SOURCE_LABEL[many.values[0]!.source]} in ${many.values[0]!.ms} ms`);
    else setStatus(`${many.values.length} seasons in ${many.values.reduce((s, v) => s + v.ms, 0)} ms`);
  }, [many, multi, years.length, setStatus]);

  const selection = useMemo(
    () => ({
      isSelected: (t: Team) => picked.has(t.name),
      change: (list: Team[], mode: SelectMode) => select(year, list.map((t) => t.name), mode),
      clear,
      size: picked.size,
    }),
    [picked, select, clear, year],
  );
  const onFocusRow = useCallback((t: Team | undefined) => publish(t?.year ?? year, t?.name ?? null), [publish, year]);
  const echoKey = useMemo(() => {
    for (const y of years) {
      const name = echoIn(y);
      const hit = name ? seasonByYear.get(y)?.teams.find((t) => t.name === name) : undefined;
      if (hit) return teamKey(hit);
    }
    return null;
  }, [years, echoIn, seasonByYear]);
  // Focus lights the focused team's row, or a focused player's team; a conference narrows the table instead.
  const focusSubject = useFocusSubject();
  const focusName = focusTeam(focusSubject);
  const spotKey = useMemo(() => {
    if (!focusName) return null;
    const y = focusSubject && years.includes(focusSubject.year) ? focusSubject.year : year;
    const hit = seasonByYear.get(y)?.teams.find((t) => t.name === focusName);
    return hit ? teamKey(hit) : null;
  }, [focusName, focusSubject, years, year, seasonByYear]);

  const total = allTeams.length;
  const noun = multi ? "team-seasons" : "teams";
  const failedNote =
    many.failed.length > 0 && many.values.length > 0 ? ` · ${many.failed.map((f) => seasonLabel(yearOfKey(f.key))).join(", ")} could not load` : "";
  const meta =
    many.values.length === 0 || !loadedAll
      ? undefined
      : target && !landing
        ? `${target.name} has no row in ${seasonLabel(target.year)}`
        : !opponents
          ? "Finding opponents…"
          : opponentsOf.length === 1 && parsed.clauses.length === 1
            ? `${rows.length} opponents of ${opponentsOf[0]}${multi ? ` across ${years.length} seasons` : ""}`
            : `${rows.length !== total ? `${rows.length.toLocaleString()} of ${total.toLocaleString()}` : total.toLocaleString()} ${noun}${
                picked.size > 0 ? ` · ${picked.size} selected` : ""
              } · ${multi ? seasonsLabel(years) : "Final"}${failedNote}`;

  const object = (t: Team): Obj => ({ kind: "team", name: t.name, logoId: t.logoId, year: t.year, conf: t.conf });
  // Alt-click or right-click a number: the games behind it, in that row's season.
  const statLens = useCallback(
    (t: Team, key: string) => {
      const col = columns.find((c) => c.key === key);
      const value = col?.text?.(t, 0);
      return teamLens(key, { kind: "team", name: t.name, logoId: t.logoId, year: t.year }, col && typeof value === "string" ? { label: col.label, value } : undefined);
    },
    [columns],
  );

  // ── Download: the site's files, built on click from the table as it stands ──
  const exportRows = (): TeamRow[] => (handle.current?.rows ?? rows).flatMap((t) => (t.explorer ? [t.explorer] : []));
  const metaFor = (viewLabel: string) => {
    const sort = handle.current?.sort;
    const col = sort ? columns.find((c) => c.key === sort.key) : undefined;
    const m = exportMeta({
      viewLabel,
      year,
      query,
      index: TEAM_STATS,
      sort: sortText(col?.label, sort?.dir ?? -1),
      path: `/?ys=${years.join(",")}${view.key !== "overview" ? `&view=${view.key}` : ""}${pinned.length ? `&cols=${pinned.join(",")}` : ""}`,
    });
    return multi ? { ...m, seasons: years.map(exportSeasonLabel).join(", ") } : m;
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
  const saveLabel = `Teams, ${view.label}${multi ? ` · ${seasonsLabel(years)}` : ""}${query.trim() ? ` · ${query.trim()}` : ""}`;
  const firstFailure = many.failed[0];

  return (
    <>
      <ViewHeader
        kicker="Teams"
        title="Team Explorer"
        year={year}
        setYear={setYear}
        seasons={{ years, onChange: pickSeasons }}
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
        filter={{ value: query, onChange: setQuery, placeholder: multi ? "Filter team-seasons" : "Filter teams", help }}
        actions={
          <>
            <SaveViewButton savedAs={savedAs} suggest={saveLabel} onSave={saveView} onRemove={unsaveView} />
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
        {loadedAll && many.values.length > 0 ? (
          <DataTable
            key={`${years.join(",")}:${view.key}`}
            id="team-explorer"
            rows={rows}
            columns={columns}
            rowKey={teamKey}
            rowHeight={ROW_H}
            defaultSort={{ key: view.sortBy, dir: view.sortDir === "asc" ? 1 : -1 }}
            tieBreak={byBtaRank}
            ariaLabel={multi ? "Team-seasons" : "Teams"}
            empty={
              onlyPicked && picked.size > 0 ? (
                <p className="px-5 py-10 text-[13px] text-ink-muted">None of the selected teams match the filter.</p>
              ) : (
                <NoMatches query={query} noun="team or conference" problem={filterProblem(parsed, TEAM_STATS, TEAM_SCOPES)} />
              )
            }
            peek={{
              label: (t) => (multi ? `${t.name} ${seasonLabel(t.year)}` : t.name),
              body: (t) => <TeamPeekBody season={seasonByYear.get(t.year)!} team={t} />,
            }}
            landOn={landing && target ? { key: teamKey(landing), nonce: target.nonce } : undefined}
            onLanded={onLanded}
            object={object}
            selection={multi ? undefined : selection}
            echo={echoKey}
            spotlight={spotKey}
            statLens={statLens}
            onFocusRow={onFocusRow}
            handle={handle}
          />
        ) : !loadedAll ? (
          <TableSkeleton rowHeight={ROW_H} label={multi ? `Loading ${years.length} seasons of teams` : "Loading teams"} />
        ) : firstFailure ? (
          <LoadError year={yearOfKey(firstFailure.key)} reason={firstFailure.reason} message={firstFailure.message} what="Teams" onRetry={retry} />
        ) : null}
      </div>
    </>
  );
}
