import { useCallback, useEffect, useRef, useState, type Dispatch } from "react";
import { freshWorkspace, persistableWorkspace, restoreWorkspace, type Workspace, type WorkspaceAction } from "./workspace";

/**
 * Workspaces: named sets of tabs to switch between.
 *
 * A PLACE FOR EACH PIECE OF WORK. Researching a bracket and following one
 * conference are two different arrangements of tabs, splits and filters, and
 * rebuilding one after the other is the chore this removes. A workspace keeps
 * its tabs, the tab in front and its split; switching puts them back exactly.
 * Favorites, the theme and the sidebar belong to the app, not a workspace.
 *
 * STORED APART. The workspace in front lives where the tabs always have
 * (useWorkspace's key), so a single-workspace app is unchanged; each other one
 * waits under its own key until it is switched to, and the one being left is
 * saved on the way out.
 */

export type WorkspaceMeta = { id: string; name: string };

export type Workspaces = {
  list: WorkspaceMeta[];
  current: WorkspaceMeta;
  switchTo: (id: string) => void;
  /** A new workspace, opened on `from` (a view and season), and switched to. */
  create: (name: string, from: { viewId: string; year: number }) => void;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
};

type Stored = { current: string; list: WorkspaceMeta[] };

const LIST_KEY = "bta.workspaces";
const stateKey = (id: string) => `bta.workspace.${id}`;
const MAIN: WorkspaceMeta = { id: "main", name: "Beyond the Arc" };

function readList(): Stored {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(LIST_KEY) ?? "null");
    if (v && typeof v === "object") {
      const o = v as { current?: unknown; list?: unknown };
      const list = Array.isArray(o.list)
        ? o.list.filter(
            (w): w is WorkspaceMeta =>
              !!w && typeof w === "object" && typeof (w as WorkspaceMeta).id === "string" && typeof (w as WorkspaceMeta).name === "string",
          )
        : [];
      if (list.length > 0) {
        const current = typeof o.current === "string" && list.some((w) => w.id === o.current) ? o.current : list[0]!.id;
        return { current, list };
      }
    }
  } catch {
    /* unreadable: start with the one workspace */
  }
  return { current: MAIN.id, list: [MAIN] };
}

function saveState(id: string, ws: Workspace): void {
  try {
    localStorage.setItem(stateKey(id), JSON.stringify(persistableWorkspace(ws)));
  } catch {
    /* not saved; switching back opens a fresh workspace */
  }
}

function readState(id: string): Workspace | null {
  try {
    const raw = localStorage.getItem(stateKey(id));
    return raw ? restoreWorkspace(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function useWorkspaces(
  ws: Workspace,
  dispatch: Dispatch<WorkspaceAction>,
  onRemoved: (name: string, undo: () => void) => void,
): Workspaces {
  const [stored, setStored] = useState(readList);
  const storedRef = useRef(stored);
  const wsRef = useRef(ws);
  useEffect(() => {
    storedRef.current = stored;
    try {
      localStorage.setItem(LIST_KEY, JSON.stringify(stored));
    } catch {
      /* the list lasts for this session */
    }
  }, [stored]);
  useEffect(() => {
    wsRef.current = ws;
  }, [ws]);

  const switchTo = useCallback(
    (id: string) => {
      const s = storedRef.current;
      if (id === s.current || !s.list.some((w) => w.id === id)) return;
      saveState(s.current, wsRef.current);
      const tab = wsRef.current.tabs.find((t) => t.id === wsRef.current.active);
      dispatch({ type: "load", ws: readState(id) ?? freshWorkspace(tab?.viewId ?? "", tab?.year ?? 0) });
      const next = { ...s, current: id };
      storedRef.current = next;
      setStored(next);
    },
    [dispatch],
  );

  const create = useCallback(
    (name: string, from: { viewId: string; year: number }) => {
      const s = storedRef.current;
      const trimmed = name.trim().slice(0, 40);
      if (!trimmed) return;
      const id = `w${Date.now().toString(36)}`;
      saveState(s.current, wsRef.current);
      dispatch({ type: "load", ws: freshWorkspace(from.viewId, from.year) });
      const next = { current: id, list: [...s.list, { id, name: trimmed }] };
      storedRef.current = next;
      setStored(next);
    },
    [dispatch],
  );

  const rename = useCallback((id: string, name: string) => {
    const trimmed = name.trim().slice(0, 40);
    if (!trimmed) return;
    setStored((s) => ({ ...s, list: s.list.map((w) => (w.id === id ? { ...w, name: trimmed } : w)) }));
  }, []);

  const remove = useCallback(
    (id: string) => {
      const s = storedRef.current;
      const at = s.list.findIndex((w) => w.id === id);
      if (at < 0 || s.list.length <= 1) return;
      const meta = s.list[at]!;
      const list = s.list.filter((w) => w.id !== id);
      let current = s.current;
      // Kept so Undo can bring the workspace back exactly as it was.
      const kept = id === s.current ? wsRef.current : readState(id);
      if (id === s.current) {
        current = list[Math.max(0, at - 1)]!.id;
        dispatch({ type: "load", ws: readState(current) ?? freshWorkspace("", 0) });
      }
      try {
        localStorage.removeItem(stateKey(id));
      } catch {
        /* nothing to remove */
      }
      const next = { current, list };
      storedRef.current = next;
      setStored(next);
      onRemoved(meta.name, () => {
        if (kept) saveState(id, kept);
        setStored((cur) => {
          if (cur.list.some((w) => w.id === id)) return cur;
          const restored = [...cur.list];
          restored.splice(Math.min(at, restored.length), 0, meta);
          return { ...cur, list: restored };
        });
      });
    },
    [dispatch, onRemoved],
  );

  const current = stored.list.find((w) => w.id === stored.current) ?? stored.list[0] ?? MAIN;
  return { list: stored.list, current, switchTo, create, rename, remove };
}
