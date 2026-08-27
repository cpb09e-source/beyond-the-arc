"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Download, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth/auth-provider";
import { describeMembership } from "@/lib/auth/membership";
import { TABLE_VIEWS, viewGroups } from "@/lib/team-views";
import {
  downloadAllViews, downloadCsv, downloadWorkbook,
  type ExportInput, type MultiExportInput,
} from "@/lib/table-export";

/**
 * Download the table — a formatted workbook, a workbook of chosen views, or
 * raw CSV.
 *
 * BUILT ON DEMAND, NOT AHEAD OF TIME. The input is a thunk rather than a value
 * because assembling it walks every row in the result set, and the toolbar
 * re-renders on each keystroke in the table search. Nothing is built until the
 * reader actually picks a format.
 *
 * PORTALLED, for the same reason the stat picker is: the card this toolbar sits
 * in is `overflow-hidden` (it has to be — the rounded corners clip the sticky
 * table), so a menu positioned inside it is cut off at the toolbar's bottom
 * edge. Fixed positioning against the trigger's measured rect sidesteps the
 * ancestor, at the cost of repositioning on scroll and resize.
 *
 * THE MEMBERSHIP CHECK HERE IS A SIGNPOST, NOT A GATE. Every number in the file
 * is already in the browser — the season JSON is a public static asset, and it
 * has to be, because the table renders client-side. Anyone determined enough to
 * open devtools has the data with or without this menu. What the check buys is
 * that the feature is *presented* as part of the Season Pass, which is what
 * makes it worth paying for; enforcing it would need the export to come from a
 * server, and this site does not have one.
 */
