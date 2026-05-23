"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { TeamLogo } from "@/components/team-logo";
import { cn } from "@/lib/utils";
import { confDisplay } from "@/lib/conf-display";
import { POWER_CONFS } from "@/lib/conf-tiers";
import { pctColor } from "@/components/percentile-chip";
import {
  processTeams,
  type RawTeamSeason,
  type TeamRow,
  type TeamFilterSpec,
} from "@/lib/team-filters";
import * as htmlToImage from "html-to-image";

/**
 * Head-to-head Compare Teams modal — pick up to 4 (team, season) slots and
 * see them side by side. Mirrors the Compare Coaches pattern: best mark per
 * row in green, worst in coral, ties get neither.
 *
 * Each slot is a `${team}|${year}` string. Stats come from the same
 * `processTeams` pipeline used by the leaderboard, so BTA RTG / Adj
 * ratings are computed against the slot's own season cohort — comparing
 * 14-15 Kentucky vs 24-25 Duke uses each team's own-year z-scores.
 */

const MAX_SLOTS = 4;

type Direction = "higher" | "lower" | "depth" | "none";

const ROUND_DEPTH: Record<string, number> = {
  "First Four": 0, "R1": 1, "R2": 2, "Sweet 16": 3, "Elite 8": 4,
  "Final Four": 5, "Runner-up": 6, "Champion": 7,
};

type SlotCtx = {
  coach: string | null;
  tourneyFinish: string | null;
  // SoS rank (in the country) for this team-season, where #1 = hardest
  // schedule. Computed from all teams in the same year by sorting their
  // raw `sos` value desc. Cohort size lets us show "#79 of 364".
  sosRank: { rank: number; cohort: number } | null;
};

type Row = {
  key: string;
  label: string;
  /** Per-slot raw value (used for max/min comparison + display). */
  value: (t: TeamRow, ctx: SlotCtx) => number | string | null;
  /** What value is "best": higher number, lower number, deeper bracket round, or none. */
  dir: Direction;
  /** Formatter for display. Default: stringify. */
  format?: (v: number | string | null) => string;
  /** Optional section header rendered above this row. */
  section?: string;
  /** Key into TeamRow.pct — when present, the percentile chip displays
   *  next to the value. Not every stat has a precomputed percentile. */
  pctKey?: string;
};

const fmtNum1 = (v: number | string | null): string =>
  typeof v === "number" ? v.toFixed(1) : "—";
const fmtRank = (v: number | string | null): string =>
  typeof v === "number" ? `#${v}` : "—";
const fmtPct1 = (v: number | string | null): string =>
  typeof v === "number" ? (v * 100).toFixed(1) + "%" : "—";
const fmtNum0Signed = (v: number | string | null): string => {
  if (typeof v !== "number") return "—";
  return (v > 0 ? "+" : "") + v.toFixed(0);
};
const fmtNum1Signed = (v: number | string | null): string => {
  if (typeof v !== "number") return "—";
  return (v > 0 ? "+" : "") + v.toFixed(1);
};
const fmtString = (v: number | string | null): string =>
  v == null ? "—" : String(v);
const fmtTourney = (v: number | string | null): string =>
  v == null || typeof v !== "string" ? "Missed tournament" : v;

