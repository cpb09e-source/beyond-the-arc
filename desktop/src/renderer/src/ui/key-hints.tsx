import { useEffect, useRef, useState } from "react";
import { Kbd } from "~/ui/kbd";

/**
 * Discovery hints for the two gestures nobody finds by looking: hold Q and every
 * pane follows what is under the pointer; Alt-click a number and it opens into
 * the games behind it.
 *
 * A HINT, NOT A TOUR. It appears beside the pointer only once the pointer has
 * rested on something the gesture works on (a team, player or conference for Q;
 * a number with a Stat Lens for Alt-click), once per run of the app, on three
 * runs in all, and never again once the gesture has been used, whether or not
 * its hint was ever seen. Get started (~/shell/onboarding.tsx) covers Ctrl K,
 * Space and the rest.
 *
 * IT READS WHAT THE GESTURES READ. Focus finds its subject through data-obj
 * (~/focus/focus-mode.tsx); a table whose numbers open a Lens says so with
 * data-lens-cells (~/table/data-table.tsx).
 *
 * OUT OF THE WAY. Nothing listens once every hint is used or spent. A key, a
 * press or a scroll puts a showing hint away, and none shows while Focus is on,
 * the palette is open, or the pointer is over a menu, a list or a field.
 */

export type HintId = "focus" | "lens";
type HintState = Record<HintId, { shown: number; used: boolean }>;

const KEY = "bta.hints";
const USED_EVENT = "bta:hint-used";
const MAX_SHOWS = 3;
const DWELL_MS = 1100;
const SHOW_MS = 5000;
const IDS: HintId[] = ["focus", "lens"];

function read(): HintState {
  const fresh: HintState = { focus: { shown: 0, used: false }, lens: { shown: 0, used: false } };
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!v || typeof v !== "object") return fresh;
    for (const id of IDS) {
      const h = (v as Record<string, { shown?: unknown; used?: unknown }>)[id];
      if (h) fresh[id] = { shown: typeof h.shown === "number" ? h.shown : 0, used: h.used === true };
    }
  } catch {
    /* unreadable: start fresh */
  }
  return fresh;
}

function write(s: HintState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* not kept; a hint may show again next run */
  }
}

/** Called where a gesture happens. Once used, its hint never shows again. */
export function markHintUsed(id: HintId): void {
  const s = read();
  if (!s[id].used) write({ ...s, [id]: { ...s[id], used: true } });
  window.dispatchEvent(new CustomEvent(USED_EVENT, { detail: id }));
}

const shownThisRun = new Set<HintId>();
const eligible = (s: HintState, id: HintId) => !s[id].used && s[id].shown < MAX_SHOWS && !shownThisRun.has(id);
const spent = (s: HintState) => IDS.every((id) => s[id].used || s[id].shown >= MAX_SHOWS);

type Hint = { id: HintId; el: Element; name?: string; x: number; y: number };

/** The hint the element under the pointer calls for, if any is still due. */
function hintAt(x: number, y: number, s: HintState): Hint | null {
  const el = document.elementFromPoint(x, y);
  if (!el || el.closest("[role=dialog], [role=menu], [role=listbox], [role=status], input, textarea, button")) return null;
  const host = el.closest("[data-obj]");
  if (host && eligible(s, "focus")) {
    try {
      const o = JSON.parse(host.getAttribute("data-obj") ?? "null") as { kind?: string; name?: string; label?: string } | null;
      if (o && (o.kind === "team" || o.kind === "player" || o.kind === "conference")) {
        return { id: "focus", el: host, name: o.kind === "conference" ? o.label : o.name, x, y };
      }
    } catch {
      /* not an object after all */
    }
  }
  const cell = el.closest("[data-col]");
  if (cell && cell.closest("[data-lens-cells]") && /\d/.test(cell.textContent ?? "") && eligible(s, "lens")) return { id: "lens", el: cell, x, y };
  return null;
}

export function KeyHints({ paused }: { paused: boolean }) {
  const [hint, setHint] = useState<Hint | null>(null);
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
    if (paused) setHint(null);
  }, [paused]);

  useEffect(() => {
    if (spent(read())) return;
    let dwell: number | null = null;
    let hide: number | null = null;
    let resting: Element | null = null;
    let showing: Hint | null = null;

    const put = () => {
      if (dwell != null) window.clearTimeout(dwell);
      if (hide != null) window.clearTimeout(hide);
      dwell = hide = null;
      resting = null;
      if (showing) {
        showing = null;
        setHint(null);
      }
    };
    const onMove = (e: PointerEvent) => {
      if (e.buttons || pausedRef.current || document.hidden) return;
      const s = read();
      const h = hintAt(e.clientX, e.clientY, s);
      if (showing) {
        if (h?.el !== showing.el) put();
        return;
      }
      if (h?.el === resting) return;
      if (dwell != null) window.clearTimeout(dwell);
      dwell = null;
      resting = h?.el ?? null;
      if (!h) return;
      dwell = window.setTimeout(() => {
        dwell = null;
        const now = read();
        if (pausedRef.current || !eligible(now, h.id)) return;
        shownThisRun.add(h.id);
        write({ ...now, [h.id]: { ...now[h.id], shown: now[h.id].shown + 1 } });
        showing = h;
        setHint(h);
        hide = window.setTimeout(put, SHOW_MS);
      }, DWELL_MS);
    };
    const onUsed = (e: Event) => {
      if (showing && (e as CustomEvent<HintId>).detail === showing.id) put();
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("keydown", put, true);
    window.addEventListener("pointerdown", put, true);
    window.addEventListener("wheel", put, { passive: true });
    window.addEventListener("blur", put);
    window.addEventListener(USED_EVENT, onUsed);
    return () => {
      put();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("keydown", put, true);
      window.removeEventListener("pointerdown", put, true);
      window.removeEventListener("wheel", put);
      window.removeEventListener("blur", put);
      window.removeEventListener(USED_EVENT, onUsed);
    };
  }, []);

  if (!hint) return null;
  // Beside the pointer and level with it, inside the row it names: below the pointer it sat on the
  // next row down, and "every pane follows Illinois" read as a label for Florida.
  const box = hint.el.getBoundingClientRect();
  const left = Math.max(8, Math.min(hint.x + 18, window.innerWidth - 328));
  const top = Math.max(8, Math.min(box.top + box.height / 2 - 15, window.innerHeight - 38));
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Tip"
      className="fade-in pointer-events-none fixed z-50 flex h-[30px] max-w-[320px] items-center gap-1.5 whitespace-nowrap rounded-full border border-hairline bg-card px-2.5 text-[12px] text-ink-soft"
      style={{ left, top, boxShadow: "var(--overlay-shadow)" }}
    >
      {hint.id === "focus" ? (
        <>
          Hold <Kbd>Q</Kbd> and every pane follows <span className="truncate font-medium text-ink">{hint.name}</span>
        </>
      ) : (
        <>
          <Kbd>Alt</Kbd>-click for the games behind this number
        </>
      )}
    </div>
  );
}
