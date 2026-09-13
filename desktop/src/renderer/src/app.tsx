import { CalendarRange, Check, ChevronLeft, ChevronRight, ListFilter, Monitor, Moon, Sun } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { ALL_SEASONS, SEASON_CEIL, isFlaggedSeason } from "@/lib/seasons";
import logoOnLight from "@public/images/btalogo_final-01.svg";
import logoOnDark from "@public/images/newbtalogo-white-01.svg";
import type { ThemeMode } from "../../preload";
import { StatusContext } from "~/shell/status";
import { VIEWS, viewById, type FocusRequest, type FocusTarget, type ViewDef } from "~/shell/views";
import { loadSearchData } from "~/data/search-model";
import { useLoaded } from "~/data/use-corpus";
import { CommandPalette, type PaletteGroup, type PaletteItem } from "~/palette/command-palette";
import { objectItems } from "~/palette/object-items";
import { seasonLabel } from "~/ui/format";
import { Kbd } from "~/ui/kbd";

const THEME_KEY = "bta.theme";
const VIEW_KEY = "bta.view";
const SEASON_KEY = "bta.season";

/**
 * The palette's sections, in their resting order. Before anything is typed it
 * offers only where to go and what to do here; seasons and themes wait for a
 * word, so the first look is short enough to read.
 */
const PALETTE_GROUPS: PaletteGroup[] = [
  { id: "views", heading: "Go to", limit: 8, showWhenEmpty: true },
  { id: "actions", heading: "Actions", limit: 6, showWhenEmpty: true },
  { id: "teams", heading: "Teams", limit: 5, showWhenEmpty: false },
  { id: "players", heading: "Players", limit: 6, showWhenEmpty: false },
  { id: "seasons", heading: "Seasons", limit: 5, showWhenEmpty: false },
  { id: "settings", heading: "Theme", limit: 3, showWhenEmpty: false },
];

/**
 * The frame: title bar, sidebar, the current view, status bar.
 *
 * THE SEASON BELONGS TO THE WORKSPACE, not to a view. Moving from Team Explorer
 * to a game log keeps you in 2022-23, because the question you were asking was
 * about 2022-23. And the app reopens where you left it, view and season both.
 */
