import { useEffect, useReducer } from "react";
import { ALL_SEASONS, SEASON_CEIL } from "@/lib/seasons";
import { isLayout, sameLayout, type TableLayout } from "./table-layout";
import { isRecordRef, sameRecord, viewById, VIEWS, type RecordRef } from "./views";

/**
 * Tabs: what is open, in what order, and where each one has been.
 *
 * A TAB IS A PLACE WITH ITS OWN SEASON. Two tabs can hold the same view in two
 * seasons, which is the point of tabs in a tool about seasons: 2018-19 in one,
 * 2025-26 in the next, Ctrl+Tab between them. A place is a view, and for a
 * profile the team or player it is about.
 *
 * HISTORY IS PER TAB, as in Linear's desktop app: Alt+Left walks back through
 * where this tab has been, never through another tab's past. Opening a player
 * from the explorer and pressing Alt+Left returns to the explorer, with the
 * filter it had.
 *
 * THE QUERY TRAVELS WITH THE PLACE. For a table it is the filter; for the
 * Matchup Predictor it is the whole matchup. Going back restores it.
 *
 * A VIEW CAN BE PINNED TO ONE SEASON (ViewDef.season): the predictor exists
 * for the latest season only, so a tab holding it keeps that season and the
 * season keys leave it alone.
 *
 * SPLIT VIEW holds two tabs side by side. The pair is shown while either of
 * them is in front; the one in front has the keyboard, and opening "to the
 * side" from it (Shift+Enter) lands in the other pane, so a table on the left
 * can drive a page on the right without losing its place.
 *
 * The tabs persist, so the app reopens with what it closed with. The stack of
 * closed tabs behind Ctrl+Shift+T lasts for the session.
 */

export type Snapshot = { viewId: string; year: number; record?: RecordRef; query?: string; table?: TableLayout };

export type Tab = {
  id: string;
  viewId: string;
  year: number;
  query: string;
  /** The table's column view and added columns (./table-layout.ts). */
  table?: TableLayout;
  record?: RecordRef;
  /** What the view says it is showing ("Duke vs Michigan"); absent, the view's own name. */
  title?: string;
  /** Kept at the left as its mark alone, and never replaced by somewhere else: Linear's pinned tabs. */
  pinned?: boolean;
  back: Snapshot[];
  forward: Snapshot[];
};

/** Two tabs side by side: `a` on the left, `b` on the right, `ratio` of the width to `a`. */
export type Split = { a: string; b: string; ratio: number };

export type Workspace = { tabs: Tab[]; active: string; closed: Tab[]; split: Split | null };

export type WorkspaceAction =
  | { type: "navigate"; viewId: string; year?: number; record?: RecordRef; query?: string; table?: TableLayout }
  | { type: "open"; viewId: string; year: number; record?: RecordRef; query?: string; table?: TableLayout }
  | { type: "close"; id: string }
  | { type: "reopen" }
  | { type: "activate"; id: string }
  | { type: "cycle"; by: 1 | -1 }
  | { type: "activate-index"; index: number }
  | { type: "set-year"; id: string; year: number }
  | { type: "step-year"; to: "older" | "newer" }
  | { type: "set-query"; id: string; query: string }
  | { type: "set-title"; id: string; title: string | null }
  | { type: "set-table"; id: string; table: TableLayout }
  | { type: "duplicate"; id: string }
  | { type: "close-others"; id: string }
  | { type: "back" }
  | { type: "forward" }
  | { type: "move"; id: string; to: number }
  | { type: "open-side"; viewId: string; year: number; record?: RecordRef; query?: string; table?: TableLayout }
  | { type: "split-with"; id: string }
  | { type: "unsplit" }
  | { type: "split-ratio"; ratio: number }
  | { type: "focus-other-pane" }
  | { type: "pin"; id: string; pinned: boolean }
  /** Another workspace's tabs, in place of these (see ./workspaces.ts). */
  | { type: "load"; ws: Workspace };

const KEY = "bta.workspace";
const HISTORY_CAP = 50;
const CLOSED_CAP = 10;

const isSeason = (y: unknown): y is number => typeof y === "number" && ALL_SEASONS.includes(y);

