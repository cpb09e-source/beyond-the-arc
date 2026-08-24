"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import { TeamLogo } from "@/components/team-logo";
import { PlayerPhoto } from "@/components/player-photo";
import { pctBg, pctColor } from "@/components/percentile-chip";
import { cn } from "@/lib/utils";

/**
 * Compact-keyed entries from /data/search-index.json — see
 * scripts/build-search-index.mjs for the writer.
 *
 * `tm` arrives as an INDEX into the file's `schools` array, not a string: the
 * same ~370 school names were being written out on 26k rows and were the
 * largest thing in the payload. It is resolved to a string in the same pass
 * that stamps the match keys, so nothing downstream knows the difference.
 */
type TeamEntry = { t: "t"; n: string; s: string; c: string | null; k?: string };
type CoachEntry = { t: "c"; n: string; s: string; tm: string; a: 0 | 1 };
type PlayerEntry = { t: "p"; n: string; b: number; tm: string; y: number };
// `l` and `d` are stamped client-side after fetch: the name lowercased, and
// lowercased with punctuation stripped — so the per-keystroke scan allocates
// nothing, and "st johns" still finds "St. John's" ("ajahni" → "A'Jahni").
// (Not in the wire format — it would double the payload.)
type Entry = (TeamEntry | CoachEntry | PlayerEntry) & { l?: string; d?: string };

type RawEntry = Omit<Entry, "tm"> & { tm?: number };
type IndexDoc = { schools: string[]; e: RawEntry[] };

/**
 * The stat lines, from the /data/search-stats.json sidecar.
 *
 * Fetched SEPARATELY and never awaited before results render. Matching needs
 * names and nothing else; folding the numbers into the index would have taken
 * the file the first keystroke waits on from 1.0 MB to 2.3 MB to decorate at
 * most eight visible rows. Until it lands (and for anyone it has no line for)
 * the stat columns show an em dash, which is the same thing they show for a
 * player whose season we genuinely lack.
 *
 * Fixed-point ints, -1 for unknown:
 *   players  [ppg*10, rpg*10, apg*10, ts*1000, tsPercentile]
 *   teams    [rank, wins, losses, net*10]
 */
type StatsDoc = { p: Record<string, number[]>; t: Record<string, number[]> };

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
function keyFor(e: Entry): string {
  return e.t === "p" ? `p-${e.b}` : `${e.t}-${(e as TeamEntry | CoachEntry).s}`;
}

type Tab = "all" | "p" | "t" | "c";

// Per-group caps. On "all" the panel is height-bounded so each entity type gets
// a fixed budget instead of the biggest group starving the others; on a single
// entity's own tab that type gets the whole budget.
const MAX_P = 6, MAX_T = 4, MAX_C = 3;
const MAX_SOLO = 14;

type Group = { key: "p" | "t" | "c"; label: string; items: Entry[]; total: number };

/** Ties the input's combobox role to the results list it drives. */
const LISTBOX_ID = "bta-search-results";
const optionId = (e: Entry) => `bta-opt-${keyFor(e)}`;

/**
 * Navbar search — a centered command palette over the page.
 *
 * EVERY ROW CARRIES ITS NUMBERS. On an analytics site the name is rarely the
 * question: searching a player is the first step of looking up how he played,
 * and a list of bare names makes you open a page to find out whether it was
 * even the right man. So a player row shows PPG / RPG / APG with a TS%
 * percentile chip in the site's own ramp, and a team row its rank, record and
 * net rating. The dash is honest — it means we have no line for that season,
 * not that the number is zero.
 *
 * NO BACKDROP BLUR, deliberately. A `backdrop-filter` over a full-page scrim
 * re-filters the whole viewport every frame the panel is up, which is the one
 * effect here expensive enough to be felt while typing; a flat scrim costs
 * nothing and reads the same. The panel keeps a single static shadow — it never
 * animates, so it is painted once and does not participate in keystrokes.
 *
 * Keyboard: ↑↓ move through every result in order, ↵ opens, Esc closes,
 * ⌘K / Ctrl+K toggles, Tab cycles the entity tabs. The ~1.5 MB index is
 * lazy-loaded on the first open — or on hover/focus of the trigger, which is
 * usually a few hundred ms of head start — and cached for the session.
 */
