import { useEffect, useState } from "react";
import { isRecordRef, type RecordRef } from "./views";

/**
 * Where the reader has been lately, for Home's "Jump back in".
 *
 * ONE ENTRY PER PLACE, NOT PER KEYSTROKE. A team, player or game page is one
 * place whatever season it was last opened in; any other view is one place
 * whatever its filter, and it keeps the filter it had last. Newest first,
 * sixteen at most, across workspaces, since the question it answers ("what was
 * I just looking at") does not care which set of tabs it was in.
 *
 * Written from wherever the tab in front changes (the app frame), read by Home,
 * and kept in step between the two by an event, the way Get started is.
 */

export type Visit = {
  viewId: string;
  year: number;
  query: string;
  record?: RecordRef;
  title: string;
  /** When it was last in front, ms since the epoch. */
  at: number;
};

const KEY = "bta.recents";
const EVENT = "bta:recents";
const CAP = 16;

const placeKey = (v: { viewId: string; record?: RecordRef }): string => {
  const r = v.record;
  if (!r) return `view:${v.viewId}`;
  if (r.kind === "team") return `team:${r.name}`;
  if (r.kind === "player") return `player:${r.bartId}`;
  if (r.kind === "coach") return `coach:${r.slug}`;
  return `game:${r.season}:${r.id}`;
};

function isVisit(v: unknown): v is Visit {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.viewId === "string" &&
    typeof o.year === "number" &&
    typeof o.query === "string" &&
    typeof o.title === "string" &&
    typeof o.at === "number" &&
    (o.record === undefined || isRecordRef(o.record))
  );
}

function read(): Visit[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter(isVisit).slice(0, CAP) : [];
  } catch {
    return [];
  }
}

/** The tab in front has settled on a place. */
export function recordVisit(place: Omit<Visit, "at">): void {
  const key = placeKey(place);
  const list = read().filter((v) => placeKey(v) !== key);
  const next = [{ ...place, at: Date.now() }, ...list].slice(0, CAP);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* not kept; Home simply has less to offer */
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function useRecents(): Visit[] {
  const [list, setList] = useState(read);
  useEffect(() => {
    const on = () => setList(read());
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return list;
}
