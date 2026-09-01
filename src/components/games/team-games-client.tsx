"use client";

/**
 * Team Game Log Explorer — the best single team performances.
 *
 * The player Game Log's twin, one level up: a row is one team in one game,
 * 139,000 of them across twelve seasons. Same controls, same shortcuts-then-
 * builder shape, same bounded single-pass scan. What differs is the unit and
 * therefore the questions: not "who had 40" but "who won by 30", "who held
 * someone under 50", "who beat a ranked team".
 *
 * DEFAULT SORT IS NET, not margin. Margin rewards playing fast — a team that
 * wins 95-70 in 80 possessions did less than one that wins 70-50 in 55. Net
 * rating is the same result per hundred possessions, which is the team answer
 * to the player page's Game Score.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { TeamLogo } from "@/components/team-logo";
import { SortableTh } from "@/components/explorer/sortable-th";
import { MultiYearSelect } from "@/components/explorer/multi-year-select";
import { SearchableMultiSelect } from "@/components/explorer/searchable-multi-select";
import { DownloadMenu } from "@/components/explorer/download-menu";
import { GateBar } from "@/components/explorer/gate-bar";
import { SavedFiltersMenu } from "@/components/explorer/saved-filters-menu";
import { GameStatRows, MAX_GAME_COLS } from "@/components/games/game-stat-rows";
import { useDragPan } from "@/lib/use-drag-pan";
import { midrankPercentileMap } from "@/lib/percentile";
import { PercentileChip } from "@/components/percentile-chip";
import { useEntitlement } from "@/lib/use-entitlement";
import { effectiveGameLogAccess, FREE_LIMITS } from "@/lib/access";
import { confDisplay } from "@/lib/conf-display";
import { POWER_CONFS } from "@/lib/conf-tiers";
import { teamSlug } from "@/lib/team-slug";
import type { ExportCol, ExportEntity, ExportInput, MultiExportInput } from "@/lib/table-export";
import {
  HOME, NEUTRAL, T, TEAM_GAME_GROUP_LABEL, TEAM_GAME_PICK_OPTIONS,
  TEAM_GAME_PRESETS, TEAM_GAME_SEASONS, TEAM_GAME_STATS, TEAM_GAME_STAT_BY_KEY,
  TEAM_GAME_VIEWS, TEAM_OP_LABEL, WON,
  fmtTeamGameDate, fmtTeamGameValue, loadTeamGameIndex, parseTeamFilters,
  passesTeamFilters, serializeTeamFilters, teamGameStat, teamGameViewByKey,
  type TeamGameFilter, type TeamGamePack, type TeamGameView,
} from "@/lib/team-game-index";

const ROW_HOVER = "group-hover:bg-[color-mix(in_oklab,var(--coral)_8%,var(--card))]";
const DEFAULT_YEAR = 2026;
const LIMIT_OPTIONS = [50, 100, 250, 500];
const DEFAULT_BASE = "/teams/games";

/**
 * Locks the explorer to one team's season.
 *
 * WHY THE TEAM PAGE RUNS THIS COMPONENT RATHER THAN ITS OWN TABLE. A team's
 * game log and this explorer are the same object at two widths — same rows,
 * same views, same columns, same percentile chips against the same cohort.
 * Building a second one would have meant two tables to keep in step, which is
 * exactly the trap game-stat-rows was extracted to avoid, and they would have
 * drifted the first time a view gained a column.
 *
 * So the scoped mode hides the three pickers that would contradict the page
 * around it — the season is in the URL, the team is the page — and leaves
 * everything else exactly as it is on /teams/games.
 *
 * THE TEAM IS MATCHED BY SLUG, not by name. The page knows "Duke" from
 * teams-all.json and the index knows it from the game logs; those agree today
 * for every team, but a slug comparison cannot be broken by an ampersand or a
 * saint's abbreviation the way a string equality can.
 */
export type TeamGamesScope = {
  slug: string;
  season: number;
  /** Where sort links and filter edits write. The team page's own URL. */
  basePath: string;
};

/** Two filters are the same question. Used to toggle shortcuts on and off. */
const sameFilter = (a: TeamGameFilter, b: TeamGameFilter) =>
  a.stat === b.stat && a.op === b.op && a.value === b.value;

const seasonLabel = (y: number) => `${(y - 1).toString().slice(-2)}-${y.toString().slice(-2)}`;

const EMPTY_PACK = (season: number): TeamGamePack => ({
  season, epoch: "1970-01-01", epochMs: 0, fields: [],
  teams: { names: [], confs: [] }, opps: [], rows: [],
});

