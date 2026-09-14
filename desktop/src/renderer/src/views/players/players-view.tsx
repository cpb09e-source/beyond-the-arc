import { useEffect, useMemo, useRef } from "react";
import { TopHundredPill } from "@/components/portal/top-hundred-pill";
import { PCT_KEYS, positionBucket, type PctKey } from "@/lib/player-cohort";
import { exportColsFor, pinnedGridCol, SORT_FIELD, viewGrid, type GridCol } from "@/lib/player-explorer-columns";
import { PACK_STAT_COLUMNS, groupsFor, type PackGroup } from "@/lib/player-stat-pack";
import { PLAYER_VIEWS, playerViewByKey, playerViewPackGroups } from "@/lib/player-views";
import { PLAYER_STAT_COLUMNS, PLAYER_STAT_GROUP_LABEL, type PlayerSummary } from "@/lib/players";
import { exportFields, playerEntity, type ExportCol, type ExportInput, type MultiExportInput } from "@/lib/table-export";
import { loadPlayerPack, packPct, packValue, usePlayerPacks } from "~/data/player-packs";
import { loadPlayerSeason, type Player, type PlayerSeason } from "~/data/player-model";
import { SOURCE_LABEL, useLoaded } from "~/data/use-corpus";
import { useFocusSubject } from "~/focus/focus-mode";
import type { Obj } from "~/objects/object";
import { useActionEnv } from "~/objects/use-object-actions";
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
import { ClassBadge, PlayerPhoto } from "~/ui/player-photo";
import { nameIn, sameName, scopedNames, scopedQuery, type Scope } from "~/ui/scoped-query";
import { matchesQuery, normalizeText } from "~/ui/text";
import { playerLens } from "~/lens/stat-lens";
import { playerStat } from "./player-columns";
import { PlayerPeekBody } from "./player-peek";

/**
 * Player Explorer: every player on the season's leaderboard, as the site's
 * explorer shows them.
 *
 * THE SITE'S TWELVE VIEWS, from src/lib/player-views.ts, each column from
 * src/lib/player-explorer-columns.ts. A view's stats come from two places, as
 * on the site: the player's summary, and the stat pack, a hundred more numbers
 * in group files loaded when a view or a filter needs them (~/data/player-packs.ts).
 *
 * THE FILTERS ARE WORDS, as on every table here: Team, Conference, Class and
 * Position pickers, the filter rows and Add columns all write the filter box
 * ("team: Duke ppg>15 3p>38"); the view and added columns ride with the tab.
 *
 * WIDE ON PURPOSE. The rank and the player stay pinned while the stats scroll.
 */

const ROW_H = 42;

const playerKey = (p: Player) => p.id;
const byRank = (a: Player, b: Player) => (a.rank ?? 1e9) - (b.rank ?? 1e9);

const PACK_GROUP_LABEL: Record<PackGroup, string> = {
  info: "Player Info",
  playtime: "Playing Time",
  box: "Box Score",
  shooting: "Shooting",
  context: "Scoring Context",
  advoff: "Offensive Stats",
  advdef: "Defensive Stats",
  fouls: "Fouls",
  doubles: "Doubles",
  leaders: "Game Leaders",
};

const SUMMARY_KEYS = new Set(PLAYER_STAT_COLUMNS.map((c) => c.key));

/** What "ppg>15" can name: the rank, every stat the site's player filters take, and the stat pack. */
const PLAYER_STATS = statIndex<Player>([
  { name: "rank", aliases: ["btarank"], label: "BTA rank", desc: "BTA's overall player rank", digits: 0, get: (p) => p.rank },
  ...catalogStats(PLAYER_STAT_COLUMNS, {
    get: (c) => (p: Player) => p.s[c.field] as number | null,
    fmt: (c) => c.format,
    desc: (c) => c.desc,
    group: (c) => PLAYER_STAT_GROUP_LABEL[c.group],
    aliases: { ppg: ["pts"], rpg: ["reb"], apg: ["ast"], spg: ["stl"], bpg: ["blk"], mpg: ["min"], epm: ["arc"] },
  }),
  ...catalogStats(
    PACK_STAT_COLUMNS.filter((c) => !SUMMARY_KEYS.has(c.key)),
    {
      get: (c) => (p: Player) => packValue(p.s.year, c.key, p.bartId),
      fmt: (c) => (c.format === "pct100" ? "num1" : c.format),
      desc: (c) => c.desc,
      group: (c) => PACK_GROUP_LABEL[c.group],
    },
  ),
]);
const PLAYER_SCOPES: Scope[] = ["player", "team", "teams", "conf", "class", "pos"];
const PICKS = PLAYER_STATS.all.flatMap((s) => (s.key ? [{ key: s.key, label: s.label, desc: s.desc, group: s.group }] : []));

