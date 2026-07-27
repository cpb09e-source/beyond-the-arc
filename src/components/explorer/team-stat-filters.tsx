"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  RangeRow, isBoundActive, roundNice, useDebouncedValue,
  type RangeStat, type RangeState,
} from "@/components/filters/range-row";
import {
  parseSpec, specToParams,
  type StatFilter, type TeamFilterSpec, type TeamStatKey,
} from "@/lib/team-filters";

/**
 * Stat-range drawer for the team explorer — the counterpart to
 * PlayerStatFilters, deliberately built to the same shape so the two pages read
 * as one product: a Filters trigger with an active count, a centred modal of
 * grouped dual-thumb sliders, a live match count, Cancel/Submit.
 *
 * It replaces a popover of "Where <stat> <operator> <value>" rows. Those could
 * express more (any comparator, the same stat twice) but asked the reader to
 * know the stat vocabulary before they could ask a question, and nothing about
 * them matched /players.
 *
 * Self-contained by design: it reads its own draft from the URL and on Submit
 * pushes `{ ...urlSpec, filters }`, preserving the scope params (seasons /
 * team / conference) that FilterBar owns and the sort/limit the table owns.
 * That's what lets the trigger live in the table toolbar while the scope
 * selects stay on the bar above.
 *
 * SLIDER BOUNDS ARE MEASURED, NOT GUESSED. Every min/max below was derived from
 * the 1st/99th percentile of that stat across all 6,689 team-seasons in
 * teams-all.json, then rounded outward to a round number. A slider whose range
 * is invented either wastes most of its travel on values no team ever posts, or
 * silently clips real ones.
 */

type RangeGroup = { label: string; stats: RangeStat[] };

const RANGE_GROUPS: RangeGroup[] = [
  {
    label: "Ratings (adjusted)",
    stats: [
      { key: "a_net",    label: "aNET",  min: -30, max: 30,  step: 0.5 },
      { key: "a_ortg",   label: "aORTG", min: 85,  max: 130, step: 0.5 },
      { key: "a_drtg",   label: "aDRTG", min: 85,  max: 125, step: 0.5 },
      { key: "adj_sos",  label: "SOS",   min: -15, max: 15,  step: 0.5 },
      { key: "cbb_pace", label: "Pace",  min: 55,  max: 85,  step: 0.5 },
    ],
  },
  {
    label: "Four Factors",
    stats: [
      { key: "reb_diff_ct",  label: "REB Diff", min: -400, max: 400, step: 5 },
      { key: "fg3m_diff_ct", label: "3PM Diff", min: -150, max: 150, step: 5 },
      { key: "fbpts_diff",   label: "FBP Diff", min: -300, max: 300, step: 5 },
      { key: "tov_diff_ct",  label: "TOV Diff", min: -200, max: 200, step: 5 },
    ],
  },
  {
    label: "Shooting",
    stats: [
      { key: "cbb_efg",     label: "eFG",      min: 35, max: 65, step: 0.5, pct: true },
      { key: "cbb_fg3",     label: "3P",       min: 25, max: 45, step: 0.5, pct: true },
      { key: "cbb_fg3rate", label: "3PA Rate", min: 15, max: 60, step: 0.5, pct: true },
      { key: "cbb_ft",      label: "FT",       min: 55, max: 85, step: 0.5, pct: true },
      { key: "cbb_ftarate", label: "FTA Rate", min: 15, max: 60, step: 0.5, pct: true },
      { key: "cbb_ts",      label: "True shooting", min: 40, max: 65, step: 0.5, pct: true },
    ],
  },
  {
    label: "Defense",
    stats: [
      { key: "cbb_efg_def", label: "Opp eFG",  min: 35, max: 65, step: 0.5, pct: true },
      { key: "cbb_fg3_def", label: "Opp 3P",   min: 25, max: 45, step: 0.5, pct: true },
      { key: "cbb_tov_def", label: "Opp TOV",  min: 8,  max: 32, step: 0.5, pct: true },
      { key: "cbb_orb_def", label: "Opp OREB", min: 15, max: 45, step: 0.5, pct: true },
    ],
  },
  {
    label: "Ball control",
    stats: [
      { key: "cbb_orb", label: "OREB", min: 12, max: 48, step: 0.5, pct: true },
      { key: "cbb_tov", label: "TOV",  min: 8,  max: 30, step: 0.5, pct: true },
      { key: "cbb_ast", label: "AST",  min: 30, max: 75, step: 0.5, pct: true },
    ],
  },
  {
    label: "Record",
    stats: [
      { key: "wins",   label: "Wins",   min: 0,   max: 40, step: 1 },
      { key: "losses", label: "Losses", min: 0,   max: 40, step: 1 },
      { key: "wab",    label: "Wins above bubble", min: -25, max: 15, step: 0.5 },
    ],
  },
  {
    label: "Other margins",
    stats: [
      { key: "pts_diff",  label: "Points Diff",      min: -600, max: 600, step: 10 },
      { key: "pitp_diff", label: "Paint Pts Diff",   min: -500, max: 500, step: 5 },
      { key: "scp_diff",  label: "2nd-Chance Diff",  min: -250, max: 250, step: 5 },
    ],
  },
];

