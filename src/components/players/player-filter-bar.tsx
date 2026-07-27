"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  RangeRow, isBoundActive, roundNice,
  type RangeStat, type RangeState,
} from "@/components/filters/range-row";
import { confDisplay } from "@/lib/conf-display";
import { POWER_CONFS } from "@/lib/conf-tiers";
import { ScopeCollapse, scopeSummary } from "@/components/filters/scope-collapse";
import { MultiYearSelect } from "@/components/explorer/multi-year-select";
import { SearchableMultiSelect } from "@/components/explorer/searchable-multi-select";
import { type SearchableOption } from "@/components/explorer/searchable-select";
import {
  DEFAULT_PLAYER_SPEC,
  parsePlayerSpec,
  playerSpecToParams,
  playerStatColumn,
  type PlayerListSpec,
  type PlayerStatFilter,
} from "@/lib/players";

const CLASS_OPTIONS: SearchableOption[] = [
  { value: "Fr", label: "Freshman" },
  { value: "So", label: "Sophomore" },
  { value: "Jr", label: "Junior" },
  { value: "Sr", label: "Senior" },
  { value: "Gr", label: "Graduate" },
];

const POSITION_OPTIONS: SearchableOption[] = [
  { value: "G", label: "G (Guard)" },
  { value: "F", label: "F (Forward)" },
  { value: "C", label: "C (Center)" },
];

const CONF_GROUP_LABELS = { power: "Power Conferences", midmajor: "Mid-Majors" } as const;

type Draft = {
  years: number[];
  conf: string[];
  teams: string[];
  cls: string[];
  pos: ("G" | "F" | "C")[];
  filters: PlayerStatFilter[];
};

function sameDraft(a: Draft, b: Draft): boolean {
  if (a.years.length !== b.years.length || a.years.some((y, i) => y !== b.years[i])) return false;
  if (a.conf.length !== b.conf.length  || a.conf.some((c, i) => c !== b.conf[i])) return false;
  if (a.teams.length !== b.teams.length || a.teams.some((t, i) => t !== b.teams[i])) return false;
  if (a.cls.length !== b.cls.length   || a.cls.some((c, i) => c !== b.cls[i])) return false;
  if (a.pos.length !== b.pos.length   || a.pos.some((c, i) => c !== b.pos[i])) return false;
  if (a.filters.length !== b.filters.length) return false;
  for (let i = 0; i < a.filters.length; i++) {
    const fa = a.filters[i]!, fb = b.filters[i]!;
    if (fa.stat !== fb.stat || fa.op !== fb.op || fa.value !== fb.value) return false;
  }
  return true;
}