export function DownloadMenu({
  build,
  buildAll,
  rowCount,
  colCount,
  disabled,
}: {
  /** Assembles the export input. Called only when a format is chosen. */
  build: () => ExportInput;
  /** The same rows under each named view, one tab per key, in registry order. */
  buildAll: (viewKeys: string[]) => MultiExportInput;
  rowCount: number;
  colCount: number;
  disabled?: boolean;
}) {
  const { status, profile } = useAuth();
  const paid = describeMembership(profile).paid;
  // "loading" is deliberately treated as paid-unknown rather than free: the
  // profile lands a moment after first paint, and flashing an upsell at a
  // subscriber before it arrives is worse than briefly offering the menu to
  // someone who will be asked to sign in when they click.
  const gated = status !== "loading" && !paid;

  const [open, setOpen] = useState(false);
  /** The menu is two screens: the format list, and the view picker. */
  const [screen, setScreen] = useState<"formats" | "views">("formats");
  /**
   * OPENS WITH EVERYTHING TICKED.
   *
   * This exists because somebody wanted all of them; starting from none would
   * make the common case thirteen clicks, and starting from the current view
   * alone still costs a click on All. Clearing is one click either way, so
   * "all" is the default that is never worse.
   */
  const [picked, setPicked] = useState<string[]>(() => TABLE_VIEWS.map((v) => v.key));
  const [busy, setBusy] = useState<"csv" | "xlsx" | "xlsx-all" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    const PANEL = 300;
    // The picker is much the taller screen, so the flip-above decision is made
    // against whichever one is showing rather than a single guessed number.
    const height = screen === "views" ? 430 : 268;
    const below = window.innerHeight - r.bottom;
    setAt({
      left: Math.max(8, Math.min(r.left, window.innerWidth - PANEL - 8)),
      top: below < height && r.top > height ? r.top - height - 6 : r.bottom + 6,
    });
  }, [screen]);

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

  /** Every close path resets to the format list, so reopening starts at the top. */
  const closeMenu = useCallback(() => {
    setOpen(false);
    setScreen("formats");
    setError(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || popRef.current?.contains(t)) return;
      closeMenu();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // Escape backs out of the picker before it closes the menu — losing a
      // set of ticks to the same key that dismisses the popover is the kind of
      // thing you only forgive once.
      if (screen === "views") setScreen("formats");
      else closeMenu();
    }
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, screen, closeMenu]);

  async function run(kind: "csv" | "xlsx" | "xlsx-all") {
    if (busy) return;
    setBusy(kind);
    setError(null);
    // Yield a frame before the work starts, so "building…" is painted rather
    // than arriving with the finished file. A thirteen-tab workbook walks the
    // result set once per tab and is the case that needs it.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    try {
      if (kind === "xlsx-all") await downloadAllViews(buildAll(picked));
      else if (kind === "csv") downloadCsv(build());
      else await downloadWorkbook(build());
      closeMenu();
    } catch (err) {
      console.error("[export] failed:", err);
      setError("Could not build the file. Try fewer tabs or a smaller selection.");
    } finally {
      setBusy(null);
    }
  }

  function toggle(key: string) {
    setPicked((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  const empty = rowCount === 0;
  const allPicked = picked.length === TABLE_VIEWS.length;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => (open ? closeMenu() : setOpen(true))}
        disabled={disabled || empty}
        title={empty ? "Nothing to download — no teams match these filters" : "Download this table"}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-[0.6rem] uppercase tracking-widest font-bold transition-colors whitespace-nowrap",
          "border-ink/20 bg-card text-ink-soft hover:border-ink/35 hover:text-ink",
          (disabled || empty) && "opacity-40 pointer-events-none",
        )}
      >
        <Download size={12} strokeWidth={2.5} />
        <span className="hidden sm:inline">Download</span>
      </button>

      {open && at && typeof document !== "undefined" && createPortal(
        <div
          ref={popRef}
          role="menu"
          style={{ position: "fixed", left: at.left, top: at.top }}
          className="z-60 w-[300px] max-w-[calc(100vw-1rem)] rounded-lg border border-hairline bg-popover shadow-xl overflow-hidden"
        >
          {/* What you are about to get, stated before the formats rather than
              after — the row count is the one thing a reader can be wrong
              about, because the table in front of them is showing a page. */}
          <div className="px-3 py-2 border-b border-hairline bg-paper-deep/40">
            <div className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">
              This table
            </div>
            <div className="text-sm text-ink tabular mt-0.5">
              {rowCount.toLocaleString()} {rowCount === 1 ? "row" : "rows"}
              <span className="text-ink-muted"> · </span>
              {colCount.toLocaleString()} columns
            </div>
          </div>

          {gated ? (
            <div className="px-3 py-3">
              <div className="flex items-start gap-2">
                <Lock size={14} className="mt-0.5 shrink-0 text-coral" />
                <div className="text-sm text-ink-soft leading-snug">
                  Exports are part of the Season Pass. Every filter, column and
                  view you have set comes down with the file.
                </div>
              </div>
              <Link
                href="/pricing"
                className="mt-3 inline-flex w-full items-center justify-center rounded-md bg-coral px-3 py-2 text-sm font-medium text-white hover:bg-coral-soft transition-colors"
                onClick={closeMenu}
              >
                See plans
              </Link>
              <Link
                href="/account/login"
                className="mt-2 block text-center text-xs text-ink-muted hover:text-coral"
                onClick={closeMenu}
              >
                Already a member? Sign in
              </Link>
            </div>
          ) : screen === "formats" ? (
            <div className="py-1">
              <MenuItem
                title="Excel workbook"
                sub="This view, formatted, with percentile colours and a sheet describing the export"
                ext=".xlsx"
                busy={busy === "xlsx"}
                onClick={() => run("xlsx")}
              />
              {/* Its own screen rather than a straight download: the reason to
                  reach for this is comparison, and which views are worth
                  comparing is the reader's question, not ours. */}
              <MenuItem
                title="Excel — select views"
                sub="One tab per view. Same teams, same order, same filters on every tab."
                trailing={<ChevronRight size={14} className="text-ink-muted" />}
                onClick={() => setScreen("views")}
              />
              <MenuItem
                title="CSV"
                sub="Raw values — rates as decimals, nothing rounded for display"
                ext=".csv"
                busy={busy === "csv"}
                onClick={() => run("csv")}
              />
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between gap-2 px-2 py-1.5 border-b border-hairline">
                <button
                  type="button"
                  onClick={() => setScreen("formats")}
                  className="inline-flex items-center gap-1 px-1 py-1 rounded text-xs text-ink-muted hover:text-coral transition-colors"
                >
                  <ChevronLeft size={13} />
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => setPicked(allPicked ? [] : TABLE_VIEWS.map((v) => v.key))}
                  className="px-2 py-1 rounded text-[0.65rem] uppercase tracking-widest font-bold text-coral hover:bg-coral/8 transition-colors"
                >
                  {allPicked ? "Clear all" : "Select all"}
                </button>
              </div>

              {/* Grouped exactly as the View dropdown groups them — the reader
                  is picking from a list they already know the shape of. */}
              <div className="max-h-64 overflow-y-auto py-1">
                {viewGroups().map((g) => (
                  <div key={g.group}>
                    <div className="px-3 pt-2 pb-1 text-[0.58rem] uppercase tracking-[0.15em] text-ink-muted font-semibold">
                      {g.group}
                    </div>
                    {g.views.map((v) => {
                      const on = picked.includes(v.key);
                      return (
                        <label
                          key={v.key}
                          title={v.desc}
                          className="flex items-center gap-2.5 px-3 py-1.5 cursor-pointer hover:bg-paper-deep/60 transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => toggle(v.key)}
                            className="w-3.5 h-3.5 shrink-0 accent-coral"
                          />
                          <span className={cn("text-sm truncate", on ? "text-ink" : "text-ink-muted")}>
                            {v.label}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ))}
              </div>

              <div className="px-3 py-2.5 border-t border-hairline bg-paper-deep/40">
                <button
                  type="button"
                  onClick={() => run("xlsx-all")}
                  disabled={picked.length === 0 || busy === "xlsx-all"}
                  className={cn(
                    "w-full inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    picked.length === 0
                      ? "bg-ink/10 text-ink-muted cursor-not-allowed"
                      : "bg-coral text-white hover:bg-coral-soft",
                  )}
                >
                  {busy === "xlsx-all"
                    ? "Building…"
                    : picked.length === 0
                      ? "Pick at least one view"
                      : `Download ${picked.length} ${picked.length === 1 ? "tab" : "tabs"}`}
                </button>
                {/* A rough size, because thirteen tabs of twelve seasons is a
                    7 MB file and that should not be a surprise. */}
                <div className="mt-1.5 text-[0.65rem] text-ink-muted text-center tabular">
                  {(rowCount * picked.length).toLocaleString()} rows written across{" "}
                  {picked.length === 1 ? "1 tab" : `${picked.length} tabs`}
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="px-3 py-2 border-t border-hairline text-xs text-bad">{error}</div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

function MenuItem({
  title, sub, ext, busy, trailing, onClick,
}: {
  title: string;
  sub: string;
  ext?: string;
  busy?: boolean;
  trailing?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={busy}
      className="w-full text-left px-3 py-2.5 hover:bg-paper-deep/60 transition-colors disabled:opacity-60"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-ink">{title}</span>
        <span className="text-[0.65rem] tabular text-ink-muted shrink-0">
          {busy ? "building…" : trailing ?? ext}
        </span>
      </div>
      <div className="text-xs text-ink-muted leading-snug mt-0.5">{sub}</div>
    </button>
  );
}
