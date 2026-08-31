"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { roundNice } from "@/components/filters/range-row";
import {
  FILTER_COLUMNS, GROUP_LABEL, MAX_FILTERS, parseSpec, specToParams, teamStatColumn,
  type Comparator, type StatFilter, type StatGroup, type TeamFilterSpec, type TeamStatKey,
} from "@/lib/team-filters";
import { viewByKey } from "@/lib/team-views";
import { clampToFreeTier, FREE_LIMITS } from "@/lib/access";
import { useEntitlement } from "@/lib/use-entitlement";
import { StatPicker, type PickOption } from "@/components/filters/stat-picker";
import { FilterRow } from "@/components/filters/filter-row";

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

const PICKER_LIST_ID = "team-filters-picker";

// ---------------------------------------------------------------------------
// Stat picker
// ---------------------------------------------------------------------------

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
// StatPicker moved to src/components/filters/stat-picker.tsx when the players
// table needed the same two doors. It is the same component, unchanged in
// behaviour; only the option list and its section headings are now passed in.

// ---------------------------------------------------------------------------
// One filter row
// ---------------------------------------------------------------------------

// FilterRow moved to src/components/filters/filter-row.tsx alongside the
// picker. Same row; the label, the measured bounds and the is-a-percentage
// flag are passed in rather than looked up from the team catalogue.

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
  const { paid, signedIn } = useEntitlement();

  /**
   * TWO CEILINGS, NOT ONE, and the gap between them is deliberate — see
   * FREE_LIMITS in src/lib/access.ts.
   *
   * `colCap` is how many stats can be on the table. `boundCap` is how many of
   * those may carry a value. A free reader gets three columns to LOOK at and
   * two to FILTER on, because looking is the demo and filtering is the tool.
   *
   * MAX_FILTERS is the ceiling for everybody: it is a URL-length limit, not a
   * plan lever, and a subscriber runs into it for the same reason a free
   * reader would if they got that far.
   */
  const colCap = paid ? MAX_FILTERS : Math.min(FREE_LIMITS.statCols, MAX_FILTERS);
  const boundCap = paid ? MAX_FILTERS : Math.min(FREE_LIMITS.boundedStatCols, MAX_FILTERS);

  const params = useMemo(() => {
    const obj: Record<string, string> = {};
    for (const [k, v] of search.entries()) obj[k] = v;
    return obj;
  }, [search]);
  const urlSpec: TeamFilterSpec = useMemo(() => parseSpec(params), [params]);
  /**
   * The query as this reader is allowed to run it.
   *
   * The BUILDER has to read the clamped version, not the raw URL, or a link
   * carrying five columns would draw five rows of controls above a table
   * showing three — and the reader would have no way to tell which two were
   * doing nothing. Same function the table uses, so the two cannot disagree.
   *
   * `urlSpec` is still what submit() writes from, so nothing the reader has
   * not touched gets quietly rewritten out of their URL.
   */
  const readSpec = useMemo(() => clampToFreeTier(urlSpec, paid), [urlSpec, paid]);

  const [rows, setRows] = useState<DraftRow[]>(() => rowsFromSpec(readSpec.cols, readSpec.filters));
  /** Pinned columns, ordered as picked so the table renders them that way. */
  const [pins, setPins] = useState<string[]>(() => readSpec.cols);
  /** The row that just appeared, so exactly one input claims the caret. */
  const [freshId, setFreshId] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** The columns picker has its own open state — only the filter one is
   *  reopened by Enter in a value box. */
  const [colsPickerOpen, setColsPickerOpen] = useState(false);
  /** The last query this component pushed, so the resync can ignore it. */
  const selfPublished = useRef<string | null>(null);
  /** What membership the current draft was built for — see the resync below. */
  const lastPaid = useRef(paid);

  // Resync the draft when the committed URL changes underneath us — a back
  // button, or the toolbar chip strip dropping a stat. Keyed on `search` rather
  // than urlSpec so it fires once per navigation, not once per re-parse.
  useEffect(() => {
     
    // OUR OWN ECHO IS NOT AN OUTSIDE CHANGE. In the live view every Enter
    // publishes, and rebuilding from that would hand every row a new id —
    // remounting the input the reader is typing in and throwing away the
    // caret. A URL we did not write still rebuilds, which is what makes the
    // back button and a pasted link work.
    //
    // MEMBERSHIP RESOLVING COUNTS AS AN OUTSIDE CHANGE. useEntitlement is
    // optimistic while the profile is in flight, so the rows seeded on first
    // render came from the UNCLAMPED query — five controls over a
    // three-column table until something else happened to re-seed them. When
    // the answer lands, re-read; and skip the echo guard on that pass, or a
    // reader who submitted inside that first second keeps the wide draft.
    const paidChanged = lastPaid.current !== paid;
    lastPaid.current = paid;
    if (!paidChanged && selfPublished.current !== null && selfPublished.current === search.toString()) {
      selfPublished.current = null;
      return;
    }
    setRows(rowsFromSpec(readSpec.cols, readSpec.filters));
    setPins(readSpec.cols);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, paid]);

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
      const room = colCap - r.length;
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
  }, [requestApply, colCap]);

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
        .slice(0, Math.max(0, colCap - kept.length))
        .map((stat) => ({ id: nextRowId++, stat, op: "gte" as Comparator, value: "" }));
      return [...kept, ...added];
    });
    setPins(next.slice(0, colCap));
    setFreshId(null);
    requestApply();
  }, [requestApply, colCap]);

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
    setRows((r) => { if (r.length < colCap) setPickerOpen(true); return r; });
  }, [requestApply, colCap]);

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
    pins.length === readSpec.cols.length && pins.every((k, i) => k === readSpec.cols[i]);
  // Submit enables on EITHER change — pinning a column with no bound set is a
  // legitimate submit, and gating on filters alone left the button dead.
  const dirty = !sameFilterSet(draftFilters, readSpec.filters) || !samePins;

  // The match total is computed inline on every change so it tracks the typing
  // rather than trailing it. Affordable because processTeams reuses a cached,
  // fully-shaped cohort: measured at 5.4ms over the widest selection (all 13
  // seasons, 6,689 team-seasons) against a 16.7ms frame.
  const matches = useMemo(
    () => (previewCount ? previewCount(draftFilters) : null),
    [previewCount, draftFilters],
  );

  const atCap = rows.length >= colCap;
  /**
   * How many rows carry a bound right now, and therefore whether the next one
   * may.
   *
   * Counted off the DRAFT rather than the URL so the box locks the moment the
   * second value is typed, not after a Submit. Clearing a value unlocks the
   * others again, which is what makes this a limit rather than a trap.
   */
  const boundedCount = rows.filter((r) => r.value.trim() !== "").length;
  const boundsLocked = boundedCount >= boundCap;

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
    setRows(rowsFromSpec(readSpec.cols, readSpec.filters));
    setPins(readSpec.cols);
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
          label={teamStatColumn(r.stat)?.label ?? r.stat}
          bounds={STAT_BOUNDS[r.stat]}
          pct={isPctStat(r.stat)}
          autoFocus={r.id === freshId}
          onChange={patchRow}
          onRemove={removeRow}
          onNext={nextFilter}
          // Only the rows that are still BLANK lock. A value already typed
          // keeps working — retracting a filter somebody set, because they
          // later added a column, would be the paywall reaching backwards.
          valueLocked={boundsLocked && r.value.trim() === ""}
        />
      ))}

      <StatPicker
        mode="filter"
        options={PICK_OPTIONS}
        groupLabel={GROUP_LABEL}
        listId={PICKER_LIST_ID}
        onPick={(k) => addFilter(k as TeamStatKey)}
        onSetColumns={(keys) => setColumns(keys as TeamStatKey[])}
        current={pins}
        remaining={colCap - rows.length}
        disabled={atCap}
        open={pickerOpen}
        setOpen={setPickerOpen}
      />
      {/* The batch door, beside the single one. Both land in the same list —
          see the note on StatPicker — so this is two ways in, not two
          systems. */}
      <StatPicker
        mode="columns"
        options={PICK_OPTIONS}
        groupLabel={GROUP_LABEL}
        listId={`${PICKER_LIST_ID}-cols`}
        onPick={(k) => addFilter(k as TeamStatKey)}
        onSetColumns={(keys) => setColumns(keys as TeamStatKey[])}
        current={pins}
        remaining={colCap}
        open={colsPickerOpen}
        setOpen={setColsPickerOpen}
      />

      {/* TWO DIFFERENT SENTENCES FOR TWO DIFFERENT LIMITS, and neither one is
          allowed to borrow the other’s wording. MAX_FILTERS is a fact about
          URLs and has nothing to sell; the free caps are a plan boundary and
          have to say so, with a way out. Writing one message for both would
          either dress a technical limit up as an upsell or make a paywall look
          like a bug. */}
      {atCap && paid && (
        <span className="text-xs text-ink-muted">
          {MAX_FILTERS} is the maximum a shareable URL carries.
        </span>
      )}
      {!paid && (atCap || boundsLocked) && (
        <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap">
          <Lock size={11} className="text-coral shrink-0" aria-hidden />
          <span className="text-ink-soft">
            {atCap
              ? `${colCap} columns on the free plan.`
              : `${boundCap} of them can carry a value.`}
          </span>
          <Link href={signedIn ? "/pricing" : "/account/signup"} className="text-coral hover:underline font-medium">
            {signedIn ? "See plans" : "Get more"}
          </Link>
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
