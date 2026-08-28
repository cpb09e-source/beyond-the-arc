"use client";

/**
 * The stat picker — "Add a Filter" and "Add Columns", one component.
 *
 * EXTRACTED FROM THE TEAM EXPLORER, unchanged in behaviour. It was written
 * there and knew the team catalogue: the option list, the section headings and
 * the key type were all imported from team-filters. The players table wants the
 * same two doors over a different set of stats, and the alternative to this
 * extraction was a second popover with the same keyboard handling, the same
 * portalling, the same cap logic and the same failure modes to rediscover.
 *
 * What the caller supplies is the list and its section headings. Everything
 * about how the list behaves lives here.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Lock, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEntitlement } from "@/lib/use-entitlement";

/** One offerable stat. `group` keys into the `groupLabel` map. */
export type PickOption = { key: string; label: string; desc: string; group: string };

/** Magnifier, matching the one on the table's own search box. */
function SearchGlass({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <circle cx={11} cy={11} r={7} /><line x1={20} y1={20} x2={16.65} y2={16.65} />
    </svg>
  );
}

/**
 * TWO DOORS INTO ONE LIST.
 *
 * "filter" is the original: pick a stat, the row appears, the caret is already
 * in its value box. One click, one bound, keep typing. That path was briefly
 * lost to multi-select and it should not have been — bounding a stat is the
 * single most common thing anyone does here, and it deserves to stay one
 * click.
 *
 * "columns" is the batch door: tick as many as you like, commit them all with
 * blank values. It also SHOWS what is already on the table, so unticking is
 * how a column comes off — it manages the set rather than only adding to it.
 *
 * They are not two data models. Filtering a stat pins it as a column either
 * way, so both end up in the same list of rows; what differs is how many you
 * name at once and whether the caret follows.
 */
