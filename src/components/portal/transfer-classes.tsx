"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Star, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { TeamLogo } from "@/components/team-logo";
import { TopHundredPill } from "@/components/portal/top-hundred-pill";
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
   * eWins + development bump + tiered-PIR term − on/off penalty, in wins. The
   * quantity behind the Rating; the class card sums the Rating itself.
   */
  value: number | null;
  /** The player's Rating. Class scores are these, summed. */
  rating?: number | null;
  stars: 0 | 1 | 2 | 3 | 4 | 5;
  /** Overall board position when inside the top 100, else null. */
  t100?: number | null;
  counter_team: string | null;   // OUT: where they went. IN: where they came from.
  counter_conf: string | null;
};
export type TransferClassRow = {
  school: string;
  conference: string | null;
  /**
   * Sum of incoming player Ratings minus the sum of outgoing — a straight
   * ledger, both sides at full weight, so the two columns in the modal
   * subtract to the number on the card.
   */
  net: number;
  /** The same class expressed in wins, for the modal's secondary line. */
  net_wins?: number;
  /**
   * The rating sum, rounded. Runs in the hundreds because a class is seven or
   * eight players and one can be worth 97 alone.
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
 * Single transfer-class ranking card.
 *
 * TWO SHAPES, ONE COMPONENT.
 *
 * On `xl` it is what it always was: a card in a sticky sidebar column beside
 * the transfers table, list always open, nothing to tap first.
 *
 * BELOW `xl` IT IS ONE LINE. Both panels used to render as full cards — paper
 * fill, border, shadow, a `font-display text-lg` heading and a 44px tap row —
 * stacked above the table a reader came to the page to see. Two of them cost
 * about 150px of a phone screen to say two headings, and collapsing them in
 * place only traded that for a list that shoved the table further down when
 * opened. So on a phone each is a hairline row carrying its own leader, and the
 * ranking opens OVER the page rather than inside it: nothing below it moves.
 *
 * The leader rides on the line deliberately. A row reading only "Top transfer
 * classes" is a label; one reading "Top transfer classes · Cincinnati +204"
 * has already answered what most readers were going to tap for.
 *
 * Open-state for the per-class modal is still lifted to the parent so both
 * panels share one modal — the sheet closes itself before handing over, so the
 * two are never mounted at once.
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
  const [sheet, setSheet] = useState(false);
  const leader = rows[0];

  return (
    <>
      {/* Phone and tablet: one quiet line. The bleed matches the table's, so
          the hairline runs the full width of the screen like the page's other
          rules rather than stopping inside a gutter. */}
      <button
        type="button"
        onClick={() => setSheet(true)}
        aria-haspopup="dialog"
        className={cn(
          // A <button> shrink-to-fits rather than stretching, so the table's
          // `-mx-6` bleed trick does not work on one: it needs the extra
          // 3rem asked for explicitly. Same resulting edges as the table.
          "xl:hidden w-[calc(100%+3rem)] -ml-6 px-6 lg:w-full lg:ml-0 lg:px-0",
          "flex items-baseline gap-2 py-2.5 text-left border-b border-hairline",
          "active:bg-paper-deep/40 transition-colors",
        )}
      >
        <span className="text-[0.62rem] uppercase tracking-[0.14em] font-semibold text-ink-soft shrink-0">
          {title}
        </span>
        {leader && (
          <span className="text-[0.68rem] text-ink-muted truncate min-w-0">
            {leader.school}{" "}
            <span className={cn("tabular", leader.score >= 0 ? "text-good" : "text-bad")}>
              {leader.score > 0 ? "+" : ""}{leader.score}
            </span>
          </span>
        )}
        <ChevronRight className="ml-auto w-3.5 h-3.5 shrink-0 self-center text-ink-muted" aria-hidden />
      </button>

      {/* xl: the sidebar card, as before. */}
      <div
        className={cn(
          "hidden xl:block bg-paper-deep/25 border border-hairline rounded-xl shadow-sm p-4",
          className,
        )}
      >
        <h3 className="font-display text-lg text-ink">{title}</h3>
        <div className="text-[0.65rem] text-ink-muted mb-2 mt-2">{subtitle}</div>
        <ClassList rows={rows} onPick={onOpen} />
      </div>

      {sheet && (
        <TransferClassSheet
          title={title}
          subtitle={subtitle}
          rows={rows}
          onPick={(r) => { setSheet(false); onOpen(r); }}
          onClose={() => setSheet(false)}
        />
      )}
    </>
  );
}

