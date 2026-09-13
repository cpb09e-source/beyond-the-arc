import { ChartColumn, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { F } from "@/lib/game-index";
import { T } from "@/lib/team-game-index";
import { logDate, useOpenGame } from "~/data/game-link";
import { loadPlayerGameSeason, siteOf, wonGame, type PlayerGame } from "~/data/player-game-model";
import { loadTeamGameSeason, type TeamGame } from "~/data/team-game-model";
import { useLoaded } from "~/data/use-corpus";
import { seasonLabel } from "~/ui/format";
import { TeamLogo } from "~/ui/logo";
import type { MenuItem } from "~/ui/menu";
import { PlayerPhoto } from "~/ui/player-photo";
import { PLAYER_LENS, PLAYER_LENS_FOR, TEAM_LENS, TEAM_LENS_FOR, formatLens, type LensFmt, type LensStat } from "./lens-stats";

/**
 * The Stat Lens: why a number is the number.
 *
 * ALT-CLICK A NUMBER, OR RIGHT-CLICK IT, and it opens into the games that made
 * it: every game as a bar against the season line, the number rebuilt for
 * home and away, wins and losses, conference play, the last five and ten, each
 * month, and the nights that pushed it up and pulled it down. Every game
 * opens its box score.
 *
 * REBUILT, NOT RESTATED. The season figure for a set of games comes from the
 * same totals the season is built from (./lens-stats.ts), so "Away 112.4" is
 * what the team actually did away, not an average of nightly percentages.
 *
 * HONEST ABOUT WHAT THE GAMES CANNOT SAY. An adjusted rating is the games
 * weighed against the schedule; the lens gives the raw figure beside it and
 * says what the adjustment is worth, and it offers nothing for a season-long
 * fit (EPM, eWins) that no game adds up to.
 */

export type LensSubject =
  | { kind: "team"; name: string; logoId: number | null; year: number }
  | { kind: "player"; bartId: number; name: string; hasPhoto: boolean; year: number };

export type LensTarget = {
  subject: LensSubject;
  /** A key of TEAM_LENS or PLAYER_LENS. */
  stat: string;
  /** The number that was clicked, as it read, and what it was called there. */
  shown?: { label: string; value: string };
  /** The number clicked is the schedule-adjusted form of what the games show. */
  adjusted?: boolean;
};

type Shown = { label: string; value: string };

/** A Team Explorer column, team stat card or team tile, as a lens, when its number is built from games. */
export function teamLens(key: string, subject: Extract<LensSubject, { kind: "team" }>, shown?: Shown): LensTarget | null {
  const m = TEAM_LENS_FOR[key];
  return m && TEAM_LENS[m.stat] ? { subject, stat: m.stat, shown, adjusted: m.adjusted } : null;
}

/** A Player Explorer column, player stat card or tile, as a lens, when its number is built from games. */
export function playerLens(key: string, subject: Extract<LensSubject, { kind: "player" }>, shown?: Shown): LensTarget | null {
  const stat = PLAYER_LENS_FOR[key];
  return stat && PLAYER_LENS[stat] ? { subject, stat, shown } : null;
}

const statOf = (t: LensTarget): LensStat<TeamGame> | LensStat<PlayerGame> =>
  t.subject.kind === "team" ? TEAM_LENS[t.stat]! : PLAYER_LENS[t.stat]!;

/** The first entry of a number's right-click menu. */
export function lensMenuEntry(t: LensTarget, run: () => void): MenuItem {
  return {
    kind: "item",
    id: "lens",
    label: `Break down ${t.shown?.label ?? statOf(t).label}`,
    icon: <ChartColumn size={14} strokeWidth={2} />,
    hint: "Alt click",
    onSelect: run,
  };
}

type OpenLens = (target: LensTarget, at: { x: number; y: number }) => void;

const LensContext = createContext<OpenLens | null>(null);

/** Opens the lens at a point; null outside the workbench. */
export const useStatLens = (): OpenLens | null => useContext(LensContext);

export function StatLensProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<{ target: LensTarget; at: { x: number; y: number }; n: number } | null>(null);
  const count = useRef(0);
  const show = useCallback<OpenLens>((target, at) => setOpen({ target, at, n: ++count.current }), []);
  const close = useCallback(() => setOpen(null), []);
  return (
    <LensContext.Provider value={show}>
      {children}
      {open && <LensPanel key={open.n} target={open.target} at={open.at} onClose={close} />}
    </LensContext.Provider>
  );
}