const VIEW_OPTIONS = PLAYER_VIEWS.map((v) => ({ key: v.key, label: v.label, desc: v.desc, group: v.group }));
const DOWNLOAD_VIEWS = PLAYER_VIEWS.filter((v) => !v.custom).map((v) => ({ key: v.key, label: v.label, desc: v.desc, group: v.group }));

const CLASS_OPTIONS: ScopeOption[] = [
  { name: "Fr", meta: "Freshman" },
  { name: "So", meta: "Sophomore" },
  { name: "Jr", meta: "Junior" },
  { name: "Sr", meta: "Senior" },
  { name: "Gr", meta: "Graduate" },
];
const POSITION_OPTIONS: ScopeOption[] = [
  { name: "G", meta: "Guard" },
  { name: "F", meta: "Forward" },
  { name: "C", meta: "Center" },
];

/** Fewer turnovers is better; the site's percentile pass inverts these two. */
const LOWER_BETTER = new Set(["tov_pct", "tov_pg"]);
const FIELD_KEY = new Map(PLAYER_STAT_COLUMNS.map((c) => [c.field as string, c.key]));
const keyOf = (c: GridCol): string => c.packKey ?? FIELD_KEY.get(c.field as string) ?? (c.field as string);

function printed(c: GridCol, v: number | null): string {
  if (v == null) return "–";
  if (c.fmt === "int") return String(Math.round(v));
  if (c.fmt === "pct1") return (v * 100).toFixed(1);
  if (c.fmt === "pct100") return v.toFixed(1);
  if (c.fmt === "epm") return signed1(v);
  if (c.fmt === "num2") return v.toFixed(2);
  return v.toFixed(1);
}

function gridColumn(c: GridCol, band: string, accent: boolean): Column<Player> {
  const key = keyOf(c);
  const value = (p: Player): number | null => (c.field ? (p.s[c.field] as number | null) : packValue(p.s.year, c.packKey!, p.bartId));
  const pct = (p: Player): number | null =>
    c.pct ? (p.pct[c.pct] ?? null) : c.packKey && !c.noPct ? packPct(p.s.year, c.packKey, p.bartId) : null;
  return {
    key,
    label: c.label,
    title: c.desc,
    // Wide enough for the uppercase label and the sort arrow together.
    width: Math.max(58, Math.round(c.label.length * 7.7) + 34),
    align: "right",
    first: LOWER_BETTER.has(key) ? 1 : -1,
    band,
    bandAccent: accent,
    sortValue: value,
    cell: (p) => <StatCell value={printed(c, value(p))} pct={pct(p)} strong={key === "epm"} />,
    text: (p) => printed(c, value(p)),
  };
}

/**
 * THE # IS THE ROW'S PLACE IN THE CURRENT SORT, as on the site. BTA's overall
 * rank covers only the top of each season, so it rides with the name as the
 * site's top-100 mark.
 */
