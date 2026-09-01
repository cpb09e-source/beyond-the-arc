"use client";

/**
 * Game Log Explorer — the best single games, not the best seasons.
 *
 * Every other table on this site aggregates: a season, a career, a conference.
 * This one refuses to. A row is one player in one game, which is the unit the
 * sport is actually watched in and the only one that can answer "has anyone
 * ever gone for 40 and 20", "who has the most threes in a night", "what does a
 * 5x5 look like".
 *
 * THE DEFAULT VIEW IS ALREADY THE ANSWER TO A QUESTION. Opening the page sorts
 * the current season by Game Score, so the first screen is the best games
 * anyone has had, before a single control is touched. The shortcuts row turns
 * the next eight questions into one click each, and the filter builder is there
 * for the ninth.
 *
 * PERFORMANCE, because 115,000 rows a season is not a table you can be casual
 * with. Rows stay packed integer arrays; the pass over them allocates nothing
 * per row and keeps only the top N in a bounded insert, so twelve seasons —
 * 1.37 million rows — sorts in one linear scan without building 1.37 million
 * objects to throw away.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { TeamLogo } from "@/components/team-logo";
import { PlayerName } from "@/components/player-name";
import { SortableTh } from "@/components/explorer/sortable-th";
import { MultiYearSelect } from "@/components/explorer/multi-year-select";
import { SearchableMultiSelect } from "@/components/explorer/searchable-multi-select";
import { DownloadMenu } from "@/components/explorer/download-menu";
import { useDragPan } from "@/lib/use-drag-pan";
import { useEntitlement } from "@/lib/use-entitlement";
import { GateBar } from "@/components/explorer/gate-bar";
import { SavedFiltersMenu } from "@/components/explorer/saved-filters-menu";
import { GameStatRows, MAX_GAME_COLS } from "@/components/games/game-stat-rows";
import { effectiveGameLogAccess, FREE_LIMITS } from "@/lib/access";
import { confDisplay } from "@/lib/conf-display";
import { POWER_CONFS } from "@/lib/conf-tiers";
import type { ExportCol, ExportEntity, ExportInput, MultiExportInput } from "@/lib/table-export";
import {
  F, GAME_GROUP_LABEL, GAME_PICK_OPTIONS, GAME_PRESETS, GAME_SEASONS, GAME_STATS,
  GAME_STAT_BY_KEY, GAME_VIEWS, HOME, NEUTRAL, WON,
  fmtGameDate, fmtGameValue, gameStat, gameViewByKey, loadGameIndex,
  OP_LABEL, parseFilters, passesFilters, serializeFilters,
  type GameFilter, type GamePack, type GameView,
} from "@/lib/game-index";

const ROW_HOVER = "group-hover:bg-[color-mix(in_oklab,var(--coral)_8%,var(--card))]";
const DEFAULT_YEAR = 2026;
const LIMIT_OPTIONS = [50, 100, 250, 500];
const BASE = "/players/games";

/** Two filters are the same question. Used to toggle shortcuts on and off. */
const sameFilter = (a: GameFilter, b: GameFilter) =>
  a.stat === b.stat && a.op === b.op && a.value === b.value;

const seasonLabel = (y: number) => `${(y - 1).toString().slice(-2)}-${y.toString().slice(-2)}`;

/**
 * Stand-in for a season whose file did not load.
 *
 * It holds no rows, so the table simply has less to show — which is the honest
 * outcome — and its presence in the map is what stops the fetch effect from
 * asking again on every render.
 */
const EMPTY_PACK = (season: number): GamePack => ({
  season, epoch: "1970-01-01", epochMs: 0, fields: [], classes: [],
  players: { ids: [], names: [], teams: [], confs: [], cls: [], page: [], rank: [] },
  opps: [], rows: [],
});

// ── URL state ──────────────────────────────────────────────────────────────

type GameSpec = {
  years: number[];
  confs: string[];
  teams: string[];
  classes: string[];
  view: string;
  /** Stats pinned by the reader, which lead the view's own columns. */
  cols: string[];
  filters: GameFilter[];
  limit: number;
  sortBy: string;
  sortDir: "asc" | "desc";
};

