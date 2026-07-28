"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { TeamLogo } from "@/components/team-logo";
import { confDisplay } from "@/lib/conf-display";
import { cn } from "@/lib/utils";
import {
  EMPTY_SLATE, POLL_MS, dateLabel, fetchSlate, isFinal, isLive, slateIsSettled, tipLabel,
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

  // Conference games group under their own conference; everything else is
  // non-conference. Sorted by tip so the page reads down the evening.
  const groups = useMemo(() => {
    const m = new Map<string, ScoreGame[]>();
    for (const g of slate.games) {
      const key = g.conferenceGame && g.home.conference ? confDisplay(g.home.conference) : "Non-conference";
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(g);
    }
    for (const list of m.values()) list.sort((a, b) => a.startDate.localeCompare(b.startDate));
    return [...m.entries()].sort((a, b) =>
      a[0] === "Non-conference" ? 1 : b[0] === "Non-conference" ? -1 : a[0].localeCompare(b[0]));
  }, [slate.games]);

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

        {/* Day stepper — always available, see `shown` above. */}
        <div className="flex items-center gap-1.5">
          <DayButton label="‹ Prev" onClick={() => setPinned(shiftDay(shown, -1))} />
          {pinned && <DayButton label="Latest" onClick={() => setPinned(null)} accent />}
          <DayButton label="Next ›" onClick={() => setPinned(shiftDay(shown, 1))} />
        </div>
      </div>

      {!loading && slate.games.length === 0 && (
        <div className="bg-card border border-ink/10 rounded-xl px-6 py-12 text-center">
          <p className="text-ink-soft">Nothing scheduled.</p>
          <p className="mt-1.5 text-xs text-ink-muted">
            College basketball runs November through April. Step back a day, or check the{" "}
            <Link href="/" className="text-coral hover:underline">team explorer</Link> in the meantime.
          </p>
        </div>
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

function DayButton({ label, onClick, accent }: { label: string; onClick: () => void; accent?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "min-h-11 sm:min-h-0 px-3 py-2 rounded-md border text-xs font-medium transition-colors",
        accent
          ? "border-coral/40 bg-coral/6 text-coral hover:bg-coral/10"
          : "border-ink/15 text-ink-muted hover:text-ink hover:border-ink/25",
      )}
    >
      {label}
    </button>
  );
}

function GameCard({ g }: { g: ScoreGame }) {
  const live = isLive(g);
  const final = isFinal(g);
  return (
    <div className={cn(
      "bg-card border rounded-xl px-3.5 py-3 transition-colors",
      live ? "border-coral/40 ring-1 ring-coral/15" : "border-ink/10",
    )}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[0.58rem] uppercase tracking-[0.12em] font-semibold text-ink-muted truncate">
          {g.neutralSite ? "Neutral" : g.venue ?? ""}
        </span>
        <span className={cn(
          "shrink-0 text-[0.58rem] uppercase tracking-[0.12em] font-bold tabular",
          live ? "text-coral" : "text-ink-muted",
        )}>
          {live ? `${g.clock ?? "Live"}${g.period != null ? ` · ${g.period <= 2 ? (g.period === 1 ? "1st" : "2nd") : "OT"}` : ""}`
            : final ? "Final" : tipLabel(g.startDate)}
        </span>
      </div>
      <TeamRow t={g.away} final={final} />
      <TeamRow t={g.home} final={final} />
    </div>
  );
}

function TeamRow({ t, final }: { t: ScoreGame["home"]; final: boolean }) {
  const won = final && t.winner === true;
  return (
    <div className="flex items-center gap-2 py-1">
      <TeamLogo name={t.team} size={20} />
      {t.seed != null && <span className="text-[0.6rem] text-ink-muted tabular w-3 text-right">{t.seed}</span>}
      <Link
        href={`/teams/${teamSlug(t.team)}`}
        className={cn("min-w-0 truncate text-sm hover:text-coral transition-colors", won ? "text-ink font-semibold" : "text-ink-soft")}
      >
        {t.team}
      </Link>
      <span className={cn("ml-auto tabular text-base", won ? "text-ink font-bold" : "text-ink-muted")}>
        {t.points ?? "—"}
      </span>
    </div>
  );
}
