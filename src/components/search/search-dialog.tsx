"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TeamLogo } from "@/components/team-logo";
import { PlayerPhoto } from "@/components/player-photo";
import { cn } from "@/lib/utils";

// Compact-keyed entries from /data/search-index.json (kept short to shrink the
// wire payload — see scripts/build-search-index.mjs for the writer). Teams may
// carry `k`: colloquial aliases ("uconn", "ole miss") that also match.
type TeamEntry = { t: "t"; n: string; s: string; c: string | null; k?: string };
type CoachEntry = { t: "c"; n: string; s: string; tm: string; a: 0 | 1 };
type PlayerEntry = { t: "p"; n: string; b: number; tm: string; y: number };
// `l` and `d` are stamped client-side after fetch: the name lowercased, and
// lowercased with punctuation stripped — so the per-keystroke scan allocates
// nothing, and "st johns" still finds "St. John's" ("ajahni" → "A'Jahni").
// (Not in the wire format — it would double the payload.)
type Entry = (TeamEntry | CoachEntry | PlayerEntry) & { l?: string; d?: string };

// Lowercase + drop everything that isn't a letter, digit, or space.
function stripPunct(s: string): string {
  return s.replace(/[^a-z0-9 ]+/g, "");
}

function urlFor(e: Entry): string {
  if (e.t === "t") return `/teams/${e.s}/`;
  if (e.t === "c") return `/coaches/${e.s}/`;
  return `/players/${e.b}/`;
}
function seasonLabel(y: number): string {
  return `${(y - 1).toString().slice(-2)}-${y.toString().slice(-2)}`;
}
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0] + parts[parts.length - 1]![0]).toUpperCase();
}

// Per-column caps. The dropdown is height-bounded, so each entity type gets a
// fixed budget instead of the tallest group starving the others.
const MAX_T = 6, MAX_C = 6, MAX_P = 10;

type Col = { key: "t" | "c" | "p"; label: string; items: Entry[]; total: number };

/**
 * Navbar search — "box score" style. No modal: the trigger pill swaps to an
 * inline input in the same navbar slot, and results drop down in a panel
 * anchored under the header — three side-by-side columns (Teams | Coaches |
 * Players) on desktop, stacked on mobile.
 *
 * Keyboard: ↑↓ move within a column, Tab / Shift+Tab hop columns, ↵ opens,
 * Esc closes. The mock used ←→ for columns; that steals the caret from the
 * text input, so column hopping lives on Tab instead.
 *
 * ⌘K / Ctrl+K toggles open. Lazy-loads the ~1.8 MB search index on first open
 * and caches it for the session.
 */