const ROWS: Row[] = [
  // ── Context ─────────────────────────────────────────
  { section: "Context", key: "coach", label: "Head coach", dir: "none", value: (_t, ctx) => ctx.coach, format: fmtString },
  { key: "conf", label: "Conference", dir: "none", value: (t) => t.team_conference ? confDisplay(t.team_conference) : null, format: fmtString },
  { key: "record", label: "Record", dir: "none", value: (t) => t.record, format: fmtString },
  { key: "tourney", label: "Tournament finish", dir: "depth", value: (_t, ctx) => ctx.tourneyFinish, format: fmtTourney },

  // ── Ratings ─────────────────────────────────────────
  { section: "Ratings", key: "bta_rtg", label: "BTA RTG", dir: "higher", value: (t) => t.bta_rtg, format: fmtNum1, pctKey: "bta_rtg" },
  { key: "bta_net", label: "Adj Net Rtg", dir: "higher", value: (t) => t.bta_net, format: fmtNum1Signed, pctKey: "bta_net" },
  { key: "bta_ortg", label: "Adj ORtg", dir: "higher", value: (t) => t.bta_ortg, format: fmtNum1, pctKey: "bta_ortg" },
  { key: "bta_drtg", label: "Adj DRtg", dir: "lower", value: (t) => t.bta_drtg, format: fmtNum1, pctKey: "bta_drtg" },
  { key: "sos", label: "SoS rank", dir: "lower", value: (_t, ctx) => ctx.sosRank?.rank ?? null, format: fmtRank },

  // ── Four Factors ────────────────────────────────────
  { section: "Four Factors", key: "reb_diff_ct", label: "REB Diff", dir: "higher", value: (t) => t.reb_diff_ct, format: fmtNum0Signed, pctKey: "reb_diff_ct" },
  { key: "fg3m_diff_ct", label: "3PM Diff", dir: "higher", value: (t) => t.fg3m_diff_ct, format: fmtNum0Signed, pctKey: "fg3m_diff_ct" },
  { key: "fbpts_diff", label: "FBP Diff", dir: "higher", value: (t) => t.fbpts_diff, format: fmtNum0Signed, pctKey: "fbpts_diff" },
  { key: "tov_diff_ct", label: "TOV Diff", dir: "lower", value: (t) => t.tov_diff_ct, format: fmtNum0Signed, pctKey: "tov_diff_ct" },

  // ── Style ───────────────────────────────────────────
  { section: "Style", key: "fg3rate", label: "3PA Rate", dir: "none", value: (t) => t.cbb_fg3rate, format: fmtPct1 },
  { key: "ftarate", label: "FTA Rate", dir: "none", value: (t) => t.cbb_ftarate, format: fmtPct1 },
  { key: "ast", label: "Assist %", dir: "none", value: (t) => t.cbb_ast, format: fmtPct1 },
  { key: "pitp", label: "Paint Pts %", dir: "none", value: (t) => t.cbb_pitp, format: fmtPct1 },
  { key: "fbpts", label: "FB Pts %", dir: "none", value: (t) => t.cbb_fbpts, format: fmtPct1 },
  { key: "adjt", label: "Adj Tempo", dir: "none", value: (t) => t.adjt, format: fmtNum1, pctKey: "adjt" },

  // ── Shooting ────────────────────────────────────────
  { section: "Shooting", key: "efg", label: "eFG%", dir: "higher", value: (t) => t.cbb_efg, format: fmtPct1, pctKey: "cbb_efg" },
  { key: "ts", label: "TS%", dir: "higher", value: (t) => t.cbb_ts, format: fmtPct1, pctKey: "cbb_ts" },
  { key: "fg3", label: "3P%", dir: "higher", value: (t) => t.cbb_fg3, format: fmtPct1, pctKey: "cbb_fg3" },
  { key: "tov", label: "TOV%", dir: "lower", value: (t) => t.cbb_tov, format: fmtPct1 },
  { key: "orb", label: "OREB%", dir: "higher", value: (t) => t.cbb_orb, format: fmtPct1 },
];

