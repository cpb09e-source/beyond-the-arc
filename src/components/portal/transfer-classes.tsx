"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Star, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { TeamLogo } from "@/components/team-logo";
import { PlayerPhoto } from "@/components/player-photo";
import { confDisplay } from "@/lib/conf-display";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";

export type TCPlayer = {
  cbba_player_id: number;
  bart_player_id: number | null;
  name: string;
  // Portal Value Score — EPM scaled by role. Tiers the player (the stars);
  // NOT what the class total is built from. See scripts/rescore-portal.mjs.
  pvs: number | null;
  epm: number | null;
  /** Wins over an average player, as measured last season. */
  ewins: number | null;
  /** eWins plus the measured freshman development bump. */
  ewins_proj: number | null;
  /** EPM added by the sophomore leap; 0 for everyone who is not a freshman. */
  dev_bump?: number;
  /** PIR after the conference-tier multiplier. */
  pir_adj?: number | null;
  /** The tiered-PIR term converted to wins, centred so average = 0. */
  pir_wins?: number;
  /** Team net rating on-floor minus off-floor, and the charge for a negative one. */
  on_off?: number | null;
  onoff_pen?: number;
  /**
   * eWins + development bump + tiered-PIR term, in wins. THIS is the class
   * currency: `net` is the sum of these in minus HALF the sum of these out, so
   * the numbers in the modal add up to the number on the card.
   */
  value: number | null;
  stars: 0 | 1 | 2 | 3 | 4 | 5;
  counter_team: string | null;   // OUT: where they went. IN: where they came from.
  counter_conf: string | null;
};
export type TransferClassRow = {
  school: string;
  conference: string | null;
  /**
   * Net eWins: sum of incoming minus HALF the sum of outgoing. The half-weight
   * is replacement level — the minutes a departure leaves behind get played by
   * somebody, usually one of the arrivals already credited in full on the other
   * side of the same subtraction. See OUT_WEIGHT in scripts/rescore-portal.mjs.
   */
  net: number;
  /**
   * The same thing on a 0-100 reading scale — 12 points per net win, so an
   * average class scores 0 and the best of this cycle lands in the low 90s.
   * Fixed scale, so a 60 means the same thing in any cycle; negatives are real
   * and unclamped.
   */
  score: number;
  in_count: number;
  out_count: number;
  in_players: TCPlayer[];
  out_players: TCPlayer[];
};

