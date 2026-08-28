"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { roundNice, type RangeState } from "@/components/filters/range-row";
import { buildStatChips, type StatChip } from "@/components/filters/stat-chips";
import {
  FILTER_COLUMNS, GROUP_LABEL, MAX_FILTERS, parseSpec, specToParams, teamStatColumn,
  type Comparator, type StatFilter, type StatGroup, type TeamFilterSpec, type TeamStatKey,
} from "@/lib/team-filters";
import { viewByKey } from "@/lib/team-views";

/**
 * Stat-filter builder for the team explorer.
 *
 * ── WHY THIS IS A ROW BUILDER AND NOT A DRAWER OF SLIDERS ──────────────────
 * It was seven groups of dual-thumb sliders, and before that a popover of
 * "Where <stat> <operator> <value>" rows. The sliders replaced the rows because
 * the rows "asked the reader to know the stat vocabulary before they could ask
 * a question" — /calc's condition sheet won the same argument for the same
 * reason: a sheet SHOWS what is available, a dropdown builder does not.
 *
 * That objection was correct, and it is answered here rather than ignored. The
 * picker opens straight into a grouped, browsable list with the cursor already
 * in the search box — you can scroll it like a menu or type like a search, so
 * it shows what is available AND scales. What the slider drawer could not do is
 * survive the stat count: 28 sliders fit in a panel, and the registry has 55
 * today with roughly 45 more mapped. Nobody scrolls 100 sliders to find one.
 *
 * ── AND WHY THERE IS NO PANEL AT ALL NOW ───────────────────────────────────
 * There was a "View & Filters" drawer around this: a trigger button, a header,
 * an explanatory paragraph, an empty-state line, a scrim on phones. All of it
 * existed to house 112 form controls. What it houses now is one button, so the
 * chrome outweighed the content — a modal you open to press a single button is
 * a worse version of the button. The builder lives in the toolbar, one row
 * under the search box, and the rows appear in place as they are added.
 *
 * ── WHAT THE SLIDERS TAUGHT, AND HOW IT SURVIVES ───────────────────────────
 * A slider labelled −30 to 30 tells you what a plausible aNET is; a bare value
 * box does not, and that was the real loss. STAT_BOUNDS below is the measured
 * table the sliders used — 1st/99th percentile of each stat across all 6,689
 * team-seasons — and it now drives the value input's placeholder. Same lesson,
 * no slider. A stat with no measured bounds simply gets a plain placeholder,
 * which is the honest state until it is measured.
 *
 * ── FOUR COMPARATORS, NOT FIVE ─────────────────────────────────────────────
 * >, ≥, ≤, < — exactly what the Comparator type and the URL already carry.
 * Equality is deliberately absent: every stat here is a float, so `aNET = 25`
 * matches nothing, and adding an operator that silently returns an empty table
 * would be a worse answer than not offering it.
 *
 * Self-contained by design: it reads its own draft from the URL and on Submit
 * pushes `{ ...urlSpec, filters, cols }`, preserving the scope params (seasons
 * / team / conference) that FilterBar owns and the sort/limit the table owns.
 */

// ---------------------------------------------------------------------------
// Stat metadata
// ---------------------------------------------------------------------------

/**
 * Whether a stat is STORED as a fraction and READ as a percentage.
 *
 * Derived from the registry's own `format` rather than a second hand-kept list.
 * That is safe because it was checked rather than assumed: every one of the 28
 * stats the slider drawer carried an explicit `pct` flag for agrees with
 * `format.startsWith("pct")`, and spot-reading teams-all.json confirms the rule
 * holds for the other 27 (ts_pct 0.577, efg_pct 0.532, sos 0.599 — all
 * fractions; ortg 117.4, wab 3.9, reb_diff 341 — all raw).
 *
 * Getting this wrong is not a cosmetic bug: a reader types 35 for eFG and we
 * would store 35 instead of 0.35, and the table comes back empty.
 */
function isPctStat(key: string): boolean {
  return (teamStatColumn(key)?.format ?? "").startsWith("pct");
}

/**
 * Measured 1st/99th-percentile bounds, in DISPLAY units, rounded outward.
 *
 * They constrain nothing — a reader may type any number — they only say what a
 * normal one looks like, which a bare box cannot.
 *
 * GENERATED, NOT HAND-WRITTEN: scripts/build-stat-bounds.mts measures the 1st
 * and 99th percentile of each stat across 4,273 team-seasons and rounds
 * outward. The first 28 were inherited from the slider drawer and covered only
 * the stats that had once had a slider, so ~100 of the registry showed no hint
 * at all. Re-run that script after any change to the stat registry.

 */
