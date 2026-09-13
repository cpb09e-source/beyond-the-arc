import { createContext, useCallback, useContext, useId, useMemo, useState, type ReactNode } from "react";

/**
 * The selection: teams picked together in one season, shared by every view.
 *
 * ONE STORE, SO VIEWS LINK. A lasso on Team Scatter picks the same teams the
 * Team Explorer tints in the other pane, and Ctrl-clicking a row there rings its
 * crest on the chart. Neither view owns the selection; both read and write it
 * here, which is what makes split view an analysis tool rather than two windows.
 *
 * TEAMS, IN ONE SEASON. The scatter is a chart of team-seasons, so a selection is
 * a season and a set of names. A view showing another season shows no
 * selection and leaves it alone; picking in a different season starts over.
 *
 * NOT SAVED. A selection is a moment in an analysis, not a place. The tab's query
 * and favorites keep places; "Show in Team Explorer" turns a selection into one
 * (a `teams:` filter) when it is worth keeping.
 */

export type TeamSelection = { year: number; names: string[] };
export type SelectMode = "replace" | "add" | "remove" | "toggle";

type Selection = {
  selection: TeamSelection | null;
  /** The picked names in this season; empty in any other. */
  namesIn: (year: number) => ReadonlySet<string>;
  select: (year: number, names: string[], mode: SelectMode) => void;
  clear: () => void;
};

const NONE: ReadonlySet<string> = new Set();

const SelectionContext = createContext<Selection>({ selection: null, namesIn: () => NONE, select: () => {}, clear: () => {} });

export const useSelection = (): Selection => useContext(SelectionContext);

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<TeamSelection | null>(null);

  const select = useCallback((year: number, names: string[], mode: SelectMode) => {
    setSelection((cur) => {
      const next = new Set(cur && cur.year === year && mode !== "replace" ? cur.names : []);
      for (const n of names) {
        if (mode === "remove") next.delete(n);
        else if (mode === "toggle" && next.has(n)) next.delete(n);
        else next.add(n);
      }
      return next.size > 0 ? { year, names: [...next] } : null;
    });
  }, []);
  const clear = useCallback(() => setSelection(null), []);

  const picked = useMemo(() => new Set(selection?.names ?? []), [selection]);
  const value = useMemo<Selection>(
    () => ({ selection, namesIn: (year) => (selection && selection.year === year ? picked : NONE), select, clear }),
    [selection, picked, select, clear],
  );
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

/**
 * The linked hover: the team one view is pointing at, for every other view to echo.
 *
 * A row under the pointer in the Team Explorer rings its crest on the scatter in
 * the other pane, and a crest under the pointer outlines its row. Each view
 * ignores its own echo, so pointing never lights the thing already lit.
 */
type Echo = { year: number; name: string; from: string } | null;

const EchoContext = createContext<{ echo: Echo; setEcho: (e: Echo) => void }>({ echo: null, setEcho: () => {} });

export function EchoProvider({ children }: { children: ReactNode }) {
  const [echo, set] = useState<Echo>(null);
  const setEcho = useCallback(
    (e: Echo) => set((cur) => (cur === e || (cur && e && cur.year === e.year && cur.name === e.name && cur.from === e.from) ? cur : e)),
    [],
  );
  const value = useMemo(() => ({ echo, setEcho }), [echo, setEcho]);
  return <EchoContext.Provider value={value}>{children}</EchoContext.Provider>;
}

export function useEcho(): { nameIn: (year: number) => string | null; publish: (year: number, name: string | null) => void } {
  const id = useId();
  const { echo, setEcho } = useContext(EchoContext);
  const publish = useCallback(
    (year: number, name: string | null) => {
      if (name) setEcho({ year, name, from: id });
      // Letting go clears only an echo this view started.
      else if (echo?.from === id) setEcho(null);
    },
    [setEcho, id, echo],
  );
  const nameIn = useCallback((year: number) => (echo && echo.from !== id && echo.year === year ? echo.name : null), [echo, id]);
  return { nameIn, publish };
}