const IDENTITY: Column<Player>[] = [
  {
    key: "pos", label: "#", title: "Place in the current sort", width: 48, align: "right", first: 1, pin: true,
    cell: (_p, i) => <span className="text-ink-muted tabular">{i + 1}</span>,
  },
  {
    key: "name", label: "Player", width: 244, align: "left", first: 1, pin: true,
    sortValue: (p) => p.name,
    cell: (p) => (
      <span className="flex min-w-0 items-center gap-2">
        <PlayerPhoto bartId={p.bartId} hasPhoto={p.hasPhoto} name={p.name} size={24} />
        <span className="truncate font-medium text-ink">{p.name}</span>
        <ClassBadge cls={p.cls} />
        {p.rank != null && p.rank <= 100 && (
          <TopHundredPill rank={p.rank} title={`Top 100: #${p.rank} in the country in ${seasonLabel(p.s.year)}`} />
        )}
      </span>
    ),
  },
  {
    key: "team", label: "Team", width: 156, align: "left", first: 1,
    sortValue: (p) => p.team,
    cell: (p) => (
      <span className="flex min-w-0 items-center gap-1.5">
        <TeamLogo id={p.teamLogoId} name={p.team} size={16} />
        <span className="truncate text-ink-soft">{p.team}</span>
      </span>
    ),
  },
  {
    key: "gp", label: "GP", title: "Games played", width: 44, align: "right", first: -1,
    sortValue: (p) => p.s.games,
    cell: (p) => <span className="text-ink-soft tabular">{p.s.games ?? "–"}</span>,
  },
];

/** A column the reader added, as the workbook lists it: under "Your columns", ahead of the view's own. */
function pinnedExportCol(key: string): ExportCol | null {
  const c = pinnedGridCol(key);
  if (!c) return null;
  const total = (c.field as string | undefined) ?? c.packKey!;
  return {
    label: c.label,
    total,
    pct: c.pct ?? (c.packKey && !c.noPct ? c.packKey : ""),
    fmt: c.fmt === "pct1" ? "pct1" : c.fmt === "int" ? "int" : "num1",
    band: "Your columns",
  };
}