export function PlayerFilterBar({
  conferences,
  teams,
}: {
  conferences: string[];
  teams: string[];
}) {
  const router = useRouter();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();

  const params = useMemo(() => {
    const obj: Record<string, string> = {};
    for (const [k, v] of search.entries()) obj[k] = v;
    return obj;
  }, [search]);
  const urlSpec: PlayerListSpec = parsePlayerSpec(params);

  // Working draft — edits happen here without re-running the leaderboard.
  // Only Submit pushes to the URL (mirrors /teams explorer pattern).
  const [draft, setDraft] = useState<Draft>({
    years: urlSpec.years,
    conf: urlSpec.conf,
    teams: urlSpec.teams,
    cls: urlSpec.cls,
    pos: urlSpec.pos,
    filters: urlSpec.filters,
  });

  // Re-sync draft when the URL changes from outside (browser nav, etc.).
  useEffect(() => {
    setDraft({
      years: urlSpec.years,
      conf: urlSpec.conf,
      teams: urlSpec.teams,
      cls: urlSpec.cls,
      pos: urlSpec.pos,
      filters: urlSpec.filters,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function patch(next: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...next }));
  }

  function submit() {
    // Preserve sort/limit/minGames from the URL; only overwrite the
    // draft-controlled fields.
    const next: PlayerListSpec = {
      ...urlSpec,
      years: draft.years,
      conf: draft.conf,
      teams: draft.teams,
      cls: draft.cls,
      pos: draft.pos,
      filters: draft.filters,
    };
    const p = playerSpecToParams(next).toString();
    startTransition(() =>
      router.replace(p ? `/players?${p}` : "/players", { scroll: false }),
    );
    // On mobile, jump to the leaderboard so the filtered rows are visible
    // without scrolling past the filter card.
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      requestAnimationFrame(() => {
        document.getElementById("players-leaderboard")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }
  function reset() {
    setDraft({
      years: DEFAULT_PLAYER_SPEC.years,
      conf: [],
      teams: [],
      cls: [],
      pos: [],
      filters: [],
    });
    startTransition(() => router.replace("/players", { scroll: false }));
  }

  const dirty = !sameDraft(draft, {
    years: urlSpec.years,
    conf: urlSpec.conf,
    teams: urlSpec.teams,
    cls: urlSpec.cls,
    pos: urlSpec.pos,
    filters: urlSpec.filters,
  });

  const teamOptions = useMemo<SearchableOption[]>(
    () => teams.map((t) => ({ value: t, label: t })),
    [teams],
  );
  const confOptions = useMemo<SearchableOption[]>(() => {
    const opts = conferences.map((c) => ({
      value: c,
      label: confDisplay(c),
      group: POWER_CONFS.has(c) ? "power" : "midmajor",
    }));
    return opts.sort((a, b) => {
      if (a.group !== b.group) return a.group === "power" ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
  }, [conferences]);

  // Collapsed-state read of the current scope, same shape as the teams bar.
  const summary = scopeSummary([
    { label: "seasons", values: draft.years.map(seasonLabel) },
    { label: "teams", values: draft.teams },
    { label: "conferences", values: draft.conf.map(confDisplay) },
    { label: "classes", values: draft.cls },
    { label: "positions", values: draft.pos },
  ]);

  return (
    // Slim quick-filter bar — no card container. Quick scope selects on the
    // left, Reset/Submit on the right. Collapsed behind a toggle below `md`
    // (see ScopeCollapse). (The Filters range drawer now lives inside the table
    // toolbar via <PlayerStatFilters/>.)
    <ScopeCollapse summary={summary} pending={pending}>
      {/* Quick scope selects — each labeled so a "3 selected" pill reads clearly */}
      <QuickField label="Seasons">
        <MultiYearSelect years={draft.years} onChange={(years) => patch({ years })} className="w-32" />
      </QuickField>
      <QuickField label="Team">
        <SearchableMultiSelect
          value={draft.teams} options={teamOptions} onChange={(t) => patch({ teams: t })}
          placeholder="Type to filter…" emptyLabel="All" ariaLabel="Teams" className="w-52"
        />
      </QuickField>
      <QuickField label="Conference">
        <SearchableMultiSelect
          value={draft.conf} options={confOptions} onChange={(c) => patch({ conf: c })}
          placeholder="Type to filter…" emptyLabel="All" ariaLabel="Conferences" groupLabels={CONF_GROUP_LABELS} className="w-44"
        />
      </QuickField>
      <QuickField label="Class">
        <SearchableMultiSelect
          value={draft.cls} options={CLASS_OPTIONS} onChange={(c) => patch({ cls: c })}
          placeholder="Type to filter…" emptyLabel="All" ariaLabel="Classes" className="w-36"
        />
      </QuickField>
      <QuickField label="Position">
        <SearchableMultiSelect
          value={draft.pos} options={POSITION_OPTIONS} onChange={(p) => patch({ pos: p as ("G" | "F" | "C")[] })}
          placeholder="Type to filter…" emptyLabel="All" ariaLabel="Positions" className="w-36"
        />
      </QuickField>

      {/* Submit / Reset — right after Position */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={!dirty}
          className="h-9 text-sm font-medium bg-coral text-white px-5 rounded-md hover:bg-coral-soft disabled:opacity-40 transition-colors"
        >
          Submit
        </button>
        <button type="button" onClick={reset} className="h-9 px-3 text-sm text-ink-muted hover:text-ink">Reset</button>
      </div>
    </ScopeCollapse>
  );
}

// "25-26". Matches the teams filter bar's local copy so the two collapsed
// scope summaries read identically.
function seasonLabel(y: number): string {
  return `${(y - 1).toString().slice(-2)}-${y.toString().slice(-2)}`;
}

function QuickField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium pl-0.5">{label}</span>
      {children}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Stat range drawer
// ---------------------------------------------------------------------------
// Each stat gets a slider bounded by realistic min/max (display units). A range
// with a moved low thumb emits a `gte` filter; a moved high thumb emits `lte`.
// Both thumbs at the extremes = no filter (the stat is "off"). `pct` stats are
// stored as fractions in the URL but shown/edited as whole percent here.
type RangeGroup = { label: string; stats: RangeStat[] };

const RANGE_GROUPS: RangeGroup[] = [
  {
    label: "Estimated +/-",
    stats: [
      { key: "epm",     label: "Estimated Plus-Minus",  min: -12, max: 12, step: 0.1 },
      { key: "off_epm", label: "Offensive EPM",         min: -12, max: 12, step: 0.1 },
      { key: "def_epm", label: "Defensive EPM",         min: -8,  max: 8,  step: 0.1 },
      { key: "ewins",   label: "eWins",                 min: -1,  max: 12, step: 0.1 },
      { key: "on_off",  label: "On / Off (net)",        min: -40, max: 40, step: 0.5 },
    ],
  },
  {
    label: "Role",
    stats: [
      { key: "mpg",     label: "Minutes per game",      min: 0, max: 40, step: 1 },
      { key: "usg_pct", label: "Usage",                 min: 0, max: 60, step: 1, pct: true },
      { key: "gp",      label: "Games played",          min: 0, max: 40, step: 1 },
    ],
  },
  {
    label: "Scoring",
    stats: [
      { key: "ppg",    label: "Points per game",        min: 0, max: 40, step: 0.5 },
      { key: "apg",    label: "Assists per game",       min: 0, max: 14, step: 0.5 },
      { key: "tov_pg", label: "Turnovers per game",     min: 0, max: 7,  step: 0.1 },
      { key: "tov_pct", label: "Turnover rate",          min: 0, max: 40, step: 0.5, pct: true },
      { key: "pir",    label: "PIR",                    min: 0, max: 40, step: 0.5 },
    ],
  },
  {
    label: "Shooting",
    stats: [
      { key: "ts_pct",  label: "True shooting",         min: 0, max: 100, step: 1, pct: true },
      { key: "fg_pct",  label: "Field goal",            min: 0, max: 100, step: 1, pct: true },
      { key: "fg3_pct", label: "3-point",               min: 0, max: 100, step: 1, pct: true },
      { key: "ft_pct",  label: "Free throw",            min: 0, max: 100, step: 1, pct: true },
    ],
  },
  {
    // Shooting profile (CBBD) — values already 0–100, so NOT pct (no /100).
    label: "Shot profile",
    stats: [
      { key: "rim_pct",  label: "Rim FG %",              min: 0, max: 100, step: 1 },
      { key: "mid_pct",  label: "Mid FG %",              min: 0, max: 100, step: 1 },
      { key: "asst_pct", label: "Assisted %",            min: 0, max: 100, step: 1 },
      { key: "rim_rate", label: "Rim shot rate %",       min: 0, max: 100, step: 1 },
      { key: "tp_rate",  label: "3PT shot rate %",       min: 0, max: 100, step: 1 },
    ],
  },
  {
    label: "Rebounding",
    stats: [
      { key: "rpg",  label: "Rebounds per game",        min: 0, max: 20, step: 0.5 },
      { key: "orpg", label: "Off reb per game",         min: 0, max: 7,  step: 0.1 },
      { key: "drpg", label: "Def reb per game",         min: 0, max: 13, step: 0.1 },
    ],
  },
  {
    label: "Defense",
    stats: [
      { key: "spg", label: "Steals per game",           min: 0, max: 4,  step: 0.1 },
      { key: "bpg", label: "Blocks per game",           min: 0, max: 5,  step: 0.1 },
      { key: "hkm", label: "Hakeem % (BLK + STL)",      min: 0, max: 15, step: 0.5 },
    ],
  },
  {
    label: "Playmaking",
    stats: [
      { key: "net_rtg", label: "Net rating",            min: -60, max: 60, step: 1 },
      { key: "ast_tov", label: "Assist : turnover",     min: 0,   max: 8,  step: 0.1 },
    ],
  },
];

const ALL_RANGE_STATS: RangeStat[] = RANGE_GROUPS.flatMap((g) => g.stats);
const RANGE_BY_KEY = new Map(ALL_RANGE_STATS.map((s) => [s.key, s]));

/**
 * Can this stat become a table column?
 *
 * The shot-profile stats (rim%, assisted%, shot rates) are `filterOnly` — they
 * exist in the filter drawer but have no grid representation, so offering a
 * tick-box on them would promise a column that never appears. They stay
 * filterable; they just don't get the affordance.
 */
function pinnable(key: string): boolean {
  const c = playerStatColumn(key);
  return !!c && !c.filterOnly;
}

// URL filters → per-stat {lo, hi} in display units.
function filtersToRanges(filters: PlayerStatFilter[]): RangeState {
  const out: RangeState = {};
  for (const f of filters) {
    const st = RANGE_BY_KEY.get(f.stat);
    if (!st) continue;
    const slot = (out[f.stat] ??= { lo: null, hi: null });
    const disp = st.pct ? roundNice(f.value * 100) : f.value;
    if (f.op === "gte" || f.op === "gt") slot.lo = disp;
    else slot.hi = disp;
  }
  return out;
}
// Per-stat {lo, hi} → URL filters (gte/lte), skipping untouched extremes.
function rangesToFilters(state: RangeState): PlayerStatFilter[] {
  const out: PlayerStatFilter[] = [];
  for (const st of ALL_RANGE_STATS) {
    const b = state[st.key];
    if (!b) continue;
    if (b.lo !== null) out.push({ stat: st.key, op: "gte", value: st.pct ? roundNice(b.lo / 100) : b.lo });
    if (b.hi !== null) out.push({ stat: st.key, op: "lte", value: st.pct ? roundNice(b.hi / 100) : b.hi });
  }
  return out;
}
function sameFilterSet(a: PlayerStatFilter[], b: PlayerStatFilter[]): boolean {
  if (a.length !== b.length) return false;
  const key = (f: PlayerStatFilter) => `${f.stat}.${f.op}.${f.value}`;
  const sa = new Set(a.map(key));
  return b.every((f) => sa.has(key(f)));
}

/**
 * Filters trigger + full range-filter drawer. Lives INSIDE the table toolbar
 * (next to the search box). Self-contained: reads its own draft of stat ranges
 * from the URL and, on Submit, pushes { ...urlSpec, filters } — preserving the
 * quick-scope params (seasons/team/conf/class/position) that PlayerFilterBar
 * owns.
 *
 * `previewCount` (optional) runs the live pipeline against the working draft so
 * the footer shows a running "N players" total before Submit.
 */
export function PlayerStatFilters({
  block = false,
  previewCount,
}: {
  block?: boolean;
  previewCount?: (filters: PlayerStatFilter[]) => number;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const params = useMemo(() => {
    const obj: Record<string, string> = {};
    for (const [k, v] of search.entries()) obj[k] = v;
    return obj;
  }, [search]);
  const urlSpec: PlayerListSpec = parsePlayerSpec(params);

  const [draft, setDraft] = useState<RangeState>(() => filtersToRanges(urlSpec.filters));
  // Pinned columns, ordered so the table renders them in pick order.
  const [pins, setPins] = useState<string[]>(() => urlSpec.cols);
  useEffect(() => {
    setDraft(filtersToRanges(urlSpec.filters));
    setPins(urlSpec.cols);
    /* eslint-disable-next-line */
  }, [search]);

  // Lock body scroll + wire Escape while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; document.removeEventListener("keydown", onKey); };
  }, [open]);

  // Stable so memoized RangeRows don't re-render on every drag tick — only the
  // row whose lo/hi actually changed reconciles.
  const setBound = useCallback(
    (key: string, lo: number | null, hi: number | null) => {
      setDraft((d) => ({ ...d, [key]: { lo, hi } }));
      // Narrowing a stat auto-pins it as a column, same rule as the team
      // explorer. The table used to infer its extra columns from the filter
      // list alone; now that inference is explicit state the reader can undo.
      if (lo !== null || hi !== null) {
        setPins((pp) => (pp.includes(key) ? pp : [...pp, key]));
      }
    },
    [],
  );
  const togglePin = useCallback(
    (key: string) => setPins((pp) => (pp.includes(key) ? pp.filter((k) => k !== key) : [...pp, key])),
    [],
  );
  const clearAll = () => { setDraft({}); setPins([]); };

  const draftFilters = useMemo(() => rangesToFilters(draft), [draft]);
  const samePins = pins.length === urlSpec.cols.length && pins.every((k, i) => k === urlSpec.cols[i]);
  // Submit enables on EITHER change — ticking a column with no bounds set is a
  // legitimate submit.
  const dirty = !sameFilterSet(draftFilters, urlSpec.filters) || !samePins;
  // The match total is computed inline on every change, so it tracks the
  // thumb rather than trailing it. That is only affordable because
  // processTeams/applySpec now reuse a cached, fully-shaped cohort instead of
  // rebuilding every row from raw per call: measured at 5.4ms a tick over the
  // widest selection (all 13 seasons, 6,689 team-seasons) against a 16.7ms
  // frame. Before the cache this same work cost ~22ms and had to be debounced
  // out of the drag path entirely.
  const previewFilters = draftFilters;
  const matches = useMemo(
    () => (previewCount ? previewCount(previewFilters) : null),
    [previewCount, previewFilters],
  );

  // Badge counts (distinct active stats, not raw filter count).
  const activeDraft = ALL_RANGE_STATS.reduce((n, s) => n + (isBoundActive(draft[s.key]) ? 1 : 0), 0);
  const committed = useMemo(() => filtersToRanges(urlSpec.filters), [urlSpec.filters]);
  const activeCommitted = ALL_RANGE_STATS.reduce((n, s) => n + (isBoundActive(committed[s.key]) ? 1 : 0), 0);

  const submit = () => {
    const p = playerSpecToParams({ ...urlSpec, filters: draftFilters, cols: pins }).toString();
    startTransition(() => router.replace(p ? `/players?${p}` : "/players", { scroll: false }));
    setOpen(false);
  };

  return (
    <div className={cn("relative", block && "w-full")}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-1.5 h-8 px-3 rounded-md border text-sm font-medium shadow-sm transition-colors",
          block ? "w-full justify-center" : "",
          activeCommitted > 0 ? "border-coral/50 bg-coral/6 text-coral" : "border-ink/15 bg-card text-ink hover:border-ink/25",
        )}
      >
        <SlidersHorizontal size={15} />
        Filters
        {activeCommitted > 0 && (
          <span className="ml-0.5 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-coral text-white text-[0.6rem] font-bold tabular">{activeCommitted}</span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-60 flex items-start sm:items-center justify-center p-4 sm:p-6">
          {/* Backdrop */}
          <div
            className="bta-backdrop-in absolute inset-0 bg-ink/40 backdrop-blur-[1px]"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          {/* Centered modal */}
          <div
            className="bta-modal-in relative z-10 w-full max-w-176 lg:max-w-256 max-h-[85vh] bg-paper rounded-2xl shadow-2xl ring-1 ring-ink/10 flex flex-col overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Stat filters"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 px-5 sm:px-6 pt-5 pb-4 border-b border-hairline">
              <div className="min-w-0">
                {/* min-h reserves the badge's height so the header doesn't grow
                    (and the centered modal doesn't recenter/jump) on first filter */}
                <div className="flex items-center gap-2 min-h-6">
                  <h3 className="text-base font-semibold text-ink leading-none">View &amp; Filters</h3>
                  {activeDraft > 0 && (
                    <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-coral text-white text-[0.62rem] font-bold tabular">{activeDraft}</span>
                  )}
                  {activeDraft > 0 && (
                    <button type="button" onClick={clearAll} className="text-xs text-ink-muted hover:text-coral transition-colors">Clear all</button>
                  )}
                </div>
                <p className="mt-1.5 text-xs text-ink-muted leading-snug">
                  Tick a stat name to add it as a column, and/or drag a slider to narrow the field. Then Submit.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close filters"
                className="shrink-0 w-8 h-8 -mr-1 inline-flex items-center justify-center rounded-md text-ink-muted hover:text-ink hover:bg-paper-deep transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Scrollable body — two columns of stat ranges */}
            <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 space-y-6">
              {RANGE_GROUPS.map((g) => {
                const gc = g.stats.reduce((n, s) => n + (isBoundActive(draft[s.key]) ? 1 : 0), 0);
                return (
                  // CSS containment. Without it, changing one slider re-styles and
                  // re-lays-out the whole modal — 112 form controls across seven groups —
                  // on every tick of a drag. Measured alternating, warm: p90 25ms with ~4
                  // dropped frames a drag, against 16.8ms and ~1.5 once each group is
                  // contained. Safe here because a group holds only static rows; nothing
                  // inside is sticky or absolutely positioned against an outer ancestor.
                  <section key={g.label} className="[contain:layout_style]">
                    <div className="flex items-center gap-2 mb-3 min-h-5">
                      <h4 className="text-[0.62rem] uppercase tracking-[0.18em] font-semibold text-ink-soft">{g.label}</h4>
                      {gc > 0 && (
                        <span className="inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-coral/15 text-coral text-[0.58rem] font-bold tabular">{gc}</span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
                      {g.stats.map((st) => (
                        <RangeRow
                          key={st.key}
                          st={st}
                          lo={draft[st.key]?.lo ?? null}
                          hi={draft[st.key]?.hi ?? null}
                          setBound={setBound}
                          pinned={pins.includes(st.key)}
                          onTogglePin={pinnable(st.key) ? togglePin : undefined}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>

            {/* Footer */}
            <div className="px-5 sm:px-6 py-4 border-t border-hairline bg-paper-deep/30 flex items-center gap-3">
              {matches !== null && (
                <div className="text-sm text-ink-soft leading-none">
                  <span className="text-lg font-bold text-ink tabular">{matches.toLocaleString()}</span>
                  <span className="ml-1.5 text-xs text-ink-muted">{matches === 1 ? "player" : "players"}</span>
                </div>
              )}
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="h-9 px-3 text-sm text-ink-muted hover:text-ink transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={!dirty}
                  className="h-9 text-sm font-semibold bg-coral text-white px-6 rounded-md hover:bg-coral-soft disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Submit
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
