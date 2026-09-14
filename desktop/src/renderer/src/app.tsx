import {
  CalendarRange,
  Camera,
  Check,
  ClipboardCopy,
  Columns2,
  FileDown,
  ChevronLeft,
  ChevronRight,
  GitCompareArrows,
  Keyboard,
  Layers,
  ListFilter,
  LogIn,
  LogOut,
  Monitor,
  Moon,
  PanelLeft,
  PanelRightClose,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Star,
  StarOff,
  Sun,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ALL_SEASONS, isFlaggedSeason } from "@/lib/seasons";
import logoOnLight from "@public/images/btalogo_final-01.svg";
import logoOnDark from "@public/images/newbtalogo-white-01.svg";
import type { ThemeMode } from "../../preload";
import { loadSearchData } from "~/data/search-model";
import { findGame } from "~/data/game-link";
import { useLoaded } from "~/data/use-corpus";
import { actionById, menuFor, paletteItemsFor, placeOf, type ActionEnv, type Place } from "~/objects/actions";
import { objFromRecord, objTitle } from "~/objects/object";
import { BesideDropZone } from "~/objects/object-surfaces";
import { ObjectActionsProvider } from "~/objects/use-object-actions";
import { CommandPalette, type PaletteGroup, type PaletteItem } from "~/palette/command-palette";
import { objectItems } from "~/palette/object-items";
import { coachItems, typedItems } from "~/palette/typed-items";
import { AccountProvider, useAccount } from "~/shell/account";
import { CompareDock, CompareProvider, compareQuery, useCompare } from "~/shell/compare";
import { favoriteOf, isFavoriteList, samePlace, type Favorite } from "~/shell/favorites";
import { NO_LAYOUT } from "~/shell/table-layout";
import { ActiveContext } from "~/shell/active";
import { ShellContext } from "~/shell/shell-context";
import { ShortcutsOverlay } from "~/shell/shortcuts";
import { SIDEBAR_WIDTH, Sidebar } from "~/shell/sidebar";
import { signalOnboarding } from "~/shell/onboarding";
import { SplitDivider } from "~/shell/split-divider";
import { TabStrip } from "~/shell/tab-strip";
import { TabTitleContext } from "~/shell/tab-title";
import { NAV_ENTRIES, profileViewFor, sameRecord, viewById, type FocusRequest, type FocusTarget, type RecordRef } from "~/shell/views";
import { Welcome } from "~/shell/welcome";
import { useWorkspace, type Tab } from "~/shell/workspace";
import { useWorkspaces } from "~/shell/workspaces";
import { recordVisit, useRecents } from "~/shell/recents";
import { recordStep, setHistoryContext } from "~/shell/research-history";
import { TableExportContext, type TableExport } from "~/table/table-export";
import { isSnappable, type SnapObj } from "~/snapshot/snapshot-cards";
import { SnapshotSheet, objectCard, snapshotView } from "~/snapshot/snapshot-sheet";
import { EchoProvider, SelectionProvider, useSelection } from "~/selection/selection";
import { FocusModeProvider, FocusPill, focusQuery, focusedRowObject, follows, objectAt, subjectOf, useFocusMode } from "~/focus/focus-mode";
import { StatLensProvider } from "~/lens/stat-lens";
import { selectionPaletteItems } from "~/selection/selection-actions";
import { SelectionBar } from "~/selection/selection-bar";
import { seasonLabel } from "~/ui/format";
import { Kbd } from "~/ui/kbd";
import { KeyHints } from "~/ui/key-hints";
import { NamePrompt } from "~/ui/name-prompt";
import { PlaceMark } from "~/ui/place-mark";
import { usePersisted } from "~/ui/persisted";
import { ContextMenuProvider } from "~/ui/context-menu";
import { ToastProvider, useToast } from "~/ui/toast";

const THEME_KEY = "bta.theme";

/**
 * The palette's sections, in their resting order. Before anything is typed it
 * offers only where to go and what to do here; everything else waits for a word,
 * so the first look is short enough to read.
 */
const PALETTE_GROUPS: PaletteGroup[] = [
  // Only there while teams are picked, and then first: what to do with them.
  { id: "selection", heading: "Selection", limit: 8, showWhenEmpty: true },
  { id: "favorites", heading: "Favorites", limit: 6, showWhenEmpty: true },
  { id: "recent", heading: "Recent", limit: 5, showWhenEmpty: true },
  { id: "tabs", heading: "Open tabs", limit: 5, showWhenEmpty: false },
  { id: "views", heading: "Go to", limit: 8, showWhenEmpty: true },
  { id: "actions", heading: "Actions", limit: 8, showWhenEmpty: true },
  { id: "teams", heading: "Teams", limit: 5, showWhenEmpty: false },
  { id: "players", heading: "Players", limit: 6, showWhenEmpty: false },
  { id: "coaches", heading: "Coaches", limit: 4, showWhenEmpty: false },
  { id: "seasons", heading: "Seasons", limit: 5, showWhenEmpty: false },
  { id: "settings", heading: "Settings", limit: 5, showWhenEmpty: false },
];

export function App() {
  return (
    <AccountProvider>
      <ToastProvider>
        <ContextMenuProvider>
          <CompareProvider>
            <SelectionProvider>
              <EchoProvider>
                <FocusModeProvider>
                  <Frame />
                </FocusModeProvider>
              </EchoProvider>
            </SelectionProvider>
          </CompareProvider>
        </ContextMenuProvider>
      </ToastProvider>
    </AccountProvider>
  );
}

/**
 * What the window shows: nothing until the account is known, the welcome
 * screen while an installed copy waits for a sign-in, the workbench after.
 */
function Frame() {
  const account = useAccount();
  const [theme, setTheme] = useThemeMode();

  if (!account.ready) {
    return (
      <div className="h-full bg-paper">
        <div className="drag h-[40px]" />
      </div>
    );
  }
  if (account.requiresAccount && account.auth.status !== "signedIn") return <Welcome />;
  return <Workbench theme={theme} setTheme={setTheme} />;
}

/**
 * The workbench: title bar with tabs, sidebar, and every open tab.
 *
 * EVERY TAB STAYS MOUNTED and only the one in front is shown, so returning to a
 * tab finds its sort, scroll, focused row and Peek where they were. ActiveContext
 * tells a hidden tab's table to leave the keyboard alone.
 */
