import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { ALL_SEASONS, SEASON_CEIL } from "@/lib/seasons";
import logoOnLight from "@public/images/btalogo_final-01.svg";
import logoOnDark from "@public/images/newbtalogo-white-01.svg";
import type { ThemeMode } from "../../preload";
import { StatusContext } from "~/shell/status";
import { VIEWS, viewById, type ViewDef } from "~/shell/views";
import { Kbd } from "~/ui/kbd";

const THEME_KEY = "bta.theme";
const VIEW_KEY = "bta.view";
const SEASON_KEY = "bta.season";

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

  const view = viewById(viewId);
  const query = queries[view.id] ?? "";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl K focuses the filter for now; the action palette takes it over later.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        filterRef.current?.focus();
        filterRef.current?.select();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      // [ older season, ] newer. ALL_SEASONS runs newest first.
      if (e.key === "[" || e.key === "]") {
        e.preventDefault();
        setYear((y) => {
          const i = ALL_SEASONS.indexOf(y);
          return (e.key === "[" ? ALL_SEASONS[i + 1] : ALL_SEASONS[i - 1]) ?? y;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setYear]);

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
          <Kbd>Ctrl K</Kbd>
        </label>
      </header>

      <Sidebar current={view} onPick={setViewId} theme={theme} setTheme={setTheme} />

      <main className="flex min-h-0 min-w-0 flex-col bg-paper">
        <StatusContext.Provider value={setStatus}>
          <Current key={view.id} year={year} setYear={setYear} query={query} />
        </StatusContext.Provider>
      </main>

      <footer className="col-span-2 flex items-center gap-5 border-t border-hairline bg-chrome px-4 text-[11.5px] text-ink-muted">
        <span className="tabular">{status}</span>
        <span className="flex-1" />
        <Hint keys={["↑", "↓"]} label="move" />
        <Hint keys={["Space"]} label="peek" />
        <Hint keys={["[", "]"]} label="season" />
        <Hint keys={["Ctrl K"]} label="filter" />
      </footer>
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
