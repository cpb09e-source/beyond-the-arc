"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { TeamLogo } from "@/components/team-logo";
import { cn } from "@/lib/utils";
import { confDisplay } from "@/lib/conf-display";
import { POWER_CONFS } from "@/lib/conf-tiers";
import { pctColor } from "@/components/percentile-chip";
import { STAT_META, fmtValue, seasonLabel } from "./where-they-rank";
import type { PlayerRanks, PlayerRanksSeason } from "@/lib/static-data";
import * as htmlToImage from "html-to-image";

/**
 * Head-to-head Compare Players modal — pick up to 4 (player, season) slots
 * and see them side by side. Mirrors the Compare Teams pattern in
 * src/components/explorer/compare-teams-modal.tsx — same column / row /
 * highlight / screenshot architecture so the two surfaces feel native to
 * each other.
 *
 * Data flow:
 *   - On first open, fetch `/data/players-index.json` (denormalized list of
 *     every ranked (bartId, year) tuple with name + team + class + height +
 *     gp + mpg). Built by `scripts/compute-player-ranks.mts`.
 *   - When a slot fills, lazy-fetch the player's `player-ranks/{id}.json`
 *     for that season's per-stat values and percentiles.
 *   - Percentiles come straight from the rank file — the same numbers shown
 *     on the Player Overview card — so the modal reads as a consistent extension
 *     of the rest of the site rather than recomputing anything new.
 */

const MAX_SLOTS = 4;

type Direction = "higher" | "lower" | "none";

type IndexEntry = {
  id: number;
  n: string;            // name
  y: number;            // year (season-end)
  t: string;            // team name
  c: string | null;     // conference
  cl: string | null;    // class
  h: string | null;     // height
  g: number | null;     // games played
  m: number | null;     // minutes per game
};

type Opt = IndexEntry & {
  key: string;          // `${id}|${y}`
  label: string;
};

type SlotCtx = {
  team: string;
  conference: string | null;
  class_: string | null;
  height: string | null;
  games: number | null;
  mpg: number | null;
};

type Row = {
  key: string;
  label: string;
  /** Returns either the raw number (for comparison), a string (for context),
   *  or null when missing. Number values are compared per `dir`; string
   *  values are display-only and never get the best/worst highlight. */
  value: (rank: PlayerRanksSeason | null, ctx: SlotCtx) => number | string | null;
  dir: Direction;
  format?: (v: number | string | null) => string;
  section?: string;
  /** Key into rank.stats — when present, the cell shows a percentile chip
   *  next to the value (color-coded via pctColor). */
  percentileKey?: string;
  /** Custom JSX renderer for the cell body. When provided, takes precedence
   *  over `format` + percentileKey chip. Used by the rank rows to render the
   *  "#26 guard / of 1,226" stacked layout with the star for top-3. */
  cellRender?: (rank: PlayerRanksSeason | null, ctx: SlotCtx) => React.ReactNode;
};

function bucketSingular(b: "G" | "F" | "C"): string {
  return b === "G" ? "guard" : b === "F" ? "forward" : "center";
}

/** Single-cell rank display — used by the Position / Overall / Mid-Major
 *  rank rows. Top-3 gets a gold star, top-25 stays coral; everything else
 *  shows in ink. "of N" denominator sits underneath in a tiny muted line. */
function RankBadge({
  rank, cohort, suffix,
}: {
  rank: number | null;
  cohort: number | null;
  suffix?: string | null;
}) {
  if (rank == null) return <span className="text-ink-muted">—</span>;
  const isElite = rank <= 3;
  const isGood = rank <= 25;
  return (
    <span className="inline-flex flex-col leading-tight">
      <span className="inline-flex items-center gap-1">
        {isElite && <span aria-hidden className="text-amber-500 text-[0.85em] leading-none">★</span>}
        <span className={cn(
          "font-display tabular tabular-nums tracking-[-0.02em]",
          isElite ? "text-coral" : isGood ? "text-coral" : "text-ink",
        )}>
          <span className="text-[0.65em] align-top font-semibold opacity-70 mr-[1px]">#</span>{rank}
        </span>
        {suffix && (
          <span className="text-[0.65rem] uppercase tracking-wider text-ink-muted font-medium">{suffix}</span>
        )}
      </span>
      {cohort != null && (
        <span className="text-[0.55rem] uppercase tracking-widest text-ink-muted tabular tabular-nums">
          of {cohort.toLocaleString()}
        </span>
      )}
    </span>
  );
}

const fmtString = (v: number | string | null): string =>
  v == null ? "—" : String(v);