export function StatPicker({
  mode,
  onPick,
  onSetColumns,
  current,
  remaining,
  disabled,
  open,
  setOpen,
  options,
  groupLabel,
  listId,
  alwaysFree = false,
}: {
  /** The stats this picker offers, already in section order. */
  options: PickOption[];
  /** Section heading for each `group` value. */
  groupLabel: Record<string, string>;
  /** DOM id for the listbox, unique per picker on the page. */
  listId: string;
  /** Skip the free-tier cap and its upsell entirely. */
  alwaysFree?: boolean;
  mode: "filter" | "columns";
  /** filter mode: one stat, added immediately. */
  onPick: (key: string) => void;
  /** columns mode: the FULL set that should be on the table afterwards. */
  onSetColumns: (keys: string[]) => void;
  /** Stats already on the table, ticked when the columns picker opens. */
  current: readonly string[];
  /** Filter slots still free, so the picker cannot mark more than fit. */
  remaining: number;
  disabled?: boolean;
  /**
   * OWNED BY THE PARENT, because a filter row can reopen this. Pressing Enter
   * in a value box means "that one's done, give me the next" — so the row has
   * to be able to raise the picker, and the picker cannot be the only thing
   * that knows whether it is up.
   */
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  // Read HERE rather than threaded down from the builder. The picker is the
  // only place that knows the reader has just hit the ceiling, and the ceiling
  // is the moment the offer is worth making.
  const { paid: paidRaw, signedIn } = useEntitlement();
  // The players table is ungated for now, so its picker never offers the
  // upsell strip. One flag rather than a second copy of the popover.
  const paid = alwaysFree || paidRaw;
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  /**
   * Stats ticked but not yet added, in the order they were ticked — which
   * becomes their column order, because the order you thought of them in is
   * the order you want to read them in.
   */
  const [marked, setMarked] = useState<string[]>([]);
  /** Viewport coords of the trigger, for the portalled popover. */
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  /**
   * THE POPOVER IS PORTALLED TO document.body, AND IT HAS TO BE.
   *
   * It sits inside the table card, which establishes an overflow context for
   * the sticky column headers below it. Any absolutely-positioned child is
   * cropped to that box — the first build of this rendered exactly one visible
   * option and a stray scrollbar. Fixed positioning off the trigger's own rect
   * sidesteps the ancestor entirely, at the cost of a reposition on scroll and
   * resize below.
   */
  const place = useCallback(() => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    // Flip above the trigger when there is not room beneath it. 340 is the
    // popover's own worst-case height (list + search row + padding).
    const below = window.innerHeight - r.bottom;
    setAt({
      left: Math.min(r.left, window.innerWidth - 336),
      top: below < 340 && r.top > 340 ? r.top - 346 : r.bottom + 6,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    inputRef.current?.focus();
    // `true` to catch scrolls on inner containers, which do not bubble a
    // scroll event to window.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  /**
   * Hand the ticked stats to the parent, or throw them away.
   *
   * Declared above the click-away effect rather than beside the other
   * handlers, because that effect is what calls them — reaching them through
   * a ref instead is the pattern React's compiler now rejects, and a
   * dependency is honest about what the effect actually uses.
   */
  const commit = useCallback(() => {
    // Columns mode commits the whole ticked set — including ticks REMOVED,
    // which is how a column comes off the table. Filter mode never gets here;
    // it commits on the click itself.
    if (mode === "columns") onSetColumns(marked);
    setMarked([]);
    setQ("");
    setHi(0);
  }, [mode, marked, onSetColumns]);
  const discard = useCallback(() => { setMarked([]); setQ(""); setHi(0); }, []);

  // Click-away and Escape. The popover is no longer a DOM descendant of the
  // trigger, so the away-test has to clear BOTH nodes or every click inside the
  // list would close the thing it clicked in.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || popRef.current?.contains(t)) return;
      // Clicking away COMMITS what is ticked. Ticking four stats and losing
      // them to a stray click would be the worst possible reading of the
      // gesture; Escape is the one that discards, and says so below.
      commit();
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); discard(); setOpen(false); }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, setOpen, commit, discard]);

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(needle) || o.desc.toLowerCase().includes(needle),
    ).sort((a, b) => {
      const ai = a.label.toLowerCase().indexOf(needle);
      const bi = b.label.toLowerCase().indexOf(needle);
      // -1 (matched on description only) sorts after every label match.
      const an = ai < 0 ? 999 : ai;
      const bn = bi < 0 ? 999 : bi;
      return an - bn || a.label.localeCompare(b.label);
    // `options` is a dependency now that it is a prop: the team list is a
    // module constant, but the players list is built per render.
    });
  }, [q, options]);

  // Clamp during render — a shrinking list must never leave the highlight past
  // the end, which would make Enter do nothing.
  const hiSafe = matches.length ? Math.min(hi, matches.length - 1) : 0;

  // Keep the highlighted row in view while arrowing through 55 options.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector(`[data-idx="${hiSafe}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [hiSafe, open]);

  /**
   * Tick or untick. Nothing reaches the table until the picker is committed.
   *
   * This replaced click-to-add-and-close. The old note here argued that the
   * popover could not stay open because picking sent the caret to a value box
   * and the popover would then float over it — true then, and no longer the
   * case, because ticking moves no caret. The cost is that adding ONE stat is
   * now a click plus Enter (or a click outside) rather than a single click;
   * the gain is that adding four is four clicks instead of four round trips
   * through the button.
   */
  const choose = (o: PickOption) => {
    const key = o.key;
    if (mode === "filter") {
      // Straight through: add it, close, and the parent puts the caret in the
      // new row's value box.
      onPick(key);
      setQ(""); setHi(0); setOpen(false);
      return;
    }
    setMarked((m) =>
      m.includes(key) ? m.filter((k) => k !== key)
        : m.length >= remaining ? m
        : [...m, key],
    );
  };


  const atCapNow = marked.length >= remaining;

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, matches.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (mode === "filter") {
        // Type a few letters, Enter, start typing the value. Unchanged.
        if (matches[hiSafe]) choose(matches[hiSafe]!);
        return;
      }
      // Columns: Enter with nothing ticked still takes the highlighted row,
      // so the keyboard path never needs the mouse. That tick is not in state
      // yet, so the set is read from the list rather than from `marked`.
      const keys = marked.length
        ? marked
        : matches[hiSafe] ? [...current, matches[hiSafe]!.key] : [];
      onSetColumns(keys);
      setMarked([]); setQ(""); setHi(0); setOpen(false);
    }
  };

  // Section headers render only while browsing. Under a search the list is
  // ranked by match quality, so group headings would break the order into
  // fragments that no longer mean anything.
  const grouped = q.trim() === "";

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        // Seeding happens HERE rather than in an effect on `open`: opening is
        // an event with a handler already attached, and the columns picker has
        // to show what is on the table before the reader touches anything.
        onClick={() => {
          if (!open && mode === "columns") setMarked(current as string[]);
          setOpen(!open);
        }}
        disabled={disabled}
        aria-expanded={open}
        aria-controls={listId}
        className={cn(
          "inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-dashed text-sm font-medium transition-colors whitespace-nowrap",
          disabled
            ? "border-ink/10 text-ink-muted/60 cursor-not-allowed"
            : "border-coral/40 text-coral hover:bg-coral/6 hover:border-coral/60",
        )}
      >
        <Plus size={15} />
        {mode === "filter" ? "Add a Filter" : "Add Columns"}
      </button>

      {open && at && typeof document !== "undefined" && createPortal(
        <div
          ref={popRef}
          style={{ position: "fixed", left: at.left, top: at.top }}
          className="z-60 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-hairline bg-popover shadow-xl overflow-hidden"
        >
          <div className="relative border-b border-hairline">
            <SearchGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-muted pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              value={q}
              onChange={(e) => { setQ(e.target.value); setHi(0); }}
              onKeyDown={onKey}
              placeholder={mode === "filter" ? "Search stats…" : "Search columns…"}
              aria-label="Search stats"
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-autocomplete="list"
              className="h-10 w-full pl-9 pr-3 bg-transparent text-ink text-sm placeholder:text-ink-muted focus:outline-none"
            />
          </div>

          <div id={listId} role="listbox" ref={listRef} className="max-h-72 overflow-y-auto py-1">
            {matches.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-ink-muted">No stat matches “{q.trim()}”.</p>
            )}
            {matches.map((o, i) => {
              const first = grouped && (i === 0 || matches[i - 1]!.group !== o.group);
              return (
                <div key={o.key}>
                  {first && (
                    <div className="px-3 pt-2.5 pb-1 text-[0.6rem] uppercase tracking-[0.12em] font-semibold text-ink-muted">
                      {groupLabel[o.group] ?? o.group}
                    </div>
                  )}
                  <button
                    type="button"
                    role="option"
                    data-idx={i}
                    aria-selected={i === hiSafe}
                    // onMouseDown, not onClick: the input keeps focus so the
                    // next stat can be typed straight away.
                    onMouseDown={(e) => { e.preventDefault(); choose(o); }}
                    onMouseEnter={() => setHi(i)}
                    title={
                      marked.includes(o.key) || !atCapNow
                        ? o.desc
                        : paid
                          ? "That is the maximum a shareable URL carries"
                          : `${remaining} columns on the free plan — untick one, or get a Season Pass`
                    }
                    className={cn(
                      "w-full text-left px-3 py-1.5 text-sm transition-colors flex items-center gap-2.5",
                      i === hiSafe ? "bg-coral/10 text-ink" : "text-ink-soft hover:bg-paper-deep",
                      !marked.includes(o.key) && atCapNow && "opacity-40",
                    )}
                  >
                    {mode === "columns" && (
                      <span
                        aria-hidden
                        className={cn(
                          "shrink-0 w-3.5 h-3.5 rounded-[3px] border inline-flex items-center justify-center transition-colors",
                          marked.includes(o.key)
                            ? "bg-coral border-coral text-white"
                            : "border-ink/25",
                        )}
                      >
                        {marked.includes(o.key) && (
                          <svg viewBox="0 0 12 12" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M2.5 6.2l2.4 2.4L9.5 3.8" />
                          </svg>
                        )}
                      </span>
                    )}
                    <span className="truncate">{o.label}</span>
                  </button>
                </div>
              );
            })}
          </div>

          {/* THE CEILING EXPLAINS ITSELF, IN THE BOX, THE MOMENT IT IS HIT.
              Without this the picker just goes quiet: the reader ticks a third
              column, every remaining row dims, and nothing on screen says why
              or what to do. The line under the trigger says it, but that is
              outside the popover and behind it — so it is read after closing,
              which is exactly too late to act on.

              Only for readers it applies to. A subscriber hitting MAX_FILTERS
              has met a URL-length limit with nothing to sell them, and gets the
              plain "· limit" in the footer instead. */}
          {atCapNow && !paid && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 border-t border-coral/25 bg-coral/[0.07]">
              <Lock size={11} strokeWidth={2.5} className="shrink-0 text-coral" aria-hidden />
              <span className="text-xs text-ink-soft leading-snug">
                {remaining} columns is the free limit.
              </span>
              <Link
                href={signedIn ? "/pricing" : "/account/signup"}
                className="text-xs font-medium text-coral hover:underline"
              >
                {signedIn ? "Upgrade for more" : "Sign up for more"}
              </Link>
            </div>
          )}

          {/* Only once something is ticked. An empty picker needs no
              instructions; a picker holding four choices needs to say what
              happens to them. */}
          {mode === "columns" && marked.length > 0 && (
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-hairline bg-paper-deep/50">
              <span className="text-xs text-ink-soft">
                <span className="font-medium text-coral">{marked.length}</span> on the table
                {atCapNow && <span className="text-ink-muted"> · limit</span>}
              </span>
              <span className="text-[0.68rem] text-ink-muted">
                <span className="font-medium text-ink-soft">Enter</span> to add
                <span className="mx-1">·</span>
                <span className="font-medium text-ink-soft">Esc</span> to clear
              </span>
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
