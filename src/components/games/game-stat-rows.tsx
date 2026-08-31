"use client";

/**
 * The game log explorers' filter rows and the two doors above them.
 *
 * ONE COMPONENT FOR BOTH GAME LOGS, and deliberately the SAME MODEL as the
 * team explorer and the players table rather than a third idea of what
 * filtering means. Those two already agreed: a stat, a comparator and a typed
 * value sitting in the open, added through "Add a Filter" (one stat, caret
 * follows) or "Add Columns" (tick a batch). The game logs had a fourth shape —
 * a stat dropdown, an operator dropdown, a value box and a row of read-only
 * chips — which meant the same question was asked four different ways on four
 * tables. This replaces it.
 *
 * BOUNDING A STAT PINS IT AS A COLUMN, same rule as everywhere else: a
 * filtered table whose reader cannot see the column that qualified a row is a
 * table that cannot be checked. A blank row is the column plus somewhere to
 * type.
 *
 * What differs from PlayerStatRows is only what it is over — the two game
 * catalogues have their own keys, labels and percentage rules — so those come
 * in as props and everything about how a row behaves lives here.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { FilterRow, type DraftRow, type RowComparator } from "@/components/filters/filter-row";
import { StatPicker, type PickOption } from "@/components/filters/stat-picker";

/**
 * Pinned-column ceiling — a URL-length limit rather than a plan one, so it
 * applies to everybody. Twelve is past what fits on a laptop screen beside a
 * view's own columns, which is the point at which pinning more stops helping.
 */
export const MAX_GAME_COLS = 12;

let nextRowId = 1;

/** A filter as the game indexes store it. Both `*Op` types are these four. */
export type GameRowFilter = { stat: string; op: RowComparator; value: number };

/** Rows → URL filters. A row with no value is a pinned column, not a filter. */
function filtersFromRows(rows: readonly DraftRow[], isPct: (k: string) => boolean): GameRowFilter[] {
  const out: GameRowFilter[] = [];
  for (const r of rows) {
    const raw = r.value.trim();
    if (raw === "") continue;
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    out.push({ stat: r.stat, op: r.op, value: isPct(r.stat) ? n / 100 : n });
  }
  return out;
}

/**
 * The URL → editable rows.
 *
 * Reads BOTH halves: a row with no value typed into it is not a filter, it is
 * a pinned column, and rebuilding from `filters` alone makes blank rows
 * evaporate every time the URL comes back round while their columns stay. The
 * invariant is that every pinned column has at least one row and every row
 * names a pinned column; column order leads, because that is the order the
 * table shows.
 */
function rowsFromSpec(
  cols: readonly string[],
  filters: readonly GameRowFilter[],
  isPct: (k: string) => boolean,
): DraftRow[] {
  const out: DraftRow[] = [];
  const rowFor = (f: GameRowFilter): DraftRow => ({
    id: nextRowId++,
    stat: f.stat,
    op: f.op,
    value: isPct(f.stat) ? String(Math.round(f.value * 1000) / 10) : String(f.value),
  });
  for (const key of cols) {
    const own = filters.filter((f) => f.stat === key);
    if (own.length) out.push(...own.map(rowFor));
    else out.push({ id: nextRowId++, stat: key, op: "gte", value: "" });
  }
  // A bound on something not pinned should not happen — narrowing pins — but a
  // shortcut or an old link can carry one, and dropping it silently would
  // filter the table by something with no row and no column to explain it.
  for (const f of filters) if (!cols.includes(f.stat)) out.push(rowFor(f));
  return out;
}