const fmtNum1 = (v: number | string | null): string =>
  typeof v === "number" ? v.toFixed(1) : "—";
const fmtNum0 = (v: number | string | null): string =>
  typeof v === "number" ? String(Math.round(v)) : "—";
// `fmtStat` defers to the per-stat format from STAT_META — needed for
// pct/pct100/num divergence inside the rank-stat rows.
const fmtStatFor = (key: string) => (v: number | string | null): string => {
  if (typeof v !== "number") return "—";
  const meta = STAT_META[key];
  return meta ? fmtValue(v, meta.format) : v.toString();
};

const ROWS: Row[] = [
  // ── Context ─────────────────────────────────────────
  { section: "Context", key: "team", label: "Team", dir: "none", value: (_r, ctx) => ctx.team, format: fmtString },
  { key: "conf", label: "Conference", dir: "none", value: (_r, ctx) => ctx.conference ? confDisplay(ctx.conference) : null, format: fmtString },
  { key: "class", label: "Class", dir: "none", value: (_r, ctx) => ctx.class_, format: fmtString },
  { key: "height", label: "Height", dir: "none", value: (_r, ctx) => ctx.height, format: fmtString },
  { key: "gp", label: "Games played", dir: "higher", value: (_r, ctx) => ctx.games, format: fmtNum0 },
  { key: "mpg", label: "MPG", dir: "higher", value: (_r, ctx) => ctx.mpg, format: fmtNum1 },

  // ── Production ──────────────────────────────────────
  { section: "Production", key: "bta_portg", label: "BTA PRTG", dir: "higher", value: (r) => r?.stats.bta_portg?.value ?? null, format: fmtStatFor("bta_portg"), percentileKey: "bta_portg" },
  { key: "pir", label: "PIR", dir: "higher", value: (r) => r?.stats.pir?.value ?? null, format: fmtStatFor("pir"), percentileKey: "pir" },
  // Leaderboard ranks — lower rank = better, so `dir: "lower"`. The cellRender
  // mirrors the Player Overview rank card treatment (star for top-3, coral
  // for top-25). Mid-major row resolves to "—" for power-conf players, who
  // simply don't have a non-power-cohort rank.
  {
    key: "rank_bucket",
    label: "Position rank",
    dir: "lower",
    value: (r) => r?.rank ?? null,
    cellRender: (r) => <RankBadge rank={r?.rank ?? null} cohort={r?.cohortSize ?? null} suffix={r ? bucketSingular(r.bucket) : null} />,
  },
  {
    key: "rank_overall",
    label: "Overall rank",
    dir: "lower",
    value: (r) => r?.rankOverall ?? null,
    cellRender: (r) => <RankBadge rank={r?.rankOverall ?? null} cohort={r?.cohortOverall ?? null} suffix="overall" />,
  },
  {
    key: "rank_mm",
    label: "Mid major rank",
    dir: "lower",
    value: (r) => r?.rankNonPower ?? null,
    cellRender: (r) => <RankBadge rank={r?.rankNonPower ?? null} cohort={r?.cohortNonPower ?? null} suffix="mid major" />,
  },

  // ── Box Score (per game) ────────────────────────────
  { section: "Box Score", key: "pts_pg", label: "PTS/G", dir: "higher", value: (r) => r?.stats.pts_pg?.value ?? null, format: fmtStatFor("pts_pg"), percentileKey: "pts_pg" },
  { key: "reb_pg", label: "REB/G", dir: "higher", value: (r) => r?.stats.reb_pg?.value ?? null, format: fmtStatFor("reb_pg"), percentileKey: "reb_pg" },
  { key: "ast_pg", label: "AST/G", dir: "higher", value: (r) => r?.stats.ast_pg?.value ?? null, format: fmtStatFor("ast_pg"), percentileKey: "ast_pg" },
  { key: "stl_pg", label: "STL/G", dir: "higher", value: (r) => r?.stats.stl_pg?.value ?? null, format: fmtStatFor("stl_pg"), percentileKey: "stl_pg" },
  { key: "blk_pg", label: "BLK/G", dir: "higher", value: (r) => r?.stats.blk_pg?.value ?? null, format: fmtStatFor("blk_pg"), percentileKey: "blk_pg" },
  { key: "fta_pg", label: "FTA/G", dir: "higher", value: (r) => r?.stats.fta_pg?.value ?? null, format: fmtStatFor("fta_pg"), percentileKey: "fta_pg" },

  // ── Shooting ────────────────────────────────────────
  { section: "Shooting", key: "efg_pct", label: "eFG%", dir: "higher", value: (r) => r?.stats.efg_pct?.value ?? null, format: fmtStatFor("efg_pct"), percentileKey: "efg_pct" },
  { key: "ts_pct", label: "TS%", dir: "higher", value: (r) => r?.stats.ts_pct?.value ?? null, format: fmtStatFor("ts_pct"), percentileKey: "ts_pct" },
  { key: "fg2_pct", label: "2P%", dir: "higher", value: (r) => r?.stats.fg2_pct?.value ?? null, format: fmtStatFor("fg2_pct"), percentileKey: "fg2_pct" },
  { key: "fg3_pct", label: "3P%", dir: "higher", value: (r) => r?.stats.fg3_pct?.value ?? null, format: fmtStatFor("fg3_pct"), percentileKey: "fg3_pct" },
  { key: "ft_pct", label: "FT%", dir: "higher", value: (r) => r?.stats.ft_pct?.value ?? null, format: fmtStatFor("ft_pct"), percentileKey: "ft_pct" },
  { key: "tpar", label: "3PAr", dir: "none", value: (r) => r?.stats.tpar?.value ?? null, format: fmtStatFor("tpar") },
  { key: "ftr", label: "FT Rate", dir: "none", value: (r) => r?.stats.ftr?.value ?? null, format: fmtStatFor("ftr") },

  // ── Advanced ────────────────────────────────────────
  { section: "Advanced", key: "usage", label: "Usage%", dir: "none", value: (r) => r?.stats.usage?.value ?? null, format: fmtStatFor("usage") },
  { key: "ast_pct", label: "AST%", dir: "higher", value: (r) => r?.stats.ast_pct?.value ?? null, format: fmtStatFor("ast_pct"), percentileKey: "ast_pct" },
  { key: "tov_pct", label: "TOV%", dir: "lower", value: (r) => r?.stats.tov_pct?.value ?? null, format: fmtStatFor("tov_pct"), percentileKey: "tov_pct" },
  { key: "orb_pct", label: "OREB%", dir: "higher", value: (r) => r?.stats.orb_pct?.value ?? null, format: fmtStatFor("orb_pct"), percentileKey: "orb_pct" },
  { key: "hkm_pct", label: "HKM%", dir: "higher", value: (r) => r?.stats.hkm_pct?.value ?? null, format: fmtStatFor("hkm_pct"), percentileKey: "hkm_pct" },
];