/** The season a view holds: its own when it is pinned to one, otherwise the one asked for. */
const seasonFor = (viewId: string, year: number): number => viewById(viewId).season ?? year;

/** A view id that exists, with the record a profile needs and nothing a table does not. */
function isPlace(viewId: unknown, record: unknown): viewId is string {
  if (typeof viewId !== "string" || !VIEWS.some((v) => v.id === viewId)) return false;
  return viewById(viewId).profile ? isRecordRef(record) : true;
}

const isSnapshot = (s: unknown): s is Snapshot =>
  typeof s === "object" &&
  s !== null &&
  isPlace((s as Snapshot).viewId, (s as Snapshot).record) &&
  isSeason((s as Snapshot).year) &&
  ((s as Snapshot).query === undefined || typeof (s as Snapshot).query === "string") &&
  ((s as Snapshot).table === undefined || isLayout((s as Snapshot).table));

let seq = 0;
const newId = (): string => `t${Date.now().toString(36)}${(seq++).toString(36)}`;

const makeTab = (viewId: string, year: number, record?: RecordRef, query = "", table?: TableLayout): Tab => ({
  id: newId(),
  viewId,
  year: seasonFor(viewId, year),
  query,
  table,
  record,
  back: [],
  forward: [],
});

// `{}` rather than nothing: going back restores the table as it was, even when that was the layout it opens with.
const snapshotOf = (t: Tab): Snapshot => ({ viewId: t.viewId, year: t.year, record: t.record, query: t.query, table: t.table ?? {} });

/** Pinned tabs are always the first ones; this is where they end. */
const pinnedCount = (tabs: Tab[]): number => tabs.filter((t) => t.pinned).length;

/** A new tab beside the one in front, as a browser places it, but never among the pinned ones. */
function insertTab(ws: Workspace, tab: Tab): Workspace {
  const at = Math.max(ws.tabs.findIndex((t) => t.id === ws.active) + 1, pinnedCount(ws.tabs));
  return { ...ws, tabs: [...ws.tabs.slice(0, at), tab, ...ws.tabs.slice(at)], active: tab.id };
}

/** Tabs as persistableWorkspace saved them, checked field by field; null when none is usable. */
export function restoreWorkspace(saved: unknown): Workspace | null {
  if (typeof saved !== "object" || saved === null) return null;
  const parsed = saved as { tabs?: unknown; active?: unknown; split?: unknown };
  const tabs = Array.isArray(parsed.tabs)
    ? parsed.tabs.flatMap((t): Tab[] => {
        const o = t as Partial<Tab>;
        if (!isPlace(o.viewId, o.record) || !isSeason(o.year)) return [];
        return [
          {
            id: newId(),
            viewId: o.viewId,
            year: seasonFor(o.viewId, o.year),
            query: typeof o.query === "string" ? o.query : "",
            table: isLayout(o.table) ? o.table : undefined,
            title: typeof o.title === "string" ? o.title : undefined,
            record: isRecordRef(o.record) ? o.record : undefined,
            pinned: o.pinned === true ? true : undefined,
            back: Array.isArray(o.back) ? o.back.filter(isSnapshot) : [],
            forward: Array.isArray(o.forward) ? o.forward.filter(isSnapshot) : [],
          },
        ];
      })
    : [];
  if (tabs.length === 0) return null;
  const at = typeof parsed.active === "number" ? Math.min(Math.max(0, parsed.active), tabs.length - 1) : 0;
  return { tabs, active: tabs[at]!.id, closed: [], split: restoreSplit(parsed.split, tabs) };
}

/** A new workspace: one tab, on a view that is not a profile, in a season that exists. */
export function freshWorkspace(viewId: string, year: number): Workspace {
  const tab = makeTab(isPlace(viewId, undefined) && !viewById(viewId).profile ? viewId : VIEWS[0]!.id, isSeason(year) ? year : SEASON_CEIL);
  return { tabs: [tab], active: tab.id, closed: [], split: null };
}

