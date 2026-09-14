/**
 * A table's layout in one tab: which of its column views is showing, and the
 * stats a reader added as columns. The site keeps the same two things in its
 * URL as `view` and `cols`.
 *
 * KEPT WITH THE TAB, BESIDE ITS QUERY. The filter is words in the box; a layout
 * is not something anyone types, so it rides alongside the query, and history,
 * favorites and a reopened app bring the two back together.
 *
 * `{}` is the table as it first opens. A place whose layout is absent keeps
 * whatever the tab already had, which is how "Filter to this conference" from a
 * row leaves the reader's chosen view alone.
 */
export type TableLayout = { view?: string; cols?: string[] };

export const NO_LAYOUT: TableLayout = {};

export function isLayout(v: unknown): v is TableLayout {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return (
    (o.view === undefined || typeof o.view === "string") &&
    (o.cols === undefined || (Array.isArray(o.cols) && o.cols.length <= 60 && o.cols.every((k) => typeof k === "string")))
  );
}

export function sameLayout(a: TableLayout | undefined, b: TableLayout | undefined): boolean {
  const ca = a?.cols ?? [];
  const cb = b?.cols ?? [];
  return (a?.view ?? "") === (b?.view ?? "") && ca.length === cb.length && ca.every((k, i) => k === cb[i]);
}