const ALL_RANGE_STATS: RangeStat[] = RANGE_GROUPS.flatMap((g) => g.stats);
const RANGE_BY_KEY = new Map(ALL_RANGE_STATS.map((s) => [s.key, s]));

// URL filters → per-stat {lo, hi} in display units.
function filtersToRanges(filters: StatFilter[]): RangeState {
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
// Per-stat {lo, hi} → URL filters, skipping untouched extremes.
function rangesToFilters(state: RangeState): StatFilter[] {
  const out: StatFilter[] = [];
  for (const st of ALL_RANGE_STATS) {
    const b = state[st.key];
    if (!b) continue;
    if (b.lo !== null) out.push({ stat: st.key as TeamStatKey, op: "gte", value: st.pct ? roundNice(b.lo / 100) : b.lo });
    if (b.hi !== null) out.push({ stat: st.key as TeamStatKey, op: "lte", value: st.pct ? roundNice(b.hi / 100) : b.hi });
  }
  return out;
}
function sameFilterSet(a: StatFilter[], b: StatFilter[]): boolean {
  if (a.length !== b.length) return false;
  const key = (f: StatFilter) => `${f.stat}.${f.op}.${f.value}`;
  const sa = new Set(a.map(key));
  return b.every((f) => sa.has(key(f)));
}

export function TeamStatFilters({
  previewCount,
}: {
  /** Runs the live pipeline against the working draft for the footer total. */
  previewCount?: (filters: StatFilter[]) => number;
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
  const urlSpec: TeamFilterSpec = useMemo(() => parseSpec(params), [params]);

  const [draft, setDraft] = useState<RangeState>(() => filtersToRanges(urlSpec.filters));
  useEffect(() => { setDraft(filtersToRanges(urlSpec.filters)); /* eslint-disable-next-line */ }, [search]);

  // Lock body scroll + wire Escape while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; document.removeEventListener("keydown", onKey); };
  }, [open]);

  // Stable so memoized RangeRows don't re-render on every drag tick.
  const setBound = useCallback(
    (key: string, lo: number | null, hi: number | null) =>
      setDraft((d) => ({ ...d, [key]: { lo, hi } })),
    [],
  );
  const clearAll = () => setDraft({});

  const draftFilters = useMemo(() => rangesToFilters(draft), [draft]);
  const dirty = !sameFilterSet(draftFilters, urlSpec.filters);
  // Debounced, not deferred — see useDebouncedValue. Deferring left the
  // pipeline running inside the drag frame and cost ~22ms a tick.
  const previewFilters = useDebouncedValue(draftFilters);
  const matches = useMemo(
    () => (previewCount ? previewCount(previewFilters) : null),
    [previewCount, previewFilters],
  );

  const activeDraft = ALL_RANGE_STATS.reduce((n, s) => n + (isBoundActive(draft[s.key]) ? 1 : 0), 0);
  const committed = useMemo(() => filtersToRanges(urlSpec.filters), [urlSpec.filters]);
  const activeCommitted = ALL_RANGE_STATS.reduce((n, s) => n + (isBoundActive(committed[s.key]) ? 1 : 0), 0);

  const submit = () => {
    const p = specToParams({ ...urlSpec, filters: draftFilters }).toString();
    startTransition(() => router.replace(p ? `/?${p}` : "/", { scroll: false }));
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-1.5 h-8 px-3 rounded-md border text-sm font-medium shadow-sm transition-colors whitespace-nowrap",
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
          <div
            className="bta-backdrop-in absolute inset-0 bg-ink/40 backdrop-blur-[1px]"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            className="bta-modal-in relative z-10 w-full max-w-176 lg:max-w-256 max-h-[85vh] bg-paper rounded-2xl shadow-2xl ring-1 ring-ink/10 flex flex-col overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Stat filters"
          >
            <div className="flex items-start justify-between gap-3 px-5 sm:px-6 pt-5 pb-4 border-b border-hairline">
              <div className="min-w-0">
                {/* min-h reserves the badge's height so the header doesn't grow
                    (and the centred modal doesn't jump) on the first filter. */}
                <div className="flex items-center gap-2 min-h-6">
                  <h3 className="text-base font-semibold text-ink leading-none">View &amp; Filters</h3>
                  {activeDraft > 0 && (
                    <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-coral text-white text-[0.62rem] font-bold tabular">{activeDraft}</span>
                  )}
                  {activeDraft > 0 && (
                    <button type="button" onClick={clearAll} className="text-xs text-ink-muted hover:text-coral transition-colors">Clear all</button>
                  )}
                </div>
                <p className="mt-1.5 text-xs text-ink-muted leading-snug">Drag a slider or type a min / max, then Submit.</p>
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

            <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 space-y-6">
              {RANGE_GROUPS.map((g) => {
                const gc = g.stats.reduce((n, s) => n + (isBoundActive(draft[s.key]) ? 1 : 0), 0);
                return (
                  <section key={g.label}>
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
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>

            <div className="px-5 sm:px-6 py-4 border-t border-hairline bg-paper-deep/30 flex items-center gap-3">
              {matches !== null && (
                <div className="text-sm text-ink-soft leading-none">
                  <span className="text-lg font-bold text-ink tabular">{matches.toLocaleString()}</span>
                  <span className="ml-1.5 text-xs text-ink-muted">{matches === 1 ? "team" : "teams"}</span>
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