const STAT_BOUNDS: Record<string, [number, number]> = {
  // overall
  a_net: [-25, 30], a_ortg: [85, 125], a_drtg: [90, 120],
  adjt: [61, 75], cbb_pace: [61, 76], prev_a_net: [-25, 30],
  // record
  adj_sos: [-15, 15], wins: [0, 35], losses: [0, 30],
  wab: [-25, 10], nc_sos: [-10, 15], conf_sos: [-20, 20],
  sos_wp: [50, 90], win_pct: [10, 90], wins_no_trail: [0, 9],
  wire_wins: [0, 6], wins_trailing_5: [0, 13], wins_trailing_10: [0, 6],
  wins_trailing_15: [0, 2], wins_trailing_20: [0, 1], losses_no_lead: [0, 8],
  wire_losses: [0, 5], losses_leading_5: [0, 12], losses_leading_10: [0, 5],
  losses_leading_15: [0, 2], losses_leading_20: [0, 1], pbp_games: [5, 40],
  // roster
  eff_height: [74.5, 79], fr_min_pct: [0, 55], so_min_pct: [0, 65],
  jr_min_pct: [0, 70], sr_min_pct: [0, 80], fr_pts_pct: [0, 55],
  so_pts_pct: [0, 70], jr_pts_pct: [0, 75], sr_pts_pct: [0, 85],
  cont_pct: [0, 85], ret_min_pct: [0, 95], rrot_pct: [0, 100],
  ret_prior_min: [0, 6000], prior_team_min: [3500, 7700], ret_curr_min: [0, 6450],
  curr_team_min: [5150, 7700], in_transfer_min: [0, 7250], proven_min_pct: [0, 120],
  // scoring
  cbb_ts: [47, 61], cbb_efg: [43, 58], cbb_fg3: [28, 41],
  cbb_ft: [62, 80], cbb_fg3rate: [20, 55], cbb_ftarate: [20, 50],
  cbb_orb: [19, 39], cbb_tov: [13, 24], cbb_ast: [40, 65],
  cbb_fbpts: [3, 20], cbb_pitp: [30, 55], cbb_ortg: [90, 125],
  cbb_fg: [38, 50], cbb_fg2: [42, 59], cbb_fga_pg: [49, 66],
  cbb_fg2a_pg: [28, 45], cbb_fg3a_pg: [13, 31], cbb_fta_pg: [13, 27],
  cbb_pts_pg: [55, 90], cbb_ast_pg: [9, 19], cbb_orb_pg: [6, 15],
  cbb_reb_pg: [28, 42], cbb_tov_pg: [9, 17], cbb_pfd_pg: [14, 22],
  cbb_fbpts_pg: [2, 16], cbb_pitp_pg: [20, 41], cbb_potov_pg: [9, 20],
  cbb_scp_pg: [5, 15], cbb_scp_pct: [8, 20], cbb_bench_pg: [5, 35],
  cbb_bench_pct: [10, 45], cbb_ast_to: [0.5, 2], cbb_ppp: [0.9, 1.3],
  cbb_rim_rate: [20, 50], cbb_mid_rate: [10, 45], cbb_three_rate: [20, 55],
  cbb_rim_fg: [47, 66], cbb_mid_fg: [25, 50], cbb_corner3_fg: [20, 50],
  cbb_atb3_fg: [25, 41], cbb_corner3_share: [5, 30], cbb_unast_pg: [8, 16],
  cbb_unast_share: [35, 60],
  // defense
  cbb_efg_def: [43, 57], cbb_tov_def: [13, 25], cbb_orb_def: [22, 37],
  cbb_fg3_def: [28, 40], cbb_drtg: [90, 120], cbb_drb_pg: [20, 30],
  cbb_stl_pg: [4, 10], cbb_blk_pg: [1.5, 6], cbb_pf_pg: [13, 23],
  cbb_drb_pct: [63, 78], cbb_stl_pct: [5, 15], cbb_blk_pct: [4, 16],
  cbb_hakeem: [11, 28], cbb_stl_pf: [0.2, 0.6], cbb_blk_pf: [0, 0.4],
  cbb_pf_eff: [0.3, 0.9], cbb_rim_rate_def: [20, 50], cbb_mid_rate_def: [15, 45],
  cbb_three_rate_def: [25, 50],
  // diffs
  efg_diff: [-10, 11], tov_diff: [-7, 8], orb_diff: [-15, 15],
  fg3_diff: [-9, 9], fg3m_diff_ct: [-120, 140], fg3a_diff_ct: [-300, 350],
  fg2m_diff_ct: [-180, 220], fgm_diff_ct: [-170, 220], ftm_diff_ct: [-180, 200],
  orb_diff_ct: [-150, 160], drb_diff_ct: [-180, 230], reb_diff_ct: [-300, 350],
  tov_diff_ct: [-180, 140], reb_diff_pg: [-8, 9], fg3m_diff_pg: [-4, 4],
  fbpts_diff_pg: [-6, 7], tov_diff_pg: [-6, 5], pitp_diff_pg: [-15, 15],
  potov_diff_pg: [-8, 8], scp_diff_pg: [-5, 6], fbpts_diff: [-170, 250],
  pitp_diff: [-350, 450], pts_diff: [-450, 550], scp_diff: [-150, 180],
};

const OPS: Array<{ op: Comparator; symbol: string }> = [
  { op: "gte", symbol: "≥" },
  { op: "gt", symbol: ">" },
  { op: "lte", symbol: "≤" },
  { op: "lt", symbol: "<" },
];

/** Registry order, so the picker's sections read the way the registry is written. */
const GROUP_ORDER: StatGroup[] = ["overall", "record", "roster", "scoring", "defense", "diffs"];

// ---------------------------------------------------------------------------
// Draft rows <-> URL filters
// ---------------------------------------------------------------------------

/**
 * One row being edited.
 *
 * `value` is a STRING, not a number, and that is what makes the row typable: a
 * number-typed draft cannot hold "-", "0." or "" without either rejecting the
 * keystroke or collapsing to 0 mid-entry. It converts on submit, and a row that
 * has not reached a finite number yet is simply not part of the query.
 *
 * `id` exists because two rows may carry the same stat — "aNET ≥ 10 and
 * aNET ≤ 20" is the ordinary way to express a band now that ranges are gone —
 * so the stat key cannot be the React key.
 */
