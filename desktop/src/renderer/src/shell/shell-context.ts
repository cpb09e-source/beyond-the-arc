import { createContext, createRef, useContext, type RefObject } from "react";
import type { FocusTarget, RecordRef } from "./views";

/**
 * What the frame lends every view.
 *
 * `filterRef` is the filter box Ctrl+F and / reach. Each view draws its own box
 * in its header, and only the tab in front attaches it, so the shortcut always
 * lands in the table the reader is looking at.
 *
 * `openRecord` opens a team or player profile, in this tab (history remembers
 * where it came from) or a new one, in the season given or the tab's own.
 *
 * `showInExplorer` goes the other way: from a profile to that object's row in
 * its explorer, focused, Peek pinned.
 */
export type Shell = {
  filterRef: RefObject<HTMLInputElement | null>;
  openRecord: (record: RecordRef, how?: { newTab?: boolean; year?: number }) => void;
  showInExplorer: (target: FocusTarget, newTab?: boolean) => void;
};

export const ShellContext = createContext<Shell>({
  filterRef: createRef<HTMLInputElement>(),
  openRecord: () => {},
  showInExplorer: () => {},
});

export const useShell = (): Shell => useContext(ShellContext);