export function GameStatRows({
  cols,
  filters,
  options,
  groupLabel,
  idPrefix,
  labelOf,
  isPct,
  onChange,
  trailing,
}: {
  cols: readonly string[];
  filters: readonly GameRowFilter[];
  /** The catalogue, already in section order. */
  options: PickOption[];
  groupLabel: Record<string, string>;
  /** Unique per page — two pickers on one page cannot share a listbox id. */
  idPrefix: string;
  labelOf: (key: string) => string;
  /** Stored as a fraction, typed as a whole percent. */
  isPct: (key: string) => boolean;
  onChange: (next: { cols: string[]; filters: GameRowFilter[] }) => void;
  /** The page's own controls for the right-hand end of the bar. */
  trailing?: ReactNode;
}) {
  const [rows, setRows] = useState<DraftRow[]>(() => rowsFromSpec(cols, filters, isPct));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [colsPickerOpen, setColsPickerOpen] = useState(false);
  /** The row that just appeared, so its value box takes the caret. */
  const [freshId, setFreshId] = useState<number | null>(null);

  /**
   * RESYNC FROM THE URL, but only when the URL says something these rows did
   * not. Every commit writes the URL, which comes straight back here; a naive
   * resync would rebuild the rows mid-keystroke and take the caret with them.
   * The echo is recognised by comparing what the URL now holds against what
   * these rows last produced.
   *
   * This is also what makes the shortcut buttons work: they write filters the
   * rows did not, so the incoming string differs and the rows rebuild — which
   * is how a shortcut arrives as editable rows rather than as something the
   * builder cannot see.
   */
  const lastCommitted = useRef<string>("");
  useEffect(() => {
    const incoming = JSON.stringify([cols, filters]);
    if (incoming === lastCommitted.current) return;
    lastCommitted.current = incoming;
    setRows(rowsFromSpec(cols, filters, isPct));
    // isPct is a stable module-level lookup on both callers; including it here
    // would re-run this on every render of an inline arrow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cols, filters]);

  /**
   * COLUMNS ARE DERIVED FROM THE ROWS, not passed in beside them — two ideas
   * of the next column set is how a second removal re-commits what the first
   * just took away.
   *
   * And COMMIT OUTSIDE THE STATE UPDATER, always: a router write inside a
   * setState callback is a side effect React is free to run during a render
   * pass, where it is either lost or fired twice.
   */
  const commit = useCallback((next: DraftRow[]) => {
    const nextCols = [...new Set(next.map((r) => r.stat))].slice(0, MAX_GAME_COLS);
    const nextFilters = filtersFromRows(next, isPct);
    lastCommitted.current = JSON.stringify([nextCols, nextFilters]);
    onChange({ cols: nextCols, filters: nextFilters });
  }, [onChange, isPct]);

  /** One stat from the single-pick door: a row, and the caret in its box. */
  const addFilter = useCallback((stat: string) => {
    if (rows.length >= MAX_GAME_COLS) return;
    const row: DraftRow = { id: nextRowId++, stat, op: "gte", value: "" };
    const next = [...rows, row];
    setRows(next);
    setFreshId(row.id);
    commit(next);
  }, [rows, commit]);

  /**
   * The batch door hands back the FULL set of columns, so this adds and
   * removes. Every ticked stat gets a row, blank — a column with no way to
   * bound it is the columns door appearing to do half its job.
   */
  const setColumns = useCallback((next: string[]) => {
    const keep = new Set(next);
    const kept = rows.filter((x) => keep.has(x.stat));
    const have = new Set(kept.map((x) => x.stat));
    const added: DraftRow[] = next
      .filter((k) => !have.has(k))
      .slice(0, Math.max(0, MAX_GAME_COLS - kept.length))
      .map((stat) => ({ id: nextRowId++, stat, op: "gte" as RowComparator, value: "" }));
    const nextRows = [...kept, ...added];
    setRows(nextRows);
    setFreshId(null);
    commit(nextRows);
  }, [rows, commit]);

  const patchRow = useCallback((id: number, patch: Partial<DraftRow>) => {
    const next = rows.map((x) => (x.id === id ? { ...x, ...patch } : x));
    setRows(next);
    setFreshId(null);
    commit(next);
  }, [rows, commit]);

  const removeRow = useCallback((id: number) => {
    const next = rows.filter((x) => x.id !== id);
    setRows(next);
    setFreshId(null);
    commit(next);
  }, [rows, commit]);

  /** Enter in a value box: that row is done, offer the next one. */
  const nextFilter = useCallback(() => {
    if (rows.length < MAX_GAME_COLS) setPickerOpen(true);
  }, [rows.length]);

  const atCap = rows.length >= MAX_GAME_COLS;

  return (
    <div className="px-3 lg:px-4 py-2.5 border-b border-hairline flex items-center flex-wrap gap-x-3 gap-y-2">
      {rows.map((r) => (
        <FilterRow
          key={r.id}
          row={r}
          label={labelOf(r.stat)}
          pct={isPct(r.stat)}
          autoFocus={r.id === freshId}
          onChange={patchRow}
          onRemove={removeRow}
          onNext={nextFilter}
        />
      ))}

      <StatPicker
        mode="filter"
        options={options}
        groupLabel={groupLabel}
        listId={`${idPrefix}-filters-picker`}
        alwaysFree
        onPick={addFilter}
        onSetColumns={setColumns}
        current={cols}
        remaining={MAX_GAME_COLS - rows.length}
        disabled={atCap}
        open={pickerOpen}
        setOpen={setPickerOpen}
      />
      {/* The batch door, beside the single one. Both land in the same list. */}
      <StatPicker
        mode="columns"
        options={options}
        groupLabel={groupLabel}
        listId={`${idPrefix}-columns-picker`}
        alwaysFree
        onPick={addFilter}
        onSetColumns={setColumns}
        current={cols}
        remaining={MAX_GAME_COLS}
        open={colsPickerOpen}
        setOpen={setColsPickerOpen}
      />

      {rows.length > 1 && (
        <button
          type="button"
          onClick={() => { setRows([]); setFreshId(null); commit([]); }}
          className="text-xs text-ink-muted hover:text-coral underline underline-offset-2 transition-colors"
        >
          clear all
        </button>
      )}

      {atCap && (
        <span className="text-xs text-ink-muted">
          {MAX_GAME_COLS} is the most the address bar can carry. Remove one to add another.
        </span>
      )}

      {trailing && <div className="ml-auto flex items-center gap-2">{trailing}</div>}
    </div>
  );
}