export function App() {
  const [viewId, setViewId] = usePersisted<string>(VIEW_KEY, VIEWS[0]!.id, (v): v is string => typeof v === "string");
  const [year, setYear] = usePersisted<number>(
    SEASON_KEY,
    SEASON_CEIL,
    (v): v is number => typeof v === "number" && ALL_SEASONS.includes(v),
  );
  const [queries, setQueries] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [theme, setTheme] = useThemeMode();
  const filterRef = useRef<HTMLInputElement>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const nonce = useRef(0);

  /**
   * Take the app to one object: its view, its season, its row, Peek pinned.
   * The target view's filter is cleared on the way, or it could hide the row.
   */
  const go = useCallback(
    (target: FocusTarget) => {
      const viewId = target.kind === "team" ? "team-explorer" : "player-explorer";
      nonce.current += 1;
      setViewId(viewId);
      setYear(target.year);
      setQueries((q) => (q[viewId] ? { ...q, [viewId]: "" } : q));
      setFocus({ ...target, nonce: nonce.current });
    },
    [setViewId, setYear],
  );
  const landed = useCallback((n: number) => setFocus((f) => (f?.nonce === n ? null : f)), []);

  // The site's search indexes, loaded in the background at launch so the first
  // Ctrl K already reaches every team and player.
  const [searchState] = useLoaded("search", loadSearchData);
  const search = searchState.status === "ready" ? searchState.value : null;
  const objects = useMemo(() => (search ? objectItems(search, go) : []), [search, go]);

  const view = viewById(viewId);
  const query = queries[view.id] ?? "";

  const focusFilter = useCallback(() => {
    filterRef.current?.focus();
    filterRef.current?.select();
  }, []);

  /** ALL_SEASONS runs newest first. */
  const stepSeason = useCallback(
    (to: "older" | "newer") =>
      setYear((y) => {
        const i = ALL_SEASONS.indexOf(y);
        return (to === "older" ? ALL_SEASONS[i + 1] : ALL_SEASONS[i - 1]) ?? y;
      }),
    [setYear],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl K reaches everything; Ctrl F and / filter the table in front of you.
      // While the palette is open, its keys end inside it and never arrive here.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        focusFilter();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "/") {
        e.preventDefault();
        focusFilter();
      } else if (e.key === "[" || e.key === "]") {
        e.preventDefault();
        stepSeason(e.key === "[" ? "older" : "newer");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusFilter, stepSeason]);

  /**
   * Everything the palette can do right now. Rebuilt when the view, season or
   * theme changes, because rows mark which one is current and name what "here" is.
   */
  const paletteItems = useMemo<PaletteItem[]>(() => {
    const current = <Check size={14} strokeWidth={2.25} className="text-accent" />;
    const items: PaletteItem[] = [];

    for (const v of VIEWS) {
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
        trailing: v.id === view.id ? current : undefined,
        run: () => setViewId(v.id),
      });
    }

    items.push({
      id: "action:filter",
      group: "actions",
      title: `Filter ${view.label}`,
      keywords: ["find", "search", "table", "rows"],
      weight: 35,
      leading: <ListFilter size={15} strokeWidth={2} />,
      trailing: <Kbd>Ctrl F</Kbd>,
      run: focusFilter,
    });
    const at = ALL_SEASONS.indexOf(year);
    const older = ALL_SEASONS[at + 1];
    const newer = ALL_SEASONS[at - 1];
    if (older != null) {
      items.push({
        id: "action:older",
        group: "actions",
        title: "Older season",
        subtitle: seasonLabel(older),
        keywords: ["previous", "back", "earlier", "season"],
        weight: 35,
        leading: <ChevronLeft size={15} strokeWidth={2} />,
        trailing: <Kbd>[</Kbd>,
        run: () => stepSeason("older"),
      });
    }
    if (newer != null) {
      items.push({
        id: "action:newer",
        group: "actions",
        title: "Newer season",
        subtitle: seasonLabel(newer),
        keywords: ["next", "forward", "later", "season"],
        weight: 35,
        leading: <ChevronRight size={15} strokeWidth={2} />,
        trailing: <Kbd>]</Kbd>,
        run: () => stepSeason("newer"),
      });
    }

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
        trailing: y === year ? current : undefined,
        run: () => setYear(y),
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
        trailing: theme === mode ? current : undefined,
        run: () => setTheme(mode),
      });
    }

    return items;
  }, [view, year, theme, setViewId, setYear, setTheme, focusFilter, stepSeason]);

  const allItems = useMemo(
    () => (objects.length > 0 ? [...paletteItems, ...objects] : paletteItems),
    [paletteItems, objects],
  );

  const Current = view.Component;

  return (
    <div className="grid h-full grid-cols-[216px_minmax(0,1fr)] grid-rows-[40px_minmax(0,1fr)_28px]">
      {/* The title bar is the window's drag handle. On Windows the caption
          buttons are drawn natively over its right end, in the theme's colors. */}
      <header className="drag col-span-2 flex items-center border-b border-hairline bg-chrome">
        <div className="flex w-[216px] shrink-0 items-center pl-4">
          {/* The site's wordmark in both inks; CSS shows the one this ground needs. */}
          <img src={logoOnLight} alt="Beyond the Arc" draggable={false} className="bta-logo-light h-[20px] w-auto" />
          <img src={logoOnDark} alt="Beyond the Arc" draggable={false} className="bta-logo-dark h-[20px] w-auto" />
        </div>
        <label className="no-drag ml-5 flex h-[26px] w-[min(420px,38vw)] items-center gap-2 rounded-md border border-hairline bg-paper px-2.5 transition-colors focus-within:border-accent">
          <svg aria-hidden viewBox="0 0 24 24" className="h-[14px] w-[14px] shrink-0 stroke-current text-ink-muted" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={filterRef}
            value={query}
            onChange={(e) => setQueries((q) => ({ ...q, [view.id]: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.preventDefault();
              if (query) setQueries((q) => ({ ...q, [view.id]: "" }));
              else e.currentTarget.blur();
            }}
            placeholder={view.filterPlaceholder}
            aria-label={view.filterPlaceholder}
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-muted"
          />
          <Kbd>Ctrl F</Kbd>
        </label>
      </header>

      <Sidebar current={view} onPick={setViewId} theme={theme} setTheme={setTheme} />

      <main className="flex min-h-0 min-w-0 flex-col bg-paper">
        <StatusContext.Provider value={setStatus}>
          <Current key={view.id} year={year} setYear={setYear} query={query} focus={focus} onLanded={landed} />
        </StatusContext.Provider>
      </main>

      <footer className="col-span-2 flex items-center gap-5 border-t border-hairline bg-chrome px-4 text-[11.5px] text-ink-muted">
        <span className="tabular">{status}</span>
        <span className="flex-1" />
        <Hint keys={["↑", "↓"]} label="move" />
        <Hint keys={["Space"]} label="peek" />
        <Hint keys={["[", "]"]} label="season" />
        <Hint keys={["Ctrl F"]} label="filter" />
        <Hint keys={["Ctrl K"]} label="search" />
      </footer>

      {paletteOpen && (
        <CommandPalette
          groups={PALETTE_GROUPS}
          items={allItems}
          placeholder={search ? "Search teams, players, views and seasons" : "Search views, seasons and settings"}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </div>
  );
}

function Sidebar({
  current,
  onPick,
  theme,
  setTheme,
}: {
  current: ViewDef;
  onPick: (id: string) => void;
  theme: ThemeMode;
  setTheme: (m: ThemeMode) => void;
}) {
  const sections: Array<[string, ViewDef[]]> = [];
  for (const v of VIEWS) {
    const group = sections.find(([s]) => s === v.section);
    if (group) group[1].push(v);
    else sections.push([v.section, [v]]);
  }

  return (
    <nav aria-label="Workspace" className="flex min-h-0 flex-col border-r border-hairline bg-chrome">
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-3">
        {sections.map(([section, views]) => (
          <div key={section} className="mb-4">
            <div className="px-2 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-muted">{section}</div>
            <ul className="grid gap-px">
              {views.map((v) => {
                const active = v.id === current.id;
                const Icon = v.icon;
                return (
                  <li key={v.id}>
                    <button
                      type="button"
                      aria-current={active ? "page" : undefined}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onPick(v.id)}
                      className={`flex h-[28px] w-full items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors ${
                        active ? "bg-[var(--row-focus)] font-medium text-ink" : "text-ink-soft hover:bg-[var(--row-hover)] hover:text-ink"
                      }`}
                    >
                      <Icon size={15} strokeWidth={2} className={active ? "text-accent" : "text-ink-muted"} />
                      <span className="truncate">{v.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <ThemeSwitch value={theme} onChange={setTheme} />
    </nav>
  );
}

function Hint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      {keys.map((k) => (
        <Kbd key={k}>{k}</Kbd>
      ))}
      <span>{label}</span>
    </span>
  );
}

function ThemeSwitch({ value, onChange }: { value: ThemeMode; onChange: (m: ThemeMode) => void }) {
  const options: { mode: ThemeMode; label: string }[] = [
    { mode: "system", label: "System" },
    { mode: "light", label: "Light" },
    { mode: "dark", label: "Dark" },
  ];
  return (
    <div role="radiogroup" aria-label="Theme" className="m-3 grid grid-cols-3 gap-0.5 rounded-md border border-hairline bg-paper p-0.5">
      {options.map((o) => (
        <button
          key={o.mode}
          type="button"
          role="radio"
          aria-checked={value === o.mode}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange(o.mode)}
          className={`h-[22px] rounded-[4px] text-[11.5px] transition-colors ${
            value === o.mode ? "bg-[var(--accent-wash)] font-medium text-ink" : "text-ink-muted hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** State that survives a relaunch, validated on the way back in. */
function usePersisted<T>(key: string, fallback: T, valid: (v: unknown) => v is T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw != null) {
        const parsed: unknown = JSON.parse(raw);
        if (valid(parsed)) return parsed;
      }
    } catch {
      /* unreadable: fall back */
    }
    return fallback;
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* not persisted; still applies for this session */
    }
  }, [key, value]);
  return [value, setValue];
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
