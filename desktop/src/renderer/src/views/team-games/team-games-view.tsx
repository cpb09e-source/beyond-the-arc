import { useEffect, useMemo, useRef, useState } from "react";
import { teamGameExportCols, teamGameExportEntity, type GameLogHit } from "@/lib/game-log-export";
import { exportFields, type ExportInput, type MultiExportInput } from "@/lib/table-export";
import {
  T,
  TEAM_GAME_GROUPS,
  TEAM_GAME_PRESETS,
  TEAM_GAME_STATS,
  TEAM_GAME_VIEWS,
  passesTeamFilters,
  teamGameViewByKey,
  type TeamGamePack,
} from "@/lib/team-game-index";
import { logDate } from "~/data/game-link";
import { loadTeamGameSeason, type TeamGame } from "~/data/team-game-model";
import type { Obj } from "~/objects/object";
import { SOURCE_LABEL, useLoaded } from "~/data/use-corpus";
import { Picker } from "~/shell/picker";
import { ShortcutBar } from "~/shell/shortcut-bar";
import { useSetStatus } from "~/shell/status";
import { LoadError, NoMatches, TableSkeleton, ViewHeader } from "~/shell/view-parts";
import type { ViewProps } from "~/shell/views";
import { useActionEnv } from "~/objects/use-object-actions";
import { DataTable, type Column, type TableHandle } from "~/table/data-table";
import { DownloadMenu, SaveViewButton } from "~/table/download-menu";
import { exportMeta, sortText } from "~/table/export-meta";
import { FilterRows, TableBar } from "~/table/filter-rows";
import { conferenceOptions, nameOptions, ScopeSelect } from "~/table/scope-select";
import { TeamLogo } from "~/ui/logo";
import { catalogStats, conditionTest, filterHelp, filterProblem, parseFilter, pinnedStatKeys, sortedNames, statIndex } from "~/ui/filter-query";
import { nameIn, sameName, scopedNames, scopedQuery, type Scope } from "~/ui/scoped-query";
import { normalizeText } from "~/ui/text";
import { statColumns } from "./game-columns";
import { GamePeekBody } from "./game-peek";

/**
 * Team Game Log: every team's every game of a season, eleven thousand rows, the
 * site's seven column views, and its shortcuts.
 *
 * SHORTCUTS COMPOSE, as they do on the site: "30-point wins" and "Beat a ranked
 * team" together mean both. Each is a named filter from TEAM_GAME_PRESETS and
 * runs through the site's passesTeamFilters. Conditions typed in the filter box
 * ("margin>20 home=0") compose with them the same way.
 *
 * THE VIEW IS REMEMBERED, the season is not: the season belongs to the
 * workspace, and which columns a reader likes to see belongs to this table.
 */

const ROW_H = 42;
const VIEW_KEY = "bta.teamGames.view";

const gameKey = (g: TeamGame) => g.idx;
/** Equal values fall back to the latest game. */
const latestFirst = (a: TeamGame, b: TeamGame) => b.row[T.d]! - a.row[T.d]! || a.idx - b.idx;

const VIEW_OPTIONS = TEAM_GAME_VIEWS.map((v) => ({ key: v.key, label: v.label, desc: v.desc }));

function readView(): string {
  try {
    return teamGameViewByKey(localStorage.getItem(VIEW_KEY)).key;
  } catch {
    return TEAM_GAME_VIEWS[0]!.key;
  }
}

/** An AP rank in front of a name, the way a box score prints it. */
function Rank({ ap }: { ap: number }) {
  if (ap <= 0) return null;
  return <span className="shrink-0 text-[10.5px] font-medium text-ink-muted tabular">{ap}</span>;
}

function Tag({ children }: { children: string }) {
  return (
    <span className="shrink-0 rounded-[4px] border border-hairline px-1 py-px text-[9.5px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
      {children}
    </span>
  );
}

