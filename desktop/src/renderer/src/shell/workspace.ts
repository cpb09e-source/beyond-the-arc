import { useEffect, useReducer } from "react";
import { ALL_SEASONS, SEASON_CEIL } from "@/lib/seasons";
import { VIEWS } from "./views";

/**
 * Tabs: what is open, in what order, and where each one has been.
 *
 * A TAB IS A PLACE WITH ITS OWN SEASON. Two tabs can hold the same view in two
 * seasons, which is the point of tabs in a tool about seasons: 2018-19 in one,
 * 2025-26 in the next, Ctrl+Tab between them.
 *
 * HISTORY IS PER TAB, as in Linear's desktop app: Alt+Left walks back through
 * where this tab has been, never through another tab's past.
 *
 * The tabs persist, so the app reopens with what it closed with. The stack of
 * closed tabs behind Ctrl+Shift+T lasts for the session.
 */

export type Snapshot = { viewId: string; year: number };

export type Tab = {
  id: string;
  viewId: string;
  year: number;
  query: string;
  back: Snapshot[];
  forward: Snapshot[];
};

export type Workspace = { tabs: Tab[]; active: string; closed: Tab[] };

export type WorkspaceAction =
  | { type: "navigate"; viewId: string; year?: number }
  | { type: "open"; viewId: string; year: number }
  | { type: "close"; id: string }
  | { type: "reopen" }
  | { type: "activate"; id: string }
  | { type: "cycle"; by: 1 | -1 }
  | { type: "activate-index"; index: number }
  | { type: "set-year"; id: string; year: number }
  | { type: "step-year"; to: "older" | "newer" }
  | { type: "set-query"; id: string; query: string }
  | { type: "back" }
  | { type: "forward" }
  | { type: "move"; id: string; to: number };

const KEY = "bta.workspace";
const HISTORY_CAP = 50;
const CLOSED_CAP = 10;

const isView = (id: unknown): id is string => typeof id === "string" && VIEWS.some((v) => v.id === id);
const isSeason = (y: unknown): y is number => typeof y === "number" && ALL_SEASONS.includes(y);
const isSnapshot = (s: unknown): s is Snapshot =>
  typeof s === "object" && s !== null && isView((s as Snapshot).viewId) && isSeason((s as Snapshot).year);

let seq = 0;
const newId = (): string => `t${Date.now().toString(36)}${(seq++).toString(36)}`;

const makeTab = (viewId: string, year: number): Tab => ({ id: newId(), viewId, year, query: "", back: [], forward: [] });

function init(): Workspace {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { tabs?: unknown; active?: unknown };
      const tabs = Array.isArray(parsed.tabs)
        ? parsed.tabs.flatMap((t): Tab[] => {
            const o = t as Partial<Tab>;
            if (!isView(o.viewId) || !isSeason(o.year)) return [];
            return [
              {
                id: newId(),
                viewId: o.viewId,
                year: o.year,
                query: typeof o.query === "string" ? o.query : "",
                back: Array.isArray(o.back) ? o.back.filter(isSnapshot) : [],
                forward: Array.isArray(o.forward) ? o.forward.filter(isSnapshot) : [],
              },
            ];
          })
        : [];
      if (tabs.length > 0) {
        const at = typeof parsed.active === "number" ? Math.min(Math.max(0, parsed.active), tabs.length - 1) : 0;
        return { tabs, active: tabs[at]!.id, closed: [] };
      }
    }
    // The one view and season the app remembered before it had tabs.
    const view: unknown = JSON.parse(localStorage.getItem("bta.view") ?? "null");
    const season: unknown = JSON.parse(localStorage.getItem("bta.season") ?? "null");
    const tab = makeTab(isView(view) ? view : VIEWS[0]!.id, isSeason(season) ? season : SEASON_CEIL);
    return { tabs: [tab], active: tab.id, closed: [] };
  } catch {
    const tab = makeTab(VIEWS[0]!.id, SEASON_CEIL);
    return { tabs: [tab], active: tab.id, closed: [] };
  }
}

function updateTab(ws: Workspace, id: string, fn: (t: Tab) => Tab): Workspace {
  return { ...ws, tabs: ws.tabs.map((t) => (t.id === id ? fn(t) : t)) };
}

