import { createContext, useContext, useEffect } from "react";

/** Set by the frame around each tab: names that tab. */
export const TabTitleContext = createContext<(title: string | null) => void>(() => {});

/**
 * A view names its tab by what it is showing, the way Linear titles a tab by the
 * issue rather than by "Issues": "Duke vs Michigan", "Michigan · Duke",
 * "Teams: big 12". Null hands the tab back its view's own name.
 *
 * The title rides with the tab (and a favorite starred from it), and clears
 * itself when the tab goes somewhere else.
 */
export function useTabTitle(title: string | null): void {
  const set = useContext(TabTitleContext);
  useEffect(() => {
    set(title);
  }, [set, title]);
}
