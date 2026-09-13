import { createContext, createRef, useContext, type RefObject } from "react";

/**
 * What the frame lends every view.
 *
 * `filterRef` is the filter box Ctrl+F and / reach. Each view draws its own box
 * in its header, and only the tab in front attaches it, so the shortcut always
 * lands in the table the reader is looking at.
 */
export type Shell = { filterRef: RefObject<HTMLInputElement | null> };

export const ShellContext = createContext<Shell>({ filterRef: createRef<HTMLInputElement>() });

export const useShell = (): Shell => useContext(ShellContext);