export const TEAM_GAME_IDENTITY: Column<TeamGame>[] = [
  {
    key: "pos", label: "#", title: "Place in the current sort", width: 60, align: "right", first: 1, pin: true,
    cell: (_g, i) => <span className="text-ink-muted tabular">{(i + 1).toLocaleString()}</span>,
  },
  {
    key: "team", label: "Team", width: 188, align: "left", first: 1, pin: true,
    sortValue: (g) => g.team,
    cell: (g) => (
      <span className="flex min-w-0 items-center gap-2">
        <TeamLogo id={g.teamLogoId} name={g.team} size={20} />
        <Rank ap={g.ap} />
        <span className="truncate font-medium text-ink">{g.team}</span>
      </span>
    ),
  },
  {
    key: "result", label: "Result", title: "Wins first, then by margin", width: 104, align: "left", first: -1,
    sortValue: (g) => (g.won ? 1000 : 0) + g.pts - g.pa,
    cell: (g) => (
      <span className="flex items-baseline gap-2 tabular">
        <span className={`w-3 font-semibold ${g.won ? "text-good" : "text-bad"}`}>{g.won ? "W" : "L"}</span>
        <span className="text-ink">
          {g.pts}–{g.pa}
        </span>
        {g.ot && <span className="text-[10.5px] text-ink-muted">OT</span>}
      </span>
    ),
  },
  {
    key: "site", label: "Site", title: "Home (vs), away (@) or a neutral floor (N)", width: 52, align: "center", first: -1,
    sortValue: (g) => (g.site === "home" ? 2 : g.site === "neutral" ? 1 : 0),
    cell: (g) => <span className="text-ink-muted">{g.site === "home" ? "vs" : g.site === "away" ? "@" : "N"}</span>,
  },
  {
    key: "opp", label: "Opponent", width: 220, align: "left", first: 1,
    sortValue: (g) => g.opp,
    cell: (g) => (
      <span className="flex min-w-0 items-center gap-2">
        <TeamLogo id={g.oppLogoId} name={g.opp} size={18} />
        <Rank ap={g.oppAp} />
        <span className="truncate text-ink-soft">{g.opp}</span>
        {g.tourney ? <Tag>NCAA</Tag> : g.post ? <Tag>Post</Tag> : null}
      </span>
    ),
  },
  {
    key: "date", label: "Date", width: 76, align: "right", first: -1,
    sortValue: (g) => g.row[T.d]!,
    cell: (g) => <span className="text-ink-soft tabular">{g.dateShort}</span>,
    text: (g) => g.date,
  },
];

/** A row as the object it is: one team's game, found on its night's slate when it is opened. */
export const teamLogObject = (g: TeamGame, epochMs: number, year: number): Obj => ({
  kind: "log-game",
  year,
  date: logDate(epochMs, g.row[T.d]!),
  team: g.team,
  teamLogoId: g.teamLogoId,
  opp: g.opp,
  oppLogoId: g.oppLogoId,
  site: g.site,
  summary: `${g.team} ${g.pts}, ${g.opp} ${g.pa}${g.ot ? " (OT)" : ""}`,
});

/** What "margin>20" can name: every stat in the site's catalog, whichever view is showing. */
const GROUP_OF = new Map(TEAM_GAME_GROUPS.flatMap((g) => g.keys.map((k) => [k, g.label] as const)));
const TEAM_GAME_FILTER = statIndex<TeamGame>(
  catalogStats(TEAM_GAME_STATS, {
    get: (s) => (g: TeamGame) => s.get(g.row),
    fmt: (s) => s.fmt,
    desc: (s) => s.title,
    group: (s) => GROUP_OF.get(s.key) ?? "Other",
    aliases: { won: ["win"] },
  }),
);
const TEAM_GAME_SCOPES: Scope[] = ["team", "teams", "opponents", "conf"];
/** The pickers' list, in the site's Add Columns sections. */
const PICKS = TEAM_GAME_FILTER.all.flatMap((s) => (s.key ? [{ key: s.key, label: s.label, desc: s.desc, group: s.group }] : []));
type Hit = GameLogHit<TeamGamePack>;
/** Only when the reader has added columns does the table caption its groups. */
const banded = (list: Column<TeamGame>[], band: string, accent: boolean): Column<TeamGame>[] => list.map((c) => ({ ...c, band, bandAccent: accent }));

