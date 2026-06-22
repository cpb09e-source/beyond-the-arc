"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Dices, RotateCcw, Trophy, Search, X, Share2 } from "lucide-react";
import {
  SLOTS,
  scoreLineup,
  comboBuckets,
  rollComboWeighted,
  FIRST_ROLL_POWER_WEIGHT,
  confLogoUrl,
  playsBucket,
  type GameIndex,
  type GamePlayer,
  type Bucket,
} from "@/lib/thirty-two-zero";
import { cn } from "@/lib/utils";
import { TeamLogo } from "@/components/team-logo";

type Phase = "loading" | "idle" | "draft" | "done";

const BUCKET_LABEL: Record<Bucket, string> = { G: "Guard", F: "Forward", C: "Center" };

// Grade color ramp (0 red → 120 green), mirroring the site's percentile ramp
// but at a lightness that stays legible on both the warm light card and the
// dark navy card.
function gradeColor(v: number): string {
  const hue = (Math.max(0, Math.min(100, v)) / 100) * 120;
  return `hsl(${hue}, 68%, 46%)`;
}
const BUCKET_CHIP: Record<Bucket, string> = {
  G: "bg-green-500/15 text-green-500",
  F: "bg-purple-500/15 text-purple-500",
  C: "bg-orange-500/15 text-orange-500",
};

