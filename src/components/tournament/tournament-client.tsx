"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { Select } from "@/components/select";
import {
  DIFF_CAP, POLL_MS, dayLabel, diffLabel, fetchTournament, groupIsComplete, involves, isFinal, isLive,
  resolveSide, standings, streak, timeLabel, tournamentIsSettled,
  type Game, type Resolved, type Team, type TeamRow, type Tournament,
} from "@/lib/tournament";

/**
 * The tournament page. Four tabs — Schedule, Standings, Bracket, Teams — over
 * one feed, with the coach's own team picked out on every one of them.
 *
 * THE TABS ARE THE HASH. #standings is a link someone can send from the bench
 * and it is what the back button understands, so the active tab is read from
 * window.location.hash through useSyncExternalStore rather than held in state.
 * The tab strip is plain <a href="#…"> for the reason team-tabs.tsx documents:
 * Next's Link routes through pushState, which does not fire hashchange.
 *
 * "YOUR TEAM" IS A CONTROL, NOT A CONSTANT. It defaults to the team the feed
 * names and can be switched, because the same page is useful to a parent on
 * another bench — and because the highlight is the whole point of the page,
 * it should be possible to point it at anyone.
 */

const TABS = [
  { key: "schedule", label: "Schedule" },
  { key: "standings", label: "Standings" },
  { key: "bracket", label: "Bracket" },
  { key: "teams", label: "Teams" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const readTab = (): Tab => {
  const h = window.location.hash.replace(/^#/, "");
  return (TABS.some((t) => t.key === h) ? h : "schedule") as Tab;
};
const subscribeHash = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};

export function TournamentClient({ slug, seed = null }: { slug: string; seed?: Tournament | null }) {
  const tab = useSyncExternalStore(subscribeHash, readTab, () => "schedule" as Tab);

  // The last good payload and when it arrived. Loading and failure are derived
  // rather than set inside the effect body, which keeps the hooks lint quiet
  // and avoids a second render per tick.
  const [live, setLive] = useState<{ data: Tournament; at: number } | null>(null);
  const [failedAt, setFailedAt] = useState<number | null>(null);
  const data = live?.data ?? seed;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ctrl = new AbortController();
    const tick = async () => {
      try {
        const next = await fetchTournament(slug, ctrl.signal);
        if (cancelled) return;
        setLive({ data: next, at: Date.now() });
        setFailedAt(null);
        // Nothing left to change once every game is final.
        if (!tournamentIsSettled(next)) timer = setTimeout(tick, POLL_MS);
      } catch {
        if (cancelled) return;
        setFailedAt(Date.now());
        timer = setTimeout(tick, POLL_MS * 2);
      }
    };
    void tick();
    return () => { cancelled = true; ctrl.abort(); if (timer) clearTimeout(timer); };
  }, [slug]);

  // A clock for "updated 40s ago". Ticks on its own schedule so the label moves
  // between polls.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  const [teamName, setTeamName] = useState<string | null>(null);
  const me = useMemo(() => {
    if (!data) return null;
    const want = teamName ?? data.ourTeam;
    return data.teams.find((t) => t.name === want) ?? data.teams.find((t) => t.name === data.ourTeam) ?? null;
  }, [data, teamName]);

  if (!data) {
    return (
      <div className="mx-auto max-w-[88rem] px-6 lg:px-10 pt-6 pb-20">
        <h1 className="font-display text-3xl lg:text-4xl text-ink">Tournament</h1>
        <p className="mt-3 text-sm text-ink-muted">
          {failedAt ? "The schedule feed isn't answering. Retrying." : "Loading the schedule…"}
        </p>
      </div>
    );
  }

  const table = standings(data);
  const liveCount = data.games.filter(isLive).length;
  const finalCount = data.games.filter(isFinal).length;

  return (
    <div className="mx-auto max-w-[88rem] px-6 lg:px-10 pt-6 pb-20">
      {/* ---------------------------------------------------------- header */}
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-widest text-coral font-medium">{data.event.name}</div>
          <h1 className="mt-1 font-display text-3xl lg:text-4xl text-ink leading-none">
            {me?.name ?? data.ourTeam}
            <span className="text-ink-muted font-normal"> · {data.event.division}</span>
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            {data.event.venue.name}
            {data.event.venue.address && (
              <>
                {" · "}
                <a
                  className="underline decoration-hairline underline-offset-2 hover:text-ink transition-colors"
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(data.event.venue.address)}`}
                  target="_blank" rel="noreferrer"
                >
                  {shortAddress(data.event.venue.address)}
                </a>
              </>
            )}
            {" · "}{data.teams.length} teams · {dateSpan(data.games)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <FeedStatus live={live?.at ?? null} failedAt={failedAt} now={now} liveCount={liveCount} finalCount={finalCount} total={data.games.length} />
          <label className="flex items-center gap-2">
            <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">Your team</span>
            <Select value={me?.name ?? data.ourTeam} onChange={setTeamName} ariaLabel="Which team to highlight" compact className="w-40">
              {data.teams.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
            </Select>
          </label>
        </div>
      </header>

      {/* ------------------------------------------------------------ tabs */}
      <nav aria-label="Tournament sections" className="mt-6">
        <ul className="inline-flex items-center gap-[2px] rounded-[10px] border border-hairline bg-paper-deep p-[3px]">
          {TABS.map((t) => {
            const active = t.key === tab;
            return (
              <li key={t.key}>
                <a
                  href={`#${t.key}`}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center h-8 px-3 rounded-md border text-sm whitespace-nowrap transition-colors",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-coral/40",
                    active
                      ? "border-hairline bg-card font-semibold text-coral shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                      : "border-transparent font-medium text-ink-muted hover:text-ink hover:bg-coral/8",
                  )}
                >
                  {t.label}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mt-6">
        {tab === "schedule" && <Schedule data={data} me={me} />}
        {tab === "standings" && <Standings data={data} table={table} me={me} />}
        {tab === "bracket" && <Bracket data={data} table={table} me={me} />}
        {tab === "teams" && <Teams data={data} me={me} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ feed status */

function FeedStatus({
  live, failedAt, now, liveCount, finalCount, total,
}: { live: number | null; failedAt: number | null; now: number; liveCount: number; finalCount: number; total: number }) {
  const ago = live ? Math.max(0, Math.round((now - live) / 1000)) : null;
  const agoText = ago === null ? null : ago < 60 ? `${ago}s ago` : `${Math.round(ago / 60)}m ago`;
  return (
    <div className="flex items-center gap-2 text-xs text-ink-muted tabular">
      {liveCount > 0 && (
        <span className="inline-flex items-center gap-1.5 rounded-md border border-bad/40 bg-bad/10 px-2 py-1 font-semibold text-bad">
          <span className="h-1.5 w-1.5 rounded-full bg-bad animate-pulse" />
          {liveCount} live
        </span>
      )}
      <span className="rounded-md border border-hairline bg-paper-deep/60 px-2 py-1">
        {finalCount}/{total} final
      </span>
      {failedAt && !live ? (
        <span className="text-bad">feed unreachable</span>
      ) : failedAt ? (
        <span className="text-bad">feed stalled · showing {agoText}</span>
      ) : agoText ? (
        <span>updated {agoText}</span>
      ) : (
        <span>connecting…</span>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- schedule */

function Schedule({ data, me }: { data: Tournament; me: Team | null }) {
  const [mineOnly, setMineOnly] = useState(true);
  const shown = mineOnly && me ? data.games.filter((g) => involves(g, me) || isPlayoffFor(g, me, data)) : data.games;
  const days = [...new Set(shown.map((g) => g.date))].sort();
  const nextUp = me ? data.games.find((g) => involves(g, me) && g.status !== "final") : undefined;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-[2px] rounded-[10px] border border-hairline bg-paper-deep p-[3px]">
          <Toggle on={mineOnly} onClick={() => setMineOnly(true)}>{me?.name ?? "My"} games</Toggle>
          <Toggle on={!mineOnly} onClick={() => setMineOnly(false)}>All games</Toggle>
        </div>
        <span className="text-xs text-ink-muted tabular">{shown.length} game{shown.length === 1 ? "" : "s"}</span>
      </div>

      {nextUp && me && (
        <NextUp g={nextUp} me={me} />
      )}

      {days.map((day) => (
        <section key={day}>
          <h2 className="mb-2.5 text-xs uppercase tracking-widest text-coral font-medium">{dayLabel(day)}</h2>
          <div className="rounded-xl border border-hairline bg-paper-deep/25 shadow-sm px-5 lg:px-6 divide-y divide-hairline/40">
            {shown.filter((g) => g.date === day).map((g) => <GameRow key={g.id} g={g} me={me} data={data} />)}
          </div>
        </section>
      ))}

      {shown.length === 0 && (
        <p className="text-sm text-ink-muted">No games to show.</p>
      )}
    </div>
  );
}

/**
 * A playoff game is "mine" when a projected or settled side is my team — so
 * the bracket path a coach is on course for shows up in "my games" before it
 * is official, marked as projected.
 */
function isPlayoffFor(g: Game, me: Team, data: Tournament): boolean {
  if (g.stage !== "playoff") return false;
  const table = standings(data);
  const done = groupIsComplete(data);
  return [g.a, g.b].some((s) => resolveSide(s, data, table, done).team?.id === me.id);
}

function NextUp({ g, me }: { g: Game; me: Team }) {
  const opp = g.a.teamId === me.id ? g.b : g.a;
  return (
    <div className="rounded-xl border border-coral/40 bg-coral/8 px-5 py-4 flex flex-wrap items-center gap-x-6 gap-y-2">
      <div>
        <div className="text-[0.6rem] uppercase tracking-widest text-coral font-medium">{isLive(g) ? "Now playing" : "Next up"}</div>
        <div className="mt-0.5 font-display text-2xl text-ink leading-tight">
          vs {opp.name}
        </div>
      </div>
      <div className="text-sm text-ink-soft tabular">
        {dayLabel(g.date)} · {timeLabel(g.time)}{g.court ? ` · ${g.court}` : ""}
      </div>
      <div className="text-xs text-ink-muted">{g.name}</div>
    </div>
  );
}

function GameRow({ g, me, data }: { g: Game; me: Team | null; data: Tournament }) {
  const mine = me ? involves(g, me) : false;
  const done = g.status === "final";
  const aWon = done && g.winnerTeamId !== null && g.winnerTeamId === g.a.teamId;
  const bWon = done && g.winnerTeamId !== null && g.winnerTeamId === g.b.teamId;
  const table = g.stage === "playoff" ? standings(data) : null;
  const complete = g.stage === "playoff" ? groupIsComplete(data) : false;
  const ra = table ? resolveSide(g.a, data, table, complete) : null;
  const rb = table ? resolveSide(g.b, data, table, complete) : null;

  return (
    <div
      className={cn(
        "grid grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-4 py-3",
        mine && "-mx-5 lg:-mx-6 px-5 lg:px-6 bg-coral/8 border-l-2 border-coral",
      )}
    >
      <div className="tabular">
        <div className="text-sm font-medium text-ink">{timeLabel(g.time)}</div>
        <StatusTag g={g} />
      </div>
      <div className="min-w-0 flex flex-col gap-1">
        <ScoreLine side={g.a} resolved={ra} score={g.scoreA} won={aWon} lost={bWon} me={me} />
        <ScoreLine side={g.b} resolved={rb} score={g.scoreB} won={bWon} lost={aWon} me={me} />
      </div>
      <div className="flex flex-col items-end gap-1 text-right">
        {g.court && <span className="rounded-md border border-hairline bg-paper-deep/60 px-2 py-0.5 text-[0.65rem] text-ink-soft whitespace-nowrap">{g.court}</span>}
        <span className="text-[0.65rem] text-ink-muted whitespace-nowrap">{g.name}</span>
      </div>
    </div>
  );
}

function ScoreLine({
  side, resolved, score, won, lost, me,
}: { side: Game["a"]; resolved: Resolved | null; score: number | null; won: boolean; lost: boolean; me: Team | null }) {
  const name = resolved ? resolved.name : side.name;
  const projected = resolved?.state === "projected";
  const isMe = me ? (side.teamId === me.id || resolved?.team?.id === me.id) : false;
  return (
    <div className={cn("flex items-center gap-2 text-sm", lost ? "text-ink-muted" : "text-ink", won && "font-semibold")}>
      <span className={cn("truncate", projected && "italic text-ink-soft", isMe && "text-coral")}>{name}</span>
      {isMe && <YouTag />}
      {projected && <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted">proj.</span>}
      <span className="ml-auto tabular font-medium w-8 text-right">{score === null ? "" : score}</span>
    </div>
  );
}

function StatusTag({ g }: { g: Game }) {
  if (g.status === "live") {
    return (
      <div className="mt-0.5 inline-flex items-center gap-1 text-[0.6rem] uppercase tracking-widest font-semibold text-bad">
        <span className="h-1.5 w-1.5 rounded-full bg-bad animate-pulse" />Live
      </div>
    );
  }
  if (g.status === "final") return <div className="mt-0.5 text-[0.6rem] uppercase tracking-widest font-medium text-ink-muted">Final</div>;
  return null;
}

function YouTag() {
  return (
    <span className="rounded border border-coral/60 bg-coral/10 px-1.5 py-px text-[0.55rem] font-bold uppercase tracking-widest text-coral leading-tight">
      You
    </span>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "h-7 px-3 rounded-md border text-xs whitespace-nowrap transition-colors",
        on ? "border-hairline bg-card font-semibold text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "border-transparent font-medium text-ink-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------- standings */

function Standings({ data, table, me }: { data: Tournament; table: TeamRow[]; me: Team | null }) {
  const played = table.some((r) => r.gp > 0);
  const complete = groupIsComplete(data);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-xs uppercase tracking-widest text-coral font-medium">
          {data.event.group} · {data.teams.length} teams · {complete ? "final" : played ? "in progress" : "not started"}
        </h2>
        <span className="text-xs text-ink-muted">
          ranked by win % → point diff (each game capped ±{DIFF_CAP})
        </span>
      </div>
      <div className="rounded-xl border border-hairline bg-paper-deep/25 shadow-sm px-5 lg:px-6 overflow-x-auto">
        <table className="w-full border-collapse tabular text-sm">
          <thead>
            <tr className="text-[0.6rem] uppercase tracking-widest text-ink-muted">
              <th className="py-2.5 pr-2 text-left font-medium w-8">#</th>
              <th className="py-2.5 text-left font-medium">Team</th>
              {["GP", "W–L", "PF", "PA", "Diff", "Strk"].map((h) => (
                <th key={h} className="py-2.5 pl-3 text-right font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline/40">
            {table.map((r, i) => {
              const mine = me?.id === r.team.id;
              const sk = streak(data, r.team);
              const seedNote = i === 0 ? "bye" : null;
              return (
                <tr key={r.team.id} className={cn(mine && "bg-coral/8")}>
                  <td className={cn("py-2.5 pr-2 text-xs", i === 0 ? "text-gold font-semibold" : "text-ink-muted")}>{i + 1}</td>
                  <td className={cn("py-2.5 font-medium", mine ? "text-coral" : "text-ink")}>
                    <span className="inline-flex items-center gap-2">
                      {r.team.name}
                      {mine && <YouTag />}
                      {seedNote && played && (
                        <span className="text-[0.6rem] uppercase tracking-widest text-gold font-medium">{seedNote}</span>
                      )}
                    </span>
                  </td>
                  <td className="py-2.5 pl-3 text-right">{r.gp}</td>
                  <td className="py-2.5 pl-3 text-right">{r.w}–{r.l}</td>
                  <td className="py-2.5 pl-3 text-right">{r.gp ? r.pf : "—"}</td>
                  <td className="py-2.5 pl-3 text-right">{r.gp ? r.pa : "—"}</td>
                  <td className={cn("py-2.5 pl-3 text-right", r.diff > 0 && "text-good", r.diff < 0 && "text-bad")}>
                    {r.gp ? diffLabel(r.diff) : "—"}
                    {r.gp > 0 && r.rawDiff !== r.diff && (
                      <span className="ml-1 text-[0.65rem] text-ink-muted" title="uncapped">({diffLabel(r.rawDiff)})</span>
                    )}
                  </td>
                  <td className={cn("py-2.5 pl-3 text-right font-semibold", sk.kind === "w" ? "text-good" : sk.kind === "l" ? "text-bad" : "text-ink-muted")}>{sk.text}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-muted">
        One group of {data.teams.length}; each team plays four. All seven advance — seed 1 goes straight to the semi-finals,
        seeds 2–7 play Round 1 on Sunday morning. Tiebreaks per the NAIG rulebook: win %, then point differential with
        each game&rsquo;s margin capped at ±{DIFF_CAP}; a forfeit is 30–0. Where the capped and raw differentials differ,
        the raw figure is shown in brackets.
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- bracket */

function Bracket({ data, table, me }: { data: Tournament; table: TeamRow[]; me: Team | null }) {
  const complete = groupIsComplete(data);
  const played = table.some((r) => r.gp > 0);
  const rounds = ["Round 1", "Semi-Finals", "Final"]
    .map((name) => ({ name, games: data.games.filter((g) => g.stage === "playoff" && g.round === name) }))
    .filter((r) => r.games.length > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-xs uppercase tracking-widest text-coral font-medium">
          Playoffs · Sunday · {complete ? "seeded" : played ? "projected from the table" : "seeds open"}
        </h2>
        <span className="text-xs text-ink-muted">
          italics are projections — they move as the group plays out
        </span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 lg:gap-6">
        {rounds.map((r) => (
          <section key={r.name}>
            <h3 className="mb-2.5 text-xs uppercase tracking-widest text-ink-muted font-medium">{r.name}</h3>
            <div className="flex flex-col gap-3">
              {r.games.map((g) => (
                <BracketCard key={g.id} g={g} data={data} table={table} complete={complete} me={me} isFinal={r.name === "Final"} />
              ))}
            </div>
          </section>
        ))}
      </div>
      <p className="text-xs text-ink-muted">
        Format from the organiser: 7 teams, one group, four games each. Seed 1 byes to a semi-final; 4 v 5, 2 v 7 and
        3 v 6 play Round 1. Times and courts are as published on Naismaili Games and will be corrected there first.
      </p>
    </div>
  );
}

function BracketCard({
  g, data, table, complete, me, isFinal: final,
}: { g: Game; data: Tournament; table: TeamRow[]; complete: boolean; me: Team | null; isFinal: boolean }) {
  const a = resolveSide(g.a, data, table, complete);
  const b = resolveSide(g.b, data, table, complete);
  const mine = me ? [a, b].some((s) => s.team?.id === me.id) : false;
  const done = g.status === "final";
  return (
    <div
      className={cn(
        "rounded-xl border bg-paper-deep/25 shadow-sm px-4 py-3",
        mine ? "border-coral/60" : "border-hairline",
        final && "border-gold/60",
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className={cn("text-[0.65rem] uppercase tracking-widest font-medium", final ? "text-gold" : "text-coral")}>
          {final ? "🏆 Final" : g.name}
        </span>
        <span className="text-[0.65rem] text-ink-muted tabular whitespace-nowrap">
          {dayLabel(g.date).split(",")[0]} · {timeLabel(g.time)}{g.court ? ` · ${g.court}` : ""}
        </span>
      </div>
      <div className="mt-2 flex flex-col gap-1">
        <BracketSide r={a} score={g.scoreA} won={done && g.winnerTeamId === g.a.teamId} lost={done && g.winnerTeamId === g.b.teamId} me={me} />
        <BracketSide r={b} score={g.scoreB} won={done && g.winnerTeamId === g.b.teamId} lost={done && g.winnerTeamId === g.a.teamId} me={me} />
      </div>
      {g.status === "live" && (
        <div className="mt-2 inline-flex items-center gap-1 text-[0.6rem] uppercase tracking-widest font-semibold text-bad">
          <span className="h-1.5 w-1.5 rounded-full bg-bad animate-pulse" />Live
        </div>
      )}
    </div>
  );
}

function BracketSide({ r, score, won, lost, me }: { r: Resolved; score: number | null; won: boolean; lost: boolean; me: Team | null }) {
  const isMe = me ? r.team?.id === me.id : false;
  return (
    <div className={cn("flex items-center gap-2 text-sm", lost ? "text-ink-muted" : "text-ink", won && "font-semibold")}>
      <span
        className={cn(
          "truncate",
          r.state === "projected" && "italic text-ink-soft",
          r.state === "open" && "text-ink-muted",
          isMe && "text-coral",
        )}
        title={r.slot}
      >
        {r.name}
      </span>
      {isMe && <YouTag />}
      {r.state !== "open" && r.name !== r.slot && (
        <span className="text-[0.6rem] text-ink-muted truncate">{r.slot.replace(/ of Group A$/i, "")}</span>
      )}
      <span className="ml-auto tabular font-medium w-8 text-right">{score === null ? "" : score}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ teams */

function Teams({ data, me }: { data: Tournament; me: Team | null }) {
  const ordered = me ? [me, ...data.teams.filter((t) => t.id !== me.id)] : data.teams;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 lg:gap-6">
      {ordered.map((t) => {
        const mine = me?.id === t.id;
        return (
          <section
            key={t.id}
            className={cn("rounded-xl border bg-paper-deep/25 shadow-sm px-5 py-4", mine ? "border-coral/60" : "border-hairline")}
          >
            <div className="flex items-center gap-3 mb-3">
              <span
                className={cn(
                  "grid h-9 w-9 flex-none place-items-center rounded-lg text-xs font-bold tracking-wide",
                  mine ? "bg-coral/15 text-coral border border-coral/40" : "bg-paper-deep text-ink-soft border border-hairline",
                )}
              >
                {t.short.slice(0, 3)}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={cn("font-semibold", mine ? "text-coral" : "text-ink")}>{t.name}</span>
                  {mine && <YouTag />}
                </div>
                <div className="text-[0.65rem] uppercase tracking-widest text-ink-muted">{t.players.length} players</div>
              </div>
            </div>
            <ul className="divide-y divide-hairline/40">
              {t.players.map((p) => (
                <li key={p.name} className="flex items-center gap-2 py-1.5 text-sm text-ink-soft">
                  <span>{p.name}</span>
                  {p.captain && (
                    <span className="ml-auto rounded border border-hairline bg-paper-deep/60 px-1.5 py-px text-[0.55rem] font-bold uppercase tracking-widest text-ink-muted">
                      Cap
                    </span>
                  )}
                </li>
              ))}
              {t.players.length === 0 && <li className="py-1.5 text-sm text-ink-muted">No roster listed.</li>}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- helpers */

/** "7205, Eldorado Parkway, McKinney, Collin County, Texas, …" → "7205 Eldorado Parkway, McKinney, TX". */
function shortAddress(a: string): string {
  const parts = a.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 3) return a;
  const [num, street, city] = parts;
  const zip = parts.find((p) => /^\d{5}$/.test(p));
  return `${num} ${street}, ${city}, TX${zip ? ` ${zip}` : ""}`;
}

/** "Sep 5–6" from the games' dates. */
function dateSpan(games: Game[]): string {
  const days = [...new Set(games.map((g) => g.date).filter(Boolean))].sort();
  if (days.length === 0) return "";
  const first = dayLabel(days[0]!).replace(/^\w+,\s*/, "");
  if (days.length === 1) return first;
  const last = dayLabel(days[days.length - 1]!).replace(/^\w+,\s*/, "");
  const [m1, d1] = first.split(" ");
  const [m2, d2] = last.split(" ");
  return m1 === m2 ? `${m1} ${d1}–${d2}` : `${first} – ${last}`;
}
