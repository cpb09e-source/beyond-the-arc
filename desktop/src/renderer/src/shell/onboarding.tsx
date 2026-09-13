import { Check, Moon, Sun, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ThemeMode } from "../../../preload";
import { Kbd } from "~/ui/kbd";

/**
 * Get started: five things worth knowing on day one, ticked off as they happen.
 *
 * A CHECKLIST, NOT A TOUR. A tour stands between a person and the app they just
 * opened to use; a list in the corner of the sidebar waits, and each line ticks
 * itself the first time its thing is done anywhere in the app, whether or not
 * the list prompted it. That is Linear's onboarding, and it respects someone who
 * already found Ctrl K on their own.
 *
 * Signalled from wherever the thing happens (signalOnboarding), stored straight
 * to disk, so a step counts even while the sidebar is hidden. Hidden for good by
 * its ×, and says so when everything is done.
 */

export type OnboardingStep = "theme" | "palette" | "peek" | "favorite" | "split";

const KEY = "bta.onboarding";
const EVENT = "bta:onboarding";

type State = { done: OnboardingStep[]; hidden: boolean };

const STEPS: Array<{ id: OnboardingStep; label: string; keys?: string }> = [
  { id: "theme", label: "Choose light or dark" },
  { id: "palette", label: "Find any team or player", keys: "Ctrl K" },
  { id: "peek", label: "Peek at a row", keys: "Space" },
  { id: "favorite", label: "Star a place to come back to", keys: "Ctrl D" },
  { id: "split", label: "Open a row to the side", keys: "Shift Enter" },
];

function read(): State {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (v && typeof v === "object") {
      const o = v as { done?: unknown; hidden?: unknown };
      const done = Array.isArray(o.done) ? o.done.filter((s): s is OnboardingStep => STEPS.some((x) => x.id === s)) : [];
      return { done, hidden: o.hidden === true };
    }
  } catch {
    /* unreadable: start fresh */
  }
  return { done: [], hidden: false };
}

function write(s: State): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* not persisted; the list still updates for this session */
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Marks a step done from wherever it happened: the palette opening, a Peek, a favorite. */
export function signalOnboarding(step: OnboardingStep): void {
  const s = read();
  if (s.done.includes(step)) return;
  write({ ...s, done: [...s.done, step] });
}

export function GetStarted({
  theme,
  setTheme,
  onOpenSearch,
}: {
  theme: ThemeMode;
  setTheme: (m: ThemeMode) => void;
  onOpenSearch: () => void;
}) {
  const [state, setState] = useState(read);
  useEffect(() => {
    const on = () => setState(read());
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);

  if (state.hidden) return null;
  const n = state.done.length;
  const all = n === STEPS.length;

  return (
    <section aria-label="Get started" className="mx-2 mb-2 min-w-0 overflow-hidden rounded-lg border border-hairline bg-paper px-3 pb-2 pt-2.5">
      <div className="flex items-center gap-2">
        <h2 className="text-[12.5px] font-medium text-ink">{all ? "You’re set" : "Get started"}</h2>
        <span className="text-[11.5px] text-ink-muted tabular">
          {n} of {STEPS.length}
        </span>
        <button
          type="button"
          aria-label="Hide Get started"
          title="Hide"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => write({ ...read(), hidden: true })}
          className="ml-auto grid size-5 place-items-center rounded text-ink-muted transition-colors hover:bg-[var(--row-hover)] hover:text-ink"
        >
          <X size={12} strokeWidth={2.25} />
        </button>
      </div>
      <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--ink)_8%,transparent)]">
        <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${(n / STEPS.length) * 100}%` }} />
      </div>
      {all ? (
        <p className="mt-2 text-[12px] leading-snug text-ink-muted">
          That is the tour. Press <Kbd>?</Kbd> for every shortcut whenever you want them.
        </p>
      ) : (
        <ul className="mt-1.5 grid grid-cols-[minmax(0,1fr)]">
          {STEPS.map((s) => {
            const done = state.done.includes(s.id);
            return (
              <li key={s.id} className="flex min-h-[26px] items-center gap-2 text-[12px]">
                <span
                  aria-hidden
                  className={`grid size-[14px] shrink-0 place-items-center rounded-full border transition-colors ${
                    done ? "border-accent bg-accent text-white" : "border-[color-mix(in_oklab,var(--ink-muted)_55%,transparent)]"
                  }`}
                >
                  {done && <Check size={9} strokeWidth={3} />}
                </span>
                {s.id === "palette" && !done ? (
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={onOpenSearch}
                    className="min-w-0 flex-1 truncate text-left text-ink-soft transition-colors hover:text-ink"
                  >
                    {s.label}
                  </button>
                ) : (
                  <span className={`min-w-0 flex-1 truncate ${done ? "text-ink-muted" : "text-ink-soft"}`}>
                    <span className="sr-only">{done ? "Done: " : ""}</span>
                    {s.label}
                  </span>
                )}
                {s.id === "theme" && !done ? (
                  <span className="flex shrink-0 gap-0.5">
                    {(["light", "dark"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        aria-label={m === "light" ? "Light" : "Dark"}
                        title={m === "light" ? "Light" : "Dark"}
                        aria-pressed={theme === m}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setTheme(m);
                          signalOnboarding("theme");
                        }}
                        className="grid size-[20px] place-items-center rounded-[5px] border border-hairline text-ink-soft transition-colors hover:border-ink-muted hover:text-ink"
                      >
                        {m === "light" ? <Sun size={11} strokeWidth={2} /> : <Moon size={11} strokeWidth={2} />}
                      </button>
                    ))}
                  </span>
                ) : s.keys && !done ? (
                  <Kbd>{s.keys}</Kbd>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
