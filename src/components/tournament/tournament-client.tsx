"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { Select } from "@/components/select";
import { PercentileChip } from "@/components/percentile-chip";
import { DistributionPanel, type DistributionRank } from "@/components/teams/distribution-panel";
import {
  DIFF_CAP, MAX_MARGIN, POLL_MS, dayLabel, diffLabel, fetchTournament, groupIsComplete, involves, isFinal, isLive,
  nextPollDelay, pickableGames, projectStandings, resolveSide, standings, timeLabel,
  type Game, type Picks, type ProjRow, type Resolved, type Side, type Team, type TeamRow, type Tournament,
} from "@/lib/tournament";

/**
 * The tournament page, built from the parts the rest of the site is built
 * from: the scoreboard's game cards and section rules, the team page's hero
 * and schedule strip, the rank chips, and the DistributionPanel the Shooting
 * tab uses. A coach who knows the site should feel they are on a team page
 * for one weekend.
 *
 * THE HERO IS THE SITUATION, NOT A TITLE. Its right half is whichever of these
 * is true right now, in that order: the game 4-D is playing, the next one, or
 * the last result. It changes shape over the day without anyone touching it.
 *
 * THE TABS ARE THE HASH. #standings is a link someone can send from the bench
 * and it is what the back button understands, so the active tab is read from
 * window.location.hash through useSyncExternalStore rather than held in state.
 * The strip is plain <a href="#…"> for the reason team-tabs.tsx documents:
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
  { key: "whatif", label: "What if" },
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

/** Everything a tab needs to resolve a slot, computed once per render. */
type Ctx = { data: Tournament; me: Team | null; table: TeamRow[]; complete: boolean };

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
        // Every thirty seconds only while something can change — see
        // nextPollDelay. Before the first tip the page sleeps.
        const delay = nextPollDelay(next);
        if (delay !== null) timer = setTimeout(tick, delay);
      } catch {
        if (cancelled) return;
        setFailedAt(Date.now());
        timer = setTimeout(tick, POLL_MS * 2);
      }
    };
    void tick();
    return () => { cancelled = true; ctrl.abort(); if (timer) clearTimeout(timer); };
  }, [slug]);

  // A clock for "updated 40s ago", ticking on its own so the label moves
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
      <div className="mx-auto max-w-7xl px-6 lg:px-10 pt-6 pb-20">
        <Eyebrow>Tournament</Eyebrow>
        <h1 className="font-display text-4xl md:text-6xl tracking-tight text-ink leading-none">Loading</h1>
        <p className="mt-3 text-sm text-ink-muted">
          {failedAt ? "The schedule feed isn't answering. Retrying." : "Fetching the schedule…"}
        </p>
      </div>
    );
  }

  const table = standings(data);
  const complete = groupIsComplete(data);
  const ctx: Ctx = { data, me, table, complete };
  const myRow = me ? table.find((r) => r.team.id === me.id) ?? null : null;
  const mySeed = myRow ? table.indexOf(myRow) + 1 : null;
  const played = table.some((r) => r.gp > 0);
  const liveCount = data.games.filter(isLive).length;
  const finalCount = data.games.filter(isFinal).length;
  const myGames = me ? data.games.filter((g) => involves(g, me) || isPlayoffFor(g, me, ctx)) : [];

  return (
    <div className="mx-auto max-w-7xl px-6 lg:px-10 pt-6 pb-20">
      {/* ------------------------------------------------------------ hero */}
      <header>
        <div className="min-w-0">
          <Eyebrow>{data.event.name} · {data.event.division}</Eyebrow>
          <h1 className="font-display text-5xl md:text-7xl tracking-tight text-ink leading-none">
            {me?.name ?? data.ourTeam}
          </h1>
          <div className="mt-4 flex flex-wrap items-baseline gap-x-5 gap-y-2 text-ink-soft">
            <span className="font-display tabular text-3xl text-ink leading-none">{myRow ? `${myRow.w}-${myRow.l}` : "0-0"}</span>
            {mySeed !== null && played && (
              <span className="inline-flex items-baseline gap-1.5 px-3 py-1.5 rounded-md bg-coral text-accent-foreground font-display text-xl tabular leading-none shadow-sm">
                <span className="text-[0.6em] uppercase tracking-widest opacity-80">Seed</span>
                {mySeed}
                {!complete && <span className="text-[0.55em] uppercase tracking-widest opacity-70">proj.</span>}
              </span>
            )}
            {myRow && myRow.gp > 0 && (
              <span className="text-sm text-ink-muted tabular">
                <span className={cn("font-semibold", myRow.diff > 0 ? "text-good" : myRow.diff < 0 ? "text-bad" : "")}>{diffLabel(myRow.diff)}</span>
                {" "}diff · {myRow.pf} for · {myRow.pa} against
              </span>
            )}
          </div>
          <p className="mt-2 text-sm text-ink-muted">
            {data.event.venue.name}
            {data.event.venue.address && (
              <>
                {" · "}
                <a
                  className="hover:text-coral transition-colors"
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(data.event.venue.address)}`}
                  target="_blank" rel="noreferrer"
                >
                  {shortAddress(data.event.venue.address)}
                </a>
              </>
            )}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
            <FeedStatus live={live?.at ?? null} failedAt={failedAt} now={now} liveCount={liveCount} finalCount={finalCount} total={data.games.length} />
            <div className="flex items-center gap-2">
              <span className="text-[0.6rem] uppercase tracking-[0.12em] font-semibold text-ink-muted">Your team</span>
              <Select value={me?.name ?? data.ourTeam} onChange={setTeamName} ariaLabel="Which team to follow" compact className="w-36">
                {data.teams.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
              </Select>
            </div>
          </div>
        </div>

      </header>

      {/* ---------------------------------------------------- schedule strip
          The team page's ticker: result pill over the opponent, in date order,
          flat on the page. Initials stand in for crests — these teams have
          none. The bracket path continues past the group games, dashed while
          it is only projected. */}
      {me && myGames.length > 0 && (
        <div className="mt-8">
          <div className="flex items-baseline gap-3 mb-3">
            <span className="text-[0.65rem] uppercase tracking-widest text-coral font-bold">The weekend</span>
            <span className="text-[0.6rem] text-ink-muted">{me.name}&rsquo;s path, in order · dashed is projected</span>
          </div>
          <div className="flex items-start gap-1.5 overflow-x-auto p-1 -m-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {myGames.map((g) => <StripCell key={g.id} g={g} me={me} ctx={ctx} />)}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------ tabs */}
      <nav aria-label="Tournament sections" className="mt-8">
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
        {tab === "schedule" && <Schedule ctx={ctx} myGames={myGames} />}
        {tab === "standings" && <Standings ctx={ctx} />}
        {tab === "whatif" && <WhatIf ctx={ctx} />}
        {tab === "bracket" && <Bracket ctx={ctx} />}
        {tab === "teams" && <Teams ctx={ctx} />}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- pieces */

/** The scoreboard's eyebrow: small caps in coral behind a short rule. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[0.6rem] uppercase tracking-[0.18em] text-coral font-bold mb-1.5 flex items-center gap-2">
      <span className="h-px w-6 bg-coral" />
      {children}
    </div>
  );
}

/** The scoreboard's section heading: label, a rule, a count. */
function SectionRule({ label, count, tone = "muted" }: { label: string; count?: number; tone?: "muted" | "coral" }) {
  const coral = tone === "coral";
  return (
    <h2 className={cn(
      "text-[0.62rem] uppercase tracking-[0.16em] font-bold mb-2.5 flex items-center gap-2",
      coral ? "text-coral" : "text-ink-muted",
    )}>
      {label}
      <span className={cn("h-px flex-1", coral ? "bg-coral/25" : "bg-hairline")} />
      {count !== undefined && <span className={cn("font-medium tabular", coral ? "text-coral/70" : "text-ink-muted/70")}>{count}</span>}
    </h2>
  );
}

/** Initials in a rounded square, where a crest would go. */
function Crest({ team, name, size = 20, mine = false, dashed = false }: { team: Team | null; name: string; size?: number; mine?: boolean; dashed?: boolean }) {
  const text = team ? team.short.slice(0, 3) : initials(name);
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded font-bold tabular leading-none",
        mine ? "bg-coral/15 text-coral" : "bg-paper-deep text-ink-soft",
        dashed && "border border-dashed border-ink/30 bg-transparent",
      )}
      style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.36)) }}
      aria-hidden
    >
      {text}
    </span>
  );
}

function FeedStatus({
  live, failedAt, now, liveCount, finalCount, total,
}: { live: number | null; failedAt: number | null; now: number; liveCount: number; finalCount: number; total: number }) {
  const ago = live ? Math.max(0, Math.round((now - live) / 1000)) : null;
  const agoText = ago === null ? null : ago < 60 ? `${ago}s ago` : `${Math.round(ago / 60)}m ago`;
  return (
    <div className="flex items-center gap-3 text-[0.6rem] uppercase tracking-[0.12em] font-semibold text-ink-muted tabular">
      {liveCount > 0 && (
        <span className="inline-flex items-center gap-1.5 text-coral">
          <span className="h-1.5 w-1.5 rounded-full bg-coral animate-pulse" />
          {liveCount} in progress
        </span>
      )}
      <span>{finalCount}/{total} final</span>
      <span className={cn(failedAt && "text-bad")}>
        {failedAt && !live ? "feed unreachable" : failedAt ? `feed stalled · ${agoText}` : agoText ? `updated ${agoText}` : "connecting"}
      </span>
    </div>
  );
}

/* --------------------------------------------------------------- strip */

function StripCell({ g, me, ctx }: { g: Game; me: Team; ctx: Ctx }) {
  const opp = opponentSide(g, me, ctx);
  const r = resolveSide(opp, ctx.data, ctx.table, ctx.complete);
  const won = g.status === "final" && g.winnerTeamId === me.id;
  const lost = g.status === "final" && g.winnerTeamId !== null && g.winnerTeamId !== me.id;
  const projected = g.stage === "playoff" && g.status !== "final";
  const label = g.status === "final" ? (won ? "W" : lost ? "L" : "T") : isLive(g) ? "●" : g.stage === "playoff" ? shortRound(g.round) : "—";
  return (
    <a
      href="#schedule"
      title={`${dayLabel(g.date)} ${timeLabel(g.time)} vs ${r.name}${g.court ? ` · ${g.court}` : ""}${g.stage === "playoff" ? ` · ${g.name}` : ""}`}
      className={cn(
        "flex flex-col items-center gap-1.5 shrink-0 min-w-24 rounded px-2.5 py-1.5 transition-colors hover:bg-coral/8",
        projected && "border border-dashed border-ink/20",
      )}
    >
      <span className={cn(
        "inline-flex items-center justify-center text-[0.55rem] font-semibold tabular min-w-6 px-1 h-4 rounded-sm leading-none",
        won && "bg-good/22 text-good",
        lost && "bg-bad/22 text-bad",
        !won && !lost && (isLive(g) ? "bg-coral/15 text-coral" : "bg-paper-deep text-ink-muted"),
      )}>
        {label}
      </span>
      {/* The name in full. Three-letter codes are the organiser's, and nobody
          on the bench knows that TTS is the Titans. */}
      <span className={cn(
        "text-sm font-semibold leading-none whitespace-nowrap",
        r.state === "projected" ? "italic text-ink-soft" : r.state === "open" ? "text-ink-muted" : "text-ink",
      )}>
        {r.name}
      </span>
      <span className="text-[0.5rem] uppercase tracking-wider text-ink-muted leading-none tabular">
        {dayLabel(g.date).split(",")[0]} {timeLabel(g.time).replace(/:00/, "").replace(/\s/, "")}
        {g.court ? ` · ${g.court.replace(/^Court /, "C")}` : ""}
      </span>
    </a>
  );
}

/* ------------------------------------------------------------- schedule */

function Schedule({ ctx, myGames }: { ctx: Ctx; myGames: Game[] }) {
  const days = [...new Set(ctx.data.games.map((g) => g.date))].sort();
  return (
    <div className="space-y-7">
      {ctx.me && myGames.length > 0 && (
        <section>
          <SectionRule label={ctx.me.name} count={myGames.length} tone="coral" />
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {myGames.map((g) => <GameCard key={`m-${g.id}`} g={g} ctx={ctx} />)}
          </div>
        </section>
      )}
      {days.map((day) => {
        const games = ctx.data.games.filter((g) => g.date === day);
        return (
          <section key={day}>
            <SectionRule label={dayLabel(day)} count={games.length} />
            <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {games.map((g) => <GameCard key={g.id} g={g} ctx={ctx} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/**
 * The scoreboard's game card, with initials for crests and the match label
 * where the betting line would sit. Projected sides are italic and say so in
 * the meta band, so a bracket slot is never mistaken for a fixture.
 */
function GameCard({ g, ctx, className, style }: { g: Game; ctx: Ctx; className?: string; style?: React.CSSProperties }) {
  const live = isLive(g);
  const final = g.status === "final";
  const ra = g.stage === "playoff" ? resolveSide(g.a, ctx.data, ctx.table, ctx.complete) : settled(g.a, ctx.data);
  const rb = g.stage === "playoff" ? resolveSide(g.b, ctx.data, ctx.table, ctx.complete) : settled(g.b, ctx.data);
  const projected = ra.state === "projected" || rb.state === "projected";
  const mine = ctx.me ? ra.team?.id === ctx.me.id || rb.team?.id === ctx.me.id : false;
  return (
    <div
      className={cn(
        "relative bg-card border rounded-xl shadow-sm overflow-hidden transition-colors",
        live ? "border-coral/40 ring-1 ring-coral/15" : mine ? "border-coral/30" : "border-ink/10",
        className,
      )}
      style={style}
    >
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        <span className="flex items-center gap-1.5 min-w-0 text-[0.58rem] uppercase tracking-[0.12em] font-semibold text-ink-muted">
          <span className="truncate">{g.court ?? ctx.data.event.venue.name}</span>
        </span>
        <span className={cn(
          "shrink-0 text-[0.58rem] uppercase tracking-[0.12em] font-bold tabular",
          live ? "text-coral" : "text-ink-muted",
        )}>
          {live ? "Live" : final ? "Final" : `${dayLabel(g.date).split(",")[0]} ${timeLabel(g.time)}`}
        </span>
      </div>
      <div className="px-4 pb-3">
        <div className="divide-y divide-hairline/60">
          <SideRow r={ra} slot={g.a} score={g.scoreA} won={final && g.winnerTeamId !== null && g.winnerTeamId === g.a.teamId} me={ctx.me} />
          <SideRow r={rb} slot={g.b} score={g.scoreB} won={final && g.winnerTeamId !== null && g.winnerTeamId === g.b.teamId} me={ctx.me} />
        </div>
      </div>
      {/* Match numbers are the organiser's bookkeeping and mean nothing in
          the group; in the bracket they are how the rounds refer to each
          other ("Winner of Match 1"), so they stay there. */}
      <div className="px-4 py-2 border-t border-hairline bg-paper-deep/30 flex items-center gap-1.5 text-[0.6rem] text-ink-muted">
        <span className="uppercase tracking-widest font-semibold text-ink-muted/70">{g.stage === "playoff" ? g.round : ctx.data.event.group}</span>
        <span className="tabular">{g.stage === "playoff" ? g.name : `${dayLabel(g.date).split(",")[0]} ${timeLabel(g.time)}`}</span>
        {projected && <span className="ml-auto italic">projected</span>}
      </div>
    </div>
  );
}

function SideRow({ r, slot, score, won, me }: { r: Resolved; slot: Side; score: number | null; won: boolean; me: Team | null }) {
  const isMe = me ? r.team?.id === me.id : false;
  const seed = /winner\s+(\d+)\s+of/i.exec(slot.name)?.[1] ?? null;
  return (
    <div className="flex items-center gap-2 py-1.5">
      <Crest team={r.team} name={r.name} size={20} mine={isMe} dashed={r.state !== "settled"} />
      {seed && <span className="text-[0.6rem] text-ink-muted tabular w-2">{seed}</span>}
      <span className={cn(
        "min-w-0 truncate text-sm",
        won ? "text-ink font-semibold" : "text-ink-soft",
        isMe && "text-coral font-semibold",
        r.state === "projected" && "italic",
        r.state === "open" && "text-ink-muted",
      )}>
        {r.name}
      </span>
      <span className={cn("ml-auto text-right tabular text-lg font-bold leading-none pl-2", won ? "text-ink" : "text-ink-muted")}>
        {score ?? "—"}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------ standings */

function Standings({ ctx }: { ctx: Ctx }) {
  const { data, table, me, complete } = ctx;
  const played = table.some((r) => r.gp > 0);
  const myRanks = me ? whereTheyStand(table, me) : [];
  const maxAbs = Math.max(1, ...table.map((r) => Math.abs(r.diff)));
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-8">
      <div className="bg-paper-deep/25 -mx-6 lg:mx-0 rounded-none lg:rounded-xl border-y border-x-0 lg:border-x border-hairline shadow-sm p-6">
        <div className="flex items-baseline justify-between mb-5">
          <h3 className="font-display text-xl text-ink">{data.event.group}</h3>
          <span className="text-[0.65rem] uppercase tracking-widest text-ink-muted">
            {data.teams.length} teams · {complete ? "final" : played ? "in progress" : "not started"}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse tabular text-sm">
            <thead>
              <tr className="text-[0.6rem] uppercase tracking-widest text-ink-muted">
                <th className="py-2 pr-3 text-left font-medium w-10">Seed</th>
                <th className="py-2 text-left font-medium">Team</th>
                {["GP", "W-L", "PF", "PA"].map((h) => (
                  <th key={h} className="py-2 pl-3 text-right font-medium">{h}</th>
                ))}
                <th className="py-2 pl-3 text-right font-medium">Diff</th>
                <th className="py-2 pl-3 font-medium w-28 hidden sm:table-cell" aria-label="Differential, drawn" />
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline/40">
              {table.map((r, i) => {
                const mine = me?.id === r.team.id;
                return (
                  <tr key={r.team.id} className={cn("transition-colors", mine ? "bg-coral/8" : "hover:bg-coral/5")}>
                    <td className="py-2 pr-3">
                      {played ? <SeedBadge rank={i + 1} total={table.length} /> : <span className="text-ink-muted">{i + 1}</span>}
                    </td>
                    <td className={cn("py-2 font-medium", mine ? "text-coral" : "text-ink")}>
                      <span className="inline-flex items-center gap-2">
                        <Crest team={r.team} name={r.team.name} size={18} mine={mine} />
                        {r.team.name}
                        {i === 0 && played && <span className="text-[0.6rem] uppercase tracking-widest text-gold font-semibold">bye</span>}
                      </span>
                    </td>
                    <td className="py-2 pl-3 text-right">{r.gp}</td>
                    <td className="py-2 pl-3 text-right">{r.w}-{r.l}</td>
                    <td className="py-2 pl-3 text-right">{r.gp ? r.pf : "—"}</td>
                    <td className="py-2 pl-3 text-right">{r.gp ? r.pa : "—"}</td>
                    <td className={cn("py-2 pl-3 text-right font-semibold", r.diff > 0 && "text-good", r.diff < 0 && "text-bad")}>
                      {r.gp ? diffLabel(r.diff) : "—"}
                      {r.gp > 0 && r.rawDiff !== r.diff && (
                        <span className="ml-1 font-normal text-[0.65rem] text-ink-muted" title="uncapped">({diffLabel(r.rawDiff)})</span>
                      )}
                    </td>
                    <td className="py-2 pl-3 hidden sm:table-cell">
                      <DiffBar value={r.gp ? r.diff : 0} max={maxAbs} mine={mine} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-4 pt-4 border-t border-hairline/60 text-xs text-ink-muted">
          One group; each team plays four. All seven advance — seed 1 to the semi-finals, seeds 2–7 to Round 1.
          Ranked by win %, then point differential with each game&rsquo;s margin capped at ±{DIFF_CAP} (NAIG rulebook);
          a forfeit is 30–0. Uncapped figures in brackets where they differ.
        </p>
      </div>

      {me && (
        <DistributionPanel title={`Where ${me.name} stands`} eyebrow={`vs ${data.event.group}`} ranks={myRanks}>
          {myRanks.every((r) => r.value === null) && (
            <p className="text-xs text-ink-muted">Fills in after the first final.</p>
          )}
        </DistributionPanel>
      )}
    </div>
  );
}

/**
 * A diverging bar around zero — the differential drawn, so the table's shape
 * reads before its numbers do. Coral for the followed team, the result
 * colours for everyone else.
 */
function DiffBar({ value, max, mine }: { value: number; max: number; mine: boolean }) {
  const pct = Math.min(50, (Math.abs(value) / max) * 50);
  return (
    <div className="relative h-1.5 w-full rounded-full bg-paper-deep" role="img" aria-label={`${diffLabel(value)} point differential`}>
      <span className="absolute left-1/2 top-0 h-full w-px bg-hairline" />
      <span
        className={cn("absolute top-0 h-full rounded-full", mine ? "bg-coral" : value >= 0 ? "bg-good/70" : "bg-bad/70")}
        style={value >= 0 ? { left: "50%", width: `${pct}%` } : { right: "50%", width: `${pct}%` }}
      />
    </div>
  );
}

/** Rank #n of N as the rank chips on the team page. */
function SeedBadge({ rank, total }: { rank: number; total: number }) {
  const pct = total > 1 ? Math.round(((total - rank) / (total - 1)) * 100) : 100;
  return (
    <PercentileChip pct={pct} className="flex-none" ariaLabel={`Seed ${rank} of ${total}`}>
      #{rank}
    </PercentileChip>
  );
}

/**
 * The team's standing in the group, as DistributionPanel rows — the same
 * rank-and-marker rows the Shooting tab uses, over a cohort of seven.
 */
function whereTheyStand(table: TeamRow[], me: Team): DistributionRank[] {
  const mine = table.find((r) => r.team.id === me.id);
  const played = table.filter((r) => r.gp > 0);
  const total = played.length;
  const row = (key: string, label: string, sub: string | undefined, pick: (r: TeamRow) => number, format: DistributionRank["format"], invert = false): DistributionRank => {
    if (!mine || mine.gp === 0) return { key, label, sub, value: null, rank: null, total, percentile: 50, format };
    const vals = played.map(pick).sort((a, b) => (invert ? a - b : b - a));
    const value = pick(mine);
    const rank = vals.indexOf(value) + 1;
    const percentile = total > 1 ? Math.round(((total - rank) / (total - 1)) * 100) : 100;
    return { key, label, sub, value, rank, total, percentile, format };
  };
  return [
    row("winpct", "Win %", undefined, (r) => (r.gp ? r.w / r.gp : 0), "pct"),
    row("diff", "Point diff", `capped ±${DIFF_CAP} per game`, (r) => r.diff, "intDiff"),
    row("margin", "Margin per game", "uncapped", (r) => (r.gp ? Math.round((r.rawDiff / r.gp) * 10) / 10 : 0), "intDiff"),
    row("pf", "Points for", "per game", (r) => (r.gp ? Math.round((r.pf / r.gp) * 10) / 10 : 0), "int"),
    row("pa", "Points against", "per game, lower is better", (r) => (r.gp ? Math.round((r.pa / r.gp) * 10) / 10 : 0), "int", true),
  ];
}

/* -------------------------------------------------------------- bracket */

/**
 * Drawn as a bracket from lg up, stacked as cards below.
 *
 * THE GRID IS THE GEOMETRY. Thirty-two rows of a fixed height; every card
 * spans eight and sits at the centre of its span, so each card's midline
 * lands on a row boundary and the connectors can be drawn with borders:
 *
 *   col 1   bye (rows 1–8)  M1 (9–16)  M2 (17–24)  M3 (25–32)
 *   col 3   SF1 (5–12, fed by the bye at 4/5 and M1 at 12/13)
 *           SF2 (21–28, fed by M2 at 20/21 and M3 at 28/29)
 *   col 5   Final (13–20, fed by SF1 at 8/9 and SF2 at 24/25)
 *
 * A connector is a box spanning its two feeders' midlines with a top, bottom
 * and right border — two stubs and a bar — and a one-pixel line at the
 * target's midline from the bar to the next column. No SVG, nothing measured
 * at runtime, and the bye is a first-class part of the drawing rather than a
 * footnote, because it is the thing seed 1 is playing for.
 */
const ROW_PX = 17;
const BRACKET_COLUMNS = "minmax(0,1fr) 32px minmax(0,1fr) 32px minmax(0,1fr)";

function Bracket({ ctx }: { ctx: Ctx }) {
  const { data, table, complete } = ctx;
  const played = table.some((r) => r.gp > 0);
  const find = (re: RegExp) => data.games.find((g) => g.stage === "playoff" && re.test(g.name));
  const m1 = find(/^match\s*1$/i), m2 = find(/^match\s*2$/i), m3 = find(/^match\s*3$/i);
  const sf1 = find(/^semi.*1$/i), sf2 = find(/^semi.*2$/i), fin = find(/^final/i);
  const drawable = m1 && m2 && m3 && sf1 && sf2 && fin;
  const rounds = ["Round 1", "Semi-Finals", "Final"]
    .map((name) => ({ name, games: data.games.filter((g) => g.stage === "playoff" && g.round === name) }))
    .filter((r) => r.games.length > 0);
  const byeSlot: Side = { teamId: null, applicantId: null, name: "Winner 1 of Group A", placeholder: true };

  return (
    <div className="space-y-6">
      {drawable && (
        <div className="hidden lg:block">
          {/* The round headings ride their own grid with the same columns, so
              they sit above the drawing rather than inside its fixed rows. */}
          <div className="grid" style={{ gridTemplateColumns: BRACKET_COLUMNS }}>
            <div className="col-start-1"><SectionRule label="Round 1" count={3} /></div>
            <div className="col-start-3"><SectionRule label="Semi-Finals" count={2} /></div>
            <div className="col-start-5"><SectionRule label="Final" count={1} tone="coral" /></div>
          </div>
        <div
          className="grid gap-x-0"
          style={{
            gridTemplateColumns: BRACKET_COLUMNS,
            gridTemplateRows: `repeat(32, ${ROW_PX}px)`,
          }}
        >
          <ByeCard slot={byeSlot} ctx={ctx} style={{ gridColumn: 1, gridRow: "1 / span 8" }} />
          <GameCard g={m1!} ctx={ctx} className="self-center" style={{ gridColumn: 1, gridRow: "9 / span 8" }} />
          <GameCard g={m2!} ctx={ctx} className="self-center" style={{ gridColumn: 1, gridRow: "17 / span 8" }} />
          <GameCard g={m3!} ctx={ctx} className="self-center" style={{ gridColumn: 1, gridRow: "25 / span 8" }} />

          <Connector col={2} from={5} to={13} target={9} />
          <Connector col={2} from={21} to={29} target={25} />

          <GameCard g={sf1!} ctx={ctx} className="self-center" style={{ gridColumn: 3, gridRow: "5 / span 8" }} />
          <GameCard g={sf2!} ctx={ctx} className="self-center" style={{ gridColumn: 3, gridRow: "21 / span 8" }} />

          <Connector col={4} from={9} to={25} target={17} />

          <GameCard g={fin!} ctx={ctx} className="self-center ring-1 ring-gold/40 border-gold/50" style={{ gridColumn: 5, gridRow: "13 / span 8" }} />
        </div>
        </div>
      )}

      <div className={cn("grid grid-cols-1 gap-6", drawable && "lg:hidden")}>
        {rounds.map((r) => (
          <section key={r.name}>
            <SectionRule label={r.name} count={r.games.length} tone={r.name === "Final" ? "coral" : "muted"} />
            <div className="grid gap-2.5 sm:grid-cols-2">
              {r.games.map((g) => <GameCard key={g.id} g={g} ctx={ctx} />)}
            </div>
          </section>
        ))}
      </div>

      <p className="text-xs text-ink-muted">
        {complete ? "Seeded from the final table." : played ? "Seeds are projected from the table as it stands and move as the group plays out." : "Seeds fill from the group table once games are final."}
        {" "}Format from the organiser: seed 1 byes to a semi-final; 4 v 5, 2 v 7 and 3 v 6 play Round 1 on Sunday morning.
        Times and courts are as published on Naismaili Games.
      </p>
    </div>
  );
}

/** Two stubs, a bar, and a line to the target — see the Bracket note. */
function Connector({ col, from, to, target }: { col: number; from: number; to: number; target: number }) {
  return (
    <>
      <div className="w-1/2 border-t border-b border-r border-hairline" style={{ gridColumn: col, gridRow: `${from} / ${to}` }} aria-hidden />
      <div className="self-center ml-auto w-1/2 h-px bg-hairline" style={{ gridColumn: col, gridRow: `${target - 1} / ${target + 1}` }} aria-hidden />
    </>
  );
}

/** Seed 1's free pass, drawn like a game so the bracket has nothing missing. */
function ByeCard({ slot, ctx, style }: { slot: Side; ctx: Ctx; style?: React.CSSProperties }) {
  const r = resolveSide(slot, ctx.data, ctx.table, ctx.complete);
  const mine = ctx.me ? r.team?.id === ctx.me.id : false;
  return (
    <div className={cn("self-center bg-card border rounded-xl shadow-sm overflow-hidden border-dashed", mine ? "border-coral/40" : "border-ink/15")} style={style}>
      <div className="flex items-center justify-between gap-2 px-4 pt-3 text-[0.58rem] uppercase tracking-[0.12em] font-semibold text-ink-muted">
        <span>Bye</span>
        <span className="tabular">straight to SF1</span>
      </div>
      <div className="px-4 pb-3">
        <SideRow r={r} slot={slot} score={null} won={false} me={ctx.me} />
      </div>
      <div className="px-4 py-2 border-t border-hairline bg-paper-deep/30 text-[0.6rem] text-ink-muted">
        <span className="uppercase tracking-widest font-semibold text-ink-muted/70">Seed 1</span>
        {r.state === "projected" && <span className="ml-auto float-right italic">projected</span>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- teams */

function Teams({ ctx }: { ctx: Ctx }) {
  const { data, me } = ctx;
  const ordered = me ? [me, ...data.teams.filter((t) => t.id !== me.id)] : data.teams;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
      {ordered.map((t) => {
        const mine = me?.id === t.id;
        return (
          <div key={t.id} className={cn(
            "bg-paper-deep/25 -mx-6 md:mx-0 rounded-none md:rounded-xl border-y border-x-0 md:border-x shadow-sm p-5 lg:p-6",
            mine ? "border-coral/40" : "border-hairline",
          )}>
            <div className="flex items-baseline justify-between mb-4">
              <span className="flex items-center gap-2.5">
                <Crest team={t} name={t.name} size={28} mine={mine} />
                <h3 className={cn("font-display text-xl", mine ? "text-coral" : "text-ink")}>{t.name}</h3>
              </span>
              <span className="text-[0.65rem] uppercase tracking-widest text-ink-muted tabular">{t.players.length} players</span>
            </div>
            <ul className="divide-y divide-hairline/40">
              {t.players.map((p) => (
                <li key={p.name} className="flex items-center gap-4 py-2 px-1 -mx-1 rounded transition-colors hover:bg-coral/5">
                  <span className="flex-1 min-w-0 text-ink-soft text-sm">{p.name}</span>
                  {p.captain && <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">Captain</span>}
                </li>
              ))}
              {t.players.length === 0 && <li className="py-2 text-sm text-ink-muted">No roster listed.</li>}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------- helpers */

/** A group-stage side, already a team; wrapped in the bracket's Resolved shape. */
function settled(s: Side, data: Tournament): Resolved {
  const team = s.teamId ? data.teams.find((t) => t.id === s.teamId) ?? null : null;
  return { name: s.name, team, state: s.placeholder ? "open" : "settled", slot: s.name };
}

/**
 * A playoff game is "mine" when a projected or settled side is my team, so
 * the path a coach is on course for shows up before it is official.
 */
function isPlayoffFor(g: Game, me: Team, ctx: Ctx): boolean {
  if (g.stage !== "playoff") return false;
  return [g.a, g.b].some((s) => resolveSide(s, ctx.data, ctx.table, ctx.complete).team?.id === me.id);
}

/** The side that is not mine — by id for a fixture, by projection for a slot. */
function opponentSide(g: Game, me: Team, ctx: Ctx): Side {
  if (g.a.teamId === me.id) return g.b;
  if (g.b.teamId === me.id) return g.a;
  const aIsMe = resolveSide(g.a, ctx.data, ctx.table, ctx.complete).team?.id === me.id;
  return aIsMe ? g.b : g.a;
}

function shortRound(round: string): string {
  if (/^final/i.test(round)) return "F";
  if (/semi/i.test(round)) return "SF";
  if (/quarter/i.test(round)) return "QF";
  return "R1";
}

function initials(name: string): string {
  // A projected pair ("Liq / PowerPlai") is two teams in one slot; there is no
  // honest monogram for that.
  if (name.includes(" / ")) return "?";
  const w = name.replace(/winner\s+(\d+)\s+of.*/i, "$1").replace(/winner of\s*/i, "").split(/\s+/).filter(Boolean);
  if (w.length === 1) return w[0]!.slice(0, 3).toUpperCase();
  return w.slice(0, 3).map((x) => x[0]!).join("").toUpperCase();
}

/** "7205, Eldorado Parkway, McKinney, Collin County, Texas, …" → "7205 Eldorado Parkway, McKinney, TX 75070". */
function shortAddress(a: string): string {
  const parts = a.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 3) return a;
  const [num, street, city] = parts;
  const zip = parts.find((p) => /^\d{5}$/.test(p));
  return `${num} ${street}, ${city}, TX${zip ? ` ${zip}` : ""}`;
}


/* --------------------------------------------------------------- what if */

const PICKS_KEY = "cig-whatif";

function readPicks(): Picks {
  try {
    const raw = localStorage.getItem(PICKS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Picks = {};
    for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
      const o = v as { winnerId?: unknown; margin?: unknown };
      if (typeof o?.winnerId === "string" && typeof o?.margin === "number") {
        out[id] = { winnerId: o.winnerId, margin: Math.max(0, Math.min(MAX_MARGIN, Math.round(o.margin))) };
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * The scenario tool: pick a winner and a margin for every game still to be
 * played, and watch the seeding move.
 *
 * WHY IT IS ITS OWN TAB rather than an edit mode on Standings. The standings
 * tab has to be trustworthy at a glance on a Saturday — a coach checking where
 * they actually sit should never wonder whether they are looking at real
 * results or something they typed. Two tabs, two questions, no overlap.
 *
 * REAL RESULTS ARE LOCKED. A game that has gone final shows its result and
 * cannot be picked; projectStandings ignores any pick for it regardless. The
 * tool plays the rest of the weekend forward from where the weekend actually
 * is, which is the only version of the question worth answering.
 *
 * PICKS SURVIVE A RELOAD (localStorage) because working through fourteen games
 * on a phone and losing it to a backgrounded tab would be maddening, and they
 * are per-device scratch rather than anything shared.
 */
function WhatIf({ ctx }: { ctx: Ctx }) {
  const { data, me } = ctx;
  const [picks, setPicks] = useState<Picks>(() => (typeof window === "undefined" ? {} : readPicks()));

  useEffect(() => {
    try { localStorage.setItem(PICKS_KEY, JSON.stringify(picks)); } catch { /* ignore */ }
  }, [picks]);

  const open = pickableGames(data);
  const played = data.games.filter((g) => g.stage === "group" && g.status === "final");
  const table = projectStandings(data, picks);
  const decided = open.filter((g) => picks[g.id]).length;

  const setWinner = (g: Game, teamId: string) =>
    setPicks((p) => {
      const cur = p[g.id];
      // Clicking the picked side again clears it — the fastest way to undo a
      // guess is the same button that made it.
      if (cur?.winnerId === teamId) {
        const next = { ...p };
        delete next[g.id];
        return next;
      }
      return { ...p, [g.id]: { winnerId: teamId, margin: cur?.margin ?? 0 } };
    });

  const setMargin = (g: Game, margin: number) =>
    setPicks((p) => {
      const cur = p[g.id];
      if (!cur) return p;
      return { ...p, [g.id]: { ...cur, margin: Math.max(0, Math.min(MAX_MARGIN, margin)) } };
    });

  const days = [...new Set(open.map((g) => g.date))].sort();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-8 items-start">
      <div className="space-y-7">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="text-sm text-ink-muted max-w-xl">
            Click a team to make it the winner, then set the margin. The table beside this re-seeds as you go.
            {played.length > 0 && <> Games already played are locked and always count for real.</>}
          </p>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-[0.6rem] uppercase tracking-[0.12em] font-semibold text-ink-muted tabular">
              {decided}/{open.length} picked
            </span>
            {decided > 0 && (
              <button
                type="button"
                onClick={() => setPicks({})}
                className="text-xs text-coral hover:underline"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {open.length === 0 && (
          <p className="text-sm text-ink-muted">Every group game is final — the table beside this is the real one.</p>
        )}

        {days.map((day) => {
          const games = open.filter((g) => g.date === day);
          return (
            <section key={day}>
              <SectionRule label={dayLabel(day)} count={games.length} />
              <div className="grid gap-2.5 sm:grid-cols-2">
                {games.map((g) => (
                  <PickCard
                    key={g.id}
                    g={g}
                    pick={picks[g.id]}
                    me={me}
                    onWinner={(id) => setWinner(g, id)}
                    onMargin={(m) => setMargin(g, m)}
                  />
                ))}
              </div>
            </section>
          );
        })}

        {played.length > 0 && (
          <section>
            <SectionRule label="Already played" count={played.length} />
            <div className="grid gap-2.5 sm:grid-cols-2">
              {played.map((g) => <GameCard key={g.id} g={g} ctx={ctx} />)}
            </div>
          </section>
        )}
      </div>

      <div className="lg:sticky lg:top-6">
        <ProjectedTable table={table} me={me} decided={decided} open={open.length} group={data.event.group} />
      </div>
    </div>
  );
}

/** One game, as two winner buttons and a margin. */
function PickCard({
  g, pick, me, onWinner, onMargin,
}: {
  g: Game;
  pick: { winnerId: string; margin: number } | undefined;
  me: Team | null;
  onWinner: (teamId: string) => void;
  onMargin: (margin: number) => void;
}) {
  const mine = me ? g.a.teamId === me.id || g.b.teamId === me.id : false;
  return (
    <div className={cn(
      "bg-card border rounded-xl shadow-sm overflow-hidden transition-colors",
      pick ? "border-coral/40" : mine ? "border-coral/20" : "border-ink/10",
    )}>
      <div className="flex items-center justify-between gap-2 px-4 pt-3 text-[0.58rem] uppercase tracking-[0.12em] font-semibold text-ink-muted">
        <span className="truncate">{g.court ?? ""}</span>
        <span className="tabular shrink-0">{dayLabel(g.date).split(",")[0]} {timeLabel(g.time)}</span>
      </div>
      <div className="px-4 pt-2.5 pb-3 flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          {[g.a, g.b].map((side) => {
            const chosen = pick?.winnerId === side.teamId;
            const isMe = me ? side.teamId === me.id : false;
            return (
              <button
                key={side.teamId ?? side.name}
                type="button"
                aria-pressed={chosen}
                onClick={() => side.teamId && onWinner(side.teamId)}
                className={cn(
                  "flex items-center justify-center gap-1.5 h-9 px-2 rounded-md border text-sm transition-colors",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-coral/40",
                  chosen
                    ? "border-coral bg-coral text-accent-foreground font-semibold"
                    : cn("border-hairline bg-paper-deep/40 hover:border-coral/50", isMe ? "text-coral font-medium" : "text-ink-soft"),
                )}
              >
                <span className="truncate">{side.name}</span>
              </button>
            );
          })}
        </div>
        {/* The margin only exists once there is a winner to attach it to. */}
        <div className={cn("flex items-center gap-2 transition-opacity", !pick && "opacity-40 pointer-events-none")}>
          <label className="flex items-center gap-2 flex-1">
            <span className="text-[0.6rem] uppercase tracking-[0.12em] font-semibold text-ink-muted shrink-0">By</span>
            <input
              type="range"
              min={0}
              max={MAX_MARGIN}
              step={1}
              value={pick?.margin ?? 0}
              onChange={(e) => onMargin(Number(e.target.value))}
              disabled={!pick}
              aria-label="Winning margin"
              className="flex-1 accent-coral"
            />
          </label>
          <input
            type="number"
            min={0}
            max={MAX_MARGIN}
            value={pick?.margin ?? 0}
            onChange={(e) => onMargin(Number(e.target.value))}
            disabled={!pick}
            aria-label="Winning margin in points"
            className="w-14 h-8 px-2 rounded-md border border-hairline bg-paper-deep/40 text-sm text-ink tabular text-right focus:outline-none focus-visible:ring-2 focus-visible:ring-coral/40"
          />
          <span className="text-[0.6rem] uppercase tracking-[0.12em] font-semibold text-ink-muted shrink-0">
            {pick?.margin === 0 ? "n/k" : "pts"}
          </span>
        </div>
      </div>
    </div>
  );
}

/** The seeding as the picks would leave it. */
function ProjectedTable({
  table, me, decided, open, group,
}: { table: ProjRow[]; me: Team | null; decided: number; open: number; group: string }) {
  const complete = decided === open;
  // Before a single game counts, every team is 0-0 with no differential: the
  // order is alphabetical noise, so it is shown as a plain list rather than a
  // ranking with coloured chips and seven "tied" flags saying what is obvious.
  const ranked = table.some((r) => r.gp > 0);
  return (
    <div className="bg-paper-deep/25 -mx-6 lg:mx-0 rounded-none lg:rounded-xl border-y border-x-0 lg:border-x border-hairline shadow-sm p-6">
      <div className="flex items-baseline justify-between mb-5">
        <h3 className="font-display text-xl text-ink">Projected seeding</h3>
        <span className="text-[0.65rem] uppercase tracking-widest text-ink-muted">
          {group} · {complete ? "all picked" : `${open - decided} left`}
        </span>
      </div>
      <table className="w-full border-collapse tabular text-sm">
        <thead>
          <tr className="text-[0.6rem] uppercase tracking-widest text-ink-muted">
            <th className="py-2 pr-3 text-left font-medium w-10">Seed</th>
            <th className="py-2 text-left font-medium">Team</th>
            <th className="py-2 pl-3 text-right font-medium">W-L</th>
            <th className="py-2 pl-3 text-right font-medium">PD</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline/40">
          {table.map((r, i) => {
            const mine = me?.id === r.team.id;
            return (
              <tr key={r.team.id} className={cn(mine && "bg-coral/8")}>
                <td className="py-2 pr-3">
                  {ranked
                    ? <SeedBadge rank={i + 1} total={table.length} />
                    : <span className="text-ink-muted">{i + 1}</span>}
                </td>
                <td className={cn("py-2 font-medium", mine ? "text-coral" : "text-ink")}>
                  <span className="inline-flex items-center gap-2">
                    <Crest team={r.team} name={r.team.name} size={18} mine={mine} />
                    {r.team.name}
                    {i === 0 && ranked && <span className="text-[0.6rem] uppercase tracking-widest text-gold font-semibold">bye</span>}
                    {r.tied && r.gp > 0 && (
                      <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted" title="Same win % and differential as another team — the rulebook goes to a further tiebreak this cannot know">
                        tied
                      </span>
                    )}
                  </span>
                </td>
                <td className="py-2 pl-3 text-right">{r.w}-{r.l}</td>
                <td className={cn("py-2 pl-3 text-right font-semibold", r.diff > 0 && "text-good", r.diff < 0 && "text-bad")}>
                  {r.gp ? diffLabel(r.diff) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-4 pt-4 border-t border-hairline/60 text-xs text-ink-muted">
        Seed 1 byes to a semi-final; 2–7 play Round 1. Ranked by win %, then point differential, each game capped
        at ±{DIFF_CAP}. A margin of 0 counts as a win worth nothing on differential — for &ldquo;we win, no idea
        by how much&rdquo;. Where two teams match on both, both read <span className="uppercase tracking-widest">tied</span>:
        the rulebook goes to a further tiebreak this cannot know.
      </p>
    </div>
  );
}