type DraftRow = { id: number; stat: TeamStatKey; op: Comparator; value: string };

let nextRowId = 1;

/**
 * Rebuild the builder's rows from the URL — ONE ROW PER PINNED COLUMN, plus
 * any filter on a stat that is not pinned.
 *
 * It used to derive rows from the filters alone, and that quietly could not
 * represent the most ordinary thing in this panel: a column you want to SEE
 * but not bound. Such a row has no value, so it serialises to no `f` param,
 * so the resync read it back as nothing and deleted the row — the reader
 * ticked four stats, got four columns, and watched the four rows they were
 * about to type into disappear.
 *
 * Pinned columns are the spine because that is what the table renders. A bound
 * stat that somehow is not pinned still gets a row, so an old link cannot
 * strand a filter with no way to edit it.
 */
function rowsFromSpec(cols: readonly string[], filters: StatFilter[]): DraftRow[] {
  const byStat = new Map(filters.map((f) => [f.stat as string, f]));
  const rows: DraftRow[] = [];
  const seen = new Set<string>();

  const toValue = (f: StatFilter) =>
    // Back into display units. roundNice kills the float dust that would
    // otherwise show a reader "35.00000000000001" in the box they typed 35 in.
    String(isPctStat(f.stat) ? roundNice(f.value * 100) : f.value);

  for (const key of cols) {
    seen.add(key);
    const f = byStat.get(key);
    rows.push({
      id: nextRowId++,
      stat: key as TeamStatKey,
      op: f ? f.op : "gte",
      value: f ? toValue(f) : "",
    });
  }
  for (const f of filters) {
    if (seen.has(f.stat as string)) continue;
    rows.push({ id: nextRowId++, stat: f.stat, op: f.op, value: toValue(f) });
  }
  return rows;
}