export function SearchDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<Entry[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  // 2D cursor over the three columns.
  const [cur, setCur] = useState<{ c: number; r: number }>({ c: 0, r: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Global ⌘K / Ctrl+K toggle + Esc close.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // External open trigger (the mobile header search icon) — keyboard
  // shortcuts don't exist on touch devices, so a button dispatches this event.
  useEffect(() => {
    function onOpenSearch() { setOpen(true); }
    window.addEventListener("bta:open-search", onOpenSearch);
    return () => window.removeEventListener("bta:open-search", onOpenSearch);
  }, []);

  // Click-away close — this is a dropdown, not a modal, so there's no backdrop
  // to catch the click. Anything outside the root wrapper closes it.
  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // Reset query + cursor when closed; focus whichever input is visible when
  // opened (the inline one on md+, the panel's own row on mobile).
  useEffect(() => {
    if (!open) { setQuery(""); setCur({ c: 0, r: 0 }); }
    else requestAnimationFrame(() => {
      const el = inputRef.current && inputRef.current.offsetParent !== null
        ? inputRef.current
        : mobileInputRef.current;
      el?.focus();
    });
  }, [open]);

  // Lazy-load index on first open.
  useEffect(() => {
    if (!open || index || loadErr) return;
    fetch("/data/search-index.json")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      // Stamp the lowercased + punctuation-stripped names once, at load — the
      // scan runs per keystroke and per-entry toLowerCase() was 26k throwaway
      // strings each time. `d` only exists where it differs, so the common
      // case stays one string per entry.
      .then((arr: Entry[]) => {
        for (const e of arr) {
          e.l = e.n.toLowerCase();
          const d = stripPunct(e.l);
          if (d !== e.l) e.d = d;
        }
        setIndex(arr);
      })
      .catch((e) => setLoadErr(e.message));
  }, [open, index, loadErr]);

  // The list renders against a DEFERRED copy of the query. The keystroke's own
  // commit then contains only the input echo (sub-ms) and the result list
  // re-renders in a separate, interruptible pass — a burst of fast keystrokes
  // skips the intermediate lists instead of committing every one.
  const deferredQuery = useDeferredValue(query);
  // Players lead: they're what gets searched most, so they take the first
  // (widest) column and the first stop for the keyboard cursor.
  const cols: Col[] = useMemo(() => {
    const empty: Col[] = [
      { key: "p", label: "Players", items: [], total: 0 },
      { key: "t", label: "Teams", items: [], total: 0 },
      { key: "c", label: "Coaches", items: [], total: 0 },
    ];
    if (!index) return empty;
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return empty;
    const qd = stripPunct(q);
    // Rank within each column: name-start match (aliases count as one — the
    // colloquial name IS the name to whoever typed it), then word-start, then
    // bare substring. Without this, "ja" surfaces "A.J. Jacobson" over anyone
    // actually named Ja— purely because the index is alphabetical. Punctuation
    // -stripped fallback lets "st johns" find "St. John's". Buckets are capped
    // at the column budget (only that many can ever be shown); totals count
    // everything. Full scan, no early break — the header line shows TRUE match
    // counts, and the whole pass is ~1ms over 26k entries.
    const caps = { p: MAX_P, t: MAX_T, c: MAX_C } as const;
    const buckets: Record<"t" | "c" | "p", [Entry[], Entry[], Entry[]]> = {
      t: [[], [], []], c: [[], [], []], p: [[], [], []],
    };
    const colFor = { p: empty[0]!, t: empty[1]!, c: empty[2]! };
    for (const e of index) {
      const l = e.l ?? e.n.toLowerCase();
      let at = l.indexOf(q);
      let hay = l;
      if (at < 0 && e.t === "t" && e.k && e.k.includes(q)) { at = 0; hay = ""; }
      if (at < 0 && e.d && qd) { at = e.d.indexOf(qd); hay = e.d; }
      if (at < 0) continue;
      colFor[e.t].total++;
      const rank = at === 0 ? 0 : /[^a-z0-9]/.test(hay[at - 1]!) ? 1 : 2;
      const b = buckets[e.t][rank];
      if (b.length < caps[e.t]) b.push(e);
    }
    for (const key of ["p", "t", "c"] as const) {
      colFor[key].items = buckets[key].flat().slice(0, caps[key]);
    }
    return empty;
  }, [index, deferredQuery]);

  const totalMatches = cols[0]!.total + cols[1]!.total + cols[2]!.total;
  const totalShown = cols[0]!.items.length + cols[1]!.items.length + cols[2]!.items.length;
  const hasQuery = deferredQuery.trim().length > 0;

  // Clamp the cursor onto a real row at render time. If its column emptied,
  // slide to the nearest non-empty one.
  const cursor = useMemo(() => {
    let c = cur.c;
    if (!cols[c]!.items.length) {
      const firstNonEmpty = cols.findIndex((col) => col.items.length > 0);
      if (firstNonEmpty === -1) return null;
      c = firstNonEmpty;
    }
    return { c, r: Math.max(0, Math.min(cur.r, cols[c]!.items.length - 1)) };
  }, [cur, cols]);

  function moveCol(dir: 1 | -1) {
    if (!cursor) return;
    let c = cursor.c;
    for (let i = 0; i < cols.length; i++) {
      c = (c + dir + cols.length) % cols.length;
      if (cols[c]!.items.length > 0) break;
    }
    setCur({ c, r: Math.min(cursor.r, cols[c]!.items.length - 1) });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (cursor) setCur({ c: cursor.c, r: Math.min(cursor.r + 1, cols[cursor.c]!.items.length - 1) });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (cursor) setCur({ c: cursor.c, r: Math.max(cursor.r - 1, 0) });
    } else if (e.key === "Tab" && totalShown > 0) {
      e.preventDefault();
      moveCol(e.shiftKey ? -1 : 1);
    } else if (e.key === "Enter") {
      const pickEntry = cursor ? cols[cursor.c]!.items[cursor.r] : undefined;
      if (pickEntry) { router.push(urlFor(pickEntry)); setOpen(false); }
    }
  }

  function pick(e: Entry) {
    router.push(urlFor(e));
    setOpen(false);
  }

  const inputProps = {
    type: "text" as const,
    value: query,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value),
    onKeyDown,
    placeholder: "Search",
    "aria-label": "Search teams, coaches, and players",
  };
  // Soft azure-on-paper fill shared by the resting pill and the live input, so
  // opening reads as the same control waking up rather than a swap.
  const pillBg = "bg-[color-mix(in_oklab,var(--coral)_5%,var(--paper-deep))]";

  return (
    // The wrapper spans both the navbar slot and the dropped panel so the
    // click-away check has one root to test against.
    <div ref={rootRef} className="contents">
      {/* Navbar slot: a search-field-shaped pill when closed (glass, muted
          "Search", the shortcut riding inside the field), the real input when
          open. Same slot, same shape — it just slides wider (bta-search-grow). */}
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open search"
          aria-expanded={false}
          className={cn(
            "hidden md:inline-flex items-center gap-2.5 h-9 w-44 lg:w-52 pl-3.5 pr-2 rounded-md border border-ink/10 hover:border-ink/25 transition-colors",
            pillBg,
          )}
        >
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-ink-muted shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <circle cx={11} cy={11} r={7} /><line x1={20} y1={20} x2={16.65} y2={16.65} />
          </svg>
          <span className="text-sm text-ink-muted">Search</span>
          <kbd className="ml-auto hidden lg:inline-flex items-center text-[0.62rem] text-ink-muted font-mono bg-paper border border-hairline rounded px-2 py-0.5">⌘K</kbd>
        </button>
      ) : (
        <div className="hidden md:flex items-center relative">
          <svg viewBox="0 0 24 24" className="absolute left-3.5 w-3.5 h-3.5 text-ink-muted pointer-events-none" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <circle cx={11} cy={11} r={7} /><line x1={20} y1={20} x2={16.65} y2={16.65} />
          </svg>
          <input
            ref={inputRef}
            {...inputProps}
            aria-expanded
            className={cn(
              "bta-search-grow h-9 w-72 lg:w-96 pl-9 pr-12 rounded-md border border-ink/10 text-ink text-sm placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-coral/40 focus:border-coral/40",
              pillBg,
            )}
          />
          <kbd className="absolute right-3 text-[0.62rem] text-ink-muted font-mono bg-paper border border-hairline rounded px-2 py-0.5 pointer-events-none">esc</kbd>
        </div>
      )}

      {/* Dropped panel — anchored to the header container (which is relative),
          right-aligned under the input on desktop, full-bleed on mobile. */}
      {open && (
        <div
          aria-label="Search results"
          // bg-paper, not bg-card: full white glared against the cream page.
          className="absolute top-16 inset-x-0 md:inset-x-auto md:top-[4.25rem] md:right-6 lg:right-16 md:w-[56rem] md:max-w-[calc(100vw-3rem)] z-50 bg-paper border border-hairline md:rounded-lg shadow-xl overflow-hidden"
        >
          {/* Mobile gets its own input row (the navbar has no room for an
              inline one) with the heavy ink baseline from the box-score look. */}
          <div className="md:hidden flex items-center gap-3 px-4 h-12 border-b-2 border-ink">
            <svg viewBox="0 0 24 24" className="w-4 h-4 text-ink-muted shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <circle cx={11} cy={11} r={7} /><line x1={20} y1={20} x2={16.65} y2={16.65} />
            </svg>
            <input ref={mobileInputRef} {...inputProps} className="flex-1 h-full bg-transparent text-ink text-base placeholder:text-ink-muted focus:outline-none" />
          </div>

          {/* Desktop count line — sits where the mock's input row was; the
              input itself lives up in the navbar. */}
          <div className="hidden md:flex items-center justify-between px-4 h-9 border-b-2 border-ink text-[0.7rem] text-ink-muted">
            <span className="uppercase tracking-[0.15em] font-semibold">Search</span>
            {hasQuery && index && (
              <span className="tabular">
                <span className="text-ink font-semibold">{totalMatches.toLocaleString()}</span> match{totalMatches === 1 ? "" : "es"}
                {totalMatches > totalShown && <> · showing top {totalShown}</>}
              </span>
            )}
          </div>

          {loadErr ? (
            <div className="px-5 py-10 text-center text-ink-muted text-sm">Couldn&apos;t load search index: {loadErr}</div>
          ) : !index ? (
            <div className="px-5 py-10 text-center text-ink-muted text-sm">Loading…</div>
          ) : !hasQuery ? (
            <div className="px-5 py-10 text-center text-ink-muted text-sm">Type to search teams, coaches, and players.</div>
          ) : totalShown === 0 ? (
            <div className="px-5 py-10 text-center text-ink-muted text-sm">No matches for &ldquo;{deferredQuery}&rdquo;</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-[1.15fr_1fr_1fr] max-h-[70vh] overflow-y-auto">
              {cols.map((col, ci) => (
                <div key={col.key} className={cn(ci > 0 && "md:border-l border-t md:border-t-0 border-hairline")}>
                  <div className="flex items-baseline gap-2 px-4 py-2 bg-paper-deep border-b border-hairline text-[0.58rem] uppercase tracking-[0.15em] font-bold text-ink-muted sticky top-0">
                    <span className="text-ink">{col.label}</span>
                    <span className="ml-auto font-medium tabular">{col.total.toLocaleString()}</span>
                  </div>
                  {col.items.length === 0 ? (
                    <div className="px-4 py-2.5 text-ink-muted/60 text-sm">—</div>
                  ) : (
                    col.items.map((e, ri) => {
                      const active = cursor?.c === ci && cursor?.r === ri;
                      return (
                        <button
                          key={e.t === "p" ? `p-${e.b}` : `${e.t}-${(e as TeamEntry | CoachEntry).s}`}
                          type="button"
                          onClick={() => pick(e)}
                          onMouseEnter={() => setCur({ c: ci, r: ri })}
                          className={cn(
                            "w-full text-left flex items-center gap-2.5 px-4 py-1.5 text-sm",
                            // Zebra + the explorer table's active treatment:
                            // azure wash with an inset rail. Mixed into paper,
                            // matching the panel ground.
                            ri % 2 === 1 && !active && "bg-paper-deep/60",
                            active && "bg-[color-mix(in_oklab,var(--coral)_9%,var(--paper))] shadow-[inset_2px_0_0_var(--coral)]",
                          )}
                        >
                          {e.t === "t" && <TeamLogo name={e.n} size={20} />}
                          {e.t === "c" && (
                            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-paper-deep text-[0.52rem] uppercase tracking-widest font-medium text-ink-muted shrink-0">
                              {initials(e.n)}
                            </span>
                          )}
                          {e.t === "p" && <PlayerPhoto bartPlayerId={e.b} name={e.n} size={20} />}
                          <span className="text-ink font-medium truncate">{e.n}</span>
                          <span className="ml-auto text-ink-muted text-[0.7rem] tabular whitespace-nowrap flex items-center gap-1.5">
                            {e.t === "t" && (e.c ?? "")}
                            {e.t === "c" && (
                              <>
                                {e.a === 1 && <span className="inline-block w-1.5 h-1.5 rounded-full bg-coral" aria-label="Active" />}
                                {e.tm}
                              </>
                            )}
                            {e.t === "p" && <>{e.tm} · {seasonLabel(e.y)}</>}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-hairline px-4 py-2 text-[0.64rem] text-ink-muted hidden md:flex items-center gap-4">
            <Hint k="↑↓">row</Hint>
            <Hint k="⇥">column</Hint>
            <Hint k="↵">open</Hint>
            <span className="ml-auto flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 border border-hairline rounded font-mono">⌘K</kbd>
              <span>toggle</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function Hint({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      <kbd className="px-1.5 py-0.5 border border-hairline rounded font-mono">{k}</kbd>
      <span>{children}</span>
    </span>
  );
}
