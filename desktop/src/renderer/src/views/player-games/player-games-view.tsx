import { useEffect, useMemo, useRef, useState } from "react";
import { playerGameExportCols, playerGameExportEntity, type GameLogHit } from "@/lib/game-log-export";
import { exportFields, type ExportInput, type MultiExportInput } from "@/lib/table-export";
import {
  F,
  GAME_GROUPS,
  GAME_PRESETS,
  GAME_STATS,
  GAME_VIEWS,
  gameStat,
  gameViewByKey,
  passesFilters,
  type GamePack,
  type GameStat,
} from "@/lib/game-index";
import {
  gameMatcher,
  loadPlayerGameSeason,
  siteOf,
  statPercentiles,
  statValues,
  type GamePlayer,
  type PlayerGame,
  type PlayerGameSeason,
} from "~/data/player-game-model";
import { logDate } from "~/data/game-link";
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
import { conferenceOptions, nameOptions, ScopeSelect, type ScopeOption } from "~/table/scope-select";
import { catalogStats, conditionTest, filterHelp, filterProblem, parseFilter, pinnedStatKeys, sortedNames, statIndex } from "~/ui/filter-query";
import { nameIn, sameName, scopedNames, scopedQuery, type Scope, type Scoped } from "~/ui/scoped-query";
import { normalizeText } from "~/ui/text";
import { identityColumns, NO_CHIP, statColumns } from "./player-game-columns";
import { PEEK_KEYS, PlayerGamePeekBody } from "./player-game-peek";

/**
 * Player Game Log: every player-game of a season, about 118,000 rows, all of
 * them on the table rather than the site's top 500.
 *
 * The site's five column views in a picker that is remembered, its eight
 * shortcuts composing through its passesFilters, Game Score as the default
 * sort, and a Peek on every row.
 */

const ROW_H = 42;
const VIEW_KEY = "bta.playerGames.view";

const gameKey = (g: PlayerGame) => g.idx;
/** Equal values fall back to the latest game. */
const latestFirst = (a: PlayerGame, b: PlayerGame) => b.row[F.d]! - a.row[F.d]! || a.idx - b.idx;

const VIEW_OPTIONS = GAME_VIEWS.map((v) => ({ key: v.key, label: v.label, desc: v.desc }));

function readView(): string {
  try {
    return gameViewByKey(localStorage.getItem(VIEW_KEY)).key;
  } catch {
    return GAME_VIEWS[0]!.key;
  }
}

/** "player: Cooper Flagg", "team: Duke", "teams: Duke, Houston", "conf: SEC", "opponents: Duke" as a test per row. */
function scopedMatcher(season: PlayerGameSeason, s: Scoped): (g: PlayerGame) => boolean {
  if (s.scope === "opponents") {
    const opps = Uint8Array.from(season.opps, (o) => (nameIn(s.value, o.name) ? 1 : 0));
    return (g) => opps[g.row[F.o]!] === 1;
  }
  const named = new Set(s.scope === "teams" ? scopedNames(s.value).map(normalizeText) : []);
  const has = (p: GamePlayer): boolean =>
    s.scope === "player"
      ? sameName(p.name, s.value)
      : s.scope === "team"
        ? sameName(p.team, s.value)
        : s.scope === "teams"
          ? named.has(normalizeText(p.team))
          : s.scope === "class"
            ? nameIn(s.value, p.cls)
            : s.scope === "conf" && nameIn(s.value, p.confLabel, p.conf);
  const players = Uint8Array.from(season.players, (p) => (has(p) ? 1 : 0));
  return (g) => players[g.row[F.p]!] === 1;
}

/** What "pts>30" can name: every stat in the site's catalog, whichever view is showing. */
const GROUP_OF = new Map(GAME_GROUPS.flatMap((g) => g.keys.map((k) => [k, g.label] as const)));
const PLAYER_GAME_FILTER = statIndex<PlayerGame>(
  catalogStats(GAME_STATS, {
    get: (s) => (g: PlayerGame) => s.get(g.row),
    fmt: (s) => s.fmt,
    desc: (s) => s.title,
    group: (s) => GROUP_OF.get(s.key) ?? "Other",
    aliases: { gmsc: ["gamescore"] },
  }),
);
const PLAYER_GAME_SCOPES: Scope[] = ["player", "team", "teams", "opponents", "conf", "class"];
const PICKS = PLAYER_GAME_FILTER.all.flatMap((s) => (s.key ? [{ key: s.key, label: s.label, desc: s.desc, group: s.group }] : []));
type Hit = GameLogHit<GamePack>;
const CLASS_OPTIONS: ScopeOption[] = [
  { name: "Fr", meta: "Freshman" },
  { name: "So", meta: "Sophomore" },
  { name: "Jr", meta: "Junior" },
  { name: "Sr", meta: "Senior" },
  { name: "Gr", meta: "Graduate" },
];
/** Only when the reader has added columns does the table caption its groups. */
const banded = (list: Column<PlayerGame>[], band: string, accent: boolean): Column<PlayerGame>[] => list.map((c) => ({ ...c, band, bandAccent: accent }));

