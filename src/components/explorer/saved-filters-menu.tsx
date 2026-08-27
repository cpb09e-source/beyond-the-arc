"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Bookmark, Check, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  describeQuery, removeSaved, upsertSaved, writeSaved,
  savedSnapshot, savedServerSnapshot, subscribeSaved,
  MAX_SAVED, type SavedFilter,
} from "@/lib/saved-filters";

/**
 * Save the current table and come back to it.
 *
 * SITS BESIDE THE VIEW SELECT because it answers the same shape of question —
 * "put the table back the way I had it" — and differs only in who authored the
 * arrangement. A view is one of ours; a saved filter is one of theirs.
 *
 * APPLYING IS INSTANT, no Submit, for the reason the view select is: a saved
 * query is complete the moment it is chosen. It writes the whole URL at once,
 * which is also what makes it safe — the scope bar above re-reads its draft
 * from the URL, so seasons and conference follow along instead of being left
 * showing the previous selection.
 *
 * THE LIST IS READ AS AN EXTERNAL STORE. localStorage does not exist during
 * the static export, so the entries cannot be part of the exported HTML;
 * useSyncExternalStore renders the empty server snapshot through hydration and
 * swaps in the real list straight after, which is both mismatch-free and how
 * a second tab's saves arrive here without a reload.
 */
export function SavedFiltersMenu({
  currentQuery,
  suggestedName,
  onApply,
}: {
  /** The explorer's current query string, canonical (specToParams order). */
  currentQuery: string;
  /** What the name box opens with. */
  suggestedName: string;
  onApply: (query: string) => void;
}) {
  const saved = useSyncExternalStore(subscribeSaved, savedSnapshot, savedServerSnapshot);
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  /**
   * Closing resets the save box, so reopening never shows a half-typed name
   * from a save the reader walked away from.
   *
   * Done here rather than in an effect on `open`: every close is a deliberate
   * act with a handler already attached, and an effect would be reacting to
   * state this component itself just set.
   */
  const closeMenu = useCallback(() => {
    setOpen(false);
    setNaming(false);
    setProblem(null);
  }, []);

  const place = useCallback(() => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    const PANEL = 320;
    const HEIGHT = 320;
    const below = window.innerHeight - r.bottom;
    setAt({
      left: Math.max(8, Math.min(r.left, window.innerWidth - PANEL - 8)),
      top: below < HEIGHT && r.top > HEIGHT ? r.top - HEIGHT - 6 : r.bottom + 6,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || popRef.current?.contains(t)) return;
      closeMenu();
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") closeMenu(); }
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, closeMenu]);

  useEffect(() => {
    if (naming) nameRef.current?.select();
  }, [naming]);

  /** The saved entry the table is currently showing, if any. */
  const active = saved.find((e) => e.query === currentQuery);

  /** Write, and say so if the browser refuses. The store re-reads itself. */
  function commit(next: SavedFilter[]) {
    if (!writeSaved(next)) {
      setProblem("This browser is not allowing saved filters — check whether it is blocking site data.");
    }
  }

  function save() {
    const trimmed = name.trim();
    if (!trimmed) { nameRef.current?.focus(); return; }
    const replacing = saved.some((e) => e.name.toLowerCase() === trimmed.toLowerCase());
    if (!replacing && saved.length >= MAX_SAVED) {
      setProblem(`That is ${MAX_SAVED} saved filters — remove one before adding another.`);
      return;
    }
    setProblem(null);
    commit(upsertSaved(saved, trimmed, currentQuery));
    setNaming(false);
  }

  function startNaming() {
    setName(active ? active.name : suggestedName);
    setProblem(null);
    setNaming(true);
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => (open ? closeMenu() : setOpen(true))}
        title="Saved filters"
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-[0.6rem] uppercase tracking-widest font-bold transition-colors whitespace-nowrap",
          active
            ? "border-coral/40 bg-coral/6 text-coral hover:bg-coral/10"
            : "border-ink/20 bg-card text-ink-soft hover:border-ink/35 hover:text-ink",
        )}
      >
        <Bookmark size={12} strokeWidth={2.5} fill={active ? "currentColor" : "none"} />
        <span className="hidden sm:inline">Saved</span>
        {saved.length > 0 && <span className="tabular font-medium">{saved.length}</span>}
      </button>

      {open && at && typeof document !== "undefined" && createPortal(
        <div
          ref={popRef}
          role="menu"
          style={{ position: "fixed", left: at.left, top: at.top }}
          className="z-60 w-[320px] max-w-[calc(100vw-1rem)] rounded-lg border border-hairline bg-popover shadow-xl overflow-hidden"
        >
          {/* SAVE FIRST, LIST BELOW. The list grows and the save row does not,
              so putting the action on top keeps it in the same place whether
              there are none saved or twenty. */}
          <div className="px-3 py-2.5 border-b border-hairline bg-paper-deep/40">
            {naming ? (
              <div className="flex items-center gap-2">
                <input
                  ref={nameRef}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); save(); }
                    if (e.key === "Escape") { e.preventDefault(); setNaming(false); }
                  }}
                  placeholder="Name this filter"
                  aria-label="Name for the saved filter"
                  maxLength={60}
                  className="h-8 flex-1 min-w-0 px-2 rounded-md border border-ink/15 bg-card text-ink text-sm placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-coral/40 focus:border-coral/40"
                />
                <button
                  type="button"
                  onClick={save}
                  className="h-8 shrink-0 px-3 rounded-md bg-coral text-white text-xs font-medium hover:bg-coral-soft transition-colors"
                >
                  Save
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={startNaming}
                className="w-full text-left group"
              >
                <div className="text-sm font-medium text-ink group-hover:text-coral transition-colors">
                  {active ? `Update “${active.name}”` : "Save these filters"}
                </div>
                <div className="text-xs text-ink-muted leading-snug mt-0.5">
                  {describeQuery(currentQuery)}
                </div>
              </button>
            )}
          </div>

          {saved.length === 0 ? (
            <div className="px-3 py-3 text-xs text-ink-muted leading-snug">
              Nothing saved yet. A saved filter keeps the whole table — seasons,
              conference, every stat filter, your columns and the view — and puts
              it back in one click.
            </div>
          ) : (
            <ul className="max-h-72 overflow-y-auto py-1">
              {saved.map((e) => {
                const isActive = e.id === active?.id;
                return (
                  <li key={e.id} className="group/row flex items-stretch">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => { onApply(e.query); closeMenu(); }}
                      className="flex-1 min-w-0 text-left px-3 py-2 hover:bg-paper-deep/60 transition-colors"
                    >
                      <div className="flex items-center gap-1.5">
                        {isActive && <Check size={12} className="shrink-0 text-coral" strokeWidth={3} />}
                        <span className={cn("text-sm truncate", isActive ? "text-coral font-medium" : "text-ink")}>
                          {e.name}
                        </span>
                      </div>
                      <div className="text-xs text-ink-muted truncate mt-0.5">{describeQuery(e.query)}</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => commit(removeSaved(saved, e.id))}
                      aria-label={`Delete ${e.name}`}
                      title="Delete this saved filter"
                      // Always present for touch, where there is no hover to
                      // reveal it; it only gains contrast on pointer devices.
                      className="shrink-0 px-2.5 text-bad/75 hover:text-bad hover:bg-bad/8 transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Said here rather than discovered on another device. */}
          <div className="px-3 py-2 border-t border-hairline text-[0.68rem] text-ink-muted leading-snug">
            {problem ?? "Saved in this browser only. Clearing site data removes them."}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
