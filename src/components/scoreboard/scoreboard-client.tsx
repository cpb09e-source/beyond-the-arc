"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { TeamLogo } from "@/components/team-logo";
import { confDisplay } from "@/lib/conf-display";
import { cn } from "@/lib/utils";
import { DatePicker } from "./date-picker";
import {
  EMPTY_SLATE, POLL_MS, dateLabel, fetchSlate, isFinal, isLive, isRanked, recordLabel, slateIsSettled, tipLabel,
  type ScoreGame, type Slate,
} from "@/lib/scoreboard";

function teamSlug(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Yesterday/today in US Eastern — the day the sport dates its schedule by. */
const ET_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
function shiftDay(d: string, days: number): string {
  return ET_DATE.format(new Date(Date.parse(`${d}T12:00:00Z`) + days * 86_400_000));
}

/** Today in US Eastern. The fallback anchor when the feed has no slate at all. */
function todayEastern(): string {
  return ET_DATE.format(new Date());
}

export function ScoreboardClient() {
  // ?date=YYYY-MM-DD makes a given day linkable — "here's the night Duke lost"
  // — and is what the stepper writes as you move through days.
  const search = useSearchParams();
  const router = useRouter();
  const fromUrl = search.get("date");
  const pinned = fromUrl && /^\d{4}-\d{2}-\d{2}$/.test(fromUrl) ? fromUrl : null;
  const setPinned = (d: string | null) => {
    router.replace(d ? `/scoreboard?date=${d}` : "/scoreboard", { scroll: false });
  };
  // The result carries the request it answers. Loading is then DERIVED from
  // "what we hold doesn't match what we're asking for", rather than a second
  // state set synchronously inside the effect — which would trip
  // react-hooks/set-state-in-effect and cause a cascading render on every day
  // change.
  const [result, setResult] = useState<{ key: string; slate: Slate } | null>(null);
  const key = pinned ?? "latest";
  const loading = result?.key !== key;
  const slate = result?.key === key ? result.slate : EMPTY_SLATE;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ctrl = new AbortController();
    const requested = pinned ?? "latest";
    const tick = async () => {
      const next = await fetchSlate(pinned ?? undefined, ctrl.signal);
      if (cancelled) return;
      setResult({ key: requested, slate: next });
      // Only a live day is worth re-polling — a pinned past day cannot change.
      if (!pinned && !slateIsSettled(next)) timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => { cancelled = true; ctrl.abort(); if (timer) clearTimeout(timer); };
  }, [pinned]);

  // Falls back to today so the stepper ALWAYS renders. Without this an empty
  // slate left `shown` null, the stepper was hidden, and the offseason page had
  // no way to reach a day that actually has games — a dead end.
  const shown = pinned ?? slate.date ?? todayEastern();

  // Conference filter. Every conference with a game today, plus the
  // non-conference bucket; "" means show everything.
  const [conf, setConf] = useState("");
  const confOptions = useMemo(() => {
    const set = new Set<string>();
    for (const g of slate.games) {
      if (g.home.conference) set.add(confDisplay(g.home.conference));
      if (g.away.conference) set.add(confDisplay(g.away.conference));
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [slate.games]);
  // Matches on EITHER side, so picking the Big Ten keeps a Big Ten team's
  // non-conference game — the thing a reader following that league wants.
  const inConf = (g: ScoreGame) =>
    !conf ||
    (g.home.conference && confDisplay(g.home.conference) === conf) ||
    (g.away.conference && confDisplay(g.away.conference) === conf);

  // Conference games group under their own conference; everything else is
  // non-conference. Sorted by tip so the page reads down the evening.
  const groups = useMemo(() => {
    const m = new Map<string, ScoreGame[]>();
    for (const g of slate.games) {
      if (!inConf(g)) continue;
      const key = g.conferenceGame && g.home.conference ? confDisplay(g.home.conference) : "Non-conference";
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(g);
    }
    for (const list of m.values()) list.sort((a, b) => a.startDate.localeCompare(b.startDate));
    return [...m.entries()].sort((a, b) =>
      a[0] === "Non-conference" ? 1 : b[0] === "Non-conference" ? -1 : a[0].localeCompare(b[0]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slate.games, conf]);

  // Games with an AP Top 25 side, in the order the function ranked them (best
  // matchup first). They ALSO stay in their conference group below — a reader
  // scanning the Big Ten should not find a hole where the ranked game was.
  const ranked = useMemo(() => slate.games.filter(isRanked), [slate.games]);


  const liveCount = slate.games.filter(isLive).length;

  return (
    <div className="mx-auto max-w-7xl px-6 lg:px-10 pt-6 pb-20">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
        <div>
          <div className="text-[0.6rem] uppercase tracking-[0.18em] text-coral font-bold mb-1.5 flex items-center gap-2">
            <span className="h-px w-6 bg-coral" />
            {slate.source === "live" && liveCount > 0
              ? `${liveCount} game${liveCount === 1 ? "" : "s"} in progress`
              : "Scoreboard"}
          </div>
          <h1 className="font-display text-4xl lg:text-5xl text-ink leading-none tracking-tight">
            {dateLabel(shown)}
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            {loading
              ? "Loading…"
              : slate.games.length === 0
              ? "No games on this date."
              : `${slate.games.length} game${slate.games.length === 1 ? "" : "s"}${
                  slate.source === "live" ? " · updating every minute" : ""
                }`}
          </p>
        </div>

        {/* Jump straight to a date. A native date input is deliberate: it gives
            the platform's own calendar, keyboard entry, and localisation for
            free, and on a phone it opens the OS picker — all things a
            hand-rolled calendar would have to reimplement worse. */}
        <div className="flex items-center gap-2">
          <span className="text-[0.6rem] uppercase tracking-[0.12em] font-semibold text-ink-muted">Jump to</span>
          <DatePicker value={shown} onChange={setPinned} />
        </div>
      </div>

      {/* Week strip: the shown day centred, three either side, arrows stepping a
          week at a time. Gives the whole week at a glance and makes "the night
          before" one tap instead of a round trip through the picker. */}
      <WeekStrip shown={shown} onPick={setPinned} />

      {confOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-6">
          <span className="text-[0.6rem] uppercase tracking-[0.12em] font-semibold text-ink-muted">Conference</span>
          <select
            value={conf}
            onChange={(e) => setConf(e.target.value)}
            aria-label="Filter by conference"
            className="h-9 px-2.5 rounded-md border border-ink/15 bg-card text-ink text-base sm:text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-coral/40"
          >
            <option value="">All conferences</option>
            {confOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          {conf && (
            <button type="button" onClick={() => setConf("")} className="text-xs text-coral hover:underline">
              Clear
            </button>
          )}
        </div>
      )}

      {!loading && slate.games.length === 0 && (
        <div className="bg-card border border-ink/10 rounded-xl px-6 py-12 text-center">
          <p className="text-ink-soft">Nothing scheduled.</p>
          <p className="mt-1.5 text-xs text-ink-muted">
            College basketball runs November through April. Step back a day, or check the{" "}
            <Link href="/" className="text-coral hover:underline">team explorer</Link> in the meantime.
          </p>
        </div>
      )}

      {ranked.filter(inConf).length > 0 && (
        <section className="mb-8">
          <h2 className="text-[0.62rem] uppercase tracking-[0.16em] font-bold text-coral mb-2.5 flex items-center gap-2">
            Top 25
            <span className="h-px flex-1 bg-coral/25" />
            <span className="text-coral/70 font-medium tabular">{ranked.filter(inConf).length}</span>
          </h2>
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {ranked.filter(inConf).map((g) => <GameCard key={`r-${g.id}`} g={g} />)}
          </div>
        </section>
      )}

      <div className="space-y-7">
        {groups.map(([conf, games]) => (
          <section key={conf}>
            <h2 className="text-[0.62rem] uppercase tracking-[0.16em] font-bold text-ink-muted mb-2.5 flex items-center gap-2">
              {conf}
              <span className="h-px flex-1 bg-hairline" />
              <span className="text-ink-muted/70 font-medium tabular">{games.length}</span>
            </h2>
            <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {games.map((g) => <GameCard key={g.id} g={g} />)}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/**
 * Seven days with `shown` in the middle, arrows stepping a whole week.
 *
 * Centred rather than trailing so both directions are always one tap: during
 * the season you move backwards to last night and forwards to check a
 * scheduled slate, and a strip that only looked back would make half of that a
 * trip through the date picker.
 */
function WeekStrip({ shown, onPick }: { shown: string; onPick: (d: string) => void }) {
  const days = [-3, -2, -1, 0, 1, 2, 3].map((n) => shiftDay(shown, n));
  const today = todayEastern();
  return (
    <div className="flex items-stretch gap-1 mb-6">
      <StripArrow label="Previous week" onClick={() => onPick(shiftDay(shown, -7))}>‹</StripArrow>
      <div className="flex-1 grid grid-cols-7 gap-1">
        {days.map((d) => {
          const active = d === shown;
          return (
            <button
              key={d}
              type="button"
              onClick={() => onPick(d)}
              aria-current={active ? "date" : undefined}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 rounded-md border py-2 transition-colors min-h-14",
                active
                  ? "border-coral bg-coral/8 text-ink"
                  : "border-ink/10 text-ink-muted hover:border-ink/25 hover:text-ink",
              )}
            >
              <span className="text-[0.55rem] uppercase tracking-[0.12em] font-semibold">{dowLabel(d)}</span>
              <span className={cn("text-sm tabular leading-none", active && "font-bold")}>{dayNum(d)}</span>
              {/* A quiet marker for the real today, so a reader three weeks deep
                  in February still knows where the present is. */}
              {d === today && <span className="h-1 w-1 rounded-full bg-coral" aria-label="today" />}
            </button>
          );
        })}
      </div>
      <StripArrow label="Next week" onClick={() => onPick(shiftDay(shown, 7))}>›</StripArrow>
    </div>
  );
}

function StripArrow({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="shrink-0 w-9 rounded-md border border-ink/10 text-ink-muted hover:text-coral hover:border-coral/40 transition-colors text-lg leading-none"
    >
      {children}
    </button>
  );
}

const DOW = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" });
function dowLabel(d: string): string {
  return DOW.format(new Date(`${d}T12:00:00Z`));
}
function dayNum(d: string): string {
  return String(Number(d.slice(8, 10)));
}

function GameCard({ g }: { g: ScoreGame }) {
  const live = isLive(g);
  const final = isFinal(g);
  // Halves only once they exist. A scheduled game has none, and a live first
  // half has one — showing an empty "2H" column would read as a 0.
  const halves = Math.max(g.home.periods.length, g.away.periods.length);
  return (
    <div className={cn(
      "bg-card border rounded-xl px-3.5 py-3 transition-colors",
      live ? "border-coral/40 ring-1 ring-coral/15" : "border-ink/10",
    )}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[0.58rem] uppercase tracking-[0.12em] font-semibold text-ink-muted truncate">
          {g.neutralSite ? "Neutral site" : g.venue ?? ""}
        </span>
        <span className={cn(
          "shrink-0 text-[0.58rem] uppercase tracking-[0.12em] font-bold tabular",
          live ? "text-coral" : "text-ink-muted",
        )}>
          {live ? `${g.clock ?? "Live"}${g.period != null ? ` · ${ordinalPeriod(g.period)}` : ""}`
            : final ? "Final" : tipLabel(g.startDate)}
        </span>
      </div>

      {/* Column heads only when there are halves to label. */}
      {halves > 0 && (
        <div className="flex items-center gap-2 pb-1 text-[0.5rem] uppercase tracking-[0.1em] font-bold text-ink-muted/70">
          <span className="flex-1" />
          {periodLabels(halves).map((p) => <span key={p} className="w-6 text-center">{p}</span>)}
          <span className="w-8 text-right">T</span>
        </div>
      )}

      <TeamRow t={g.away} final={final} halves={halves} side="away" />
      <TeamRow t={g.home} final={final} halves={halves} side="home" />
    </div>
  );
}

/** ["1H","2H","OT","2OT"] for however many periods were played. */
function periodLabels(n: number): string[] {
  return Array.from({ length: n }, (_, i) => (i === 0 ? "1H" : i === 1 ? "2H" : i === 2 ? "OT" : `${i - 1}OT`));
}

function TeamRow({ t, final, halves, side }: { t: ScoreGame["home"]; final: boolean; halves: number; side: "home" | "away" }) {
  const won = final && t.winner === true;
  const rec = recordLabel(t);
  return (
    <div className="flex items-center gap-2 py-1">
      {/* "@" marks the road team, the way a schedule is written. The home team
          carries no glyph — the absence IS the signal, and two marks would make
          the reader work out which is which. */}
      <span className="w-2 shrink-0 text-[0.6rem] text-ink-muted/70 tabular">{side === "away" ? "@" : ""}</span>
      <TeamLogo name={t.team} size={20} />
      {t.rank != null ? <RankBadge rank={t.rank} /> : t.seed != null ? (
        <span className="text-[0.6rem] text-ink-muted tabular">{t.seed}</span>
      ) : null}
      <Link
        href={`/teams/${teamSlug(t.team)}`}
        className={cn("min-w-0 truncate text-sm hover:text-coral transition-colors", won ? "text-ink font-semibold" : "text-ink-soft")}
      >
        {t.team}
      </Link>
      {rec && <span className="shrink-0 text-[0.6rem] text-ink-muted tabular">({rec})</span>}

      {halves > 0 && (
        <span className="ml-auto flex items-center gap-2">
          {Array.from({ length: halves }, (_, i) => (
            <span key={i} className="w-6 text-center text-[0.7rem] tabular text-ink-muted">
              {t.periods[i] ?? "—"}
            </span>
          ))}
          <span className={cn("w-8 text-right tabular text-base", won ? "text-ink font-bold" : "text-ink-muted")}>
            {t.points ?? "—"}
          </span>
        </span>
      )}
      {halves === 0 && (
        <span className={cn("ml-auto tabular text-base", won ? "text-ink font-bold" : "text-ink-muted")}>
          {t.points ?? "—"}
        </span>
      )}
    </div>
  );
}

/**
 * AP rank as a filled chip rather than a bare numeral. At 10px next to a logo
 * and a team name, a loose "4" reads as part of the score; a solid accent block
 * reads as a rank at a glance, which is the whole point of surfacing it.
 */
function RankBadge({ rank }: { rank: number }) {
  return (
    <span className="shrink-0 inline-flex items-center justify-center min-w-5 h-5 px-1 rounded bg-coral text-white text-[0.62rem] font-bold tabular leading-none">
      {rank}
    </span>
  );
}

/** "2nd" / "OT" / "2OT" — college basketball plays two halves, then overtimes. */
function ordinalPeriod(p: number): string {
  if (p <= 1) return "1st";
  if (p === 2) return "2nd";
  return p === 3 ? "OT" : `${p - 2}OT`;
}
