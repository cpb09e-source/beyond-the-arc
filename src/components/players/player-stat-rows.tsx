"use client";

/**
 * The players table's filter rows and the two doors above them.
 *
 * REPLACES THE SLIDER DRAWER. That drawer was the only way to filter this page:
 * a full-screen sheet of range sliders behind one "Filters" button, with its own
 * draft state and its own Submit. It worked, and it was a second idea of what
 * filtering means on a site that already had one — the team explorer's rows,
 * where a stat, a comparator and a typed value sit in the open and the picker
 * that adds them is two clicks away.
 *
 * So this is the team explorer's model, over player stats, on the shared
 * components: src/components/filters/stat-picker.tsx for the doors and
 * src/components/filters/filter-row.tsx for a row.
 *
 * BOUNDING A STAT PINS IT AS A COLUMN, same rule as the team side. A filtered
 * table whose reader cannot see the column that qualified a row is a table that
 * cannot be checked.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { FilterRow, type DraftRow, type RowComparator } from "@/components/filters/filter-row";
import { StatPicker } from "@/components/filters/stat-picker";
import { playerStatBounds } from "@/lib/player-stat-bounds";
import { playerStatColumn, type PlayerListSpec, type PlayerStatFilter } from "@/lib/players";
import { PACK_STAT_BY_KEY } from "@/lib/player-stat-pack";
import { PLAYER_PICK_OPTIONS, PLAYER_PICK_GROUP_LABEL } from "@/components/players/player-filter-bar";

/**
 * Pinned-column ceiling. A URL-length limit rather than a plan one — the same
 * reason the team explorer caps its own — so it applies to everybody.
 */
export const MAX_PLAYER_COLS = 25;

let nextRowId = 1;

/** Stored as a fraction, typed as a percentage. */
function isPctStat(key: string): boolean {
  const fmt = playerStatColumn(key)?.format ?? PACK_STAT_BY_KEY.get(key)?.format;
  return fmt === "pct1";
}

function labelOf(key: string): string {
  return playerStatColumn(key)?.label ?? PACK_STAT_BY_KEY.get(key)?.label ?? key;
}

/** URL filters → editable rows, in the order the URL holds them. */
function rowsFromFilters(filters: readonly PlayerStatFilter[]): DraftRow[] {
  return filters.map((f) => ({
    id: nextRowId++,
    stat: f.stat,
    op: f.op,
    // Percentages are stored as fractions and typed as whole percent.
    value: isPctStat(f.stat) ? String(Math.round(f.value * 1000) / 10) : String(f.value),
  }));
}

/** Rows → URL filters. A row with no value is a pinned column, not a filter. */
function filtersFromRows(rows: readonly DraftRow[]): PlayerStatFilter[] {
  const out: PlayerStatFilter[] = [];
  for (const r of rows) {
    const raw = r.value.trim();
    if (raw === "") continue;
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    out.push({ stat: r.stat, op: r.op, value: isPctStat(r.stat) ? n / 100 : n });
  }
  return out;
}