/** The ranked school list. Shared verbatim by the xl card and the phone sheet. */
function ClassList({ rows, onPick }: { rows: TransferClassRow[]; onPick: (r: TransferClassRow) => void }) {
  if (rows.length === 0) return <p className="text-sm text-ink-muted">No matching schools.</p>;
  return (
    <ul className="divide-y divide-hairline/60">
      {rows.map((r, i) => (
        <li key={r.school}>
          <button
            type="button"
            onClick={() => onPick(r)}
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
            <span className={`font-display text-base tabular tabular-nums ${r.score >= 0 ? "text-good" : "text-bad"}`}>
              {r.score > 0 ? "+" : ""}{r.score}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The ranking, over the page rather than inside it.
 *
 * Anchored to the BOTTOM, unlike TransferClassModal below, which is a
 * reference page you read top-down. This one is a menu: it is opened to pick a
 * school, so the rows want to be under the thumb, and the list scrolls in its
 * own box so picking never moves the page behind it.
 */
function TransferClassSheet({
  title, subtitle, rows, onPick, onClose,
}: {
  title: string;
  subtitle: string;
  rows: TransferClassRow[];
  onPick: (r: TransferClassRow) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  useBodyScrollLock(true);

  return (
    <div
      role="dialog"
      aria-modal
      aria-label={title}
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[82vh] flex flex-col bg-card border-t border-hairline rounded-t-xl shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-3 border-b border-hairline shrink-0">
          <div className="min-w-0">
            <h3 className="font-display text-lg text-ink leading-tight">{title}</h3>
            <div className="text-[0.65rem] text-ink-muted mt-0.5">{subtitle}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 -mr-1 inline-flex items-center justify-center w-9 h-9 rounded-lg bg-ink/[0.07] text-ink hover:bg-ink/[0.12] transition-colors"
          >
            <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pt-1"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}
        >
          <ClassList rows={rows} onPick={onPick} />
        </div>
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
              <div className={`font-display text-3xl tabular ${row.score >= 0 ? "text-good" : "text-bad"}`}>
                {row.score > 0 ? "+" : ""}{row.score}
              </div>
              {/* The score is a reading scale; the wins are the quantity. Both,
                  so the number can be checked against the players below it. */}
              <div className="text-[0.6rem] text-ink-muted tabular mt-0.5">
                {row.net_wins == null ? null : <>{row.net_wins > 0 ? "+" : ""}{row.net_wins.toFixed(1)} net wins</>}
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
          <PlayerList kicker="Incoming" accent="text-good" players={inPlayers} />
          <div className="hidden md:block bg-hairline" />
          <PlayerList kicker="Outgoing" accent="text-bad" players={outPlayers} />
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
  const totalRating = players.reduce((s, p) => s + (p.rating ?? 0), 0);
  return (
    <div className="p-5">
      <div className="flex items-baseline justify-between mb-3">
        <span className={`text-xs uppercase tracking-widest font-medium ${accent}`}>{kicker}</span>
        <span className="text-[0.65rem] text-ink-muted">
          {players.length} {players.length === 1 ? "player" : "players"} · {totalRating > 0 ? "+" : ""}{Math.round(totalRating)} rating

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
                {/* The board mark, same as the portal table — this list is
                    where a class is judged, and "they signed a top-20 player"
                    is the first thing worth seeing about one. */}
                <span className="flex items-center gap-1.5 min-w-0">
                  {p.bart_player_id ? (
                    <Link href={`/players/${p.bart_player_id}/`} className="font-medium text-ink hover:text-coral transition-colors truncate" prefetch={false}>
                      {p.name}
                    </Link>
                  ) : (
                    <span className="font-medium text-ink truncate">{p.name}</span>
                  )}
                  {p.t100 ? <TopHundredPill rank={p.t100} /> : null}
                </span>
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
                  className={`font-medium tabular text-sm ${(p.rating ?? 0) >= 0 ? "text-ink" : "text-bad"}`}
                  title={p.value === null ? undefined
                    : `${p.ewins_proj?.toFixed(2) ?? "—"} eWins${(p.dev_bump ?? 0) > 0 ? " (incl. soph leap)" : ""}` +
                      `  ·  ${(p.pir_wins ?? 0) >= 0 ? "+" : ""}${(p.pir_wins ?? 0).toFixed(2)} from tiered PIR` +
                      `${p.pir_adj != null ? ` (PIR ${p.pir_adj.toFixed(1)} after conference tier)` : ""}` +
                      `${(p.onoff_pen ?? 0) < 0 ? `  ·  ${p.onoff_pen?.toFixed(2)} for an on/off of ${p.on_off?.toFixed(1)}` : ""}`}
                >
                  {p.rating == null ? "—" : String(p.rating)}
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
