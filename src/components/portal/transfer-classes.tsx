"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Star } from "lucide-react";
import { TeamLogo } from "@/components/team-logo";
import { PlayerPhoto } from "@/components/player-photo";
import { confDisplay } from "@/lib/conf-display";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";

export type TCPlayer = {
  cbba_player_id: number;
  bart_player_id: number | null;
  name: string;
  bta_portg: number | null;
  stars: 0 | 1 | 2 | 3 | 4 | 5;
  counter_team: string | null;   // OUT: where they went. IN: where they came from.
  counter_conf: string | null;
};
export type TransferClassRow = {
  school: string;
  conference: string | null;
  net: number;
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
  return (
    <div className={`bg-card border border-hairline rounded-lg p-4 ${className}`}>
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="font-display text-lg text-ink">{title}</h3>
      </div>
      <div className="text-[0.65rem] text-ink-muted mb-2">{subtitle}</div>
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
                <span className={`font-display text-base tabular tabular-nums ${r.net >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                  {r.net > 0 ? "+" : ""}{r.net.toFixed(1)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
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
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 p-4 pt-[6vh]"
      onClick={onClose}
    >
      <div
        className="bg-card border border-hairline rounded-lg w-full max-w-4xl max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-hairline">
          <Link href={`/teams/${slugFor(row.school)}/`} className="flex items-center gap-3 group" onClick={onClose}>
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
              <div className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">Net BTA PRTG</div>
              <div className={`font-display text-3xl tabular ${row.net >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                {row.net > 0 ? "+" : ""}{row.net.toFixed(1)}
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
  const totalPortg = players.reduce((s, p) => s + (p.bta_portg ?? 0), 0);
  return (
    <div className="p-5">
      <div className="flex items-baseline justify-between mb-3">
        <span className={`text-xs uppercase tracking-widest font-medium ${accent}`}>{kicker}</span>
        <span className="text-[0.65rem] text-ink-muted">
          {players.length} {players.length === 1 ? "player" : "players"} · {totalPortg > 0 ? "+" : ""}{totalPortg.toFixed(1)} total
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
                  <Link href={`/players/${p.bart_player_id}/`} className="font-medium text-ink hover:text-coral transition-colors block truncate">
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
              <span className={`font-medium tabular text-sm ${(p.bta_portg ?? 0) >= 0 ? "text-ink" : "text-rose-700"}`}>
                {p.bta_portg === null ? "—" : `${p.bta_portg > 0 ? "+" : ""}${p.bta_portg.toFixed(1)}`}
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
