import {
  CalendarRange,
  Check,
  ChevronLeft,
  ChevronRight,
  GitCompareArrows,
  Keyboard,
  ListFilter,
  LogIn,
  LogOut,
  Monitor,
  Moon,
  PanelLeft,
  Plus,
  RotateCcw,
  Sun,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ALL_SEASONS, isFlaggedSeason } from "@/lib/seasons";
import logoOnLight from "@public/images/btalogo_final-01.svg";
import logoOnDark from "@public/images/newbtalogo-white-01.svg";
import type { ThemeMode } from "../../preload";
import { loadSearchData } from "~/data/search-model";
import { useLoaded } from "~/data/use-corpus";
import { CommandPalette, type PaletteGroup, type PaletteItem } from "~/palette/command-palette";
import { objectItems } from "~/palette/object-items";
import { AccountProvider, useAccount } from "~/shell/account";
import { CompareDock, CompareProvider, compareQuery, useCompare } from "~/shell/compare";
import { ActiveContext } from "~/shell/active";
import { ShellContext } from "~/shell/shell-context";
import { ShortcutsOverlay } from "~/shell/shortcuts";
import { SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN, Sidebar } from "~/shell/sidebar";
import { TabStrip } from "~/shell/tab-strip";
import { NAV_VIEWS, profileViewFor, viewById, type FocusRequest, type FocusTarget, type RecordRef } from "~/shell/views";
import { Welcome } from "~/shell/welcome";
import { useWorkspace, type Tab } from "~/shell/workspace";
import { seasonLabel } from "~/ui/format";
import { Kbd } from "~/ui/kbd";
import { usePersisted } from "~/ui/persisted";
import { ToastProvider, useToast } from "~/ui/toast";

const THEME_KEY = "bta.theme";

/**
 * The palette's sections, in their resting order. Before anything is typed it
 * offers only where to go and what to do here; everything else waits for a word,
 * so the first look is short enough to read.
 */
const PALETTE_GROUPS: PaletteGroup[] = [
  { id: "views", heading: "Go to", limit: 8, showWhenEmpty: true },
  { id: "actions", heading: "Actions", limit: 8, showWhenEmpty: true },
  { id: "teams", heading: "Teams", limit: 5, showWhenEmpty: false },
  { id: "players", heading: "Players", limit: 6, showWhenEmpty: false },
  { id: "seasons", heading: "Seasons", limit: 5, showWhenEmpty: false },
  { id: "settings", heading: "Settings", limit: 5, showWhenEmpty: false },
];

