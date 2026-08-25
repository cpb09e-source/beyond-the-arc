"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  RangeRow, isBoundActive, roundNice,
  type RangeStat, type RangeState,
} from "@/components/filters/range-row";
import { StatChipStrip, buildStatChips, type StatChip } from "@/components/filters/stat-chips";
import { FilterGroup } from "@/components/filters/filter-group";
import type { CoachRow } from "@/app/coaches/page";

/**
 * Stat-range drawer for /coaches — the counterpart to the players and teams
 * drawers, same inline-drawer shape and the same shared RangeRow.
 *
 * WHAT MAKES THIS ONE DIFFERENT is the play-style block. Coaches are the only
 * page where the interesting question is not "who is best" but "who plays how",
 * and the answer needs the team-season rates rolled up per coach — pace, shot
 * diet, glass, and what they force on defense. Filtering on those is how you
 * find the six coaches in the country who play fast AND crash the offensive
 * glass, which no amount of sorting a single column will tell you.
 *
 * Bounds below are set from the observed spread across ~800 coaches, rounded
 * outward, so a slider spends its travel where coaches actually differ rather
 * than on values nobody posts.
 */

type Group = { label: string; stats: RangeStat[] };

const GROUPS: Group[] = [
  {
    label: "Play style",
    stats: [
      { key: "pace",      label: "Pace",            min: 55, max: 80, step: 0.5 },
      { key: "fg3a_rate", label: "3PAR",            min: 20, max: 55, step: 0.5 },
      { key: "fta_rate",  label: "FTAR",            min: 20, max: 50, step: 0.5 },
      { key: "orb_pct",   label: "OREB Rate",       min: 15, max: 45, step: 0.5 },
      { key: "tov_pct",   label: "Turnover Rate",   min: 10, max: 25, step: 0.5 },
      { key: "ast_pct",   label: "Assist Rate",     min: 40, max: 70, step: 0.5 },
    ],
  },
  {
    label: "Defensive identity",
    stats: [
      { key: "efg_def",   label: "Opp eFG",         min: 40, max: 58, step: 0.5 },
      { key: "tov_def",   label: "Opp Turnover Rate", min: 12, max: 28, step: 0.5 },
      { key: "orb_def",   label: "Opp OREB Rate",   min: 20, max: 40, step: 0.5 },
    ],
  },
  {
    label: "Résumé",
    stats: [
      { key: "composite",     label: "Composite",     min: -75, max: 285, step: 5 },
      { key: "per_season",    label: "Per Season",    min: -20, max: 40,  step: 0.5 },
      { key: "career_win_pct", label: "Career Win %",  min: 0,   max: 100, step: 1 },
      { key: "conf_win_pct",  label: "Conf Win %",    min: 0,   max: 100, step: 1 },
      { key: "adj_net_avg",   label: "Adj Net",       min: -25, max: 32,  step: 0.5 },
      { key: "seasons",       label: "Seasons",       min: 1,   max: 14,  step: 1 },
    ],
  },
  {
    label: "March",
    stats: [
      { key: "ncaa_rate",       label: "NCAA Rate",       min: 0, max: 100, step: 5 },
      { key: "s16_rate",        label: "Sweet 16 Rate",   min: 0, max: 100, step: 5 },
      { key: "ncaa_appearances", label: "Appearances",    min: 0, max: 14,  step: 1 },
      { key: "sweet_sixteens",  label: "Sweet 16s",       min: 0, max: 12,  step: 1 },
      { key: "final_fours",     label: "Final Fours",     min: 0, max: 6,   step: 1 },
      { key: "ncaa_titles",     label: "Titles",          min: 0, max: 3,   step: 1 },
      { key: "top25_seasons",   label: "Top-25 Seasons",  min: 0, max: 14,  step: 1 },
    ],
  },
];

const ALL_STATS: RangeStat[] = GROUPS.flatMap((g) => g.stats);
const BY_KEY = new Map(ALL_STATS.map((s) => [s.key, s]));
const ORDER = ALL_STATS.map((s) => s.key);

