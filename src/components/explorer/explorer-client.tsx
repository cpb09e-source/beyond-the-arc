"use client";

import { useMemo, useState, useEffect, useRef, useCallback, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Lock } from "lucide-react";
import { loadSeason, type SeasonDenial } from "@/lib/season-data";
import { clampToFreeTier, effectiveViewAccess, viewAccess, FREE_LIMITS } from "@/lib/access";
import { GateBar } from "@/components/explorer/gate-bar";
import { useEntitlement } from "@/lib/use-entitlement";
import {
  parseSpec,
  processTeams,
  specToParams,
  LIMIT_OPTIONS,
  limitLabel,
  isLowerBetter,
  TEAM_STAT_COLUMNS,
  teamStatColumn,
  type RawTeamSeason,
  type TeamRow,
  type StatFilter,
  type TeamFilterSpec,
  type TeamStatKey,
} from "@/lib/team-filters";
import { Select } from "@/components/select";
import { FilterBar, ConferenceRankingsModal } from "@/components/explorer/filter-bar";
import { TeamStatFilters } from "@/components/explorer/team-stat-filters";
import { PREVIEW_SEASON } from "@/lib/seasons";
import { TABLE_VIEWS, viewByKey, viewGroups, type TableView } from "@/lib/team-views";
import { SortableTh } from "@/components/explorer/sortable-th";
import { CompareTeamsModal } from "@/components/explorer/compare-teams-modal";
import { DownloadMenu } from "@/components/explorer/download-menu";
import { TEAM_ENTITY } from "@/lib/table-export";
import { SavedFiltersMenu } from "@/components/explorer/saved-filters-menu";
import { suggestName } from "@/lib/saved-filters";
import { exportFields, type ExportCol, type ExportInput, type MultiExportInput } from "@/lib/table-export";
import { TeamLogo } from "@/components/team-logo";
import { tourneyBadge } from "@/data/tournament-results";
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
  /** "int" is a count — whole, and unsigned, unlike "signed" margins. */
  fmt: "num1" | "signed" | "pct1" | "int";
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
  { label: "3PAR",  total: "cbb_fg3rate", pct: "cbb_fg3rate", sortKey: "cbb_fg3rate", fmt: "pct1", title: "3-point attempt rate — 3PA / FGA, how much of the offense comes from deep" },
  { label: "FT%",   total: "cbb_ft",      pct: "cbb_ft",      sortKey: "cbb_ft",      fmt: "pct1", title: "Free-throw %" },
  { label: "FTAR",  total: "cbb_ftarate", pct: "cbb_ftarate", sortKey: "cbb_ftarate", fmt: "pct1", title: "Free-throw attempt rate — FTA / FGA, how often the team gets to the line" },
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
    meta.format === "pct1" ? "pct1"
      : meta.format === "int" ? "int"
      // Everything in the diffs group is a margin, so it reads with a sign.
      : meta.group === "diffs" ? "signed"
      : "num1";
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

/**
 * Compare and Conference Rankings, parked.
 *
 * Both are built and both still work — the modals below are wired, the
 * rankings are still computed — they are simply not being offered while the
 * toolbar's other controls are being settled. Flags rather than deleted code
 * because coming back to them is the plan, and a boolean in the diff is easier
 * to find than a commit to revert.
 *
 * Flipping either to true restores the trigger and nothing else has to change.
 */
/**
 * How many teams the free sample export carries.
 *
 * Ten because it is a page of a spreadsheet — enough to see the formatting,
 * the bands and the percentile fills do their job across a real spread of
 * teams, and few enough that it is plainly a sample rather than the product.
 */
const SAMPLE_ROWS = 10;

const SHOW_COMPARE = false;
const SHOW_CONFERENCE_RANKINGS = false;

/** A renderable column, flattened for the exporter. */
function toExportCol(c: TeamCol, band: string): ExportCol {
  return {
    label: c.label,
    total: c.total as string,
    perGame: c.perGame as string | undefined,
    pct: c.pct,
    fmt: c.fmt,
    band,
  };
}

/**
 * The export columns for ANY view, not just the one on screen.
 *
 * The pinned columns lead and are de-duplicated against that view's own keys —
 * the same rule the table applies — so a stat filtered on shows up exactly
 * once on every tab, under "Your columns" where the view does not already
 * carry it and in its proper band where it does.
 */
function exportColsForView(v: TableView, pinned: readonly string[]): ExportCol[] {
  const viewKeys = new Set<string>(v.bands.flatMap((b) => b.keys as string[]));
  const out: ExportCol[] = [];
  for (const k of pinned) {
    if (viewKeys.has(k)) continue;
    const c = pinnedColumn(k);
    if (c) out.push(toExportCol(c, "Your columns"));
  }
  for (const b of v.bands) {
    for (const k of b.keys) {
      const c = pinnedColumn(k);
      if (c) out.push(toExportCol(c, b.label));
    }
  }
  return out;
}

/** One opaque hover fill so the frozen and scrolling halves read as one row. */
const ROW_HOVER = "group-hover:bg-[color-mix(in_oklab,var(--coral)_8%,var(--card))]";
/** Resting tint marking the Four Factors band, mirroring the EPM band on /players. */
const FF_BAND_TINT = "bg-[color-mix(in_oklab,var(--coral)_3%,transparent)]";