export function ThirtyTwoZeroClient() {
  const [index, setIndex] = useState<GameIndex | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");

  // lineup: slotId -> player
  const [lineup, setLineup] = useState<Record<string, GamePlayer | null>>(
    () => Object.fromEntries(SLOTS.map((s) => [s.id, null])),
  );
  const [usedIds, setUsedIds] = useState<Set<number>>(new Set());

  // current roll + reroll tokens (1 conf + 1 year for the whole game)
  const [roll, setRoll] = useState<{ conf: string; group: string } | null>(null);
  const [confRerollUsed, setConfRerollUsed] = useState(false);
  const [yearRerollUsed, setYearRerollUsed] = useState(false);
  const [rolling, setRolling] = useState(false);
  // slot-reel spin: id bumps each roll to retrigger the reels; target indices
  // point at the final conference + era within the reel item lists.
  const [spin, setSpin] = useState<{ id: number; confIdx: number; eraIdx: number } | null>(null);
  const spinIdRef = useRef(0);

  // drafting interaction
  const [placing, setPlacing] = useState<GamePlayer | null>(null);
  const [filter, setFilter] = useState<"All" | Bucket>("All");
  const [query, setQuery] = useState("");

  const shareRef = useRef<HTMLDivElement>(null);

  // ---- load index ----
  useEffect(() => {
    let alive = true;
    fetch("/data/thirty-two-zero-index.json")
      .then((r) => r.json())
      .then((j: GameIndex) => {
        if (!alive) return;
        setIndex(j);
        setPhase("idle");
      })
      .catch(() => alive && setPhase("idle"));
    return () => {
      alive = false;
    };
  }, []);

  const comboBkts = useMemo(
    () => (index ? comboBuckets(index) : new Map<string, Set<Bucket>>()),
    [index],
  );
  const confName = useMemo(() => {
    const m = new Map<string, string>();
    index?.conferences.forEach((c) => m.set(c.code, c.name));
    return m;
  }, [index]);
  const confCodes = useMemo(() => index?.conferences.map((c) => c.code) ?? [], [index]);
  const groups = useMemo(() => index?.groups ?? [], [index]);

  const lineupPlayers = useMemo(
    () => SLOTS.map((s) => lineup[s.id]).filter(Boolean) as GamePlayer[],
    [lineup],
  );
  const filledCount = lineupPlayers.length;
  const score = useMemo(() => scoreLineup(lineupPlayers), [lineupPlayers]);

  // open buckets remaining
  const openBuckets = useMemo(() => {
    const set = new Set<Bucket>();
    for (const s of SLOTS) if (!lineup[s.id]) set.add(s.bucket);
    return set;
  }, [lineup]);

  // ---- pool for the current roll ----
  const pool = useMemo(() => {
    if (!index || !roll) return [] as GamePlayer[];
    const byId = new Map<number, GamePlayer>();
    for (const p of index.players) {
      if (p.c !== roll.conf || p.g !== roll.group) continue;
      const prev = byId.get(p.id);
      if (!prev || (p.prtg ?? 0) > (prev.prtg ?? 0)) byId.set(p.id, p);
    }
    let arr = [...byId.values()];
    if (filter !== "All") arr = arr.filter((p) => playsBucket(p, filter));
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      arr = arr.filter((p) => p.n.toLowerCase().includes(q));
    }
    arr.sort((a, b) => (b.prtg ?? 0) - (a.prtg ?? 0));
    return arr;
  }, [index, roll, filter, query]);

  const draftableCount = useMemo(
    () => pool.filter((p) => [...openBuckets].some((b) => playsBucket(p, b)) && !usedIds.has(p.id)).length,
    [pool, openBuckets, usedIds],
  );

  // ---- actions ----
  // Slot-machine roll: both reels scroll, decelerate, and bounce-snap onto the
  // final conference + era. SLOT_MS must match the reel animation duration.
  const SLOT_MS = 1900;
  function doRoll(opts: { conf?: string; group?: string } = {}) {
    if (!index) return;
    setRolling(true);
    setPlacing(null);
    // The opening roll leans harder toward a power conference.
    const firstRoll = filledCount === 0;
    const final = rollComboWeighted(index, comboBkts, {
      ...opts,
      open: openBuckets,
      ...(firstRoll ? { powerWeight: FIRST_ROLL_POWER_WEIGHT } : {}),
    });
    const confIdx = index.conferences.findIndex((c) => c.code === final.conf);
    const eraIdx = index.groups.indexOf(final.group);
    spinIdRef.current += 1;
    setSpin({ id: spinIdRef.current, confIdx, eraIdx });
    window.setTimeout(() => {
      setRoll(final);
      setPhase("draft");
      setRolling(false);
      setSpin(null);
      setFilter("All");
      setQuery("");
    }, SLOT_MS + 280);
  }

  function rerollConf() {
    if (!index || !roll || confRerollUsed) return;
    // new conference, keep the era; avoid landing on the same conf
    let next = rollComboWeighted(index, comboBkts, { group: roll.group, open: openBuckets });
    let guard = 0;
    while (next.conf === roll.conf && guard++ < 25)
      next = rollComboWeighted(index, comboBkts, { group: roll.group, open: openBuckets });
    setConfRerollUsed(true);
    setRoll(next);
    setPlacing(null);
  }

  function rerollYear() {
    if (!index || !roll || yearRerollUsed) return;
    let next = rollComboWeighted(index, comboBkts, { conf: roll.conf, open: openBuckets });
    let guard = 0;
    while (next.group === roll.group && guard++ < 25)
      next = rollComboWeighted(index, comboBkts, { conf: roll.conf, open: openBuckets });
    setYearRerollUsed(true);
    setRoll(next);
    setPlacing(null);
  }

  function placeInSlot(slotId: string) {
    if (!placing) return;
    const slot = SLOTS.find((s) => s.id === slotId);
    if (!slot || !playsBucket(placing, slot.bucket) || lineup[slotId]) return;
    const nextLineup = { ...lineup, [slotId]: placing };
    const nextUsed = new Set(usedIds).add(placing.id);
    setLineup(nextLineup);
    setUsedIds(nextUsed);
    setPlacing(null);
    const filled = SLOTS.filter((s) => nextLineup[s.id]).length;
    if (filled >= SLOTS.length) {
      setPhase("done");
      setRoll(null);
    } else {
      setRoll(null);
      setPhase("idle");
    }
  }

  function reset() {
    setLineup(Object.fromEntries(SLOTS.map((s) => [s.id, null])));
    setUsedIds(new Set());
    setRoll(null);
    setConfRerollUsed(false);
    setYearRerollUsed(false);
    setPlacing(null);
    setFilter("All");
    setQuery("");
    setPhase("idle");
  }

  async function share() {
    if (!shareRef.current) return;
    const { toPng } = await import("html-to-image");
    try {
      const url = await toPng(shareRef.current, {
        pixelRatio: 2,
        backgroundColor: getComputedStyle(document.body).backgroundColor,
      });
      const a = document.createElement("a");
      a.href = url;
      a.download = `32-0-${score.projectedW}-${score.projectedL}.png`;
      a.click();
    } catch (e) {
      console.error("32-0 save card failed:", e);
    }
  }

  // eligible slot ids for the player being placed
  const eligibleSlots = useMemo(() => {
    if (!placing) return new Set<string>();
    return new Set(SLOTS.filter((s) => playsBucket(placing, s.bucket) && !lineup[s.id]).map((s) => s.id));
  }, [placing, lineup]);

  return (
    <div
      className="mx-auto max-w-[88rem] px-6 lg:px-10 pt-5 pb-4 flex flex-col overflow-hidden"
      style={{ height: "calc(100dvh - 64px)" }}
    >
      {/* header strip — mobile reset (desktop reset sits below the court). In the
          draft phase the reset moves onto the filter row; the done screen has its
          own Play again. Only show it for the IDLE state mid-game (between picks),
          not on the opening screen where there's nothing to reset yet. */}
      {phase === "idle" && filledCount > 0 && (
        <div className="flex items-center justify-end mb-2 shrink-0 lg:hidden">
          <button
            onClick={reset}
            className="inline-flex items-center gap-1.5 rounded-full border border-ink/25 text-ink font-semibold text-xs uppercase tracking-[0.12em] px-4 h-9 hover:bg-paper-deep transition-colors"
          >
            <RotateCcw size={14} /> Reset
          </button>
        </div>
      )}

      {phase === "loading" && (
        <div className="bg-paper-deep/25 border border-hairline rounded-xl p-12 text-center text-ink-muted">
          Loading 32-0…
        </div>
      )}

      {phase !== "loading" && (
        <div className="flex flex-col lg:grid lg:grid-cols-[1.1fr_1fr] gap-4 lg:gap-8 flex-1 min-h-0">
          {/* ============ LEFT: roll + pool ============ */}
          <div className="order-2 lg:order-1 min-w-0 flex flex-col min-h-0 flex-1 lg:flex-none">
            <RollPanel
              phase={phase}
              roll={roll}
              rolling={rolling}
              spin={spin}
              confCodes={confCodes}
              groups={groups}
              confName={confName}
              onRoll={() => doRoll()}
              onRerollConf={rerollConf}
              onRerollYear={rerollYear}
              confRerollUsed={confRerollUsed}
              yearRerollUsed={yearRerollUsed}
              placing={placing}
            />

            {phase === "draft" && roll && (
              <>
                {/* filter row */}
                <div className="mt-4 flex flex-wrap items-center gap-2 shrink-0">
                  {(["All", "G", "F", "C"] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={cn(
                        "px-3 h-8 rounded-md text-xs font-medium uppercase tracking-wide transition-colors border",
                        filter === f
                          ? "bg-ink text-paper border-ink"
                          : "bg-[var(--ttz-card-bg)] border-ink/15 text-ink-muted hover:text-ink",
                      )}
                    >
                      {f === "All" ? (
                        "All"
                      ) : (
                        <>
                          <span className="lg:hidden">{f}</span>
                          <span className="hidden lg:inline">{BUCKET_LABEL[f]}</span>
                        </>
                      )}
                    </button>
                  ))}
                  {/* mobile reset — same line as the filters, pushed right */}
                  <button
                    onClick={reset}
                    className="lg:hidden ml-auto inline-flex items-center gap-1.5 rounded-full border border-ink/25 text-ink font-semibold text-xs uppercase tracking-[0.1em] px-3.5 h-8 hover:bg-paper-deep transition-colors"
                  >
                    <RotateCcw size={13} /> Reset
                  </button>
                  <div className="relative flex-1 min-w-[140px] hidden lg:block">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted" />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search…"
                      className="w-full h-8 pl-8 pr-7 rounded-md bg-[var(--ttz-card-bg)] border border-ink/15 text-sm text-ink placeholder:text-ink-muted focus:ring-2 focus:ring-coral/40 focus:border-coral/40 outline-none"
                    />
                    {query && (
                      <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink">
                        <X size={13} />
                      </button>
                    )}
                  </div>
                </div>

                <p className="mt-3 mb-2 text-xs uppercase tracking-[0.14em] text-ink-muted shrink-0">
                  {draftableCount} draftable{" "}
                  {placing && <span className="text-coral normal-case tracking-normal">· placing {placing.n} — pick a highlighted slot</span>}
                </p>

                <div className="ttz-scroll space-y-2 flex-1 min-h-0 overflow-y-auto pr-1">
                  {pool.map((p) => {
                    const used = usedIds.has(p.id);
                    const draftable = [...openBuckets].some((b) => playsBucket(p, b)) && !used;
                    const active = placing?.id === p.id;
                    return (
                      <PlayerCard
                        key={p.id + "_" + p.yr}
                        p={p}
                        used={used}
                        draftable={draftable}
                        active={active}
                        onClick={() => draftable && setPlacing(active ? null : p)}
                      />
                    );
                  })}
                  {pool.length === 0 && (
                    <p className="text-sm text-ink-muted py-6 text-center">No players match.</p>
                  )}
                </div>
              </>
            )}

            {phase === "done" && (
              <div className="flex-1 min-h-0 overflow-y-auto pr-1">
                <Result
                  shareRef={shareRef}
                  lineup={lineup}
                  score={score}
                  onShare={share}
                  onReset={reset}
                />
              </div>
            )}
          </div>

          {/* ============ RIGHT: court (desktop only) ============ */}
          <div className="hidden lg:flex order-1 lg:order-2 min-w-0 min-h-0 flex-col items-center justify-start overflow-y-auto">
            <Court lineup={lineup} eligibleSlots={eligibleSlots} onSlotClick={placeInSlot} />
            <button
              onClick={reset}
              className="mt-4 self-end shrink-0 inline-flex items-center gap-2 rounded-full border border-ink/20 text-ink font-medium px-5 h-10 text-sm hover:bg-paper-deep transition-colors"
            >
              <RotateCcw size={16} /> Reset
            </button>
          </div>

          {/* ============ MOBILE: slot row (no court) ============ */}
          {phase !== "done" && (
            <MobileSlots
              lineup={lineup}
              eligibleSlots={eligibleSlots}
              onSlotClick={placeInSlot}
            />
          )}
        </div>
      )}
    </div>
  );
}