export function App() {
  return (
    <AccountProvider>
      <ToastProvider>
        <CompareProvider>
          <Frame />
        </CompareProvider>
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
  const [sidebarWidth, setSidebarWidth] = usePersisted<number>(
    "bta.sidebar.width",
    SIDEBAR_DEFAULT,
    (v): v is number => typeof v === "number" && v >= SIDEBAR_MIN && v <= SIDEBAR_MAX,
  );
  const [collapsed, setCollapsed] = usePersisted<boolean>(
    "bta.sidebar.collapsed",
    false,
    (v): v is boolean => typeof v === "boolean",
  );
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const nonce = useRef(0);
  const filterRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const { auth, update } = useAccount();
  const compare = useCompare();

  const current = ws.tabs.find((t) => t.id === ws.active) ?? ws.tabs[0]!;
  const view = viewById(current.viewId);

  // The tab in front, for callbacks that must stay stable across tab switches:
  // rebuilding thirty thousand search rows on every Ctrl+Tab would be felt.
  const currentRef = useRef<Tab>(current);
  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  const trayRef = useRef(compare.items);
  useEffect(() => {
    trayRef.current = compare.items;
  }, [compare.items]);

  const navigate = useCallback(
    (viewId: string, newTab: boolean) => {
      const tab = currentRef.current;
      // Going to Compare with a full tray means comparing the tray; an empty
      // Compare tab would only tell the reader how to fill it.
      const tray = trayRef.current;
      const query = viewId === "compare" && tray.length > 1 && tab.viewId !== "compare" ? compareQuery(tray) : undefined;
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

  /** Open a team or player profile, here (history remembers the way back) or in a new tab. */
  const openRecord = useCallback(
    (record: RecordRef, how: { newTab?: boolean; year?: number } = {}) => {
      const tab = currentRef.current;
      const viewId = profileViewFor(record.kind);
      const year = how.year ?? tab.year;
      dispatch(how.newTab ? { type: "open", viewId, year, record } : { type: "navigate", viewId, year, record });
    },
    [dispatch],
  );

  /** Open a view with a starting query: the predictor on the team a page is about, say. */
  const openView = useCallback(
    (viewId: string, how: { newTab?: boolean; query?: string; year?: number } = {}) => {
      const year = how.year ?? currentRef.current.year;
      dispatch(
        how.newTab
          ? { type: "open", viewId, year, query: how.query }
          : { type: "navigate", viewId, year, query: how.query },
      );
    },
    [dispatch],
  );

  const shell = useMemo(() => ({ filterRef, openRecord, openView, showInExplorer: go }), [openRecord, openView, go]);

  // The site's search indexes, loaded in the background at launch so the first
  // Ctrl+K already reaches every team and player.
  const [searchState] = useLoaded("search", loadSearchData);
  const search = searchState.status === "ready" ? searchState.value : null;
  const objects = useMemo(() => (search ? objectItems(search, openRecord) : []), [search, openRecord]);

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
      if (mod && e.code === "KeyT") return take(() => (e.shiftKey ? dispatch({ type: "reopen" }) : newTab()));
      if (mod && !e.shiftKey && e.code === "KeyW") return take(() => dispatch({ type: "close", id: tab.id }));
      if (mod && e.code === "Tab") return take(() => dispatch({ type: "cycle", by: e.shiftKey ? -1 : 1 }));
      if (mod && /^Digit[1-9]$/.test(e.code)) {
        return take(() => dispatch({ type: "activate-index", index: Number(e.code.slice(5)) - 1 }));
      }
      if (mod && e.code === "Backslash") return take(() => setCollapsed((c) => !c));
      if (e.altKey && !mod && (e.code === "ArrowLeft" || e.code === "ArrowRight")) {
        return take(() => dispatch({ type: e.code === "ArrowLeft" ? "back" : "forward" }));
      }
      if (mod || e.altKey || typing) return;
      if (e.key === "?") take(() => setShortcutsOpen(true));
      else if (e.key === "/") take(focusFilter);
      else if (e.key === "[" || e.key === "]") take(() => dispatch({ type: "step-year", to: e.key === "[" ? "older" : "newer" }));
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
  }, [dispatch, focusFilter, newTab, setCollapsed]);

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
  const paletteItems = useMemo<PaletteItem[]>(() => {
    const currentMark = <Check size={14} strokeWidth={2.25} className="text-accent" />;
    const items: PaletteItem[] = [];

    for (const v of NAV_VIEWS) {
      const Icon = v.icon;
      items.push({
        id: `view:${v.id}`,
        group: "views",
        title: v.label,
        subtitle: v.section,
        keywords: ["open", "go"],
        // Places in the app come before anything named like them.
        weight: 40,
        leading: <Icon size={15} strokeWidth={2} />,
        trailing: v.id === view.id ? currentMark : undefined,
        run: (how) => navigate(v.id, how.newTab),
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
    if (older != null) {
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
    if (newer != null) {
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
        run: (how) => openView("compare", { query: compareQuery(compare.items), newTab: how.newTab }),
      });
    }
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
    action({
      id: "action:sidebar",
      title: collapsed ? "Show sidebar" : "Hide sidebar",
      keywords: ["sidebar", "navigation", "panel", "toggle"],
      leading: <PanelLeft size={15} strokeWidth={2} />,
      trailing: <Kbd>Ctrl \</Kbd>,
      run: () => setCollapsed((c) => !c),
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
  }, [view, current, ws.closed, collapsed, theme, auth, navigate, focusFilter, dispatch, setCollapsed, setTheme, compare.items, openView]);

  const allItems = useMemo(
    () => (objects.length > 0 ? [...paletteItems, ...objects] : paletteItems),
    [paletteItems, objects],
  );

  return (
    <ShellContext.Provider value={shell}>
      <div className="flex h-full flex-col">
        {/* The title bar is the window's drag handle; tabs and buttons opt out.
            On Windows the caption buttons are drawn natively over its right end. */}
        <header className="drag flex h-[40px] shrink-0 items-center border-b border-hairline bg-chrome">
          <div
            className="flex h-full shrink-0 items-center gap-1.5 pl-2"
            style={{ width: collapsed ? undefined : sidebarWidth }}
          >
            <button
              type="button"
              aria-label={collapsed ? "Show sidebar" : "Hide sidebar"}
              title={`${collapsed ? "Show" : "Hide"} sidebar  Ctrl \\`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setCollapsed((c) => !c)}
              className="no-drag grid size-[28px] place-items-center rounded-md text-ink-muted transition-colors hover:bg-[var(--row-hover)] hover:text-ink"
            >
              <PanelLeft size={15} strokeWidth={2} />
            </button>
            {!collapsed && (
              <span className="flex items-center pl-0.5">
                {/* The site's wordmark in both inks; CSS shows the one this ground needs. */}
                <img src={logoOnLight} alt="Beyond the Arc" draggable={false} className="bta-logo-light h-[17px] w-auto" />
                <img src={logoOnDark} alt="Beyond the Arc" draggable={false} className="bta-logo-dark h-[17px] w-auto" />
              </span>
            )}
          </div>
          <TabStrip
            tabs={ws.tabs}
            active={ws.active}
            onActivate={(id) => dispatch({ type: "activate", id })}
            onClose={(id) => dispatch({ type: "close", id })}
            onNew={newTab}
            onMove={(id, to) => dispatch({ type: "move", id, to })}
          />
        </header>

        <div className="flex min-h-0 flex-1">
          {!collapsed && (
            <Sidebar
              width={sidebarWidth}
              onResize={setSidebarWidth}
              currentViewId={current.viewId}
              onNavigate={navigate}
              onOpenSearch={() => setPaletteOpen(true)}
              onOpenShortcuts={() => setShortcutsOpen(true)}
              theme={theme}
              setTheme={setTheme}
            />
          )}

          <main className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-paper">
            {ws.tabs.map((tab) => {
              const View = viewById(tab.viewId).Component;
              const active = tab.id === ws.active;
              return (
                <ActiveContext.Provider key={`${tab.id}:${tab.viewId}`} value={active}>
                  <section hidden={!active} className="flex min-h-0 flex-1 flex-col">
                    <View
                      year={tab.year}
                      setYear={(y) => dispatch({ type: "set-year", id: tab.id, year: y })}
                      query={tab.query}
                      setQuery={(q) => dispatch({ type: "set-query", id: tab.id, query: q })}
                      focus={active ? focus : null}
                      onLanded={landed}
                      record={tab.record}
                    />
                  </section>
                </ActiveContext.Provider>
              );
            })}
            <CompareDock
              hidden={current.viewId === "compare" && current.query === compareQuery(compare.items)}
              onOpen={(items, newTab) => openView("compare", { query: compareQuery(items), newTab })}
            />
          </main>
        </div>

        {paletteOpen && (
          <CommandPalette
            groups={PALETTE_GROUPS}
            items={allItems}
            placeholder={search ? "Search teams, players, views and seasons" : "Search views, seasons and settings"}
            onClose={() => setPaletteOpen(false)}
          />
        )}
        {shortcutsOpen && <ShortcutsOverlay onClose={() => setShortcutsOpen(false)} />}
      </div>
    </ShellContext.Provider>
  );
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