function slugFor(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Single transfer-class ranking card. Designed to be mounted as a sidebar
 * column on the portal page (sticky as the table scrolls). Open-state is
 * lifted to the parent so multiple panels can share one modal.
 */
export function TransferClassesPanel({
  title,
  subtitle,
  rows,
  onOpen,
  className = "",
}: {
  title: string;
  subtitle: string;
  rows: TransferClassRow[];
  onOpen: (r: TransferClassRow) => void;
  className?: string;
}) {
  // Collapsed by default on mobile (expand on tap); always open on xl where it
  // sits as a sticky sidebar.
  const [open, setOpen] = useState(false);
  return (
    <div className={`bg-paper-deep/25 border-y border-x-0 lg:border-x border-hairline rounded-none lg:rounded-xl shadow-sm p-4 -mx-6 lg:mx-0 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 min-h-11 xl:min-h-0 xl:cursor-default"
      >
        <h3 className="font-display text-lg text-ink">{title}</h3>
        <ChevronDown className={cn("w-4 h-4 text-ink-muted transition-transform xl:hidden", open && "rotate-180")} aria-hidden />
      </button>
      <div className={cn(open ? "block" : "hidden", "xl:block")}>
      <div className="text-[0.65rem] text-ink-muted mb-2 mt-3 xl:mt-2">{subtitle}</div>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">No matching schools.</p>
      ) : (
        <ul className="divide-y divide-hairline/60">
          {rows.map((r, i) => (
            <li key={r.school}>
              <button
                type="button"
                onClick={() => onOpen(r)}
                className="w-full flex items-center gap-2.5 py-2 text-left hover:bg-paper-deep/40 transition-colors rounded px-1.5 -mx-1.5"
              >
                <span className="font-display text-base text-ink-muted tabular w-5 text-center">{i + 1}</span>
                <TeamLogo name={r.school} size={28} />
                <span className="flex-1 min-w-0">
                  <span className="font-medium text-ink text-sm truncate block">{r.school}</span>
                  <span className="text-[0.6rem] text-ink-muted">
                    {confDisplay(r.conference)} · {r.in_count}↓ {r.out_count}↑
                  </span>
                </span>
                <span className={`font-display text-base tabular tabular-nums ${r.score >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                  {r.score > 0 ? "+" : ""}{r.score}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      </div>
    </div>
  );
}

/**
 * Click-through modal for a single transfer class. Shows incoming on the
 * left and outgoing on the right, filtered to players with 2+ stars (drops
 * walk-ons and minimal-impact moves so the list reads cleanly).
 */
export function TransferClassModal({ row, onClose }: { row: TransferClassRow; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  useBodyScrollLock(true);

  const inPlayers = row.in_players.filter((p) => p.stars >= 2);
  const outPlayers = row.out_players.filter((p) => p.stars >= 2);

  return (
    <div
      role="dialog"
      aria-modal
      aria-label={`${row.school} transfer class`}
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 p-0 pt-0 sm:p-4 sm:pt-[6vh]"
      onClick={onClose}
    >
      <div
        className="bg-card border-y sm:border border-hairline rounded-none sm:rounded-lg w-full max-w-4xl max-h-dvh sm:max-h-[88vh] min-h-dvh sm:min-h-0 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-hairline">
          <Link href={`/teams/${slugFor(row.school)}/`} className="flex items-center gap-3 group" onClick={onClose} prefetch={false}>
            <TeamLogo name={row.school} size={36} />
            <div>
              <div className="font-display text-2xl text-ink leading-tight group-hover:text-coral transition-colors">{row.school}</div>
              <div className="text-xs text-ink-muted">
                {confDisplay(row.conference)} · transfer class
              </div>
            </div>
          </Link>
          <div className="flex items-baseline gap-3">
            <div className="text-right">
              <div className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">Class score</div>
              <div className={`font-display text-3xl tabular ${row.score >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                {row.score > 0 ? "+" : ""}{row.score}
              </div>
              {/* The score is a reading scale; the wins are the quantity. Both,
                  so the number can be checked against the players below it. */}
              <div className="text-[0.6rem] text-ink-muted tabular mt-0.5">
                {row.net > 0 ? "+" : ""}{row.net.toFixed(1)} net wins
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="text-ink-muted hover:text-coral text-xl leading-none px-2"
            >
              ×
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] gap-0 overflow-y-auto flex-1">
          <PlayerList kicker="Incoming" accent="text-emerald-700" players={inPlayers} />
          <div className="hidden md:block bg-hairline" />
          <PlayerList kicker="Outgoing" accent="text-rose-700" players={outPlayers} />
        </div>
      </div>
    </div>
  );
}

function PlayerList({
  kicker, accent, players,
}: {
  kicker: string;
  accent: string;
  players: TCPlayer[];
}) {
  // Sums eWins, matching the card's net so the two agree on screen.
  const totalEwins = players.reduce((s, p) => s + (p.value ?? 0), 0);
  return (
    <div className="p-5">
      <div className="flex items-baseline justify-between mb-3">
        <span className={`text-xs uppercase tracking-widest font-medium ${accent}`}>{kicker}</span>
        <span className="text-[0.65rem] text-ink-muted">
          {players.length} {players.length === 1 ? "player" : "players"} · {totalEwins > 0 ? "+" : ""}{totalEwins.toFixed(1)} wins
          {kicker === "Outgoing" && (
            // The net charges only half of this, so saying so here stops the
            // two numbers on screen from looking like they disagree.
            <span className="text-ink-muted/70"> · charged at half</span>
          )}
        </span>
      </div>
      {players.length === 0 ? (
        <p className="text-sm text-ink-muted">None (2★+).</p>
      ) : (
        <ul className="divide-y divide-hairline/60">
          {players.map((p) => (
            <li key={p.cbba_player_id} className="flex items-center gap-3 py-2.5">
              <PlayerPhoto bartPlayerId={p.bart_player_id} name={p.name} size={28} />
              <div className="flex-1 min-w-0">
                {p.bart_player_id ? (
                  <Link href={`/players/${p.bart_player_id}/`} className="font-medium text-ink hover:text-coral transition-colors block truncate" prefetch={false}>
                    {p.name}
                  </Link>
                ) : (
                  <span className="font-medium text-ink block truncate">{p.name}</span>
                )}
                <div className="flex items-center gap-2 mt-0.5">
                  <MiniStars stars={p.stars} />
                  {p.counter_team ? (
                    <span className="text-[0.65rem] text-ink-muted truncate">
                      {kicker === "Incoming" ? "from" : "to"} {p.counter_team}{p.counter_conf ? ` (${p.counter_conf})` : ""}
                    </span>
                  ) : kicker === "Outgoing" ? (
                    <span className="text-[0.65rem] text-coral/80 truncate">in portal</span>
                  ) : null}
                </div>
              </div>
              <span className="flex flex-col items-end">
                <span
                  className={`font-medium tabular text-sm ${(p.value ?? 0) >= 0 ? "text-ink" : "text-rose-700"}`}
                  title={p.value === null ? undefined
                    : `${p.ewins_proj?.toFixed(2) ?? "—"} eWins${(p.dev_bump ?? 0) > 0 ? " (incl. soph leap)" : ""}` +
                      `  ·  ${(p.pir_wins ?? 0) >= 0 ? "+" : ""}${(p.pir_wins ?? 0).toFixed(2)} from tiered PIR` +
                      `${p.pir_adj != null ? ` (PIR ${p.pir_adj.toFixed(1)} after conference tier)` : ""}` +
                      `${(p.onoff_pen ?? 0) < 0 ? `  ·  ${p.onoff_pen?.toFixed(2)} for an on/off of ${p.on_off?.toFixed(1)}` : ""}`}
                >
                  {p.value === null ? "—" : `${p.value > 0 ? "+" : ""}${p.value.toFixed(2)}`}
                </span>
                {/* A bumped freshman is marked rather than silently inflated —
                    the number above him is part projection, and the reader is
                    entitled to know which players that applies to. */}
                {(p.dev_bump ?? 0) > 0 && (
                  <span
                    className="text-[0.55rem] uppercase tracking-widest text-coral/80 whitespace-nowrap"
                    title={`Includes a measured +${p.dev_bump?.toFixed(2)} EPM freshman-to-sophomore development bump`}
                  >
                    soph leap
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MiniStars({ stars }: { stars: 0 | 1 | 2 | 3 | 4 | 5 }) {
  if (stars === 0) return null;
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${stars} stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={10}
          strokeWidth={2}
          className={n <= stars ? "text-coral fill-coral" : "text-ink-muted/30"}
          fill={n <= stars ? "currentColor" : "none"}
        />
      ))}
    </span>
  );
}
