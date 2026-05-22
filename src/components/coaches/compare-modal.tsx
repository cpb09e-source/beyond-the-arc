"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { TeamLogo } from "@/components/team-logo";
import { cn } from "@/lib/utils";
import { confDisplay } from "@/lib/conf-display";
import type { CoachRow } from "@/app/coaches/page";

/**
 * Head-to-head compare modal — pick 2-4 coaches and see them side by side.
 * Wired from /coaches via a desktop-only trigger ("Click to compare coaches").
 * Categories cover résumé peaks (titles, F4s, S16+), volume (career wins,
 * seasons, schools), and quality (composite score). Best value per row gets
 * a green tint; worst gets a coral tint; ties get neither.
 */

const MAX_SLOTS = 4;

type Direction = "higher" | "lower" | "depth" | "none";

const ROUND_DEPTH: Record<string, number> = {
  "First Four": 0, "R64": 1, "R32": 2, "Sweet 16": 3, "Elite Eight": 4, "Final Four": 5, "Runner-up": 6, "Champion": 7,
};

// Friendly short labels for best_finish display.
const FINISH_LABEL: Record<string, string> = {
  "First Four": "First Four",
  "R64": "Round of 64",
  "R32": "Round of 32",
  "Sweet 16": "Sweet 16",
  "Elite Eight": "Elite Eight",
  "Final Four": "Final Four",
  "Runner-up": "Title game",
  "Champion": "National title",
};

type Row = {
  key: string;
  label: string;
  /** Per-coach raw value (used for max/min comparison). Null = "—". */
  value: (c: CoachRow) => number | string | null;
  /** What value is "best": higher number, lower number, deeper bracket round, or no comparison. */
  dir: Direction;
  /** Formatter for display. Default: stringify. */
  format?: (v: number | string | null) => string;
};

function fmtPct(v: number | null): string {
  if (v === null) return "—";
  return (v * 100).toFixed(1) + "%";
}
function fmtRec(c: CoachRow): string {
  return `${c.career_wins}-${c.career_losses}`;
}

const ROWS: Row[] = [
  { key: "titles", label: "National titles", value: (c) => c.ncaa_titles, dir: "higher" },
  { key: "f4", label: "Final Fours", value: (c) => c.final_fours, dir: "higher" },
  { key: "s16", label: "Sweet 16+ trips", value: (c) => c.sweet_sixteens, dir: "higher" },
  { key: "ncaa", label: "NCAA Tournament trips", value: (c) => c.ncaa_appearances, dir: "higher" },
  { key: "best", label: "Deepest run", value: (c) => c.best_finish, dir: "depth",
    format: (v) => (v == null || typeof v !== "string") ? "—" : (FINISH_LABEL[v] ?? v) },
  { key: "powerch", label: "Power reg-season titles", value: (c) => c.power_reg_champs, dir: "higher" },
  { key: "regch", label: "Reg-season conf titles", value: (c) => c.reg_season_champs, dir: "higher" },
  { key: "20w", label: "20+ win seasons", value: (c) => c.twenty_win_seasons, dir: "higher" },
  { key: "30w", label: "30+ win seasons", value: (c) => c.thirty_win_seasons, dir: "higher" },
  { key: "wins", label: "Career wins", value: (c) => c.career_wins, dir: "higher" },
  { key: "rec", label: "Career W-L", value: (c) => fmtRec(c), dir: "none" },
  { key: "winpct", label: "Career win %", value: (c) => c.career_win_pct, dir: "higher",
    format: (v) => fmtPct(typeof v === "number" ? v : null) },
  { key: "seas", label: "Seasons coached", value: (c) => c.seasons_count, dir: "higher" },
  // Composite score row — has special formatter in render that appends a (#rank)
  // suffix from the global ranking across allCoaches.
  { key: "comp", label: "Composite score", value: (c) => c.composite_score ?? null, dir: "higher" },
];