function Workbench({ theme, setTheme }: { theme: ThemeMode; setTheme: (m: ThemeMode) => void }) {
  const [ws, dispatch] = useWorkspace();
  const [collapsed, setCollapsed] = usePersisted<boolean>(
    "bta.sidebar.collapsed",
    false,
    (v): v is boolean => typeof v === "boolean",
  );
  /**
   * A hidden sidebar, shown for a moment over the page (Arc's edge on Linear's
   * sidebar). Resting on the window's left edge brings it in, leaving it sends it
   * away, and picking a destination closes it; nothing underneath moves. Pinning
   * it, with the button or Ctrl+\, gives it back its room.
   *
   * THE DELAYS ARE THE FEEL: a pointer that only brushes the edge on its way to a
   * table's first column should not throw a panel over it, and one that slips two
   * pixels off the panel should not lose it.
   */
  const [peek, setPeek] = useState(false);
  const peekRef = useRef(false);
  const peekTimer = useRef<number | null>(null);
  useEffect(() => {
    peekRef.current = peek;
  }, [peek]);
  const cancelPeekTimer = useCallback(() => {
    if (peekTimer.current != null) window.clearTimeout(peekTimer.current);
    peekTimer.current = null;
  }, []);
  const peekAfter = useCallback(
    (open: boolean, ms: number) => {
      cancelPeekTimer();
      peekTimer.current = window.setTimeout(() => {
        peekTimer.current = null;
        setPeek(open);
      }, ms);
    },
    [cancelPeekTimer],
  );
  const endPeek = useCallback(() => {
    cancelPeekTimer();
    setPeek(false);
  }, [cancelPeekTimer]);
  /** The button, Ctrl+\ and Ctrl K: hide a pinned sidebar, show a hidden one, and pin a peeking one where it is. */
  const toggleSidebar = useCallback(() => {
    cancelPeekTimer();
    if (peekRef.current) {
      setPeek(false);
      setCollapsed(false);
      return;
    }
    setCollapsed((c) => !c);
  }, [cancelPeekTimer, setCollapsed]);
  useEffect(() => {
    if (!peek) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPeek(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [peek]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const nonce = useRef(0);
  const filterRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  // Named sets of tabs, switched from the sidebar's top menu or Ctrl K.
  const onWorkspaceRemoved = useCallback(
    (name: string, undo: () => void) => toast({ title: `Deleted ${name}`, action: { label: "Undo", run: undo } }),
    [toast],
  );
  const workspaces = useWorkspaces(ws, dispatch, onWorkspaceRemoved);
  const [namePrompt, setNamePrompt] = useState<"new" | "rename" | null>(null);
  const [snapping, setSnapping] = useState<SnapObj | null>(null);
  const { auth, update } = useAccount();
  const compare = useCompare();
  const selection = useSelection();
  const focusMode = useFocusMode();
  const subject = focusMode.mode?.subject ?? null;
  const [favorites, setFavorites] = usePersisted<Favorite[]>("bta.favorites", [], isFavoriteList);

  const current = ws.tabs.find((t) => t.id === ws.active) ?? ws.tabs[0]!;
  const view = viewById(current.viewId);

  // The tab in front, for callbacks that must stay stable across tab switches:
  // rebuilding thirty thousand search rows on every Ctrl+Tab would be felt.
  const currentRef = useRef<Tab>(current);
  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  // Home's "Jump back in": every place the tab in front settles on, Home itself aside.
  useEffect(() => {
    // A focus is a glance, not a visit: the places it passes through are not where the reader went.
    if (current.viewId === "home" || subject) return;
    recordVisit({
      viewId: current.viewId,
      year: current.year,
      query: current.query,
      record: current.record,
      title: current.title ?? current.record?.name ?? viewById(current.viewId).label,
    });
  }, [current.viewId, current.year, current.query, current.record, current.title, subject]);

  // Research history (~/shell/research-history.ts): a place is a step once the tab has stayed on it a
  // moment, so typing a filter or stepping through seasons is one step, not twenty. Every other step
  // (an action, a lens, an export) takes the place and tab it happened in from the context set here.
  const lastPlace = useRef("");
  useEffect(() => {
    const layout = current.table && (current.table.view || current.table.cols?.length) ? { table: current.table } : {};
    const place = { viewId: current.viewId, year: current.year, query: current.query, record: current.record, ...layout };
    setHistoryContext({ tab: current.id, place });
    if (subject) return;
    const key = JSON.stringify(place);
    const title = current.viewId === "home" ? "Home" : tabName(current);
    const t = window.setTimeout(() => {
      if (key === lastPlace.current) return;
      lastPlace.current = key;
      recordStep({ kind: "visit", title, place });
    }, 1200);
    return () => window.clearTimeout(t);
    // `current` is read through the fields listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.id, current.viewId, current.year, current.query, current.record, current.table, current.title, subject]);

  const trayRef = useRef(compare.items);
  useEffect(() => {
    trayRef.current = compare.items;
  }, [compare.items]);

  const navigate = useCallback(
    (viewId: string, newTab: boolean, entryQuery?: string) => {
      const tab = currentRef.current;
      // Going to Compare with a full tray means comparing the tray; an empty
      // Compare tab would only tell the reader how to fill it.
      const tray = trayRef.current;
      const query = entryQuery ?? (viewId === "compare" && tray.length > 1 && tab.viewId !== "compare" ? compareQuery(tray) : undefined);
      dispatch(newTab ? { type: "open", viewId, year: tab.year, query } : { type: "navigate", viewId, query });
    },
    [dispatch],
  );

  /**
   * Take a tab to one object: its view, its season, its row, Peek pinned.
   * The filter is cleared on the way, or it could hide the row.
   */
  const go = useCallback(
    (target: FocusTarget, newTab = false) => {
      const viewId = target.kind === "team" ? "team-explorer" : "player-explorer";
      const tab = currentRef.current;
      nonce.current += 1;
      if (newTab) {
        dispatch({ type: "open", viewId, year: target.year });
      } else {
        dispatch({ type: "navigate", viewId, year: target.year });
        dispatch({ type: "set-query", id: tab.id, query: "" });
      }
      setFocus({ ...target, nonce: nonce.current });
    },
    [dispatch],
  );
  const landed = useCallback((n: number) => setFocus((f) => (f?.nonce === n ? null : f)), []);

  /** Open a team or player profile: here (history remembers the way back), in a new tab, or to the side. */
  const openRecord = useCallback(
    (record: RecordRef, how: { newTab?: boolean; side?: boolean; year?: number } = {}) => {
      const tab = currentRef.current;
      const viewId = profileViewFor(record.kind);
      const year = how.year ?? tab.year;
      dispatch(
        how.side
          ? { type: "open-side", viewId, year, record }
          : how.newTab
            ? { type: "open", viewId, year, record }
            : { type: "navigate", viewId, year, record },
      );
    },
    [dispatch],
  );

  /** Open a view with a starting query: the predictor on the team a page is about, say. */
  const openView = useCallback(
    (viewId: string, how: { newTab?: boolean; side?: boolean; query?: string; year?: number } = {}) => {
      const year = how.year ?? currentRef.current.year;
      dispatch(
        how.side
          ? { type: "open-side", viewId, year, query: how.query }
          : how.newTab
            ? { type: "open", viewId, year, query: how.query }
            : { type: "navigate", viewId, year, query: how.query },
      );
    },
    [dispatch],
  );

  /** Star or unstar a place: a tab's with Ctrl+D, as a browser bookmarks a page, or any object's page with F. */
  const toggleFavoritePlace = useCallback(
    (place: Place, label: string) => {
      const hit = favorites.find((f) => samePlace(f, place));
      if (hit) {
        setFavorites((list) => list.filter((f) => f.id !== hit.id));
        toast({
          title: `Removed ${hit.label} from favorites`,
          action: { label: "Undo", run: () => setFavorites((list) => [...list, hit]) },
        });
      } else {
        const fav = favoriteOf(place, label);
        setFavorites((list) => [...list, fav]);
        toast({ title: `Added ${fav.label} to favorites` });
      }
    },
    [favorites, setFavorites, toast],
  );
  /** Save view's form: star the place under the name given, or rename the favorite it already is. */
  const saveFavoritePlace = useCallback(
    (place: Place, label: string) => {
      const name = label.trim();
      if (!name) return;
      const hit = favorites.find((f) => samePlace(f, place));
      if (hit) {
        if (hit.label === name) return;
        setFavorites((list) => list.map((f) => (f.id === hit.id ? { ...f, label: name } : f)));
        toast({ title: `Renamed to ${name}` });
      } else {
        setFavorites((list) => [...list, favoriteOf(place, name)]);
        toast({ title: `Saved ${name}`, body: "It is in Favorites in the sidebar." });
      }
    },
    [favorites, setFavorites, toast],
  );
  const toggleFavorite = useCallback(
    (tabId?: string) => {
      const tab = ws.tabs.find((t) => t.id === (tabId ?? currentRef.current.id)) ?? currentRef.current;
      toggleFavoritePlace(tab, tab.title ?? tab.record?.name ?? viewById(tab.viewId).label);
    },
    [ws.tabs, toggleFavoritePlace],
  );

  /** Removed from the sidebar: the same Undo as unstarring a tab. */
  const removeFavorite = useCallback(
    (id: string) => {
      const hit = favorites.find((f) => f.id === id);
      if (!hit) return;
      setFavorites((list) => list.filter((f) => f.id !== id));
      toast({
        title: `Removed ${hit.label} from favorites`,
        action: { label: "Undo", run: () => setFavorites((list) => (list.some((f) => f.id === hit.id) ? list : [...list, hit])) },
      });
    },
    [favorites, setFavorites, toast],
  );

  const openFavorite = useCallback(
    (f: Favorite, newTab: boolean) =>
      dispatch(
        newTab
          ? { type: "open", viewId: f.viewId, year: f.year, record: f.record, query: f.query, table: f.table }
          : { type: "navigate", viewId: f.viewId, year: f.year, record: f.record, query: f.query, table: f.table },
      ),
    [dispatch],
  );

  /** Copy link, Copy stats: written by the main process, so a copy lands whether or not the window has focus. */
  const copyText = useCallback(
    (text: string, done: string) => {
      const first = text.split("\n")[0] ?? "";
      void window.bta.clipboard.writeText(text).then(
        (ok) => toast(ok ? { title: done, body: first.length > 120 ? `${first.slice(0, 120)}…` : first } : { title: "That could not be copied" }),
        () => toast({ title: "That could not be copied" }),
      );
    },
    [toast],
  );

  /** A game log row's game, found on its night's slate, or the fallback with a word about why. */
  const openGame = useCallback<ActionEnv["openGame"]>(
    (row, how, fallback) => {
      void findGame(row.date, row.team, row.opp).then((record) => {
        if (record) {
          openRecord(record, { newTab: how.newTab, side: how.side });
          return;
        }
        fallback();
        toast({ title: "No box score for this game", body: `The archive's slate for that night does not list ${row.team} against ${row.opp}.` });
      });
    },
    [openRecord, toast],
  );

  /** The tab in front as an image, with a foot naming it and the site: Ctrl+Shift+S. */
  const snapView = useCallback(
    (action: "copy" | "save") => {
      const tab = currentRef.current;
      const v = viewById(tab.viewId);
      const label = `${tab.title ?? tab.record?.name ?? v.label}${v.seasonless ? "" : ` · ${seasonLabel(tab.year)}`}`;
      void snapshotView(label, action).then(
        (res) => {
          if (res.ok) toast(action === "copy" ? { title: "Snapshot copied", body: `${label}. Paste it into a post or a message.` } : { title: "Snapshot saved", body: res.path });
        },
        () => toast({ title: "The snapshot could not be made" }),
      );
    },
    [toast],
  );

  const split = ws.split;
  const splitShown =
    !!split &&
    (ws.active === split.a || ws.active === split.b) &&
    ws.tabs.some((t) => t.id === split.a) &&
    ws.tabs.some((t) => t.id === split.b);

  /**
   * Split view on or off. On, the tab in front is paired with its neighbor to the
   * right (or left), or with a copy of itself when it is the only tab.
   */
  const toggleSplit = useCallback(() => {
    const tab = currentRef.current;
    if (ws.split && (ws.split.a === tab.id || ws.split.b === tab.id)) {
      dispatch({ type: "unsplit" });
      return;
    }
    const at = ws.tabs.findIndex((t) => t.id === tab.id);
    const partner = ws.tabs[at + 1] ?? ws.tabs[at - 1];
    if (partner) dispatch({ type: "split-with", id: partner.id });
    else dispatch({ type: "open-side", viewId: tab.viewId, year: tab.year, record: tab.record, query: tab.query });
  }, [ws.split, ws.tabs, dispatch]);

  const shell = useMemo(() => ({ filterRef, openRecord, openView, showInExplorer: go }), [openRecord, openView, go]);

  // What every object's actions can reach. Ctrl K, right-click, Peek, record pages, drag and the row keys all
  // read the registry (~/objects/actions.tsx) through this.
  const env = useMemo<ActionEnv>(
    () => ({
      openRecord,
      openView,
      showInExplorer: go,
      openGame,
      addToCompare: compare.add,
      isFavorite: (place) => favorites.some((f) => samePlace(f, place)),
      toggleFavorite: toggleFavoritePlace,
      copyText,
      toast,
      snapshot: (o) => {
        if (isSnappable(o)) setSnapping(o);
      },
      // From a menu or Ctrl K there is no key to hold, so the focus stays until Q or Esc.
      focus: (o) => {
        const s = subjectOf(o, currentRef.current.year);
        if (s) focusMode.start(s, true);
      },
      copyTable: (tsv, rows) => {
        const n = `${rows.toLocaleString()} ${rows === 1 ? "row" : "rows"}`;
        // The main process takes about 30 MB of text for the clipboard; a whole season of player games is more.
        if (tsv.length > 30_000_000) {
          toast({ title: "Too much for the clipboard", body: `${n} is more than a paste can hold. Save it as CSV instead.` });
          return;
        }
        copyText(tsv, `Copied ${n}, ready to paste into a spreadsheet`);
        recordStep({ kind: "export", title: `Copied ${n} of ${tabName(currentRef.current)}`, export: { format: "tsv", rows } });
      },
      saveCsv: (csv, name, rows) => {
        void window.bta.files.saveCsv(csv, name).then(
          (res) => {
            if (!res.ok) return;
            toast({ title: `Saved ${rows.toLocaleString()} ${rows === 1 ? "row" : "rows"}`, body: res.path });
            recordStep({ kind: "export", title: `Saved ${name} as CSV`, export: { format: "csv", rows, name } });
          },
          () => toast({ title: "The file could not be saved" }),
        );
      },
      here: { viewId: current.viewId, year: current.year, query: current.query, record: current.record },
    }),
    [openRecord, openView, go, openGame, compare.add, favorites, toggleFavoritePlace, copyText, toast, current.viewId, current.year, current.query, current.record, focusMode.start],
  );

  // The site's search indexes, loaded in the background at launch so the first
  // Ctrl+K already reaches every team and player.
  const [searchState] = useLoaded("search", loadSearchData);
  const search = searchState.status === "ready" ? searchState.value : null;
  const objects = useMemo(() => (search ? objectItems(search, openRecord) : []), [search, openRecord]);
  // Every coach in the site's coach history, folded once like the objects above.
  const coaches = useMemo(() => coachItems(openRecord), [openRecord]);

  const focusFilter = useCallback(() => {
    filterRef.current?.focus();
    filterRef.current?.select();
  }, []);

  const newTab = useCallback(() => {
    const tab = currentRef.current;
    dispatch({ type: "open", viewId: tab.viewId, year: tab.year });
    setPaletteOpen(true);
  }, [dispatch]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const tab = currentRef.current;
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      const take = (fn: () => void) => {
        e.preventDefault();
        fn();
      };

      if (mod && !e.shiftKey && e.code === "KeyK") return take(() => setPaletteOpen(true));
      if (mod && !e.shiftKey && e.code === "KeyF") return take(focusFilter);
      if (mod && !e.shiftKey && e.code === "KeyD") return take(() => toggleFavorite());
      if (mod && e.shiftKey && e.code === "KeyS") return take(() => snapView("copy"));
      if (mod && e.code === "KeyT") return take(() => (e.shiftKey ? dispatch({ type: "reopen" }) : newTab()));
      if (mod && !e.shiftKey && e.code === "KeyW") return take(() => dispatch({ type: "close", id: tab.id }));
      if (mod && e.code === "Tab") return take(() => dispatch({ type: "cycle", by: e.shiftKey ? -1 : 1 }));
      if (mod && /^Digit[1-9]$/.test(e.code)) {
        return take(() => dispatch({ type: "activate-index", index: Number(e.code.slice(5)) - 1 }));
      }
      if (mod && e.shiftKey && e.code === "Backslash") return take(toggleSplit);
      if (mod && e.code === "Backslash") return take(toggleSidebar);
      // F6 moves between panes, as it does in most Windows apps with more than one.
      if (e.key === "F6" && !mod && !e.altKey) return take(() => dispatch({ type: "focus-other-pane" }));
      if (e.altKey && !mod && (e.code === "ArrowLeft" || e.code === "ArrowRight")) {
        return take(() => dispatch({ type: e.code === "ArrowLeft" ? "back" : "forward" }));
      }
      if (mod || e.altKey || typing) return;
      if (e.key === "?") take(() => setShortcutsOpen(true));
      else if (e.key === "/") take(focusFilter);
      // A seasonless view picks its own seasons, and may use [ ] for steps of its own (the Scoreboard's nights).
      else if ((e.key === "[" || e.key === "]") && !viewById(tab.viewId).seasonless) {
        take(() => dispatch({ type: "step-year", to: e.key === "[" ? "older" : "newer" }));
      }
    };
    // The mouse's own back and forward buttons walk the tab's history too.
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) dispatch({ type: "back" });
      else if (e.button === 4) dispatch({ type: "forward" });
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mouseup", onMouse);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mouseup", onMouse);
    };
  }, [dispatch, focusFilter, newTab, toggleSidebar, toggleFavorite, toggleSplit, snapView]);

  /**
   * FOCUS (~/focus/focus-mode.tsx). Hold Q over something and every pane follows
   * it; a tap keeps it on; Q again or Esc lets it go. With the pointer over
   * nothing, Q takes the focused row of the tab in front, then the page itself.
   * In the capture phase, so Esc lets a focus go before a table takes the key
   * to clear a selection.
   */
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const heldAt = useRef<number | null>(null);
  const modeRef = useRef(focusMode.mode);
  useEffect(() => {
    modeRef.current = focusMode.mode;
  }, [focusMode.mode]);
  const { start: startFocus, lock: lockFocus, release: releaseFocus } = focusMode;
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
    };
    const onLeave = () => {
      pointer.current = null;
    };
    const resolve = () => {
      const tab = currentRef.current;
      const at = pointer.current;
      const obj = (at ? objectAt(at.x, at.y) : null) ?? focusedRowObject(tab.id) ?? (tab.record ? objFromRecord(tab.record, tab.year) : null);
      return obj ? subjectOf(obj, tab.year) : null;
    };
    const onDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === "Escape" && modeRef.current && !t?.closest?.("[role=dialog]")) {
        e.preventDefault();
        e.stopPropagation();
        heldAt.current = null;
        releaseFocus();
        return;
      }
      if (e.code !== "KeyQ" || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      if (e.repeat) return;
      if (modeRef.current?.locked) {
        releaseFocus();
        return;
      }
      const s = resolve();
      if (!s) {
        toast({ title: "Nothing here to focus on", body: "Point at a team, a player or a conference, then hold Q." });
        return;
      }
      startFocus(s, false);
      heldAt.current = performance.now();
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code !== "KeyQ" || heldAt.current == null) return;
      const tapped = performance.now() - heldAt.current < 280;
      heldAt.current = null;
      if (tapped) lockFocus();
      else releaseFocus();
    };
    // A held focus ends with the key, and a key let go in another window never arrives.
    const onBlur = () => {
      if (heldAt.current == null) return;
      heldAt.current = null;
      releaseFocus();
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [startFocus, lockFocus, releaseFocus, toast]);

  // Get started ticks itself off as the reader finds each thing, wherever they find it.
  useEffect(() => {
    if (paletteOpen) signalOnboarding("palette");
  }, [paletteOpen]);
  useEffect(() => {
    if (favorites.length > 0) signalOnboarding("favorite");
  }, [favorites.length]);
  useEffect(() => {
    if (splitShown) signalOnboarding("split");
  }, [splitShown]);
  const firstTheme = useRef(theme);
  useEffect(() => {
    if (theme !== firstTheme.current) signalOnboarding("theme");
  }, [theme]);

  // Say once when a sign-in finishes, and once when an update is ready.
  const lastAuth = useRef(auth.status);
  useEffect(() => {
    if (lastAuth.current === "waiting" && auth.status === "signedIn") {
      toast({ title: `Signed in as ${auth.user.email ?? "your account"}` });
    } else if (lastAuth.current === "waiting" && (auth.status === "error" || auth.status === "refused")) {
      toast({ title: "Sign-in did not finish", body: auth.message });
    }
    lastAuth.current = auth.status;
  }, [auth, toast]);
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (update.status !== "ready" || announced.current === update.version) return;
    announced.current = update.version;
    toast({
      title: `Version ${update.version} is ready`,
      body: "It installs the next time the app restarts.",
      action: { label: "Restart now", run: () => void window.bta.update.install() },
    });
  }, [update, toast]);

  /**
   * Everything the palette can do right now. Rebuilt when the tab, view, season
   * or theme changes, because rows mark what is current and name what "here" is.
   */
  // Each tab's table, for Ctrl K's "Copy this table" and "Save this table as CSV" (~/table/table-export.ts).
  const tableExports = useRef(new Map<string, TableExport>());
  const [exportsSeen, setExportsSeen] = useState(0);
  const exportValues = useRef(new Map<string, { register: (exp: TableExport | null) => void; fileName: string }>());
  const exportContext = (tab: Tab) => {
    const fileName = tabName(tab);
    let v = exportValues.current.get(tab.id);
    if (!v || v.fileName !== fileName) {
      const register =
        v?.register ??
        ((exp: TableExport | null) => {
          if (exp) tableExports.current.set(tab.id, exp);
          else tableExports.current.delete(tab.id);
          setExportsSeen((n) => n + 1);
        });
      v = { register, fileName };
      exportValues.current.set(tab.id, v);
    }
    return v;
  };

  const recents = useRecents();
  const paletteItems = useMemo<PaletteItem[]>(() => {
    const currentMark = <Check size={14} strokeWidth={2.25} className="text-accent" />;
    const items: PaletteItem[] = [];

    for (const e of NAV_ENTRIES) {
      const Icon = e.icon;
      const here = e.isCurrent(view.id, current.query);
      items.push({
        id: `view:${e.key}`,
        group: "views",
        title: e.label,
        subtitle: e.section,
        keywords: ["open", "go"],
        // Places in the app come before anything named like them.
        weight: 40,
        leading: <Icon size={15} strokeWidth={2} />,
        trailing: here ? currentMark : undefined,
        // Already on this entry: leave the tab as it is rather than starting it over.
        run: (how) => navigate(e.viewId, how.newTab, how.newTab || !here ? e.query : undefined),
      });
    }

    const action = (entry: Omit<PaletteItem, "group" | "weight">) => items.push({ ...entry, group: "actions", weight: 35 });
    if (!view.profile) {
      action({
        id: "action:filter",
        title: `Filter ${view.label}`,
        keywords: ["find", "search", "table", "rows"],
        leading: <ListFilter size={15} strokeWidth={2} />,
        trailing: <Kbd>Ctrl F</Kbd>,
        run: () => focusFilter(),
      });
    }
    const at = ALL_SEASONS.indexOf(current.year);
    const older = ALL_SEASONS[at + 1];
    const newer = ALL_SEASONS[at - 1];
    if (older != null && !view.seasonless) {
      action({
        id: "action:older",
        title: "Older season",
        subtitle: seasonLabel(older),
        keywords: ["previous", "back", "earlier", "season"],
        leading: <ChevronLeft size={15} strokeWidth={2} />,
        trailing: <Kbd>[</Kbd>,
        run: () => dispatch({ type: "step-year", to: "older" }),
      });
    }
    if (newer != null && !view.seasonless) {
      action({
        id: "action:newer",
        title: "Newer season",
        subtitle: seasonLabel(newer),
        keywords: ["next", "forward", "later", "season"],
        leading: <ChevronRight size={15} strokeWidth={2} />,
        trailing: <Kbd>]</Kbd>,
        run: () => dispatch({ type: "step-year", to: "newer" }),
      });
    }
    if (compare.items.length > 0) {
      const n = compare.items.length;
      action({
        id: "action:compare",
        title: n > 1 ? `Compare ${n} ${compare.items[0]!.kind === "team" ? "teams" : "players"}` : "Open Compare",
        subtitle: compare.items.map((it) => it.name).join(", "),
        keywords: ["compare", "side by side", "versus", "vs", "tray"],
        leading: <GitCompareArrows size={15} strokeWidth={2} />,
        run: (how) => openView("compare", { query: compareQuery(compare.items), newTab: how.newTab, side: how.side }),
      });
    }
    const starred = favorites.find((f) => samePlace(f, current));
    action({
      id: "action:favorite",
      title: starred ? "Remove from favorites" : "Add to favorites",
      subtitle: starred?.label ?? current.title ?? current.record?.name ?? view.label,
      keywords: ["favorite", "star", "pin", "bookmark", "save"],
      leading: starred ? <StarOff size={15} strokeWidth={2} /> : <Star size={15} strokeWidth={2} />,
      trailing: <Kbd>Ctrl D</Kbd>,
      run: () => toggleFavorite(),
    });
    for (const f of favorites) {
      const fv = viewById(f.viewId);
      const FavIcon = fv.icon;
      items.push({
        id: `favorite:${f.id}`,
        group: "favorites",
        title: f.label,
        subtitle: fv.profile ? seasonLabel(f.year) : fv.seasonless ? fv.label : `${fv.label} · ${seasonLabel(f.year)}`,
        keywords: ["favorite", fv.label],
        weight: 45,
        leading: <FavIcon size={15} strokeWidth={2} />,
        object: f.record ? objFromRecord(f.record, f.year) : undefined,
        run: (how) => openFavorite(f, how.newTab),
      });
    }
    // Where the reader has just been, first thing before a word is typed, as Notion's search opens.
    const here = (p: { viewId: string; record?: RecordRef }) => p.viewId === current.viewId && sameRecord(p.record, current.record);
    recents
      .filter((v) => !here(v))
      .slice(0, 5)
      .forEach((v, i) => {
        const rv = viewById(v.viewId);
        items.push({
          id: `recent:${i}`,
          group: "recent",
          title: v.title,
          subtitle: rv.seasonless ? rv.label : `${rv.label} · ${seasonLabel(v.year)}`,
          keywords: ["recent", "history", rv.label],
          weight: 44,
          leading: <PlaceMark viewId={v.viewId} record={v.record} />,
          object: v.record ? objFromRecord(v.record, v.year) : undefined,
          run: (how) =>
            dispatch(
              how.side
                ? { type: "open-side", viewId: v.viewId, year: v.year, record: v.record, query: v.query }
                : how.newTab
                  ? { type: "open", viewId: v.viewId, year: v.year, record: v.record, query: v.query }
                  : { type: "navigate", viewId: v.viewId, year: v.year, record: v.record, query: v.query },
            ),
        });
      });
    // Every other open tab by name, so a tab is found by typing rather than hunting the strip.
    ws.tabs.forEach((t, i) => {
      if (t.id === current.id) return;
      const tv = viewById(t.viewId);
      items.push({
        id: `tab:${t.id}`,
        group: "tabs",
        title: t.title ?? t.record?.name ?? tv.label,
        subtitle: tv.seasonless ? tv.label : `${tv.label} · ${seasonLabel(t.year)}`,
        keywords: ["tab", "open", "switch", tv.label],
        weight: 46,
        leading: <PlaceMark viewId={t.viewId} record={t.record} />,
        object: t.record ? objFromRecord(t.record, t.year) : undefined,
        trailing: i < 8 ? <Kbd>{`Ctrl ${i + 1}`}</Kbd> : undefined,
        run: () => dispatch({ type: "activate", id: t.id }),
      });
    });
    // What can be done with the page in front, from the object registry (~/objects/actions.tsx). On
    // Michigan's page, "compare" means comparing Michigan, and "link" means its link, not a player named Link.
    if (current.record) items.push(...paletteItemsFor(objFromRecord(current.record, current.year), env, "context"));
    // With teams picked, the selection's actions lead: "compare" then means those teams.
    if (selection.selection) items.push(...selectionPaletteItems(selection.selection, env, selection.clear));
    action({
      id: "action:snapshot-view",
      title: "Copy a snapshot of this view",
      subtitle: "The tab as an image, with its name and btacbb.xyz",
      keywords: ["snapshot", "image", "screenshot", "picture", "share", "copy", "png"],
      leading: <Camera size={15} strokeWidth={2} />,
      trailing: <Kbd>Ctrl Shift S</Kbd>,
      // After the palette has gone, or it would be in the picture.
      run: () => window.setTimeout(() => snapView("copy"), 180),
    });
    action({
      id: "action:snapshot-view-save",
      title: "Save a snapshot of this view",
      keywords: ["snapshot", "image", "screenshot", "picture", "save", "png", "file"],
      leading: <Camera size={15} strokeWidth={2} />,
      run: () => window.setTimeout(() => snapView("save"), 180),
    });
    const table = tableExports.current.get(current.id);
    if (table && table.rows > 0) {
      const rows = (n: number) => `${n.toLocaleString()} ${n === 1 ? "row" : "rows"}`;
      const file = tabName(current);
      action({
        id: "action:copy-table",
        title: "Copy this table for a spreadsheet",
        subtitle: `${rows(table.rows)} · ${table.name}`,
        keywords: ["copy", "export", "spreadsheet", "excel", "sheets", "table", "clipboard", "paste"],
        leading: <ClipboardCopy size={15} strokeWidth={2} />,
        run: () => env.copyTable(table.tsv(), table.rows),
      });
      action({
        id: "action:save-csv",
        title: "Save this table as CSV",
        subtitle: `${rows(table.rows)} · ${file}`,
        keywords: ["save", "export", "csv", "file", "download", "spreadsheet", "excel"],
        leading: <FileDown size={15} strokeWidth={2} />,
        run: () => env.saveCsv(table.csv(), file, table.rows),
      });
      if (table.selected > 1) {
        action({
          id: "action:save-csv-selected",
          title: "Save the selected rows as CSV",
          subtitle: `${rows(table.selected)} · ${file}`,
          keywords: ["save", "export", "csv", "file", "selection", "selected", "spreadsheet"],
          leading: <FileDown size={15} strokeWidth={2} />,
          run: () => env.saveCsv(table.csv("selected"), `${file} selected`, table.selected),
        });
      }
    }
    for (const w of workspaces.list) {
      if (w.id === workspaces.current.id) continue;
      action({
        id: `action:workspace:${w.id}`,
        title: `Switch to ${w.name}`,
        subtitle: "Workspace",
        keywords: ["workspace", "switch"],
        leading: <Layers size={15} strokeWidth={2} />,
        run: () => workspaces.switchTo(w.id),
      });
    }
    action({
      id: "action:workspace-new",
      title: "New workspace",
      subtitle: "A separate set of tabs",
      keywords: ["workspace", "create", "add"],
      leading: <Layers size={15} strokeWidth={2} />,
      run: () => setNamePrompt("new"),
    });
    action({
      id: "action:workspace-rename",
      title: "Rename workspace",
      subtitle: workspaces.current.name,
      keywords: ["workspace", "rename", "name"],
      leading: <Pencil size={15} strokeWidth={2} />,
      run: () => setNamePrompt("rename"),
    });
    action({
      id: "action:new-tab",
      title: "New tab",
      keywords: ["open", "tab"],
      leading: <Plus size={15} strokeWidth={2} />,
      trailing: <Kbd>Ctrl T</Kbd>,
      run: () => dispatch({ type: "open", viewId: current.viewId, year: current.year }),
    });
    action({
      id: "action:close-tab",
      title: "Close tab",
      keywords: ["tab", "close"],
      leading: <X size={15} strokeWidth={2} />,
      trailing: <Kbd>Ctrl W</Kbd>,
      run: () => dispatch({ type: "close", id: current.id }),
    });
    action({
      id: "action:pin-tab",
      title: current.pinned ? "Unpin tab" : "Pin tab",
      subtitle: current.title ?? current.record?.name ?? view.label,
      keywords: ["tab", "pin", "keep"],
      leading: current.pinned ? <PinOff size={15} strokeWidth={2} /> : <Pin size={15} strokeWidth={2} />,
      run: () => dispatch({ type: "pin", id: current.id, pinned: !current.pinned }),
    });
    if (ws.closed.length > 0) {
      action({
        id: "action:reopen-tab",
        title: "Reopen closed tab",
        subtitle: ws.closed[ws.closed.length - 1]!.record?.name ?? viewById(ws.closed[ws.closed.length - 1]!.viewId).label,
        keywords: ["tab", "undo", "restore"],
        leading: <RotateCcw size={15} strokeWidth={2} />,
        trailing: <Kbd>Ctrl Shift T</Kbd>,
        run: () => dispatch({ type: "reopen" }),
      });
    }
    if (splitShown) {
      action({
        id: "action:unsplit",
        title: "Close split view",
        keywords: ["split", "side by side", "pane", "unsplit"],
        leading: <PanelRightClose size={15} strokeWidth={2} />,
        trailing: <Kbd>Ctrl Shift \</Kbd>,
        run: () => dispatch({ type: "unsplit" }),
      });
      action({
        id: "action:other-pane",
        title: "Move to the other pane",
        keywords: ["split", "pane", "focus", "switch"],
        leading: <Columns2 size={15} strokeWidth={2} />,
        trailing: <Kbd>F6</Kbd>,
        run: () => dispatch({ type: "focus-other-pane" }),
      });
    } else {
      action({
        id: "action:split",
        title: "Split view",
        subtitle: "Two tabs side by side",
        keywords: ["split", "side by side", "pane", "two"],
        leading: <Columns2 size={15} strokeWidth={2} />,
        trailing: <Kbd>Ctrl Shift \</Kbd>,
        run: () => toggleSplit(),
      });
    }
    action({
      id: "action:sidebar",
      title: collapsed ? "Show sidebar" : "Hide sidebar",
      keywords: ["sidebar", "navigation", "panel", "toggle"],
      leading: <PanelLeft size={15} strokeWidth={2} />,
      trailing: <Kbd>Ctrl \</Kbd>,
      run: () => toggleSidebar(),
    });
    action({
      id: "action:shortcuts",
      title: "Keyboard shortcuts",
      keywords: ["keys", "help", "hotkeys"],
      leading: <Keyboard size={15} strokeWidth={2} />,
      trailing: <Kbd>?</Kbd>,
      run: () => setShortcutsOpen(true),
    });

    for (const y of ALL_SEASONS) {
      items.push({
        id: `season:${y}`,
        group: "seasons",
        title: seasonLabel(y),
        subtitle: isFlaggedSeason(y) ? "Covid season" : undefined,
        // 2019, 2018 and 18-19 all find 2018-19.
        keywords: ["season", String(y), String(y - 1), `${String(y - 1).slice(2)}-${String(y).slice(2)}`],
        // Newest first among equal matches, the order the season switcher uses.
        weight: y / 100,
        leading: <CalendarRange size={15} strokeWidth={2} />,
        trailing: y === current.year ? currentMark : undefined,
        run: (how) =>
          how.newTab
            ? dispatch({ type: "open", viewId: current.viewId, year: y })
            : dispatch({ type: "set-year", id: current.id, year: y }),
      });
    }

    const themes = [
      ["system", "Match system theme", Monitor],
      ["light", "Light theme", Sun],
      ["dark", "Dark theme", Moon],
    ] as const;
    for (const [mode, title, Icon] of themes) {
      items.push({
        id: `theme:${mode}`,
        group: "settings",
        title,
        keywords: ["theme", "appearance", "mode", "color", "colour"],
        weight: 35,
        leading: <Icon size={15} strokeWidth={2} />,
        trailing: theme === mode ? currentMark : undefined,
        run: () => setTheme(mode),
      });
    }
    items.push(
      auth.status === "signedIn"
        ? {
            id: "account:sign-out",
            group: "settings",
            title: "Sign out",
            subtitle: auth.user.email ?? undefined,
            keywords: ["account", "log out", "logout"],
            weight: 35,
            leading: <LogOut size={15} strokeWidth={2} />,
            run: () => void window.bta.auth.signOut(),
          }
        : {
            id: "account:sign-in",
            group: "settings",
            title: "Sign in with browser",
            keywords: ["account", "log in", "login", "season pass"],
            weight: 35,
            leading: <LogIn size={15} strokeWidth={2} />,
            run: () => void window.bta.auth.signIn(),
          },
    );

    return items;
  }, [view, current, ws.tabs, ws.closed, recents, collapsed, theme, auth, navigate, focusFilter, dispatch, toggleSidebar, setTheme, compare.items, openView, favorites, toggleFavorite, openFavorite, splitShown, toggleSplit, go, compare.add, workspaces, env, snapView, selection.selection, selection.clear, exportsSeen]);

  const allItems = useMemo(() => [...paletteItems, ...objects, ...coaches], [paletteItems, objects, coaches]);

  // Rows from the words themselves: a question to ask, a night to see, two schools to predict.
  const typed = useCallback(
    (q: string) => typedItems(q, { openView, search, current: { viewId: current.viewId, query: current.query }, year: current.year }),
    [openView, search, current.viewId, current.query, current.year],
  );

  // One stable setter per tab, so a view's title effect does not rerun on every render.
  const titleSetters = useRef(new Map<string, (title: string | null) => void>());
  const titleSetter = (id: string) => {
    let fn = titleSetters.current.get(id);
    if (!fn) {
      fn = (title) => dispatch({ type: "set-title", id, title });
      titleSetters.current.set(id, fn);
    }
    return fn;
  };

  return (
    <ShellContext.Provider value={shell}>
      <ObjectActionsProvider env={env}>
      <StatLensProvider>
      <div className="flex h-full flex-col">
        {/* The title bar is the window's drag handle; tabs and buttons opt out.
            On Windows the caption buttons are drawn natively over its right end. */}
        <header className="drag flex h-[40px] shrink-0 items-center border-b border-hairline bg-chrome">
          {/* Eases with the sidebar below it, so the tab strip moves once, with the page. */}
          <div
            className="flex h-full shrink-0 items-center gap-1.5 overflow-hidden pl-2 transition-[width] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
            style={{ width: collapsed ? 40 : SIDEBAR_WIDTH }}
          >
            <button
              type="button"
              aria-label={peek ? "Keep the sidebar open" : collapsed ? "Show sidebar" : "Hide sidebar"}
              title={`${peek ? "Keep the sidebar open" : collapsed ? "Show sidebar" : "Hide sidebar"}  Ctrl \\`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={toggleSidebar}
              className="no-drag grid size-[28px] shrink-0 place-items-center rounded-md text-ink-muted transition-colors hover:bg-[var(--row-hover)] hover:text-ink"
            >
              <PanelLeft size={15} strokeWidth={2} />
            </button>
            <span aria-hidden={collapsed || undefined} className="flex shrink-0 items-center pl-0.5">
              {/* The site's wordmark in both inks; CSS shows the one this ground needs. */}
              <img src={logoOnLight} alt="Beyond the Arc" draggable={false} className="bta-logo-light h-[17px] w-auto" />
              <img src={logoOnDark} alt="Beyond the Arc" draggable={false} className="bta-logo-dark h-[17px] w-auto" />
            </span>
          </div>
          <TabStrip
            tabs={ws.tabs}
            active={ws.active}
            onActivate={(id) => dispatch({ type: "activate", id })}
            onClose={(id) => dispatch({ type: "close", id })}
            onNew={newTab}
            onMove={(id, to) => dispatch({ type: "move", id, to })}
            isFavorite={(id) => {
              const t = ws.tabs.find((x) => x.id === id);
              return !!t && favorites.some((f) => samePlace(f, t));
            }}
            onFavorite={(id) => toggleFavorite(id)}
            onDuplicate={(id) => dispatch({ type: "duplicate", id })}
            onCloseOthers={(id) => dispatch({ type: "close-others", id })}
            split={splitShown ? split : null}
            onSplitWith={(id) => (id === ws.active ? toggleSplit() : dispatch({ type: "split-with", id }))}
            onUnsplit={() => dispatch({ type: "unsplit" })}
            onPin={(id, pinned) => dispatch({ type: "pin", id, pinned })}
            onDropObject={(o) => actionById("open-tab")?.run(o, env, { newTab: true }, {})}
            recordMenu={(id) => {
              const t = ws.tabs.find((x) => x.id === id);
              return t?.record ? menuFor(objFromRecord(t.record, t.year), { ...env, here: { viewId: t.viewId, year: t.year, query: t.query, record: t.record } }) : null;
            }}
          />
        </header>

        <div className="relative flex min-h-0 flex-1">
          {/* THE SLOT is the sidebar's room in the layout: all of it when pinned, none when hidden. Its width
              eases, so the page takes the room back in one motion rather than a jump. The panel inside keeps
              its own width the whole time, so its rows never rewrap while it moves; while peeking it sits over
              the page from a slot of no width, and nothing underneath shifts. */}
          <div
            className="relative z-30 shrink-0 transition-[width] duration-[220ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
            style={{ width: collapsed ? 0 : SIDEBAR_WIDTH }}
          >
            <div
              data-sidebar={collapsed ? (peek ? "peek" : "hidden") : "pinned"}
              aria-hidden={collapsed && !peek ? true : undefined}
              inert={collapsed && !peek ? true : undefined}
              onMouseEnter={() => {
                if (peekRef.current) cancelPeekTimer();
              }}
              onMouseLeave={() => {
                if (peekRef.current) peekAfter(false, 160);
              }}
              className={`absolute inset-y-0 left-0 flex transition-[translate,box-shadow] duration-[200ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
                collapsed && !peek ? "-translate-x-full" : "translate-x-0"
              }`}
              // Floating, it takes a firmer edge than its hairline: the overlay shadow alone is faint on the dark ground.
              style={{
                width: SIDEBAR_WIDTH,
                boxShadow: collapsed && peek ? "1px 0 0 color-mix(in oklab, var(--ink) 16%, transparent), var(--overlay-shadow)" : "none",
              }}
            >
              <Sidebar
                currentViewId={current.viewId}
                currentQuery={current.query}
                onNavigate={(viewId, newTab, query) => {
                  navigate(viewId, newTab, query);
                  endPeek();
                }}
                onOpenSearch={() => {
                  endPeek();
                  setPaletteOpen(true);
                }}
                onOpenShortcuts={() => {
                  endPeek();
                  setShortcutsOpen(true);
                }}
                theme={theme}
                setTheme={setTheme}
                favorites={favorites}
                currentFavoriteId={favorites.find((f) => samePlace(f, current))?.id ?? null}
                onOpenFavorite={(f, newTab) => {
                  openFavorite(f, newTab);
                  endPeek();
                }}
                onRemoveFavorite={removeFavorite}
                onRenameFavorite={(id, label) =>
                  setFavorites((list) => list.map((f) => (f.id === id && label.trim() ? { ...f, label: label.trim() } : f)))
                }
                workspaces={workspaces}
                onNewWorkspace={() => setNamePrompt("new")}
                onRenameWorkspace={() => setNamePrompt("rename")}
                onDropFavorite={(o) => {
                  const place = placeOf(o, env);
                  if (place && !env.isFavorite(place)) env.toggleFavorite(place, objTitle(o));
                }}
              />
            </div>
          </div>
          {/* A hidden sidebar's edge: rest the pointer on it a moment and the sidebar slides in over the page. */}
          {collapsed && !peek && (
            <div
              aria-hidden
              data-sidebar-edge=""
              className="absolute inset-y-0 left-0 z-30 w-[5px]"
              onMouseEnter={() => peekAfter(true, 150)}
              onMouseLeave={cancelPeekTimer}
            />
          )}

          <main className="relative flex min-h-0 min-w-0 flex-1 bg-paper">
            {ws.tabs.map((tab) => {
              const View = viewById(tab.viewId).Component;
              const active = tab.id === ws.active;
              const pane = splitShown && split ? (tab.id === split.a ? "a" : tab.id === split.b ? "b" : null) : null;
              const shown = splitShown ? pane !== null : active;
              // A pane on screen follows a focus through a stand-in query; its own query is untouched.
              const followQuery = subject && shown ? focusQuery(tab.viewId, subject, tab.query) : undefined;
              return (
                <ActiveContext.Provider key={`${tab.id}:${tab.viewId}`} value={active}>
                  <TabTitleContext.Provider value={titleSetter(tab.id)}>
                  <section
                    data-tab={tab.id}
                    hidden={!shown}
                    // A press anywhere in the other pane hands it the keyboard, then goes on to what was pressed.
                    onPointerDownCapture={pane && !active ? () => dispatch({ type: "activate", id: tab.id }) : undefined}
                    // A container: a view lays out for the width of its pane, not of the window,
                    // which in split view is half as wide.
                    className="@container relative flex min-h-0 min-w-0 flex-col"
                    style={{
                      order: pane === "b" ? 3 : 1,
                      flex: pane && split ? `${pane === "a" ? split.ratio : 1 - split.ratio} 1 0%` : "1 1 0%",
                    }}
                  >
                    {pane && (
                      <span
                        aria-hidden
                        className={`pointer-events-none absolute inset-x-0 top-0 z-40 h-[2px] transition-colors ${active ? "bg-accent" : "bg-transparent"}`}
                      />
                    )}
                    {subject && shown && follows(tab.viewId, subject) && (
                      <span aria-hidden className="pointer-events-none absolute inset-0 z-30 shadow-[inset_0_0_0_2px_color-mix(in_oklab,var(--accent)_50%,transparent)]" />
                    )}
                    <TableExportContext.Provider value={exportContext(tab)}>
                    <View
                      year={tab.year}
                      setYear={(y) => dispatch({ type: "set-year", id: tab.id, year: y })}
                      query={followQuery ?? tab.query}
                      setQuery={(q) => {
                        // Typing into a pane that is following lets the focus go and keeps what was typed.
                        if (followQuery !== undefined) {
                          releaseFocus();
                          if (q === followQuery) return;
                        }
                        dispatch({ type: "set-query", id: tab.id, query: q });
                      }}
                      focus={active ? focus : null}
                      onLanded={landed}
                      record={tab.record}
                      table={tab.table ?? NO_LAYOUT}
                      setTable={(t) => dispatch({ type: "set-table", id: tab.id, table: t })}
                      savedAs={favorites.find((f) => samePlace(f, tab))?.label ?? null}
                      saveView={(label) => saveFavoritePlace(tab, label)}
                      unsaveView={() => {
                        const hit = favorites.find((f) => samePlace(f, tab));
                        if (hit) removeFavorite(hit.id);
                      }}
                    />
                    </TableExportContext.Provider>
                  </section>
                  </TabTitleContext.Provider>
                </ActiveContext.Provider>
              );
            })}
            {splitShown && split && (
              <SplitDivider
                ratio={split.ratio}
                onRatio={(ratio) => dispatch({ type: "split-ratio", ratio })}
                onClose={() => dispatch({ type: "unsplit" })}
              />
            )}
            <BesideDropZone onDrop={(o) => actionById("open-side")?.run(o, env, { newTab: false, side: true }, {})} />
            <SelectionBar />
            {focusMode.mode && (
              <FocusPill
                mode={focusMode.mode}
                following={
                  ws.tabs.filter(
                    (t) => (splitShown && split ? t.id === split.a || t.id === split.b : t.id === ws.active) && follows(t.viewId, focusMode.mode!.subject),
                  ).length
                }
                // Stacked over whatever already sits at the foot: the selection bar, then the compare tray.
                bottom={16 + (selection.selection ? 48 : 0) + (compare.items.length > 0 ? 48 : 0)}
                onRelease={releaseFocus}
              />
            )}
            <KeyHints paused={!!focusMode.mode || paletteOpen} />
            <CompareDock
              lift={!!selection.selection}
              hidden={current.viewId === "compare" && current.query === compareQuery(compare.items)}
              onOpen={(items, newTab) => openView("compare", { query: compareQuery(items), newTab })}
            />
          </main>
        </div>

        {paletteOpen && (
          <CommandPalette
            groups={PALETTE_GROUPS}
            items={allItems}
            placeholder={search ? "Search teams, players, coaches and views, or ask a question" : "Search views, coaches and settings, or ask a question"}
            onClose={() => setPaletteOpen(false)}
            extra={typed}
            actionsFor={(o) => paletteItemsFor(o, env, "drill")}
          />
        )}
        {shortcutsOpen && <ShortcutsOverlay onClose={() => setShortcutsOpen(false)} />}
        {snapping && <SnapshotSheet card={objectCard(snapping)} onClose={() => setSnapping(null)} />}
        {namePrompt && (
          <NamePrompt
            title={namePrompt === "new" ? "Name the new workspace" : "Rename this workspace"}
            initial={namePrompt === "new" ? "" : workspaces.current.name}
            confirm={namePrompt === "new" ? "Create" : "Rename"}
            onDone={(name) =>
              namePrompt === "new"
                ? workspaces.create(name, { viewId: current.viewId, year: current.year })
                : workspaces.rename(workspaces.current.id, name)
            }
            onClose={() => setNamePrompt(null)}
          />
        )}
      </div>
      </StatLensProvider>
      </ObjectActionsProvider>
    </ShellContext.Provider>
  );
}

/** How a tab is named in a file or a history step: its title, and its season when it has one. */
function tabName(tab: Tab): string {
  const v = viewById(tab.viewId);
  return `${tab.title ?? tab.record?.name ?? v.label}${v.seasonless ? "" : ` ${seasonLabel(tab.year)}`}`;
}

/**
 * The theme choice lives in the renderer; nativeTheme follows it.
 *
 * Setting nativeTheme in the main process flips prefers-color-scheme inside this
 * page as well, so the page listens to that one media query and never has to
 * reconcile two sources of truth. "System" tracks the OS live.
 */
function useThemeMode(): [ThemeMode, (m: ThemeMode) => void] {
  const [mode, setMode] = useState<ThemeMode>(() => {
    try {
      const v = localStorage.getItem(THEME_KEY);
      if (v === "system" || v === "light" || v === "dark") return v;
    } catch {
      /* storage unavailable: fall back to the OS */
    }
    return "system";
  });

  useEffect(() => {
    window.bta.setTheme(mode);
    try {
      localStorage.setItem(THEME_KEY, mode);
    } catch {
      /* not persisted; the choice still applies for this session */
    }
  }, [mode]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme = mq.matches ? "dark" : "light";
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  return [mode, setMode];
}
