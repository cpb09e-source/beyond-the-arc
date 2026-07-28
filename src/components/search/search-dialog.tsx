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
function keyFor(e: Entry): string {
  return e.t === "p" ? `p-${e.b}` : `${e.t}-${(e as TeamEntry | CoachEntry).s}`;
}

// Per-group caps. The panel is height-bounded, so each entity type gets a fixed
// budget instead of the biggest group starving the others.
const MAX_P = 8, MAX_T = 5, MAX_C = 5;

type Group = { key: "p" | "t" | "c"; label: string; items: Entry[]; total: number };

/** Ties the input's combobox role to the results list it drives. */
const LISTBOX_ID = "bta-search-results";
const optionId = (e: Entry) => `bta-opt-${keyFor(e)}`;

/**
 * Navbar search. No modal and no scrim: the trigger pill swaps to a live input
 * in the same navbar slot, and the results ease down in a panel anchored under
 * it. Everything stays where it was.
 *
 * ONE COLUMN, GROUPED — not three side-by-side columns. The three-column build
 * this replaced was a table pretending to be a menu: it needed hard borders to
 * separate the columns, a 2px ink rule to cap them, zebra striping to track
 * rows across the width, and a permanent hint bar to explain that Tab moved
 * between them. Every one of those devices existed to prop up the column
 * layout, and together they were most of what made the panel look a decade old.
 * Stacked and grouped, the rows need none of it: quiet headings, rounded rows,
 * one soft shadow, and ↑↓ that goes where it looks like it goes.
 *
 * Keyboard: ↑↓ move through every result in order, ↵ opens, Esc closes.
 * ⌘K / Ctrl+K toggles. Lazy-loads the ~1.8 MB index on first open and caches it
 * for the session.
 */