export function PlayersView({ year, setYear, query, setQuery, focus, onLanded, table, setTable, saved, toggleSaved }: ViewProps) {
  const [state, retry] = useLoaded(`player-season|${year}`, () => loadPlayerSeason(year));
  const setStatus = useSetStatus();
  const env = useActionEnv();
  useTabTitle(query.trim() ? `Players: ${query.trim()}` : null);
  const handle = useRef<TableHandle<Player> | null>(null);

  const season: PlayerSeason | null = state.status === "ready" ? state.value : null;
  const view = playerViewByKey(table.view);
  const cols = useMemo(() => table.cols ?? [], [table.cols]);
  const parsed = useMemo(() => parseFilter(query), [query]);
  const pinned = useMemo(() => pinnedStatKeys(query, cols, PLAYER_STATS), [query, cols]);
  const groups = useMemo(() => [...new Set([...playerViewPackGroups(view), ...groupsFor(pinned)])], [view, pinned]);
  const landed = usePlayerPacks(year, groups);

  // A Ctrl K result for a player in this season. The index can name a player the
  // leaderboard floor leaves out, and then there is no row to land on.
  const target = focus?.kind === "player" && focus.year === year ? focus : null;
  const landing = target && season ? season.players.find((p) => p.bartId === target.bartId) : undefined;

  const rows = useMemo(() => {
    if (!season) return [];
    const scopes = parsed.scopes.map((s): ((p: Player) => boolean) => {
      const v = s.value;
      if (s.scope === "team") return (p) => sameName(p.team, v);
      if (s.scope === "teams") {
        const names = new Set(scopedNames(v).map(normalizeText));
        return (p) => names.has(normalizeText(p.team));
      }
      if (s.scope === "conf") return (p) => nameIn(v, p.confLabel, p.conf);
      if (s.scope === "player") return (p) => sameName(p.name, v);
      if (s.scope === "class") return (p) => nameIn(v, p.cls);
      if (s.scope === "pos") return (p) => nameIn(v, positionBucket(p.position));
      return () => false;
    });
    const stats = conditionTest(PLAYER_STATS, parsed.conditions);
    return season.players.filter(
      (p) =>
        matchesQuery(parsed.words, p.name, p.team, p.confLabel, p.conf, p.cls ?? "", p.position ?? "", p.hometown ?? "") &&
        scopes.every((f) => f(p)) &&
        (!stats || stats(p)),
    );
    // `landed` re-runs the filter once a condition's stat pack arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, parsed, landed]);

  const columns = useMemo(() => {
    const grid = viewGrid(view);
    const inView = new Set(grid.cols.map(keyOf));
    const out = [...IDENTITY];
    for (const k of pinned) {
      const c = inView.has(k) ? null : pinnedGridCol(k);
      if (c && c.field !== "games") out.push(gridColumn(c, "Your columns", true));
    }
    let at = 0;
    for (const b of grid.bands) {
      for (const c of grid.cols.slice(at, at + b.span)) if (c.field !== "games") out.push(gridColumn(c, b.label, !!b.epm));
      at += b.span;
    }
    return out;
    // `landed` gives the table new columns, and so a new sort, once a pack's values arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, pinned, landed]);

  // The view's own sort, by whichever key the table's column carries for it.
  const sortKey = useMemo(() => {
    const want = view.key === "overview" && season ? season.defaultSort : view.sortBy;
    if (columns.some((c) => c.key === want)) return want;
    const field = SORT_FIELD[want] as string | undefined;
    const viaField = field ? FIELD_KEY.get(field) : undefined;
    return viaField && columns.some((c) => c.key === viaField) ? viaField : "name";
  }, [view, season, columns]);

  const help = useMemo(() => {
    if (!season) return undefined;
    const teams = () => sortedNames(season.players.map((p) => p.team));
    return filterHelp({
      noun: "players",
      index: PLAYER_STATS,
      rows: season.players,
      scopes: PLAYER_SCOPES,
      names: {
        player: () => [...season.players].sort(byRank).map((p) => p.name),
        team: teams,
        teams,
        conf: () => sortedNames(season.players.map((p) => p.confLabel)),
        class: () => CLASS_OPTIONS.map((o) => o.name),
        pos: () => POSITION_OPTIONS.map((o) => o.name),
      },
    });
  }, [season]);

  const teamOptions = useMemo<ScopeOption[]>(() => {
    if (!season) return [];
    const seen = new Map<string, ScopeOption>();
    for (const p of season.players) if (!seen.has(p.team)) seen.set(p.team, { name: p.team, meta: p.confLabel });
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [season]);
  const confOptions = useMemo(() => conferenceOptions(season?.players ?? []), [season]);

  useEffect(() => {
    if (state.status === "ready") setStatus(`${SOURCE_LABEL[state.source]} in ${state.ms} ms`);
    else if (state.status === "loading") setStatus("Loading…");
    else setStatus("Not loaded");
  }, [state, setStatus]);

  // Focus on a player lights his row among his team's (the team comes as the filter).
  const focusSubject = useFocusSubject();
  const spotKey =
    focusSubject?.kind === "player" && season ? (season.players.find((p) => p.bartId === focusSubject.bartId)?.id ?? null) : null;

  const total = season?.players.length ?? 0;
  const meta = !season
    ? undefined
    : target && !landing
      ? `${target.name} is not on the ${seasonLabel(year)} leaderboard`
      : `${query.trim() && rows.length !== total ? `${rows.length.toLocaleString()} of ${total.toLocaleString()}` : total.toLocaleString()} players · ${season.minGames}+ games${season.estimated ? " · EPM estimated" : ""}`;

  const object = (p: Player): Obj | null =>
    p.bartId == null
      ? null
      : { kind: "player", bartId: p.bartId, name: p.name, hasPhoto: p.hasPhoto, year, team: p.team, teamLogoId: p.teamLogoId, conf: p.conf };
  // Alt-click or right-click a number: the games behind it.
  const statLens = (p: Player, key: string) => {
    const st = playerStat(key);
    if (!st || p.bartId == null) return null;
    return playerLens(key, { kind: "player", bartId: p.bartId, name: p.name, hasPhoto: p.hasPhoto, year }, { label: st.label, value: st.format(p.s[st.field] as number | null) });
  };

  // ── Download: the site's files, built on click from the table as it stands ──
  const byId = useMemo(() => new Map((season?.players ?? []).map((p) => [p.id, p])), [season]);
  const entity = useMemo(
    () =>
      playerEntity<PlayerSummary>(
        (r, key) => {
          const v = (r as unknown as Record<string, unknown>)[key];
          return typeof v === "number" && Number.isFinite(v) ? v : packValue(r.year, key, r.bart_player_id);
        },
        (r, key) => {
          if (!key) return null;
          if ((PCT_KEYS as readonly string[]).includes(key)) return byId.get(r.id)?.pct[key as PctKey] ?? null;
          return packPct(r.year, key, r.bart_player_id);
        },
      ),
    [byId],
  );
  const colsForView = (v: typeof view): ExportCol[] => {
    const inView = new Set(viewGrid(v).cols.map(keyOf));
    const yours = pinned.filter((k) => !inView.has(k)).flatMap((k) => pinnedExportCol(k) ?? []);
    return [...yours, ...exportColsFor(v)];
  };
  const exportRows = (): PlayerSummary[] => (handle.current?.rows ?? rows).map((p) => p.s);
  const metaFor = (viewLabel: string) => {
    const sort = handle.current?.sort;
    const col = sort ? columns.find((c) => c.key === sort.key) : undefined;
    return exportMeta({ viewLabel, year, query, index: PLAYER_STATS, sort: sortText(col?.label, sort?.dir ?? -1), path: `/players?ys=${year}${view.key !== "overview" ? `&view=${view.key}` : ""}` });
  };
  const buildExport = (): ExportInput<PlayerSummary> => ({ cols: colsForView(view), rows: exportRows(), entity, meta: metaFor(view.label) });
  // The other tabs' numbers live in packs this view may never have asked for, so they are fetched first.
  const buildExportAll = async (keys: string[]): Promise<MultiExportInput<PlayerSummary>> => {
    const chosen = PLAYER_VIEWS.filter((v) => keys.includes(v.key) && !v.custom);
    const need = new Set<PackGroup>(groupsFor(pinned));
    for (const v of chosen) for (const g of playerViewPackGroups(v)) need.add(g);
    await Promise.all([...need].map((g) => loadPlayerPack(year, g)));
    return {
      sheets: chosen.map((v) => ({ name: v.label, cols: colsForView(v) })),
      rows: exportRows(),
      entity,
      meta: metaFor("Multiple views"),
      slug: chosen.length === DOWNLOAD_VIEWS.length ? "all-views" : "views",
    };
  };
  const exportColumns = exportFields(colsForView(view), entity).length;
  const saveLabel = `Players, ${view.label}${query.trim() ? ` · ${query.trim()}` : ""}`;

  return (
    <>
      <ViewHeader
        kicker="Players"
        title="Player Explorer"
        year={year}
        setYear={setYear}
        meta={meta}
        controls={<Picker label="View" value={view.key} options={VIEW_OPTIONS} onChange={(key) => setTable({ ...table, view: key === "overview" ? undefined : key })} />}
        filter={{ value: query, onChange: setQuery, placeholder: "Filter players", help }}
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
          <ScopeSelect label="Class" scopes={["class"]} options={CLASS_OPTIONS} query={query} setQuery={setQuery} write={(names) => scopedQuery("class", names.join(", "))} width={220} />
          <ScopeSelect label="Position" scopes={["pos"]} options={POSITION_OPTIONS} query={query} setQuery={setQuery} write={(names) => scopedQuery("pos", names.join(", "))} width={220} />
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
            id="player-explorer"
            rows={rows}
            columns={state.value.hasEwins ? columns : columns.filter((c) => c.key !== "ewins")}
            rowKey={playerKey}
            rowHeight={ROW_H}
            defaultSort={{ key: sortKey, dir: view.sortDir === "asc" ? 1 : -1 }}
            tieBreak={byRank}
            ariaLabel="Players"
            empty={<NoMatches query={query} noun="player, team or conference" problem={filterProblem(parsed, PLAYER_STATS, PLAYER_SCOPES)} />}
            peek={{ label: (p) => p.name, body: (p) => <PlayerPeekBody season={state.value} player={p} /> }}
            landOn={landing && target ? { key: landing.id, nonce: target.nonce } : undefined}
            onLanded={onLanded}
            object={object}
            spotlight={spotKey}
            statLens={statLens}
            handle={handle}
          />
        ) : state.status === "loading" ? (
          <TableSkeleton rowHeight={ROW_H} label="Loading players" />
        ) : (
          <LoadError year={year} reason={state.reason} message={state.message} what="Players" onRetry={retry} />
        )}
      </div>
    </>
  );
}
