import { isRecordRef, sameRecord, viewById, type RecordRef } from "./views";

/**
 * A favorite: a place worth coming back to, starred from a tab.
 *
 * A PLACE, NOT A VIEW. Favoriting the Team Explorer filtered to the Big 12 in
 * 2016-17 brings back exactly that, and so does a matchup, a comparison or one
 * player's page: the view, its season, its query and its record, under the name
 * the tab carried when it was starred (renamable in the sidebar).
 */

export type Favorite = {
  id: string;
  label: string;
  viewId: string;
  year: number;
  query: string;
  record?: RecordRef;
};

type Place = { viewId: string; year: number; query: string; record?: RecordRef };

/** A seasonless view (a coach, the Win Calculator) is the same place whatever season the tab last held. */
export const samePlace = (a: Place, b: Place): boolean =>
  a.viewId === b.viewId &&
  (a.year === b.year || !!viewById(a.viewId).seasonless) &&
  a.query === b.query &&
  sameRecord(a.record, b.record);

let seq = 0;

export const favoriteOf = (p: Place, label: string): Favorite => ({
  id: `f${Date.now().toString(36)}${(seq++).toString(36)}`,
  label,
  viewId: p.viewId,
  year: p.year,
  query: p.query,
  record: p.record,
});

export function isFavoriteList(v: unknown): v is Favorite[] {
  return (
    Array.isArray(v) &&
    v.every((f: unknown) => {
      if (typeof f !== "object" || f === null) return false;
      const o = f as Record<string, unknown>;
      return (
        typeof o.id === "string" &&
        typeof o.label === "string" &&
        typeof o.viewId === "string" &&
        typeof o.year === "number" &&
        typeof o.query === "string" &&
        (o.record === undefined || isRecordRef(o.record))
      );
    })
  );
}