export function TeamGamesView({ year, setYear, query, setQuery, table, setTable, savedAs, saveView, unsaveView }: ViewProps) {
  const [state, retry] = useLoaded(`team-games|${year}`, () => loadTeamGameSeason(year));
  const setStatus = useSetStatus();
  const env = useActionEnv();
  const handle = useRef<TableHandle<TeamGame> | null>(null);
  // A new tab opens on the view last picked anywhere; a tab keeps its own.
  const [lastView] = useState(readView);
  const [on, setOn] = useState<string[]>([]);

  const season = state.status === "ready" ? state.value : null;
  const view = teamGameViewByKey(table.view ?? lastView);
  const pinned = useMemo(() => pinnedStatKeys(query, table.cols ?? [], TEAM_GAME_FILTER), [query, table.cols]);

  const columns = useMemo(() => {
    if (!season) return TEAM_GAME_IDENTITY;
    // A stat the view already shows keeps its place in the view.
    const yours = pinned.filter((k) => !view.keys.includes(k));
    if (yours.length === 0) return [...TEAM_GAME_IDENTITY, ...statColumns(season.pack, view.keys)];
    return [
      ...TEAM_GAME_IDENTITY,
      ...banded(statColumns(season.pack, yours), "Your columns", true),
      ...banded(statColumns(season.pack, view.keys), view.label, false),
    ];
  }, [season, view, pinned]);
  const filters = useMemo(() => TEAM_GAME_PRESETS.filter((p) => on.includes(p.key)).flatMap((p) => p.filters), [on]);
  const parsed = useMemo(() => parseFilter(query), [query]);
  const rows = useMemo(() => {
    if (!season) return [];
    const words = normalizeText(parsed.words).split(" ").filter(Boolean);
    const scopes = parsed.scopes.map((s): ((g: TeamGame) => boolean) => {
      const v = s.value;
      if (s.scope === "team") return (g) => sameName(g.team, v);
      if (s.scope === "teams") {
        const named = new Set(scopedNames(v).map(normalizeText));
        return (g) => named.has(normalizeText(g.team));
      }
      if (s.scope === "opponents") return (g) => nameIn(v, g.opp);
      if (s.scope === "conf") return (g) => nameIn(v, g.confLabel, g.conf);
      return () => false;
    });
    const stats = conditionTest(TEAM_GAME_FILTER, parsed.conditions);
    return season.games.filter(
      (g) =>
        (filters.length === 0 || passesTeamFilters(g.row, filters)) &&
        scopes.every((f) => f(g)) &&
        (!stats || stats(g)) &&
        words.every((w) => g.hay.includes(w)),
    );
  }, [season, filters, parsed]);

  const help = useMemo(() => {
    if (!season) return undefined;
    const teams = () => sortedNames(season.games.map((g) => g.team));
    return filterHelp({
      noun: "games",
      index: TEAM_GAME_FILTER,
      rows: season.games,
      scopes: TEAM_GAME_SCOPES,
      names: {
        team: teams,
        teams,
        opponents: () => sortedNames(season.games.map((g) => g.opp)),
        conf: () => sortedNames(season.games.map((g) => g.confLabel)),
      },
    });
  }, [season]);

  useEffect(() => {
    if (state.status === "ready") setStatus(`${SOURCE_LABEL[state.source]} in ${state.ms} ms`);
    else if (state.status === "loading") setStatus("Loading…");
    else setStatus("Not loaded");
  }, [state, setStatus]);

  const pickView = (key: string) => {
    setTable({ ...table, view: key });
    try {
      localStorage.setItem(VIEW_KEY, key);
    } catch {
      /* remembered for this session only */
    }
  };

  const total = season?.games.length ?? 0;
  const meta = season
    ? rows.length !== total
      ? `${rows.length.toLocaleString()} of ${total.toLocaleString()} games`
      : `${total.toLocaleString()} games`
    : undefined;
  // Net rating where the view has it, the site's own default; otherwise the view's lead stat.
  const sortKey = view.keys.includes("net") ? "net" : view.keys[0]!;

  const confOptions = useMemo(() => conferenceOptions(season?.games ?? []), [season]);
  const teamOptions = useMemo(() => nameOptions((season?.games ?? []).map((g) => g.team)), [season]);
  const oppOptions = useMemo(() => nameOptions((season?.games ?? []).map((g) => g.opp)), [season]);

  // ── Download: the site's files, built on click from the table as it stands ──
  const exportEntity = useMemo(() => teamGameExportEntity<Hit>("team-game-log"), []);
  const exportRows = (): Hit[] => (season ? (handle.current?.rows ?? rows).map((g) => ({ pack: season.pack, row: g.row })) : []);
  const metaFor = (viewLabel: string) => {
    const sort = handle.current?.sort;
    const col = sort ? columns.find((c) => c.key === sort.key) : undefined;
    const m = exportMeta({
      viewLabel,
      year,
      query,
      index: TEAM_GAME_FILTER,
      sort: sortText(col?.label, sort?.dir ?? -1),
      path: `/teams/games?ys=${year}${view.key !== "overview" ? `&view=${view.key}` : ""}`,
    });
    // The shortcuts narrow the rows too, so the file names them.
    return { ...m, filters: [...TEAM_GAME_PRESETS.filter((p) => on.includes(p.key)).map((p) => p.label), ...m.filters] };
  };
  const buildExport = (): ExportInput<Hit> => ({ cols: teamGameExportCols(view, pinned), rows: exportRows(), entity: exportEntity, meta: metaFor(view.label) });
  const buildExportAll = (keys: string[]): MultiExportInput<Hit> => {
    const chosen = TEAM_GAME_VIEWS.filter((v) => keys.includes(v.key));
    return {
      sheets: chosen.map((v) => ({ name: v.label, cols: teamGameExportCols(v, pinned) })),
      rows: exportRows(),
      entity: exportEntity,
      meta: metaFor("Multiple views"),
      slug: chosen.length === TEAM_GAME_VIEWS.length ? "all-views" : "views",
    };
  };
  const exportColumns = exportFields(teamGameExportCols(view, pinned), exportEntity).length;

  return (
    <>
      <ViewHeader
        kicker="Teams"
        title="Team Game Log"
        year={year}
        setYear={setYear}
        meta={meta}
        controls={<Picker label="View" value={view.key} options={VIEW_OPTIONS} onChange={pickView} />}
        filter={{ value: query, onChange: setQuery, placeholder: "Filter games", help }}
        actions={
          <>
            <SaveViewButton savedAs={savedAs} suggest={`Team games, ${view.label}${query.trim() ? ` · ${query.trim()}` : ""}`} onSave={saveView} onRemove={unsaveView} />
            <DownloadMenu
              rows={rows.length}
              columns={exportColumns}
              views={VIEW_OPTIONS}
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
          <ScopeSelect label="Conference" scopes={["conf"]} options={confOptions} query={query} setQuery={setQuery} write={(names) => scopedQuery("conf", names.join(", "))} />
          <ScopeSelect
            label="Team"
            scopes={["team", "teams"]}
            options={teamOptions}
            query={query}
            setQuery={setQuery}
            write={(names) => (names.length === 1 ? scopedQuery("team", names[0]!) : scopedQuery("teams", names.join(", ")))}
          />
          <ScopeSelect label="Opponent" scopes={["opponents"]} options={oppOptions} query={query} setQuery={setQuery} write={(names) => scopedQuery("opponents", names.join(", "))} />
          <span aria-hidden className="mx-1 h-4 w-px bg-hairline" />
          <FilterRows
            help={help}
            stats={PICKS}
            query={query}
            setQuery={setQuery}
            cols={table.cols ?? []}
            setCols={(next) => setTable({ ...table, cols: next.length > 0 ? next : undefined })}
          />
        </TableBar>
      )}
      <ShortcutBar presets={TEAM_GAME_PRESETS} on={on} onChange={setOn} />

      <div className="relative min-h-0 flex-1 border-t border-hairline">
        {state.status === "ready" ? (
          <DataTable
            key={`${year}:${view.key}`}
            rows={rows}
            columns={columns}
            rowKey={gameKey}
            rowHeight={ROW_H}
            defaultSort={{ key: sortKey, dir: -1 }}
            tieBreak={latestFirst}
            id="team-game-log"
            object={(g) => teamLogObject(g, state.value.pack.epochMs, year)}
            handle={handle}
            ariaLabel="Team games"
            empty={
              query.trim() ? (
                <NoMatches query={query} noun="team, opponent or conference" problem={filterProblem(parsed, TEAM_GAME_FILTER, TEAM_GAME_SCOPES)} />
              ) : (
                <p className="px-5 py-10 text-[13px] text-ink-muted">No game this season matches every shortcut that is on.</p>
              )
            }
            peek={{
              label: (g) => `${g.team} ${g.site === "away" ? "at" : "vs"} ${g.opp}`,
              body: (g) => <GamePeekBody season={state.value} game={g} />,
            }}
          />
        ) : state.status === "loading" ? (
          <TableSkeleton rowHeight={ROW_H} label="Loading team games" />
        ) : (
          <LoadError year={year} reason={state.reason} message={state.message} what="Team games" onRetry={retry} />
        )}
      </div>
    </>
  );
}