function parseSpec(params: URLSearchParams): GameSpec {
  const years = (params.get("ys") ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => GAME_SEASONS.includes(n));
  const limit = Number(params.get("n"));
  const sortBy = params.get("sort");
  const order = params.get("order");
  return {
    years: years.length ? years : [DEFAULT_YEAR],
    confs: (params.get("conf") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    teams: (params.get("team") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    classes: (params.get("cls") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    view: gameViewByKey(params.get("view")).key,
    // Date is an identity column the table always draws, so it is not
    // pinnable — allowing it would render it twice.
    cols: (params.get("c") ?? "").split(",").map((k) => k.trim())
      .filter((k) => k && k !== "date" && GAME_STAT_BY_KEY.has(k))
      .slice(0, MAX_GAME_COLS),
    filters: parseFilters(params.get("f")),
    limit: LIMIT_OPTIONS.includes(limit) ? limit : 100,
    // Game Score, high to low: the page's thesis in a default.
    sortBy: sortBy && gameStat(sortBy) ? sortBy : "gmsc",
    sortDir: order === "asc" ? "asc" : "desc",
  };
}

// ── The pass ───────────────────────────────────────────────────────────────

type Hit = { pack: GamePack; row: number[]; idx: number; v: number | null };

/**
 * Filter, sort and cut to `limit` in ONE linear scan.
 *
 * A conventional filter-then-sort would materialise every match — 115,000
 * objects on an unfiltered season, twelve times that across the archive — to
 * show at most five hundred. This keeps a sorted array of at most `limit` and
 * compares each row against its worst member, so the allocation is bounded by
 * what the screen shows rather than by what the corpus holds.
 */
function selectRows(
  packs: GamePack[],
  spec: GameSpec,
  filters: GameFilter[],
): { hits: Hit[]; matched: number } {
  const stat = gameStat(spec.sortBy) ?? GAME_STATS[0]!;
  const dirMul = spec.sortDir === "desc" ? -1 : 1;
  const confSet = new Set(spec.confs);
  const teamSet = new Set(spec.teams);
  const clsSet = new Set(spec.classes);
  const limit = spec.limit;

  const hits: Hit[] = [];
  let matched = 0;

  /** Negative when `a` should sit above `b`. Blanks are always last. */
  const cmp = (av: number | null, bv: number | null, a: Hit, b: Hit): number => {
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (av !== bv) return (av - bv) * dirMul;
    // Ties break newest-first, so the same 40-point night does not shuffle
    // between renders.
    if (a.pack.season !== b.pack.season) return b.pack.season - a.pack.season;
    return b.row[F.d]! - a.row[F.d]!;
  };

  for (const pack of packs) {
    // Player-level filters resolve ONCE per player, not once per game: a
    // conference test inside the row loop would run 115,000 times to answer
    // 5,000 distinct questions.
    const n = pack.players.ids.length;
    const ok = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (confSet.size && !confSet.has(pack.players.confs[i]!)) continue;
      if (teamSet.size && !teamSet.has(pack.players.teams[i]!)) continue;
      if (clsSet.size && !clsSet.has(pack.classes[pack.players.cls[i]!] ?? "")) continue;
      ok[i] = 1;
    }

    const rows = pack.rows;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      if (!ok[r[F.p]!]) continue;
      if (filters.length && !passesFilters(r, filters)) continue;
      matched++;

      // The date stat returns an offset within its own season; the season is
      // added here because the stat function cannot see which pack it came
      // from.
      const v = stat.key === "date" ? pack.season * 1000 + r[F.d]! : stat.get(r);
      const hit: Hit = { pack, row: r, idx: i, v };
      if (hits.length >= limit) {
        // Worse than everything already kept — the common case, and the reason
        // this is fast.
        if (cmp(v, hits[hits.length - 1]!.v, hit, hits[hits.length - 1]!) >= 0) continue;
        hits.pop();
      }
      let lo = 0;
      let hi = hits.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cmp(v, hits[mid]!.v, hit, hits[mid]!) < 0) hi = mid;
        else lo = mid + 1;
      }
      hits.splice(lo, 0, hit);
    }
  }
  return { hits, matched };
}

// ── The page ───────────────────────────────────────────────────────────────