export function CompareModal({
  open,
  onClose,
  allCoaches,
}: {
  open: boolean;
  onClose: () => void;
  allCoaches: CoachRow[];
}) {
  const [slots, setSlots] = useState<(string | null)[]>([null, null, null, null]);
  const [openPickerSlot, setOpenPickerSlot] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Esc to close; lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (openPickerSlot !== null) setOpenPickerSlot(null);
        else onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose, openPickerSlot]);

  // Reset slots when modal closes so reopening starts fresh.
  useEffect(() => {
    if (!open) {
      setSlots([null, null, null, null]);
      setOpenPickerSlot(null);
    }
  }, [open]);

  const coachBySlug = useMemo(() => {
    const m = new Map<string, CoachRow>();
    for (const c of allCoaches) m.set(c.slug, c);
    return m;
  }, [allCoaches]);

  // Composite rank lookup — coaches sorted desc by composite_score, position
  // becomes the rank. Used to render "270.4 (#1)" in the Composite Score row.
  const compositeRankBySlug = useMemo(() => {
    const m = new Map<string, number>();
    const ranked = allCoaches
      .filter((c) => c.composite_score != null)
      .sort((a, b) => (b.composite_score ?? 0) - (a.composite_score ?? 0));
    ranked.forEach((c, i) => m.set(c.slug, i + 1));
    return m;
  }, [allCoaches]);

  const filledCoaches = slots
    .map((s) => (s ? coachBySlug.get(s) ?? null : null))
    .filter((c): c is CoachRow => c !== null);
  const showCompare = filledCoaches.length >= 2;

  function setSlot(i: number, slug: string | null) {
    setSlots((prev) => {
      const next = [...prev];
      next[i] = slug;
      return next;
    });
  }

  // Per-row best/worst lookup for highlighting.
  function rowExtremes(row: Row): { bestKey: string | null; worstKey: string | null } {
    if (row.dir === "none") return { bestKey: null, worstKey: null };
    const entries = filledCoaches.map((c) => ({ slug: c.slug, raw: row.value(c) }));
    if (entries.length < 2) return { bestKey: null, worstKey: null };

    if (row.dir === "depth") {
      const numbered = entries.map((e) => ({ slug: e.slug, n: typeof e.raw === "string" ? (ROUND_DEPTH[e.raw] ?? -1) : -1 }));
      const max = Math.max(...numbered.map((x) => x.n));
      const min = Math.min(...numbered.map((x) => x.n));
      if (max === min) return { bestKey: null, worstKey: null };
      const bestSlugs = numbered.filter((x) => x.n === max).map((x) => x.slug);
      const worstSlugs = numbered.filter((x) => x.n === min).map((x) => x.slug);
      return { bestKey: bestSlugs.length === 1 ? bestSlugs[0]! : null, worstKey: worstSlugs.length === 1 ? worstSlugs[0]! : null };
    }
    const nums = entries.map((e) => ({ slug: e.slug, n: typeof e.raw === "number" ? e.raw : NaN }));
    const valid = nums.filter((x) => Number.isFinite(x.n));
    if (valid.length < 2) return { bestKey: null, worstKey: null };
    const max = Math.max(...valid.map((x) => x.n));
    const min = Math.min(...valid.map((x) => x.n));
    if (max === min) return { bestKey: null, worstKey: null };
    const bestN = row.dir === "higher" ? max : min;
    const worstN = row.dir === "higher" ? min : max;
    const bestSlugs = valid.filter((x) => x.n === bestN).map((x) => x.slug);
    const worstSlugs = valid.filter((x) => x.n === worstN).map((x) => x.slug);
    return { bestKey: bestSlugs.length === 1 ? bestSlugs[0]! : null, worstKey: worstSlugs.length === 1 ? worstSlugs[0]! : null };
  }

  if (!open || !mounted) return null;

  const body = (
    <div
      role="dialog"
      aria-modal
      aria-label="Compare coaches"
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 p-4 pt-[5vh] overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-card border border-hairline rounded-xl shadow-xl w-full max-w-6xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-end justify-between px-6 py-5 border-b border-hairline bg-paper-deep/30">
          <div>
            <div className="text-[0.6rem] uppercase tracking-[0.18em] text-coral font-bold mb-1.5 flex items-center gap-2">
              <span className="h-px w-6 bg-coral" />
              Head to head
            </div>
            <h2 className="font-display text-3xl text-ink leading-none tracking-tight">Compare coaches</h2>
            <p className="text-sm text-ink-muted mt-2 max-w-2xl">
              Pick up to four coaches. Best mark per row in <span className="text-emerald-700 font-medium">green</span>, worst in <span className="text-coral font-medium">coral</span>.
              Ties get neither.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-ink-muted hover:text-ink transition-colors text-lg w-8 h-8 inline-flex items-center justify-center rounded hover:bg-paper-deep/60"
          >
            ×
          </button>
        </div>

        {/* Slot pickers */}
        <div className="px-6 py-5 border-b border-hairline">
          <div className="grid grid-cols-4 gap-3">
            {slots.map((slug, i) => {
              const coach = slug ? coachBySlug.get(slug) ?? null : null;
              const excluded = new Set(slots.filter((s, j) => s && j !== i) as string[]);
              return (
                <SlotPicker
                  key={i}
                  index={i}
                  coach={coach}
                  allCoaches={allCoaches}
                  excluded={excluded}
                  open={openPickerSlot === i}
                  onOpenChange={(o) => setOpenPickerSlot(o ? i : null)}
                  onPick={(s, advance) => {
                    // Functional update so we can both fill this slot AND
                    // immediately decide which slot to open next based on the
                    // post-fill state — atomic, no stale closures.
                    setSlots((prev) => {
                      const next = [...prev];
                      next[i] = s;
                      if (advance) {
                        const nextEmpty = next.findIndex((v, j) => v === null && j > i);
                        const empty = nextEmpty !== -1
                          ? nextEmpty
                          : next.findIndex((v) => v === null);
                        setOpenPickerSlot(empty === -1 ? null : empty);
                      } else {
                        setOpenPickerSlot(null);
                      }
                      return next;
                    });
                  }}
                  onClear={() => setSlot(i, null)}
                />
              );
            })}
          </div>
        </div>

        {/* Comparison body — min-h keeps the modal at its "full" size from
            the moment it opens, so picking coaches doesn't visually resize
            the modal mid-interaction. */}
        <div className="min-h-[60vh] max-h-[65vh] overflow-y-auto overscroll-contain">
          {!showCompare ? (
            <div className="px-6 py-24 text-center text-ink-muted text-sm">
              Pick at least <span className="text-ink font-medium">2 coaches</span> to start comparing.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-paper-deep/80 backdrop-blur z-10">
                <tr className="border-b border-hairline">
                  <th className="px-5 py-3 text-left text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium w-56">Category</th>
                  {filledCoaches.map((c) => (
                    <th key={c.slug} className="px-4 py-3 text-left">
                      <div className="flex items-center gap-2.5 min-w-0">
                        {c.current_team && <TeamLogo name={c.current_team} size={28} />}
                        <div className="min-w-0">
                          <Link href={`/coaches/${c.slug}/`} className="font-display text-base text-ink leading-tight hover:text-coral transition-colors block truncate">
                            {c.name}
                          </Link>
                          <div className="text-[0.65rem] text-ink-muted leading-tight truncate">
                            {c.current_team ?? "—"}
                            {c.current_conference && <span className="text-ink-muted"> · {confDisplay(c.current_conference)}</span>}
                          </div>
                        </div>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row, ri) => {
                  const { bestKey, worstKey } = rowExtremes(row);
                  return (
                    <tr key={row.key} className={cn("border-b border-hairline/60", ri % 2 === 0 ? "bg-paper/40" : "")}>
                      <td className="px-5 py-3 text-ink-soft text-xs uppercase tracking-widest font-medium">{row.label}</td>
                      {filledCoaches.map((c) => {
                        const raw = row.value(c);
                        let display: string;
                        if (row.key === "comp") {
                          // Composite score row — append global ranking in parens.
                          if (typeof raw === "number") {
                            const rank = compositeRankBySlug.get(c.slug);
                            display = rank != null ? `${raw.toFixed(1)} (#${rank})` : raw.toFixed(1);
                          } else {
                            display = "—";
                          }
                        } else if (row.format) {
                          display = row.format(raw);
                        } else {
                          display = raw == null ? "—" : String(raw);
                        }
                        const isBest = bestKey === c.slug;
                        const isWorst = worstKey === c.slug;
                        return (
                          <td
                            key={c.slug}
                            className={cn(
                              "px-4 py-3 tabular text-base text-ink",
                              isBest && "bg-emerald-50 text-emerald-900 font-semibold",
                              isWorst && "bg-coral/10 text-coral font-medium",
                            )}
                          >
                            {display}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(body, document.body);
}

// ---- Slot picker ----

function SlotPicker({
  index, coach, allCoaches, excluded, open, onOpenChange, onPick, onClear,
}: {
  index: number;
  coach: CoachRow | null;
  allCoaches: CoachRow[];
  excluded: Set<string>;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Pick a coach. `advance=true` (from Enter/Tab in the search input) signals
   *  the parent should auto-open the next empty slot's picker. */
  onPick: (slug: string, advance: boolean) => void;
  onClear: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const [hIdx, setHIdx] = useState(0);

  useEffect(() => {
    if (!open) { setQ(""); setHIdx(0); return; }
    function onDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) onOpenChange(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, onOpenChange]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = allCoaches.filter((c) => !excluded.has(c.slug));
    if (!needle) {
      // Default ordering: active first, then by composite desc.
      return [...base].sort((a, b) => {
        if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
        return (b.composite_score ?? 0) - (a.composite_score ?? 0);
      }).slice(0, 60);
    }
    return base.filter((c) =>
      c.name.toLowerCase().includes(needle) ||
      (c.current_team ?? "").toLowerCase().includes(needle),
    ).slice(0, 60);
  }, [allCoaches, excluded, q]);

  // Reset highlight to top whenever the filtered list changes (typing).
  useEffect(() => { setHIdx(0); }, [q]);

  // Keep the highlighted row in view as user arrow-navigates.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.children[hIdx] as HTMLElement | undefined;
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [hIdx, open]);

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (filtered.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHIdx((i) => (i + 1) % filtered.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHIdx((i) => (i - 1 + filtered.length) % filtered.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      // Both keys pick the highlighted coach. Enter and Tab also advance to
      // the next empty slot (parent reads `advance=true` and opens it).
      const pick = filtered[hIdx];
      if (pick) {
        e.preventDefault();
        onPick(pick.slug, true);
      }
    }
  }

  return (
    <div ref={containerRef} className="relative">
      {coach ? (
        <div className="bg-paper border border-hairline rounded-lg p-3 flex items-center gap-3 min-h-[68px]">
          {coach.current_team && <TeamLogo name={coach.current_team} size={32} />}
          <div className="flex-1 min-w-0">
            <div className="font-medium text-ink text-sm leading-tight truncate">{coach.name}</div>
            <div className="text-[0.65rem] text-ink-muted truncate">{coach.current_team ?? "—"}</div>
          </div>
          <button
            type="button"
            onClick={onClear}
            aria-label="Remove coach"
            className="text-ink-muted hover:text-coral transition-colors w-7 h-7 inline-flex items-center justify-center rounded hover:bg-paper-deep/60 text-base shrink-0"
          >
            ×
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onOpenChange(true)}
          className={cn(
            "w-full min-h-[68px] border-2 border-dashed border-hairline rounded-lg p-3 text-center text-sm text-ink-muted hover:border-coral/50 hover:text-coral transition-colors",
            open && "border-coral/60 text-coral",
          )}
        >
          + Add coach {index + 1}
        </button>
      )}

      {open && !coach && (
        <div className="absolute top-full left-0 mt-1 w-72 bg-card border border-hairline rounded-lg shadow-lg z-30 overflow-hidden">
          <div className="p-2 border-b border-hairline">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onInputKey}
              placeholder="Search coach or team…"
              autoFocus
              className="w-full h-9 px-3 rounded border border-hairline bg-card text-ink text-sm placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-coral/40"
            />
            <div className="mt-1.5 text-[0.6rem] text-ink-muted px-1">
              ↑↓ to navigate · Enter or Tab to select &amp; jump to next slot
            </div>
          </div>
          <div ref={listRef} className="max-h-72 overflow-y-auto overscroll-contain py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-ink-muted">No matches.</div>
            ) : (
              filtered.map((c, i) => (
                <button
                  key={c.slug}
                  type="button"
                  onClick={() => onPick(c.slug, false)}
                  onMouseEnter={() => setHIdx(i)}
                  className={cn(
                    "w-full px-3 py-1.5 flex items-center gap-2 text-left transition-colors",
                    i === hIdx ? "bg-paper-deep" : "hover:bg-paper-deep/60",
                  )}
                >
                  {c.current_team && <TeamLogo name={c.current_team} size={20} />}
                  <span className="text-sm text-ink truncate flex-1">{c.name}</span>
                  <span className="text-[0.65rem] text-ink-muted truncate max-w-[100px]">{c.current_team ?? ""}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
