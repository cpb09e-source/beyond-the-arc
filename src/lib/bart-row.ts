/**
 * Accessors for Bart's season row.
 *
 * His season CSV arrives as a positional array with no keys, and columns are
 * read from BOTH ends. The row has grown at the front over the years while the
 * per-game block has always been the tail, so neither direction can be
 * expressed in terms of the other and both are load-bearing.
 *
 * The offsets themselves live at the call sites, because they are only
 * meaningful next to the stat being read — a bare `fromStart(row, 54)` in a
 * shared helper named `minutes()` is one rename away from being wrong about
 * which column it means.
 */

export type StatRow = Array<string | number | null> | null;

/** Counting from the end of the row — the per-game block. */
export function fromEnd(row: StatRow, offset: number): number | null {
  if (!row || row.length <= offset) return null;
  return num(row[row.length - 1 - offset]);
}

/** Counting from the front — identity, the made/attempted counts, minutes. */
export function fromStart(row: StatRow, idx: number): number | null {
  if (!row || row.length <= idx) return null;
  return num(row[idx]);
}

function num(v: string | number | null | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