/** Pull the comparable number for a stat off a coach row. */
export function coachStatValue(r: CoachRow, key: string): number | null {
  const st = r.style_avg;
  switch (key) {
    case "pace":      return st?.pace ?? null;
    case "fg3a_rate": return st?.fg3a_rate ?? null;
    case "fta_rate":  return st?.fta_rate ?? null;
    case "orb_pct":   return st?.orb_pct ?? null;
    case "tov_pct":   return st?.tov_pct ?? null;
    case "ast_pct":   return st?.ast_pct ?? null;
    case "efg_def":   return st?.efg_def ?? null;
    case "tov_def":   return st?.tov_def ?? null;
    case "orb_def":   return st?.orb_def ?? null;
    case "composite":       return r.composite_score ?? null;
    case "per_season":      return r.composite_per_season ?? null;
    case "career_win_pct":  return r.career_win_pct != null ? r.career_win_pct * 100 : null;
    case "conf_win_pct":    return r.conf_win_pct != null ? r.conf_win_pct * 100 : null;
    case "adj_net_avg":     return r.adj_net_avg ?? null;
    case "seasons":         return r.seasons_count;
    case "ncaa_rate":       return r.ncaa_rate != null ? r.ncaa_rate * 100 : null;
    case "s16_rate":        return r.s16_rate != null ? r.s16_rate * 100 : null;
    case "ncaa_appearances": return r.ncaa_appearances;
    case "sweet_sixteens":  return r.sweet_sixteens;
    case "final_fours":     return r.final_fours;
    case "ncaa_titles":     return r.ncaa_titles;
    case "top25_seasons":   return r.top25_seasons ?? null;
    default: return null;
  }
}

/**
 * Does a coach clear every active bound?
 *
 * A coach with no value for a bounded stat is EXCLUDED. Filtering on pace and
 * keeping the coaches whose pace we don't know would quietly pad the result
 * with rows that cannot be checked against the thing you asked for.
 */
export function passesCoachFilters(r: CoachRow, state: RangeState): boolean {
  for (const st of ALL_STATS) {
    const b = state[st.key];
    if (!b || (b.lo === null && b.hi === null)) continue;
    const v = coachStatValue(r, st.key);
    if (v === null) return false;
    if (b.lo !== null && v < b.lo) return false;
    if (b.hi !== null && v > b.hi) return false;
  }
  return true;
}

export function coachFilterChips(state: RangeState): StatChip[] {
  return buildStatChips([], state, ORDER, (k) => BY_KEY.get(k)?.label ?? k);
}

/**
 * Stats the table already shows in a column of their own. Filtering on Adj Net
 * should not produce a second Adj Net column beside the first.
 *
 * The March counts are deliberately NOT here: the March cell renders them as a
 * tick strip, which is a shape rather than a sortable number, so a coach who
 * filters on Final Fours still has nowhere to read or order the actual count.
 */
const ALREADY_COLUMNED = new Set([
  "composite", "per_season", "career_win_pct", "conf_win_pct", "adj_net_avg", "seasons",
]);

export type CoachStatColumn = { key: string; label: string };

/**
 * Bounded stats that deserve a column, in drawer order. Filtering on something
 * you cannot then see is the gap this closes — you narrow to coaches who play
 * fast and crash the glass, and the two numbers you chose them for come with
 * them instead of staying behind in the drawer.
 */
export function activeCoachStatColumns(state: RangeState): CoachStatColumn[] {
  return ALL_STATS
    .filter((s) => isBoundActive(state[s.key]) && !ALREADY_COLUMNED.has(s.key))
    .map((s) => ({ key: s.key, label: s.label }));
}

/** Rates that read as percentages; `pace` is possessions, so it stays bare. */
const PCT_STATS = new Set([
  "fg3a_rate", "fta_rate", "orb_pct", "tov_pct", "ast_pct",
  "efg_def", "tov_def", "orb_def",
  "career_win_pct", "conf_win_pct", "ncaa_rate", "s16_rate",
]);
const COUNT_STATS = new Set([
  "seasons", "ncaa_appearances", "sweet_sixteens", "final_fours", "ncaa_titles", "top25_seasons",
]);

export function formatCoachStat(key: string, v: number | null): string {
  if (v === null) return "—";
  if (COUNT_STATS.has(key)) return String(v);
  if (key === "adj_net_avg") return (v > 0 ? "+" : "") + v.toFixed(1);
  return v.toFixed(1) + (PCT_STATS.has(key) ? "%" : "");
}

export const COACH_DRAWER_SLOT_ID = "coach-filters-slot";
const PANEL_ID = "coach-filters-panel";
const FIND_ID = "coach-filters-find";

function SearchGlass({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <circle cx={11} cy={11} r={7} /><line x1={20} y1={20} x2={16.65} y2={16.65} />
    </svg>
  );
}