function init(): Workspace {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const restored = restoreWorkspace(JSON.parse(raw));
      if (restored) return restored;
    }
    // The one view and season the app remembered before it had tabs.
    const view: unknown = JSON.parse(localStorage.getItem("bta.view") ?? "null");
    const season: unknown = JSON.parse(localStorage.getItem("bta.season") ?? "null");
    const tab = makeTab(isPlace(view, undefined) && !viewById(view).profile ? view : VIEWS[0]!.id, isSeason(season) ? season : SEASON_CEIL);
    return { tabs: [tab], active: tab.id, closed: [], split: null };
  } catch {
    const tab = makeTab(VIEWS[0]!.id, SEASON_CEIL);
    return { tabs: [tab], active: tab.id, closed: [], split: null };
  }
}

/** A persisted split names its tabs by position, since tab ids are made fresh each launch. */
function restoreSplit(v: unknown, tabs: Tab[]): Split | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as { a?: unknown; b?: unknown; ratio?: unknown };
  if (typeof o.a !== "number" || typeof o.b !== "number" || o.a === o.b) return null;
  const a = tabs[o.a];
  const b = tabs[o.b];
  if (!a || !b) return null;
  const ratio = typeof o.ratio === "number" ? Math.min(0.75, Math.max(0.25, o.ratio)) : 0.5;
  return { a: a.id, b: b.id, ratio };
}

const inSplit = (ws: Workspace, id: string): boolean => !!ws.split && (ws.split.a === id || ws.split.b === id);

function updateTab(ws: Workspace, id: string, fn: (t: Tab) => Tab): Workspace {
  return { ...ws, tabs: ws.tabs.map((t) => (t.id === id ? fn(t) : t)) };
}

/**
 * Moves a tab to a place. A place that carries a query gets it (going back, or
 * a matchup opened from a team page); otherwise the filter stays only when the
 * table does.
 */
function arrive(t: Tab, place: Snapshot): Tab {
  const same = place.viewId === t.viewId && sameRecord(place.record, t.record);
  const query = place.query ?? (same ? t.query : "");
  return {
    ...t,
    viewId: place.viewId,
    year: seasonFor(place.viewId, place.year),
    record: place.record,
    query,
    table: place.table ?? (same ? t.table : undefined),
    // A title belongs to what the tab was showing; the view at the new place names it again.
    title: same && query === t.query ? t.title : undefined,
  };
}

