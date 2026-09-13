import type { Measure } from "./explain-model";

/**
 * The Difference Explainer's and What Changed's tab queries, so an action can
 * open either without importing the page.
 *
 *   difference:   a=2026:Duke&b=2026:Auburn&w=season&m=net
 *   what-changed: t=Michigan&w=last10&m=net   (the season is the tab's)
 */

export type TeamRef = { year: number; name: string };

export type DifferenceWindow = "season" | "conf" | "nonconf" | "last10";
export type ChangeWindow = "last10" | "last5" | "jan" | "conf" | "season";

const MEASURES: Measure[] = ["net", "offense", "defense"];
const DIFFERENCE_WINDOWS: DifferenceWindow[] = ["season", "conf", "nonconf", "last10"];
const CHANGE_WINDOWS: ChangeWindow[] = ["last10", "last5", "jan", "conf", "season"];

const refText = (r: TeamRef) => `${r.year}:${r.name}`;

function parseRef(s: string | null): TeamRef | null {
  if (!s) return null;
  const at = s.indexOf(":");
  const year = Number(s.slice(0, at));
  const name = s.slice(at + 1);
  return at > 0 && Number.isInteger(year) && name ? { year, name } : null;
}

const oneOf = <T extends string>(v: string | null, list: T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);

export function differenceQuery(a: TeamRef | null, b: TeamRef | null, w: DifferenceWindow = "season", m: Measure = "net"): string {
  const q = new URLSearchParams();
  if (a) q.set("a", refText(a));
  if (b) q.set("b", refText(b));
  if (w !== "season") q.set("w", w);
  if (m !== "net") q.set("m", m);
  return q.toString();
}

export function parseDifferenceQuery(query: string): { a: TeamRef | null; b: TeamRef | null; w: DifferenceWindow; m: Measure } {
  const q = new URLSearchParams(query);
  return {
    a: parseRef(q.get("a")),
    b: parseRef(q.get("b")),
    w: oneOf(q.get("w"), DIFFERENCE_WINDOWS, "season"),
    m: oneOf(q.get("m"), MEASURES, "net"),
  };
}

export function changedQuery(team: string | null, w: ChangeWindow = "last10", m: Measure = "net"): string {
  const q = new URLSearchParams();
  if (team) q.set("t", team);
  if (w !== "last10") q.set("w", w);
  if (m !== "net") q.set("m", m);
  return q.toString();
}

export function parseChangedQuery(query: string): { team: string | null; w: ChangeWindow; m: Measure } {
  const q = new URLSearchParams(query);
  return { team: q.get("t") || null, w: oneOf(q.get("w"), CHANGE_WINDOWS, "last10"), m: oneOf(q.get("m"), MEASURES, "net") };
}
