"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  RangeRow, isBoundActive, roundNice,
  type RangeStat, type RangeState,
} from "@/components/filters/range-row";
import { StatChipStrip, buildStatChips, type StatChip } from "@/components/filters/stat-chips";
import {
  parseSpec, specToParams, teamStatColumn,
  type StatFilter, type TeamFilterSpec, type TeamStatKey,
} from "@/lib/team-filters";

/**
 * Stat-range drawer for the team explorer — the counterpart to
 * PlayerStatFilters, deliberately built to the same shape so the two pages read
 * as one product: a Filters trigger with an active count, an inline drawer of
 * grouped dual-thumb sliders, a find-a-stat box, a live match count,
 * Cancel/Submit.
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

const RANGE_GROUPS_RAW: RangeGroup[] = [
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

/**
 * "Wins above bubble" → "Wins Above Bubble", without wrecking the acronyms.
 *
 * A word is only capitalised when it is ENTIRELY lowercase. Anything already
 * carrying a capital is left exactly as written, which is what protects aNET,
 * aORTG, eFG, 3PA, FTA, REB and the rest. Same rule as the players drawer.
 */
function titleCase(label: string): string {
  return label
    .split(" ")
    .map((w) => (w && w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// Title-cased once here rather than in RangeRow, which /players also renders.
const RANGE_GROUPS: RangeGroup[] = RANGE_GROUPS_RAW.map((g) => ({
  ...g,
  stats: g.stats.map((s) => ({ ...s, label: titleCase(s.label) })),
}));

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

// ---------------------------------------------------------------------------
// Selection chips
// ---------------------------------------------------------------------------
// The same strip /players carries, built the same way: in the toolbar off the
// committed URL, in the panel header off the working draft.
//
// Labels come from TEAM_STAT_COLUMNS rather than the slider's own, so a chip
// matches the column header it put in the table — "WAB", not "Wins above
// bubble"; "TS%", not "True shooting".
const CHIP_ORDER = ALL_RANGE_STATS.map((s) => s.key);
const chipLabel = (key: string) =>
  teamStatColumn(key)?.label ?? RANGE_BY_KEY.get(key)?.label ?? key;

export function teamStatChips(cols: readonly string[], ranges: RangeState): StatChip[] {
  return buildStatChips(cols, ranges, CHIP_ORDER, chipLabel);
}

/** Same chips, built from a committed spec rather than a live range draft. */
export function teamStatChipsFromSpec(cols: readonly string[], filters: StatFilter[]): StatChip[] {
  return teamStatChips(cols, filtersToRanges(filters));
}

/**
 * Where the page puts the drawer, and what the trigger points `aria-controls`
 * at. The page renders an empty div with this id directly beneath the toolbar
 * row; the panel portals into it so it expands the card in normal flow.
 */
export const TEAM_DRAWER_SLOT_ID = "team-filters-slot";
const DRAWER_PANEL_ID = "team-filters-panel";
const SEARCH_LIST_ID = "team-filters-find";

/** Magnifier, matching the one on the table's own search box. */
function SearchGlass({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <circle cx={11} cy={11} r={7} /><line x1={20} y1={20} x2={16.65} y2={16.65} />
    </svg>
  );
}

export function TeamStatFilters({
  previewCount,
  open: openProp,
  onOpenChange,
}: {
  /** Runs the live pipeline against the working draft for the footer total. */
  previewCount?: (filters: StatFilter[]) => number;
  /** Optional control, so the toolbar's "+N more" chip can open the panel. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const [, startTransition] = useTransition();
  const [openLocal, setOpenLocal] = useState(false);
  const open = openProp ?? openLocal;
  const setOpen = useCallback(
    (v: boolean) => { if (onOpenChange) onOpenChange(v); else setOpenLocal(v); },
    [onOpenChange],
  );

  const params = useMemo(() => {
    const obj: Record<string, string> = {};
    for (const [k, v] of search.entries()) obj[k] = v;
    return obj;
  }, [search]);
  const urlSpec: TeamFilterSpec = useMemo(() => parseSpec(params), [params]);

  const [draft, setDraft] = useState<RangeState>(() => filtersToRanges(urlSpec.filters));
  // Pinned columns, kept as an ordered list so the table renders them in the
  // order they were picked rather than in RANGE_GROUPS order.
  const [pins, setPins] = useState<string[]>(() => urlSpec.cols);
  useEffect(() => {
    setDraft(filtersToRanges(urlSpec.filters));
    setPins(urlSpec.cols);
    /* eslint-disable-next-line */
  }, [search]);

  // Escape still closes. Body scroll is NOT locked any more — this is an inline
  // drawer, not a modal, so the page behind it is not "behind" anything and
  // freezing it would strand a reader who opened the drawer halfway down the
  // table.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  // The drawer renders into a slot the page puts directly under the toolbar, so
  // it expands the card and pushes the table down instead of floating over it.
  // A portal rather than rendering in place because the trigger sits inside a
  // nested flex group in the toolbar — a full-width panel there would be
  // trapped in that group's width.
  //
  // The lookup happens at RENDER time behind a mounted flag rather than being
  // captured into state by an effect: this component re-mounts on navigation,
  // and an effect that misses the slot — or holds a node from a previous mount
  // — leaves nothing to portal into, with no error to show for it.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // Flipping a mounted flag once is the standard way to defer a DOM read past
    // hydration; there is nothing here to cascade into.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);
  const slot = mounted && typeof document !== "undefined"
    ? document.getElementById(TEAM_DRAWER_SLOT_ID)
    : null;

  // Stable so memoized RangeRows don't re-render on every drag tick.
  const setBound = useCallback(
    (key: string, lo: number | null, hi: number | null) => {
      setDraft((d) => ({ ...d, [key]: { lo, hi } }));
      // Narrowing a stat auto-pins it as a column. Filtering on something you
      // then can't see in the table is the worst version of this drawer —
      // you'd have a list of teams and no way to check why they qualified.
      // Untick still works; the tick just stops being a separate chore.
      if (lo !== null || hi !== null) {
        setPins((p) => (p.includes(key) ? p : [...p, key]));
      }
    },
    [],
  );
  const togglePin = useCallback(
    (key: string) => setPins((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key])),
    [],
  );
  const clearAll = () => { setDraft({}); setPins([]); };
  // Chip X — drop the stat wholesale: unpin the column AND release its bounds.
  // Splitting those into two gestures would mean two clicks to undo one pick,
  // since narrowing a slider auto-pins.
  const removeStat = useCallback((key: string) => {
    setPins((p) => p.filter((k) => k !== key));
    setDraft((d) => {
      if (!(key in d)) return d;
      const next = { ...d };
      delete next[key];
      return next;
    });
  }, []);

  // Uncapped here — the panel is where the full picture belongs.
  const chips = useMemo(() => teamStatChips(pins, draft), [pins, draft]);

  // ---- Jump-to-field search -------------------------------------------------
  //
  // Seven groups of sliders is a lot to hunt through when you already know you
  // want Opp OREB. Type, pick, and the field is added as a column; the box
  // empties itself so the next one is just more typing. Every team range stat
  // maps to a real column (unlike /players, where the shot-profile stats are
  // filter-only), so there is nothing to exclude here.
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const fieldMatches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [] as RangeStat[];
    return ALL_RANGE_STATS
      .filter((s) => s.label.toLowerCase().includes(needle))
      // Label-start matches first: typing "opp" should offer "Opp eFG" before
      // whatever the group order happens to be.
      .sort((a, b) => {
        const ai = a.label.toLowerCase().indexOf(needle);
        const bi = b.label.toLowerCase().indexOf(needle);
        return ai - bi || a.label.localeCompare(b.label);
      })
      .slice(0, 8);
  }, [q]);
  // Clamp during render — a shrinking list must never leave the highlight
  // pointing past the end, which would make Enter do nothing.
  const hiSafe = fieldMatches.length ? Math.min(hi, fieldMatches.length - 1) : 0;

  const pickField = (st: RangeStat) => {
    setPins((p) => (p.includes(st.key) ? p : [...p, st.key]));
    setQ("");
    setHi(0);
  };

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!fieldMatches.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, fieldMatches.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); pickField(fieldMatches[hiSafe]!); }
    else if (e.key === "Escape") {
      // Clear the search first; only a second Escape closes the drawer, so
      // abandoning a search doesn't throw away the whole panel.
      e.preventDefault();
      e.stopPropagation();
      setQ("");
    }
  };

  const draftFilters = useMemo(() => rangesToFilters(draft), [draft]);
  const samePins =
    pins.length === urlSpec.cols.length && pins.every((k, i) => k === urlSpec.cols[i]);
  // Submit enables on EITHER change — pinning a column with no bounds set is a
  // legitimate submit, and gating on filters alone left the button dead.
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

  const activeDraft = ALL_RANGE_STATS.reduce((n, s) => n + (isBoundActive(draft[s.key]) ? 1 : 0), 0);
  const committed = useMemo(() => filtersToRanges(urlSpec.filters), [urlSpec.filters]);
  const activeCommitted = ALL_RANGE_STATS.reduce((n, s) => n + (isBoundActive(committed[s.key]) ? 1 : 0), 0);

  const submit = () => {
    const p = specToParams({ ...urlSpec, filters: draftFilters, cols: pins as TeamStatKey[] }).toString();
    startTransition(() => router.replace(p ? `/?${p}` : "/", { scroll: false }));
    setOpen(false);
  };

  const panel = (
    <div className={cn("bta-drawer border-b border-hairline bg-paper-deep/20", open && "is-open")}>
      <div>
        <div id={DRAWER_PANEL_ID} role="region" aria-label="Stat filters">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 px-4 lg:px-5 pt-4 pb-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center flex-wrap gap-2 min-h-6">
                <h3 className="text-base font-semibold text-ink leading-none">View &amp; Filters</h3>
                {activeDraft > 0 && (
                  <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-coral text-white text-[0.62rem] font-bold tabular">{activeDraft}</span>
                )}
                {chips.length > 0 && (
                  <button type="button" onClick={clearAll} className="text-xs text-ink-muted hover:text-coral transition-colors">Clear all</button>
                )}
                {/* Everything picked, right where you picked it — a stat added
                    by tick or by the find box lands here immediately. */}
                <StatChipStrip chips={chips} onRemove={removeStat} ariaLabel="Selected columns and filters" />
              </div>
              <p className="mt-1.5 text-xs text-ink-muted leading-snug">
                Tick a stat name to add it as a column, and/or drag a slider to narrow the field. Then Submit.
              </p>

              {/* Jump to a field by name. */}
              <div className="relative mt-3 max-w-80">
                <SearchGlass className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-muted pointer-events-none" />
                <input
                  type="text"
                  value={q}
                  onChange={(e) => { setQ(e.target.value); setHi(0); }}
                  onKeyDown={onSearchKey}
                  placeholder="Find a stat…"
                  aria-label="Find a stat and add it as a column"
                  aria-expanded={fieldMatches.length > 0}
                  aria-controls={SEARCH_LIST_ID}
                  aria-autocomplete="list"
                  aria-activedescendant={fieldMatches[hiSafe] ? `${SEARCH_LIST_ID}-${fieldMatches[hiSafe]!.key}` : undefined}
                  role="combobox"
                  className="h-8 w-full pl-8 pr-7 rounded-md border border-ink/15 bg-card text-ink text-sm placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-coral/40 focus:border-coral/40 transition-colors"
                />
                {q && (
                  <button
                    type="button"
                    onClick={() => { setQ(""); setHi(0); }}
                    aria-label="Clear stat search"
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 inline-flex items-center justify-center rounded text-ink-muted hover:text-coral hover:bg-paper-deep"
                  >
                    ×
                  </button>
                )}
                {fieldMatches.length > 0 && (
                  <ul
                    id={SEARCH_LIST_ID}
                    role="listbox"
                    className="absolute left-0 right-0 top-9 z-20 rounded-md border border-hairline bg-popover shadow-lg overflow-hidden py-1"
                  >
                    {fieldMatches.map((st, i) => {
                      const already = pins.includes(st.key);
                      return (
                        <li key={st.key}>
                          <button
                            type="button"
                            id={`${SEARCH_LIST_ID}-${st.key}`}
                            role="option"
                            aria-selected={i === hiSafe}
                            // onMouseDown, not onClick: the input keeps focus so
                            // the next field can be typed straight away.
                            onMouseDown={(e) => { e.preventDefault(); pickField(st); }}
                            onMouseEnter={() => setHi(i)}
                            className={cn(
                              "w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 transition-colors",
                              i === hiSafe ? "bg-coral/10 text-ink" : "text-ink-soft hover:bg-paper-deep",
                            )}
                          >
                            <span className="truncate">{st.label}</span>
                            {already && (
                              <span className="ml-auto text-[0.62rem] text-ink-muted shrink-0">added</span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
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

          {/* Body. Capped so a drawer opened on a long table cannot push the
              results entirely off the screen; it scrolls past that. */}
          <div className="max-h-[60vh] overflow-y-auto px-4 lg:px-5 pb-5 space-y-6">
            {RANGE_GROUPS.map((g) => {
              const gc = g.stats.reduce((n, s) => n + (isBoundActive(draft[s.key]) ? 1 : 0), 0);
              return (
                // CSS containment. Without it, changing one slider re-styles and
                // re-lays-out the whole panel — 112 form controls across seven groups —
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
                  {/* Two up on phones. Seven groups of one-per-row meant the
                      panel was mostly scroll: aNET to the Wins group was five
                      screens. The row goes dense below sm so a half-width cell
                      can hold it — see RangeRow's `dense`. Column gap tightens
                      to match; gap-x-6 between two 180px cells is 13% of the
                      viewport spent on nothing. */}
                  <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-3 sm:gap-x-6 gap-y-4">
                    {g.stats.map((st) => (
                      <RangeRow
                        key={st.key}
                        st={st}
                        lo={draft[st.key]?.lo ?? null}
                        hi={draft[st.key]?.hi ?? null}
                        setBound={setBound}
                        pinned={pins.includes(st.key)}
                        onTogglePin={togglePin}
                        dense
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>

          {/* Footer. Sticky to the bottom of the scrolling body so Submit stays
              reachable without scrolling back down through seven groups. */}
          <div className="sticky bottom-0 px-4 lg:px-5 py-3 border-t border-hairline bg-paper-deep/60 backdrop-blur-sm flex items-center gap-3">
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
    </div>
  );

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={DRAWER_PANEL_ID}
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

      {slot ? createPortal(panel, slot) : null}
    </div>
  );
}