export function workspaceReducer(ws: Workspace, a: WorkspaceAction): Workspace {
  const current = ws.tabs.find((t) => t.id === ws.active) ?? ws.tabs[0]!;
  switch (a.type) {
    case "navigate": {
      const place: Snapshot = { viewId: a.viewId, year: seasonFor(a.viewId, a.year ?? current.year), record: a.record, query: a.query, table: a.table };
      if (place.viewId === current.viewId && place.year === current.year && sameRecord(place.record, current.record)) {
        // Already here: only a new query changes anything. Typing in the filter is set-query and leaves
        // history alone; a query arriving this way was asked for ("Michigan's opponents", a favorite),
        // so Alt+Left comes back to the table as it was.
        const query = a.query ?? current.query;
        const table = a.table ?? current.table;
        if (query === current.query && sameLayout(table, current.table)) return ws;
        return updateTab(ws, current.id, (t) => ({ ...t, query, table, back: [...t.back, snapshotOf(t)].slice(-HISTORY_CAP), forward: [] }));
      }
      // A pinned tab keeps its place: somewhere else opens in a tab of its own.
      if (current.pinned && (place.viewId !== current.viewId || !sameRecord(place.record, current.record))) {
        return insertTab(ws, makeTab(place.viewId, place.year, place.record, place.query));
      }
      return updateTab(ws, current.id, (t) => ({
        ...arrive(t, place),
        back: [...t.back, snapshotOf(t)].slice(-HISTORY_CAP),
        forward: [],
      }));
    }
    case "open":
      return insertTab(ws, makeTab(a.viewId, a.year, a.record, a.query, a.table));
    case "close": {
      const at = ws.tabs.findIndex((t) => t.id === a.id);
      if (at < 0) return ws;
      const closed = [...ws.closed, ws.tabs[at]!].slice(-CLOSED_CAP);
      if (ws.tabs.length === 1) {
        // The last tab never closes into nothing; it starts over, in the same season.
        const fresh = makeTab(VIEWS[0]!.id, ws.tabs[0]!.year);
        return { tabs: [fresh], active: fresh.id, closed, split: null };
      }
      const tabs = ws.tabs.filter((t) => t.id !== a.id);
      // Closing one pane of a split hands the front to the other pane, and ends the split.
      const partner = ws.split && inSplit(ws, a.id) ? (ws.split.a === a.id ? ws.split.b : ws.split.a) : null;
      const active = ws.active === a.id ? (partner ?? tabs[Math.min(at, tabs.length - 1)]!.id) : ws.active;
      return { tabs, active, closed, split: partner ? null : ws.split };
    }
    case "reopen": {
      const last = ws.closed[ws.closed.length - 1];
      if (!last) return ws;
      const tab = { ...last, id: newId() };
      // A pinned tab comes back among the pinned; any other at the end.
      const at = tab.pinned ? pinnedCount(ws.tabs) : ws.tabs.length;
      return { tabs: [...ws.tabs.slice(0, at), tab, ...ws.tabs.slice(at)], active: tab.id, closed: ws.closed.slice(0, -1), split: ws.split };
    }
    case "activate":
      return ws.tabs.some((t) => t.id === a.id) ? { ...ws, active: a.id } : ws;
    case "cycle": {
      const at = ws.tabs.findIndex((t) => t.id === ws.active);
      return { ...ws, active: ws.tabs[(at + a.by + ws.tabs.length) % ws.tabs.length]!.id };
    }
    case "activate-index": {
      // Ctrl+9 is always the last tab, however many there are, as in every browser.
      const tab = a.index >= 8 ? ws.tabs[ws.tabs.length - 1] : ws.tabs[a.index];
      return tab ? { ...ws, active: tab.id } : ws;
    }
    case "set-year":
      return updateTab(ws, a.id, (t) => (t.year === a.year || viewById(t.viewId).season != null ? t : { ...t, year: a.year }));
    case "step-year": {
      if (viewById(current.viewId).season != null) return ws;
      const i = ALL_SEASONS.indexOf(current.year);
      const year = (a.to === "older" ? ALL_SEASONS[i + 1] : ALL_SEASONS[i - 1]) ?? current.year;
      return year === current.year ? ws : updateTab(ws, current.id, (t) => ({ ...t, year }));
    }
    case "set-query":
      return updateTab(ws, a.id, (t) => (t.query === a.query ? t : { ...t, query: a.query }));
    case "set-title":
      return updateTab(ws, a.id, (t) => (t.title === (a.title ?? undefined) ? t : { ...t, title: a.title ?? undefined }));
    case "set-table":
      // Like typing in the filter, a change of layout is not a step in history.
      return updateTab(ws, a.id, (t) => (sameLayout(t.table, a.table) ? t : { ...t, table: a.table }));
    case "duplicate": {
      const at = ws.tabs.findIndex((t) => t.id === a.id);
      if (at < 0) return ws;
      const src = ws.tabs[at]!;
      const tab: Tab = { ...src, id: newId(), pinned: undefined, back: [...src.back], forward: [...src.forward] };
      const pos = Math.max(at + 1, pinnedCount(ws.tabs));
      return { ...ws, tabs: [...ws.tabs.slice(0, pos), tab, ...ws.tabs.slice(pos)], active: tab.id };
    }
    case "close-others": {
      const keep = ws.tabs.find((t) => t.id === a.id);
      // Pinned tabs stay, as a browser keeps them.
      const kept = ws.tabs.filter((t) => t.pinned || t.id === a.id);
      if (!keep || kept.length === ws.tabs.length) return ws;
      return { tabs: kept, active: keep.id, closed: [...ws.closed, ...ws.tabs.filter((t) => !kept.includes(t))].slice(-CLOSED_CAP), split: null };
    }
    case "back": {
      const prev = current.back[current.back.length - 1];
      if (!prev) return ws;
      return updateTab(ws, current.id, (t) => ({
        ...arrive(t, prev),
        back: t.back.slice(0, -1),
        forward: [snapshotOf(t), ...t.forward].slice(0, HISTORY_CAP),
      }));
    }
    case "forward": {
      const next = current.forward[0];
      if (!next) return ws;
      return updateTab(ws, current.id, (t) => ({
        ...arrive(t, next),
        back: [...t.back, snapshotOf(t)].slice(-HISTORY_CAP),
        forward: t.forward.slice(1),
      }));
    }
    case "move": {
      const from = ws.tabs.findIndex((t) => t.id === a.id);
      // Pinned tabs move among the pinned, the rest among the rest.
      const n = pinnedCount(ws.tabs);
      const pinned = !!ws.tabs[from]?.pinned;
      const to = Math.max(pinned ? 0 : n, Math.min(pinned ? n - 1 : ws.tabs.length - 1, a.to));
      if (from < 0 || from === to) return ws;
      const tabs = [...ws.tabs];
      const [tab] = tabs.splice(from, 1);
      tabs.splice(to, 0, tab!);
      return { ...ws, tabs };
    }
    case "open-side": {
      const place: Snapshot = { viewId: a.viewId, year: seasonFor(a.viewId, a.year), record: a.record, query: a.query, table: a.table };
      // Already split with this tab: the other pane goes there, and the keyboard stays here.
      if (ws.split && inSplit(ws, current.id)) {
        const otherId = ws.split.a === current.id ? ws.split.b : ws.split.a;
        return updateTab(ws, otherId, (t) =>
          t.viewId === place.viewId && t.year === place.year && sameRecord(t.record, place.record) && (place.query ?? t.query) === t.query
            ? t
            : { ...arrive(t, place), back: [...t.back, snapshotOf(t)].slice(-HISTORY_CAP), forward: [] },
        );
      }
      const tab = makeTab(a.viewId, a.year, a.record, a.query, a.table);
      const at = Math.max(ws.tabs.findIndex((t) => t.id === current.id) + 1, pinnedCount(ws.tabs));
      return {
        ...ws,
        tabs: [...ws.tabs.slice(0, at), tab, ...ws.tabs.slice(at)],
        active: current.id,
        split: { a: current.id, b: tab.id, ratio: ws.split?.ratio ?? 0.5 },
      };
    }
    case "split-with": {
      if (a.id === current.id || !ws.tabs.some((t) => t.id === a.id)) return ws;
      return { ...ws, split: { a: current.id, b: a.id, ratio: ws.split?.ratio ?? 0.5 } };
    }
    case "unsplit":
      return ws.split ? { ...ws, split: null } : ws;
    case "split-ratio":
      return ws.split ? { ...ws, split: { ...ws.split, ratio: Math.min(0.75, Math.max(0.25, a.ratio)) } } : ws;
    case "focus-other-pane": {
      if (!ws.split || !inSplit(ws, current.id)) return ws;
      return { ...ws, active: ws.split.a === current.id ? ws.split.b : ws.split.a };
    }
    case "pin": {
      const tab = ws.tabs.find((t) => t.id === a.id);
      if (!tab || !!tab.pinned === a.pinned) return ws;
      const rest = ws.tabs.filter((t) => t.id !== a.id);
      const n = pinnedCount(rest);
      // Either way it lands on the seam: last of the pinned, or first of the rest.
      return { ...ws, tabs: [...rest.slice(0, n), { ...tab, pinned: a.pinned || undefined }, ...rest.slice(n)] };
    }
    case "load":
      return a.ws;
  }
}

/**
 * The tabs as saved: places, titles and a short history each, and the active tab
 * and split by position, since tab ids are made fresh on every launch.
 */
export function persistableWorkspace(ws: Workspace): unknown {
  return {
    tabs: ws.tabs.map((t) => ({
      viewId: t.viewId,
      year: t.year,
      query: t.query,
      table: t.table,
      record: t.record,
      title: t.title,
      pinned: t.pinned,
      back: t.back.slice(-20),
      forward: t.forward.slice(0, 20),
    })),
    active: ws.tabs.findIndex((t) => t.id === ws.active),
    split: ws.split
      ? {
          a: ws.tabs.findIndex((t) => t.id === ws.split!.a),
          b: ws.tabs.findIndex((t) => t.id === ws.split!.b),
          ratio: ws.split.ratio,
        }
      : null,
  };
}

export function useWorkspace() {
  const [ws, dispatch] = useReducer(workspaceReducer, undefined, init);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(persistableWorkspace(ws)));
    } catch {
      /* not persisted; the tabs still work for this session */
    }
  }, [ws]);
  return [ws, dispatch] as const;
}
