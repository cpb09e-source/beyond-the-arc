"use client";

/**
 * One condition on the Win Calculator — the same row the team explorer draws
 * under "Add a Filter", plus the one shape that explorer never needed.
 *
 * WHY A WRAPPER RATHER THAN FilterRow DIRECTLY. The calculator's stat list has
 * three yes/no flags (conference game, NCAA tournament…) that make no sense
 * with a comparator and a number box: "Conference Game ≥ 1" is a true
 * statement written by a machine. A flag gets its name and a Yes/No, and the
 * same bin; everything else is FilterRow, unchanged, so the row a reader
 * learned on the front page is the row they meet here.
 */
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Select } from "@/components/select";
import { FilterRow, type DraftRow, type RowComparator } from "@/components/filters/filter-row";
import { FLAG_KEYS } from "@/components/filters/condition-sheet";

/** A condition being edited. `value` is what was typed, in display units. */
export type ConditionRow = { id: number; stat: string; op: RowComparator | "eq"; value: string };

export function CalcConditionRow({
  row,
  label,
  bounds,
  pct,
  autoFocus,
  onChange,
  onRemove,
  onNext,
}: {
  row: ConditionRow;
  label: string;
  bounds?: [number, number];
  pct: boolean;
  autoFocus: boolean;
  onChange: (id: number, patch: Partial<ConditionRow>) => void;
  onRemove: (id: number) => void;
  /** Enter in the value box. */
  onNext: () => void;
}) {
  if (!FLAG_KEYS.has(row.stat)) {
    return (
      <FilterRow
        row={row as DraftRow}
        label={label}
        bounds={bounds}
        pct={pct}
        autoFocus={autoFocus}
        onChange={(id, patch) => onChange(id, patch as Partial<ConditionRow>)}
        onRemove={onRemove}
        onNext={onNext}
      />
    );
  }

  return (
    <div className="inline-flex items-center gap-1.5">
      <span className="h-8 px-2.5 inline-flex items-center rounded-md border border-hairline bg-paper-deep/60 text-sm font-medium text-ink whitespace-nowrap cursor-default">
        {label}
      </span>
      <Select
        value={row.value === "0" ? "0" : "1"}
        onChange={(v) => onChange(row.id, { op: "eq", value: v })}
        ariaLabel={`${label}: yes or no`}
        compact
        className="w-16 shrink-0"
      >
        <option value="1">Yes</option>
        <option value="0">No</option>
      </Select>
      {/* Same bin as FilterRow, for the same reasons it is a bin and not an ×. */}
      <button
        type="button"
        onClick={() => onRemove(row.id)}
        aria-label={`Delete ${label} condition`}
        title="Delete this condition"
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
