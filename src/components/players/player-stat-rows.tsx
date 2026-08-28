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

/**
 * The URL → editable rows.
 *
 * READS BOTH cols AND filters, and that is the whole fix for a bug worth
 * describing: rows were rebuilt from `filters` alone, but a row with no value
 * typed into it is not a filter — it is a pinned column. So every time the URL
 * came back round, blank rows evaporated while `cols` kept their columns. The
 * reader saw a column and a chip for a stat with no row to remove it from,
 * which is exactly what "I cleared them and one stayed" looks like.
 *
 * The invariant is now: every pinned column has at least one row, and every row
 * names a pinned column. Column order leads, because that is the order the
 * table shows.
 */
function rowsFromSpec(cols: readonly string[], filters: readonly PlayerStatFilter[]): DraftRow[] {
  const out: DraftRow[] = [];
  const rowFor = (f: PlayerStatFilter): DraftRow => ({
    id: nextRowId++,
    stat: f.stat,
    op: f.op,
    // Percentages are stored as fractions and typed as whole percent.
    value: isPctStat(f.stat) ? String(Math.round(f.value * 1000) / 10) : String(f.value),
  });
  for (const key of cols) {
    const own = filters.filter((f) => f.stat === key);
    if (own.length) out.push(...own.map(rowFor));
    // A pinned column nobody has bounded: a blank row, which is the column
    // plus somewhere to type.
    else out.push({ id: nextRowId++, stat: key, op: "gte", value: "" });
  }
  // A bound on something not pinned should not happen — narrowing pins — but an
  // old URL could carry one, and dropping it silently would filter the table by
  // something with no row and no column to explain it.
  for (const f of filters) if (!cols.includes(f.stat)) out.push(rowFor(f));
  return out;
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
  const [rows, setRows] = useState<DraftRow[]>(() => rowsFromSpec(spec.cols, spec.filters));
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
    // Watches BOTH halves, since a pinned column with no bound lives in `cols`
    // alone and would otherwise never trigger a resync.
    const incoming = JSON.stringify([spec.cols, spec.filters]);
    if (incoming === lastCommitted.current) return;
    lastCommitted.current = incoming;
    setRows(rowsFromSpec(spec.cols, spec.filters));
  }, [spec.cols, spec.filters]);

  /**
   * COLUMNS ARE DERIVED FROM THE ROWS, not passed in beside them.
   *
   * Every caller used to hand over its own idea of the next `cols`, computed
   * from `spec.cols` captured at render — so two removals in quick succession
   * had the second one re-committing a column the first had just taken away.
   * The rows already say which columns exist; reading the answer off them
   * makes the two impossible to disagree.
   */
  const commit = useCallback((next: DraftRow[]) => {
    const cols = [...new Set(next.map((r) => r.stat))].slice(0, MAX_PLAYER_COLS);
    const filters = filtersFromRows(next);
    lastCommitted.current = JSON.stringify([cols, filters]);
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
    // The column appears the moment the row does, not only once a value has
    // been typed — commit() reads the column set off the rows.
    commit(next);
  }, [rows, commit]);

  /**
   * The batch door hands back the FULL set of columns, so this adds and
   * removes. Unticking a stat takes its bound with it: a filter on a column
   * nobody can see is the situation the auto-pin rule exists to prevent.
   */
  const setColumns = useCallback((next: string[]) => {
    const keep = new Set(next);
    const kept = rows.filter((x) => keep.has(x.stat));
    // EVERY TICKED STAT GETS A ROW, blank. Keeping only the rows that already
    // existed made the columns door look like it did nothing: it added columns
    // to the table and left no way to bound them, so the gesture that was meant
    // to say "I want to work with these five stats" produced five columns and
    // no controls. A blank row IS the column plus somewhere to type.
    const have = new Set(kept.map((x) => x.stat));
    const added: DraftRow[] = next
      .filter((k) => !have.has(k))
      .slice(0, Math.max(0, MAX_PLAYER_COLS - kept.length))
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
    // The column goes with the last row that named it, and survives while any
    // other row still does — a band written as two rows must not lose its
    // column when one half is deleted. Both fall out of deriving cols from
    // rows, rather than needing a rule of their own.
    commit(next);
  }, [rows, commit]);

  /** Enter in a value box: that row is done, offer the next one. */
  const nextFilter = useCallback(() => {
    if (rows.length < MAX_PLAYER_COLS) setPickerOpen(true);
  }, [rows.length]);

  return (
    // Same row treatment as the team explorer's filter builder: its own band
    // under the search row, inside the same card, carrying the same divider so
    // the toolbar reads as one stacked group. WRAPS rather than scrolls —
    // eight filters will not fit on one line at any width, and a horizontally
    // scrolling strip of form controls hides the ones you cannot see.
    <div className="px-3 lg:px-4 py-2.5 border-b border-hairline bg-paper-deep/30 flex items-center flex-wrap gap-x-3 gap-y-2">
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