function rowsToFilters(rows: DraftRow[]): StatFilter[] {
  const out: StatFilter[] = [];
  for (const r of rows) {
    const n = Number(r.value);
    if (r.value.trim() === "" || !Number.isFinite(n)) continue;
    out.push({ stat: r.stat, op: r.op, value: isPctStat(r.stat) ? roundNice(n / 100) : n });
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
// Selection chips (toolbar only — the builder shows its own rows)
// ---------------------------------------------------------------------------

/**
 * Filters → the {lo, hi} shape the chip builder speaks.
 *
 * Keyed off the registry rather than the old 28-stat slider table: that table
 * was the existence check as well as the pct lookup, so a filter on any of the
 * other 27 stats produced no chip at all — applied, counted, invisible.
 */
function filtersToRanges(filters: StatFilter[]): RangeState {
  const out: RangeState = {};
  for (const f of filters) {
    if (!teamStatColumn(f.stat)) continue;
    const slot = (out[f.stat] ??= { lo: null, hi: null });
    const disp = isPctStat(f.stat) ? roundNice(f.value * 100) : f.value;
    if (f.op === "gte" || f.op === "gt") slot.lo = disp;
    else slot.hi = disp;
  }
  return out;
}

const CHIP_ORDER = FILTER_COLUMNS.map((c) => c.key);
const chipLabel = (key: string) => teamStatColumn(key)?.label ?? key;

/** Chips for the toolbar, built from the committed spec. */
export function teamStatChipsFromSpec(cols: readonly string[], filters: StatFilter[]): StatChip[] {
  return buildStatChips(cols, filtersToRanges(filters), CHIP_ORDER, chipLabel);
}

const PICKER_LIST_ID = "team-filters-picker";

/** Magnifier, matching the one on the table's own search box. */
function SearchGlass({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <circle cx={11} cy={11} r={7} /><line x1={20} y1={20} x2={16.65} y2={16.65} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Stat picker
// ---------------------------------------------------------------------------

type PickOption = { key: string; label: string; desc: string; group: StatGroup };

const PICK_OPTIONS: PickOption[] = GROUP_ORDER.flatMap((g) =>
  FILTER_COLUMNS.filter((c) => c.group === g).map((c) => ({
    key: c.key, label: c.label, desc: c.desc, group: c.group,
  })),
);

/**
 * The "Add a Filter" popover: browse by section, or type to narrow.
 *
 * OPENS FOCUSED, WITH EVERYTHING SHOWING. Both halves matter and they are the
 * whole reason this can replace a sheet of sliders. Focused, because the reader
 * who knows they want Opp OREB should never touch the mouse again. Everything
 * showing, because the reader who does not know what is available needs to be
 * able to read the list — an empty box that only reveals options once you guess
 * a prefix is the failure mode that sank the last dropdown builder.
 *
 * Search matches LABEL AND DESCRIPTION, so "rebound" finds OREB% and "bubble"
 * finds WAB. Label matches sort first, so typing an exact abbreviation still
 * puts it at the top.
 */
/**
 * TWO DOORS INTO ONE LIST.
 *
 * "filter" is the original: pick a stat, the row appears, the caret is already
 * in its value box. One click, one bound, keep typing. That path was briefly
 * lost to multi-select and it should not have been — bounding a stat is the
 * single most common thing anyone does here, and it deserves to stay one
 * click.
 *
 * "columns" is the batch door: tick as many as you like, commit them all with
 * blank values. It also SHOWS what is already on the table, so unticking is
 * how a column comes off — it manages the set rather than only adding to it.
 *
 * They are not two data models. Filtering a stat pins it as a column either
 * way, so both end up in the same list of rows; what differs is how many you
 * name at once and whether the caret follows.
 */
function StatPicker({
  mode,
  onPick,
  onSetColumns,
  current,
  remaining,
  disabled,
  open,
  setOpen,
}: {
  mode: "filter" | "columns";
  /** filter mode: one stat, added immediately. */
  onPick: (key: TeamStatKey) => void;
  /** columns mode: the FULL set that should be on the table afterwards. */
  onSetColumns: (keys: TeamStatKey[]) => void;
  /** Stats already on the table, ticked when the columns picker opens. */
  current: readonly string[];
  /** Filter slots still free, so the picker cannot mark more than fit. */
  remaining: number;
  disabled?: boolean;
  /**
   * OWNED BY THE PARENT, because a filter row can reopen this. Pressing Enter
   * in a value box means "that one's done, give me the next" — so the row has
   * to be able to raise the picker, and the picker cannot be the only thing
   * that knows whether it is up.
   */
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  /**
   * Stats ticked but not yet added, in the order they were ticked — which
   * becomes their column order, because the order you thought of them in is
   * the order you want to read them in.
   */
  const [marked, setMarked] = useState<TeamStatKey[]>([]);
  /** Viewport coords of the trigger, for the portalled popover. */
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  /**
   * THE POPOVER IS PORTALLED TO document.body, AND IT HAS TO BE.
   *
   * It sits inside the table card, which establishes an overflow context for
   * the sticky column headers below it. Any absolutely-positioned child is
   * cropped to that box — the first build of this rendered exactly one visible
   * option and a stray scrollbar. Fixed positioning off the trigger's own rect
   * sidesteps the ancestor entirely, at the cost of a reposition on scroll and
   * resize below.
   */
  const place = useCallback(() => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    // Flip above the trigger when there is not room beneath it. 340 is the
    // popover's own worst-case height (list + search row + padding).
    const below = window.innerHeight - r.bottom;
    setAt({
      left: Math.min(r.left, window.innerWidth - 336),
      top: below < 340 && r.top > 340 ? r.top - 346 : r.bottom + 6,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    inputRef.current?.focus();
    // `true` to catch scrolls on inner containers, which do not bubble a
    // scroll event to window.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  /**
   * Hand the ticked stats to the parent, or throw them away.
   *
   * Declared above the click-away effect rather than beside the other
   * handlers, because that effect is what calls them — reaching them through
   * a ref instead is the pattern React's compiler now rejects, and a
   * dependency is honest about what the effect actually uses.
   */
  const commit = useCallback(() => {
    // Columns mode commits the whole ticked set — including ticks REMOVED,
    // which is how a column comes off the table. Filter mode never gets here;
    // it commits on the click itself.
    if (mode === "columns") onSetColumns(marked);
    setMarked([]);
    setQ("");
    setHi(0);
  }, [mode, marked, onSetColumns]);
  const discard = useCallback(() => { setMarked([]); setQ(""); setHi(0); }, []);

  // Click-away and Escape. The popover is no longer a DOM descendant of the
  // trigger, so the away-test has to clear BOTH nodes or every click inside the
  // list would close the thing it clicked in.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || popRef.current?.contains(t)) return;
      // Clicking away COMMITS what is ticked. Ticking four stats and losing
      // them to a stray click would be the worst possible reading of the
      // gesture; Escape is the one that discards, and says so below.
      commit();
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); discard(); setOpen(false); }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, setOpen, commit, discard]);

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return PICK_OPTIONS;
    return PICK_OPTIONS.filter(
      (o) => o.label.toLowerCase().includes(needle) || o.desc.toLowerCase().includes(needle),
    ).sort((a, b) => {
      const ai = a.label.toLowerCase().indexOf(needle);
      const bi = b.label.toLowerCase().indexOf(needle);
      // -1 (matched on description only) sorts after every label match.
      const an = ai < 0 ? 999 : ai;
      const bn = bi < 0 ? 999 : bi;
      return an - bn || a.label.localeCompare(b.label);
    });
  }, [q]);

  // Clamp during render — a shrinking list must never leave the highlight past
  // the end, which would make Enter do nothing.
  const hiSafe = matches.length ? Math.min(hi, matches.length - 1) : 0;

  // Keep the highlighted row in view while arrowing through 55 options.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector(`[data-idx="${hiSafe}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [hiSafe, open]);

  /**
   * Tick or untick. Nothing reaches the table until the picker is committed.
   *
   * This replaced click-to-add-and-close. The old note here argued that the
   * popover could not stay open because picking sent the caret to a value box
   * and the popover would then float over it — true then, and no longer the
   * case, because ticking moves no caret. The cost is that adding ONE stat is
   * now a click plus Enter (or a click outside) rather than a single click;
   * the gain is that adding four is four clicks instead of four round trips
   * through the button.
   */
  const choose = (o: PickOption) => {
    const key = o.key as TeamStatKey;
    if (mode === "filter") {
      // Straight through: add it, close, and the parent puts the caret in the
      // new row's value box.
      onPick(key);
      setQ(""); setHi(0); setOpen(false);
      return;
    }
    setMarked((m) =>
      m.includes(key) ? m.filter((k) => k !== key)
        : m.length >= remaining ? m
        : [...m, key],
    );
  };


  const atCapNow = marked.length >= remaining;

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, matches.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (mode === "filter") {
        // Type a few letters, Enter, start typing the value. Unchanged.
        if (matches[hiSafe]) choose(matches[hiSafe]!);
        return;
      }
      // Columns: Enter with nothing ticked still takes the highlighted row,
      // so the keyboard path never needs the mouse. That tick is not in state
      // yet, so the set is read from the list rather than from `marked`.
      const keys = marked.length
        ? marked
        : matches[hiSafe] ? [...current, matches[hiSafe]!.key] as TeamStatKey[] : [];
      onSetColumns(keys);
      setMarked([]); setQ(""); setHi(0); setOpen(false);
    }
  };

  // Section headers render only while browsing. Under a search the list is
  // ranked by match quality, so group headings would break the order into
  // fragments that no longer mean anything.
  const grouped = q.trim() === "";

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        // Seeding happens HERE rather than in an effect on `open`: opening is
        // an event with a handler already attached, and the columns picker has
        // to show what is on the table before the reader touches anything.
        onClick={() => {
          if (!open && mode === "columns") setMarked(current as TeamStatKey[]);
          setOpen(!open);
        }}
        disabled={disabled}
        aria-expanded={open}
        aria-controls={PICKER_LIST_ID}
        className={cn(
          "inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-dashed text-sm font-medium transition-colors whitespace-nowrap",
          disabled
            ? "border-ink/10 text-ink-muted/60 cursor-not-allowed"
            : "border-coral/40 text-coral hover:bg-coral/6 hover:border-coral/60",
        )}
      >
        <Plus size={15} />
        {mode === "filter" ? "Add a Filter" : "Add Columns"}
      </button>

      {open && at && typeof document !== "undefined" && createPortal(
        <div
          ref={popRef}
          style={{ position: "fixed", left: at.left, top: at.top }}
          className="z-60 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-hairline bg-popover shadow-xl overflow-hidden"
        >
          <div className="relative border-b border-hairline">
            <SearchGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-muted pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              value={q}
              onChange={(e) => { setQ(e.target.value); setHi(0); }}
              onKeyDown={onKey}
              placeholder={mode === "filter" ? "Search stats…" : "Search columns…"}
              aria-label="Search stats"
              role="combobox"
              aria-expanded
              aria-controls={PICKER_LIST_ID}
              aria-autocomplete="list"
              className="h-10 w-full pl-9 pr-3 bg-transparent text-ink text-sm placeholder:text-ink-muted focus:outline-none"
            />
          </div>

          <div id={PICKER_LIST_ID} role="listbox" ref={listRef} className="max-h-72 overflow-y-auto py-1">
            {matches.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-ink-muted">No stat matches “{q.trim()}”.</p>
            )}
            {matches.map((o, i) => {
              const first = grouped && (i === 0 || matches[i - 1]!.group !== o.group);
              return (
                <div key={o.key}>
                  {first && (
                    <div className="px-3 pt-2.5 pb-1 text-[0.6rem] uppercase tracking-[0.12em] font-semibold text-ink-muted">
                      {GROUP_LABEL[o.group]}
                    </div>
                  )}
                  <button
                    type="button"
                    role="option"
                    data-idx={i}
                    aria-selected={i === hiSafe}
                    // onMouseDown, not onClick: the input keeps focus so the
                    // next stat can be typed straight away.
                    onMouseDown={(e) => { e.preventDefault(); choose(o); }}
                    onMouseEnter={() => setHi(i)}
                    title={marked.includes(o.key as TeamStatKey) || !atCapNow ? o.desc : "Filter limit reached"}
                    className={cn(
                      "w-full text-left px-3 py-1.5 text-sm transition-colors flex items-center gap-2.5",
                      i === hiSafe ? "bg-coral/10 text-ink" : "text-ink-soft hover:bg-paper-deep",
                      !marked.includes(o.key as TeamStatKey) && atCapNow && "opacity-40",
                    )}
                  >
                    {mode === "columns" && (
                      <span
                        aria-hidden
                        className={cn(
                          "shrink-0 w-3.5 h-3.5 rounded-[3px] border inline-flex items-center justify-center transition-colors",
                          marked.includes(o.key as TeamStatKey)
                            ? "bg-coral border-coral text-white"
                            : "border-ink/25",
                        )}
                      >
                        {marked.includes(o.key as TeamStatKey) && (
                          <svg viewBox="0 0 12 12" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M2.5 6.2l2.4 2.4L9.5 3.8" />
                          </svg>
                        )}
                      </span>
                    )}
                    <span className="truncate">{o.label}</span>
                  </button>
                </div>
              );
            })}
          </div>

          {/* Only once something is ticked. An empty picker needs no
              instructions; a picker holding four choices needs to say what
              happens to them. */}
          {mode === "columns" && marked.length > 0 && (
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-hairline bg-paper-deep/50">
              <span className="text-xs text-ink-soft">
                <span className="font-medium text-coral">{marked.length}</span> on the table
                {atCapNow && <span className="text-ink-muted"> · limit</span>}
              </span>
              <span className="text-[0.68rem] text-ink-muted">
                <span className="font-medium text-ink-soft">Enter</span> to add
                <span className="mx-1">·</span>
                <span className="font-medium text-ink-soft">Esc</span> to clear
              </span>
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One filter row
// ---------------------------------------------------------------------------

function FilterRow({
  row,
  autoFocus,
  onChange,
  onRemove,
  onNext,
}: {
  row: DraftRow;
  autoFocus: boolean;
  onChange: (id: number, patch: Partial<DraftRow>) => void;
  onRemove: (id: number) => void;
  /** Enter in the value box: this row is finished, open the picker again. */
  onNext: () => void;
}) {
  const col = teamStatColumn(row.stat);
  const bounds = STAT_BOUNDS[row.stat];
  const pct = isPctStat(row.stat);
  const valueRef = useRef<HTMLInputElement>(null);

  // The row is created by picking a stat, so the only thing left to do is type
  // a number — land the caret there rather than making the reader aim for it.
  useEffect(() => {
    if (autoFocus) valueRef.current?.focus();
  }, [autoFocus]);

  return (
    <div className="inline-flex items-center gap-1.5">
      <span
        title={col?.desc}
        className="h-8 px-2.5 inline-flex items-center rounded-md border border-hairline bg-paper-deep/60 text-sm font-medium text-ink whitespace-nowrap cursor-default"
      >
        {col?.label ?? row.stat}
      </span>

      <select
        value={row.op}
        onChange={(e) => onChange(row.id, { op: e.target.value as Comparator })}
        aria-label={`Comparison for ${col?.label ?? row.stat}`}
        className="h-8 w-14 shrink-0 px-1 rounded-md border border-ink/15 bg-card text-ink text-sm text-center focus:outline-none focus:ring-2 focus:ring-coral/40"
      >
        {OPS.map((o) => (
          <option key={o.op} value={o.op}>{o.symbol}</option>
        ))}
      </select>

      {/* SIZED TO THE VALUE, NOT TO THE PLACEHOLDER. Almost everything typed
          here is two or three digits — "70", "19", "43" — and the widest
          realistic entry is five characters ("-242", "130.5"). At w-24 the box
          was mostly empty, and five filters of mostly-empty box is a row that
          runs off the side of the card. */}
      <div className="relative w-16 shrink-0">
        <input
          ref={valueRef}
          // `inputMode` rather than `type="number"`: a number input swallows a
          // lone "-" and hijacks the scroll wheel over the field, both of which
          // bite on a table you scroll past.
          type="text"
          inputMode="decimal"
          value={row.value}
          onChange={(e) => onChange(row.id, { value: e.target.value })}
          // Enter chains straight into the next filter rather than submitting.
          // Picking a stat and typing a number is one motion repeated, so the
          // keyboard path has to complete the loop — otherwise every filter
          // after the first costs a reach for the mouse. Submit is still a
          // deliberate click; nothing here applies anything to the table.
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); onNext(); }
          }}
          // An en dash rather than " to ": same information, four fewer
          // characters, which is the difference between the hint fitting and
          // being clipped now that the box is narrower. A NEGATIVE lower bound
          // is the exception — "-25–30" reads as one mangled number, so those
          // spell the word out and accept the width.
          placeholder={bounds ? (bounds[0] < 0 ? `${bounds[0]} to ${bounds[1]}` : `${bounds[0]}–${bounds[1]}`) : "Value"}
          aria-label={`Value for ${col?.label ?? row.stat}`}
          className={cn(
            "h-8 w-full px-2 rounded-md border border-ink/15 bg-card text-ink text-sm tabular",
            "placeholder:text-ink-muted placeholder:text-[0.68rem]",
            "focus:outline-none focus:ring-2 focus:ring-coral/40 focus:border-coral/40",
            pct && "pr-5",
          )}
        />
        {pct && (
          <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-xs text-ink-muted pointer-events-none">%</span>
        )}
      </div>

      {/* A bin rather than a cross. An × between two filter rows reads as a
          separator as easily as a control — which is what it looked like next
          to the "×" the chips use for the same job — and this one deletes a
          row the reader built rather than dismissing something. */}
      <button
        type="button"
        onClick={() => onRemove(row.id)}
        aria-label={`Delete ${col?.label ?? row.stat} filter`}
        title="Delete this filter"
        // MUTED RED AT REST, full on hover. The bin is the only destructive
        // control in the row, and leaving it the same grey as the "%" suffix
        // made it read as decoration; --bad rather than the coral accent
        // because coral means "this is yours / this is active" everywhere else
        // on the page, and it cannot also mean "this deletes something".
        //
        // -ml-1 eats most of the row's gap-1.5. A 24px box around a 14px icon
        // put ~11px between the value box and the bin, which was enough to
        // read as belonging to the NEXT filter rather than to this one.
        className={cn(
          "shrink-0 w-5 h-8 -ml-1 inline-flex items-center justify-center rounded-md transition-colors",
          "text-bad/75 hover:text-bad hover:bg-bad/8",
        )}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The builder row
// ---------------------------------------------------------------------------

export function TeamStatFilters({
  previewCount,
}: {
  /** Runs the live pipeline against the working draft for the match total. */
  previewCount?: (filters: StatFilter[]) => number;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const [, startTransition] = useTransition();

  const params = useMemo(() => {
    const obj: Record<string, string> = {};
    for (const [k, v] of search.entries()) obj[k] = v;
    return obj;
  }, [search]);
  const urlSpec: TeamFilterSpec = useMemo(() => parseSpec(params), [params]);

  const [rows, setRows] = useState<DraftRow[]>(() => rowsFromSpec(urlSpec.cols, urlSpec.filters));
  /** Pinned columns, ordered as picked so the table renders them that way. */
  const [pins, setPins] = useState<string[]>(() => urlSpec.cols);
  /** The row that just appeared, so exactly one input claims the caret. */
  const [freshId, setFreshId] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** The columns picker has its own open state — only the filter one is
   *  reopened by Enter in a value box. */
  const [colsPickerOpen, setColsPickerOpen] = useState(false);
  /** The last query this component pushed, so the resync can ignore it. */
  const selfPublished = useRef<string | null>(null);

  // Resync the draft when the committed URL changes underneath us — a back
  // button, or the toolbar chip strip dropping a stat. Keyed on `search` rather
  // than urlSpec so it fires once per navigation, not once per re-parse.
  useEffect(() => {
     
    // OUR OWN ECHO IS NOT AN OUTSIDE CHANGE. In the live view every Enter
    // publishes, and rebuilding from that would hand every row a new id —
    // remounting the input the reader is typing in and throwing away the
    // caret. A URL we did not write still rebuilds, which is what makes the
    // back button and a pasted link work.
    if (selfPublished.current !== null && selfPublished.current === search.toString()) {
      selfPublished.current = null;
      return;
    }
    setRows(rowsFromSpec(urlSpec.cols, urlSpec.filters));
    setPins(urlSpec.cols);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  /**
   * submit() reads the CURRENT draft and is declared below, so the callbacks
   * above reach it through a ref rather than by being redefined on every
   * keystroke — which would remount the row they were handed to.
   */
  /**
   * A request to push the draft to the URL, honoured AFTER the state lands.
   *
   * THIS EXISTS BECAUSE THE OBVIOUS VERSION IS WRONG, and wrong in a way that
   * looks like nothing happening. Calling submit() from inside the handler
   * that just called setRows publishes the state from BEFORE that update —
   * React has not committed it yet. The stale spec goes to the URL, the resync
   * effect reads it back, and the rows that were just added are wiped. Ticking
   * four stats and pressing Enter left the table exactly as it was.
   *
   * Bumping a counter and submitting from an effect keyed on it means the push
   * happens on the next commit, when draftFilters and pins are the new ones.
   */
  const [applyRequest, setApplyRequest] = useState(0);
  const requestApply = useCallback(() => setApplyRequest((n) => n + 1), []);

  /**
   * Add every stat the picker committed, in the order it was ticked.
   *
   * VALUES START BLANK, and that is the whole reason this can add four at
   * once: rowsToFilters drops a row with no value, so a blank row pins its
   * column and bounds nothing. Ticking four stats gives you four columns to
   * look at; typing into them is a separate decision, made one at a time.
   *
   * The caret lands in the FIRST new row. Some row has to have it, and the
   * first is the one the reader was thinking about first.
   */
  const addRows = useCallback((stats: TeamStatKey[], focusFirst: boolean) => {
    if (!stats.length) return;
    // Ids are allocated HERE, not inside the updater. React runs an updater
    // when it is ready, so a value assigned inside one is still null on the
    // next line — which is why the caret never landed in the new row's value
    // box. Any id the cap discards is simply never used.
    const entries = stats.map((stat) => ({
      id: nextRowId++, stat, op: "gte" as Comparator, value: "",
    }));
    setRows((r) => {
      const room = MAX_FILTERS - r.length;
      return room <= 0 ? r : [...r, ...entries.slice(0, room)];
    });
    // Filtering on a stat auto-pins it as a column. Filtering on something you
    // then cannot see in the table is the worst version of this panel — you get
    // a list of teams and no way to check why they qualified.
    setPins((p) => [...p, ...stats.filter((k) => !p.includes(k))]);
    // Only the single-pick door moves the caret. Adding six columns and being
    // dropped into the first one's value box would be the app deciding which
    // of the six you meant.
    setFreshId(focusFirst ? entries[0]!.id : null);
    // In the live view the table follows immediately — four ticks, four
    // columns, no Submit.
    requestApply();
  }, [requestApply]);

  /** The single-pick door: one stat, and the caret lands in its value box. */
  const addFilter = useCallback((stat: TeamStatKey) => addRows([stat], true), [addRows]);

  /**
   * The batch door: `next` is the FULL set of columns that should be on the
   * table, so this both adds and removes.
   *
   * Unticking a stat that carries a bound takes the bound with it. The
   * alternative — keeping a filter on a column nobody can see — is the exact
   * situation the auto-pin rule exists to prevent.
   */
  const setColumns = useCallback((next: TeamStatKey[]) => {
    const keep = new Set<string>(next);
    setRows((r) => {
      const kept = r.filter((x) => keep.has(x.stat as string));
      const have = new Set(kept.map((x) => x.stat as string));
      const added = next
        .filter((k) => !have.has(k))
        .slice(0, Math.max(0, MAX_FILTERS - kept.length))
        .map((stat) => ({ id: nextRowId++, stat, op: "gte" as Comparator, value: "" }));
      return [...kept, ...added];
    });
    setPins(next.slice(0, MAX_FILTERS));
    setFreshId(null);
    requestApply();
  }, [requestApply]);

  /**
   * ENTER APPLIES, in Build My Own Table only.
   *
   * Submit exists because a half-typed value is not a query: applying on every
   * keystroke would filter Pace at "7" on the way to "70". Enter is different
   * — it is a deliberate "I am done with this value", exactly as complete a
   * thought as clicking the button, and it already means "commit this row and
   * give me the next one". Applying the table too is the same gesture finishing
   * its sentence.
   *
   * SCOPED TO THE ONE VIEW ON PURPOSE, and this is the part worth arguing
   * about. The same key doing different things in different views is a real
   * cost. It is paid here because the modes genuinely differ: the curated
   * views are "set up a query, then run it", while this one is "add a column,
   * look, add another" — and in that loop a Submit press between every step is
   * the thing standing between the reader and the answer.
   */
  const applyOnEnter = viewByKey(urlSpec.view).custom === true;

  const nextFilter = useCallback(() => {
    requestApply();
    setRows((r) => { if (r.length < MAX_FILTERS) setPickerOpen(true); return r; });
  }, [requestApply]);

  const patchRow = useCallback((id: number, patch: Partial<DraftRow>) => {
    setRows((r) => r.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    setFreshId(null);
  }, []);

  const removeRow = useCallback((id: number) => {
    // In the live view, removing applies as well. Enter changing the table
    // while the bin quietly does not would teach the reader that the table is
    // sometimes stale and give them no way to know when.
    requestApply();
    setRows((r) => {
      const gone = r.find((x) => x.id === id);
      const next = r.filter((x) => x.id !== id);
      // Unpin only when the stat has no other row left. A band expressed as two
      // rows must not lose its column when one half is deleted.
      if (gone && !next.some((x) => x.stat === gone.stat)) {
        setPins((p) => p.filter((k) => k !== gone.stat));
      }
      return next;
    });
  }, [requestApply]);

  const draftFilters = useMemo(() => rowsToFilters(rows), [rows]);

  const samePins =
    pins.length === urlSpec.cols.length && pins.every((k, i) => k === urlSpec.cols[i]);
  // Submit enables on EITHER change — pinning a column with no bound set is a
  // legitimate submit, and gating on filters alone left the button dead.
  const dirty = !sameFilterSet(draftFilters, urlSpec.filters) || !samePins;

  // The match total is computed inline on every change so it tracks the typing
  // rather than trailing it. Affordable because processTeams reuses a cached,
  // fully-shaped cohort: measured at 5.4ms over the widest selection (all 13
  // seasons, 6,689 team-seasons) against a 16.7ms frame.
  const matches = useMemo(
    () => (previewCount ? previewCount(draftFilters) : null),
    [previewCount, draftFilters],
  );

  const atCap = rows.length >= MAX_FILTERS;

  const submit = () => {
    const p = specToParams({ ...urlSpec, filters: draftFilters, cols: pins as TeamStatKey[] }).toString();
    // Remember what we published so the resync below can tell our own echo
    // from a real outside change.
    selfPublished.current = p;
    startTransition(() => router.replace(p ? `/?${p}` : "/", { scroll: false }));
  };

  /**
   * Honour an apply request, once the state it should publish has committed.
   *
   * Gated here rather than at each call site so the curated views can request
   * freely and simply be ignored — one place decides whether this view applies
   * without a Submit, and it is the same boolean the button's own label reads.
   */
  useEffect(() => {
    if (applyRequest === 0 || !applyOnEnter) return;
    submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyRequest]);


  const revert = () => {
    setRows(rowsFromSpec(urlSpec.cols, urlSpec.filters));
    setPins(urlSpec.cols);
    setFreshId(null);
  };

  return (
    // Its own row directly under the search row, inside the same card and
    // carrying the same divider so the toolbar reads as one stacked group.
    // WRAPS rather than scrolls: eight filters will not fit on one line at any
    // width, and a horizontally scrolling strip of form controls hides the ones
    // you cannot see with nothing to say they are there.
    <div className="px-3 lg:px-4 py-2.5 border-b border-hairline bg-paper-deep/30 flex items-center flex-wrap gap-x-3 gap-y-2">
      {rows.map((r) => (
        <FilterRow
          key={r.id}
          row={r}
          autoFocus={r.id === freshId}
          onChange={patchRow}
          onRemove={removeRow}
          onNext={nextFilter}
        />
      ))}

      <StatPicker
        mode="filter"
        onPick={addFilter}
        onSetColumns={setColumns}
        current={pins}
        remaining={MAX_FILTERS - rows.length}
        disabled={atCap}
        open={pickerOpen}
        setOpen={setPickerOpen}
      />
      {/* The batch door, beside the single one. Both land in the same list —
          see the note on StatPicker — so this is two ways in, not two
          systems. */}
      <StatPicker
        mode="columns"
        onPick={addFilter}
        onSetColumns={setColumns}
        current={pins}
        remaining={MAX_FILTERS}
        open={colsPickerOpen}
        setOpen={setColsPickerOpen}
      />

      {atCap && (
        <span className="text-xs text-ink-muted">
          {MAX_FILTERS} is the maximum a shareable URL carries.
        </span>
      )}

      {/* Actions appear only once there is something to apply. An always-on
          Submit next to an unchanged table is a button that does nothing, and
          the live count beside it would read as a filtered total when nothing
          is filtered. */}
      {dirty && (
        <div className="ml-auto flex items-center gap-2">
          {matches !== null && (
            <span className="text-sm text-ink-soft leading-none whitespace-nowrap">
              <span className="font-bold text-ink tabular">{matches.toLocaleString()}</span>
              <span className="ml-1 text-xs text-ink-muted">{matches === 1 ? "team" : "teams"}</span>
            </span>
          )}
          <button
            type="button"
            onClick={revert}
            className="h-8 px-2.5 text-sm text-ink-muted hover:text-ink transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            className="h-8 text-sm font-semibold bg-coral text-white px-5 rounded-md hover:bg-coral-soft transition-colors"
          >
            Submit
          </button>
        </div>
      )}
    </div>
  );
}
