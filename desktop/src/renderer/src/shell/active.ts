import { createContext, useContext } from "react";

/**
 * Whether the tree it wraps is the tab in front.
 *
 * EVERY OPEN TAB STAYS MOUNTED, so a tab you come back to has its sort, scroll,
 * focused row and open Peek exactly as you left them. The cost is that a hidden
 * tab's table is still listening to the keyboard, so everything that listens
 * on window asks this first: arrows and Space only ever move the tab you see.
 */
export const ActiveContext = createContext(true);

export const useIsActive = (): boolean => useContext(ActiveContext);