export function CoachStatFilters({
  state,
  onChange,
  open,
  onOpenChange,
  previewCount,
}: {
  state: RangeState;
  onChange: (next: RangeState) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * How many coaches the DRAFT would keep. A callback, not a number: the
   * footer has to track the sliders as they move, and the committed count
   * cannot do that — it read "804 coaches" while the draft was down to 18.
   */
  previewCount: (state: RangeState) => number;
}) {
  // Draft is seeded once and re-seeded when the drawer OPENS, in the trigger's
  // own handler. No effect: the committed state only ever changes from this
  // drawer or from a toolbar chip removed while it is shut, so there is nothing
  // to synchronise mid-render and no reason to pay for a cascading setState.
  const [draft, setDraft] = useState<RangeState>(state);

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);
  const slot = mounted && typeof document !== "undefined"
    ? document.getElementById(COACH_DRAWER_SLOT_ID)
    : null;

  const setBound = useCallback((key: string, lo: number | null, hi: number | null) => {
    setDraft((d) => ({ ...d, [key]: { lo, hi } }));
  }, []);

  const removeStat = useCallback((key: string) => {
    setDraft((d) => {
      if (!(key in d)) return d;
      const next = { ...d };
      delete next[key];
      return next;
    });
  }, []);

  const clearAll = () => setDraft({});
  const activeDraft = ALL_STATS.reduce((n, s) => n + (isBoundActive(draft[s.key]) ? 1 : 0), 0);
  const activeCommitted = ALL_STATS.reduce((n, s) => n + (isBoundActive(state[s.key]) ? 1 : 0), 0);
  const chips = useMemo(() => coachFilterChips(draft), [draft]);
  const matches = useMemo(() => previewCount(draft), [previewCount, draft]);

  // ---- find a stat -------------------------------------------------------
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const found = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [] as RangeStat[];
    return ALL_STATS
      .filter((s) => s.label.toLowerCase().includes(needle))
      .sort((a, b) => {
        const ai = a.label.toLowerCase().indexOf(needle);
        const bi = b.label.toLowerCase().indexOf(needle);
        return ai - bi || a.label.localeCompare(b.label);
      })
      .slice(0, 8);
  }, [q]);
  const hiSafe = found.length ? Math.min(hi, found.length - 1) : 0;

  /** Picking a field opens it at its full range — a visible, editable row. */
  const pick = (st: RangeStat) => {
    setDraft((d) => (d[st.key] ? d : { ...d, [st.key]: { lo: roundNice(st.min), hi: null } }));
    setQ(""); setHi(0);
    requestAnimationFrame(() => {
      document.getElementById(`coachrow-${st.key}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!found.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, found.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); pick(found[hiSafe]!); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setQ(""); }
  };

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onOpenChange(false); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, onOpenChange]);

  // A modal over the page must freeze the page. Below md only: at md+ this is
  // still an inline drawer and the page behind it is the point.
  useEffect(() => {
    if (!open) return;
    if (!window.matchMedia("(max-width: 47.99rem)").matches) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const panel = (
    <>
      {/* PHONE: a scrim, so the panel reads as over the page rather than as
          part of it. Tapping it closes, same as the X. */}
      {open && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-ink/40 bta-backdrop-in"
          onClick={() => onOpenChange(false)}
          aria-hidden
        />
      )}
      <div className={cn(
        // Same treatment as the teams and players drawers: the inline collapse
        // at md+, a sheet anchored under the header below it. This page kept
        // the old always-inline .bta-drawer after those two moved, so /coaches
        // was opening a different way from the rest of the site.
        "bta-sheet md:border-b md:border-hairline md:bg-paper-deep/20",
        open && "is-open",
        "max-md:fixed max-md:inset-x-0 max-md:top-16 max-md:bottom-0 max-md:z-50 max-md:bg-card max-md:border-t max-md:border-hairline",
        !open && "max-md:hidden",
      )}>
      <div className="max-md:flex max-md:flex-col max-md:h-full">
        <div id={PANEL_ID} role="region" aria-label="Coach filters" className="max-md:flex max-md:flex-col max-md:flex-1 max-md:min-h-0">
          <div className="flex items-start justify-between gap-3 px-4 lg:px-5 pt-4 pb-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center flex-wrap gap-2 min-h-6">
                <h3 className="text-base font-semibold text-ink leading-none">Filters</h3>
                {activeDraft > 0 && (
                  <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-coral text-white text-[0.62rem] font-bold tabular">{activeDraft}</span>
                )}
                {chips.length > 0 && (
                  <button type="button" onClick={clearAll} className="text-xs text-ink-muted hover:text-coral transition-colors">Clear all</button>
                )}
                <StatChipStrip chips={chips} onRemove={removeStat} ariaLabel="Stat filters being edited" />
              </div>
              {/* Desktop only. Two lines of instruction above the sliders is a
                  fair trade on a wide screen; on a phone it is the first thing
                  in a drawer opened by someone who has already worked out that
                  the sliders are sliders, and it pushes them off the fold. */}
              <p className="hidden md:block mt-1.5 text-xs text-ink-muted leading-snug">
                Drag a slider to narrow the field. Play style is the career average of the
                teams a coach actually ran — pace, shot diet, the glass, and what they force.
              </p>

              <div className="relative mt-3 max-w-80">
                <SearchGlass className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-muted pointer-events-none" />
                <input
                  type="text"
                  value={q}
                  onChange={(e) => { setQ(e.target.value); setHi(0); }}
                  onKeyDown={onKey}
                  placeholder="Find a stat…"
                  aria-label="Find a stat"
                  aria-expanded={found.length > 0}
                  aria-controls={FIND_ID}
                  aria-autocomplete="list"
                  role="combobox"
                  className="h-8 w-full pl-8 pr-7 rounded-md border border-ink/15 bg-card text-ink text-sm placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-coral/40 focus:border-coral/40"
                />
                {found.length > 0 && (
                  <ul id={FIND_ID} role="listbox" className="absolute left-0 right-0 top-9 z-20 rounded-md border border-hairline bg-popover shadow-lg overflow-hidden py-1">
                    {found.map((st, i) => (
                      <li key={st.key}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={i === hiSafe}
                          onMouseDown={(e) => { e.preventDefault(); pick(st); }}
                          onMouseEnter={() => setHi(i)}
                          className={cn("w-full text-left px-3 py-1.5 text-sm transition-colors",
                            i === hiSafe ? "bg-coral/10 text-ink" : "text-ink-soft hover:bg-paper-deep")}
                        >
                          {st.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Close filters"
              className="shrink-0 w-8 h-8 -mr-1 inline-flex items-center justify-center rounded-md text-ink-muted hover:text-ink hover:bg-paper-deep transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          <div className="max-md:flex-1 max-md:min-h-0 md:max-h-[60vh] overflow-y-auto px-4 lg:px-5 pb-5 space-y-6">
            {GROUPS.map((g) => {
              const gc = g.stats.reduce((n, s) => n + (isBoundActive(draft[s.key]) ? 1 : 0), 0);
              return (
                <FilterGroup key={g.label} label={g.label} count={gc}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-6 gap-y-4">
                    {g.stats.map((st) => (
                      <div key={st.key} id={`coachrow-${st.key}`}>
                        <RangeRow
                          st={st}
                          lo={draft[st.key]?.lo ?? null}
                          hi={draft[st.key]?.hi ?? null}
                          setBound={setBound}
                        />
                      </div>
                    ))}
                  </div>
                </FilterGroup>
              );
            })}
          </div>

          <div className="sticky bottom-0 max-md:static max-md:shrink-0 px-4 lg:px-5 py-3 max-md:pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] border-t border-hairline bg-paper-deep/60 backdrop-blur-sm flex items-center gap-3">
            <div className="text-sm text-ink-soft leading-none">
              <span className="text-lg font-bold text-ink tabular">{matches.toLocaleString()}</span>
              <span className="ml-1.5 text-xs text-ink-muted">{matches === 1 ? "coach" : "coaches"}</span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button type="button" onClick={() => { setDraft(state); onOpenChange(false); }}
                className="h-9 px-3 text-sm text-ink-muted hover:text-ink transition-colors">Cancel</button>
              <button type="button" onClick={() => { onChange(draft); onOpenChange(false); }}
                className="h-9 text-sm font-semibold bg-coral text-white px-6 rounded-md hover:bg-coral-soft transition-colors">Submit</button>
            </div>
          </div>
        </div>
      </div>
      </div>
    </>
  );

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => { if (!open) setDraft(state); onOpenChange(!open); }}
        aria-expanded={open}
        aria-controls={PANEL_ID}
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
