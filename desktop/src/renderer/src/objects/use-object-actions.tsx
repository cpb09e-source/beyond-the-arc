import { ListChecks } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { useSelection } from "~/selection/selection";
import { selectionMenuEntries } from "~/selection/selection-actions";
import type { MenuEntry } from "~/ui/menu";
import { useContextMenu } from "~/ui/context-menu";
import { menuFor, runAction, type ActionEnv, type How, type Local } from "./actions";
import { carriesObject, objTitle, type Obj } from "./object";

/**
 * How a component reaches the registry: the app's env, and the one menu.
 *
 * The env is built by the workbench (app.tsx), where the tabs, the tray and the
 * favorites live, and handed down here so a table cell three components deep
 * can open the same menu Ctrl K would offer.
 */

const NOOP_ENV: ActionEnv = {
  openRecord: () => {},
  openView: () => {},
  showInExplorer: () => {},
  openGame: () => {},
  addToCompare: () => {},
  isFavorite: () => false,
  toggleFavorite: () => {},
  copyText: () => {},
  toast: () => {},
  snapshot: () => {},
  here: { viewId: "home", year: 0, query: "" },
};

const EnvContext = createContext<ActionEnv>(NOOP_ENV);

export function ObjectActionsProvider({ env, children }: { env: ActionEnv; children: ReactNode }) {
  return <EnvContext.Provider value={env}>{children}</EnvContext.Provider>;
}

export const useActionEnv = (): ActionEnv => useContext(EnvContext);

type At = { x: number; y: number } | ReactMouseEvent;

/** Open an object's menu at the pointer, or at a point (a button's corner, a focused row). */
export function useObjectMenu(): (at: At, o: Obj, local?: Local) => void {
  const env = useActionEnv();
  const openMenu = useContextMenu();
  const sel = useSelection();
  return useCallback(
    (at, o, local = {}) => {
      let x: number;
      let y: number;
      if ("clientX" in at) {
        at.preventDefault();
        at.stopPropagation();
        x = at.clientX;
        y = at.clientY;
      } else {
        ({ x, y } = at);
      }
      let entries: MenuEntry[] = menuFor(o, env, local);
      // A team inside a selection of several offers the selection's actions first.
      const picked = sel.selection;
      if (picked && picked.names.length > 1 && o.kind === "team" && o.year === picked.year && picked.names.includes(o.name)) {
        entries = [
          {
            kind: "item",
            id: "sub:selection",
            label: `${picked.names.length} selected teams`,
            icon: <ListChecks size={14} strokeWidth={2} />,
            submenu: selectionMenuEntries(picked, env, sel.clear),
          },
          { kind: "separator", id: "sep:selection" },
          ...entries,
        ];
      }
      openMenu({ x, y, label: `${objTitle(o)} actions`, entries });
    },
    [env, openMenu, sel],
  );
}

/** Run an action by id against the app's env. */
export function useRunAction(): (id: string, o: Obj, how?: How, local?: Local) => boolean {
  const env = useActionEnv();
  return useCallback((id, o, how, local) => runAction(id, o, env, how, local), [env]);
}

/**
 * Whether an object is being dragged anywhere in the window, so drop targets
 * that are not normally on screen (Open beside, a favorites slot) can appear.
 */
export function useObjectDragging(): boolean {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const onEnter = (e: DragEvent) => {
      if (carriesObject(e.dataTransfer)) setDragging(true);
    };
    const onEnd = () => setDragging(false);
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragend", onEnd);
    window.addEventListener("drop", onEnd);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragend", onEnd);
      window.removeEventListener("drop", onEnd);
    };
  }, []);
  return dragging;
}