/* ----------------------------- Mobile slots ----------------------------- */
// First + last initials of a player name ("Boopie Miller" → "BM").
function playerInitials(name: string): string {
  const parts = name
    .replace(/[^A-Za-z\s.'-]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function MobileSlots({
  lineup,
  eligibleSlots,
  onSlotClick,
}: {
  lineup: Record<string, GamePlayer | null>;
  eligibleSlots: Set<string>;
  onSlotClick: (slotId: string) => void;
}) {
  return (
    <div className="lg:hidden order-3 shrink-0 mt-1 pt-3 border-t border-ink/10 flex items-start justify-between gap-1">
      {SLOTS.map((s) => {
        const p = lineup[s.id];
        const eligible = eligibleSlots.has(s.id);
        const color = BUCKET_HEX[s.bucket];
        return (
          <button
            key={s.id}
            onClick={() => eligible && onSlotClick(s.id)}
            disabled={!eligible}
            className={cn("flex flex-col items-center gap-1 min-w-0", eligible ? "cursor-pointer" : "cursor-default")}
          >
            {p ? (
              <span
                className="relative w-12 h-12 rounded-full grid place-items-center"
                style={{ background: "#101a30", border: `2px solid ${color}` }}
              >
                <span className="text-[13px] font-bold leading-none" style={{ color: "#faf7f2" }}>
                  {playerInitials(p.n)}
                </span>
                <span
                  className="absolute -bottom-0.5 -right-0.5 rounded-full bg-white grid place-items-center"
                  style={{ width: 18, height: 18 }}
                >
                  <TeamLogo name={p.t} size={15} className="rounded-full" />
                </span>
              </span>
            ) : (
              <span
                className={cn("w-12 h-12 rounded-full grid place-items-center text-xs font-bold uppercase", eligible && "animate-pulse")}
                style={{
                  border: `2px dashed ${eligible ? "#c8553d" : color}`,
                  color: eligible ? "#c8553d" : color,
                  background: eligible ? "rgba(200,85,61,.14)" : "transparent",
                }}
              >
                {s.label}
              </span>
            )}
            <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color }}>
              {s.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------- Roll panel ----------------------------- */
function RollPanel({
  phase,
  roll,
  rolling,
  spin,
  confCodes,
  groups,
  confName,
  onRoll,
  onRerollConf,
  onRerollYear,
  confRerollUsed,
  yearRerollUsed,
  placing,
}: {
  phase: Phase;
  roll: { conf: string; group: string } | null;
  rolling: boolean;
  spin: { id: number; confIdx: number; eraIdx: number } | null;
  confCodes: string[];
  groups: string[];
  confName: Map<string, string>;
  onRoll: () => void;
  onRerollConf: () => void;
  onRerollYear: () => void;
  confRerollUsed: boolean;
  yearRerollUsed: boolean;
  placing: GamePlayer | null;
}) {
  if (phase === "idle") {
    return (
      <div
        className="border border-ink/10 rounded-xl shadow-md ring-1 ring-ink/5 overflow-hidden"
        style={{ background: "var(--ttz-card-bg)" }}
      >
        <div className="h-1 w-full bg-gradient-to-r from-coral via-coral to-coral/60" />
        <div className="p-6 lg:p-8 text-center">
          <div className="flex items-center justify-center text-xs uppercase tracking-[0.18em] text-coral font-bold mb-3">
            <span>Build an undefeated season</span>
          </div>
          <h1 className="font-display text-3xl lg:text-4xl text-ink leading-none tracking-tight mb-6">
            Roll. Draft. Go 32-0.
          </h1>

          {/* CONFERENCE / YEAR reel + Roll, centered, Roll spans both boxes */}
          <div className="mx-auto max-w-md">
            <div className="grid grid-cols-2 gap-3 mb-3">
              <SlotReel
                kind="conf"
                label="Conference"
                items={confCodes}
                targetIndex={spin ? spin.confIdx : -1}
                spinId={spin ? spin.id : 0}
                tone="coral"
              />
              <SlotReel
                kind="era"
                label="Era"
                items={groups}
                targetIndex={spin ? spin.eraIdx : -1}
                spinId={spin ? spin.id : 0}
                tone="court"
              />
            </div>

            <button
              onClick={onRoll}
              disabled={rolling}
              className={cn(
                "w-full inline-flex items-center justify-center gap-2.5 rounded-full bg-coral text-paper font-semibold h-12 text-base",
                "hover:bg-coral-soft transition-colors",
                rolling && "opacity-80",
              )}
            >
              <Dices size={20} className={rolling ? "animate-spin" : ""} />
              {rolling ? "Rolling…" : "Roll"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // nothing to show between rounds / at game end
  if (phase !== "draft" || !roll) return null;

  // draft phase — conference + era in containers, each with its own reroll
  return (
    <div
      className="border border-ink/10 rounded-xl shadow-sm ring-1 ring-ink/5 p-4 lg:p-5"
      style={{ background: "var(--ttz-card-bg)" }}
    >
      <div className="grid grid-cols-2 gap-3">
        {/* Conference */}
        <div className="rounded-xl border border-ink/12 bg-paper-deep/40 px-4 pt-3 pb-3.5 flex flex-col items-center gap-2.5">
          <div className="flex-1 grid place-items-center min-h-[56px]">
            <ConfLogo code={roll!.conf} size={56} />
          </div>
          <RerollChip
            label="Re-roll"
            used={confRerollUsed}
            tone="coral"
            onClick={onRerollConf}
          />
        </div>
        {/* Era */}
        <div className="rounded-xl border border-ink/12 bg-paper-deep/40 px-4 pt-3 pb-3.5 flex flex-col items-center gap-2.5">
          <div className="flex-1 grid place-items-center min-h-[56px]">
            <div className="font-display text-4xl font-bold tabular text-[var(--ttz-era)] leading-none relative top-[3px] whitespace-nowrap">
              {roll!.group}
            </div>
          </div>
          <RerollChip
            label="Re-roll"
            used={yearRerollUsed}
            tone="court"
            onClick={onRerollYear}
          />
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- Reroll chip ----------------------------- */
function RerollChip({
  label,
  used,
  tone,
  onClick,
}: {
  label: string;
  used: boolean;
  tone: "coral" | "court";
  onClick: () => void;
}) {
  const active =
    tone === "coral"
      ? "border-coral/40 text-coral hover:bg-coral/10"
      : "border-[#9a6b3f]/50 text-[#9a6b3f] hover:bg-court/15";
  return (
    <button
      onClick={onClick}
      disabled={used}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 h-7 text-[11px] font-medium uppercase tracking-wide border transition-colors",
        used
          ? "border-hairline text-ink-muted/45 cursor-not-allowed line-through"
          : active,
      )}
    >
      <RotateCcw size={12} /> {label}
    </button>
  );
}

/* ----------------------------- Conf logo ----------------------------- */
function ConfLogo({ code, size = 24 }: { code: string; size?: number }) {
  const url = confLogoUrl(code);
  const [err, setErr] = useState(false);
  if (!url || err) return null;
  return (
    <img
      src={url}
      alt=""
      onError={() => setErr(true)}
      className="rounded-full object-contain p-0.5 shrink-0"
      style={{ width: size, height: size, background: "var(--ttz-conf-bg)" }}
    />
  );
}

/* ----------------------------- Slot reel ----------------------------- */
// Vegas-style reel: scrolls a long strip of items, decelerates (easeOutCubic)
// with motion blur, then bounce-snaps onto the target. Idle (spinId 0) shows "?".
const REEL_ITEM_H = 96;
const REEL_MASK = "linear-gradient(180deg,transparent,#000 22%,#000 78%,transparent)";

function SlotReel({
  kind,
  label,
  items,
  targetIndex,
  spinId,
  tone,
}: {
  kind: "conf" | "era";
  label: string;
  items: string[];
  targetIndex: number;
  spinId: number;
  tone: "coral" | "court";
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [seq, setSeq] = useState<number[] | null>(null);
  const [spinning, setSpinning] = useState(false);
  const color = tone === "coral" ? "text-coral" : "text-[var(--ttz-era)]";

  useEffect(() => {
    if (spinId === 0 || targetIndex < 0 || items.length === 0) return;
    // 6 full loops then run up to the target so it lands going downward.
    const s: number[] = [];
    for (let l = 0; l < 6; l++) for (let i = 0; i < items.length; i++) s.push(i);
    for (let i = 0; i <= targetIndex; i++) s.push(i);
    setSeq(s);
    setSpinning(true);

    const total = (s.length - 1) * REEL_ITEM_H;
    const DUR = 1900;
    let raf = 0;
    let start = 0;
    let init = false;
    function tick(now: number) {
      const strip = stripRef.current;
      if (strip && !init) {
        strip.style.transition = "none";
        strip.style.transform = "translateY(0)";
        init = true;
      }
      if (!start) start = now;
      const p = Math.min(1, (now - start) / DUR);
      const e = 1 - Math.pow(1 - p, 3); // easeOutCubic
      if (strip) {
        strip.style.transform = `translateY(${-e * total}px)`;
        strip.style.filter = p < 0.7 ? "blur(1.4px)" : "none";
      }
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      } else if (strip) {
        // overshoot then settle for a tactile snap
        strip.style.transform = `translateY(${-(total + 7)}px)`;
        requestAnimationFrame(() => {
          strip.style.transition = "transform .2s cubic-bezier(.34,1.56,.64,1)";
          strip.style.transform = `translateY(${-total}px)`;
        });
        setSpinning(false);
      } else {
        setSpinning(false);
      }
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinId]);

  return (
    <div
      className={cn(
        "rounded-xl border bg-paper-deep/40 px-4 py-4 flex flex-col items-center min-h-[150px] transition-all",
        spinning ? "border-coral/40 ring-2 ring-coral/10" : "border-ink/12",
      )}
    >
      <div className="text-[10px] uppercase tracking-[0.16em] text-ink-muted font-extrabold">
        {label}
      </div>
      <div className="flex-1 grid place-items-center w-full">
        {seq == null ? (
          <div className="text-[38px] font-extrabold text-ink/35 leading-none">?</div>
        ) : (
          <div
            className="relative w-full overflow-hidden"
            style={{
              height: REEL_ITEM_H,
              WebkitMaskImage: REEL_MASK,
              maskImage: REEL_MASK,
            }}
          >
            <div
              ref={stripRef}
              className="flex flex-col items-center"
              style={{ transform: "translateY(0)" }}
            >
              {seq.map((idx, k) => (
                <div
                  key={k}
                  className="flex items-center justify-center"
                  style={{ height: REEL_ITEM_H, flex: "none" }}
                >
                  {kind === "conf" ? (
                    <ConfLogo code={items[idx]} size={72} />
                  ) : (
                    <span className={cn("font-display text-4xl font-bold tabular leading-none whitespace-nowrap", color)}>
                      {items[idx]}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ----------------------------- Player card ----------------------------- */
function PlayerCard({
  p,
  used,
  draftable,
  active,
  onClick,
}: {
  p: GamePlayer;
  used: boolean;
  draftable: boolean;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!draftable}
      className={cn(
        "w-full text-left rounded-lg border px-4 py-3 transition-colors flex items-center gap-3",
        active
          ? "border-coral ring-2 ring-coral/30 bg-coral/5"
          : draftable
            ? "bg-[var(--ttz-card-bg)] border-ink/10 hover:border-ink/25 hover:bg-paper-deep/30"
            : "bg-paper-deep/20 border-hairline opacity-45 cursor-not-allowed",
      )}
    >
      <TeamLogo name={p.t} size={24} className="rounded-md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-ink truncate text-[15px] sm:text-base">{p.n}</span>
          {used && <span className="shrink-0 text-[10px] uppercase tracking-wide text-ink-muted">drafted</span>}
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-ink-muted hidden sm:inline">{p.yr}</span>
          <span className={cn("shrink-0 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded", BUCKET_CHIP[p.b])}>
            {p.alt ? `${p.b}/${p.alt}` : p.b}
          </span>
          <span className="inline-flex items-center gap-1 rounded bg-coral/12 px-1.5 py-0.5 leading-none">
            <span className="font-bold tabular text-coral text-[11px] leading-none">
              {p.prtg?.toFixed(1) ?? "—"}
            </span>
            <span className="text-[11px] font-bold uppercase tracking-wide text-coral/70 leading-none">
              PRTG
            </span>
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2.5 sm:gap-3.5 shrink-0 text-center">
        <Stat label="PPG" value={p.pts == null ? null : Math.round(p.pts)} />
        <Stat label="RPG" value={p.reb == null ? null : Math.round(p.reb)} />
        <Stat label="APG" value={p.ast == null ? null : Math.round(p.ast)} />
        <Stat label="EFG" value={p.efg == null ? null : Math.round(p.efg)} suffix="%" />
        <Stat label="3P" value={p.fg3 == null ? null : Math.round(p.fg3)} suffix="%" />
      </div>
    </button>
  );
}

function Stat({
  label,
  value,
  suffix = "",
}: {
  label: string;
  value: number | null;
  suffix?: string;
}) {
  return (
    <div className="block">
      <div className="text-sm font-semibold tabular text-ink leading-none">
        {value ?? "—"}
        {value != null && suffix}
      </div>
      <div className="text-[9px] uppercase tracking-wide text-ink-muted mt-0.5">{label}</div>
    </div>
  );
}

/* ----------------------------- Court ----------------------------- */
// Blueprint court — a schematic that flips with the page theme: soft light
// hardwood in light mode, after-hours navy in dark (see --ttz-court-* tokens
// in globals.css). Basket at the top: C sits near the baseline in the paint,
// the two F's spot up behind the arc on the wings, the two G's hold the
// perimeter up top.
const BUCKET_HEX: Record<Bucket, string> = { G: "#22c55e", F: "#a855f7", C: "#f97316" };

function Court({
  lineup,
  eligibleSlots,
  onSlotClick,
}: {
  lineup: Record<string, GamePlayer | null>;
  eligibleSlots: Set<string>;
  onSlotClick: (slotId: string) => void;
}) {
  const POS: Record<string, { x: number; y: number }> = {
    g1: { x: 30, y: 76 },
    g2: { x: 70, y: 76 },
    f1: { x: 16, y: 47 },
    f2: { x: 84, y: 47 },
    c1: { x: 50, y: 18 },
  };
  return (
    <div
      className="relative rounded-xl overflow-hidden w-full max-h-full"
      style={{
        background: "var(--ttz-court-bg)",
        aspectRatio: "1 / 1.04",
        boxShadow: "inset 0 0 0 1px var(--ttz-court-ring)",
      }}
    >
      <svg
        viewBox="0 0 400 416"
        className="absolute inset-0 h-full w-full pointer-events-none"
        preserveAspectRatio="none"
      >
        <g fill="none" stroke="var(--ttz-court-accent)" strokeWidth="1.4">
          <rect x="22" y="22" width="356" height="372" rx="4" />
          <rect x="152" y="22" width="96" height="128" />
          <circle cx="200" cy="150" r="38" />
          <path d="M54 22 L54 96 A150 150 0 0 0 346 96 L346 22" />
        </g>
        <g stroke="var(--ttz-court-line)" strokeWidth="1">
          <line x1="70" y1="22" x2="70" y2="29" />
          <line x1="110" y1="22" x2="110" y2="29" />
          <line x1="290" y1="22" x2="290" y2="29" />
          <line x1="330" y1="22" x2="330" y2="29" />
        </g>
      </svg>

      {SLOTS.map((s) => {
        const p = lineup[s.id];
        const pos = POS[s.id];
        const eligible = eligibleSlots.has(s.id);
        const color = BUCKET_HEX[s.bucket];
        return (
          <button
            key={s.id}
            onClick={() => eligible && onSlotClick(s.id)}
            disabled={!eligible}
            className={cn(
              "absolute -translate-x-1/2 -translate-y-1/2 transition-all",
              eligible ? "cursor-pointer" : "cursor-default",
            )}
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
          >
            {p ? (
              <div
                className="w-[clamp(78px,17vw,120px)] rounded-lg px-2.5 py-2 text-center backdrop-blur-[3px]"
                style={{
                  background: "var(--ttz-chip-bg)",
                  border: `1px solid ${color}`,
                  boxShadow: "var(--ttz-chip-shadow)",
                }}
              >
                <div className="flex items-center justify-center gap-1 mb-1">
                  <TeamLogo name={p.t} size={15} className="rounded-sm" />
                  <span className="text-[9px] font-bold uppercase" style={{ color }}>
                    {s.label}
                  </span>
                </div>
                <div
                  className="text-[12px] font-semibold leading-tight truncate"
                  style={{ color: "var(--ttz-chip-text)" }}
                >
                  {p.n}
                </div>
                <div
                  className="font-bold tabular text-sm leading-none mt-1"
                  style={{ color: "var(--ttz-chip-accent)" }}
                >
                  {p.prtg?.toFixed(1)}
                </div>
              </div>
            ) : (
              <div
                className={cn(
                  "w-[clamp(54px,12vw,74px)] aspect-square rounded-full grid place-items-center text-sm font-bold uppercase tracking-wide transition-all",
                  eligible && "animate-pulse",
                )}
                style={{
                  border: `2px dashed ${eligible ? "#c8553d" : color}`,
                  color: eligible ? "#c8553d" : color,
                  background: eligible ? "rgba(200,85,61,.14)" : "transparent",
                  boxShadow: eligible ? "0 0 0 4px rgba(200,85,61,.15)" : "none",
                }}
              >
                {s.label}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------- Result ----------------------------- */
function Result({
  shareRef,
  lineup,
  score,
  onShare,
  onReset,
}: {
  shareRef: React.RefObject<HTMLDivElement | null>;
  lineup: Record<string, GamePlayer | null>;
  score: ReturnType<typeof scoreLineup>;
  onShare: () => void;
  onReset: () => void;
}) {
  const ff = score.fourFactors;
  // Talent is an absolute raw-PRTG scale that realistically tops out ~70 (only an
  // all-time lineup approaches it), so it always looked stunted next to the 0-100
  // percentile bars. Rescale the DISPLAY so ~70 reads as a full bar. Rating math
  // is unaffected — this only changes the shown number + fill.
  const TALENT_DISPLAY_MAX = 70;
  const talentDisplay = Math.min(100, (score.core / TALENT_DISPLAY_MAX) * 100);
  const bars: { label: string; v: number; strong?: boolean }[] = [
    { label: "Talent", v: talentDisplay, strong: true },
    { label: "Efficiency", v: score.efficiency, strong: true },
    { label: "REB diff", v: ff.reb },
    { label: "3PM diff", v: ff.threeP },
    { label: "FBP diff", v: ff.fbp },
    { label: "TOV diff", v: ff.tov },
  ];
  return (
    <div className="mt-5">
      {/* share card */}
      <div
        ref={shareRef}
        className="rounded-xl border border-ink/10 ring-1 ring-ink/5 overflow-hidden"
        style={{ background: "var(--ttz-card-bg)" }}
      >
        <div className="h-1 w-full bg-gradient-to-r from-coral via-coral to-coral/60" />
        <div className="p-5 lg:p-6">
          <div className="flex items-end justify-between mb-4">
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-coral font-medium mb-1">
                {score.perfect ? "Perfect season" : "Final result"}
              </div>
              <div className="font-display text-4xl font-bold tabular text-ink leading-none">
                {score.projectedW}-{score.projectedL}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-[0.14em] text-ink-muted">Rating</div>
              <div
                className="font-display text-3xl font-bold tabular leading-none"
                style={{ color: gradeColor(score.grade) }}
              >
                {Math.round(score.grade)}
              </div>
            </div>
          </div>

          {/* lineup — vertical rows on mobile (full names), 5-col grid on desktop */}
          <div className="flex flex-col gap-1.5 mb-4 sm:grid sm:grid-cols-5">
            {SLOTS.map((s) => {
              const p = lineup[s.id];
              return (
                <div
                  key={s.id}
                  className="rounded-md bg-paper-deep/40 flex items-center gap-2.5 px-2.5 py-2 text-left sm:flex-col sm:gap-0 sm:px-1.5 sm:text-center"
                >
                  <span className={cn("inline-block shrink-0 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded", BUCKET_CHIP[s.bucket])}>
                    {s.label}
                  </span>
                  {p && <TeamLogo name={p.t} size={24} local className="shrink-0 sm:my-1.5" />}
                  <div className="min-w-0 flex-1 sm:flex-none">
                    <div className="text-[13px] sm:text-[11px] font-semibold text-ink leading-tight sm:truncate">{p?.n}</div>
                    <div className="text-[10px] sm:text-[9px] text-ink-muted">{p?.yr}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* score breakdown */}
          <div className="space-y-1.5">
            {bars.map((b) => (
              <div key={b.label} className="flex items-center gap-3">
                <div
                  className={cn(
                    "w-20 text-[10px] uppercase tracking-wide",
                    b.strong ? "text-ink font-semibold" : "text-ink-muted",
                  )}
                >
                  {b.label}
                </div>
                <div className="flex-1 h-2 rounded-full bg-paper-deep/60 overflow-hidden">
                  <div
                    className={cn("h-full rounded-full", b.strong ? "bg-coral" : "bg-coral/55")}
                    style={{ width: `${Math.max(2, Math.min(100, b.v))}%` }}
                  />
                </div>
                <div className="w-8 text-right font-semibold tabular text-xs text-ink">{Math.round(b.v)}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-[10px] text-ink-muted">Beyond the Arc · 32-0</div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={onShare}
          className="inline-flex items-center gap-2 rounded-full bg-ink text-paper font-medium px-5 h-10 text-sm hover:bg-ink-soft transition-colors"
        >
          <Share2 size={16} /> Save card
        </button>
        <button
          onClick={onReset}
          className="inline-flex items-center gap-2 rounded-full border border-ink/20 text-ink font-medium px-5 h-10 text-sm hover:bg-paper-deep transition-colors"
        >
          <Dices size={16} /> Play again
        </button>
      </div>
    </div>
  );
}
