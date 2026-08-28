"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Download, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEntitlement } from "@/lib/use-entitlement";
import { TABLE_VIEWS } from "@/lib/team-views";

/**
 * The shape this menu needs from a view registry — a key, a label, the section
 * it lists under, and whether it is the empty build-your-own one.
 *
 * Structural rather than tied to TableView so the players registry, which
 * carries different fields, satisfies it without either side importing the
 * other.
 */
export type DownloadView = {
  key: string; label: string; group: string; desc?: string; custom?: boolean;
};

import {
  downloadAllViews, downloadCsv, downloadWorkbook,
  type ExportInput, type MultiExportInput,
} from "@/lib/table-export";

/**
 * The views the all-views workbook offers — curated sets only, never the empty
 * one, whose tab would be names and nothing else.
 *
 * Grouped in registry order, so the picker matches the View dropdown the reader
 * has already learned the shape of.
 */
function exportableGroups(views: DownloadView[]): Array<{ group: string; views: DownloadView[] }> {
  const out: Array<{ group: string; views: DownloadView[] }> = [];
  for (const v of views) {
    if (v.custom) continue;
    let g = out.find((x) => x.group === v.group);
    if (!g) { g = { group: v.group, views: [] }; out.push(g); }
    g.views.push(v);
  }
  return out;
}

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
 *
 * WHICH IS EXACTLY WHY THE LOCKED PANEL HANDS OVER A REAL FILE. If the gate
 * cannot be about withholding the numbers, it has to be about being worth
 * buying — and nothing argues for a formatted thirteen-tab workbook like a
 * formatted thirteen-tab workbook. The sample runs the same code as the paid
 * export over ten teams, so it cannot overstate what it is selling.
 */
export function DownloadMenu<R>({
  build,
  buildAll,
  buildSample,
  rowCount,
  colCount,
  disabled,
  views = TABLE_VIEWS,
  noun = "teams",
  alwaysFree = false,
}: {
  /** Assembles the export input. Called only when a format is chosen. */
  build: () => ExportInput<R>;
  /** The same rows under each named view, one tab per key, in registry order. */
  buildAll: (viewKeys: string[]) => MultiExportInput<R>;
  /** Every view over a fixed ten teams — what a locked reader can still have. */
  buildSample?: () => MultiExportInput<R>;
  rowCount: number;
  colCount: number;
  disabled?: boolean;
  /**
   * The view registry to offer. Defaults to the team explorer's, which is the
   * only caller that existed when this was written.
   */
  views?: DownloadView[];
  /** What the rows are, for the menu's own wording. */
  noun?: string;
  /**
   * Skip the membership check entirely.
   *
   * The players explorer is ungated for now, and the honest way to say that is
   * to not show a lock rather than to show one that opens for everybody. When
   * a decision is made about what the players table sells, this comes off and
   * the menu behaves exactly as it does on the team side.
   */
  alwaysFree?: boolean;
}) {
  // Unknown membership resolves as entitled — see useEntitlement. Flashing an
  // upsell at a subscriber is worse than briefly offering the menu to someone
  // who will be asked to sign in the moment they click.
  const { paid, signedIn } = useEntitlement();
  const gated = !alwaysFree && !paid;

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
  const exportable = useMemo(() => views.filter((v) => !v.custom), [views]);
  const [picked, setPicked] = useState<string[]>(() => views.filter((v) => !v.custom).map((v) => v.key));
  const [busy, setBusy] = useState<"csv" | "xlsx" | "xlsx-all" | "sample" | null>(null);
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

  async function run(kind: "csv" | "xlsx" | "xlsx-all" | "sample") {
    if (busy) return;
    setBusy(kind);
    setError(null);
    // Yield a frame before the work starts, so "building…" is painted rather
    // than arriving with the finished file. A thirteen-tab workbook walks the
    // result set once per tab and is the case that needs it.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    try {
      if (kind === "sample") await downloadAllViews(buildSample!());
      else if (kind === "xlsx-all") await downloadAllViews(buildAll(picked));
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
  const allPicked = picked.length === exportable.length;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => (open ? closeMenu() : setOpen(true))}
        disabled={disabled || empty}
        title={empty ? `Nothing to download — no ${noun} match these filters` : "Download this table"}
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
              {/* THE SAMPLE SITS BELOW THE ASK, NOT ABOVE IT. Offering the
                  free file first would answer the question before anyone had
                  asked it, and the panel would read as a giveaway with a price
                  attached rather than as a product with a preview. */}
              {buildSample && (
                <button
                  type="button"
                  onClick={() => run("sample")}
                  disabled={busy === "sample"}
                  className="mt-2 w-full rounded-md border border-ink/20 bg-card px-3 py-2 text-left transition-colors hover:border-ink/35 disabled:opacity-60"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-ink">Download a sample</span>
                    <span className="text-[0.65rem] tabular text-ink-muted shrink-0">
                      {busy === "sample" ? "building…" : ".xlsx"}
                    </span>
                  </div>
                  <div className="text-xs text-ink-muted leading-snug mt-0.5">
                    The real thing, smaller — every view, one tab each, over the
                    ten best teams of this season.
                  </div>
                </button>
              )}

              <Link
                href={signedIn ? "/account" : "/account/login"}
                className="mt-2 block text-center text-xs text-ink-muted hover:text-coral"
                onClick={closeMenu}
              >
                {signedIn ? "Manage your membership" : "Already a member? Sign in"}
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
                sub={`One tab per view. Same ${noun}, same order, same filters on every tab.`}
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
                  onClick={() => setPicked(allPicked ? [] : exportable.map((v) => v.key))}
                  className="px-2 py-1 rounded text-[0.65rem] uppercase tracking-widest font-bold text-coral hover:bg-coral/8 transition-colors"
                >
                  {allPicked ? "Clear all" : "Select all"}
                </button>
              </div>

              {/* Grouped exactly as the View dropdown groups them — the reader
                  is picking from a list they already know the shape of. */}
              <div className="max-h-64 overflow-y-auto py-1">
                {exportableGroups(views)
                  .filter((g) => g.views.length > 0)
                  .map((g) => (
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
