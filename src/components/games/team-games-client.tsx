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
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { TeamLogo } from "@/components/team-logo";
import { SortableTh } from "@/components/explorer/sortable-th";
import { MultiYearSelect } from "@/components/explorer/multi-year-select";
import { SearchableMultiSelect } from "@/components/explorer/searchable-multi-select";
import { DownloadMenu } from "@/components/explorer/download-menu";
import { GateBar } from "@/components/explorer/gate-bar";
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
  HOME, NEUTRAL, T, TEAM_GAME_PRESETS, TEAM_GAME_SEASONS, TEAM_GAME_STATS,
  TEAM_GAME_VIEWS, TEAM_OP_LABEL, WON,
  fmtTeamGameDate, fmtTeamGameValue, loadTeamGameIndex, parseTeamFilters,
  passesTeamFilters, serializeTeamFilters, teamGameStat, teamGameViewByKey,
  type TeamGameFilter, type TeamGameOp, type TeamGamePack, type TeamGameView,
} from "@/lib/team-game-index";

const ROW_HOVER = "group-hover:bg-[color-mix(in_oklab,var(--coral)_8%,var(--card))]";
const DEFAULT_YEAR = 2026;
const LIMIT_OPTIONS = [50, 100, 250, 500];
const BASE = "/teams/games";

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
  filters: TeamGameFilter[];
  q: string;
  limit: number;
  sortBy: string;
  sortDir: "asc" | "desc";
};

function parseSpec(params: URLSearchParams): Spec {
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
    filters: parseTeamFilters(params.get("f")),
    q: params.get("q") ?? "",
    limit: LIMIT_OPTIONS.includes(limit) ? limit : 100,
    sortBy: sortBy && teamGameStat(sortBy) ? sortBy : "net",
    sortDir: order === "asc" ? "asc" : "desc",
  };
}

// ── The pass ───────────────────────────────────────────────────────────────

type Hit = { pack: TeamGamePack; row: number[]; idx: number; v: number | null };