// ── URL state ──────────────────────────────────────────────────────────────

type Spec = {
  years: number[];
  confs: string[];
  teams: string[];
  opps: string[];
  view: string;
  /** Stats pinned by the reader, which lead the view's own columns. */
  cols: string[];
  filters: TeamGameFilter[];
  limit: number;
  sortBy: string;
  sortDir: "asc" | "desc";
};

function parseSpec(params: URLSearchParams, fallbackSort: { by: string; dir: "asc" | "desc" }): Spec {
  const years = (params.get("ys") ?? "").split(",").map((s) => Number(s.trim()))
    .filter((n) => TEAM_GAME_SEASONS.includes(n));
  const limit = Number(params.get("n"));
  const sortBy = params.get("sort");
  const order = params.get("order");
  return {
    years: years.length ? years : [DEFAULT_YEAR],
    confs: (params.get("conf") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    teams: (params.get("team") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    opps: (params.get("opp") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    view: teamGameViewByKey(params.get("view")).key,
    // The date column is an identity column the table always draws, so it is
    // not pinnable — allowing it would render it twice.
    cols: (params.get("c") ?? "").split(",").map((k) => k.trim())
      .filter((k) => k && k !== "date" && TEAM_GAME_STAT_BY_KEY.has(k))
      .slice(0, MAX_GAME_COLS),
    filters: parseTeamFilters(params.get("f")),
    limit: LIMIT_OPTIONS.includes(limit) ? limit : 100,
    sortBy: sortBy && teamGameStat(sortBy) ? sortBy : fallbackSort.by,
    sortDir: order ? (order === "asc" ? "asc" : "desc") : fallbackSort.dir,
  };
}

// ── The pass ───────────────────────────────────────────────────────────────

type Hit = { pack: TeamGamePack; row: number[]; idx: number; v: number | null };

/** Filter, sort and cut to `limit` in one linear scan — see games-client. */
function selectRows(packs: TeamGamePack[], spec: Spec, filters: TeamGameFilter[]) {
  const stat = teamGameStat(spec.sortBy) ?? TEAM_GAME_STATS[0]!;
  const dirMul = spec.sortDir === "desc" ? -1 : 1;
  const confSet = new Set(spec.confs);
  const teamSet = new Set(spec.teams);
  const oppSet = new Set(spec.opps);
  const limit = spec.limit;

  const hits: Hit[] = [];
  let matched = 0;

  const cmp = (av: number | null, bv: number | null, a: Hit, b: Hit): number => {
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (av !== bv) return (av - bv) * dirMul;
    if (a.pack.season !== b.pack.season) return b.pack.season - a.pack.season;
    return b.row[T.d]! - a.row[T.d]!;
  };

  for (const pack of packs) {
    // Team-level tests resolve once per team, not once per game.
    const n = pack.teams.names.length;
    const okTeam = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (confSet.size && !confSet.has(pack.teams.confs[i]!)) continue;
      if (teamSet.size && !teamSet.has(pack.teams.names[i]!)) continue;
      okTeam[i] = 1;
    }
    const okOpp = new Uint8Array(pack.opps.length);
    for (let i = 0; i < pack.opps.length; i++) {
      okOpp[i] = !oppSet.size || oppSet.has(pack.opps[i]!) ? 1 : 0;
    }

    const rows = pack.rows;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      if (!okTeam[r[T.t]!]) continue;
      if (!okOpp[r[T.o]!]) continue;
      if (filters.length && !passesTeamFilters(r, filters)) continue;
      matched++;

      // The date stat returns an offset within its own season, which only
      // orders a single season. The pack is in scope here and the stat
      // function cannot see it, so the season is added at the call site.
      const v = stat.key === "date" ? pack.season * 1000 + r[T.d]! : stat.get(r);
      const hit: Hit = { pack, row: r, idx: i, v };
      if (hits.length >= limit) {
        if (cmp(v, hits[hits.length - 1]!.v, hit, hits[hits.length - 1]!) >= 0) continue;
        hits.pop();
      }
      let lo = 0, hi = hits.length;
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

/**
 * Percentiles for one stat over one season's games, computed once and kept.
 *
 * THE COHORT IS EVERY GAME IN THE SEASON, not the rows on screen. A percentile
 * that moved when you filtered would answer a different question each time —
 * "best of the eleven 100-point games you asked for" rather than "where this
 * sits among every game played" — and the column would go flat exactly when a
 * filter made it interesting.
 *
 * Cached at module scope keyed by season and stat: switching views or sorting
 * recomputes nothing, and a season already scanned costs a Map lookup. An
 * 11,500-row midrank is a few milliseconds; twelve seasons of eight columns is
 * not, if it runs on every render.
 */
const PCT_CACHE = new Map<string, Map<number, number>>();

function seasonPercentiles(pack: TeamGamePack, stat: { key: string; get: (r: number[]) => number | null; lowerBetter?: boolean }) {
  const key = `${pack.season}|${stat.key}`;
  const hit = PCT_CACHE.get(key);
  if (hit) return hit;
  const m = midrankPercentileMap(
    pack.rows.map((r, i) => [i, stat.get(r)] as const),
    !stat.lowerBetter,
  );
  PCT_CACHE.set(key, m);
  return m;
}

// ── The page ───────────────────────────────────────────────────────────────

export function TeamGamesClient({ scope }: { scope?: TeamGamesScope } = {}) {
  const router = useRouter();
  const search = useSearchParams();
  const params = useMemo(() => new URLSearchParams(search.toString()), [search]);
  const base = scope?.basePath ?? DEFAULT_BASE;
  /**
   * DEFAULT SORT DIFFERS BY MODE, and it is the one thing that should.
   *
   * The explorer opens on NET because its question is "which were the best
   * games", over 139,000 of them. A team's own log is a log: 38 rows in the
   * order they happened, which is how anybody reads a schedule and how the
   * ticker directly above it is already laid out. Opening it on NET would put
   * the November cupcake first and bury the game the reader came to find.
   */
  const spec = useMemo(
    () => parseSpec(params, scope ? { by: "date", dir: "asc" } : { by: "net", dir: "desc" }),
    [params, scope],
  );

  const { paid, signedIn } = useEntitlement();
  /**
   * NOT GATED ON A TEAM PAGE. The schedule ticker eight inches above this
   * shows every result of the same season for free, and the Pass is sold on
   * the cross-team, cross-season search — "who beat a ranked team by 20" over
   * twelve years — not on a team's own 38 games. Adding "games" to
   * PAID_TEAM_TABS is the one line that reverses this.
   */
  const previewCapped = !scope && effectiveGameLogAccess(paid).kind === "preview";

  const [packs, setPacks] = useState<Map<number, TeamGamePack>>(new Map());

  /** What the table runs, as opposed to what the reader asked for. */
  const scoped = useMemo((): Spec => {
    if (scope) {
      /**
       * The slug resolves against the pack, which means it resolves to
       * NOTHING until the pack lands. That is correct rather than merely
       * tolerable: with no pack there are no rows to show either way, and the
       * table is already showing its loading state. Resolving to a name we
       * guessed would risk showing the wrong team for one frame.
       */
      const names = (packs.get(scope.season)?.teams.names ?? [])
        .filter((n) => teamSlug(n) === scope.slug);
      return {
        ...spec,
        years: [scope.season],
        confs: [],
        teams: names,
        // A season is at most about 40 rows, so the reader never needs to ask
        // for more of them and the "Top 100" selector is noise. 500 is the
        // cap only in the sense that nothing reaches it.
        limit: 500,
      };
    }
    if (!previewCapped) return spec;
    return {
      ...spec,
      years: spec.years.slice(0, FREE_LIMITS.seasonsAtOnce),
      sortBy: "net",
      sortDir: "desc",
      limit: FREE_LIMITS.previewRows,
    };
  }, [spec, previewCapped, scope, packs]);

  const view = useMemo(() => teamGameViewByKey(spec.view), [spec.view]);

  /**
   * Pinned columns lead the table, de-duplicated against the view's own set.
   *
   * THE VIEW KEEPS THE COLUMN AND THE PIN IS WHAT DROPS — same rule as the
   * team explorer. Pinning eFG% while the Four Factors view is up should not
   * print eFG% twice under two different headings; it should do nothing
   * visible, which is exactly what a reader who already has the column wants.
   */
  const pinnedCols = useMemo(
    () => scoped.cols
      .filter((k) => !view.keys.includes(k))
      .map((k) => teamGameStat(k))
      .filter((s): s is NonNullable<typeof s> => !!s),
    [scoped.cols, view.keys],
  );
  const viewCols = useMemo(
    () => view.keys.map((k) => teamGameStat(k)).filter((s): s is NonNullable<typeof s> => !!s),
    [view],
  );
  const cols = useMemo(() => [...pinnedCols, ...viewCols], [pinnedCols, viewCols]);

  const pending = useMemo(() => scoped.years.filter((y) => !packs.has(y)), [scoped.years, packs]);

  useEffect(() => {
    if (!pending.length) return;
    let live = true;
    Promise.all(pending.map((y) => loadTeamGameIndex(y).then((p) => [y, p] as const))).then((got) => {
      if (!live) return;
      setPacks((prev) => {
        const next = new Map(prev);
        for (const [y, p] of got) if (p) next.set(y, p);
        for (const [y] of got) if (!next.has(y)) next.set(y, EMPTY_PACK(y));
        return next;
      });
    });
    return () => { live = false; };
  }, [pending]);

  const active = useMemo(
    () => scoped.years.map((y) => packs.get(y)).filter((p): p is TeamGamePack => !!p),
    [scoped.years, packs],
  );

  const { hits, matched } = useMemo(
    () => selectRows(active, scoped, scoped.filters),
    [active, scoped],
  );

  const update = useCallback((next: Partial<Spec>) => {
    const p = new URLSearchParams(params);
    const setList = (key: string, list: string[] | undefined) => {
      if (!list) return;
      if (list.length) p.set(key, list.join(","));
      else p.delete(key);
    };
    if (next.years) p.set("ys", (next.years.length ? next.years : [DEFAULT_YEAR]).join(","));
    setList("conf", next.confs);
    setList("team", next.teams);
    setList("opp", next.opps);
    setList("c", next.cols);
    if (next.view !== undefined) {
      if (next.view === TEAM_GAME_VIEWS[0]!.key) p.delete("view");
      else p.set("view", next.view);
    }
    if (next.filters !== undefined) {
      const s = serializeTeamFilters(next.filters);
      if (s) p.set("f", s); else p.delete("f");
    }
    if (next.limit !== undefined) {
      if (next.limit === 100) p.delete("n"); else p.set("n", String(next.limit));
    }
    const qs = p.toString();
    router.replace(qs ? `${base}?${qs}` : base, { scroll: false });
  }, [params, router, base]);

  // ── Option lists ─────────────────────────────────────────────────────────
  const confOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const pack of active) {
      for (const c of pack.teams.confs) if (c && !seen.has(c)) seen.set(c, confDisplay(c) || c);
    }
    return [...seen.entries()]
      .map(([value, label]) => ({ value, label, group: POWER_CONFS.has(value) ? "power" : "mid" }))
      .sort((a, b) => (a.group === b.group ? a.label.localeCompare(b.label) : a.group === "power" ? -1 : 1));
  }, [active]);

  const teamOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const pack of active) {
      for (let i = 0; i < pack.teams.names.length; i++) {
        if (spec.confs.length && !spec.confs.includes(pack.teams.confs[i]!)) continue;
        seen.add(pack.teams.names[i]!);
      }
    }
    return [...seen].sort().map((value) => ({ value, label: value }));
  }, [active, spec.confs]);

  const oppOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const pack of active) for (const o of pack.opps) seen.add(o);
    return [...seen].sort().map((value) => ({ value, label: value }));
  }, [active]);

  /**
   * Which shortcuts are ON — plural, because they compose.
   *
   * A shortcut used to REPLACE the filter list, so clicking "Overtime" after
   * "30-point wins" threw the first question away. It is a filter or two with
   * a name on it, so it now behaves like one: clicking adds its filters to
   * whatever is already there, clicking again takes exactly those back out,
   * and what it leaves behind is ORDINARY EDITABLE ROWS in the builder below —
   * a shortcut is a starting point you adjust, not a mode you are in.
   *
   * Its stats are pinned as columns too, the same rule that governs a filter
   * typed by hand: a table filtered on something the reader cannot see is a
   * table that cannot be checked.
   */
  const activePresets = useMemo(() => {
    const on = new Set<string>();
    for (const p of TEAM_GAME_PRESETS) {
      if (p.filters.every((f) => spec.filters.some((g) => sameFilter(f, g)))) on.add(p.key);
    }
    return on;
  }, [spec.filters]);

  const togglePreset = useCallback((p: (typeof TEAM_GAME_PRESETS)[number], on: boolean) => {
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
    const preset = TEAM_GAME_PRESETS.find((p) => activePresets.has(p.key));
    if (preset) return preset.label;
    const f = spec.filters[0];
    if (f) {
      const st = teamGameStat(f.stat);
      const v = st?.fmt === "pct1" ? `${Math.round(f.value * 100)}%` : f.value;
      return `${st?.label ?? f.stat} ${TEAM_OP_LABEL[f.op]} ${v}`;
    }
    return `${view.label} · ${seasonLabel(scope?.season ?? spec.years[0] ?? DEFAULT_YEAR)}`;
  }, [activePresets, spec.filters, spec.years, view.label, scope]);

  /**
   * A saved view is a set of COLUMNS AND QUESTIONS, not a set of teams.
   *
   * Both modes share one saved list on purpose — the columns you want to see
   * a game in are the columns you want everywhere — so the scope keys are
   * stripped in both directions: applying an explorer view to a team page
   * must not navigate that page to Kansas, and saving from a team page must
   * not bake Duke into a view the reader later opens on /teams/games.
   */
  const stripScopeKeys = useCallback((query: string) => {
    if (!scope) return query;
    const p = new URLSearchParams(query);
    for (const k of ["ys", "team", "conf", "n"]) p.delete(k);
    return p.toString();
  }, [scope]);

  const applySaved = useCallback((query: string) => {
    const q = stripScopeKeys(query);
    router.replace(q ? `${base}?${q}` : base, { scroll: false });
  }, [router, base, stripScopeKeys]);

  // ── Export ───────────────────────────────────────────────────────────────
  const exportEntity = useMemo((): ExportEntity<Hit> => ({
    title: "Team Game Log Explorer",
    sheetName: "Team games",
    wideHeader: "Team",
    // The scoped download is one team's season, so it says so in the filename
    // rather than landing in the reader's downloads folder as the fourth
    // "team-game-log.xlsx". The Team and Season columns stay in the sheet even
    // though every row repeats them — a spreadsheet that has left this site
    // cannot rely on the page it came from to say what it is.
    fileStem: scope ? `${scope.slug}-${scope.season}-game-log` : "team-game-log",
    identity: [
      { header: "Team", width: 20, get: (h) => h.pack.teams.names[h.row[T.t]!] ?? "—" },
      { header: "Conf", get: (h) => h.pack.teams.confs[h.row[T.t]!] ?? "" },
      { header: "Season", get: (h) => seasonLabel(h.pack.season) },
      { header: "Date", get: (h) => fmtTeamGameDate(h.pack, h.row) },
      { header: "Opponent", width: 20, get: (h) => h.pack.opps[h.row[T.o]!] ?? "—" },
      { header: "Site", get: (h) => (h.row[T.f]! & NEUTRAL ? "N" : h.row[T.f]! & HOME ? "H" : "A") },
      { header: "Result", get: (h) => (h.row[T.f]! & WON ? "W" : "L") },
      { header: "Score", get: (h) => `${h.row[T.pts]}-${h.row[T.pa]}` },
    ],
    num: (h, key) => teamGameStat(key)?.get(h.row) ?? null,
    pctOf: () => null,
  }), [scope]);

  /**
   * Export columns for ANY view, with the reader's pins leading.
   *
   * Pins are de-duplicated against that view's own keys the same way the table
   * does it, so a download of every view shows a pinned stat once per sheet
   * rather than twice on the sheets that already carry it.
   */
  const exportColsFor = useCallback((v: TeamGameView): ExportCol[] => {
    const toCol = (s: NonNullable<ReturnType<typeof teamGameStat>>, band: string): ExportCol => ({
      label: s.label, total: s.key, pct: "",
      fmt: s.fmt === "pct1" ? "pct1" : s.fmt === "int" ? "int" : "num1",
      band,
    });
    const pinned = scoped.cols
      .filter((k) => !v.keys.includes(k))
      .map((k) => teamGameStat(k))
      .filter((x): x is NonNullable<typeof x> => !!x)
      .map((x) => toCol(x, "Your columns"));
    const own = v.keys.map((k) => teamGameStat(k))
      .filter((x): x is NonNullable<typeof x> => !!x)
      .map((x) => toCol(x, v.label));
    return [...pinned, ...own];
  }, [scoped.cols]);

  const exportMeta = useCallback((label: string) => ({
    viewLabel: label,
    seasons: scoped.years.length === 1 ? seasonLabel(scoped.years[0]!) : `${scoped.years.length} seasons`,
    conference: scoped.confs.length ? scoped.confs.join(", ") : "All conferences",
    teams: scoped.teams.length ? scoped.teams.join(", ") : "All teams",
    filters: spec.filters.length
      ? spec.filters.map((f) => `${teamGameStat(f.stat)?.label ?? f.stat} ${TEAM_OP_LABEL[f.op]} ${f.value}`)
      : ["No filters"],
    sort: `${teamGameStat(spec.sortBy)?.label ?? spec.sortBy} — ${spec.sortDir === "desc" ? "high to low" : "low to high"}`,
    // ExportMeta is shared with tables that still have a search box. This one
    // has no free-text search any more, so the field is present and empty
    // rather than absent.
    search: "",
    url: typeof window === "undefined" ? "" : window.location.href,
  }), [spec, scoped]);

  const buildExport = useCallback((): ExportInput<Hit> => ({
    cols: exportColsFor(view), rows: hits, entity: exportEntity, meta: exportMeta(view.label),
  }), [exportColsFor, view, hits, exportEntity, exportMeta]);

  const buildExportAll = useCallback((viewKeys: string[]): MultiExportInput<Hit> => {
    const wanted = new Set(viewKeys);
    return {
      sheets: TEAM_GAME_VIEWS.filter((v) => wanted.has(v.key)).map((v) => ({ name: v.label, cols: exportColsFor(v) })),
      rows: hits, entity: exportEntity, meta: exportMeta("Multiple views"),
      slug: wanted.size === TEAM_GAME_VIEWS.length ? "all-views" : "views",
    };
  }, [exportColsFor, hits, exportEntity, exportMeta]);

  const downloadViews = useMemo(
    () => TEAM_GAME_VIEWS.map((v) => ({ key: v.key, label: v.label, group: "Views", desc: v.desc })),
    [],
  );

  /**
   * One map per percentile-bearing column in the current view, keyed
   * "<season>|<row index>". Only the columns actually on screen, and only the
   * seasons actually loaded.
   */
  const pcts = useMemo(() => {
    const out = new Map<string, Map<string, number>>();
    for (const c of cols) {
      if (!c.pct) continue;
      const merged = new Map<string, number>();
      for (const pack of active) {
        for (const [i, v] of seasonPercentiles(pack, c)) merged.set(`${pack.season}|${i}`, v);
      }
      out.set(c.key, merged);
    }
    return out;
  }, [cols, active]);

  const gridScrollRef = useRef<HTMLDivElement>(null);
  const panHandlers = useDragPan(gridScrollRef);
  const busy = pending.length > 0;
  const multiYear = scoped.years.length > 1;

  /**
   * Identity columns, for the colSpan of the empty and loading rows: #, Team,
   * W/L, Game, Site, Opponent, Date and the filler cell that eats the slack.
   * The scoped table drops Team, because every row of it is the same team.
   */
  const idCols = scope ? 7 : 8;

  return (
    <div className={cn(
      "bg-card border border-ink/10 border-x-0 lg:border-x rounded-none lg:rounded-xl shadow-md overflow-hidden ring-0 lg:ring-1 ring-ink/5",
      // The explorer is the page, so it bleeds to the edge of a phone and sets
      // its own top margin. Inside a team page it is one section among seven,
      // and the section owns the spacing — otherwise it sits 24px lower than
      // Roster does and 24px out of line with everything above it.
      scope ? "mt-0" : "mt-6 max-md:mt-2 -mx-6 lg:mx-0",
    )}>
      <div className="px-3 lg:px-4 py-2.5 border-b border-hairline flex items-center flex-wrap gap-x-3 gap-y-2">
        {/* SEASON, CONFERENCE AND TEAM ARE THE PAGE. A team page states all
            three in its hero and its URL, so a picker for any of them is an
            invitation to contradict the page you are on — pick Kansas here and
            the heading still says Duke. The Opponent picker survives because
            it is the one of the four that asks something this page has not
            already answered. */}
        {!scope && (<>
        <label className="inline-flex items-center gap-1.5 min-w-0">
          <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium whitespace-nowrap">Seasons</span>
          <MultiYearSelect
            years={spec.years}
            onChange={(years) => update({ years })}
            availableYears={TEAM_GAME_SEASONS}
            className="w-32"
          />
        </label>

        <label className="inline-flex items-center gap-1.5 min-w-0">
          <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium whitespace-nowrap">Conf</span>
          <SearchableMultiSelect
            value={spec.confs} options={confOptions} onChange={(confs) => update({ confs })}
            emptyLabel="All" ariaLabel="Conferences"
            groupLabels={{ power: "Power", mid: "Mid Major" }} className="w-32"
          />
        </label>

        <label className="inline-flex items-center gap-1.5 min-w-0">
          <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium whitespace-nowrap">Team</span>
          <SearchableMultiSelect
            value={spec.teams} options={teamOptions} onChange={(teams) => update({ teams })}
            emptyLabel="All" ariaLabel="Teams" className="w-auto min-w-36 max-w-60"
            renderIcon={(o) => <TeamLogo name={o.value} size={18} />}
          />
        </label>
        </>)}

        <label className="inline-flex items-center gap-1.5 min-w-0">
          <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium whitespace-nowrap">Opp</span>
          <SearchableMultiSelect
            value={spec.opps} options={oppOptions} onChange={(opps) => update({ opps })}
            emptyLabel="All" ariaLabel="Opponents" className="w-auto min-w-36 max-w-60"
            renderIcon={(o) => <TeamLogo name={o.value} size={18} />}
          />
        </label>

        <label className="inline-flex items-center gap-1.5 min-w-0">
          <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium whitespace-nowrap">View</span>
          <select
            value={view.key}
            onChange={(e) => update({ view: e.target.value })}
            aria-label="Table view"
            className="h-8 max-w-48 rounded-md border border-ink/15 bg-card text-ink text-sm px-2 shadow-sm hover:border-ink/25 focus:outline-none focus:ring-2 focus:ring-coral/40 transition-colors"
          >
            {TEAM_GAME_VIEWS.map((v) => (
              <option key={v.key} value={v.key} title={v.desc}>{v.label}</option>
            ))}
          </select>
        </label>

        <SavedFiltersMenu
          currentQuery={stripScopeKeys(params.toString())}
          suggestedName={suggestedName}
          onApply={applySaved}
          scope="team-games"
        />

        <DownloadMenu
          views={downloadViews}
          noun="team games"
          build={buildExport}
          buildAll={buildExportAll}
          rowCount={hits.length}
          colCount={cols.length + idCols}
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

      {/* Shortcuts. */}
      <div className="px-3 lg:px-4 py-2 border-b border-hairline bg-paper-deep/30 flex items-center flex-wrap gap-1.5">
        <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium mr-0.5">Shortcuts</span>
        {TEAM_GAME_PRESETS.map((p) => {
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
        options={TEAM_GAME_PICK_OPTIONS}
        groupLabel={TEAM_GAME_GROUP_LABEL}
        idPrefix="team-games"
        labelOf={(k) => teamGameStat(k)?.label ?? k}
        isPct={(k) => teamGameStat(k)?.fmt === "pct1"}
        onChange={({ cols, filters }) => update({ cols, filters })}
        /* NO FREE-TEXT SEARCH HERE. The Team picker
           in the bar above is already a searchable list of every team in the
           selected seasons — type "tenne", arrow, enter — so a free-text box
           beside it was a second, weaker way to ask the same question: it
           matched substrings instead of selecting, took no more than one team,
           and left the picker showing "All" while the table was filtered.
           The player log lost its own box in the same pass. */
        trailing={
          <>
            {!previewCapped && !scope && (
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

      <div
        ref={gridScrollRef}
        className="overflow-x-auto overscroll-x-contain cursor-grab"
        {...panHandlers}
      >
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-40 w-10 min-w-10 bg-paper-deep border-b border-hairline px-1 sm:px-2 py-2 text-xs uppercase tracking-widest text-ink-muted font-medium text-center align-middle">#</th>
              {/* Dropped when the table is one team's: thirty-eight rows of
                  the same crest and the same word is a column that carries no
                  information and costs the Opponent column its width. The
                  row-number cell keeps the sticky left edge either way. */}
              {!scope && (
                <th className="sticky top-0 z-40 bg-paper-deep border-b border-hairline px-2 sm:px-3 py-2 text-xs uppercase tracking-widest text-ink-muted font-medium text-left align-middle">Team</th>
              )}
              <SortableTh
                statKey="won"
                label="W/L"
                title="Sort wins to the top"
                defaultDir="desc"
                align="left"
                basePath={base}
                defaultSort={scoped.sortBy}
                idleArrows
                locked={previewCapped}
                className="sticky top-0 z-30 bg-paper-deep border-b border-hairline"
              />
              <th className="sticky top-0 z-30 bg-paper-deep border-b border-hairline px-2 py-2 text-xs uppercase tracking-widest text-ink-muted font-medium text-left align-middle whitespace-nowrap">Game</th>
              <th className="sticky top-0 z-30 bg-paper-deep border-b border-hairline px-2 py-2 text-xs uppercase tracking-widest text-ink-muted font-medium text-center align-middle whitespace-nowrap" title="Home, away or a neutral floor">Site</th>
              <th className="sticky top-0 z-30 bg-paper-deep border-b border-hairline px-2 py-2 text-xs uppercase tracking-widest text-ink-muted font-medium text-left align-middle whitespace-nowrap">Opponent</th>
              <SortableTh
                statKey="date"
                label="Date"
                title="Sort by date"
                // Matches the default sort, which differs by mode — see the
                // note on `spec`. With `desc` here the scoped table opened in
                // season order under a header arrow pointing the other way,
                // because this is also what SortableTh reads when the URL
                // carries no `order` of its own.
                defaultDir={scope ? "asc" : "desc"}
                align="left"
                basePath={base}
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
                  basePath={base}
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
              <tr><td colSpan={cols.length + idCols} className="px-4 py-16 text-center text-ink-muted">Loading team games…</td></tr>
            ) : hits.length === 0 ? (
              <tr><td colSpan={cols.length + idCols} className="px-4 py-12 text-center text-ink-soft">No game matches these filters.</td></tr>
            ) : (
              hits.map((h, i) => {
                const zebra = i % 2 === 0 ? "bg-paper" : "bg-card";
                const pack = h.pack;
                const ti = h.row[T.t]!;
                const team = pack.teams.names[ti] ?? "—";
                const conf = pack.teams.confs[ti] ?? "";
                const opp = pack.opps[h.row[T.o]!] ?? "—";
                const flags = h.row[T.f]!;
                const won = (flags & WON) !== 0;
                const site = flags & NEUTRAL ? "N" : flags & HOME ? "vs" : "@";
                return (
                  <tr key={`${pack.season}-${h.idx}`} className={cn("group", zebra)}>
                    <td className={cn("sticky left-0 z-20 w-10 min-w-10 px-1 sm:px-2 py-1.5 text-center text-ink-muted tabular text-xs font-semibold transition-colors", zebra, ROW_HOVER)}>
                      {i + 1}
                    </td>
                    {!scope && (
                      <td className={cn("sticky z-20 px-2 sm:px-3 py-1.5 whitespace-nowrap transition-colors", zebra, ROW_HOVER)}>
                        <span className="inline-flex items-center gap-2 min-w-0">
                          <TeamLogo name={team} size={20} />
                          <Link
                            href={`/teams/${teamSlug(team)}/${pack.season}/`}
                            title={`${team} — ${confDisplay(conf) || conf}`}
                            prefetch={false}
                            className="font-medium text-ink hover:text-coral transition-colors"
                          >
                            {team}
                          </Link>
                        </span>
                      </td>
                    )}
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
                    <td className={cn("px-2 py-1.5 whitespace-nowrap text-xs tabular text-ink transition-colors", ROW_HOVER)}>
                      {h.row[T.pts]}-{h.row[T.pa]}
                    </td>
                    <td className={cn("px-2 py-1.5 text-center text-xs text-ink-muted transition-colors", ROW_HOVER)}>
                      {site}
                    </td>
                    <td className={cn("px-2 py-1.5 whitespace-nowrap transition-colors", ROW_HOVER)}>
                      {/* Same weight and colour as the Team column: the two
                          names in a row are the same kind of thing, and every
                          opponent in this corpus is a D1 team with a page. */}
                      <span className="inline-flex items-center gap-2 min-w-0">
                        <TeamLogo name={opp} size={20} />
                        <Link
                          href={`/teams/${teamSlug(opp)}/${pack.season}/`}
                          title={opp}
                          prefetch={false}
                          className="font-medium text-ink hover:text-coral transition-colors"
                        >
                          {opp}
                        </Link>
                      </span>
                    </td>
                    <td className={cn("px-2 py-1.5 whitespace-nowrap text-xs text-ink-muted tabular transition-colors", ROW_HOVER)}>
                      {fmtTeamGameDate(pack, h.row)}
                    </td>
                    {multiYear && (
                      <td className={cn("px-2 py-1.5 text-ink-muted tabular text-xs transition-colors", ROW_HOVER)}>
                        {seasonLabel(pack.season)}
                      </td>
                    )}
                    {cols.map((c) => {
                      const v = c.get(h.row);
                      const pct = c.pct ? pcts.get(c.key)?.get(`${pack.season}|${h.idx}`) ?? null : null;
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
                          {/* Value over chip, the same stack the team explorer
                              and /conferences use. Columns without a chip keep
                              a spacer so the rows stay one height. */}
                          <span className="inline-flex flex-col items-end gap-0.5">
                            <span>{fmtTeamGameValue(v, c.fmt)}</span>
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

      {previewCapped && !busy && (
        <GateBar
          signedIn={signedIn}
          lead={`Showing the top ${Math.min(FREE_LIMITS.previewRows, matched).toLocaleString()} of ${matched.toLocaleString()}.`}
          tail="The Team Game Log Explorer is part of the Season Pass. Shortcuts, filters and search still work on these rows — the full list, sorting by any column, multiple seasons at once and the download are what a Pass unlocks."
        />
      )}
    </div>
  );
}