/** A row as the object it is: one player's game, found on its night's slate when it is opened. */
export function playerLogObject(season: PlayerGameSeason, g: PlayerGame): Obj {
  const p = season.players[g.row[F.p]!]!;
  const o = season.opps[g.row[F.o]!]!;
  const site = siteOf(g.row);
  return {
    kind: "log-game",
    year: season.year,
    date: logDate(season.pack.epochMs, g.row[F.d]!),
    team: p.team,
    teamLogoId: p.teamLogoId,
    opp: o.name,
    oppLogoId: o.logoId,
    site,
    player: { bartId: p.bartId, name: p.name, hasPhoto: p.hasPhoto },
    summary: `${p.name}: ${g.row[F.pts]} pts, ${g.row[F.reb]} reb, ${g.row[F.ast]} ast ${site === "away" ? "at" : "vs"} ${o.name}`,
  };
}

export function PlayerGamesView({ year, setYear, query, setQuery, table, setTable, savedAs, saveView, unsaveView }: ViewProps) {
  const [state, retry] = useLoaded(`player-games|${year}`, () => loadPlayerGameSeason(year));
  const setStatus = useSetStatus();
  const env = useActionEnv();
  const handle = useRef<TableHandle<PlayerGame> | null>(null);
  // A new tab opens on the view last picked anywhere; a tab keeps its own.
  const [lastView] = useState(readView);
  const [on, setOn] = useState<string[]>([]);

  const season = state.status === "ready" ? state.value : null;
  const view = gameViewByKey(table.view ?? lastView);
  const pinned = useMemo(() => pinnedStatKeys(query, table.cols ?? [], PLAYER_GAME_FILTER), [query, table.cols]);

  const columns = useMemo(() => {
    if (!season) return [];
    // A stat the view already shows keeps its place in the view.
    const yours = pinned.filter((k) => !view.keys.includes(k));
    if (yours.length === 0) return [...identityColumns(season), ...statColumns(season, view.keys)];
    return [
      ...identityColumns(season),
      ...banded(statColumns(season, yours), "Your columns", true),
      ...banded(statColumns(season, view.keys), view.label, false),
    ];
  }, [season, view, pinned]);
  const filters = useMemo(() => GAME_PRESETS.filter((p) => on.includes(p.key)).flatMap((p) => p.filters), [on]);
  const parsed = useMemo(() => parseFilter(query), [query]);
  const rows = useMemo(() => {
    if (!season) return [];
    const tests = parsed.scopes.map((s) => scopedMatcher(season, s));
    const words = gameMatcher(season, parsed.words);
    if (words) tests.push(words);
    const stats = conditionTest(PLAYER_GAME_FILTER, parsed.conditions);
    if (stats) tests.push(stats);
    // Nothing to narrow: the season's own array, so the table's sort memo holds.
    if (tests.length === 0 && filters.length === 0) return season.games;
    return season.games.filter((g) => {
      if (filters.length > 0 && !passesFilters(g.row, filters)) return false;
      for (const test of tests) if (!test(g)) return false;
      return true;
    });
  }, [season, filters, parsed]);

  const help = useMemo(() => {
    if (!season) return undefined;
    const teams = () => sortedNames(season.players.map((p) => p.team));
    return filterHelp({
      noun: "player games",
      index: PLAYER_GAME_FILTER,
      rows: season.games,
      scopes: PLAYER_GAME_SCOPES,
      names: {
        player: () => [...season.players].sort((a, b) => (a.rank || 1e9) - (b.rank || 1e9)).map((p) => p.name),
        team: teams,
        teams,
        opponents: () => sortedNames(season.opps.map((o) => o.name)),
        conf: () => sortedNames(season.players.map((p) => p.confLabel)),
        class: () => CLASS_OPTIONS.map((o) => o.name),
      },
    });
  }, [season]);

  // Rank what a Peek shows while nothing else is happening, one stat per idle
  // slot, so the first Space opens at once instead of paying for ten
  // percentile passes in the middle of a keypress.
  useEffect(() => {
    if (!season) return;
    const queue = PEEK_KEYS.map((k) => gameStat(k)).filter((s): s is GameStat => !!s);
    let handle = 0;
    const step = (deadline: IdleDeadline) => {
      while (queue.length > 0 && deadline.timeRemaining() > 4) {
        const st = queue.shift()!;
        statValues(season.pack, st);
        if (!NO_CHIP.has(st.key)) statPercentiles(season.pack, st);
      }
      if (queue.length > 0) handle = requestIdleCallback(step);
    };
    handle = requestIdleCallback(step);
    return () => cancelIdleCallback(handle);
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
      ? `${rows.length.toLocaleString()} of ${total.toLocaleString()} player games`
      : `${total.toLocaleString()} player games`
    : undefined;
  // Game Score where the view has it, the site's own default; otherwise points.
  const sortKey = view.keys.includes("gmsc") ? "gmsc" : "pts";

  const confOptions = useMemo(() => conferenceOptions(season?.players ?? []), [season]);
  const teamOptions = useMemo(() => nameOptions((season?.players ?? []).map((p) => p.team)), [season]);
  const oppOptions = useMemo(() => nameOptions((season?.opps ?? []).map((o) => o.name)), [season]);

  // ── Download: the site's files, built on click from the table as it stands ──
  const exportEntity = useMemo(() => playerGameExportEntity<Hit>(), []);
  const exportRows = (): Hit[] => (season ? (handle.current?.rows ?? rows).map((g) => ({ pack: season.pack, row: g.row })) : []);
  const metaFor = (viewLabel: string) => {
    const sort = handle.current?.sort;
    const col = sort ? columns.find((c) => c.key === sort.key) : undefined;
    const m = exportMeta({
      viewLabel,
      year,
      query,
      index: PLAYER_GAME_FILTER,
      sort: sortText(col?.label, sort?.dir ?? -1),
      path: `/players/games?ys=${year}${view.key !== "overview" ? `&view=${view.key}` : ""}`,
    });
    // The shortcuts narrow the rows too, so the file names them.
    return { ...m, filters: [...GAME_PRESETS.filter((p) => on.includes(p.key)).map((p) => p.label), ...m.filters] };
  };
  const buildExport = (): ExportInput<Hit> => ({ cols: playerGameExportCols(view, pinned), rows: exportRows(), entity: exportEntity, meta: metaFor(view.label) });
  const buildExportAll = (keys: string[]): MultiExportInput<Hit> => {
    const chosen = GAME_VIEWS.filter((v) => keys.includes(v.key));
    return {
      sheets: chosen.map((v) => ({ name: v.label, cols: playerGameExportCols(v, pinned) })),
      rows: exportRows(),
      entity: exportEntity,
      meta: metaFor("Multiple views"),
      slug: chosen.length === GAME_VIEWS.length ? "all-views" : "views",
    };
  };
  const exportColumns = exportFields(playerGameExportCols(view, pinned), exportEntity).length;

  return (
    <>
      <ViewHeader
        kicker="Players"
        title="Player Game Log"
        year={year}
        setYear={setYear}
        meta={meta}
        controls={<Picker label="View" value={view.key} options={VIEW_OPTIONS} onChange={pickView} />}
        filter={{ value: query, onChange: setQuery, placeholder: "Filter games", help }}
        actions={
          <>
            <SaveViewButton savedAs={savedAs} suggest={`Player games, ${view.label}${query.trim() ? ` · ${query.trim()}` : ""}`} onSave={saveView} onRemove={unsaveView} />
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
          <ScopeSelect label="Class" scopes={["class"]} options={CLASS_OPTIONS} query={query} setQuery={setQuery} write={(names) => scopedQuery("class", names.join(", "))} width={220} />
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
      <ShortcutBar presets={GAME_PRESETS} on={on} onChange={setOn} />

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
            id="player-game-log"
            object={(g) => playerLogObject(state.value, g)}
            handle={handle}
            ariaLabel="Player games"
            empty={
              query.trim() ? (
                <NoMatches query={query} noun="player, team, opponent or conference" problem={filterProblem(parsed, PLAYER_GAME_FILTER, PLAYER_GAME_SCOPES)} />
              ) : (
                <p className="px-5 py-10 text-[13px] text-ink-muted">No game this season matches every shortcut that is on.</p>
              )
            }
            peek={{
              label: (g) => {
                const p = state.value.players[g.row[F.p]!]!;
                const o = state.value.opps[g.row[F.o]!]!;
                return `${p.name} ${siteOf(g.row) === "away" ? "at" : "vs"} ${o.name}`;
              },
              body: (g) => <PlayerGamePeekBody season={state.value} game={g} />,
            }}
          />
        ) : state.status === "loading" ? (
          <TableSkeleton rowHeight={ROW_H} label="Loading player games" />
        ) : (
          <LoadError year={year} reason={state.reason} message={state.message} what="Player games" onRetry={retry} />
        )}
      </div>
    </>
  );
}