export function ComparePlayersModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [slots, setSlots] = useState<(string | null)[]>([null, null, null, null]);
  const [openPickerSlot, setOpenPickerSlot] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const [index, setIndex] = useState<IndexEntry[] | null>(null);
  const [indexLoading, setIndexLoading] = useState(false);
  // Per-player rank cache. Keyed by bartId. Each entry is either the full
  // PlayerRanks payload, "loading", or "error" if the fetch failed.
  const [ranksByBart, setRanksByBart] = useState<Record<number, PlayerRanks | "loading" | "error">>({});

  useEffect(() => setMounted(true), []);

  // Lazy-load the players-index on first open. Cached for the session so
  // re-opening is instant.
  useEffect(() => {
    if (!open || index || indexLoading) return;
    setIndexLoading(true);
    fetch("/data/players-index.json")
      .then((r) => r.json())
      .then((data: IndexEntry[]) => {
        setIndex(data);
        setIndexLoading(false);
      })
      .catch((e) => {
        console.error("Failed to load players-index.json", e);
        setIndexLoading(false);
      });
  }, [open, index, indexLoading]);

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

  const options = useMemo<Opt[]>(() => {
    if (!index) return [];
    return index.map((e) => ({
      ...e,
      key: `${e.id}|${e.y}`,
      label: `${e.n} · ${seasonLabel(e.y)}`,
    }));
  }, [index]);

  const optionByKey = useMemo(() => {
    const m = new Map<string, Opt>();
    for (const o of options) m.set(o.key, o);
    return m;
  }, [options]);

  // Lazy-fetch per-player rank file when a slot fills. The cache survives
  // the slot being changed so swapping back to a previously-selected player
  // is instant.
  useEffect(() => {
    for (const slot of slots) {
      if (!slot) continue;
      const [idStr] = slot.split("|");
      const bartId = Number(idStr);
      if (!Number.isFinite(bartId)) continue;
      if (ranksByBart[bartId] !== undefined) continue;
      setRanksByBart((prev) => ({ ...prev, [bartId]: "loading" }));
      fetch(`/data/player-ranks/${bartId}.json`)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((data: PlayerRanks) => {
          setRanksByBart((prev) => ({ ...prev, [bartId]: data }));
        })
        .catch((e) => {
          console.error("Failed to load player-ranks for", bartId, e);
          setRanksByBart((prev) => ({ ...prev, [bartId]: "error" }));
        });
    }
  }, [slots, ranksByBart]);

  type FilledSlot = {
    key: string;
    opt: Opt;
    season: PlayerRanksSeason | null;
    loading: boolean;
    ctx: SlotCtx;
  };
  const filledSlots: FilledSlot[] = slots
    .map((s) => {
      if (!s) return null;
      const opt = optionByKey.get(s);
      if (!opt) return null;
      const ranks = ranksByBart[opt.id];
      const season = ranks && ranks !== "loading" && ranks !== "error"
        ? ranks.seasonRanks.find((sr) => sr.year === opt.y) ?? null
        : null;
      const loading = ranks === undefined || ranks === "loading";
      return {
        key: s,
        opt,
        season,
        loading,
        ctx: {
          team: opt.t,
          conference: opt.c,
          class_: opt.cl,
          height: opt.h,
          games: opt.g,
          mpg: opt.m,
        },
      };
    })
    .filter((x): x is FilledSlot => x !== null);
  const showCompare = filledSlots.length >= 2;
  const anyLoading = filledSlots.some((s) => s.loading);

  function setSlot(i: number, key: string | null) {
    setSlots((prev) => {
      const next = [...prev];
      next[i] = key;
      return next;
    });
  }

  // Section-snap scroll: mirrors compare-teams behavior. Wheel-down jumps to
  // the next section header so a fast scroll walks through buckets one at a
  // time; wheel-up is unconstrained.
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let lastJumpAt = 0;
    function onWheel(e: WheelEvent) {
      if (!el) return;
      if (e.deltaY <= 0) return;
      const now = Date.now();
      if (now - lastJumpAt < 350) {
        e.preventDefault();
        return;
      }
      const sections = Array.from(sectionRefs.current.values())
        .filter((x): x is HTMLTableRowElement => !!x)
        .sort((a, b) => a.offsetTop - b.offsetTop);
      const stickyHead = el.querySelector("thead");
      const stickyH = stickyHead instanceof HTMLElement ? stickyHead.offsetHeight : 48;
      const buffer = stickyH + 8;
      const next = sections.find((s) => s.offsetTop > el.scrollTop + buffer);
      if (next) {
        e.preventDefault();
        el.scrollTo({ top: Math.max(0, next.offsetTop - stickyH - 2), behavior: "smooth" });
        lastJumpAt = now;
      }
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [showCompare]);

  // Screenshot — same approach as compare-teams: swap cross-origin images to
  // data URLs before capture, strip backdrop-filter via body attribute, fall
  // back to placeholder for image failures.
  const captureRef = useRef<HTMLTableElement | null>(null);
  const [capturing, setCapturing] = useState(false);
  async function takeScreenshot() {
    const root = captureRef.current;
    if (!root || capturing) return;
    setCapturing(true);
    const restore: Array<() => void> = [];
    try {
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
        } catch { /* leave as-is */ }
      }));
      document.body.setAttribute("data-screenshot-capturing", "true");
      // Force a reflow + wait two frames so the CSS override (`.truncate →
      // white-space: normal`) actually re-lays out before html-to-image
      // snapshots the geometry. Without this, the renderer reads the
      // pre-override single-line rects but paints the post-override wrapped
      // text, crashing the second line into the sibling block.
      void root.offsetHeight;
      await new Promise<void>((res) => {
        requestAnimationFrame(() => requestAnimationFrame(() => res()));
      });
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
      console.error("Compare-players screenshot failed:", msg, e);
      alert(`Screenshot failed: ${msg || "unknown error"}`);
    } finally {
      for (const r of restore) r();
      document.body.removeAttribute("data-screenshot-capturing");
      setCapturing(false);
    }
  }

  function rowExtremes(row: Row): { bestKey: string | null; worstKey: string | null } {
    if (row.dir === "none") return { bestKey: null, worstKey: null };
    const entries = filledSlots.map((s) => ({ key: s.key, raw: row.value(s.season, s.ctx) }));
    if (entries.length < 2) return { bestKey: null, worstKey: null };
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
      aria-label="Compare players"
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
            <h2 className="font-display text-3xl text-ink leading-none tracking-tight">Compare players</h2>
            <p className="text-sm text-ink-muted mt-2 max-w-2xl">
              Pick up to four player-seasons. Best mark per row in{" "}
              <span className="text-emerald-700 font-medium">green</span>, worst in{" "}
              <span className="text-coral font-medium">coral</span>. Ties get neither.
            </p>
          </div>
          <div className="flex items-center gap-1">
            {showCompare && !anyLoading && (
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
          {indexLoading && !index ? (
            <div className="py-6 text-center text-sm text-ink-muted">Loading players…</div>
          ) : (
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
          )}
        </div>

        <div ref={scrollerRef} className="min-h-[60vh] max-h-[65vh] overflow-y-auto overscroll-contain">
          {!showCompare ? (
            <div className="px-6 py-24 text-center text-ink-muted text-sm">
              Pick at least <span className="text-ink font-medium">2 player-seasons</span> to start comparing.
            </div>
          ) : anyLoading ? (
            <div className="px-6 py-24 text-center text-ink-muted text-sm">Loading stats…</div>
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
                        <TeamLogo name={s.opt.t} size={28} />
                        <div className="min-w-0">
                          <Link
                            href={`/players/${s.opt.id}/`}
                            className="font-display text-base text-ink leading-tight hover:text-coral transition-colors block truncate"
                          >
                            {s.opt.n}
                          </Link>
                          <div className="text-[0.65rem] text-ink-muted leading-tight truncate">
                            {seasonLabel(s.opt.y)} · {s.opt.t}
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
                          const raw = row.value(s.season, s.ctx);
                          const isBest = bestKey === s.key;
                          const isWorst = worstKey === s.key;
                          const pct = row.percentileKey && s.season
                            ? s.season.stats[row.percentileKey]?.percentile ?? null
                            : null;
                          return (
                            <td
                              key={s.key}
                              className={cn(
                                "px-4 py-3 tabular text-base text-ink",
                                isBest && "bg-emerald-50 text-emerald-900 font-semibold",
                                isWorst && "bg-coral/10 text-coral font-medium",
                              )}
                            >
                              {row.cellRender ? (
                                row.cellRender(s.season, s.ctx)
                              ) : (
                                <span className="inline-flex items-baseline gap-2">
                                  <span>{row.format ? row.format(raw) : raw == null ? "—" : String(raw)}</span>
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
                              )}
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
    // Token-based match — same rules as Compare Teams. Year tokens (4-digit,
    // 2-digit, YY-YY) match the season; everything else substring-matches
    // the player name.
    const tokens = needle.split(/\s+/).filter(Boolean);
    const matched = base.filter((o) => {
      const nameL = o.n.toLowerCase();
      const yearStr = String(o.y);
      const next2 = yearStr.slice(-2);
      const label = seasonLabel(o.y);
      return tokens.every((t) => {
        if (/^\d{4}$/.test(t)) return yearStr === t;
        if (/^\d{2}$/.test(t)) return next2 === t;
        if (/^\d{2}-\d{2}$/.test(t)) return label === t;
        return nameL.includes(t);
      });
    });
    // Bubble up power-conf seasons first, then alpha by name, then newest year.
    matched.sort((a, b) => {
      const ap = a.c && POWER_CONFS.has(a.c) ? 0 : 1;
      const bp = b.c && POWER_CONFS.has(b.c) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return a.n.localeCompare(b.n) || b.y - a.y;
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
          <TeamLogo name={picked.t} size={32} />
          <div className="flex-1 min-w-0">
            <div className="font-medium text-ink text-sm leading-tight truncate">{picked.n}</div>
            <div className="text-[0.65rem] text-ink-muted truncate">
              {seasonLabel(picked.y)} · {picked.t}
              {picked.c && <> · {confDisplay(picked.c)}</>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClear}
            aria-label="Remove player"
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
          + Add player {index + 1}
        </button>
      )}

      {open && !picked && (
        <div
          className={cn(
            "absolute top-full mt-1 w-80 bg-card border border-hairline rounded-lg shadow-lg z-30 overflow-hidden",
            // Grid is grid-cols-2 below lg, grid-cols-4 at lg+. Slot 3 sits
            // in the rightmost column at every breakpoint → always anchor
            // right. Slot 1 is rightmost only below lg → flip below lg.
            index === 3
              ? "right-0"
              : index === 1
                ? "right-0 lg:right-auto lg:left-0"
                : "left-0",
          )}
        >
          <div className="p-2 border-b border-hairline">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onInputKey}
              placeholder="Search player or season (e.g. flagg 25)…"
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
                  <TeamLogo name={o.t} size={20} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-ink truncate">{o.n}</div>
                    <div className="text-[0.6rem] text-ink-muted truncate">{o.t} · {seasonLabel(o.y)}</div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

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