export function GamesClient() {
  const router = useRouter();
  const search = useSearchParams();
  const params = useMemo(() => new URLSearchParams(search.toString()), [search]);
  const spec = useMemo(() => parseSpec(params), [params]);

  // Unknown membership resolves as entitled — see useEntitlement. A paying
  // reader must never watch their own table lock itself and unlock again.
  const { paid, signedIn } = useEntitlement();
  const previewCapped = effectiveGameLogAccess(paid).kind === "preview";

  /**
   * What the TABLE runs, as opposed to what the reader asked for.
   *
   * THE LIMIT LIVES HERE, not on the controls. Capping the pickers stops
   * someone assembling a twelve-season sort; it does nothing about a URL that
   * already carries one — a link from a subscriber, or an address bar. So the
   * narrowing happens on the query, and the controls are a courtesy that
   * explains the ceiling.
   *
   * The URL is never rewritten: subscribing restores the exact table the
   * reader was looking at rather than making them rebuild it.
   */
  const scoped = useMemo((): GameSpec => {
    if (!previewCapped) return spec;
    return {
      ...spec,
      years: spec.years.slice(0, FREE_LIMITS.seasonsAtOnce),
      // A preview cannot be re-sorted, so the sort is the page's own default
      // rather than whatever the URL asked for. Without this the five rows
      // are still a ranking — just a shorter one — and the header locks would
      // be decoration.
      sortBy: "gmsc",
      sortDir: "desc",
      limit: FREE_LIMITS.previewRows,
    };
  }, [spec, previewCapped]);
  const view = useMemo(() => gameViewByKey(spec.view), [spec.view]);

  /**
   * Pinned columns lead the table, de-duplicated against the view's own set —
   * the view keeps the column and the pin is what drops, so pinning a stat the
   * view already shows does nothing rather than printing it twice.
   */
  const pinnedCols = useMemo(
    () => scoped.cols
      .filter((k) => !view.keys.includes(k))
      .map((k) => gameStat(k))
      .filter((s): s is NonNullable<typeof s> => !!s),
    [scoped.cols, view.keys],
  );
  const viewCols = useMemo(
    () => view.keys.map((k) => gameStat(k)).filter((s): s is NonNullable<typeof s> => !!s),
    [view],
  );
  const cols = useMemo(() => [...pinnedCols, ...viewCols], [pinnedCols, viewCols]);

  // ── Seasons, fetched on demand and kept ──────────────────────────────────
  const [packs, setPacks] = useState<Map<number, GamePack>>(new Map());
  /**
   * What is still in flight is DERIVED from what has arrived, not tracked in a
   * second state. Two sources of truth for "is this loading" is how a table
   * ends up spinning over rows it already has.
   */
  const pending = useMemo(
    () => scoped.years.filter((y) => !packs.has(y)),
    [scoped.years, packs],
  );

  useEffect(() => {
    if (!pending.length) return;
    let live = true;
    Promise.all(pending.map((y) => loadGameIndex(y).then((p) => [y, p] as const))).then((got) => {
      if (!live) return;
      setPacks((prev) => {
        const next = new Map(prev);
        for (const [y, p] of got) if (p) next.set(y, p);
        // A season whose file failed still has to leave `pending`, or the
        // effect re-fires forever. loadGameIndex caches the rejection, so the
        // retry would not even hit the network.
        for (const [y] of got) if (!next.has(y)) next.set(y, EMPTY_PACK(y));
        return next;
      });
    });
    return () => { live = false; };
  }, [pending]);

  const active = useMemo(
    () => scoped.years.map((y) => packs.get(y)).filter((p): p is GamePack => !!p),
    [scoped.years, packs],
  );

  // Typing in the search box re-scans a million rows; deferring it keeps the
  // keystrokes themselves at full speed.
  const { hits, matched } = useMemo(
    () => selectRows(active, scoped, scoped.filters),
    [active, scoped],
  );

  // ── URL writes ───────────────────────────────────────────────────────────
  const update = useCallback((next: Partial<GameSpec>) => {
    const p = new URLSearchParams(params);
    const setList = (key: string, list: string[] | undefined) => {
      if (!list) return;
      if (list.length) p.set(key, list.join(","));
      else p.delete(key);
    };
    if (next.years) p.set("ys", (next.years.length ? next.years : [DEFAULT_YEAR]).join(","));
    setList("conf", next.confs);
    setList("team", next.teams);
    setList("cls", next.classes);
    setList("c", next.cols);
    if (next.view !== undefined) {
      if (next.view === GAME_VIEWS[0]!.key) p.delete("view");
      else p.set("view", next.view);
    }
    if (next.filters !== undefined) {
      const s = serializeFilters(next.filters);
      if (s) p.set("f", s);
      else p.delete("f");
    }
    if (next.limit !== undefined) {
      if (next.limit === 100) p.delete("n");
      else p.set("n", String(next.limit));
    }
    const qs = p.toString();
    router.replace(qs ? `${BASE}?${qs}` : BASE, { scroll: false });
  }, [params, router]);

  // ── Option lists ─────────────────────────────────────────────────────────
  const confOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const pack of active) {
      for (const c of pack.players.confs) {
        if (c && !seen.has(c)) seen.set(c, confDisplay(c) || c);
      }
    }
    return [...seen.entries()]
      .map(([value, label]) => ({ value, label, group: POWER_CONFS.has(value) ? "power" : "mid" }))
      .sort((a, b) => (a.group === b.group ? a.label.localeCompare(b.label) : a.group === "power" ? -1 : 1));
  }, [active]);

  const teamOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const pack of active) {
      const n = pack.players.ids.length;
      for (let i = 0; i < n; i++) {
        const t = pack.players.teams[i]!;
        if (!t) continue;
        // A conference picker narrows the team list too — 360 teams is a lot
        // to scroll when you have already said "Big Ten".
        if (spec.confs.length && !spec.confs.includes(pack.players.confs[i]!)) continue;
        seen.add(t);
      }
    }
    return [...seen].sort().map((value) => ({ value, label: value }));
  }, [active, spec.confs]);

  const classOptions = useMemo(
    () => ["Fr", "So", "Jr", "Sr", "Gr"].map((value) => ({ value, label: value })),
    [],
  );

  /**
   * Which shortcuts are ON — plural, because they compose.
   *
   * A shortcut used to REPLACE the filter list, so clicking "40-point games"
   * after "Double-double" threw the first question away. It is a filter or two
   * with a name on it, so it behaves like one: clicking adds, clicking again
   * removes exactly what it added, and the chips left behind are editable like
   * any other.
   */
  const activePresets = useMemo(() => {
    const on = new Set<string>();
    for (const p of GAME_PRESETS) {
      if (p.filters.every((f) => spec.filters.some((g) => sameFilter(f, g)))) on.add(p.key);
    }
    return on;
  }, [spec.filters]);

  const togglePreset = useCallback((p: (typeof GAME_PRESETS)[number], on: boolean) => {
    const filters = on
      ? spec.filters.filter((g) => !p.filters.some((f) => sameFilter(f, g)))
      : [...spec.filters, ...p.filters.filter((f) => !spec.filters.some((g) => sameFilter(f, g)))];
    // Turning a shortcut OFF takes its columns with it, unless a filter the
    // reader wrote themselves still needs one.
    const cols = on
      ? spec.cols.filter((k) => !p.filters.some((f) => f.stat === k) || filters.some((f) => f.stat === k))
      : [...new Set([...spec.cols, ...p.filters.map((f) => f.stat)])].slice(0, MAX_GAME_COLS);
    update({ filters, cols });
  }, [spec.filters, spec.cols, update]);

  /**
   * What the save box opens with.
   *
   * The most specific true thing about the table, in that order: the shortcut
   * if one is on, else the first filter written out, else the view and the
   * season. A default of "Saved filter 3" would make the list unreadable a
   * week later, which is the only time anybody reads it.
   */
  const suggestedName = useMemo(() => {
    const preset = GAME_PRESETS.find((p) => activePresets.has(p.key));
    if (preset) return preset.label;
    const f = spec.filters[0];
    if (f) {
      const st = gameStat(f.stat);
      const v = st?.fmt === "pct1" ? `${Math.round(f.value * 100)}%` : f.value;
      return `${st?.label ?? f.stat} ${OP_LABEL[f.op]} ${v}`;
    }
    return `${view.label} · ${seasonLabel(spec.years[0] ?? DEFAULT_YEAR)}`;
  }, [activePresets, spec.filters, spec.years, view.label]);

  const applySaved = useCallback((query: string) => {
    router.replace(query ? `${BASE}?${query}` : BASE, { scroll: false });
  }, [router]);

  // ── Export ───────────────────────────────────────────────────────────────
  const exportEntity = useMemo((): ExportEntity<Hit> => ({
    title: "Game Log Explorer",
    sheetName: "Games",
    wideHeader: "Player",
    fileStem: "game-log",
    identity: [
      { header: "Player", width: 22, get: (h) => h.pack.players.names[h.row[F.p]!] ?? "—" },
      { header: "Team", width: 18, get: (h) => h.pack.players.teams[h.row[F.p]!] ?? "—" },
      { header: "Conf", get: (h) => h.pack.players.confs[h.row[F.p]!] ?? "" },
      { header: "Class", get: (h) => h.pack.classes[h.pack.players.cls[h.row[F.p]!]!] ?? "" },
      { header: "Season", get: (h) => seasonLabel(h.pack.season) },
      { header: "Date", get: (h) => fmtGameDate(h.pack, h.row) },
      { header: "Opponent", width: 18, get: (h) => h.pack.opps[h.row[F.o]!] ?? "—" },
      { header: "Site", get: (h) => (h.row[F.f]! & NEUTRAL ? "N" : h.row[F.f]! & HOME ? "H" : "A") },
      { header: "Result", get: (h) => (h.row[F.f]! & WON ? "W" : "L") },
    ],
    num: (h, key) => gameStat(key)?.get(h.row) ?? null,
    // No percentiles on this page: a single game's rank among a hundred
    // thousand others is not a number anyone reads, and an empty column would
    // read as data we failed to compute.
    pctOf: () => null,
  }), []);

  /** Export columns for ANY view, with the reader's pins leading each sheet. */
  const exportColsFor = useCallback((v: GameView): ExportCol[] => {
    const toCol = (s: NonNullable<ReturnType<typeof gameStat>>, band: string): ExportCol => ({
      label: s.label,
      total: s.key,
      pct: "",
      fmt: s.fmt === "pct1" ? "pct1" : s.fmt === "int" ? "int" : "num1",
      band,
    });
    const pinned = scoped.cols
      .filter((k) => !v.keys.includes(k))
      .map((k) => gameStat(k))
      .filter((x): x is NonNullable<typeof x> => !!x)
      .map((x) => toCol(x, "Your columns"));
    const own = v.keys
      .map((k) => gameStat(k))
      .filter((x): x is NonNullable<typeof x> => !!x)
      .map((x) => toCol(x, v.label));
    return [...pinned, ...own];
  }, [scoped.cols]);

  const exportMeta = useCallback((label: string) => ({
    viewLabel: label,
    seasons: spec.years.length === 1 ? seasonLabel(spec.years[0]!) : `${spec.years.length} seasons`,
    conference: spec.confs.length ? spec.confs.join(", ") : "All conferences",
    teams: spec.teams.length ? spec.teams.join(", ") : "All teams",
    filters: spec.filters.length
      ? spec.filters.map((f) => `${gameStat(f.stat)?.label ?? f.stat} ${OP_LABEL[f.op]} ${f.value}`)
      : ["No filters"],
    sort: `${gameStat(spec.sortBy)?.label ?? spec.sortBy} — ${spec.sortDir === "desc" ? "high to low" : "low to high"}`,
    // ExportMeta is shared with tables that still have a search box; this one
    // does not, so the field is present and empty rather than absent.
    search: "",
    url: typeof window === "undefined" ? "" : window.location.href,
  }), [spec]);

  const buildExport = useCallback((): ExportInput<Hit> => ({
    cols: exportColsFor(view),
    rows: hits,
    entity: exportEntity,
    meta: exportMeta(view.label),
  }), [exportColsFor, view, hits, exportEntity, exportMeta]);

  const buildExportAll = useCallback((viewKeys: string[]): MultiExportInput<Hit> => {
    const wanted = new Set(viewKeys);
    return {
      sheets: GAME_VIEWS.filter((v) => wanted.has(v.key)).map((v) => ({ name: v.label, cols: exportColsFor(v) })),
      rows: hits,
      entity: exportEntity,
      meta: exportMeta("Multiple views"),
      slug: wanted.size === GAME_VIEWS.length ? "all-views" : "views",
    };
  }, [exportColsFor, hits, exportEntity, exportMeta]);

  const downloadViews = useMemo(
    () => GAME_VIEWS.map((v) => ({ key: v.key, label: v.label, group: "Views", desc: v.desc })),
    [],
  );

  const gridScrollRef = useRef<HTMLDivElement>(null);
  const panHandlers = useDragPan(gridScrollRef);
  const busy = pending.length > 0;
  const multiYear = scoped.years.length > 1;

  return (
    <div className="bg-card border border-ink/10 border-x-0 lg:border-x rounded-none lg:rounded-xl shadow-md overflow-hidden ring-0 lg:ring-1 ring-ink/5 mt-6 max-md:mt-2 -mx-6 lg:mx-0">
      {/* Scope. Same controls, same order and same labels as the other two
          explorers, so the muscle memory carries over. */}
      <div className="px-3 lg:px-4 py-2.5 border-b border-hairline flex items-center flex-wrap gap-x-3 gap-y-2">
        <label className="inline-flex items-center gap-1.5 min-w-0">
          <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium whitespace-nowrap">Seasons</span>
          <MultiYearSelect
            years={spec.years}
            onChange={(years) => update({ years })}
            availableYears={GAME_SEASONS}
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
            className="w-32"
          />
        </label>

        <label className="inline-flex items-center gap-1.5 min-w-0">
          <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium whitespace-nowrap">Team</span>
          <SearchableMultiSelect
            value={spec.teams}
            options={teamOptions}
            onChange={(teams) => update({ teams })}
            emptyLabel="All"
            ariaLabel="Teams"
            className="w-auto min-w-36 max-w-60"
            renderIcon={(o) => <TeamLogo name={o.value} size={18} />}
          />
        </label>

        <label className="inline-flex items-center gap-1.5 min-w-0">
          <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium whitespace-nowrap">Class</span>
          <SearchableMultiSelect
            value={spec.classes}
            options={classOptions}
            onChange={(classes) => update({ classes })}
            emptyLabel="All"
            ariaLabel="Class"
            className="w-24"
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
            {GAME_VIEWS.map((v) => (
              <option key={v.key} value={v.key} title={v.desc}>{v.label}</option>
            ))}
          </select>
        </label>

        <SavedFiltersMenu
          currentQuery={params.toString()}
          suggestedName={suggestedName}
          onApply={applySaved}
          scope="player-games"
        />

        <DownloadMenu
          views={downloadViews}
          noun="games"
          build={buildExport}
          buildAll={buildExportAll}
          rowCount={hits.length}
          colCount={cols.length + 9}
          disabled={busy || hits.length === 0}
        />

        <span className="hidden sm:inline text-xs text-ink-muted tabular whitespace-nowrap">
          {busy
            ? `loading ${pending.map(seasonLabel).join(", ")}…`
            : `${matched.toLocaleString()} ${matched === 1 ? "game" : "games"}${matched > hits.length ? ` · showing ${hits.length}` : ""}`}
        </span>
        {previewCapped && spec.years.length > 1 && (
          <span className="hidden sm:inline text-xs text-ink-muted whitespace-nowrap">
            · {seasonLabel(scoped.years[0]!)} only
          </span>
        )}
      </div>

      {/* Shortcuts. Eight questions this page is for, one click each. */}
      <div className="px-3 lg:px-4 py-2 border-b border-hairline bg-paper-deep/30 flex items-center flex-wrap gap-1.5">
        <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium mr-0.5">Shortcuts</span>
        {GAME_PRESETS.map((p) => {
          const on = activePresets.has(p.key);
          return (
            <button
              key={p.key}
              type="button"
              title={p.desc}
              aria-pressed={on}
              onClick={() => togglePreset(p, on)}
              className={cn(
                "h-6 px-2 rounded-md text-[0.7rem] font-medium border transition-colors",
                on
                  ? "bg-coral text-white border-coral"
                  : "bg-card text-ink-soft border-ink/12 hover:border-ink/25 hover:text-ink",
              )}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {/* The filter builder — the team explorer's rows, over game stats.
          Bounding a stat pins it as a column, so the two doors above and the
          view dropdown all end up describing the same set. */}
      <GameStatRows
        cols={spec.cols}
        filters={spec.filters}
        options={GAME_PICK_OPTIONS}
        groupLabel={GAME_GROUP_LABEL}
        idPrefix="player-games"
        labelOf={(k) => gameStat(k)?.label ?? k}
        isPct={(k) => gameStat(k)?.fmt === "pct1"}
        onChange={({ cols, filters }) => update({ cols, filters })}
        /* NO FREE-TEXT SEARCH HERE EITHER — the team log lost its box in the
           same pass, for a related reason. This page answers "what are the best
           single games", and a name box quietly turns it into "the best games
           by this one player", which is what a player's own page is for. What
           it did well is already covered: the Team and Conf pickers narrow the
           field, and a player you can name has a profile with their whole log
           on it. */
        trailing={
          <>
            {/* A row-count picker under a five-row cap would be a control that
                does nothing. The bar under the table says why it is missing. */}
            {!previewCapped && (
              <select
                value={spec.limit}
                onChange={(e) => update({ limit: Number(e.target.value) })}
                aria-label="Rows shown"
                className="h-8 rounded-md border border-ink/15 bg-card text-ink text-sm px-2 shadow-sm hover:border-ink/25 focus:outline-none focus:ring-2 focus:ring-coral/40"
              >
                {LIMIT_OPTIONS.map((n) => <option key={n} value={n}>Top {n}</option>)}
              </select>
            )}
          </>
        }
      />

      {/* Click-and-drag panning over the stat columns, same gesture as the
          other tables. Touch scrolls natively and is left alone. */}
      <div
        ref={gridScrollRef}
        className="overflow-x-auto overscroll-x-contain cursor-grab"
        {...panHandlers}
      >
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-40 w-10 min-w-10 bg-paper-deep border-b border-hairline px-1 sm:px-2 py-2 text-xs uppercase tracking-widest text-ink-muted font-medium text-center align-middle">#</th>
              <th className="sticky top-0 z-40 bg-paper-deep border-b border-hairline px-2 sm:px-3 py-2 text-xs uppercase tracking-widest text-ink-muted font-medium text-left align-middle">Player</th>
              <SortableTh
                statKey="won"
                label="W/L"
                title="Sort wins to the top"
                defaultDir="desc"
                align="left"
                basePath={BASE}
                defaultSort={scoped.sortBy}
                idleArrows
                locked={previewCapped}
                className="sticky top-0 z-30 bg-paper-deep border-b border-hairline"
              />
              <th className="sticky top-0 z-30 bg-paper-deep border-b border-hairline px-2 py-2 text-xs uppercase tracking-widest text-ink-muted font-medium text-center align-middle whitespace-nowrap" title="Home, away or a neutral floor">Site</th>
              <th className="sticky top-0 z-30 bg-paper-deep border-b border-hairline px-2 py-2 text-xs uppercase tracking-widest text-ink-muted font-medium text-left align-middle whitespace-nowrap">Opponent</th>
              <SortableTh
                statKey="date"
                label="Date"
                title="Sort by date"
                defaultDir="desc"
                align="left"
                basePath={BASE}
                defaultSort={scoped.sortBy}
                idleArrows
                locked={previewCapped}
                className="sticky top-0 z-30 bg-paper-deep border-b border-hairline"
              />
              {multiYear && (
                <th className="sticky top-0 z-30 bg-paper-deep border-b border-hairline px-2 py-2 text-xs uppercase tracking-widest text-ink-muted font-medium text-left align-middle">Season</th>
              )}
              {cols.map((c) => (
                <SortableTh
                  key={c.key}
                  statKey={c.key}
                  label={c.label}
                  title={c.title}
                  defaultDir={c.lowerBetter ? "asc" : "desc"}
                  basePath={BASE}
                  defaultSort={scoped.sortBy}
                  idleArrows
                  locked={previewCapped}
                  className="sticky top-0 z-30 bg-paper-deep border-b border-hairline"
                />
              ))}
              <th aria-hidden className="sticky top-0 z-30 bg-paper-deep border-b border-hairline w-full p-0" />
            </tr>
          </thead>
          <tbody>
            {busy ? (
              <tr><td colSpan={cols.length + 7} className="px-4 py-16 text-center text-ink-muted">Loading games…</td></tr>
            ) : hits.length === 0 ? (
              <tr>
                <td colSpan={cols.length + 7} className="px-4 py-12 text-center text-ink-soft">
                  No game matches these filters.
                </td>
              </tr>
            ) : (
              hits.map((h, i) => {
                const zebra = i % 2 === 0 ? "bg-paper" : "bg-card";
                const pi = h.row[F.p]!;
                const pack = h.pack;
                const name = pack.players.names[pi] ?? "—";
                const team = pack.players.teams[pi] ?? "—";
                const cls = pack.classes[pack.players.cls[pi]!] ?? "";
                const bart = pack.players.ids[pi]!;
                const hasPage = pack.players.page[pi] === 1;
                const opp = pack.opps[h.row[F.o]!] ?? "—";
                const flags = h.row[F.f]!;
                const won = (flags & WON) !== 0;
                // "@" for a road game, "vs" at home, "N" for a neutral floor —
                // which is the distinction that decides whether a 40-point
                // night was a hard one.
                const site = flags & NEUTRAL ? "N" : flags & HOME ? "vs" : "@";
                return (
                  <tr key={`${pack.season}-${h.idx}`} className={cn("group", zebra)}>
                    <td className={cn("sticky left-0 z-20 w-10 min-w-10 px-1 sm:px-2 py-1.5 text-center text-ink-muted tabular text-xs font-semibold transition-colors", zebra, ROW_HOVER)}>
                      {i + 1}
                    </td>
                    <td className={cn("sticky z-20 px-2 sm:px-3 py-1.5 whitespace-nowrap transition-colors", zebra, ROW_HOVER)}>
                      <span className="inline-flex items-center gap-2 min-w-0">
                        <TeamLogo name={team} size={20} />
                        <span className="min-w-0">
                          {hasPage ? (
                            <Link
                              href={`/players/${bart}`}
                              title={`${name} — ${team}`}
                              prefetch={false}
                              className="font-medium text-ink hover:text-coral transition-colors"
                            >
                              <PlayerName name={name} />
                            </Link>
                          ) : (
                            <span className="font-medium text-ink" title={`${name} — ${team}`}>
                              <PlayerName name={name} />
                            </span>
                          )}
                          {cls && <span className="ml-1.5 text-[0.65rem] text-ink-muted">{cls}</span>}
                        </span>
                      </span>
                    </td>
                    <td className={cn("px-2 py-1.5 text-center text-xs transition-colors", ROW_HOVER)}>
                      {/* A RED L, not a grey one. The muted L was the odd
                          member of a set: the schedule ticker, the game
                          overview's result tiles and the coach page all pair a
                          green W with a red L, and only this column dropped the
                          loss to neutral — so a page could show the same game
                          two ways. It also made the column half-scannable,
                          since a colour that only marks wins means the eye has
                          to read every other row rather than see it. */}
                      <span className={cn("font-semibold", won ? "text-good" : "text-bad")}>
                        {won ? "W" : "L"}
                      </span>
                    </td>
                    <td className={cn("px-2 py-1.5 text-center text-xs text-ink-muted transition-colors", ROW_HOVER)}>
                      {site}
                    </td>
                    <td className={cn("px-2 py-1.5 whitespace-nowrap transition-colors", ROW_HOVER)}>
                      {/* Same weight and colour as the Player column, but NOT
                          a link: this corpus keeps non-D1 opponents, and half
                          the names here have no page to send anyone to. */}
                      <span className="inline-flex items-center gap-2 min-w-0">
                        <TeamLogo name={opp} size={20} />
                        <span className="font-medium text-ink max-w-[11rem] truncate" title={opp}>{opp}</span>
                      </span>
                    </td>
                    <td className={cn("px-2 py-1.5 whitespace-nowrap text-xs text-ink-muted tabular transition-colors", ROW_HOVER)}>
                      {fmtGameDate(pack, h.row)}
                    </td>
                    {multiYear && (
                      <td className={cn("px-2 py-1.5 text-ink-muted tabular text-xs transition-colors", ROW_HOVER)}>
                        {seasonLabel(pack.season)}
                      </td>
                    )}
                    {cols.map((c) => {
                      const v = c.get(h.row);
                      return (
                        <td
                          key={c.key}
                          className={cn(
                            "px-2 py-1.5 text-right tabular transition-colors",
                            c.key === scoped.sortBy ? "text-ink font-semibold" : "text-ink",
                            v === null && "text-ink-muted",
                            ROW_HOVER,
                          )}
                        >
                          {fmtGameValue(v, c.fmt)}
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

      {/* UNDER THE TABLE, NOT OVER IT: the argument for subscribing is the
          five real rows above it — the best games anyone had, found by the
          reader's own filter. */}
      {previewCapped && !busy && (
        <GateBar
          signedIn={signedIn}
          lead={`Showing the top ${Math.min(FREE_LIMITS.previewRows, matched).toLocaleString()} of ${matched.toLocaleString()}.`}
          tail={
            "The Game Log Explorer is part of the Season Pass. Shortcuts, filters and search still work on these rows — the full list, sorting by any column, multiple seasons at once and the download are what a Pass unlocks."
          }
        />
      )}
    </div>
  );
}
