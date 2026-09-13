import { useEffect, useRef, useState } from "react";
import { ALL_SEASONS, isFlaggedSeason, SEASON_CEIL, seasonFlagNote } from "@/lib/seasons";
import logoOnLight from "@public/images/btalogo_final-01.svg";
import logoOnDark from "@public/images/newbtalogo-white-01.svg";
import type { SeasonSource, ThemeMode } from "../../preload";
import { useSeason, type SeasonState } from "~/data/use-season";
import { seasonLabel } from "~/ui/format";
import { Kbd } from "~/ui/kbd";
import { TeamTable } from "~/views/team-table";

/** Where the open season's file came from, in the words a person would use. */
const SOURCE: Record<SeasonSource, string> = {
  memory: "Already open",
  repo: "Read from the site's data folder",
  cache: "Read from this computer",
  network: "Downloaded from btacbb.xyz",
};

const THEME_KEY = "bta.theme";

export function App() {
  const [year, setYear] = useState<number>(SEASON_CEIL);
  const [query, setQuery] = useState("");
  const [count, setCount] = useState<number | null>(null);
  const [theme, setTheme] = useThemeMode();
  const [state, retry] = useSeason(year);
  const filterRef = useRef<HTMLInputElement>(null);

  // Ctrl K focuses the filter for now. The command palette takes this key over
  // in P1, and the filter becomes one of the things it can do.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        filterRef.current?.focus();
        filterRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const total = state.status === "ready" ? state.season.teams.length : null;
  const filtered = total != null && count != null && query.trim() !== "" && count !== total;

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
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              e.preventDefault();
              if (query) setQuery("");
              else e.currentTarget.blur();
            }}
            placeholder="Filter teams or conferences"
            aria-label="Filter teams or conferences"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-muted"
          />
          <Kbd>Ctrl K</Kbd>
        </label>
      </header>

      <nav aria-label="Seasons" className="flex min-h-0 flex-col border-r border-hairline bg-chrome">
        <div className="px-4 pb-1.5 pt-4 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
          Teams
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {ALL_SEASONS.map((y) => {
            const active = y === year;
            return (
              <li key={y}>
                <button
                  type="button"
                  aria-current={active ? "true" : undefined}
                  title={seasonFlagNote(y) ?? undefined}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setYear(y);
                    setCount(null);
                  }}
                  className={`flex h-[28px] w-full items-center justify-between rounded-md px-2 text-[13px] transition-colors ${
                    active ? "bg-[var(--row-focus)] font-medium text-ink" : "text-ink-soft hover:bg-[var(--row-hover)] hover:text-ink"
                  }`}
                >
                  <span className="tabular">{seasonLabel(y)}</span>
                  {isFlaggedSeason(y) && (
                    <span className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Covid</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        <ThemeSwitch value={theme} onChange={setTheme} />
      </nav>

      <main className="flex min-h-0 min-w-0 flex-col bg-paper">
        <div className="flex shrink-0 items-end justify-between gap-4 px-5 pb-3 pt-4">
          <div className="min-w-0">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-accent">Teams</div>
            <h1 className="mt-1 text-[21px] font-semibold leading-none tracking-[-0.015em] text-ink tabular">
              {seasonLabel(year)}
            </h1>
          </div>
          {total != null && (
            <div className="pb-0.5 text-[12px] text-ink-muted tabular" title="Completed seasons never change">
              {filtered ? `${count} of ${total} teams` : `${total} teams`} · Final
            </div>
          )}
        </div>
        <div className="relative min-h-0 flex-1 border-t border-hairline">
          {state.status === "ready" ? (
            <TeamTable key={year} season={state.season} query={query} onCount={setCount} />
          ) : state.status === "loading" ? (
            <TableSkeleton />
          ) : (
            <LoadError state={state} onRetry={retry} />
          )}
        </div>
      </main>

      <footer className="col-span-2 flex items-center gap-5 border-t border-hairline bg-chrome px-4 text-[11.5px] text-ink-muted">
        <span className="tabular">
          {state.status === "ready"
            ? `${SOURCE[state.source]} in ${state.ms} ms`
            : state.status === "loading"
              ? "Loading…"
              : "Not loaded"}
        </span>
        <span className="flex-1" />
        <Hint keys={["↑", "↓"]} label="move" />
        <Hint keys={["Space"]} label="peek" />
        <Hint keys={["Ctrl K"]} label="filter" />
      </footer>
    </div>
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

/** Rows shaped like the table's, so the switch from loading to loaded does not jump. */
function TableSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading teams" className="absolute inset-0 overflow-hidden">
      <div className="h-8 border-b border-hairline" />
      {Array.from({ length: 20 }, (_, i) => (
        <div key={i} className="flex h-[34px] items-center gap-4 border-b border-hairline/50 px-3">
          <span className="skeleton h-[8px] w-[22px] rounded" />
          <span className="skeleton h-[18px] w-[18px] rounded" />
          <span className="skeleton h-[8px] rounded" style={{ width: 90 + ((i * 37) % 70) }} />
          <span className="skeleton ml-auto h-[8px] w-[46%] rounded" />
        </div>
      ))}
    </div>
  );
}

function LoadError({
  state,
  onRetry,
}: {
  state: Extract<SeasonState, { status: "error" }>;
  onRetry: () => void;
}) {
  return (
    <div className="grid h-full place-content-center gap-2.5 px-6 text-center">
      {state.reason === "gated" ? (
        <>
          <p className="text-[14px] font-medium text-ink">{seasonLabel(state.year)} is part of the Season Pass.</p>
          <p className="mx-auto max-w-[46ch] text-[12.5px] text-ink-muted">
            Signing in to the desktop app is not available yet, so this season only opens when running from the repo.
          </p>
        </>
      ) : (
        <>
          <p className="text-[14px] font-medium text-ink">{seasonLabel(state.year)} did not load.</p>
          <p className="mx-auto max-w-[46ch] text-[12.5px] text-ink-muted">{state.message}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mx-auto mt-1 h-7 rounded-md border border-hairline px-3 text-[12px] text-ink transition-colors hover:border-ink-muted"
          >
            Try again
          </button>
        </>
      )}
    </div>
  );
}