export function SearchDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<Entry[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
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

  // External open trigger (the mobile header search icon) — keyboard shortcuts
  // don't exist on touch devices, so a button dispatches this event.
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

  // Focus whichever input is visible on open (the inline one on md+, the
  // panel's own row on mobile).
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
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
      // strings each time. `d` only exists where it differs, so the common case
      // stays one string per entry.
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

  // Players lead: they are what gets searched most, so they take the first
  // group and the first stop for the keyboard cursor.
  const groups: Group[] = useMemo(() => {
    const out: Group[] = [
      { key: "p", label: "Players", items: [], total: 0 },
      { key: "t", label: "Teams", items: [], total: 0 },
      { key: "c", label: "Coaches", items: [], total: 0 },
    ];
    if (!index) return out;
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return out;
    const qd = stripPunct(q);
    // Rank within each group: name-start match (aliases count as one — the
    // colloquial name IS the name to whoever typed it), then word-start, then
    // bare substring. Without this, "ja" surfaces "A.J. Jacobson" over anyone
    // actually named Ja— purely because the index is alphabetical. Punctuation
    // -stripped fallback lets "st johns" find "St. John's". Buckets are capped
    // at the group budget (only that many can ever be shown); totals count
    // everything. Full scan, no early break — the counts shown are TRUE match
    // counts, and the whole pass is ~1ms over 26k entries.
    const caps = { p: MAX_P, t: MAX_T, c: MAX_C } as const;
    const buckets: Record<"t" | "c" | "p", [Entry[], Entry[], Entry[]]> = {
      t: [[], [], []], c: [[], [], []], p: [[], [], []],
    };
    const by = { p: out[0]!, t: out[1]!, c: out[2]! };
    for (const e of index) {
      const l = e.l ?? e.n.toLowerCase();
      let at = l.indexOf(q);
      let hay = l;
      if (at < 0 && e.t === "t" && e.k && e.k.includes(q)) { at = 0; hay = ""; }
      if (at < 0 && e.d && qd) { at = e.d.indexOf(qd); hay = e.d; }
      if (at < 0) continue;
      by[e.t].total++;
      const rank = at === 0 ? 0 : /[^a-z0-9]/.test(hay[at - 1]!) ? 1 : 2;
      const b = buckets[e.t][rank];
      if (b.length < caps[e.t]) b.push(e);
    }
    for (const k of ["p", "t", "c"] as const) by[k].items = buckets[k].flat().slice(0, caps[k]);
    return out;
  }, [index, deferredQuery]);

  // One flat list in render order, which is what ↑↓ walks. A single sequence is
  // the whole reason the Tab-between-columns hint could go.
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const shown = groups.filter((g) => g.items.length > 0);
  const totalMatches = groups.reduce((n, g) => n + g.total, 0);
  const hasQuery = deferredQuery.trim().length > 0;

  // Reset on close and whenever the results change, adjusted during render
  // rather than in an effect: setting state in an effect commits one frame with
  // the stale cursor first, which on a fast typist paints the highlight on the
  // previous query's row.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) { setWasOpen(open); if (!open) setQuery(""); setCursor(0); }
  const [lastQ, setLastQ] = useState(deferredQuery);
  if (deferredQuery !== lastQ) { setLastQ(deferredQuery); setCursor(0); }

  const active = Math.min(cursor, Math.max(0, flat.length - 1));

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor(Math.min(active + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor(Math.max(active - 1, 0));
    } else if (e.key === "Enter") {
      const hit = flat[active];
      if (hit) pick(hit);
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

  // `aria-expanded` alone is invalid on a plain textbox. The full combobox
  // relationship is what makes the state legible to a screen reader: the input
  // owns the listbox below it, and `aria-activedescendant` names the row ↑↓ is
  // currently on without moving focus off the field.
  //
  // Written out literally at both call sites rather than spread: jsx-a11y only
  // reads literal JSX attributes, so anything arriving through a spread is
  // invisible to it and it flags the (correct) markup as broken.
  const activeId = flat[active] ? optionId(flat[active]!) : undefined;

  return (
    // The wrapper spans both the navbar slot and the dropped panel so the
    // click-away check has one root to test against.
    <div ref={rootRef} className="contents">
      {/* Navbar slot: a search-field-shaped pill when closed, the real input
          when open. Same slot, same shape — it just slides wider. Rounded to a
          full pill and filled rather than outlined; a hairline rectangle around
          a field is the most dated shape in the whole header. */}
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open search"
          aria-expanded={false}
          className="hidden md:inline-flex items-center gap-2.5 h-9 w-44 lg:w-52 pl-3.5 pr-3 rounded-full bg-paper-deep ring-1 ring-ink/8 hover:ring-ink/20 transition-shadow"
        >
          <Glass className="w-3.5 h-3.5 text-ink-muted shrink-0" />
          <span className="text-sm text-ink-muted">Search</span>
          <kbd className="ml-auto hidden lg:inline text-[0.62rem] text-ink-muted font-mono">⌘K</kbd>
        </button>
      ) : (
        <div className="hidden md:flex items-center relative">
          <Glass className="absolute left-3.5 w-3.5 h-3.5 text-ink-muted pointer-events-none" />
          <input
            ref={inputRef}
            {...inputProps}
            role="combobox"
            aria-controls={LISTBOX_ID}
            aria-expanded={open}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            className="bta-search-grow h-9 w-72 lg:w-96 pl-9 pr-12 rounded-full bg-paper-deep ring-1 ring-coral/40 text-ink text-sm placeholder:text-ink-muted focus:outline-none"
          />
          <kbd className="absolute right-3.5 text-[0.62rem] text-ink-muted font-mono pointer-events-none">esc</kbd>
        </div>
      )}

      {/* The panel. Anchored to the header container (which is relative),
          right-aligned under the input on desktop, full-bleed on mobile.
          Shadow and a hairline ring rather than a border — a 1px box around a
          floating surface reads as a window, not a menu. */}
      {open && (
        <div
          aria-label="Search results"
          className="bta-search-drop absolute top-16 inset-x-0 md:inset-x-auto md:top-[3.9rem] md:right-6 lg:right-16 md:w-[30rem] md:max-w-[calc(100vw-3rem)] z-50 bg-paper md:rounded-xl shadow-xl ring-1 ring-ink/8 border-y border-hairline md:border-0 overflow-hidden"
        >
          {/* Mobile gets its own input row — the navbar has no room for an
              inline one. */}
          <div className="md:hidden flex items-center gap-3 px-4 h-12 border-b border-hairline">
            <Glass className="w-4 h-4 text-ink-muted shrink-0" />
            <input
              ref={mobileInputRef}
              {...inputProps}
              role="combobox"
              aria-controls={LISTBOX_ID}
              aria-expanded={open}
              aria-autocomplete="list"
              aria-activedescendant={activeId}
              className="flex-1 h-full bg-transparent text-ink text-base placeholder:text-ink-muted focus:outline-none"
            />
          </div>

          <div className="max-h-[60vh] md:max-h-[50vh] overflow-y-auto">
            {loadErr ? (
              <Note>Couldn&apos;t load search: {loadErr}</Note>
            ) : !index ? (
              <Note>Loading…</Note>
            ) : !hasQuery ? (
              <Note>Teams, coaches, players.</Note>
            ) : flat.length === 0 ? (
              <Note>No matches for &ldquo;{deferredQuery}&rdquo;</Note>
            ) : (
              <div className="p-2" id={LISTBOX_ID} role="listbox" aria-label="Search results">
                {shown.map((g, gi) => {
                  // Each group's offset into the flat cursor space, computed up
                  // front — a counter mutated while mapping is wrong the moment
                  // React re-renders this subtree on its own.
                  const start = shown.slice(0, gi).reduce((n, x) => n + x.items.length, 0);
                  return (
                    <div key={g.key} className="mb-1 last:mb-0">
                      <div className="flex items-baseline gap-2 px-3 pt-2 pb-1">
                        <span className="text-[0.58rem] uppercase tracking-[0.16em] font-bold text-ink-muted">{g.label}</span>
                        <span className="text-[0.58rem] tabular text-ink-muted/60">{g.total.toLocaleString()}</span>
                      </div>
                      {g.items.map((e, i) => (
                        <Row
                          key={keyFor(e)}
                          e={e}
                          active={active === start + i}
                          onPick={() => pick(e)}
                          onHover={() => setCursor(start + i)}
                        />
                      ))}
                    </div>
                  );
                })}
                {/* The overflow count, where it is actually useful — at the end
                    of the list you just read, not in a header bar above it. */}
                {totalMatches > flat.length && (
                  <p className="px-3 py-2 text-[0.62rem] text-ink-muted">
                    Showing {flat.length} of {totalMatches.toLocaleString()} matches.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Glass({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <circle cx={11} cy={11} r={7} /><line x1={20} y1={20} x2={16.65} y2={16.65} />
    </svg>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <div className="px-5 py-10 text-center text-ink-muted text-sm">{children}</div>;
}

function Row({
  e, active, onPick, onHover,
}: { e: Entry; active: boolean; onPick: () => void; onHover: () => void }) {
  return (
    <button
      type="button"
      id={optionId(e)}
      role="option"
      aria-selected={active}
      onClick={onPick}
      onMouseEnter={onHover}
      // A rounded wash, not a full-bleed bar with an inset rail. Inside a
      // rounded panel the row can afford to be a shape of its own.
      className={cn(
        "w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg transition-colors",
        active ? "bg-ink/6" : "hover:bg-ink/4",
      )}
    >
      {e.t === "t" && <TeamLogo name={e.n} size={22} />}
      {e.t === "c" && (
        <span className="inline-flex items-center justify-center w-[22px] h-[22px] rounded-full bg-paper-deep text-[0.55rem] font-semibold text-ink-muted shrink-0">
          {initials(e.n)}
        </span>
      )}
      {/* eager: a lazy image loses the race against typing — see PlayerPhoto. */}
      {e.t === "p" && <PlayerPhoto bartPlayerId={e.b} name={e.n} size={22} eager />}
      <span className="text-ink text-sm truncate">{e.n}</span>
      <span className="ml-auto text-ink-muted text-[0.7rem] tabular whitespace-nowrap flex items-center gap-1.5 shrink-0">
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
}