/** Filter, sort and cut to `limit` in one linear scan — see games-client. */
function selectRows(packs: TeamGamePack[], spec: Spec, filters: TeamGameFilter[], q: string) {
  const stat = teamGameStat(spec.sortBy) ?? TEAM_GAME_STATS[0]!;
  const dirMul = spec.sortDir === "desc" ? -1 : 1;
  const needle = q.trim().toLowerCase();
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
      if (needle && !pack.teams.names[i]!.toLowerCase().includes(needle)) continue;
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

      const v = stat.get(r);
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

export function TeamGamesClient() {
  const router = useRouter();
  const search = useSearchParams();
  const params = useMemo(() => new URLSearchParams(search.toString()), [search]);
  const spec = useMemo(() => parseSpec(params), [params]);

  const { paid, signedIn } = useEntitlement();
  const previewCapped = effectiveGameLogAccess(paid).kind === "preview";

  /** What the table runs, as opposed to what the reader asked for. */
  const scoped = useMemo((): Spec => {
    if (!previewCapped) return spec;
    return {
      ...spec,
      years: spec.years.slice(0, FREE_LIMITS.seasonsAtOnce),
      sortBy: "net",
      sortDir: "desc",
      limit: FREE_LIMITS.previewRows,
    };
  }, [spec, previewCapped]);

  const view = useMemo(() => teamGameViewByKey(spec.view), [spec.view]);
  const cols = useMemo(
    () => view.keys.map((k) => teamGameStat(k)).filter((s): s is NonNullable<typeof s> => !!s),
    [view],
  );

  const [packs, setPacks] = useState<Map<number, TeamGamePack>>(new Map());
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

  const deferredQ = useDeferredValue(scoped.q);
  const { hits, matched } = useMemo(
    () => selectRows(active, scoped, scoped.filters, deferredQ),
    [active, scoped, deferredQ],
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
    if (next.view !== undefined) {
      if (next.view === TEAM_GAME_VIEWS[0]!.key) p.delete("view");
      else p.set("view", next.view);
    }
    if (next.filters !== undefined) {
      const s = serializeTeamFilters(next.filters);
      if (s) p.set("f", s); else p.delete("f");
    }
    if (next.q !== undefined) {
      if (next.q) p.set("q", next.q); else p.delete("q");
    }
    if (next.limit !== undefined) {
      if (next.limit === 100) p.delete("n"); else p.set("n", String(next.limit));
    }
    const qs = p.toString();
    router.replace(qs ? `${BASE}?${qs}` : BASE, { scroll: false });
  }, [params, router]);

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

  // ── Filter builder ───────────────────────────────────────────────────────
  const [draft, setDraft] = useState<{ stat: string; op: TeamGameOp; value: string }>({
    stat: "pts", op: "ge", value: "",
  });

  const addFilter = useCallback(() => {
    const n = Number(draft.value);
    if (!draft.stat || !Number.isFinite(n)) return;
    const s = teamGameStat(draft.stat);
    const value = s?.fmt === "pct1" ? n / 100 : n;
    update({ filters: [...spec.filters, { stat: draft.stat, op: draft.op, value }] });
    setDraft((d) => ({ ...d, value: "" }));
  }, [draft, spec.filters, update]);

  const removeFilter = useCallback((i: number) => {
    update({ filters: spec.filters.filter((_, j) => j !== i) });
  }, [spec.filters, update]);

  const activePreset = useMemo(() => {
    const now = serializeTeamFilters(spec.filters);
    return TEAM_GAME_PRESETS.find((p) => serializeTeamFilters(p.filters) === now)?.key ?? null;
  }, [spec.filters]);

  // ── Export ───────────────────────────────────────────────────────────────
  const exportEntity = useMemo((): ExportEntity<Hit> => ({
    title: "Team Game Log Explorer",
    sheetName: "Team games",
    wideHeader: "Team",
    fileStem: "team-game-log",
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
  }), []);

  const exportColsFor = useCallback((v: TeamGameView): ExportCol[] =>
    v.keys.map((k) => teamGameStat(k))
      .filter((s): s is NonNullable<typeof s> => !!s)
      .map((s) => ({
        label: s.label, total: s.key, pct: "",
        fmt: s.fmt === "pct1" ? "pct1" : s.fmt === "int" ? "int" : "num1",
        band: v.label,
      })), []);

  const exportMeta = useCallback((label: string) => ({
    viewLabel: label,
    seasons: spec.years.length === 1 ? seasonLabel(spec.years[0]!) : `${spec.years.length} seasons`,
    conference: spec.confs.length ? spec.confs.join(", ") : "All conferences",
    teams: spec.teams.length ? spec.teams.join(", ") : "All teams",
    filters: spec.filters.length
      ? spec.filters.map((f) => `${teamGameStat(f.stat)?.label ?? f.stat} ${TEAM_OP_LABEL[f.op]} ${f.value}`)
      : ["No filters"],
    sort: `${teamGameStat(spec.sortBy)?.label ?? spec.sortBy} — ${spec.sortDir === "desc" ? "high to low" : "low to high"}`,
    search: spec.q,
    url: typeof window === "undefined" ? "" : window.location.href,
  }), [spec]);

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

  return (
    <div className="bg-card border border-ink/10 border-x-0 lg:border-x rounded-none lg:rounded-xl shadow-md overflow-hidden ring-0 lg:ring-1 ring-ink/5 mt-6 max-md:mt-2 -mx-6 lg:mx-0">
      <div className="px-3 lg:px-4 py-2.5 border-b border-hairline flex items-center flex-wrap gap-x-3 gap-y-2">
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
            emptyLabel="All" ariaLabel="Teams" className="w-36"
          />
        </label>

        <label className="inline-flex items-center gap-1.5 min-w-0">
          <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium whitespace-nowrap">Opp</span>
          <SearchableMultiSelect
            value={spec.opps} options={oppOptions} onChange={(opps) => update({ opps })}
            emptyLabel="All" ariaLabel="Opponents" className="w-36"
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

        <DownloadMenu
          views={downloadViews}
          noun="team games"
          build={buildExport}
          buildAll={buildExportAll}
          rowCount={hits.length}
          colCount={cols.length + 8}
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
        {TEAM_GAME_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            title={p.desc}
            onClick={() => update({ filters: activePreset === p.key ? [] : p.filters })}
            className={cn(
              "h-6 px-2 rounded-md text-[0.7rem] font-medium border transition-colors",
              activePreset === p.key
                ? "bg-coral text-white border-coral"
                : "bg-card text-ink-soft border-ink/12 hover:border-ink/25 hover:text-ink",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Filter builder. */}
      <div className="px-3 lg:px-4 py-2 border-b border-hairline flex items-center flex-wrap gap-x-2 gap-y-2">
        <select
          value={draft.stat}
          onChange={(e) => setDraft((d) => ({ ...d, stat: e.target.value }))}
          aria-label="Filter stat"
          className="h-8 rounded-md border border-ink/15 bg-card text-ink text-sm px-2 shadow-sm hover:border-ink/25 focus:outline-none focus:ring-2 focus:ring-coral/40"
        >
          {TEAM_GAME_STATS.filter((s) => s.filterable).map((s) => (
            <option key={s.key} value={s.key} title={s.title}>{s.label}</option>
          ))}
        </select>
        <select
          value={draft.op}
          onChange={(e) => setDraft((d) => ({ ...d, op: e.target.value as TeamGameOp }))}
          aria-label="Comparison"
          className="h-8 w-14 rounded-md border border-ink/15 bg-card text-ink text-sm px-2 shadow-sm hover:border-ink/25 focus:outline-none focus:ring-2 focus:ring-coral/40"
        >
          {(["ge", "le", "eq"] as TeamGameOp[]).map((op) => (
            <option key={op} value={op}>{TEAM_OP_LABEL[op]}</option>
          ))}
        </select>
        <input
          type="number"
          inputMode="decimal"
          value={draft.value}
          placeholder="Value"
          onChange={(e) => setDraft((d) => ({ ...d, value: e.target.value }))}
          onKeyDown={(e) => { if (e.key === "Enter") addFilter(); }}
          aria-label="Filter value"
          className="h-8 w-24 rounded-md border border-ink/15 bg-card text-ink text-sm px-2 shadow-sm hover:border-ink/25 focus:outline-none focus:ring-2 focus:ring-coral/40"
        />
        <button
          type="button"
          onClick={addFilter}
          disabled={draft.value === ""}
          className="h-8 px-3 rounded-md text-sm font-semibold bg-coral text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-coral-soft transition-colors"
        >
          Add filter
        </button>

        {spec.filters.map((f, i) => {
          const s = teamGameStat(f.stat);
          const shown = s?.fmt === "pct1" ? `${(f.value * 100).toFixed(0)}%` : f.value;
          return (
            <span
              key={`${f.stat}-${f.op}-${f.value}-${i}`}
              className="inline-flex items-center gap-1 h-7 pl-2 pr-1 rounded-md bg-ink/[0.06] text-xs font-medium text-ink"
            >
              {s?.label ?? f.stat} {TEAM_OP_LABEL[f.op]} {shown}
              <button
                type="button"
                onClick={() => removeFilter(i)}
                aria-label={`Remove ${s?.label ?? f.stat} filter`}
                className="inline-flex items-center justify-center w-4 h-4 rounded text-ink-muted hover:text-coral hover:bg-ink/10 transition-colors"
              >
                ×
              </button>
            </span>
          );
        })}
        {spec.filters.length > 1 && (
          <button
            type="button"
            onClick={() => update({ filters: [] })}
            className="text-xs text-ink-muted hover:text-coral underline underline-offset-2 transition-colors"
          >
            clear all
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <input
            type="search"
            value={spec.q}
            onChange={(e) => update({ q: e.target.value })}
            placeholder="Team name…"
            aria-label="Search team"
            className="h-8 w-40 rounded-md border border-ink/15 bg-card text-ink text-sm px-2 shadow-sm hover:border-ink/25 focus:outline-none focus:ring-2 focus:ring-coral/40"
          />
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
        </div>
      </div>

      <div
        ref={gridScrollRef}
        className="overflow-x-auto overscroll-x-contain cursor-grab"
        {...panHandlers}
      >
        <table className="w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-40 w-10 min-w-10 bg-paper-deep border-b border-hairline px-1 sm:px-2 py-2 text-xs uppercase tracking-widest text-ink-muted font-medium text-center align-middle">#</th>
              <th className="sticky top-0 z-40 bg-paper-deep border-b border-hairline px-2 sm:px-3 py-2 text-xs uppercase tracking-widest text-ink-muted font-medium text-left align-middle">Team</th>
              <th className="sticky top-0 z-30 bg-paper-deep border-b border-hairline px-2 py-2 text-xs uppercase tracking-widest text-ink-muted font-medium text-left align-middle whitespace-nowrap">Game</th>
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
              <tr><td colSpan={cols.length + 4} className="px-4 py-16 text-center text-ink-muted">Loading team games…</td></tr>
            ) : hits.length === 0 ? (
              <tr><td colSpan={cols.length + 4} className="px-4 py-12 text-center text-ink-soft">No game matches these filters.</td></tr>
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
                    <td className={cn("px-2 py-1.5 whitespace-nowrap text-xs transition-colors", ROW_HOVER)}>
                      <span className="inline-flex items-center gap-1.5">
                        <span className={cn("font-semibold tabular", won ? "text-good" : "text-ink-muted")}>
                          {won ? "W" : "L"}
                        </span>
                        <span className="tabular text-ink-soft">{h.row[T.pts]}-{h.row[T.pa]}</span>
                        <span className="text-ink-muted">{site}</span>
                        <TeamLogo name={opp} size={16} />
                        <span className="hidden sm:inline text-ink-soft max-w-[9rem] truncate">{opp}</span>
                        <span className="text-ink-muted tabular">{fmtTeamGameDate(pack, h.row)}</span>
                      </span>
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
