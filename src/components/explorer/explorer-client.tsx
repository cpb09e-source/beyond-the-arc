"use client";

import { useMemo, useState, useEffect, useRef, useCallback, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { dataUrl } from "@/lib/data-url";
import {
  parseSpec,
  processTeams,
  specToParams,
  LIMIT_OPTIONS,
  limitLabel,
  isLowerBetter,
  TEAM_STAT_COLUMNS,
  type RawTeamSeason,
  type TeamRow,
  type StatFilter,
  type TeamFilterSpec,
} from "@/lib/team-filters";
import { Select } from "@/components/select";
import { FilterBar, ConferenceRankingsModal } from "@/components/explorer/filter-bar";
import { TEAM_DRAWER_SLOT_ID, TeamStatFilters, teamStatChipsFromSpec } from "@/components/explorer/team-stat-filters";
import { StatChipStrip } from "@/components/filters/stat-chips";
import { SortableTh } from "@/components/explorer/sortable-th";
import { CompareTeamsModal } from "@/components/explorer/compare-teams-modal";
import { TeamLogo } from "@/components/team-logo";
import { TourneyBadge } from "@/components/tourney-badge";
import { PercentileChip } from "@/components/percentile-chip";
import { confDisplay } from "@/lib/conf-display";
import { useDragPan } from "@/lib/use-drag-pan";
import { useMeasuredWidth } from "@/lib/use-measured-width";

function teamSlug(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function seasonLabel(y: number): string {
  return `${(y - 1).toString().slice(-2)}-${y.toString().slice(-2)}`;
}

/**
 * The default column set, in display order.
 *
 * Deliberately mirrors the /players grid: one entry per column, a band label
 * spanning a group, a percentile chip under every value. Same shape, same
 * visual language, so moving between the two pages feels like one product.
 *
 * `total` is the hero value and `perGame` the small figure beneath it. Only the
 * Four Factors carry both — a rating is already a rate, but a differential reads
 * naturally either way, and seeing "+416" with "10.95/g" under it answers both
 * "how big was the edge" and "how big per night" at once.
 *
 * CHIPS RANK ON THE PER-GAME VALUE. Fast-break totals exist for ~1,500
 * team-seasons but the per-game figure for ~3,800, so ranking on the total would
 * place a team against a biased slice of its own era instead of the whole era.
 */
type TeamCol = {
  label: string;
  total: keyof TeamRow;
  perGame?: keyof TeamRow;
  /** Key into `row.pct` — the percentile the chip renders. */
  pct: string;
  sortKey: string;
  /** Sorting ascending is the "good" direction (defensive rating, turnovers). */
  lowerBetter?: boolean;
  fmt: "num1" | "signed" | "pct1";
  title: string;
};

// Labels drop the "a" prefix — the band caption says "(ADJUSTED)" once, which
// is less noisy than repeating it on every column head.
const RATING_COLS: TeamCol[] = [
  { label: "NET",  total: "a_net",   pct: "a_net",   sortKey: "a_net",   fmt: "num1", title: "Schedule-adjusted net rating — points per 100 possessions vs an average D-I opponent on a neutral floor" },
  { label: "ORTG", total: "a_ortg",  pct: "a_ortg",  sortKey: "a_ortg",  fmt: "num1", title: "Schedule-adjusted offensive rating — points scored per 100 possessions" },
  { label: "DRTG", total: "a_drtg",  pct: "a_drtg",  sortKey: "a_drtg",  fmt: "num1", lowerBetter: true, title: "Schedule-adjusted defensive rating — points allowed per 100 possessions (lower is better)" },
  { label: "SOS",  total: "adj_sos", pct: "adj_sos", sortKey: "adj_sos", fmt: "num1", title: "Strength of schedule — average opponent adjusted net rating" },
  { label: "PACE", total: "cbb_pace", pct: "cbb_pace", sortKey: "cbb_pace", fmt: "num1", title: "Possessions per game" },
];

const FOUR_FACTOR_COLS: TeamCol[] = [
  { label: "REB",  total: "reb_diff_ct",  perGame: "reb_diff_pg",   pct: "reb_diff_pg",   sortKey: "reb_diff_ct",  fmt: "signed", title: "Rebounds − opponent rebounds" },
  { label: "3PM",  total: "fg3m_diff_ct", perGame: "fg3m_diff_pg",  pct: "fg3m_diff_pg",  sortKey: "fg3m_diff_ct", fmt: "signed", title: "3-pointers made − allowed" },
  { label: "FBP",  total: "fbpts_diff",   perGame: "fbpts_diff_pg", pct: "fbpts_diff_pg", sortKey: "fbpts_diff",   fmt: "signed", title: "Fast-break points − allowed. The season total needs 90% of games to have tracked the split, so it is blank on older seasons where the per-game figure still stands." },
  { label: "TOV",  total: "tov_diff_ct",  perGame: "tov_diff_pg",   pct: "tov_diff_pg",   sortKey: "tov_diff_ct",  fmt: "signed", lowerBetter: true, title: "Turnovers − opponent turnovers (negative is good)" },
];

const SHOOTING_COLS: TeamCol[] = [
  { label: "eFG%",  total: "cbb_efg",     pct: "cbb_efg",     sortKey: "cbb_efg",     fmt: "pct1", title: "Effective field-goal % — (FGM + 0.5 × 3PM) / FGA" },
  { label: "3P%",   total: "cbb_fg3",     pct: "cbb_fg3",     sortKey: "cbb_fg3",     fmt: "pct1", title: "3-point %" },
  { label: "3PA Rate",  total: "cbb_fg3rate", pct: "cbb_fg3rate", sortKey: "cbb_fg3rate", fmt: "pct1", title: "3-point attempt rate — 3PA / FGA, how much of the offense comes from deep" },
  { label: "FT%",   total: "cbb_ft",      pct: "cbb_ft",      sortKey: "cbb_ft",      fmt: "pct1", title: "Free-throw %" },
  { label: "FTA Rate",  total: "cbb_ftarate", pct: "cbb_ftarate", sortKey: "cbb_ftarate", fmt: "pct1", title: "Free-throw attempt rate — FTA / FGA, how often the team gets to the line" },
];

const DEFAULT_COLS = [...RATING_COLS, ...FOUR_FACTOR_COLS, ...SHOOTING_COLS];
const DEFAULT_COL_BY_KEY = new Map(DEFAULT_COLS.map((c) => [c.total as string, c]));

/**
 * Build a renderable column for a stat the reader pinned in the filter drawer.
 *
 * When the stat is already a default column we reuse that definition verbatim,
 * so a pinned REB Diff arrives with its per-game sub-figure and its chip keyed
 * to reb_diff_pg — a hand-rolled copy would quietly drop both. Everything else
 * is synthesised from the shared TEAM_STAT_COLUMNS metadata.
 */
function pinnedColumn(key: string): TeamCol | null {
  const reuse = DEFAULT_COL_BY_KEY.get(key);
  if (reuse) return reuse;
  const meta = TEAM_STAT_COLUMNS.find((c) => c.key === key);
  if (!meta) return null;
  const fmt: TeamCol["fmt"] =
    meta.format === "pct1" ? "pct1" : meta.group === "diffs" ? "signed" : "num1";
  return {
    label: meta.label,
    total: key as keyof TeamRow,
    pct: key,
    sortKey: key,
    lowerBetter: isLowerBetter(key),
    fmt,
    title: meta.desc,
  };
}

/** One opaque hover fill so the frozen and scrolling halves read as one row. */
const ROW_HOVER = "group-hover:bg-[color-mix(in_oklab,var(--coral)_8%,var(--card))]";
/** Resting tint marking the Four Factors band, mirroring the EPM band on /players. */
const FF_BAND_TINT = "bg-[color-mix(in_oklab,var(--coral)_3%,transparent)]";

function fmtColValue(v: number | null | undefined, fmt: TeamCol["fmt"]): string {
  if (v === null || v === undefined) return "—";
  if (fmt === "pct1") return (v * 100).toFixed(1) + "%";
  if (fmt === "signed") return (v > 0 ? "+" : "") + v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}


/** Names and years for every team-season, without the stat rows. See page.tsx. */
export type TeamsIndexEntry = { n: string; y: number; c: string | null };

export function ExplorerClient({
  initialTeams,
  teamsIndex,
  latestYear,
  confsByYear,
  coachByTeamYear,
  tourneyFinishByTeamYear,
}: {
  /** The latest season's rows, server-rendered so the table has real content
   *  on first paint. Every other season is fetched on demand. */
  initialTeams: RawTeamSeason[];
  teamsIndex: TeamsIndexEntry[];
  latestYear: number;
  confsByYear: Record<string, string[]>;
  coachByTeamYear: Record<string, string | null>;
  tourneyFinishByTeamYear: Record<string, string>;
}) {
  const [compareOpen, setCompareOpen] = useState(false);
  const [showRankings, setShowRankings] = useState(false);
  // Owned here, not inside TeamStatFilters, so the toolbar's "+N more" chip can
  // open the panel on the full list.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const router = useRouter();
  const [, startTransition] = useTransition();
  const search = useSearchParams();
  const params = useMemo(() => {
    const obj: Record<string, string> = {};
    for (const [k, v] of search.entries()) obj[k] = v;
    return obj;
  }, [search]);
  // Memoize so `spec`'s reference is stable across renders — the page-reset
  // effect keys on it, and a fresh object every render would snap the table back
  // to page 1 on any interaction (breaks pagination).
  const spec = useMemo(() => parseSpec(params), [params]);

  // Union conferences across every year we have data for, so users can pick
  // a historical conference even when the visible-year selection wouldn't
  // include it on its own. Same idea for team names — one flat picker list.
  const conferences = useMemo(() => {
    const s = new Set<string>();
    for (const list of Object.values(confsByYear)) for (const c of list) s.add(c);
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [confsByYear]);
  // From the index, not the loaded rows — the Team picker must offer every
  // school we have ever held, including seasons not currently fetched.
  const teamNames = useMemo(() => {
    const s = new Set<string>();
    for (const t of teamsIndex) s.add(t.n);
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [teamsIndex]);

  // ---- Season rows, loaded on demand -------------------------------------
  //
  // Seeded with the server-rendered latest season so first paint has real rows
  // and no spinner. Selecting another season in the picker fetches just that
  // season; once fetched it stays, so flicking between years is instant after
  // the first visit to each.
  const [rowsByYear, setRowsByYear] = useState<Record<number, RawTeamSeason[]>>(
    () => ({ [latestYear]: initialTeams }),
  );
  const [loadingYears, setLoadingYears] = useState<number[]>([]);
  // Years already requested, so a re-render mid-flight cannot fire a second
  // fetch for the same file. A ref rather than state: it must be updated
  // synchronously, before the effect can run again.
  const requested = useRef<Set<number>>(new Set([latestYear]));

  // Shared with the Compare modal, which needs whichever seasons its slots
  // point at — those are chosen independently of the table's season picker.
  const loadYears = useCallback((years: number[]) => {
    const missing = years.filter((y) => Number.isFinite(y) && !requested.current.has(y));
    if (missing.length === 0) return;
    for (const y of missing) requested.current.add(y);
    setLoadingYears((prev) => [...prev, ...missing]);
    Promise.all(
      missing.map((y) =>
        fetch(dataUrl(`/data/teams-by-year/${y}.json`))
          .then((r) => (r.ok ? r.json() : []))
          // A failed season resolves to no rows rather than rejecting: one bad
          // year should narrow the table, not blank the page.
          .catch(() => [])
          .then((rows: RawTeamSeason[]) => [y, rows] as const),
      ),
    ).then((pairs) => {
      setRowsByYear((prev) => {
        const next = { ...prev };
        for (const [y, rows] of pairs) next[y] = rows;
        return next;
      });
      setLoadingYears((prev) => prev.filter((y) => !missing.includes(y)));
    });
  }, []);

  useEffect(() => { loadYears(spec.years); }, [spec.years, loadYears]);

  /** The rows the table actually works over: the selected seasons, once loaded. */
  const allTeams = useMemo(
    () => spec.years.flatMap((y) => rowsByYear[y] ?? []),
    [spec.years, rowsByYear],
  );
  const loadingSeasons = loadingYears.length > 0;

  // Toolbar read-out of the COMMITTED selection (the panel's own strip tracks
  // the uncommitted draft). Removing here is immediate — there is no Submit on
  // the toolbar, and a chip whose X did nothing until you opened a panel would
  // be a lie.
  const specChips = useMemo(() => teamStatChipsFromSpec(spec.cols, spec.filters), [spec.cols, spec.filters]);
  const removeSpecStat = (key: string) => {
    const next: TeamFilterSpec = {
      ...spec,
      cols: spec.cols.filter((k) => k !== key),
      filters: spec.filters.filter((f) => f.stat !== key),
    };
    const p = specToParams(next).toString();
    startTransition(() => router.replace(p ? `/?${p}` : "/", { scroll: false }));
  };

  // Inline quick-filter on the table — by team name only, separate from the
  // URL-persisted Team picker in the FilterBar above. We run processTeams with
  // limit=-1 so the search matches across the full result set rather than just
  // the top-N visible window, then re-apply the limit after filtering.
  const [tableSearch, setTableSearch] = useState("");
  const [page, setPage] = useState(1);
  // Mobile: the table search collapses to an icon that slides open on tap.
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchPanelRef = useRef<HTMLDivElement>(null);
  // Click-and-drag panning over the stat columns, same gesture as /players.
  const gridScrollRef = useRef<HTMLDivElement>(null);
  const panHandlers = useDragPan(gridScrollRef);
  // The # column is sized by content, not by its `w-12` (see useMeasuredWidth),
  // so the Team column's sticky offset is measured off it rather than assumed.
  const [rankThRef, rankW] = useMeasuredWidth<HTMLTableCellElement>(48);
  const teamLeft = { left: `${rankW}px` };
  // Focus the input on open WITHOUT letting the browser scroll it into view
  // (that scroll-jump is what reads as a "flash" of the table on mobile).
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus({ preventScroll: true });
  }, [searchOpen]);
  // Tap anywhere outside the open search to collapse it.
  useEffect(() => {
    if (!searchOpen) return;
    function onDown(e: PointerEvent) {
      if (searchPanelRef.current && !searchPanelRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
        setTableSearch("");
      }
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [searchOpen]);

  const { rows, count, totalPages, pageSafe } = useMemo(() => {
    const { rows: all } = processTeams(allTeams, { ...spec, limit: -1 });
    const q = tableSearch.trim().toLowerCase();
    const matched = q ? all.filter((r) => r.team_name.toLowerCase().includes(q)) : all;
    const total = matched.length;
    if (spec.limit === -1) {
      return { rows: matched, count: total, totalPages: 1, pageSafe: 1 };
    }
    const totalPages = Math.max(1, Math.ceil(total / spec.limit));
    const pageSafe = Math.min(Math.max(1, page), totalPages);
    const start = (pageSafe - 1) * spec.limit;
    return {
      rows: matched.slice(start, start + spec.limit),
      count: total,
      totalPages,
      pageSafe,
    };
  }, [allTeams, spec, tableSearch, page]);
  // Reset to page 1 when the result set changes (filters, sort, search, limit).
  useEffect(() => { setPage(1); }, [spec, tableSearch]);
  const multiYear = spec.years.length > 1;

  // Pinned columns lead the table, then the default set. A pinned stat that is
  // ALSO a default column deliberately renders twice — Colin's call: the copy on
  // the left is the one you asked to see, and the original stays put so the
  // Ratings / Four Factors / Shooting bands don't develop holes.
  const pinnedCols = useMemo(
    () => spec.cols.map(pinnedColumn).filter((c): c is TeamCol => c !== null),
    [spec.cols],
  );
  const cols = useMemo(() => [...pinnedCols, ...DEFAULT_COLS], [pinnedCols]);
  // Group boundaries shift with the pin count, so they're derived per render
  // rather than being module constants.
  const P = pinnedCols.length;
  const groupStarts = useMemo(
    () => new Set([0, P, P + RATING_COLS.length, P + RATING_COLS.length + FOUR_FACTOR_COLS.length]),
    [P],
  );
  const ffStart = P + RATING_COLS.length;
  const ffEnd = ffStart + FOUR_FACTOR_COLS.length;

  // Live "N teams" for the filter drawer's footer: run the current scope
  // against a candidate filter set without touching the URL. limit:-1 so the
  // count is the real total rather than the visible page.
  const previewCount = useCallback(
    (filters: StatFilter[]) =>
      processTeams(allTeams, { ...spec, filters, limit: -1 }).rows.length,
    [allTeams, spec],
  );

  // Conference rankings — locked to the most-recent season available, regardless
  // of the explorer's current year selection. Drops the worst 2 teams in each
  // conference before averaging aNET (filters out cellar dwellers so the
  // ranking reflects the conference's competitive core).
  // Always the LATEST season's rows, not the selected ones. This panel is
  // defined as "this year's conference strength", so it must not follow the
  // season picker — and since latestYear is the season seeded from the server,
  // those rows are always in hand even when the table is showing 2019.
  // Memoized, not a bare `?? []`. A fresh array literal every render would make
  // the conferenceRankings useMemo below recompute on every keystroke in the
  // table search — the exact cost this whole change exists to remove.
  const latestRows = useMemo(() => rowsByYear[latestYear] ?? [], [rowsByYear, latestYear]);
  const conferenceRankings = useMemo(() => {
    // limit: -1 disables the explorer's default top-50 cap. Without this, we'd
    // only see teams that crack the national top-50 aNET, hiding most of
    // each mid-major conference and inflating the averages.
    const scopedSpec = { ...parseSpec({}), years: [latestYear], limit: -1 };
    const { rows: scoped } = processTeams(latestRows, scopedSpec);
    const byConf = new Map<string, number[]>();
    for (const r of scoped) {
      if (!r.team_conference || r.a_net === null) continue;
      const arr = byConf.get(r.team_conference) ?? [];
      arr.push(r.a_net);
      byConf.set(r.team_conference, arr);
    }
    // Mean aNET of each conference's teams, EXCLUDING its two worst — the
    // measure of a league's competitive core rather than its cellar.
    //
    // Worth knowing when reading the table: because the drop is a fixed count
    // rather than a share, it removes a quarter of an 8-team league and only a
    // ninth of an 18-team one, so it lifts small conferences more than large
    // ones. The modal shows how many teams actually fed each average so that
    // isn't hidden.
    return Array.from(byConf.entries())
      .map(([conference, values]) => {
        const sorted = [...values].sort((a, b) => b - a);
        const kept = sorted.slice(0, Math.max(0, sorted.length - 2));
        const avg = kept.length > 0 ? kept.reduce((s, v) => s + v, 0) / kept.length : null;
        return { conference, avg_a_net: avg, teams: values.length, contributing: kept.length };
      })
      .filter((r): r is { conference: string; avg_a_net: number; teams: number; contributing: number } => r.avg_a_net !== null)
      .sort((a, b) => b.avg_a_net - a.avg_a_net);
  }, [latestRows, latestYear]);

  return (
    <>
      <FilterBar conferences={conferences} teams={teamNames} />

      {/* Same card shell as the /players leaderboard, down to the edge-to-edge
          treatment on mobile and the rounded card + ring on desktop. */}
      <div id="teams-table" className="bg-card border border-ink/10 border-x-0 lg:border-x rounded-none lg:rounded-xl shadow-md overflow-hidden ring-0 lg:ring-1 ring-ink/5 mt-6 scroll-mt-6 -mx-6 lg:mx-0">
        {/* Compact toolbar, matching /players: search + compare on the left,
            sort/order/show on the right, one row, table starts immediately
            below. Replaces a "headline ledger" (accent rule, display-font
            <h2>Teams</h2>, big count) that made this page read as a different
            product from the players table it sits beside in the nav. The page
            heading lives in the page shell now, not inside the data card. */}
        <div className="px-3 lg:px-4 py-2.5 border-b border-hairline bg-paper-deep/30 flex items-center justify-between gap-3 flex-wrap">
          {/* Wraps on narrow screens. Without it the row is one unbreakable
              line and "View Conference Rankings", which is whitespace-nowrap,
              ran ~95px past the right edge of a 390px viewport. */}
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 min-w-0">
            {/* Desktop search */}
            <div className="relative hidden lg:block">
              <SearchGlass className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-muted pointer-events-none" />
              <input
                type="search"
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                placeholder="Search team"
                aria-label="Search teams in table"
                className="h-8 w-56 pl-8 pr-8 rounded-md border border-ink/15 bg-card text-ink text-sm placeholder:text-ink-muted shadow-sm hover:border-ink/25 focus:outline-none focus:ring-2 focus:ring-coral/40 focus:border-coral/40 transition-colors"
              />
              {tableSearch && (
                <button
                  type="button"
                  onClick={() => setTableSearch("")}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-muted hover:text-coral text-base leading-none w-5 h-5 inline-flex items-center justify-center rounded hover:bg-paper-deep"
                >
                  ×
                </button>
              )}
            </div>

            {/* Filters sits left of Compare, the same slot the drawer occupies
                on /players (immediately right of the search box). */}
            <TeamStatFilters previewCount={previewCount} open={filtersOpen} onOpenChange={setFiltersOpen} />

            <button
              type="button"
              onClick={() => setCompareOpen(true)}
              title="Compare teams"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-coral/40 bg-coral/6 text-coral text-[0.6rem] uppercase tracking-widest font-bold hover:bg-coral/10 hover:border-coral/60 transition-colors whitespace-nowrap"
            >
              <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M16 3h5v5" /><path d="M8 21H3v-5" /><path d="M21 3l-7 7" /><path d="M3 21l7-7" />
              </svg>
              Compare
            </button>

            <span className="text-xs text-ink-muted whitespace-nowrap tabular">
              <span className="text-ink font-medium">{rows.length.toLocaleString()}</span>
              {count > rows.length && <> of {count.toLocaleString()}</>} teams
              {/* A season the reader just added is a fetch away, not on the
                  page. Say so rather than briefly showing a short table as if
                  that were the answer. */}
              {loadingSeasons && <span className="ml-1.5 text-coral">· loading season…</span>}
            </span>

            {/* What's currently applied, and the fastest way to undo any of it.
                Capped at six; the rest opens the panel, which shows them all. */}
            <StatChipStrip
              chips={specChips}
              onRemove={removeSpecStat}
              max={6}
              onOverflow={() => setFiltersOpen(true)}
              ariaLabel="Applied columns and filters"
            />
          </div>

          {/* w-full on mobile, matching /players. The sliding mobile search
              panel below is `w-full` of THIS box and parks itself at
              translate-x-105%; when the box was only as wide as its buttons,
              105% of that landed the "closed" panel back inside the card, so a
              second magnifier and a stray "Done" sat visible in the toolbar.
              Full-width pushes it past the card edge, where the card's
              overflow-hidden clips it. */}
          <div className="relative flex items-center gap-2 lg:gap-3 w-full sm:w-auto justify-end min-w-0">
            {/* No sort-by / order selects. Sorting happens by clicking a column
                header, which is how /players works — two controls doing a job
                the table header already does was part of what made these pages
                feel unrelated. Only the row-count select remains, same position
                and shape as the one on /players. */}
            {/* Lives in the controls row rather than with the filters. On a
                phone the left group wraps and this was landing on a line of its
                own, directly above a row that was itself mostly empty. mr-auto
                pins it to the left of that row so the two share one line
                instead of stacking two half-empty ones. */}
            {conferenceRankings.length > 0 && (
              <button
                type="button"
                onClick={() => setShowRankings(true)}
                className="mr-auto text-xs text-coral hover:underline whitespace-nowrap inline-flex items-center min-h-11 sm:min-h-0 py-2 sm:py-0"
              >
                View Conference Rankings →
              </button>
            )}

            <span className="hidden sm:inline text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">Show</span>
            <Select
              value={String(spec.limit)}
              onChange={(v) => {
                const p = specToParams({ ...spec, limit: Number(v) }).toString();
                startTransition(() => router.replace(p ? `/?${p}` : "/", { scroll: false }));
              }}
              ariaLabel="Result count"
              compact
              className="w-16 lg:w-18"
            >
              {LIMIT_OPTIONS.map((n) => <option key={n} value={n}>{limitLabel(n)}</option>)}
            </Select>

            {/* Mobile search icon */}
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-label="Search teams"
              className="lg:hidden shrink-0 h-8 w-8 inline-flex items-center justify-center rounded-md border border-ink/15 bg-card text-ink-muted hover:text-ink hover:border-ink/25 shadow-sm transition-colors"
            >
              <SearchGlass className="w-4 h-4" />
            </button>

            {/* Mobile sliding search — slides over the row from the right on tap.
                text-base (16px) keeps iOS from zooming the page on focus. */}
            <div
              ref={searchPanelRef}
              className={cn(
                "lg:hidden absolute inset-y-0 right-0 w-full flex items-center gap-2 bg-card transform-gpu transition-transform duration-200 ease-out",
                searchOpen ? "translate-x-0" : "translate-x-[105%] pointer-events-none",
              )}
            >
              <div className="relative flex-1">
                <SearchGlass className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="search"
                  inputMode="search"
                  value={tableSearch}
                  onChange={(e) => setTableSearch(e.target.value)}
                  placeholder="Search team…"
                  aria-label="Search teams in table"
                  className="h-8 w-full pl-8 pr-3 rounded-md border border-ink/15 bg-card text-ink text-base placeholder:text-ink-muted shadow-sm focus:outline-none focus:ring-2 focus:ring-coral/40 focus:border-coral/40"
                />
              </div>
              <button
                type="button"
                onClick={() => { setSearchOpen(false); setTableSearch(""); }}
                aria-label="Close search"
                className="shrink-0 h-8 px-2.5 text-sm font-medium text-coral hover:text-ink"
              >
                Done
              </button>
            </div>
          </div>
        </div>

        {/* Where the Filters drawer expands. It portals in here so it sits in
            normal flow between the toolbar and the table — opening it grows the
            card and pushes the table down, rather than covering it. Empty and
            zero-height while closed. */}
        <div id={TEAM_DRAWER_SLOT_ID} />
        {/* Vertical bound is what makes the `sticky top-0 / top-6` header rows
            below actually stick. Without a height the wrapper never scrolls
            vertically — and since `overflow-x: auto` forces `overflow-y` to
            `auto` as well, it still counts as this table's scroll container, so
            the headers had nothing to stick to and simply scrolled off with the
            page. Sizing it to the viewport gives them a scrollport. */}
        <div
          ref={gridScrollRef}
          className="overflow-auto overscroll-x-contain max-h-[calc(100vh-1.5rem)] cursor-grab"
          {...panHandlers}
        >
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              {/* Group-label band — sits ABOVE the column-header row in its own
                  lighter strip so the "Four Factors" caption reads as a section
                  label, not another header. Stays inside <thead> so it stays
                  aligned with the four columns it labels. */}
              {/* Band row — group captions only, no borders, sticky above the
                  header row. Same two-tier treatment as /players. */}
              <tr>
                <th className="sticky top-0 left-0 z-40 w-12 bg-paper-deep h-6 p-0" />
                <th style={teamLeft} className="sticky top-0 z-40 bg-paper-deep h-6 p-0" />
                {/* Spacers for Conf / Season / Rec. These MIRROR the column
                    row below one cell at a time rather than collapsing into a
                    single colSpan, because Conf is `hidden sm:table-cell`: a
                    static colSpan of 2 kept claiming that column on phones
                    where it no longer renders, so every band caption after it —
                    "Your columns" included — sat one column right of the data
                    it labels. colSpan is an attribute, so CSS cannot fix it;
                    the structures have to match. */}
                <th className="sticky top-0 z-30 bg-paper-deep h-6 p-0 hidden sm:table-cell" />
                {multiYear && <th className="sticky top-0 z-30 bg-paper-deep h-6 p-0" />}
                <th className="sticky top-0 z-30 bg-paper-deep h-6 p-0" />
                {P > 0 && (
                  <th colSpan={P} className="sticky top-0 z-30 bg-paper-deep h-6 p-0 px-2 text-[0.58rem] uppercase tracking-[0.15em] font-semibold text-coral text-center border-l border-hairline align-middle">
                    Your columns
                  </th>
                )}
                <th colSpan={RATING_COLS.length} className="sticky top-0 z-30 bg-paper-deep h-6 p-0 px-2 text-[0.58rem] uppercase tracking-[0.15em] font-semibold text-ink-muted text-center border-l border-hairline align-middle">
                  Ratings <span className="text-ink-muted/70">(ADJUSTED)</span>
                </th>
                <th colSpan={FOUR_FACTOR_COLS.length} className="sticky top-0 z-30 bg-paper-deep h-6 p-0 px-2 text-[0.58rem] uppercase tracking-[0.15em] font-semibold text-coral text-center border-l border-hairline align-middle">
                  Four Factors
                </th>
                <th colSpan={SHOOTING_COLS.length} className="sticky top-0 z-30 bg-paper-deep h-6 p-0 px-2 text-[0.58rem] uppercase tracking-[0.15em] font-semibold text-ink-muted text-center border-l border-hairline align-middle">
                  Shooting
                </th>
              </tr>
              <tr>
                <th ref={rankThRef} className="sticky top-6 left-0 z-40 w-12 bg-paper-deep border-b border-hairline px-2 py-3 sm:py-2 text-xs uppercase tracking-widest text-ink-muted font-medium text-center align-middle">#</th>
                <th style={teamLeft} className="sticky top-6 z-40 bg-paper-deep border-b border-hairline px-3 py-3 sm:py-2 text-xs uppercase tracking-widest text-ink-muted font-medium text-left align-middle">Team</th>
                <th className="sticky top-6 z-30 bg-paper-deep border-b border-hairline px-3 py-3 sm:py-2 text-xs uppercase tracking-widest text-ink-muted font-medium text-left align-middle hidden sm:table-cell">Conf</th>
                {multiYear && <th className="sticky top-6 z-30 bg-paper-deep border-b border-hairline px-3 py-3 sm:py-2 text-xs uppercase tracking-widest text-ink-muted font-medium text-left align-middle">Season</th>}
                <th className="sticky top-6 z-30 bg-paper-deep border-b border-hairline px-1.5 sm:px-3 py-3 sm:py-2 text-xs uppercase tracking-widest text-ink-muted font-medium text-left align-middle">
                  {/* "Record" is seven letters of tracking-widest type over a
                      five-character value like "37-3", so the header, not the
                      data, was setting this column's width. */}
                  <span className="sm:hidden">Rec</span>
                  <span className="hidden sm:inline">Record</span>
                </th>
                {cols.map((c, i) => (
                  <SortableTh
                    // Index-qualified: a pinned stat that is also a default
                    // column appears twice on purpose, so the label alone is not
                    // unique and React was warning once per duplicated cell.
                    key={`${c.sortKey}-${i}`}
                    statKey={c.sortKey}
                    label={c.label}
                    title={c.title}
                    defaultDir={c.lowerBetter ? "asc" : "desc"}
                    basePath="/"
                    defaultSort="a_net"
                    idleArrows
                    className={cn(
                      "sticky top-6 z-30 bg-paper-deep border-b border-hairline",
                      groupStarts.has(i) && "border-l border-hairline",
                    )}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={(multiYear ? 5 : 4) + cols.length} className="px-4 py-12 text-center text-ink-muted">
                    No teams match these filters.
                  </td>
                </tr>
              ) : (
                rows.map((r, i) => {
                  // Opaque zebra so the frozen columns can share it and still
                  // hide the scrolled content behind them.
                  const zebra = i % 2 === 0 ? "bg-paper" : "bg-card";
                  return (
                  <tr key={`${r.team_id}-${r.team_year}`} className={cn("group", zebra)}>
                    <td className={cn("sticky left-0 z-20 w-12 px-2 py-1 text-center text-ink-muted tabular text-xs font-semibold transition-colors cursor-default", zebra, ROW_HOVER)}>
                      {(spec.limit === -1 ? 0 : (pageSafe - 1) * spec.limit) + i + 1}
                    </td>
                    <td style={teamLeft} className={cn("sticky z-20 px-3 py-1 transition-colors", zebra, ROW_HOVER)}>
                      <Link
                        href={`/teams/${teamSlug(r.team_name)}/${r.team_year}`}
                        className="inline-flex items-center gap-2.5 group"
                        aria-label={r.team_name}
                      >
                        <TeamLogo name={r.team_name} size={24} />
                        <span className="hidden sm:inline font-medium text-ink group-hover:text-coral transition-colors">
                          {r.team_name}
                        </span>
                        <TourneyBadge teamName={r.team_name} year={r.team_year} />
                      </Link>
                    </td>
                    <td className={cn("px-3 py-1 text-ink-muted hidden sm:table-cell transition-colors", ROW_HOVER)}>{confDisplay(r.team_conference)}</td>
                    {multiYear && <td className={cn("px-3 py-1 text-ink-muted tabular transition-colors", ROW_HOVER)}>{seasonLabel(r.team_year)}</td>}
                    <td className={cn("px-1.5 sm:px-3 py-1 tabular text-ink-muted whitespace-nowrap transition-colors", ROW_HOVER)}>{r.record ?? "—"}</td>
                    {cols.map((c, ci) => {
                      // TeamRow has no index signature, and the column model
                      // addresses it by key — a narrow cast here beats widening
                      // the type and losing field-name checking everywhere else.
                      const cell = r as unknown as Record<string, number | null>;
                      const total = cell[c.total as string] ?? null;
                      const perGame = c.perGame ? cell[c.perGame as string] ?? null : null;
                      const isFF = ci >= ffStart && ci < ffEnd;
                      return (
                        <td
                          key={`${c.sortKey}-${ci}`}
                          className={cn(
                            "px-2 py-1 text-right tabular whitespace-nowrap transition-colors",
                            isFF && FF_BAND_TINT,
                            groupStarts.has(ci) && "border-l border-hairline",
                            ROW_HOVER,
                          )}
                        >
                          <span className="inline-flex flex-col items-end gap-0.5 leading-tight">
                            {/* Season total is the value. When it's unavailable —
                                fast break before 2023, where too few games tracked
                                the split to total honestly — fall back to the
                                per-game figure rather than an empty dash. It keeps
                                its "/g" so the two are never confused: a bare
                                number in a totals column that silently switched
                                units would be worse than the dash it replaced. */}
                            {total !== null ? (
                              <span className={cn(c.label === "NET" && "font-semibold text-ink")}>
                                {fmtColValue(total, c.fmt)}
                              </span>
                            ) : c.perGame && perGame !== null ? (
                              <span
                                className="text-ink-soft"
                                title="Season total unavailable — too few games tracked this split. Showing the per-game average over the games that did."
                              >
                                {(perGame > 0 ? "+" : "") + perGame.toFixed(1)}
                                <span className="text-[0.6rem] text-ink-muted">/g</span>
                              </span>
                            ) : (
                              <span className="text-ink-muted">—</span>
                            )}
                            <PercentileChip pct={r.pct[c.pct] ?? null} />
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {spec.limit !== -1 && totalPages > 1 && (
          <TeamPagination
            firstShown={(pageSafe - 1) * spec.limit + 1}
            lastShown={Math.min(pageSafe * spec.limit, count)}
            total={count}
            page={pageSafe}
            totalPages={totalPages}
            onPage={(p) => {
              setPage(p);
              document.getElementById("teams-table")?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          />
        )}
      </div>

      {/* Head-to-head compare modal — triggered from the "Click to compare
          teams" link in the Teams card header. Renders via a portal so it
          can sit on top of the page regardless of where the trigger lives. */}
      <CompareTeamsModal
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        teamsIndex={teamsIndex}
        rowsByYear={rowsByYear}
        loadYears={loadYears}
        coachByTeamYear={coachByTeamYear}
        tourneyFinishByTeamYear={tourneyFinishByTeamYear}
      />

      {showRankings && (
        <ConferenceRankingsModal
          rankings={conferenceRankings}
          years={[latestYear]}
          onClose={() => setShowRankings(false)}
        />
      )}
    </>
  );
}

function SearchGlass({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx={11} cy={11} r={7} />
      <line x1={20} y1={20} x2={16.65} y2={16.65} />
    </svg>
  );
}

function TeamPagination({
  firstShown, lastShown, total, page, totalPages, onPage,
}: {
  firstShown: number; lastShown: number; total: number; page: number; totalPages: number; onPage: (p: number) => void;
}) {
  const items = paginationItems(page, totalPages);
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 border-t border-hairline text-xs text-ink-muted">
      <span>
        Showing <span className="text-ink tabular">{firstShown.toLocaleString()}</span>–
        <span className="text-ink tabular">{lastShown.toLocaleString()}</span> of{" "}
        <span className="text-ink tabular">{total.toLocaleString()}</span>
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPage(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="px-2 py-1 rounded hover:bg-paper-deep/60 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
          aria-label="Previous page"
        >‹ Prev</button>
        {items.map((it, i) =>
          it === "…" ? (
            <span key={`gap-${i}`} className="px-2 text-ink-muted hidden sm:inline">…</span>
          ) : (
            <button
              key={it}
              type="button"
              onClick={() => onPage(it)}
              aria-current={it === page ? "page" : undefined}
              className={cn(
                "min-w-8 px-2 py-1 rounded tabular transition-colors hidden sm:inline-block",
                it === page ? "bg-coral text-white font-medium" : "hover:bg-paper-deep/60",
              )}
            >{it}</button>
          ),
        )}
        <span className="sm:hidden tabular px-1">{page} / {totalPages}</span>
        <button
          type="button"
          onClick={() => onPage(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="px-2 py-1 rounded hover:bg-paper-deep/60 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
          aria-label="Next page"
        >Next ›</button>
      </div>
    </div>
  );
}

function paginationItems(page: number, totalPages: number): Array<number | "…"> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const want = new Set<number>([1, totalPages, page, page - 1, page + 1, page - 2, page + 2]);
  const visible = [...want].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b);
  const out: Array<number | "…"> = [];
  let prev = 0;
  for (const n of visible) {
    if (n - prev > 1) out.push("…");
    out.push(n);
    prev = n;
  }
  return out;
}