export function workspaceReducer(ws: Workspace, a: WorkspaceAction): Workspace {
  const current = ws.tabs.find((t) => t.id === ws.active) ?? ws.tabs[0]!;
  switch (a.type) {
    case "navigate": {
      const year = a.year ?? current.year;
      if (a.viewId === current.viewId && year === current.year) return ws;
      return updateTab(ws, current.id, (t) => ({
        ...t,
        viewId: a.viewId,
        year,
        // A different view is a different table, so its filter starts empty.
        query: a.viewId === t.viewId ? t.query : "",
        back: [...t.back, { viewId: t.viewId, year: t.year }].slice(-HISTORY_CAP),
        forward: [],
      }));
    }
    case "open": {
      const tab = makeTab(a.viewId, a.year);
      const at = ws.tabs.findIndex((t) => t.id === current.id);
      // Beside the tab it came from, as a browser places it.
      return { ...ws, tabs: [...ws.tabs.slice(0, at + 1), tab, ...ws.tabs.slice(at + 1)], active: tab.id };
    }
    case "close": {
      const at = ws.tabs.findIndex((t) => t.id === a.id);
      if (at < 0) return ws;
      const closed = [...ws.closed, ws.tabs[at]!].slice(-CLOSED_CAP);
      if (ws.tabs.length === 1) {
        // The last tab never closes into nothing; it starts over, in the same season.
        const fresh = makeTab(VIEWS[0]!.id, ws.tabs[0]!.year);
        return { tabs: [fresh], active: fresh.id, closed };
      }
      const tabs = ws.tabs.filter((t) => t.id !== a.id);
      const active = ws.active === a.id ? tabs[Math.min(at, tabs.length - 1)]!.id : ws.active;
      return { tabs, active, closed };
    }
    case "reopen": {
      const last = ws.closed[ws.closed.length - 1];
      if (!last) return ws;
      const tab = { ...last, id: newId() };
      return { tabs: [...ws.tabs, tab], active: tab.id, closed: ws.closed.slice(0, -1) };
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
      return updateTab(ws, a.id, (t) => (t.year === a.year ? t : { ...t, year: a.year }));
    case "step-year": {
      const i = ALL_SEASONS.indexOf(current.year);
      const year = (a.to === "older" ? ALL_SEASONS[i + 1] : ALL_SEASONS[i - 1]) ?? current.year;
      return year === current.year ? ws : updateTab(ws, current.id, (t) => ({ ...t, year }));
    }
    case "set-query":
      return updateTab(ws, a.id, (t) => (t.query === a.query ? t : { ...t, query: a.query }));
    case "back": {
      const prev = current.back[current.back.length - 1];
      if (!prev) return ws;
      return updateTab(ws, current.id, (t) => ({
        ...t,
        viewId: prev.viewId,
        year: prev.year,
        query: prev.viewId === t.viewId ? t.query : "",
        back: t.back.slice(0, -1),
        forward: [{ viewId: t.viewId, year: t.year }, ...t.forward].slice(0, HISTORY_CAP),
      }));
    }
    case "forward": {
      const next = current.forward[0];
      if (!next) return ws;
      return updateTab(ws, current.id, (t) => ({
        ...t,
        viewId: next.viewId,
        year: next.year,
        query: next.viewId === t.viewId ? t.query : "",
        back: [...t.back, { viewId: t.viewId, year: t.year }].slice(-HISTORY_CAP),
        forward: t.forward.slice(1),
      }));
    }
    case "move": {
      const from = ws.tabs.findIndex((t) => t.id === a.id);
      const to = Math.max(0, Math.min(ws.tabs.length - 1, a.to));
      if (from < 0 || from === to) return ws;
      const tabs = [...ws.tabs];
      const [tab] = tabs.splice(from, 1);
      tabs.splice(to, 0, tab!);
      return { ...ws, tabs };
    }
  }
}

export function useWorkspace() {
  const [ws, dispatch] = useReducer(workspaceReducer, undefined, init);
  useEffect(() => {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({
          tabs: ws.tabs.map((t) => ({
            viewId: t.viewId,
            year: t.year,
            query: t.query,
            back: t.back.slice(-20),
            forward: t.forward.slice(0, 20),
          })),
          active: ws.tabs.findIndex((t) => t.id === ws.active),
        }),
      );
    } catch {
      /* not persisted; the tabs still work for this session */
    }
  }, [ws.tabs, ws.active]);
  return [ws, dispatch] as const;
}