export function SearchDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<Entry[] | null>(null);
  const [stats, setStats] = useState<StatsDoc | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [tab, setTab] = useState<Tab>("all");
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // Guards the fetch against a second trigger (hover then click) starting it twice.
  const started = useRef(false);

  /**
   * Load the index, and the stat sidecar behind it.
   *
   * Callable from hover/focus as well as open: the index is the only thing
   * between a keystroke and a result, and starting it while the pointer is
   * still travelling to the trigger hides most of that.
   */
  function loadIndex() {
    if (started.current) return;
    started.current = true;
    fetch("/data/search-index.json")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      // Stamp the lowercased + punctuation-stripped names once, at load — the
      // scan runs per keystroke and per-entry toLowerCase() was 26k throwaway
      // strings each time. `d` only exists where it differs, so the common case
      // stays one string per entry. School names are resolved from the interned
      // table in the same pass.
      .then((doc: IndexDoc | Entry[]) => {
        const schools = Array.isArray(doc) ? [] : doc.schools;
        const raw = Array.isArray(doc) ? (doc as RawEntry[]) : doc.e;
        const out = raw as unknown as Entry[];
        for (let i = 0; i < raw.length; i++) {
          const e = raw[i]!;
          if (typeof e.tm === "number") {
            (e as unknown as { tm: string }).tm = schools[e.tm] ?? "—";
          }
          const l = e.n.toLowerCase();
          e.l = l;
          const d = stripPunct(l);
          if (d !== l) e.d = d;
        }
        setIndex(out);
      })
      .catch((e) => setLoadErr(e.message));

    // Separate request, never awaited: results render without it.
    fetch("/data/search-stats.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: StatsDoc | null) => { if (d) setStats(d); })
      .catch(() => { /* stat columns stay em dashes */ });
  }

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
    function onOpenSearch() {
      // FOCUS HAS TO HAPPEN INSIDE THE GESTURE. iOS only raises the keyboard
      // for a focus() made while the user's tap is still being handled; a
      // focus from an effect (which is what this used to rely on) lands after
      // commit, outside that window, so the field took focus and the keyboard
      // stayed down — you had to tap the field a second time.
      //
      // The event is dispatched synchronously from the header button's click,
      // so flushSync renders the panel here and now, and the field exists to
      // be focused before the gesture ends.
      flushSync(() => setOpen(true));
      inputRef.current?.focus();
    }
    window.addEventListener("bta:open-search", onOpenSearch);
    return () => window.removeEventListener("bta:open-search", onOpenSearch);
  }, []);

  // Focus the field on open; start the fetch if a hover didn't already.
  useEffect(() => {
    if (!open) return;
    loadIndex();
    // Fallback for the ⌘K path, which has no tap to stay inside. Harmless when
    // the open came from a button, where the field is already focused.
    if (document.activeElement !== inputRef.current) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
    /**
     * Lock the page behind the modal — and pay back the scrollbar's width.
     *
     * `overflow: hidden` alone removes the vertical scrollbar, which widens the
     * viewport by its width; every centered or right-anchored thing on the page
     * then jumps a few pixels right as the panel opens, and jumps back on
     * close. Holding that width as padding keeps the layout still. It is
     * measured rather than assumed because it is 0 on overlay-scrollbar
     * platforms (macOS default, touch) and ~15px on Windows, where the jump is
     * plainly visible.
     */
    const gap = window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = document.body.style.overflow;
    const prevPad = document.body.style.paddingRight;
    document.body.style.overflow = "hidden";
    if (gap > 0) document.body.style.paddingRight = `${gap}px`;
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPad;
    };
  }, [open]);

  // The list renders against a DEFERRED copy of the query. The keystroke's own
  // commit then contains only the input echo (sub-ms) and the result list
  // re-renders in a separate, interruptible pass — a burst of fast keystrokes
  // skips the intermediate lists instead of committing every one.
  const deferredQuery = useDeferredValue(query);

  // Players lead: they are what gets searched most, so they take the first
  // group and the first stop for the keyboard cursor.
  const groups: Group[] = useMemo(() => {
    // Fixed order: teams, then players, then coaches. There are ~370 teams
    // against 25k players, so a team match is the rarer and more specific
    // thing — putting them first is what stops six substring hits on player
    // names burying the school the reader typed the name of.
    const out: Group[] = [
      { key: "t", label: "Teams", items: [], total: 0 },
      { key: "p", label: "Players", items: [], total: 0 },
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
    const solo = tab !== "all";
    const caps = {
      p: solo ? MAX_SOLO : MAX_P,
      t: solo ? MAX_SOLO : MAX_T,
      c: solo ? MAX_SOLO : MAX_C,
    } as const;
    // Four tiers: exact whole-name, name-start, word-start, bare substring.
    const buckets: Record<"t" | "c" | "p", [Entry[], Entry[], Entry[], Entry[]]> = {
      t: [[], [], [], []], c: [[], [], [], []], p: [[], [], [], []],
    };
    const by = { t: out[0]!, p: out[1]!, c: out[2]! };
    for (const e of index) {
      const l = e.l ?? e.n.toLowerCase();
      let at = l.indexOf(q);
      let hay = l;
      let exact = l === q;
      if (at < 0 && e.t === "t" && e.k && e.k.includes(q)) {
        at = 0; hay = "";
        // An alias the reader typed in full IS the name to them.
        exact = e.k.split(" ").includes(q);
      }
      if (at < 0 && e.d && qd) { at = e.d.indexOf(qd); hay = e.d; exact = e.d === qd; }
      if (at < 0) continue;
      by[e.t].total++;
      // Totals stay true for every tab — the counts sit on the tabs themselves,
      // so a hidden group still has to be counted.
      if (solo && e.t !== tab) continue;
      const rank = exact ? 0 : at === 0 ? 1 : /[^a-z0-9]/.test(hay[at - 1]!) ? 2 : 3;
      const b = buckets[e.t][rank]!;
      if (b.length < caps[e.t]) b.push(e);
    }
    for (const k of ["p", "t", "c"] as const) by[k].items = buckets[k].flat().slice(0, caps[k]);
    return out;
  }, [index, deferredQuery, tab]);

  // One flat list in render order, which is what ↑↓ walks.
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const shown = groups.filter((g) => g.items.length > 0);
  const totalMatches = groups.reduce((n, g) => n + g.total, 0);
  const hasQuery = deferredQuery.trim().length > 0;

  // Reset on close and whenever the results change, adjusted during render
  // rather than in an effect: setting state in an effect commits one frame with
  // the stale cursor first, which on a fast typist paints the highlight on the
  // previous query's row.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) { setWasOpen(open); if (!open) { setQuery(""); setTab("all"); } setCursor(0); }
  const [lastQ, setLastQ] = useState(deferredQuery);
  if (deferredQuery !== lastQ) { setLastQ(deferredQuery); setCursor(0); }
  const [lastTab, setLastTab] = useState(tab);
  if (tab !== lastTab) { setLastTab(tab); setCursor(0); }

  const active = Math.min(cursor, Math.max(0, flat.length - 1));

  // By KEY, not position: the groups array is re-ordered by match quality, so
  // reading groups[0] as "players" swapped the counts the moment a team led.
  const totalOf = (k: "p" | "t" | "c") => groups.find((g) => g.key === k)?.total ?? 0;
  const TABS: Array<{ k: Tab; label: string; n: number }> = [
    { k: "all", label: "All", n: totalMatches },
    { k: "p", label: "Players", n: totalOf("p") },
    { k: "t", label: "Teams", n: totalOf("t") },
    { k: "c", label: "Coaches", n: totalOf("c") },
  ];

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
    } else if (e.key === "Tab") {
      // Tab cycles the entity tabs rather than leaving the field — there is
      // nothing else in the panel to tab to, and it is the fastest way to
      // narrow 19 mixed matches to the 1 team you meant.
      e.preventDefault();
      const order: Tab[] = ["all", "p", "t", "c"];
      const i = order.indexOf(tab);
      setTab(order[(i + (e.shiftKey ? order.length - 1 : 1)) % order.length]!);
    }
  }

  function pick(e: Entry) {
    router.push(urlFor(e));
    setOpen(false);
  }

  // `aria-expanded` alone is invalid on a plain textbox. The full combobox
  // relationship is what makes the state legible to a screen reader: the input
  // owns the listbox below it, and `aria-activedescendant` names the row ↑↓ is
  // currently on without moving focus off the field.
  const activeId = flat[active] ? optionId(flat[active]!) : undefined;

  return (
    <div ref={rootRef} className="contents">
      {/* Navbar trigger. Hovering it starts the index download, so the field is
          usually ready to search the moment it opens. */}
      <button
        type="button"
        onClick={() => { flushSync(() => setOpen(true)); inputRef.current?.focus(); }}
        onPointerEnter={loadIndex}
        onFocus={loadIndex}
        aria-label="Open search"
        aria-expanded={open}
        className="hidden md:inline-flex items-center gap-2.5 h-9 w-44 lg:w-52 pl-3.5 pr-3 rounded-lg bg-paper-deep ring-1 ring-ink/8 hover:ring-ink/20 transition-shadow"
      >
        <Glass className="w-3.5 h-3.5 text-ink-muted shrink-0" />
        <span className="text-sm text-ink-muted">Search</span>
        <kbd className="ml-auto hidden lg:inline text-[0.62rem] text-ink-muted font-mono">⌘K</kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-50">
          {/* Flat scrim — no backdrop-filter. See the note on the component. */}
          <div
            className="absolute inset-0 bg-ink/35"
            onPointerDown={() => setOpen(false)}
            aria-hidden
          />

          {/* FULL WIDTH BELOW `md`, palette above it.
              A centered 42rem sheet floating at 8vh is a desktop shape: on a
              phone it kept ~12px of scrim down each side, which reads as a
              dialog you have to aim at rather than as part of the page.

              `top-16` IS THE HEADER'S OWN HEIGHT — the panel opens exactly
              where the score ticker sits, so search reads as taking the
              ticker's place for as long as it is up, rather than as a slab
              dropped over the page.

              SQUARE ON MOBILE, all four corners. Full width means the left and
              right edges are off-screen, so a rounded bottom was the only
              curve on the thing — one corner treatment at the bottom and a
              different one at the top reads as a mistake. Square top to square
              bottom, and it reads as a panel the header extends into.

              Min height so it opens as a real surface rather than a stub, max
              so it stops short of the bottom edge — full width, not full
              height. Between the two it takes the height its results want.

              The `md:` half restores exactly what was there before, so the
              desktop command palette is untouched. `md:inset-x-auto` is what
              releases the mobile `inset-x-0`. */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Search"
            className={cn(
              "absolute inset-x-0 top-16 flex flex-col",
              "bg-paper overflow-hidden shadow-xl ring-1 ring-ink/10",
              "max-md:min-h-[26rem] max-md:max-h-[82vh]",
              "md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:top-[8vh]",
              "md:w-[min(42rem,calc(100vw-1.5rem))] md:max-h-[80vh] md:rounded-xl",
            )}
          >
            {/* Query */}
            <div className="flex items-center gap-3 px-4 h-13 py-3.5 border-b border-hairline shrink-0">
              <Glass className="w-4 h-4 text-ink-muted shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search players, teams, coaches"
                aria-label="Search teams, coaches, and players"
                role="combobox"
                aria-controls={LISTBOX_ID}
                aria-expanded={open}
                aria-autocomplete="list"
                aria-activedescendant={activeId}
                className="flex-1 min-w-0 bg-transparent text-ink text-base placeholder:text-ink-muted focus:outline-none"
              />
              {/* Two ways out, one per input method. The `esc` hint is a hint,
                  not a control — it tells a keyboard user what already works.
                  A phone has no Esc key, so below `md` it is replaced by a real
                  button. Tapping the scrim closes it too, but that is not
                  discoverable, and an undiscoverable exit is not an exit. */}
              <kbd className="hidden md:inline text-[0.62rem] text-ink-muted font-mono shrink-0">esc</kbd>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close search"
                className="md:hidden inline-flex items-center justify-center w-9 h-9 -mr-1.5 shrink-0 rounded-lg bg-ink/[0.07] text-ink hover:bg-ink/[0.12] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral"
              >
                <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            {/* Entity tabs — only once there's something to narrow. */}
            {hasQuery && totalMatches > 0 && (
              <div className="flex gap-1.5 px-3 py-2.5 border-b border-hairline shrink-0" role="tablist" aria-label="Filter by type">
                {TABS.map((t) => (
                  <button
                    key={t.k}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.k}
                    onClick={() => { setTab(t.k); inputRef.current?.focus(); }}
                    disabled={t.n === 0 && t.k !== "all"}
                    className={cn(
                      "px-3 py-1 rounded-full text-xs transition-colors",
                      tab === t.k ? "bg-ink text-paper font-semibold" : "bg-paper-deep text-ink-muted hover:text-ink",
                      t.n === 0 && t.k !== "all" && "opacity-40 pointer-events-none",
                    )}
                  >
                    {t.label} <span className="tabular opacity-70">{t.n.toLocaleString()}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
              {loadErr ? (
                <Note>Couldn&apos;t load search: {loadErr}</Note>
              ) : !index ? (
                <Note>Loading…</Note>
              ) : !hasQuery ? (
                <Note>Players, teams, coaches</Note>
              ) : flat.length === 0 ? (
                <Note>No matches for &ldquo;{deferredQuery}&rdquo;</Note>
              ) : (
                <div id={LISTBOX_ID} role="listbox" aria-label="Search results">
                  {shown.map((g, gi) => {
                    // Each group's offset into the flat cursor space, computed up
                    // front — a counter mutated while mapping is wrong the moment
                    // React re-renders this subtree on its own.
                    const start = shown.slice(0, gi).reduce((n, x) => n + x.items.length, 0);
                    return (
                      <div key={g.key}>
                        <div className="flex items-baseline px-4 pt-3 pb-1.5">
                          <span className="text-[0.58rem] uppercase tracking-[0.16em] font-bold text-court-ink">{g.label}</span>
                          {/* Column captions, on the same widths as the cells
                              below them — see the note on PLAYER_COLS. */}
                          <span className="ml-auto">
                            {g.key === "p" && <StatHead cols={PLAYER_COLS} />}
                            {g.key === "t" && <StatHead cols={TEAM_COLS} />}
                          </span>
                        </div>
                        {g.items.map((e, i) => (
                          <Row
                            key={keyFor(e)}
                            e={e}
                            stats={stats}
                            active={active === start + i}
                            onPick={() => pick(e)}
                            onHover={() => setCursor(start + i)}
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center gap-3 px-4 py-2 border-t border-hairline shrink-0">
              <span className="text-[0.62rem] text-ink-muted tabular">
                {hasQuery && flat.length > 0
                  ? `${flat.length} of ${totalMatches.toLocaleString()} · stats from most recent season`
                  : " "}
              </span>
              <span className="ml-auto hidden sm:flex items-center gap-3 font-mono text-[0.6rem] text-ink-muted">
                <span>↑↓ move</span><span>↵ open</span><span>⇥ filter</span>
              </span>
            </div>
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

/**
 * The stat columns, as ONE spec used by both the group caption and the rows.
 *
 * They were two independent pieces of markup — a right-aligned caption string
 * over a row of fixed-width cells — so the labels sat wherever the caption's
 * own spacing put them and never lined up with the numbers underneath. Sharing
 * the widths is what makes a heading actually head its column.
 */
const PLAYER_COLS = [
  { key: "ppg", label: "PPG", w: "w-12" },
  { key: "rpg", label: "RPG", w: "w-12" },
  { key: "apg", label: "APG", w: "w-12" },
  { key: "ts", label: "TS%", w: "w-16" },
] as const;
const TEAM_COLS = [
  { key: "rk", label: "RK", w: "w-12" },
  { key: "rec", label: "REC", w: "w-16" },
  { key: "net", label: "NET", w: "w-14" },
] as const;

function StatHead({ cols }: { cols: readonly { key: string; label: string; w: string }[] }) {
  return (
    <span className="flex items-center font-mono text-[0.56rem] tracking-[0.1em] text-ink-muted">
      {cols.map((c) => (
        <span key={c.key} className={cn("text-right shrink-0", c.w)}>{c.label}</span>
      ))}
    </span>
  );
}

/** One right-aligned stat cell. Fixed widths so the columns line up down the list. */
function Stat({ v, w }: { v: string; w: string }) {
  return <span className={cn("text-right tabular shrink-0", w)}>{v}</span>;
}

const DASH = "—";
const one = (n: number) => (n / 10).toFixed(1);

function Row({
  e, stats, active, onPick, onHover,
}: { e: Entry; stats: StatsDoc | null; active: boolean; onPick: () => void; onHover: () => void }) {
  const px = e.t === "p" ? stats?.p[String(e.b)] : undefined;
  const tx = e.t === "t" ? stats?.t[e.n] : undefined;
  const ts = px && px[3] !== -1 ? px[3]! : null;
  const tsPct = px && px[4] !== -1 ? px[4]! : null;

  return (
    <button
      type="button"
      id={optionId(e)}
      role="option"
      aria-selected={active}
      onClick={onPick}
      onMouseEnter={onHover}
      className={cn(
        "w-full text-left flex items-center gap-3 px-4 py-2 transition-colors",
        active ? "bg-ink/6" : "hover:bg-ink/4",
      )}
    >
      {e.t === "t" && <TeamLogo name={e.n} size={24} />}
      {/* A coach's mark is his SCHOOL's, not his initials. The two-letter
          monogram identified nothing — every coach row looked the same — while
          the crest is the thing a reader actually recognises, and it is the
          same mark the team row above uses for the same school. */}
      {e.t === "c" && <TeamLogo name={e.tm} size={24} />}
      {/* eager: a lazy image loses the race against typing — see PlayerPhoto. */}
      {e.t === "p" && <PlayerPhoto bartPlayerId={e.b} name={e.n} size={24} eager />}

      <span className="flex flex-col min-w-0 leading-tight">
        <span className="text-ink text-sm truncate">{e.n}</span>
        <span className="text-ink-muted text-[0.68rem] truncate">
          {e.t === "t" && (e.c ?? "Team")}
          {e.t === "c" && (
            <>
              {e.a === 1 && <span className="inline-block w-1.5 h-1.5 rounded-full bg-coral mr-1.5 align-middle" aria-label="Active" />}
              {e.tm}
            </>
          )}
          {e.t === "p" && <>{e.tm} · {seasonLabel(e.y)}</>}
        </span>
      </span>

      {/* Numbers. Widths match the group's column captions above. */}
      <span className="ml-auto flex items-center font-mono text-[0.72rem] text-ink-soft shrink-0">
        {e.t === "p" && (
          <>
            <Stat v={px && px[0] !== -1 ? one(px[0]!) : DASH} w="w-12" />
            <Stat v={px && px[1] !== -1 ? one(px[1]!) : DASH} w="w-12" />
            <Stat v={px && px[2] !== -1 ? one(px[2]!) : DASH} w="w-12" />
            <span className="w-16 flex justify-end">
              {ts !== null ? (
                <span
                  className="rounded px-1.5 py-0.5 tabular text-[0.7rem]"
                  style={{ background: pctBg(tsPct), color: tsPct !== null ? pctColor(tsPct) : undefined }}
                >
                  {(ts / 1000).toFixed(3).replace(/^0/, "")}
                </span>
              ) : (
                <span className="pr-1.5">{DASH}</span>
              )}
            </span>
          </>
        )}
        {e.t === "t" && (
          <>
            <Stat v={tx ? `#${tx[0]}` : DASH} w="w-12" />
            <Stat v={tx ? `${tx[1]}–${tx[2]}` : DASH} w="w-16" />
            <Stat
              v={tx && tx[3] !== -9999 ? `${tx[3]! > 0 ? "+" : ""}${(tx[3]! / 10).toFixed(1)}` : DASH}
              w="w-14"
            />
          </>
        )}
        {e.t === "c" && <span className="text-ink-muted text-[0.7rem] pr-1">{e.a === 1 ? "active" : ""}</span>}
      </span>
    </button>
  );
}
