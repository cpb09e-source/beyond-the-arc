/**
 * A table's layout in one tab: which of its column views is showing, the stats
 * a reader added as columns, and, on the explorers, the seasons it spans. The
 * site keeps the same things in its URL as `view`, `cols` and `ys`.
 *
 * KEPT WITH THE TAB, BESIDE ITS QUERY. The filter is words in the box; a layout
 * is not something anyone types, so it rides alongside the query, and history,
 * favorites and a reopened app bring the two back together.
 *
 * SEASONS ONLY WHEN THERE ARE SEVERAL. One season is the tab's own `year`, as
 * every other view reads it; `seasons` appears only when a reader picks more
 * than one, newest first, and the tab's year stays one of them.
 *
 * `{}` is the table as it first opens. A place whose layout is absent keeps
 * whatever the tab already had, which is how "Filter to this conference" from a
 * row leaves the reader's chosen view alone.
 */
export type TableLayout = { view?: string; cols?: string[]; seasons?: number[] };

export const NO_LAYOUT: TableLayout = {};

export function isLayout(v: unknown): v is TableLayout {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return (
    (o.view === undefined || typeof o.view === "string") &&
    (o.cols === undefined || (Array.isArray(o.cols) && o.cols.length <= 60 && o.cols.every((k) => typeof k === "string"))) &&
    (o.seasons === undefined || (Array.isArray(o.seasons) && o.seasons.length <= 40 && o.seasons.every((y) => Number.isInteger(y))))
  );
}

const sameList = <T,>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((k, i) => k === b[i]);

export function sameLayout(a: TableLayout | undefined, b: TableLayout | undefined): boolean {
  return (a?.view ?? "") === (b?.view ?? "") && sameList(a?.cols ?? [], b?.cols ?? []) && sameList(a?.seasons ?? [], b?.seasons ?? []);
}

/** The seasons a table spans, newest first: the picked ones when there are several, otherwise the tab's own. */
export function tableSeasons(layout: TableLayout, year: number): number[] {
  const s = layout.seasons;
  return s && s.length > 1 ? [...new Set(s)].sort((x, y) => y - x) : [year];
}