export function PlayerStatRows({
  spec,
  onChange,
}: {
  spec: PlayerListSpec;
  onChange: (next: PlayerListSpec) => void;
}) {
  const [rows, setRows] = useState<DraftRow[]>(() => rowsFromFilters(spec.filters));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [colsPickerOpen, setColsPickerOpen] = useState(false);
  /** The row that just appeared, so its value box takes the caret. */
  const [freshId, setFreshId] = useState<number | null>(null);

  /**
   * RESYNC FROM THE URL, but only when the URL says something these rows did
   * not. Every commit below writes the URL, which comes straight back here; a
   * naive resync would rebuild the rows mid-keystroke and take the caret with
   * them. The echo is recognised by comparing what the URL now holds against
   * what these rows would produce.
   */
  const lastCommitted = useRef<string>("");
  useEffect(() => {
    const incoming = JSON.stringify(spec.filters);
    if (incoming === lastCommitted.current) return;
    lastCommitted.current = incoming;
    setRows(rowsFromFilters(spec.filters));
  }, [spec.filters]);

  const commit = useCallback((next: DraftRow[], cols: string[]) => {
    const filters = filtersFromRows(next);
    lastCommitted.current = JSON.stringify(filters);
    onChange({ ...spec, filters, cols });
  }, [onChange, spec]);

  /**
   * COMMIT OUTSIDE THE STATE UPDATER, always.
   *
   * These handlers used to compute the next rows inside a setRows(prev => …)
   * callback and call commit() from in there. That is a side effect in a state
   * updater: React is free to run the updater during a render pass, and the
   * router update either got lost or fired twice. The visible symptom was the
   * columns door doing nothing at all — you could tick stats, close the
   * popover, and the table never changed.
   *
   * So every handler derives the next rows from `rows` directly, then sets
   * state and commits as two ordinary statements.
   */

  /** One stat from the single-pick door: a row, and the caret in its box. */
  const addFilter = useCallback((stat: string) => {
    if (rows.length >= MAX_PLAYER_COLS) return;
    const row: DraftRow = { id: nextRowId++, stat, op: "gte", value: "" };
    const next = [...rows, row];
    setRows(next);
    setFreshId(row.id);
    // Pin it now — the column should appear the moment the row does, not only
    // once a value has been typed into it.
    commit(next, spec.cols.includes(stat) ? spec.cols : [...spec.cols, stat]);
  }, [rows, commit, spec.cols]);

  /**
   * The batch door hands back the FULL set of columns, so this adds and
   * removes. Unticking a stat takes its bound with it: a filter on a column
   * nobody can see is the situation the auto-pin rule exists to prevent.
   */
  const setColumns = useCallback((next: string[]) => {
    const keep = new Set(next);
    const kept = rows.filter((x) => keep.has(x.stat));
    setRows(kept);
    setFreshId(null);
    commit(kept, next.slice(0, MAX_PLAYER_COLS));
  }, [rows, commit]);

  const patchRow = useCallback((id: number, patch: Partial<DraftRow>) => {
    const next = rows.map((x) => (x.id === id ? { ...x, ...patch } : x));
    setRows(next);
    setFreshId(null);
    commit(next, spec.cols);
  }, [rows, commit, spec.cols]);

  const removeRow = useCallback((id: number) => {
    const gone = rows.find((x) => x.id === id);
    const next = rows.filter((x) => x.id !== id);
    setRows(next);
    // Unpin only when no other row still names the stat — a band written as
    // two rows must not lose its column when one half goes.
    const cols = gone && !next.some((x) => x.stat === gone.stat)
      ? spec.cols.filter((k) => k !== gone.stat)
      : spec.cols;
    commit(next, cols);
  }, [rows, commit, spec.cols]);

  /** Enter in a value box: that row is done, offer the next one. */
  const nextFilter = useCallback(() => {
    if (rows.length < MAX_PLAYER_COLS) setPickerOpen(true);
  }, [rows.length]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {rows.map((r) => (
        <FilterRow
          key={r.id}
          row={r}
          label={labelOf(r.stat)}
          bounds={playerStatBounds(r.stat)}
          pct={isPctStat(r.stat)}
          autoFocus={r.id === freshId}
          onChange={patchRow}
          onRemove={removeRow}
          onNext={nextFilter}
        />
      ))}

      <StatPicker
        mode="filter"
        options={PLAYER_PICK_OPTIONS}
        groupLabel={PLAYER_PICK_GROUP_LABEL}
        listId="player-filters-picker"
        alwaysFree
        onPick={(key) => addFilter(key)}
        onSetColumns={setColumns}
        current={spec.cols}
        remaining={MAX_PLAYER_COLS - rows.length}
        disabled={rows.length >= MAX_PLAYER_COLS}
        open={pickerOpen}
        setOpen={setPickerOpen}
      />
      <StatPicker
        mode="columns"
        options={PLAYER_PICK_OPTIONS}
        groupLabel={PLAYER_PICK_GROUP_LABEL}
        listId="player-columns-picker"
        alwaysFree
        onPick={(key) => addFilter(key)}
        onSetColumns={setColumns}
        current={spec.cols}
        remaining={MAX_PLAYER_COLS}
        open={colsPickerOpen}
        setOpen={setColsPickerOpen}
      />

      {rows.length >= MAX_PLAYER_COLS && (
        <span className="text-xs text-ink-muted">
          {MAX_PLAYER_COLS} is the most the address bar can carry. Remove one to add another.
        </span>
      )}
    </div>
  );
}

/** Re-exported so the comparator type has one home. */
export type { RowComparator };