function teamSlug(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function seasonLabel(y: number): string {
  return `${(y - 1).toString().slice(-2)}-${y.toString().slice(-2)}`;
}

export function CompareTeamsModal({
  open,
  onClose,
  allTeams,
  coachByTeamYear,
  tourneyFinishByTeamYear,
}: {
  open: boolean;
  onClose: () => void;
  allTeams: RawTeamSeason[];
  coachByTeamYear: Record<string, string | null>;
  tourneyFinishByTeamYear: Record<string, string>;
}) {
  const [slots, setSlots] = useState<(string | null)[]>([null, null, null, null]);
  const [openPickerSlot, setOpenPickerSlot] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

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

  useEffect(() => {
    if (!open) {
      setSlots([null, null, null, null]);
      setOpenPickerSlot(null);
    }
  }, [open]);

  // Flat option list: every (team, year) we have. Pre-sorted by year desc then
  // team alpha so the natural picker default reads "most recent first".
  const options = useMemo(() => {
    const out = allTeams.map((t) => ({
      key: `${t.name}|${t.year}`,
      team: t.name,
      year: t.year,
      conference: t.conference,
      label: `${t.name} · ${seasonLabel(t.year)}`,
    }));
    out.sort((a, b) => b.year - a.year || a.team.localeCompare(b.team));
    return out;
  }, [allTeams]);

  const optionByKey = useMemo(() => {
    const m = new Map<string, typeof options[number]>();
    for (const o of options) m.set(o.key, o);
    return m;
  }, [options]);

  // For each filled slot, run processTeams with that slot's year as the
  // cohort so BTA RTG / Adj ratings z-score within the team's own season.
  // Cached by year so multiple slots in the same year only recompute once.
  const { rowByKey, sosRankByKey } = useMemo(() => {
    const byYear = new Map<number, TeamRow[]>();
    const seenYears = new Set<number>();
    const result = new Map<string, TeamRow>();
    const sosRanks = new Map<string, { rank: number; cohort: number }>();
    for (const slot of slots) {
      if (!slot) continue;
      const opt = optionByKey.get(slot);
      if (!opt) continue;
      if (!seenYears.has(opt.year)) {
        seenYears.add(opt.year);
        const spec: TeamFilterSpec = {
          years: [opt.year],
          conf: [],
          teams: [],
          filters: [],
          sortBy: "bta_rtg",
          sortDir: "desc",
          limit: -1,
        };
        const { rows } = processTeams(allTeams, spec);
        byYear.set(opt.year, rows);
        // Build the SoS leaderboard for this year so the SoS row can
        // display "#79" instead of an opaque "79.7%". #1 = hardest schedule.
        const sosSorted = rows
          .filter((r) => typeof r.sos === "number")
          .slice()
          .sort((a, b) => (b.sos as number) - (a.sos as number));
        const cohort = sosSorted.length;
        sosSorted.forEach((r, i) => {
          sosRanks.set(`${r.team_name}|${opt.year}`, { rank: i + 1, cohort });
        });
      }
      const yearRows = byYear.get(opt.year)!;
      const row = yearRows.find((r) => r.team_name === opt.team);
      if (row) result.set(slot, row);
    }
    return { rowByKey: result, sosRankByKey: sosRanks };
  }, [slots, allTeams, optionByKey]);

  const filledSlots = slots
    .map((s) => (s ? { key: s, row: rowByKey.get(s), opt: optionByKey.get(s) } : null))
    .filter((x): x is { key: string; row: TeamRow; opt: NonNullable<ReturnType<typeof optionByKey.get>> } => !!x && !!x.row && !!x.opt);
  const showCompare = filledSlots.length >= 2;

  function setSlot(i: number, key: string | null) {
    setSlots((prev) => {
      const next = [...prev];
      next[i] = key;
      return next;
    });
  }

  function ctxFor(slotKey: string): SlotCtx {
    return {
      coach: coachByTeamYear[slotKey] ?? null,
      tourneyFinish: tourneyFinishByTeamYear[slotKey] ?? null,
      sosRank: sosRankByKey.get(slotKey) ?? null,
    };
  }

  // Section-snap scroll: wheel-down jumps to the next section header,
  // wheel-up uses normal scroll. The user requested this asymmetric pattern
  // so a downward flick walks the user through Context → Ratings →
  // Schedule → Four Factors → Style → Shooting one bucket at a time, while
  // scrolling back up stays free.
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let lastJumpAt = 0;
    function onWheel(e: WheelEvent) {
      if (!el) return;
      if (e.deltaY <= 0) return; // upward: leave alone
      const now = Date.now();
      if (now - lastJumpAt < 350) {
        // Throttle: a fast wheel gesture often produces a burst of events;
        // we want one jump per intentional flick, not a runaway cascade.
        e.preventDefault();
        return;
      }
      const sections = Array.from(sectionRefs.current.values())
        .filter((x): x is HTMLTableRowElement => !!x)
        .sort((a, b) => a.offsetTop - b.offsetTop);
      // Sticky thead overlays the top of the scroller, so subtract its
      // height when landing on a section so the section header isn't
      // hidden behind it. Re-measure each time in case the layout shifts.
      const stickyHead = el.querySelector("thead");
      const stickyH = stickyHead instanceof HTMLElement ? stickyHead.offsetHeight : 48;
      const buffer = stickyH + 8;
      const next = sections.find((s) => s.offsetTop > el.scrollTop + buffer);
      if (next) {
        e.preventDefault();
        // Subtract sticky-thead height so the section header tr lands
        // directly underneath the sticky team-name row, not behind it.
        el.scrollTo({ top: Math.max(0, next.offsetTop - stickyH - 2), behavior: "smooth" });
        lastJumpAt = now;
      }
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [showCompare]);

  // Screenshot — capture the full comparison table (not the scrollable wrapper
  // so we get every row, not just what's visible) and open the resulting PNG
  // in a new tab so the user gets the browser's native image viewer with
  // save / copy / right-click actions for free.
  //
  // Cross-origin pitfalls handled here:
  //   - GCS team logos can fail to inline if CORS headers are missing → we
  //     pre-fetch them and swap their `src` to data URLs before capture, then
  //     restore the originals in `finally`. Falls back to the monogram (also
  //     a same-origin DOM node) if the fetch errors.
  //   - @font-face fonts can throw inside the foreignObject pipeline →
  //     `skipFonts: true` makes html-to-image use the system fallback for the
  //     screenshot only (live page is unaffected).
  //   - The sticky `<thead>` backdrop-blur breaks the SVG renderer → we strip
  //     it for the duration of the capture via data-screenshot-capturing.
  const captureRef = useRef<HTMLTableElement | null>(null);
  const [capturing, setCapturing] = useState(false);
  async function takeScreenshot() {
    const root = captureRef.current;
    if (!root || capturing) return;
    setCapturing(true);

    // Restore originals after the capture completes (or errors). Populated
    // as we swap each img → data URL below.
    const restore: Array<() => void> = [];

    try {
      // 1. Pre-fetch every cross-origin image and swap its src to a data URL
      //    so html-to-image doesn't have to re-fetch it from inside a sandbox.
      const imgs = Array.from(root.querySelectorAll("img")) as HTMLImageElement[];
      await Promise.all(imgs.map(async (img) => {
        const src = img.src;
        if (!src || src.startsWith("data:")) return;
        try {
          const res = await fetch(src, { mode: "cors", cache: "force-cache" });
          if (!res.ok) return;
          const blob = await res.blob();
          const dataUrl: string = await new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result as string);
            fr.onerror = () => reject(fr.error);
            fr.readAsDataURL(blob);
          });
          const originalSrc = img.src;
          img.src = dataUrl;
          restore.push(() => { img.src = originalSrc; });
        } catch {
          // Network/CORS failure → leave the img alone; html-to-image will
          // use the placeholder below if the fetch from inside it also fails.
        }
      }));

      // 2. Temporarily neutralize backdrop-blur on the sticky thead — the
      //    SVG foreignObject renderer chokes on it. Toggle a body attribute
      //    so a tiny scoped CSS rule strips the filter for the screenshot.
      document.body.setAttribute("data-screenshot-capturing", "true");
      // Force a reflow + wait two frames so the CSS override (`.truncate →
      // white-space: normal`) actually re-lays out before html-to-image
      // snapshots the geometry. Otherwise long names render with the wrapped
      // second line crashing into the sibling block below.
      void root.offsetHeight;
      await new Promise<void>((res) => {
        requestAnimationFrame(() => requestAnimationFrame(() => res()));
      });

      // 1×1 transparent PNG used when an image inside html-to-image fails
      // to load (defense in depth on top of the pre-fetch above).
      const imagePlaceholder = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=";
      const bg = getComputedStyle(document.body).backgroundColor || "#ffffff";

      const blob = await htmlToImage.toBlob(root, {
        backgroundColor: bg,
        pixelRatio: 2,
        cacheBust: true,
        skipFonts: true,
        imagePlaceholder,
      });
      if (!blob) throw new Error("html-to-image returned a null blob");

      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
      console.error("Compare-teams screenshot failed:", msg, e);
      alert(`Screenshot failed: ${msg || "unknown error"}`);
    } finally {
      for (const r of restore) r();
      document.body.removeAttribute("data-screenshot-capturing");
      setCapturing(false);
    }
  }

  function rowExtremes(row: Row): { bestKey: string | null; worstKey: string | null } {
    if (row.dir === "none") return { bestKey: null, worstKey: null };
    const entries = filledSlots.map((s) => ({ key: s.key, raw: row.value(s.row, ctxFor(s.key)) }));
    if (entries.length < 2) return { bestKey: null, worstKey: null };

    if (row.dir === "depth") {
      const numbered = entries.map((e) => ({
        key: e.key,
        n: typeof e.raw === "string" ? (ROUND_DEPTH[e.raw] ?? -1) : -1,
      }));
      const max = Math.max(...numbered.map((x) => x.n));
      const min = Math.min(...numbered.map((x) => x.n));
      if (max === min) return { bestKey: null, worstKey: null };
      const bestKeys = numbered.filter((x) => x.n === max).map((x) => x.key);
      const worstKeys = numbered.filter((x) => x.n === min).map((x) => x.key);
      return {
        bestKey: bestKeys.length === 1 ? bestKeys[0]! : null,
        worstKey: worstKeys.length === 1 ? worstKeys[0]! : null,
      };
    }

    const nums = entries.map((e) => ({ key: e.key, n: typeof e.raw === "number" ? e.raw : NaN }));
    const valid = nums.filter((x) => Number.isFinite(x.n));
    if (valid.length < 2) return { bestKey: null, worstKey: null };
    const max = Math.max(...valid.map((x) => x.n));
    const min = Math.min(...valid.map((x) => x.n));
    if (max === min) return { bestKey: null, worstKey: null };
    const bestN = row.dir === "higher" ? max : min;
    const worstN = row.dir === "higher" ? min : max;
    const bestKeys = valid.filter((x) => x.n === bestN).map((x) => x.key);
    const worstKeys = valid.filter((x) => x.n === worstN).map((x) => x.key);
    return {
      bestKey: bestKeys.length === 1 ? bestKeys[0]! : null,
      worstKey: worstKeys.length === 1 ? worstKeys[0]! : null,
    };
  }

  if (!open || !mounted) return null;

  const body = (
    <div
      role="dialog"
      aria-modal
      aria-label="Compare teams"
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 p-4 pt-[5vh] overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-card border border-hairline rounded-xl shadow-xl w-full max-w-6xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-end justify-between px-6 py-5 border-b border-hairline bg-paper-deep/30">
          <div>
            <div className="text-[0.6rem] uppercase tracking-[0.18em] text-coral font-bold mb-1.5 flex items-center gap-2">
              <span className="h-px w-6 bg-coral" />
              Head to head
            </div>
            <h2 className="font-display text-3xl text-ink leading-none tracking-tight">Compare teams</h2>
            <p className="text-sm text-ink-muted mt-2 max-w-2xl">
              Pick up to four team-seasons. Best mark per row in{" "}
              <span className="text-emerald-700 font-medium">green</span>, worst in{" "}
              <span className="text-coral font-medium">coral</span>. Ties get neither.
            </p>
          </div>
          <div className="flex items-center gap-1">
            {showCompare && (
              <button
                type="button"
                onClick={takeScreenshot}
                disabled={capturing}
                aria-label="Take screenshot of comparison"
                title="Open comparison as PNG in a new tab"
                className={cn(
                  "text-ink-muted hover:text-coral transition-colors inline-flex items-center gap-1.5 h-8 px-2.5 rounded text-xs uppercase tracking-widest font-medium hover:bg-paper-deep/60",
                  capturing && "opacity-50 pointer-events-none",
                )}
              >
                <CameraIcon className="w-4 h-4" />
                <span className="hidden sm:inline">{capturing ? "Capturing…" : "Screenshot"}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="text-ink-muted hover:text-ink transition-colors text-lg w-8 h-8 inline-flex items-center justify-center rounded hover:bg-paper-deep/60"
            >
              ×
            </button>
          </div>
        </div>

        <div className="px-6 py-5 border-b border-hairline">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {slots.map((slot, i) => {
              const opt = slot ? optionByKey.get(slot) ?? null : null;
              const excluded = new Set(slots.filter((s, j) => s && j !== i) as string[]);
              return (
                <SlotPicker
                  key={i}
                  index={i}
                  picked={opt}
                  options={options}
                  excluded={excluded}
                  open={openPickerSlot === i}
                  onOpenChange={(o) => setOpenPickerSlot(o ? i : null)}
                  onPick={(key, advance) => {
                    setSlots((prev) => {
                      const next = [...prev];
                      next[i] = key;
                      if (advance) {
                        const nextEmpty = next.findIndex((v, j) => v === null && j > i);
                        const empty = nextEmpty !== -1 ? nextEmpty : next.findIndex((v) => v === null);
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

        <div ref={scrollerRef} className="min-h-[60vh] max-h-[65vh] overflow-y-auto overscroll-contain">
          {!showCompare ? (
            <div className="px-6 py-24 text-center text-ink-muted text-sm">
              Pick at least <span className="text-ink font-medium">2 team-seasons</span> to start comparing.
            </div>
          ) : (
            <table ref={captureRef} className="w-full text-sm">
              <thead className="sticky top-0 bg-paper-deep/80 backdrop-blur z-10">
                <tr className="border-b border-hairline">
                  <th className="px-5 py-3 text-left text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium w-56">
                    Category
                  </th>
                  {filledSlots.map((s) => (
                    <th key={s.key} className="px-4 py-3 text-left">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <TeamLogo name={s.opt.team} size={28} />
                        <div className="min-w-0">
                          <Link
                            href={`/teams/${teamSlug(s.opt.team)}/${s.opt.year}/`}
                            className="font-display text-base text-ink leading-tight hover:text-coral transition-colors block truncate"
                          >
                            {s.opt.team}
                          </Link>
                          <div className="text-[0.65rem] text-ink-muted leading-tight truncate">
                            {seasonLabel(s.opt.year)}
                            {s.opt.conference && (
                              <span className="text-ink-muted"> · {confDisplay(s.opt.conference)}</span>
                            )}
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
                    <Fragment key={row.key}>
                      {row.section && (
                        <tr
                          ref={(el) => {
                            if (el) sectionRefs.current.set(row.section!, el);
                            else sectionRefs.current.delete(row.section!);
                          }}
                          className="bg-paper-deep/40"
                        >
                          <td
                            colSpan={1 + filledSlots.length}
                            className="px-5 pt-4 pb-1.5 text-[0.6rem] uppercase tracking-[0.18em] text-coral font-bold"
                          >
                            <span className="inline-flex items-center gap-2">
                              <span className="h-px w-4 bg-coral" />
                              {row.section}
                            </span>
                          </td>
                        </tr>
                      )}
                      <tr className={cn("border-b border-hairline/60", ri % 2 === 0 ? "bg-paper/40" : "")}>
                        <td className="px-5 py-3 text-ink-soft text-xs uppercase tracking-widest font-medium">
                          {row.label}
                        </td>
                        {filledSlots.map((s) => {
                          const raw = row.value(s.row, ctxFor(s.key));
                          const display = row.format ? row.format(raw) : raw == null ? "—" : String(raw);
                          const isBest = bestKey === s.key;
                          const isWorst = worstKey === s.key;
                          const pct = row.pctKey ? (s.row.pct[row.pctKey] ?? null) : null;
                          return (
                            <td
                              key={s.key}
                              className={cn(
                                "px-4 py-3 tabular text-base text-ink",
                                isBest && "bg-emerald-50 text-emerald-900 font-semibold",
                                isWorst && "bg-coral/10 text-coral font-medium",
                              )}
                            >
                              <span className="inline-flex items-baseline gap-2">
                                <span>{display}</span>
                                {typeof pct === "number" && (
                                  <span
                                    className="text-[0.6rem] tabular font-bold tabular-nums"
                                    style={{ color: pctColor(pct) }}
                                    aria-label={`${pct}th percentile`}
                                  >
                                    {pct}
                                  </span>
                                )}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    </Fragment>
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

type Opt = {
  key: string;
  team: string;
  year: number;
  conference: string | null;
  label: string;
};

function SlotPicker({
  index, picked, options, excluded, open, onOpenChange, onPick, onClear,
}: {
  index: number;
  picked: Opt | null;
  options: Opt[];
  excluded: Set<string>;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (key: string, advance: boolean) => void;
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
    const base = options.filter((o) => !excluded.has(o.key));
    if (!needle) return base.slice(0, 80);
    // Token-based match: split the query on whitespace and require every
    // token to appear somewhere in the option's search string. The search
    // string folds in the team name + every reasonable year representation
    // (4-digit, 2-digit, seasonLabel), so "florida 25" finds "Florida · 24-25"
    // and "michigan 2014" finds "Michigan · 13-14".
    // Per-token matching with year-aware behavior so "florida 25" unambiguously
    // resolves to the 2024-25 (championship) season rather than 25-26. Rules:
    //   4-digit token → exact season-end year match (2025 = 24-25)
    //   2-digit token → match the season-end year's last two digits (25 = 24-25)
    //   "YY-YY" token → exact season label match
    //   anything else → substring match on the team name
    const tokens = needle.split(/\s+/).filter(Boolean);
    const matched = base.filter((o) => {
      const teamL = o.team.toLowerCase();
      const yearStr = String(o.year);
      const next2 = yearStr.slice(-2);
      const label = seasonLabel(o.year);
      return tokens.every((t) => {
        if (/^\d{4}$/.test(t)) return yearStr === t;
        if (/^\d{2}$/.test(t)) return next2 === t;
        if (/^\d{2}-\d{2}$/.test(t)) return label === t;
        return teamL.includes(t);
      });
    });
    // Sort matched results to bubble up the most likely picks:
    //   1) Power-conference teams first (Michigan / Michigan St. before
    //      Eastern Michigan / Central Michigan / Western Michigan)
    //   2) Alpha within power tier
    //   3) Year desc within team (newest season first)
    matched.sort((a, b) => {
      const ap = a.conference && POWER_CONFS.has(a.conference) ? 0 : 1;
      const bp = b.conference && POWER_CONFS.has(b.conference) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return a.team.localeCompare(b.team) || b.year - a.year;
    });
    return matched.slice(0, 80);
  }, [options, excluded, q]);

  useEffect(() => { setHIdx(0); }, [q]);

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
      const pick = filtered[hIdx];
      if (pick) {
        e.preventDefault();
        onPick(pick.key, true);
      }
    }
  }

  return (
    <div ref={containerRef} className="relative">
      {picked ? (
        <div className="bg-paper border border-hairline rounded-lg p-3 flex items-center gap-3 min-h-[68px]">
          <TeamLogo name={picked.team} size={32} />
          <div className="flex-1 min-w-0">
            <div className="font-medium text-ink text-sm leading-tight truncate">{picked.team}</div>
            <div className="text-[0.65rem] text-ink-muted truncate">
              {seasonLabel(picked.year)}
              {picked.conference && <> · {confDisplay(picked.conference)}</>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClear}
            aria-label="Remove team"
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
          + Add team {index + 1}
        </button>
      )}

      {open && !picked && (
        <div className="absolute top-full left-0 mt-1 w-80 bg-card border border-hairline rounded-lg shadow-lg z-30 overflow-hidden">
          <div className="p-2 border-b border-hairline">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onInputKey}
              placeholder="Search team or season (e.g. duke 25)…"
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
              filtered.map((o, i) => (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => onPick(o.key, false)}
                  onMouseEnter={() => setHIdx(i)}
                  className={cn(
                    "w-full px-3 py-1.5 flex items-center gap-2 text-left transition-colors",
                    i === hIdx ? "bg-paper-deep" : "hover:bg-paper-deep/60",
                  )}
                >
                  <TeamLogo name={o.team} size={20} />
                  <span className="text-sm text-ink truncate flex-1">{o.team}</span>
                  <span className="text-[0.65rem] text-ink-muted tabular shrink-0">{seasonLabel(o.year)}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Tiny inline Fragment alias to avoid React.Fragment imports.
function Fragment({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}