function fmtColValue(v: number | null | undefined, fmt: TeamCol["fmt"]): string {
  if (v === null || v === undefined) return "—";
  if (fmt === "int") return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
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
  // Read once, at the top, and threaded down rather than re-derived per
  // control: three different gates on this page have to agree about who this
  // reader is, and two of them deciding differently mid-render is the one bug
  // that would look like the paywall is broken rather than strict.
  const { paid, signedIn } = useEntitlement();
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
  /**
   * A VIEW BRINGS ITS OWN SORT, unless the URL names one explicitly.
   *
   * Selecting a view in the toolbar writes `sort` into the URL, so this branch
   * is not for that path — it is for a link. `?view=shot-profile` typed or
   * shared with no sort param would otherwise render shot-profile columns
   * ordered by net rating, which is a table sorted by a column it is not
   * showing. An explicit `sort` always wins, so a reader who clicks a header
   * and copies the URL keeps what they chose.
   *
   * parseSpec cannot do this itself: it is imported by the server-side query
   * builder, and the view registry has no business in that dependency chain.
   */
  const spec = useMemo(() => {
    const base = parseSpec(params);
    if (!base.view || params.sort) return base;
    const v = viewByKey(base.view);
    // A view may name a different sort for the preview season, where its usual
    // one is a stat no game has produced yet.
    const previewOnly = base.years.length > 0 && base.years.every((y) => y === PREVIEW_SEASON);
    const sortBy = previewOnly && v.previewSortBy ? v.previewSortBy : v.sortBy;
    return { ...base, sortBy, sortDir: v.sortDir };
  }, [params]);

  /**
   * ONE SEASON AT A TIME WITHOUT A PASS — see FREE_LIMITS.seasonsAtOnce.
   *
   * Enforced by narrowing what the table WORKS OVER, not by rewriting the URL.
   * The reader's selection stays exactly as they left it (and as a shared link
   * carried it), so subscribing restores the table they were looking at rather
   * than leaving them to rebuild it. The scope bar keeps showing what they
   * picked; the notice beside the count says what is actually loaded.
   *
   * Newest first because parseSpec already sorts that way, so "the one season
   * you get" is always the most recent one selected — the one most likely to
   * be the point of the comparison.
   */
  /**
   * The spec everything DOWNSTREAM OF THE DATA uses.
   *
   * Deliberately not a replacement for `spec`: the URL, the saved-filter query
   * and the export metadata all keep the reader’s real selection. Only what
   * the table computes narrows.
   *
   * THIS IS THE ONLY PLACE THE FREE LIMITS ARE ENFORCED. The capped controls
   * elsewhere are there to explain the ceiling, not to hold it — a URL can
   * carry a query no control on this page would have let anyone build.
   */
  const scopedSpec = useMemo(() => clampToFreeTier(spec, paid), [spec, paid]);
  /** Something was actually cut — measured, not predicted. */
  const seasonsLocked = scopedSpec.years.length < spec.years.length;
  const colsLocked = scopedSpec.cols.length < spec.cols.length;

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
  /**
   * Seasons that came back refused rather than empty.
   *
   * Kept separately from the rows because "no teams matched" and "these rows
   * are part of the Season Pass" look identical in a table and mean opposite
   * things — one is a filter to loosen, the other is a sign-in.
   */
  const [deniedYears, setDeniedYears] = useState<Record<number, SeasonDenial>>({});
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
    // loadSeason resolves either way — a refusal is a result, not a rejection,
    // so one gated year narrows the table and explains itself rather than
    // blanking the page.
    Promise.all(
      missing.map((y) =>
        loadSeason<RawTeamSeason[]>("teams", y).then((res) => [y, res] as const),
      ),
    ).then((pairs) => {
      setRowsByYear((prev) => {
        const next = { ...prev };
        for (const [y, res] of pairs) next[y] = res.ok ? res.data : [];
        return next;
      });
      setDeniedYears((prev) => {
        const next = { ...prev };
        for (const [y, res] of pairs) {
          if (res.ok) delete next[y];
          else next[y] = res.denial;
        }
        return next;
      });
      setLoadingYears((prev) => prev.filter((y) => !missing.includes(y)));
    });
  }, []);

  useEffect(() => { loadYears(scopedSpec.years); }, [scopedSpec.years, loadYears]);

  /** The rows the table actually works over: the selected seasons, once loaded. */
  const allTeams = useMemo(
    () => scopedSpec.years.flatMap((y) => rowsByYear[y] ?? []),
    [scopedSpec.years, rowsByYear],
  );
  const loadingSeasons = loadingYears.length > 0;

  /**
   * One line covering however many seasons were refused, and the single most
   * useful thing to do about it.
   *
   * Signed-out wins over not-subscribed when both appear: signing in is the
   * cheaper action and may resolve the other by itself.
   */
  const seasonNotice = useMemo(() => {
    const years = Object.keys(deniedYears).map(Number).filter((y) => scopedSpec.years.includes(y));
    if (years.length === 0) return null;
    const reasons = new Set(years.map((y) => deniedYears[y]!));
    const label = years.length === 1
      ? `${seasonLabel(years[0]!)} is`
      : `${years.length} seasons are`;
    if (reasons.has("signed-out")) {
      return { text: `${label} part of the Season Pass.`, cta: "Sign in", href: "/account/login" };
    }
    if (reasons.has("not-subscribed")) {
      return { text: `${label} part of the Season Pass.`, cta: "See plans", href: "/pricing" };
    }
    return { text: `${label} unavailable right now.`, cta: "Retry", href: "/" };
  }, [deniedYears, scopedSpec.years]);

  // Toolbar read-out of the COMMITTED selection (the panel's own strip tracks
  // the uncommitted draft). Removing here is immediate — there is no Submit on
  // the toolbar, and a chip whose X did nothing until you opened a panel would
  // be a lie.
  /**

  /**
   * The canonical query for what is on screen, and what a saved filter stores.
   *
   * Rebuilt from the spec rather than read off `window.location`, so it is
   * normalised: two URLs that mean the same table produce the same string, and
   * the menu can tell whether the reader is already looking at something they
   * saved by comparing them directly.
   */
  const currentQuery = useMemo(() => specToParams(spec).toString(), [spec]);
  const savedNameSuggestion = useMemo(() => suggestName(spec), [spec]);
  /**
   * Applying writes the WHOLE query in one replace.
   *
   * Not a merge onto the current spec: a saved filter that left the previous
   * conference selection in place would not be the table that was saved, and
   * the reader has no way to see which parts carried over.
   */
  const applySaved = useCallback((query: string) => {
    startTransition(() => router.replace(query ? `/?${query}` : "/", { scroll: false }));
  }, [router]);

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
  // The Team column's sticky offset is measured off the # column rather than
  // assumed — see useMeasuredWidth for why a width utility alone does not hold
  // in auto table layout.
  //
  // The # cells also carry `min-w-12`, which is what makes the 48px starting
  // value TRUE rather than merely hopeful. Without it the column settled near
  // 38.5px, so the server-rendered `left: 48px` was wrong by ~9.5px and painted
  // a gap between the two frozen columns until hydration measured and corrected
  // it — visible for as long as hydration takes. A minimum the browser cannot
  // shrink past means the first paint is already right, and the measurement
  // below becomes a safety net for cases it cannot be (very narrow viewports,
  // a four-digit rank).
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

  const { rows, allRows, count, totalPages, pageSafe } = useMemo(() => {
    const { rows: all } = processTeams(allTeams, { ...scopedSpec, limit: -1 });
    const q = tableSearch.trim().toLowerCase();
    const matched = q ? all.filter((r) => r.team_name.toLowerCase().includes(q)) : all;
    const total = matched.length;
    if (scopedSpec.limit === -1) {
      return { rows: matched, allRows: matched, count: total, totalPages: 1, pageSafe: 1 };
    }
    const totalPages = Math.max(1, Math.ceil(total / scopedSpec.limit));
    const pageSafe = Math.min(Math.max(1, page), totalPages);
    const start = (pageSafe - 1) * scopedSpec.limit;
    return {
      rows: matched.slice(start, start + scopedSpec.limit),
      // EVERY matching row, not the visible page. The download works from
      // this: a file that silently stopped at row 100 because the reader had
      // "Show 100" set would be wrong in the one way a spreadsheet cannot
      // recover from — you cannot see what is missing.
      allRows: matched,
      count: total,
      totalPages,
      pageSafe,
    };
  }, [allTeams, scopedSpec, tableSearch, page]);
  /**
   * PAGE 1, ADJUSTED DURING RENDER RATHER THAN IN AN EFFECT.
   *
   * This was `useEffect(() => setPage(1), [...])`. An effect runs AFTER the
   * browser has been handed a frame, so a reader on page 7 who narrows the
   * filters got one committed paint of "page 7 of 2" — an empty table — before
   * the reset landed. Setting state during render makes React throw that
   * render away and re-run with page 1, so the empty frame never exists.
   *
   * The comparison is against the memoised result set itself, not its inputs,
   * which is the same trigger the dependency array had.
   */
  const [pagedFor, setPagedFor] = useState<{ spec: unknown; search: string }>({ spec, search: tableSearch });
  if (pagedFor.spec !== spec || pagedFor.search !== tableSearch) {
    setPagedFor({ spec, search: tableSearch });
    setPage(1);
  }
  const multiYear = scopedSpec.years.length > 1;

  const view = useMemo(() => viewByKey(spec.view), [spec.view]);
  /**
   * What this view does for this reader — see §3 of src/lib/access.ts.
   *
   * Resolves to `free` for every subscriber, so every branch below is dead
   * code on a paid session and the fast path stays the simple one.
   */
  const gate = useMemo(() => effectiveViewAccess(view.key, paid), [view.key, paid]);
  /** Every stat the active view already puts on the table. */
  const viewKeys = useMemo(
    () => new Set<string>(view.bands.flatMap((b) => b.keys as string[])),
    [view],
  );

  /**
   * Pinned columns lead the table, then the view's own set.
   *
   * A PINNED STAT THE VIEW ALREADY SHOWS IS NOT REPEATED. It used to be, on
   * purpose: back when there was one fixed column set, a filter on eFG% put a
   * second eFG% at the left so the thing you asked for was where you were
   * looking, and pulling it out of the Shooting band would have left a hole.
   *
   * Views make that trade a bad one. There are thirteen column sets now and a
   * reader filtering on a stat has no way to know whether the current one
   * happens to include it — so the same number appeared twice, under two
   * different band headers, with no indication they were the same column.
   *
   * The VIEW keeps the column and the pin is what drops, which is also why the
   * old objection no longer applies: nothing leaves the band, so no hole opens.
   * The auto-pin guarantee survives too — you still cannot filter on a stat you
   * cannot see, because the only case dropped is the one where the view is
   * already showing it. Switch to a view without that stat and the pin comes
   * back on its own, since this recomputes from the view.
   */
  const pinnedCols = useMemo(
    () => scopedSpec.cols
      .filter((k) => !viewKeys.has(k))
      .map(pinnedColumn)
      .filter((c): c is TeamCol => c !== null),
    [scopedSpec.cols, viewKeys],
  );
  /**
   * THE VIEW SUPPLIES THE COLUMNS; the reader's pins still lead.
   *
   * Every column is built through pinnedColumn(), the same function the pinned
   * ones go through, so a stat named by a view arrives with its per-game
   * sub-figure, its percentile key and its tooltip already attached rather than
   * as a hand-rolled copy that quietly drops them.
   */
  const viewCols = useMemo(
    () => view.bands.flatMap((b) => b.keys.map(pinnedColumn).filter((c): c is TeamCol => c !== null)),
    [view],
  );
  const cols = useMemo(() => [...pinnedCols, ...viewCols], [pinnedCols, viewCols]);

  /**
   * The header bands, as {label, span} — "Your columns" first when there are
   * any, then whatever the view declares.
   *
   * These used to be three hardcoded <th> elements whose colSpans read
   * RATING_COLS.length and friends directly, which meant the table could only
   * ever show one arrangement. Derived here, a view with two bands or six
   * renders correctly and the table knows nothing about which view it is.
   */
  const bands = useMemo(() => {
    // A `bands` gate names the FREE ones, so anything unnamed is locked. Null
    // for every other kind of gate, which is what keeps `locked` false for
    // subscribers and for views that are free outright.
    const freeBands = gate.kind === "bands" ? new Set(gate.free) : null;
    const out: Array<{ label: string; accent: boolean; span: number; locked: boolean }> = [];
    // "Your columns" is never locked: they are the reader's own picks, already
    // capped at FREE_LIMITS.statCols, and blurring a column somebody
    // deliberately added reads as the table breaking rather than as a paywall.
    if (pinnedCols.length) {
      out.push({ label: "Your columns", accent: true, span: pinnedCols.length, locked: false });
    }
    for (const b of view.bands) {
      const span = b.keys.filter((k) => pinnedColumn(k) !== null).length;
      if (span > 0) {
        out.push({
          label: b.label,
          accent: !!b.accent,
          span,
          locked: !!freeBands && !freeBands.has(b.label),
        });
      }
    }
    return out;
  }, [view, pinnedCols.length, gate]);

  /**
   * Which columns are behind the wall, indexed the same way `cols` is.
   *
   * DERIVED FROM `bands` RATHER THAN FROM THE VIEW REGISTRY, which matters:
   * `bands` has already dropped any band whose keys all failed to resolve, and
   * has already put "Your columns" at the front. Walking the registry instead
   * would produce indexes that drift from the rendered table by however many
   * columns those two facts account for — and a blur that lands one column to
   * the left is worse than no blur, because it hides something we are giving
   * away and reveals something we are not.
   *
   * "Your columns" is never locked. Those are the reader's own picks, already
   * capped at FREE_LIMITS.statCols, and locking a column somebody deliberately
   * added would read as the table breaking rather than as a paywall.
   *
   * null when nothing is locked, so the render path can skip the check
   * entirely rather than testing an array of falses on every cell.
   */
  const lockedCols = useMemo(() => {
    const out: boolean[] = [];
    for (const b of bands) for (let i = 0; i < b.span; i++) out.push(b.locked);
    return out.some(Boolean) ? out : null;
  }, [bands]);

  /**
   * The locked bands, named, for the bar under the table.
   *
   * Named rather than counted — "Never in doubt and Comebacks & collapses are
   * blurred" tells a reader what they would be buying; "2 groups are blurred"
   * tells them only that they are being charged.
   */
  const lockedBandNames = useMemo(
    () => bands.filter((b) => b.locked).map((b) => b.label),
    [bands],
  );
  const lockedBandCount = lockedBandNames.length;
  const lockedBandLabels =
    lockedBandCount === 0 ? null
    : lockedBandCount === 1 ? lockedBandNames[0]!
    : `${lockedBandNames.slice(0, -1).join(", ")} and ${lockedBandNames[lockedBandCount - 1]}`;

  /**
   * A locked view shows its top few rows and stops.
   *
   * CUT FROM `allRows`, NOT FROM THE PAGE. The five are the top five of the
   * reader's whole result set — every filter, the conference picker and the
   * table search all still apply — so the tool visibly works and simply stops
   * short of being a ranking. Slicing the paginated `rows` instead would have
   * meant page 2 showing five more, which is not a paywall, it is a nuisance.
   *
   * Filters deliberately still narrow it. A free reader can therefore reach
   * any one team's shot profile by filtering down to them, and that is the
   * intended trade: the alternative — freezing the same five teams for
   * everybody — demonstrates nothing except that the feature exists.
   */
  const previewCapped = gate.kind === "preview";
  const visibleRows = useMemo(
    () => (previewCapped ? allRows.slice(0, FREE_LIMITS.previewRows) : rows),
    [previewCapped, allRows, rows],
  );
  /** Rank numbers continue across pages, and start again at 1 in a preview. */
  const rowOffset = previewCapped || spec.limit === -1 ? 0 : (pageSafe - 1) * spec.limit;

  // Group boundaries shift with the pin count, so they're derived per render
  // rather than being module constants.
  /** Column indexes where a band begins — these carry the dividing rule. */
  const groupStarts = useMemo(() => {
    const set = new Set<number>();
    let at = 0;
    for (const b of bands) { set.add(at); at += b.span; }
    return set;
  }, [bands]);
  /**
   * The tinted band. One per view, marked `accent` in the registry: it is the
   * band the view is actually about, and tinting more than one turns a signal
   * into wallpaper.
   */
  const [ffStart, ffEnd] = useMemo(() => {
    let at = 0;
    for (const b of bands) {
      // "Your columns" carries the coral header but not the band tint — those
      // columns already read as the reader's own by sitting leftmost, and
      // tinting them as well as the view's accent band gives the table two
      // competing highlights.
      if (b.accent && b.label !== "Your columns") return [at, at + b.span] as const;
      at += b.span;
    }
    return [-1, -1] as const;
  }, [bands]);

  /**
   * The table flattened for export: every column, tagged with the band it
   * sits under.
   *
   * The same function the all-views workbook uses for every other tab, so
   * the single-sheet download and the tab that shares its name can never
   * disagree about what belongs on it.
   */
  const exportCols = useMemo(() => exportColsForView(view, scopedSpec.cols), [view, scopedSpec.cols]);

  /**
   * Assembled on click, never on render.
   *
   * This walks every row in the result set — up to ~4,600 across twelve
   * seasons — and the toolbar re-renders on each keystroke in the table
   * search, so doing it eagerly would cost that walk for a button most
   * readers never press.
   */
  const buildExport = useCallback((): ExportInput => {
    const yearLabel = (y: number) => `${y - 1}-${y.toString().slice(-2)}`;
    const years = [...scopedSpec.years].sort((a, b) => a - b);
    const seasons = years.length === 0 ? "None"
      : years.length <= 3 ? years.map(yearLabel).join(", ")
      // Named as a span rather than a list once there are more than three:
      // "12 seasons (2013-14 – 2026-27)" is read at a glance, and the exact
      // set is recoverable from the Season column on every row.
      : `${years.length} seasons (${yearLabel(years[0]!)} – ${yearLabel(years[years.length - 1]!)})`;
    const OP: Record<string, string> = { gt: ">", gte: "≥", lt: "<", lte: "≤" };
    const filters = spec.filters.map((f) => {
      const meta = teamStatColumn(f.stat);
      const pct = meta?.format === "pct1";
      const shown = pct ? `${Math.round(f.value * 1000) / 10}%` : String(f.value);
      return `${meta?.label ?? f.stat} ${OP[f.op] ?? f.op} ${shown}`;
    });
    // The label the FILE uses, not the registry name: the header says ORTG,
    // so "sorted by aORTG" would be naming a column the reader cannot find.
    const sortLabel = exportCols.find((c) => c.total === spec.sortBy)?.label
      ?? teamStatColumn(spec.sortBy)?.label
      ?? spec.sortBy;
    return {
      cols: exportCols,
      rows: allRows,
      entity: TEAM_ENTITY,
      meta: {
        viewLabel: view.label,
        seasons,
        conference: spec.conf.length ? spec.conf.join(", ") : "All conferences",
        teams: spec.teams.length ? spec.teams.join(", ") : "All teams",
        filters,
        sort: `${sortLabel} — ${spec.sortDir === "desc" ? "high to low" : "low to high"}`,
        search: tableSearch.trim(),
        url: typeof window === "undefined" ? "" : window.location.href,
      },
    };
  }, [exportCols, allRows, view.label, spec, scopedSpec.years, tableSearch]);

  /**
   * The same rows, dressed once per chosen view.
   *
   * Built on click like the single-sheet input, and for a stronger reason:
   * this walks the result set once per tab, so doing it on render would cost
   * up to thirteen passes over 4,600 rows on every keystroke in the table
   * search.
   *
   * Tabs come out in REGISTRY order, not tick order. The picker groups views
   * the way the View dropdown does, and a workbook whose tabs were ordered by
   * which checkbox happened to be clicked first would not match it.
   */
  const buildExportAll = useCallback((viewKeys: string[]): MultiExportInput => {
    const single = buildExport();
    const wanted = new Set(viewKeys);
    const chosen = TABLE_VIEWS.filter((v) => wanted.has(v.key));
    return {
      sheets: chosen.map((v) => ({ name: v.label, cols: exportColsForView(v, scopedSpec.cols) })),
      rows: single.rows,
      entity: TEAM_ENTITY,
      meta: single.meta,
      slug: chosen.length === TABLE_VIEWS.length ? "all-views"
        : chosen.length === 1 ? chosen[0]!.label
        : `${chosen.length}-views`,
    };
  }, [buildExport, scopedSpec.cols]);

  // Hoisted above buildSample, which needs it. Memoized rather than a bare
  // `?? []`: a fresh array literal every render would make every consumer
  // recompute on each keystroke in the table search.
  const latestRows = useMemo(() => rowsByYear[latestYear] ?? [], [rowsByYear, latestYear]);

  /**
   * The free sample: every view, the current season, the ten best teams.
   *
   * A REAL FILE, NOT A SCREENSHOT OF ONE. Somebody deciding whether an export
   * is worth paying for is deciding about column headers, number formats,
   * percentile fills and whether it opens cleanly in their spreadsheet — none
   * of which a marketing page can answer and all of which ten real rows do.
   * It is the same code path the paid export uses, so it cannot flatter it.
   *
   * FIXED SCOPE ON PURPOSE, ignoring whatever the reader has on screen. Ten
   * teams by NET from the current season is a constant: it gives away nothing
   * that is not already the first page of the free table, and it cannot be
   * turned into a data tap by filtering to the rows somebody actually wanted
   * and pressing the button repeatedly.
   *
   * Built from `latestRows`, which is the server-rendered season and therefore
   * always in hand — the sample must never depend on a fetch that a signed-out
   * reader may not be allowed to make.
   */
  const buildSample = useCallback((): MultiExportInput => {
    const sampleSpec = {
      ...parseSpec({}),
      years: [latestYear],
      sortBy: "a_net" as TeamStatKey,
      sortDir: "desc" as const,
      limit: -1,
    };
    const { rows: ranked } = processTeams(latestRows, sampleSpec);
    return {
      sheets: TABLE_VIEWS.filter((v) => !v.custom)
        .map((v) => ({ name: v.label, cols: exportColsForView(v, []) })),
      rows: ranked.slice(0, SAMPLE_ROWS),
      entity: TEAM_ENTITY,
      meta: {
        viewLabel: "Sample",
        seasons: seasonLabel(latestYear),
        conference: "All conferences",
        teams: `Top ${SAMPLE_ROWS} by NET`,
        filters: [`Sample export — the full table is part of the Season Pass`],
        sort: "NET — high to low",
        search: "",
        url: typeof window === "undefined" ? "" : window.location.origin + "/pricing",
      },
      slug: "sample",
    };
  }, [latestRows, latestYear]);

  // The number of columns THE FILE will have, not the number on screen: a
  // stat contributes its value, its percentile and sometimes a per-game
  // figure, so sixteen table columns land as forty spreadsheet ones.
  const exportFieldCount = useMemo(() => exportFields(exportCols, TEAM_ENTITY).length, [exportCols]);

  // Live "N teams" for the filter drawer's footer: run the current scope
  // against a candidate filter set without touching the URL. limit:-1 so the
  // count is the real total rather than the visible page.
  const previewCount = useCallback(
    (filters: StatFilter[]) =>
      processTeams(allTeams, { ...scopedSpec, filters, limit: -1 }).rows.length,
    [allTeams, scopedSpec],
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
      <div id="teams-table" className="bg-card border border-ink/10 border-x-0 lg:border-x rounded-none lg:rounded-xl shadow-md overflow-hidden ring-0 lg:ring-1 ring-ink/5 mt-6 max-md:mt-2 scroll-mt-6 -mx-6 lg:mx-0">
        {/* Compact toolbar, matching /players: search + compare on the left,
            sort/order/show on the right, one row, table starts immediately
            below. Replaces a "headline ledger" (accent rule, display-font
            <h2>Teams</h2>, big count) that made this page read as a different
            product from the players table it sits beside in the nav. The page
            heading lives in the page shell now, not inside the data card. */}
        <div className={cn(
          // `relative` anchors the mobile sliding search panel, which used to
          // hang off the right-hand group. That group is no longer full width
          // on phones — the row-count select and the search button now share a
          // line with Compare — and the panel parks at
          // translate-x-[105%], so 105% of a ~90px group left the "closed"
          // panel sitting inside the toolbar. Anchored here it is 105% of the
          // whole row, which clears the card edge as intended.
          "relative px-3 lg:px-4 py-2.5 border-b border-hairline bg-paper-deep/30 flex items-center justify-between gap-3 flex-wrap",
        )}>
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

            {/* SELECT VIEW.
                Lives in the table toolbar, not on the scope bar above, and
                applies the moment it changes rather than on Submit. Both follow
                from the same fact: a view does not narrow the result set, it
                re-dresses it. The scope bar's controls are submit-gated because
                each one is an incomplete thought until the others are set;
                a view is complete the instant it is chosen, and putting an
                instant control inside a submit-gated row is how a reader learns
                not to trust the Submit button.

                A native select with optgroups rather than the custom popover:
                twelve options in five sections is exactly what the element is
                for, it matches the Seasons / Team / Conference controls a row
                up, and it costs no JavaScript to open. */}
            <label className="inline-flex items-center gap-1.5 min-w-0">
              <span className="hidden sm:inline text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium whitespace-nowrap">
                View
              </span>
              <Select
                value={spec.view || TABLE_VIEWS[0]!.key}
                onChange={(v) => {
                  const next: TeamFilterSpec = {
                    ...spec,
                    view: v === TABLE_VIEWS[0]!.key ? "" : v,
                    // The view carries its own sort. Without this the table
                    // stays ordered by a column the new view may not show, and
                    // a reader who picks "Shot Profile" gets shot-profile
                    // columns ranked by net rating.
                    sortBy: viewByKey(v).sortBy,
                    sortDir: viewByKey(v).sortDir,
                  };
                  const p = specToParams(next).toString();
                  startTransition(() => router.replace(p ? `/?${p}` : "/", { scroll: false }));
                }}
                ariaLabel="Table view"
                compact
                className="max-w-44"
              >
                {/* MARKED ONLY WHERE THE MARK IS TRUE.
                    This said "· Pass" on every gated view, which was ten of
                    fourteen — a list that reads as a locked product, and wrong
                    on three of them. Record & Outcomes hands over the record;
                    Roster Continuity hands over who came back and how many
                    minutes; Build My Own Table hands over three columns. A
                    reader who sees "Pass" beside those and does not click has
                    been talked out of something they could have had.

                    So the mark is limited to the views where a free reader
                    genuinely gets a taste rather than a section — the
                    row-capped ones. That is seven, and each one is honest.

                    A native <option> renders text and nothing else, hence a
                    word rather than a padlock. Shown only to readers it
                    applies to: a subscriber has no use for a column of labels
                    naming what they already bought. */}
                {viewGroups().map((g) => (
                  <optgroup key={g.group} label={g.group}>
                    {g.views.map((v) => {
                      const locked = !paid && viewAccess(v.key).kind === "preview";
                      return (
                        <option
                          key={v.key}
                          value={v.key}
                          title={locked ? `${v.desc} — part of the Season Pass` : v.desc}
                        >
                          {locked ? `${v.label} · Pass` : v.label}
                        </option>
                      );
                    })}
                  </optgroup>
                ))}
              </Select>
            </label>

            {/* Between the view select and Compare: it belongs with View —
                both put the table into a named arrangement — and the pair
                reads as "ours, then yours". */}
            <SavedFiltersMenu
              currentQuery={currentQuery}
              suggestedName={savedNameSuggestion}
              onApply={applySaved}
            />

            {SHOW_COMPARE && (
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
            )}

            {/* Beside Compare, and deliberately quieter than it: both act on
                the table rather than narrowing it, but Compare is the thing
                this page wants you to try and a download is the thing you
                reach for once you already know what you want. */}
            <DownloadMenu
              build={buildExport}
              buildAll={buildExportAll}
              buildSample={buildSample}
              rowCount={allRows.length}
              colCount={exportFieldCount}
              // A season still in flight means the table is short. Better to
              // refuse for a moment than to hand over a file missing a year.
              disabled={loadingSeasons}
            />

            {/* Desktop only. On phones the count renders as its own row after
                the controls — see the mobile copy at the end of this toolbar.
                It is two elements rather than one because the two layouts want
                it in different places: inline beside the rankings link here,
                and on its own line there. Trying to do both with flex-basis
                made this group full-width, which pushed the select and the
                search button onto a third row. */}
            <span className="hidden sm:inline text-xs text-ink-muted whitespace-nowrap tabular">
              <span className="text-ink font-medium">{visibleRows.length.toLocaleString()}</span>
              {count > visibleRows.length && <> of {count.toLocaleString()}</>} teams
              {/* A season the reader just added is a fetch away, not on the
                  page. Say so rather than briefly showing a short table as if
                  that were the answer. */}
              {loadingSeasons && <span className="ml-1.5 text-coral">· loading season…</span>}
            </span>

            {/* The empty view, before any column is picked. Without this the
                table reads as broken rather than as a blank canvas — the rows
                are there, the stats simply have not been chosen yet. */}
            {view.custom && cols.length === 0 && (
              <span className="text-xs text-ink-muted whitespace-nowrap">
                Pick your columns with
                {" "}
                <span className="text-coral font-medium">Add a Filter</span>
                {" "}below
                {/* The ceiling, said before it is reached. Finding out you
                    have hit a limit is a worse moment than being told the
                    limit while you still have room inside it. */}
                {!paid && <> — {FREE_LIMITS.statCols} on the free plan</>}
              </span>
            )}

            {/* A gated season, said out loud. Without this the table is simply
                short, and a subscriber whose token expired sees the same thing
                as a reader who filtered too hard. */}
            {seasonNotice && (
              <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap">
                <Lock size={11} className="text-coral shrink-0" />
                <span className="text-ink-soft">{seasonNotice.text}</span>
                <Link
                  href={seasonNotice.href}
                  className="text-coral hover:underline font-medium"
                >
                  {seasonNotice.cta}
                </Link>
              </span>
            )}

            {colsLocked && (
              <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap">
                <Lock size={11} className="text-coral shrink-0" />
                <span className="text-ink-soft">
                  Showing {FREE_LIMITS.statCols} of your {spec.cols.length} columns.
                </span>
                <Link href="/pricing" className="text-coral hover:underline font-medium">
                  See plans
                </Link>
              </span>
            )}

            {/* Several seasons asked for, one delivered. Beside the count
                rather than under the table, because it explains the number
                immediately to its left. */}
            {seasonsLocked && (
              <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap">
                <Lock size={11} className="text-coral shrink-0" />
                <span className="text-ink-soft">
                  {seasonLabel(scopedSpec.years[0]!)} only — comparing seasons is part of the Pass.
                </span>
                <Link href="/pricing" className="text-coral hover:underline font-medium">
                  See plans
                </Link>
              </span>
            )}

            {/* Desktop home for the rankings link: immediately after the count.
                Both are statements about the same set of teams — "100 of 365,
                and here they are ranked by conference" — so the link reads as a
                continuation of the count rather than as one more control in the
                right-hand cluster, where it sat next to Show and the row-count
                select and looked like a third setting.

                Below sm it keeps its old slot in the right-hand group; see the
                note there for why. */}
            {SHOW_CONFERENCE_RANKINGS && conferenceRankings.length > 0 && (
              <button
                type="button"
                onClick={() => setShowRankings(true)}
                className="hidden sm:inline-flex items-center text-xs text-coral hover:underline whitespace-nowrap"
              >
                View Conference Rankings →
              </button>
            )}
          </div>

          {/* w-full on mobile, matching /players. The sliding mobile search
              panel below is `w-full` of THIS box and parks itself at
              translate-x-105%; when the box was only as wide as its buttons,
              105% of that landed the "closed" panel back inside the card, so a
              second magnifier and a stray "Done" sat visible in the toolbar.
              Full-width pushes it past the card edge, where the card's
              overflow-hidden clips it. */}
          <div className="flex items-center gap-2 lg:gap-3 w-auto justify-end min-w-0">
            {/* No sort-by / order selects. Sorting happens by clicking a column
                header, which is how /players works — two controls doing a job
                the table header already does was part of what made these pages
                feel unrelated. Only the row-count select remains, same position
                and shape as the one on /players. */}
            {/* Mobile search icon. FIRST in the group: on a phone the two
                controls read left-to-right as "find one / show many", and the
                row-count select is the one that wants to sit closest to the
                count it governs on the line below. On desktop this is hidden
                and the group is just Show + Select, unchanged. */}
            <button
              type="button"
              onClick={() => {
                setSearchOpen(true);
                // Inside the gesture: iOS raises the keyboard only for a
                // focus() made while the tap is still being handled. The effect
                // below runs after commit, which focused the field but left the
                // keyboard down — hence having to tap the field again.
                searchInputRef.current?.focus({ preventScroll: true });
              }}
              aria-label="Search teams"
              className="lg:hidden shrink-0 h-8 w-8 inline-flex items-center justify-center rounded-md border border-ink/15 bg-card text-ink-muted hover:text-ink hover:border-ink/25 shadow-sm transition-colors"
            >
              <SearchGlass className="w-4 h-4" />
            </button>

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

          </div>
          {/* Mobile sliding search — slides over the row from the right on tap.
              text-sm by request. NOTE: iOS zooms the page when a focused
              input is under 16px, so focusing this now nudges the viewport;
              text-base was the only thing preventing that. Put it back if the
              zoom is worse than the type size. */}
          <div
            ref={searchPanelRef}
            className={cn(
              // Pinned by insets rather than w-full. As a child of the row, `w-full`
                // resolved against a box wider than the visible row and ran the
                // input and its Done button ~80px past the right edge; left-0
                // right-0 makes the panel exactly the row it slides over.
                "lg:hidden absolute inset-y-0 left-0 right-0 flex items-center gap-2 bg-card px-3 transform-gpu transition-transform duration-200 ease-out",
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
                className="h-8 w-full pl-8 pr-3 rounded-md border border-ink/15 bg-card text-ink text-sm placeholder:text-ink-muted shadow-sm focus:outline-none focus:ring-2 focus:ring-coral/40 focus:border-coral/40"
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
          {/* PHONE ONLY: the count, on its own line under the controls. */}
          <span className="sm:hidden basis-full text-xs text-ink-muted whitespace-nowrap tabular">
            <span className="text-ink font-medium">{visibleRows.length.toLocaleString()}</span>
            {count > visibleRows.length && <> of {count.toLocaleString()}</>} teams
            {loadingSeasons && <span className="ml-1.5 text-coral">· loading season…</span>}
          </span>
        </div>

        {/* The filter builder, on its own row directly under the search row.
            It was a drawer that portalled into an empty div here; it is inline
            now, so this is the component itself rather than a slot for it. */}
        <TeamStatFilters previewCount={previewCount} />
        {/* Vertical bound is what makes the `sticky top-0 / top-6` header rows
            below actually stick. Without a height the wrapper never scrolls
            vertically — and since `overflow-x: auto` forces `overflow-y` to
            `auto` as well, it still counts as this table's scroll container, so
            the headers had nothing to stick to and simply scrolled off with the
            page. Sizing it to the viewport gives them a scrollport. */}
        <div
          ref={gridScrollRef}
          
          // WINDOWED AT EVERY WIDTH, so a real sticky <th> has a scrollport
          // to pin against on phones exactly as on desktop. This reverses the
          // md-only cap that used to sit here, under which phones got a cloned
          // header bar drawn outside the table by a component in
          // components/table/sticky-header-clone.tsx, deleted with this change.
          // Git history has it if it is ever wanted back.
          //
          // 80svh, MEASURED FROM dunksandthrees.com/epm, which solves this the
          // same way: one `overflow: auto` box at `h-[80vh]`, sticky `top-0`
          // band cells over sticky column cells, `left-0` on the frozen column,
          // and an opaque custom property behind every sticky cell. Their box
          // is 675px of an 844px phone.
          //
          // THE 20% IS THE POINT, not a rounding choice. A viewport-tall window
          // fills the screen, so every touch lands inside the table and the
          // page has no exposed surface left to scroll from. At 80svh there is
          // always page above or below the box, which is what keeps the table
          // a component on a page rather than a second scrolling application.
          //
          // svh rather than their vh: vh resolves to the LARGEST viewport, so
          // on iOS the box is sized as though the URL bar were hidden and
          // overhangs the screen while it is showing. svh is the smallest, so
          // the window always fits and never resizes mid-scroll.
          //
          // WHY THE HEADER STAYS PUT. A sticky cell pins to its scrollport's
          // top edge and shows only while that edge is on screen — which sounds
          // fragile, since the box starts below the fold. It holds because a
          // gesture landing on a scrollable box scrolls THAT box: a finger on
          // the table moves the table, the box's own top never moves, and the
          // header stays pinned. The page scrolls from the margins instead.
          //
          // overscroll-behavior is `none` below md. Left to chain, hitting the
          // last row hands the gesture on to the page, which slides the box's
          // top off screen and takes the header with it. `contain` stops the
          // chaining but keeps iOS's local rubber-band — the "I can drag the
          // entire table" complaint from 2026-08-22. Only `none` stops both.
          // The old warning against `none` here was written for an UNCAPPED
          // box, which had no vertical scroll to absorb the gesture; this one
          // does.
          //
          // DO NOT ADD `touch-action: pan-x` HERE. It looks like the tidy way
          // to say "horizontal is mine, vertical is the page's", but
          // touch-action RESTRICTS rather than delegates: the effective value
          // is the intersection down the ancestor chain, so pan-x on this box
          // removes pan-y for the whole gesture and the page cannot scroll
          // from any finger that lands on the table. Shipped exactly that on
          // 2026-08-22 and had to pull it.
          className="overflow-auto overscroll-x-contain max-md:overscroll-none cursor-grab max-h-[80svh] md:max-h-[calc(100vh-1.5rem)]"
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
                <th className="sticky top-0 left-0 z-40 w-12 min-w-12 bg-paper-deep h-6 p-0" />
                <th style={teamLeft} className="sticky top-0 z-40 bg-paper-deep h-6 p-0 border-r border-hairline" />
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
                {bands.map((b) => (
                  <th
                    key={b.label}
                    colSpan={b.span}
                    title={b.locked ? `${b.label} is part of the Season Pass` : undefined}
                    className={cn(
                      "sticky top-0 z-30 bg-paper-deep h-6 p-0 px-2 text-[0.58rem] uppercase tracking-[0.15em]",
                      "font-semibold text-center border-l border-hairline align-middle",
                      b.locked ? "text-coral/80" : b.accent ? "text-coral" : "text-ink-muted",
                    )}
                  >
                    {/* The caption stays perfectly legible while the numbers
                        under it do not. That is the whole pitch: a reader has
                        to be able to see WHAT they are not being shown, or the
                        band is just a smudge with no reason to pay for it. */}
                    <span className="inline-flex items-center gap-1">
                      {b.label}
                      {b.locked && <Lock size={8} strokeWidth={3} aria-hidden />}
                    </span>
                  </th>
                ))}
                {/* TRAILING SPACER — see the header row below for why. */}
                <th className="sticky top-0 z-30 bg-paper-deep h-6 p-0 w-full" />
              </tr>
              <tr>
                <th ref={rankThRef} className="sticky top-6 left-0 z-40 w-12 min-w-12 bg-paper-deep border-b border-hairline px-1 sm:px-2 py-3 sm:py-2 text-xs uppercase tracking-widest text-ink-muted font-medium text-center align-middle">#</th>
                <th style={teamLeft} className="sticky top-6 z-40 bg-paper-deep border-b border-r border-hairline px-2 sm:px-3 py-3 sm:py-2 text-xs uppercase tracking-wide sm:tracking-widest text-ink-muted font-medium text-left align-middle">Team</th>
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
                    // The EFFECTIVE sort, not the hardcoded site default.
                    // SortableTh decides which header is "active" from the URL's
                    // sort param falling back to this, and a view supplies its
                    // own sort when the URL names none — so with a_net hardcoded
                    // here, Roster Continuity sorted its rows by continuity while
                    // marking NET as the active column.
                    defaultSort={spec.sortBy}
                    idleArrows
                    // A preview locks the WHOLE table — re-sorting five rows
                    // out of 365 would hand over the ranking the preview
                    // exists to withhold, one column at a time.
                    locked={previewCapped || lockedCols?.[i] === true}
                    // A WIDTH PREFERENCE, NOT A WIDTH. 8% of the table is
                    // more than any stat column needs, so each one takes what
                    // spare width there is instead of leaving it all to the
                    // slack column - which is what put a 270px blank strip
                    // down the right of a full view on a wide screen. It is a
                    // preference in both directions: content minimums still
                    // win when the table is too narrow to fit (nothing changes
                    // below ~1400px, where it already scrolls), and with only
                    // two or three columns picked, 8% each cannot swallow the
                    // card, so the slack column still shows the empty space as
                    // room for more columns.
                    className={cn(
                      "sticky top-6 z-30 w-[8%] bg-paper-deep border-b border-hairline",
                      groupStarts.has(i) && "border-l border-hairline",
                    )}
                  />
                ))}
                {/* THE COLUMN THAT ABSORBS WHAT IS LEFT.
                    The table is `w-full` with auto layout, so the browser
                    shares any spare width among the real columns — which is
                    invisible on a full view and absurd on "Build my own
                    table", where four identity columns stretched across the
                    whole card. This takes the slack instead, so Team, Conf and
                    Record sit at the same width in every view and the empty
                    space reads as room for columns still to be added.
                    Collapses to zero when the columns already fill the table,
                    so it costs the other views nothing. */}
                {/* THE COLUMN THAT ABSORBS WHAT IS LEFT, and dressed like a
                    column while it does it: the header band, the rule and the
                    zebra all run through it. It was blank and opaque for a
                    while, so the table ended where its last column ended and
                    the rest of the card was empty paper. Restored by request -
                    the striping reads as one table that happens to have room
                    left, where the blank version read as the card ending early
                    and the table floating in it.

                    Now that the stat columns take an 8% share of the spare
                    width, this is usually zero wide on a full view; it only
                    shows up where a handful of columns genuinely cannot fill
                    the card. */}
                <th aria-hidden className="sticky top-6 z-30 bg-paper-deep border-b border-hairline w-full p-0" />
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={(multiYear ? 5 : 4) + cols.length + 1} className="px-4 py-12 text-center text-ink-muted">
                    No teams match these filters.
                  </td>
                </tr>
              ) : (
                visibleRows.map((r, i) => {
                  // Opaque zebra so the frozen columns can share it and still
                  // hide the scrolled content behind them.
                  const zebra = i % 2 === 0 ? "bg-paper" : "bg-card";
                  // On phones the rank cell carries the tournament honour: the
                  // chip cost ~23px of a ~71px team column, and this gutter is
                  // already mostly padding around one or two digits. Hardwood
                  // rather than a new hue — it is the colour the chip has always
                  // used, so nothing is introduced, and it cannot be mistaken
                  // for a percentile, which is only ever green/amber/red.
                  // max-sm: so the desktop chip and the zebra stripe are
                  // untouched above the breakpoint.
                  const honour = tourneyBadge(r.team_name, r.team_year);
                  // OPAQUE tint, keyed to which zebra stripe this row is on.
                  // bg-court/55 and /20 were translucent, and this cell is
                  // sticky — so on a champion or Final Four row the ratings
                  // columns scrolled visibly through the rank gutter while
                  // every other row stayed clean. See the .honour-* classes in
                  // globals.css; they mix the hardwood against the same zebra
                  // base the rest of the frozen group uses.
                  const honourCell =
                    honour === "champion"
                      ? cn("text-court-ink font-bold",
                           i % 2 === 0 ? "honour-champ-paper" : "honour-champ-card")
                      : honour === "final-four"
                      ? cn("text-court-ink font-bold",
                           i % 2 === 0 ? "honour-f4-paper" : "honour-f4-card")
                      : "";
                  const honourTitle =
                    honour === "champion" ? `${seasonLabel(r.team_year)} national champion`
                    : honour === "final-four" ? `${seasonLabel(r.team_year)} Final Four`
                    : undefined;
                  return (
                  <tr key={`${r.team_id}-${r.team_year}`} className={cn("group", zebra)}>
                    <td
                      title={honourTitle}
                      className={cn("sticky left-0 z-20 w-12 min-w-12 px-1 sm:px-2 py-1 text-center text-ink-muted tabular text-xs font-semibold transition-colors cursor-default", zebra, ROW_HOVER, honourCell)}
                    >
                      {rowOffset + i + 1}
                    </td>
                    {/* Trailing edge of the frozen group. #/Team pin and everything
                        right of them scrolls underneath, so without a seam the
                        record slid out from behind the team cell and read as
                        touching the F4 badge. The line says "this column is
                        pinned, that content is passing behind it" — same
                        hairline the stat bands already use. */}
                    <td style={teamLeft} className={cn("sticky z-20 px-2 sm:px-3 py-1 border-r border-hairline transition-colors", zebra, ROW_HOVER)}>
                      <Link
                        href={`/teams/${teamSlug(r.team_name)}/${r.team_year}`}
                        className="inline-flex items-center gap-2.5 group"
                        aria-label={r.team_name} prefetch={false}>
<TeamLogo name={r.team_name} size={24} />
                        <span className="hidden sm:inline font-medium text-ink group-hover:text-coral transition-colors">
                          {r.team_name}
                        </span>
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
                      const locked = lockedCols?.[ci] === true;
                      return (
                        <td
                          key={`${c.sortKey}-${ci}`}
                          title={locked ? "Part of the Season Pass" : undefined}
                          className={cn(
                            "px-1 sm:px-2 py-1 text-right tabular whitespace-nowrap transition-colors",
                            isFF && FF_BAND_TINT,
                            groupStarts.has(ci) && "border-l border-hairline",
                            locked && "select-none",
                            ROW_HOVER,
                          )}
                        >
                          {locked && <span className="sr-only">Locked — part of the Season Pass</span>}
                          <span
                            // Blurred rather than replaced with a dash or a
                            // padlock: the shape of the column survives, so a
                            // reader can see there are real numbers here and
                            // roughly how they vary, which is a far better
                            // argument than an empty cell. aria-hidden because
                            // the sr-only line above already says what this is
                            // — a screen reader should not read out values a
                            // sighted reader cannot see.
                            aria-hidden={locked || undefined}
                            className={cn(
                              "inline-flex flex-col items-end gap-0.5 leading-tight",
                              // GRAYSCALE AS WELL AS BLUR. The percentile chip
                              // is a solid colour block, and colour survives a
                              // blur perfectly — a green smudge still says
                              // "90th percentile", which is most of what the
                              // column was worth. Draining it leaves the shape
                              // of the data and none of the signal.
                              locked && "blur-[3.5px] opacity-60 grayscale",
                            )}
                          >
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
                    {/* Transparent, so the row's own stripe and hover tint
                        carry across it. See the header. */}
                    <td aria-hidden className={cn("p-0 transition-colors", zebra, ROW_HOVER)} />
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {previewCapped ? (
          <GateBar
            signedIn={signedIn}
            lead={`Showing the top ${Math.min(FREE_LIMITS.previewRows, count).toLocaleString()} of ${count.toLocaleString()}.`}
            tail={`${view.label} is part of the Season Pass. Your filters and search still narrow these rows — the full table and column sorting are what a Pass unlocks.`}
          />
        ) : lockedBandLabels ? (
          <GateBar
            signedIn={signedIn}
            lead={`${lockedBandLabels} ${lockedBandCount === 1 ? "is" : "are"} blurred.`}
            tail={`Everything to the left is free. A Season Pass reveals the rest of ${view.label}, and every other view.`}
          />
        ) : null}
        {!previewCapped && spec.limit !== -1 && totalPages > 1 && (
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
      {/* Not rendered while the trigger is hidden — nothing can open it, and
          mounting a modal nobody can reach costs its whole subtree on every
          page load. */}
      {SHOW_COMPARE && (
        <CompareTeamsModal
          open={compareOpen}
          onClose={() => setCompareOpen(false)}
          teamsIndex={teamsIndex}
          rowsByYear={rowsByYear}
          loadYears={loadYears}
          coachByTeamYear={coachByTeamYear}
          tourneyFinishByTeamYear={tourneyFinishByTeamYear}
        />
      )}

      {SHOW_CONFERENCE_RANKINGS && showRankings && (
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