/* --------------------------------- panel ---------------------------------- */

const WIDTH = 600;

/** Beside the number, clamped into the window; closes on Esc, a press outside, or a resize. */
function LensPanel({ target, at, onClose }: { target: LensTarget; at: { x: number; y: number }; onClose: () => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState<number | null>(null);
  const left = Math.max(8, Math.min(at.x + 14, window.innerWidth - WIDTH - 8));
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  // An Alt-click opens the lens during its own mousedown, and React adds the
  // outside-press listener before that press has finished bubbling to the
  // window. A press older than the panel is the one that opened it.
  const [born] = useState(() => performance.now());

  // Placed after every layout: the panel grows once the season's games arrive.
  useLayoutEffect(() => {
    const h = boxRef.current?.offsetHeight ?? 0;
    setTop(Math.max(48, Math.min(at.y - 80, window.innerHeight - h - 12)));
  });

  useEffect(() => {
    // In the capture phase, so Esc closes the lens before a table takes it to close a Peek.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close.current();
    };
    const onDown = (e: MouseEvent) => {
      if (e.timeStamp < born) return;
      if (!boxRef.current?.contains(e.target as Node)) close.current();
    };
    const onResize = () => close.current();
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const s = target.subject;
  const stat = statOf(target);
  return createPortal(
    <div
      ref={boxRef}
      role="dialog"
      aria-label={`${stat.label}, ${s.name}`}
      className="menu-in fixed z-50 flex max-h-[calc(100vh-60px)] flex-col overflow-hidden rounded-xl border border-hairline bg-card"
      style={{ left, top: top ?? at.y, width: WIDTH, boxShadow: "var(--overlay-shadow)", visibility: top == null ? "hidden" : undefined }}
    >
      <header className="flex shrink-0 items-center gap-2.5 border-b border-hairline px-4 py-2.5">
        {s.kind === "team" ? (
          <TeamLogo id={s.logoId} name={s.name} size={26} />
        ) : (
          <PlayerPhoto bartId={s.bartId} hasPhoto={s.hasPhoto} name={s.name} size={30} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-[14px] font-semibold text-ink">{s.name}</span>
            <span className="shrink-0 text-[12px] text-ink-muted tabular">{seasonLabel(s.year)}</span>
          </div>
          <div className="flex items-center gap-1.5 text-[12px] text-ink-muted">
            <ChartColumn size={12} strokeWidth={2} />
            {stat.label}, game by game
          </div>
        </div>
        <button
          type="button"
          aria-label="Close"
          title="Close  ·  Esc"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClose}
          className="grid size-[26px] shrink-0 place-items-center rounded-md text-ink-muted transition-colors hover:bg-[var(--row-hover)] hover:text-ink"
        >
          <X size={15} strokeWidth={2} />
        </button>
      </header>
      <div className="min-h-0 overflow-y-auto px-4 pb-4 pt-3">
        {s.kind === "team" ? <TeamLens target={target} subject={s} onClose={onClose} /> : <PlayerLens target={target} subject={s} onClose={onClose} />}
      </div>
    </div>,
    document.body,
  );
}

function LensNote({ children }: { children: ReactNode }) {
  return <p className="py-10 text-center text-[13px] text-ink-muted">{children}</p>;
}

/** How a lens reads one game, whoever's it is. */
type Reader<G> = {
  epochMs: number;
  day: (g: G) => number;
  won: (g: G) => boolean;
  site: (g: G) => "home" | "away" | "neutral";
  /** Teams only: the log marks conference games for teams, not for players. */
  conference?: (g: G) => boolean;
  ranked?: (g: G) => boolean;
  opp: (g: G) => { name: string; logoId: number | null };
  line: (g: G) => string;
};

type How = { newTab: boolean; side: boolean };

function TeamLens({ target, subject, onClose }: { target: LensTarget; subject: Extract<LensSubject, { kind: "team" }>; onClose: () => void }) {
  const [state] = useLoaded(`team-games|${subject.year}`, () => loadTeamGameSeason(subject.year));
  const openGame = useOpenGame();
  const season = state.status === "ready" ? state.value : null;
  const games = useMemo(
    () => (season ? season.games.filter((g) => g.team === subject.name).sort((a, b) => a.row[T.d]! - b.row[T.d]!) : []),
    [season, subject.name],
  );
  const read = useMemo<Reader<TeamGame> | null>(
    () =>
      season
        ? {
            epochMs: season.pack.epochMs,
            day: (g) => g.row[T.d]!,
            won: (g) => g.won,
            site: (g) => g.site,
            conference: (g) => g.conference,
            ranked: (g) => g.oppAp >= 1 && g.oppAp <= 25,
            opp: (g) => ({ name: g.opp, logoId: g.oppLogoId }),
            line: (g) => `${g.won ? "W" : "L"} ${g.pts}–${g.pa}`,
          }
        : null,
    [season],
  );
  if (state.status === "error") {
    return <LensNote>{state.reason === "gated" ? `The ${seasonLabel(subject.year)} game log comes with Season Pass.` : "The game log did not load."}</LensNote>;
  }
  if (!season || !read) return <LensNote>Loading the game log…</LensNote>;
  if (games.length === 0) return <LensNote>No games in the log for {subject.name} in {seasonLabel(subject.year)}.</LensNote>;
  return (
    <LensBody
      stat={TEAM_LENS[target.stat]!}
      target={target}
      games={games}
      read={read}
      onOpen={(g, how) => {
        onClose();
        openGame({ date: logDate(season.pack.epochMs, g.row[T.d]!), team: g.team, opp: g.opp }, how, () => {});
      }}
    />
  );
}

function PlayerLens({ target, subject, onClose }: { target: LensTarget; subject: Extract<LensSubject, { kind: "player" }>; onClose: () => void }) {
  const [state] = useLoaded(`player-games|${subject.year}`, () => loadPlayerGameSeason(subject.year));
  const openGame = useOpenGame();
  const season = state.status === "ready" ? state.value : null;
  const index = useMemo(() => (season ? season.players.findIndex((p) => p.bartId === subject.bartId) : -1), [season, subject.bartId]);
  const games = useMemo(
    () => (season && index >= 0 ? season.games.filter((g) => g.row[F.p] === index).sort((a, b) => a.row[F.d]! - b.row[F.d]!) : []),
    [season, index],
  );
  const read = useMemo<Reader<PlayerGame> | null>(
    () =>
      season
        ? {
            epochMs: season.pack.epochMs,
            day: (g) => g.row[F.d]!,
            won: (g) => wonGame(g.row),
            site: (g) => siteOf(g.row),
            opp: (g) => {
              const o = season.opps[g.row[F.o]!]!;
              return { name: o.name, logoId: o.logoId };
            },
            line: (g) => `${wonGame(g.row) ? "W" : "L"} · ${g.row[F.pts]} pts, ${g.row[F.reb]} reb, ${g.row[F.ast]} ast`,
          }
        : null,
    [season],
  );
  if (state.status === "error") {
    return <LensNote>{state.reason === "gated" ? `The ${seasonLabel(subject.year)} game log comes with Season Pass.` : "The game log did not load."}</LensNote>;
  }
  if (!season || !read) return <LensNote>Loading the game log…</LensNote>;
  if (games.length === 0) return <LensNote>No games in the log for {subject.name} in {seasonLabel(subject.year)}.</LensNote>;
  const team = season.players[index]?.team ?? "";
  return (
    <LensBody
      stat={PLAYER_LENS[target.stat]!}
      target={target}
      games={games}
      read={read}
      onOpen={(g, how) => {
        onClose();
        openGame({ date: logDate(season.pack.epochMs, g.row[F.d]!), team, opp: season.opps[g.row[F.o]!]!.name }, how, () => {});
      }}
    />
  );
}

/* ---------------------------------- body ---------------------------------- */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86_400_000;
/** Bars that beat the season line in full ink, the rest a step back, as the game page draws who won a row. */
const INK_ABOVE = "color-mix(in oklab, var(--ink) 62%, var(--card))";
const INK_BELOW = "color-mix(in oklab, var(--ink) 20%, var(--card))";
/** Stats with no better end: faster is not better. */
const NEUTRAL = new Set(["pace", "min", "fga", "fg3a", "fta", "fg3_rate", "usg"]);

/** A difference in the stat's own units: percentage points for a percentage. */
function diffText(fmt: LensFmt, d: number): string {
  const v = fmt === "pct1" ? d * 100 : d;
  const digits = fmt === "num2" ? 2 : 1;
  const text = Math.abs(v).toFixed(digits);
  return Number(text) === 0 ? "0" : `${v > 0 ? "+" : "−"}${text}`;
}

/** The number a cell showed, back into the stat's units ("58.3" for a percentage is 0.583). */
function parseShown(fmt: LensFmt, value: string): number | null {
  const n = Number(value.replace("−", "-").replace("+", "").replace("%", "").trim());
  if (!Number.isFinite(n)) return null;
  return fmt === "pct1" ? n / 100 : n;
}

function LensBody<G>({
  stat,
  target,
  games,
  read,
  onOpen,
}: {
  stat: LensStat<G>;
  target: LensTarget;
  games: G[];
  read: Reader<G>;
  onOpen: (g: G, how: How) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const values = useMemo(
    () =>
      games.map((g) => {
        const v = stat.game(g);
        return v == null || Number.isNaN(v) ? null : v;
      }),
    [games, stat],
  );
  const whole = useMemo(() => stat.pool(games), [games, stat]);
  const neutral = NEUTRAL.has(stat.key);

  const dateOf = (g: G) => new Date(read.epochMs + read.day(g) * DAY_MS);
  const when = (g: G) => {
    const d = dateOf(g);
    return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  };
  const where = (g: G) => (read.site(g) === "home" ? "vs" : read.site(g) === "away" ? "@" : "N");
  const tone = (d: number | null): string => {
    if (d == null || neutral) return "var(--ink-muted)";
    const size = stat.fmt === "pct1" ? Math.abs(d) * 100 : Math.abs(d);
    if (size < (stat.fmt === "num2" ? 0.02 : 0.5)) return "var(--ink-muted)";
    return (stat.lowerBetter ? d < 0 : d > 0) ? "var(--good)" : "var(--bad)";
  };

  const groups = useMemo(() => {
    type Row = { label: string; n: number; wins: number; value: number | null };
    const row = (label: string, set: G[]): Row => ({ label, n: set.length, wins: set.filter(read.won).length, value: stat.pool(set) });
    const months: Row[] = [];
    let cur: { key: number; label: string; set: G[] } | null = null;
    for (const g of games) {
      const d = new Date(read.epochMs + read.day(g) * DAY_MS);
      const key = d.getUTCFullYear() * 12 + d.getUTCMonth();
      if (!cur || cur.key !== key) {
        if (cur) months.push(row(cur.label, cur.set));
        cur = { key, label: MONTHS[d.getUTCMonth()]!, set: [] };
      }
      cur.set.push(g);
    }
    if (cur) months.push(row(cur.label, cur.set));
    const out: Array<{ title: string; rows: Row[] }> = [
      { title: "Where", rows: [row("Home", games.filter((g) => read.site(g) === "home")), row("Away", games.filter((g) => read.site(g) === "away")), row("Neutral", games.filter((g) => read.site(g) === "neutral"))] },
      { title: "Result", rows: [row("Wins", games.filter(read.won)), row("Losses", games.filter((g) => !read.won(g)))] },
    ];
    if (read.conference) {
      const conf = read.conference;
      out.push({
        title: "Schedule",
        rows: [
          row("Conference", games.filter(conf)),
          row("Non-conference", games.filter((g) => !conf(g))),
          ...(read.ranked ? [row("vs AP top 25", games.filter(read.ranked))] : []),
        ],
      });
    }
    out.push({ title: "When", rows: [...(games.length > 10 ? [row("Last 5", games.slice(-5)), row("Last 10", games.slice(-10))] : []), ...months] });
    return out.map((gr) => ({ ...gr, rows: gr.rows.filter((r) => r.n > 0) })).filter((gr) => gr.rows.length > 0);
  }, [games, stat, read]);

  const order = useMemo(
    () =>
      games
        .map((g, i) => ({ g, i, v: values[i] ?? null }))
        .filter((x): x is { g: G; i: number; v: number } => x.v != null)
        .sort((a, b) => (stat.lowerBetter ? a.v - b.v : b.v - a.v)),
    [games, values, stat.lowerBetter],
  );
  const top = order.slice(0, 3);
  const bottom = order.slice(-3).reverse();

  /* The chart. */
  const W = 568;
  const H = 128;
  const PAD_L = 40;
  const PAD_T = 8;
  const PAD_B = 22;
  const finite = values.filter((v): v is number => v != null);
  const signed = stat.fmt === "signed1";
  const min = Math.min(...finite, whole ?? Infinity);
  const max = Math.max(...finite, whole ?? -Infinity);
  const span = max - min || 1;
  const lo = signed ? Math.min(0, min) : Math.max(min >= 0 ? 0 : -Infinity, min - span * 0.3);
  const hi = signed ? Math.max(0, max) : max + span * 0.06;
  const base = signed ? 0 : lo;
  const y = (v: number) => PAD_T + ((hi - v) / (hi - lo || 1)) * (H - PAD_T - PAD_B);
  const slot = (W - PAD_L) / Math.max(1, games.length);
  const bar = Math.max(1.5, slot - (slot > 7 ? 2.5 : 0.75));

  const shownNum = target.shown ? parseShown(stat.fmt, target.shown.value) : null;
  const adjustment = target.adjusted && shownNum != null && whole != null ? shownNum - whole : null;
  // The number clicked is what its games rebuild to: say it once, not twice.
  const agrees =
    !target.adjusted && shownNum != null && whole != null && Math.abs(shownNum - whole) < (stat.fmt === "pct1" ? 0.0006 : stat.fmt === "num2" ? 0.006 : 0.06);
  const hovered = hover != null ? games[hover] : undefined;

  return (
    <div>
      <p className="text-[12.5px] leading-snug text-ink-soft">
        {target.shown && (
          <>
            <span className="font-medium text-ink">
              {target.shown.label} {target.shown.value}
            </span>
            {target.adjusted ? " is adjusted for the schedule. " : agrees ? `, built from ${games.length} games in the log.` : " as shown. "}
          </>
        )}
        {!agrees && (
          <>
            {target.adjusted ? "The games themselves, raw: " : `Across ${games.length} games in the log: `}
            <span className="font-semibold text-ink tabular">{formatLens(stat.fmt, whole)}</span>
            {adjustment != null ? (
              <>
                , so the schedule is worth{" "}
                <span className="font-medium tabular" style={{ color: tone(adjustment) }}>
                  {diffText(stat.fmt, adjustment)}
                </span>
                .
              </>
            ) : (
              "."
            )}
          </>
        )}
      </p>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-2.5 block w-full select-none"
        role="img"
        aria-label={`${stat.label} in each of ${games.length} games`}
        onMouseLeave={() => setHover(null)}
      >
        <text x={PAD_L - 7} y={PAD_T + 8} textAnchor="end" style={{ fill: "var(--ink-muted)", fontSize: 10 }} className="tabular">
          {formatLens(stat.fmt, hi)}
        </text>
        <text x={PAD_L - 7} y={H - PAD_B} textAnchor="end" style={{ fill: "var(--ink-muted)", fontSize: 10 }} className="tabular">
          {formatLens(stat.fmt, lo)}
        </text>
        {signed && <line x1={PAD_L} x2={W} y1={y(0)} y2={y(0)} style={{ stroke: "var(--hairline)" }} />}
        {games.map((g, i) => {
          const v = values[i];
          const x = PAD_L + i * slot;
          const d = dateOf(g);
          const prev = i > 0 ? dateOf(games[i - 1]!) : null;
          const month = !prev || prev.getUTCMonth() !== d.getUTCMonth();
          const above = v != null && whole != null && (neutral ? v >= whole : stat.lowerBetter ? v < whole : v > whole);
          return (
            <g
              key={i}
              onMouseEnter={() => setHover(i)}
              onClick={(e) => onOpen(g, { newTab: e.ctrlKey || e.metaKey, side: e.shiftKey })}
              style={{ cursor: "pointer" }}
            >
              <rect x={x} y={PAD_T} width={slot} height={H - PAD_T - PAD_B + 10} style={{ fill: "transparent" }} />
              {v != null && (
                <rect
                  x={x + (slot - bar) / 2}
                  y={y(Math.max(v, base))}
                  width={bar}
                  height={Math.max(1, y(Math.min(v, base)) - y(Math.max(v, base)))}
                  rx={Math.min(2, bar / 2)}
                  style={{ fill: hover === i ? "var(--accent)" : above ? INK_ABOVE : INK_BELOW }}
                />
              )}
              <rect
                x={x + (slot - bar) / 2}
                y={H - PAD_B + 5}
                width={bar}
                height={2.5}
                style={{ fill: read.won(g) ? "var(--good)" : "var(--bad)", opacity: 0.75 }}
              />
              {month && (
                <text x={x} y={H - 2} style={{ fill: "var(--ink-muted)", fontSize: 10 }}>
                  {MONTHS[d.getUTCMonth()]}
                </text>
              )}
            </g>
          );
        })}
        {whole != null && (
          <>
            <line x1={PAD_L} x2={W} y1={y(whole)} y2={y(whole)} style={{ stroke: "var(--accent)", strokeWidth: 1.25, strokeDasharray: "4 3", pointerEvents: "none" }} />
            <text
              x={W - 2}
              y={y(whole) - 4}
              textAnchor="end"
              className="tabular"
              style={{ fill: "var(--accent)", fontSize: 10.5, fontWeight: 600, paintOrder: "stroke", stroke: "var(--card)", strokeWidth: 3, pointerEvents: "none" }}
            >
              Season {formatLens(stat.fmt, whole)}
            </text>
          </>
        )}
      </svg>

      <div className="flex h-[24px] items-center gap-2 border-b border-hairline pb-1 text-[12px]">
        {hovered !== undefined && hover != null ? (
          <>
            <span className="shrink-0 text-ink-muted tabular">{when(hovered)}</span>
            <span className="w-4 shrink-0 text-center text-ink-muted">{where(hovered)}</span>
            <TeamLogo id={read.opp(hovered).logoId} name={read.opp(hovered).name} size={14} />
            <span className="min-w-0 truncate text-ink-soft">{read.opp(hovered).name}</span>
            <span className="shrink-0 text-ink-muted">{read.line(hovered)}</span>
            <span className="ml-auto shrink-0 font-semibold text-ink tabular">{formatLens(stat.fmt, values[hover] ?? null)}</span>
          </>
        ) : (
          <span className="text-ink-muted">Point at a bar for its game; click it to open the box score.</span>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3.5">
        {groups.map((gr) => (
          <section key={gr.title} className="min-w-0">
            <h4 className="mb-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{gr.title}</h4>
            <table className="w-full text-[12px] tabular">
              <tbody>
                {gr.rows.map((r) => {
                  const d = r.value != null && whole != null ? r.value - whole : null;
                  return (
                    <tr key={r.label} className="h-[25px] border-t border-hairline/60 first:border-t-0">
                      <td className="text-ink-soft">{r.label}</td>
                      <td className="w-[46px] text-right text-ink-muted">
                        {r.wins}–{r.n - r.wins}
                      </td>
                      <td className="w-[62px] text-right font-medium text-ink">{formatLens(stat.fmt, r.value)}</td>
                      <td className="w-[46px] text-right" style={{ color: tone(d) }}>
                        {d == null ? "" : diffText(stat.fmt, d)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ))}
      </div>

      <div className="mt-3.5 grid grid-cols-2 gap-x-6">
        {[
          { title: neutral ? "Highest" : "Best games", list: top },
          { title: neutral ? "Lowest" : "Worst games", list: bottom },
        ].map(({ title, list }) => (
          <section key={title} className="min-w-0">
            <h4 className="mb-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{title}</h4>
            <ul>
              {list.map(({ g, i, v }) => {
                const o = read.opp(g);
                return (
                  <li key={i}>
                    <button
                      type="button"
                      title={`${read.line(g)}  ·  Ctrl-click for a new tab`}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setHover(i)}
                      onClick={(e) => onOpen(g, { newTab: e.ctrlKey || e.metaKey, side: e.shiftKey })}
                      className="-mx-1.5 grid h-[27px] w-[calc(100%+12px)] grid-cols-[42px_14px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-1.5 text-left text-[12px] transition-colors hover:bg-[var(--row-hover)]"
                    >
                      <span className="text-ink-muted tabular">{when(g)}</span>
                      <TeamLogo id={o.logoId} name={o.name} size={14} />
                      <span className="min-w-0 truncate text-ink-soft">
                        <span className="text-ink-muted">{where(g)} </span>
                        {o.name}
                      </span>
                      <span className="font-semibold text-ink tabular">{formatLens(stat.fmt, v)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {stat.note && <p className="mt-3 text-[11.5px] leading-relaxed text-ink-muted">{stat.note}</p>}
    </div>
  );
}
