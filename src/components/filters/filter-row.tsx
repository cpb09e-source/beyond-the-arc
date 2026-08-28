"use client";

/**
 * One filter row — stat name, comparator, value box, remove.
 *
 * EXTRACTED FROM THE TEAM EXPLORER when the players table needed the same
 * thing. The behaviour is unchanged; what moved out is the three facts the row
 * used to look up for itself from the team catalogue — the label, the measured
 * bounds, and whether the stat is typed as a percentage. Those come in as props
 * now, so a row over player stats is the same row.
 */
import { useEffect, useRef } from "react";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** The comparators a row can express. */
export type RowComparator = "gt" | "gte" | "lt" | "lte";

/** A row being edited. `stat` is a key in whichever catalogue the page uses. */
export type DraftRow = { id: number; stat: string; op: RowComparator; value: string };

/** The comparators offered, in the order they read. */
const OPS: Array<{ op: RowComparator; symbol: string }> = [
  { op: "gte", symbol: "≥" },
  { op: "gt", symbol: ">" },
  { op: "lte", symbol: "≤" },
  { op: "lt", symbol: "<" },
];

export function FilterRow({
  row,
  label,
  bounds,
  pct,
  autoFocus,
  onChange,
  onRemove,
  onNext,
  valueLocked = false,
}: {
  row: DraftRow;
  /** Display label for the stat, e.g. "eFG%". */
  label: string;
  /** Measured 1st-99th range in display units, or undefined where unknown. */
  bounds?: [number, number];
  /** Stored as a fraction, typed as a percentage. */
  pct: boolean;
  autoFocus: boolean;
  onChange: (id: number, patch: Partial<DraftRow>) => void;
  onRemove: (id: number) => void;
  /** Enter in the value box: this row is finished, open the picker again. */
  onNext: () => void;
  /**
   * The column stays, the bound does not — a free reader past
   * FREE_LIMITS.boundedStatCols.
   *
   * Locking the BOX rather than refusing the keystroke, because the two feel
   * completely different: a disabled field says "not for you yet", while a
   * field that accepts a digit and then discards it says the site is broken.
   */
  valueLocked?: boolean;
}) {
  const valueRef = useRef<HTMLInputElement>(null);

  /**
   * The range hint, and the type size that makes it FIT.
   *
   * The box is sized to the value people type — two or three digits — and the
   * hint is the longest thing that ever goes in it. A signed count range runs
   * to eleven characters ("-450 to 550"), which at the old fixed 0.68rem was
   * clipped mid-number: the reader saw "-20 to" and the upper bound — the half
   * that says what "high" looks like — was simply gone.
   *
   * SHRINK THE HINT, NOT THE BOX. Widening every value box to fit the worst
   * hint would undo the whole reason it is narrow, and the hint is read once
   * per stat while the box is looked at constantly. Padding gives way first,
   * then the type, and only for the strings that need it.
   *
   * Thresholds measured against the real bounds table, where the longest
   * placeholder is exactly eleven characters — see build-stat-bounds.mts,
   * which generates it. Re-run that and the worst case can move; the tiers
   * below are wide enough to absorb a character or two either way.
   */
  const hint = bounds
    // A NEGATIVE LOWER BOUND SPELLS THE WORD. "-25–30" reads as one mangled
    // number; "-25 to 30" cannot be misread, and is worth the extra characters.
    ? bounds[0] < 0 ? `${bounds[0]} to ${bounds[1]}` : `${bounds[0]}–${bounds[1]}`
    : "Value";
  /**
   * A PERCENTAGE COSTS THREE CHARACTERS BEFORE ITS HINT IS EVEN MEASURED.
   *
   * The "%" suffix is painted inside the box and the input reserves ~20px of
   * right padding for it — near a third of a 64px control. Tiering on string
   * length alone therefore called "-7 to 8" roomy, gave it the largest type,
   * and clipped it by 10px: seven characters, but only 36px to put them in.
   *
   * Charging pct stats three characters up front folds that back into one
   * number, so the tiers below compare like with like.
   */
  const hintLen = (valueLocked ? 4 : hint.length) + (pct ? 3 : 0);
  const roomy = hintLen <= 7;
  const tight = hintLen >= 10;

  // The row is created by picking a stat, so the only thing left to do is type
  // a number — land the caret there rather than making the reader aim for it.
  useEffect(() => {
    if (autoFocus) valueRef.current?.focus();
  }, [autoFocus]);

  return (
    <div className="inline-flex items-center gap-1.5">
      <span
        title={undefined}
        className="h-8 px-2.5 inline-flex items-center rounded-md border border-hairline bg-paper-deep/60 text-sm font-medium text-ink whitespace-nowrap cursor-default"
      >
        {label}
      </span>

      <select
        value={row.op}
        onChange={(e) => onChange(row.id, { op: e.target.value as RowComparator })}
        disabled={valueLocked}
        aria-label={`Comparison for ${label}`}
        className={cn(
          "h-8 w-14 shrink-0 px-1 rounded-md border border-ink/15 bg-card text-ink text-sm text-center focus:outline-none focus:ring-2 focus:ring-coral/40",
          valueLocked && "opacity-50",
        )}
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
          disabled={valueLocked}
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
          placeholder={valueLocked ? "Pass" : hint}
          title={
            valueLocked
              ? "Filtering on more columns is part of the Season Pass"
              : bounds ? `Typical range: ${hint}` : undefined
          }
          aria-label={`Value for ${label}`}
          className={cn(
            "h-8 w-full rounded-md border border-ink/15 bg-card text-ink text-sm tabular",
            "placeholder:text-ink-muted",
            "focus:outline-none focus:ring-2 focus:ring-coral/40 focus:border-coral/40",
            // Padding gives way before the type does — it costs the reader
            // nothing and buys 8px, which is two characters at this size.
            tight ? "px-1" : roomy ? "px-2" : "px-1.5",
            // 0.5rem, not 0.55: MEASURED, not guessed. The input carries
            // `tabular`, so the placeholder inherits fixed-width digits, and
            // "-450 to 550" renders 58.1px against 55px of room at 0.55rem —
            // clipped by three pixels, which is exactly the failure this is
            // fixing. Re-measure with getComputedStyle(el, "::placeholder")
            // if the bounds table or the box width ever changes.
            tight ? "placeholder:text-[0.5rem]" : roomy ? "placeholder:text-[0.68rem]" : "placeholder:text-[0.56rem]",
            // The % suffix sits inside the box, so it comes out of the same
            // budget. Nothing needing the tight size is a percentage today,
            // but the rule holds if that changes.
            pct && (tight ? "pr-3.5" : "pr-5"),
            valueLocked && "cursor-not-allowed border-dashed bg-paper-deep/40 placeholder:text-coral/70",
          )}
        />
        {pct && !valueLocked && (
          <span
            className={cn(
              "absolute right-1.5 top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none",
              // SIZED TO WHATEVER TYPE IS ACTUALLY IN THE BOX. Fixed at
              // text-xs it was 0.75rem against a 0.56rem placeholder, so an
              // empty rTS% row read as "-25 to 20%" with the % a third
              // larger than the hint it was glued to - two different sizes
              // of the same sentence. Once a value is typed the box is back
              // at text-sm and the suffix goes with it.
              row.value
                ? "text-xs"
                : tight ? "text-[0.5rem]" : roomy ? "text-[0.68rem]" : "text-[0.56rem]",
            )}
          >
            %
          </span>
        )}
      </div>

      {/* A bin rather than a cross. An × between two filter rows reads as a
          separator as easily as a control — which is what it looked like next
          to the "×" the chips use for the same job — and this one deletes a
          row the reader built rather than dismissing something. */}
      <button
        type="button"
        onClick={() => onRemove(row.id)}
        aria-label={`Delete ${label} filter`}
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
