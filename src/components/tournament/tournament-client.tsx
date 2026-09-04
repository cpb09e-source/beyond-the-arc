"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { Select } from "@/components/select";
import { PercentileChip } from "@/components/percentile-chip";
import {
  MAX_MARGIN, POLL_MS, dayLabel, diffLabel, fetchTournament, groupIsComplete, involves, isFinal, isLive,
  nextPollDelay, pickableGames, projectStandings, resolveSide, standings, timeLabel,
  type Game, type Picks, type ProjRow, type Resolved, type Side, type Team, type TeamRow, type Tournament,
} from "@/lib/tournament";

/**
 * The tournament page, built from the parts the rest of the site is built
 * from: the scoreboard's game cards and section rules, the team page's hero
 * and schedule strip, and the rank chips. A coach who knows the site should
 * feel they are on a team page
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
  { key: "whatif", label: "What If" },
  { key: "bracket", label: "Bracket" },
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
type Ctx = {
  data: Tournament;
  me: Team | null;
  table: TeamRow[];
  complete: boolean;
  /** Open a team's roster. Every team name on the page calls this. */
  openTeam: (t: Team) => void;
  /** Notes are the coach's, and only reachable once the admin gate is passed. */
  admin: boolean;
  setAdmin: (on: boolean) => void;
  notes: Record<string, string>;
  openNotes: (g: Game) => void;
  matchups: Matchups;
  /** Scores typed at the gym, still waiting on the organiser to confirm them. */
  scores: ManualScores;
  writeScore: (gameId: string, entry: ManualScore | null) => void;
};

/**
 * THE COACH'S NOTES.
 *
 * Kept in this browser, not on a server. The page is one component shared by
 * two sites and neither has anywhere to put per-person writing, so notes live
 * where the what-if picks live. That carries a real edge: they are on THIS
 * device. Typed on a laptop, they are not on the phone at the scorer's table.
 *
 * The admin code is obscurity, not security — it ships in the bundle and can
 * be read out of it. That is enough, because there is nothing behind it worth
 * taking: the notes it reveals were written on the reader's own machine and
 * are already theirs.
 */
/**
 * WHO GUARDS WHO, per game: one of their players to the several of ours who
 * can take them. Many-to-many on purpose — two of ours can share a man, and
 * one of ours can be the answer to two of theirs, which is the whole reason a
 * coach writes this down rather than remembering it.
 *
 * Keyed by NAME rather than by id: the organiser's roster ids are not stable
 * across a re-publish, and a matchup that silently forgets itself the morning
 * of a game is worse than one that has to be retyped after a rename.
 */
type Matchups = Record<string, Record<string, string[]>>;

/**
 * THE NAMES A BENCH ACTUALLY USES, and only the players who are turning up.
 *
 * The organiser's roster is the entry form: full legal names, and everyone who
 * was ever listed. Neither is what a coach wants to tap between games — the
 * Titans sheet lists eleven where eight are playing, and nobody on the bench
 * says "Sahil Panjwani" when they mean SP. A team without an entry here falls
 * back to the published roster, which is right for the teams whose games are
 * not being planned man-to-man.
 */
const MATCHUP_ROSTERS: Record<string, string[]> = {
  "4D": ["Rayan", "Ahad", "Faiz R", "Haris", "Ilu", "BJ", "Rahil", "Rahman", "Kurji", "Shanil", "Zavar", "Zo"],
  Titans: ["Sehan", "Zain", "Aly", "Asad", "Salman", "SP", "Kabani", "Adil"],
  PowerPlai: ["Arish", "Stafa", "Rahim", "Sajid", "Wajid", "Waqas", "Ziyan"],
};

/** The roster to plan against: the short list where there is one. */
function matchupRoster(team: Team | null | undefined): { name: string }[] {
  if (!team) return [];
  const override = MATCHUP_ROSTERS[team.name];
  return override ? override.map((name) => ({ name })) : team.players;
}

/**
 * A SCORE TYPED FROM THE GYM, standing in until the organiser posts theirs.
 *
 * Stored in the feed's own a/b order rather than "us first", because that is
 * the order every consumer downstream already speaks, and a stored score that
 * has to be flipped by whoever reads it is a bug waiting for its second
 * reader.
 *
 * THE FEED IS THE TRUTH. These are a stand-in and nothing more: the moment the
 * organiser marks that game final, the manual entry is dropped — silently when
 * the two agree, and with a notice naming the correction when they do not.
 * Nothing here can outlive the real result.
 */
type ManualScore = { a: number; b: number };
type ManualScores = Record<string, ManualScore>;

const SCORES_KEY = "cig-scores";

function readScores(): ManualScores {
  try { return JSON.parse(localStorage.getItem(SCORES_KEY) ?? "{}") as ManualScores; } catch { return {}; }
}

/**
 * The tournament as it stands if the typed scores are believed.
 *
 * Applied ONLY for the admin — a visitor's page is the organiser's data and
 * nothing else. A manual score is never allowed to overwrite a game the feed
 * has already called: that direction is the whole point of the reconciliation
 * below, and letting it happen here would hide the disagreement it is meant
 * to surface.
 */
function withManual(t: Tournament, scores: ManualScores): Tournament {
  const ids = Object.keys(scores);
  if (ids.length === 0) return t;
  let touched = false;
  const games = t.games.map((g) => {
    const m = scores[g.id];
    if (!m || g.status === "final") return g;
    touched = true;
    return {
      ...g,
      status: "final" as const,
      scoreA: m.a,
      scoreB: m.b,
      winnerTeamId: m.a === m.b ? null : m.a > m.b ? g.a.teamId : g.b.teamId,
    };
  });
  return touched ? { ...t, games } : t;
}

const MATCHUPS_KEY = "cig-matchups";
const NOTES_KEY = "cig-notes";
const ADMIN_KEY = "cig-admin";
const ADMIN_CODE = "0808";

function readNotes(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(NOTES_KEY) ?? "{}") as Record<string, string>; } catch { return {}; }
}
function readMatchups(): Matchups {
  try { return JSON.parse(localStorage.getItem(MATCHUPS_KEY) ?? "{}") as Matchups; } catch { return {}; }
}
function readAdmin(): boolean {
  try { return localStorage.getItem(ADMIN_KEY) === "1"; } catch { return false; }
}

export function TournamentClient({
  slug,
  seed = null,
  action = null,
}: {
  slug: string;
  seed?: Tournament | null;
  /**
   * A control the host page wants in the header — 4dbball puts its theme
   * toggle here. IT IS A SLOT, NOT AN OVERLAY: floated over the page with
   * position:absolute it sat on top of the venue line as soon as the address
   * wrapped to two lines, which it does on any phone. In the flex row it
   * cannot overlap at any width.
   */
  action?: React.ReactNode;
}) {
  const tab = useSyncExternalStore(subscribeHash, readTab, () => "schedule" as Tab);

  // The last good payload and when it arrived. Loading and failure are derived
  // rather than set inside the effect body, which keeps the hooks lint quiet
  // and avoids a second render per tick.
  const [live, setLive] = useState<{ data: Tournament; at: number } | null>(null);
  const [failedAt, setFailedAt] = useState<number | null>(null);
  const feed = live?.data ?? seed;

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

  const [teamName, setTeamName] = useState<string | null>(null);
  // The roster sheet. Replaced the Teams tab: a roster is something you want
  // about ONE team, at the moment you are looking at that team's game, not a
  // fifth screen you navigate to and navigate back from.
  const [roster, setRoster] = useState<Team | null>(null);
  const [noteFor, setNoteFor] = useState<Game | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>(() => (typeof window === "undefined" ? {} : readNotes()));
  const [matchups, setMatchups] = useState<Matchups>(() => (typeof window === "undefined" ? {} : readMatchups()));
  const [admin, setAdminState] = useState(() => (typeof window !== "undefined" && readAdmin()));
  const [scores, setScores] = useState<ManualScores>(() => (typeof window === "undefined" ? {} : readScores()));
  /** Games where the organiser's final disagreed with what was typed. */
  const [corrections, setCorrections] = useState<{ id: string; label: string; was: string; now: string }[]>([]);

  const setAdmin = useCallback((on: boolean) => {
    setAdminState(on);
    try {
      if (on) localStorage.setItem(ADMIN_KEY, "1");
      else localStorage.removeItem(ADMIN_KEY);
    } catch { /* ignore */ }
  }, []);

  const writeScore = useCallback((id: string, entry: ManualScore | null) => {
    setScores((prev) => {
      const next = { ...prev };
      if (entry) next[id] = entry; else delete next[id];
      try { localStorage.setItem(SCORES_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  /**
   * WHAT THE PAGE READS. The organiser's feed for everyone; the feed with the
   * typed scores laid over it for the admin. Because it is applied here rather
   * than at each place a score is shown, a manual result behaves like a real
   * one all the way down: What If stops offering it as a pick, the table
   * counts it, and the bracket seeds from the table.
   */
  const data = useMemo(() => (feed && admin ? withManual(feed, scores) : feed), [feed, scores, admin]);

  /**
   * THE FEED SETTLES IT. Whenever a game with a typed score comes back final
   * from the organiser, the typed one is retired — quietly when they agree,
   * and with a line naming the difference when they do not, because a coach
   * who has been running the seeding off a wrong number should be told rather
   * than watch the table change under them.
   */
  useEffect(() => {
    if (!feed) return;
    const settled = Object.keys(scores).filter((id) => {
      const g = feed.games.find((x) => x.id === id);
      return g?.status === "final" && g.scoreA !== null && g.scoreB !== null;
    });
    if (settled.length === 0) return;
    const found: { id: string; label: string; was: string; now: string }[] = [];
    for (const id of settled) {
      const g = feed.games.find((x) => x.id === id)!;
      const m = scores[id]!;
      if (m.a !== g.scoreA || m.b !== g.scoreB) {
        found.push({
          id,
          label: `${g.a.name} v ${g.b.name}`,
          was: `${m.a}–${m.b}`,
          now: `${g.scoreA}–${g.scoreB}`,
        });
      }
    }
    setScores((prev) => {
      const next = { ...prev };
      for (const id of settled) delete next[id];
      try { localStorage.setItem(SCORES_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
    if (found.length) setCorrections((prev) => [...prev, ...found]);
  }, [feed, scores]);

  /** Toggle one of ours onto one of theirs, for one game. */
  const toggleGuard = useCallback((gameId: string, theirName: string, ourName: string) => {
    setMatchups((prev) => {
      const game = { ...(prev[gameId] ?? {}) };
      const on = game[theirName] ?? [];
      const next = on.includes(ourName) ? on.filter((n) => n !== ourName) : [...on, ourName];
      // Empty lists and empty games are removed rather than stored, so "has a
      // plan" stays a question about content and not about leftovers.
      if (next.length) game[theirName] = next; else delete game[theirName];
      const all = { ...prev };
      if (Object.keys(game).length) all[gameId] = game; else delete all[gameId];
      try { localStorage.setItem(MATCHUPS_KEY, JSON.stringify(all)); } catch { /* ignore */ }
      return all;
    });
  }, []);

  const writeNote = useCallback((id: string, text: string) => {
    setNotes((prev) => {
      const next = { ...prev };
      // An emptied note is a deleted note, so the store does not fill with
      // blanks that would count as "has a note" everywhere that is checked.
      if (text.trim()) next[id] = text; else delete next[id];
      try { localStorage.setItem(NOTES_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);
  const me = useMemo(() => {
    if (!data) return null;
    const want = teamName ?? data.ourTeam;
    return data.teams.find((t) => t.name === want) ?? data.teams.find((t) => t.name === data.ourTeam) ?? null;
  }, [data, teamName]);

  if (!data) {
    return (
      <div className="mx-auto max-w-7xl px-6 lg:px-10 pt-6 pb-10">
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
  const ctx: Ctx = {
    data, me, table, complete, openTeam: setRoster,
    admin, setAdmin, notes, openNotes: setNoteFor, matchups, scores, writeScore,
  };
  const liveCount = data.games.filter(isLive).length;
  const finalCount = data.games.filter(isFinal).length;
  const myGames = me ? data.games.filter((g) => involves(g, me) || isPlayoffFor(g, me, ctx)) : [];

  return (
    <div className="mx-auto max-w-7xl px-6 lg:px-10 pt-6 pb-10">
      {/* ------------------------------------------------------------ hero */}
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {/* THE EVENT AND THE GYM ARE ONE LINE. They were two — a heading
              and a "Location · PSA McKinney" beneath it — which spent two
              lines and a redundant label on four words. The gym keeps the
              link; the street address is still the link's target and title,
              because that is what a maps app wants and what a reader does
              not want three lines of.

              NOTHING ABOUT MY TEAM UP HERE either: the name is on the "Your
              team" control below, the seed and the differential are the first
              two columns of Standings, and the results are in the strip. */}
          <Eyebrow>
            {eventTitle(data.event.name)}
            {" · "}
            {data.event.venue.address ? (
              <a
                className="underline decoration-dotted underline-offset-4 hover:decoration-solid transition-colors"
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(data.event.venue.address)}`}
                title={shortAddress(data.event.venue.address)}
                target="_blank" rel="noreferrer"
              >
                {data.event.venue.name}
              </a>
            ) : data.event.venue.name}
          </Eyebrow>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
            <FeedStatus live={live?.at ?? null} failedAt={failedAt} liveCount={liveCount} finalCount={finalCount} total={data.games.length} />
            <div className="flex items-center gap-2">
              <span className="text-[0.6rem] uppercase tracking-[0.12em] font-semibold text-ink-muted">Your team</span>
              <Select value={me?.name ?? data.ourTeam} onChange={setTeamName} ariaLabel="Which team to follow" compact className="w-36">
                {data.teams.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
              </Select>
            </div>
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
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
          </div>
          <div className="flex items-start gap-1.5 overflow-x-auto p-1 -m-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {myGames.map((g) => <StripCell key={g.id} g={g} me={me} ctx={ctx} />)}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------ tabs */}
      {/* THE STRIP SCROLLS, NOT THE PAGE. Five tabs set to 392px against a
          380px phone viewport, and an inline-flex that does not fit pushes the
          DOCUMENT wide — so the whole page dragged sideways off its own
          background. Full-bleed on a phone so the track can run to both edges,
          back in the column from lg where all five fit anyway. */}
      <nav
        aria-label="Tournament sections"
        className="mt-8 -mx-6 px-6 lg:mx-0 lg:px-0 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
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
      </div>

      {/* THE OVERRIDE IS ANNOUNCED. A typed score that turns out to be wrong
          has been moving the table and the bracket, so replacing it silently
          would leave a coach with a seeding that changed for no visible
          reason. It says what was typed, what the organiser posted, and then
          gets out of the way. */}
      {corrections.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 px-4 pb-4 pointer-events-none">
          <div className="mx-auto max-w-md rounded-xl border border-coral/50 bg-card shadow-xl px-4 py-3 pointer-events-auto">
            <p className="text-[0.6rem] uppercase tracking-[0.14em] font-semibold text-coral">Score corrected</p>
            <ul className="mt-1.5 space-y-1">
              {corrections.map((c) => (
                <li key={c.id} className="text-[0.8rem] text-ink-soft">
                  <span className="text-ink">{c.label}</span>
                  {" — you had "}<span className="tabular">{c.was}</span>
                  {", the organiser posted "}<span className="tabular font-semibold text-ink">{c.now}</span>.
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setCorrections([])}
              className="mt-2 text-[0.7rem] text-ink-muted hover:text-ink transition-colors underline decoration-dotted underline-offset-4"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {roster && <RosterSheet team={roster} me={me} onClose={() => setRoster(null)} />}
      {noteFor && (
        <NotesSheet
          g={noteFor}
          ctx={ctx}
          value={notes[noteFor.id] ?? ""}
          onWrite={(t) => writeNote(noteFor.id, t)}
          onGuard={(their, ours) => toggleGuard(noteFor.id, their, ours)}
          onClose={() => setNoteFor(null)}
        />
      )}
    </div>
  );
}

/* --------------------------------------------------------------- pieces */

/** The scoreboard's eyebrow: small caps in coral behind a short rule. */
/**
 * The page's own name, in the site's gold small caps.
 *
 * THE SAME HEADING THE TABLE PAGES USE. This was a coral kicker with a short
 * rule stuck to its left — a device that appears nowhere else on the site —
 * where every other data page names itself in gold small caps and nothing
 * more. The gold is `--court-ink`, the hardwood tone, which is the one colour
 * on the site that means "you are here".
 */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[0.7rem] uppercase tracking-[0.15em] font-bold leading-none mb-2"
      style={{ color: "var(--court-ink)" }}
    >
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

function FeedStatus({
  live, failedAt, liveCount, finalCount, total,
}: { live: number | null; failedAt: number | null; liveCount: number; finalCount: number; total: number }) {
  /**
   * THE CLOCK LIVES HERE, not on the page. It ticks every ten seconds so
   * "updated 40s ago" keeps moving between polls — and when it sat on the
   * page component, that tick re-rendered every card, the standings table and
   * the bracket along with it, six times a minute, for one line of small
   * print. Nothing else reads it, so nothing else needs to hear about it.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);
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
  // THE SCORE RIDES WITH THE RESULT, and always my team first — a strip that
  // says W and makes you open the card to find out by how much is half a
  // result. Live games carry it too, so the ticker is worth watching.
  const aIsMe = g.a.teamId === me.id || (!g.a.teamId && resolveSide(g.a, ctx.data, ctx.table, ctx.complete).team?.id === me.id);
  const score = g.scoreA !== null && g.scoreB !== null
    ? (aIsMe ? `${g.scoreA}–${g.scoreB}` : `${g.scoreB}–${g.scoreA}`)
    : null;
  const noted = (ctx.notes[g.id] ?? "").trim().length > 0;
  const title = `${dayLabel(g.date)} ${timeLabel(g.time)} vs ${r.name}${g.court ? ` · ${g.court}` : ""}${g.stage === "playoff" ? ` · ${g.name}` : ""}`;
  const shell = cn(
    "flex flex-col items-center gap-1.5 shrink-0 min-w-24 rounded px-2.5 py-1.5 transition-colors hover:bg-coral/8",
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-coral/40",
    projected && "border border-dashed border-ink/20",
  );

  const face = (
    <>
      <span className={cn(
        "inline-flex items-center justify-center gap-1 text-[0.58rem] tabular min-w-6 px-1.5 h-[18px] rounded-sm leading-none",
        won && "bg-good/22 text-good",
        lost && "bg-bad/22 text-bad",
        !won && !lost && (isLive(g) ? "bg-coral/15 text-coral" : "bg-paper-deep text-ink-muted"),
      )}>
        <span className="font-bold">{label}</span>
        {score && <span className="font-semibold opacity-90">{score}</span>}
      </span>
      {/* The name in full. Three-letter codes are the organiser's, and nobody
          on the bench knows that TTS is the Titans. */}
      <span className={cn(
        "text-sm font-semibold leading-none whitespace-nowrap",
        r.state === "projected" ? "italic text-ink-soft" : r.state === "open" ? "text-ink-muted" : "text-ink",
      )}>
        {r.name}
      </span>
      <span className="flex items-center gap-1 text-[0.5rem] uppercase tracking-wider text-ink-muted leading-none tabular">
        {dayLabel(g.date).split(",")[0]} {timeLabel(g.time).replace(/:00/, "").replace(/\s/, "")}
        {/* A written note is worth knowing about without opening it. */}
        {noted && <span className="h-1 w-1 rounded-full bg-coral" aria-label="has notes" />}
      </span>
    </>
  );

  /**
   * IN ADMIN, THE CELL IS THE NOTE. The strip is the handful of games the
   * weekend turns on, so it is where a coach reaches for what they wrote about
   * one — and jumping to a schedule the reader is already looking at was the
   * least useful thing a tap could do.
   */
  if (ctx.admin) {
    return (
      <button type="button" onClick={() => ctx.openNotes(g)} title={`Notes · ${r.name}`} className={shell}>
        {face}
      </button>
    );
  }

  return (
    <a href="#schedule" title={title} className={shell}>
      {face}
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
  const [clock, meridiem] = splitTime(g.time);
  // This game's margin, from the home side's point of view; the away row is
  // handed its negation so each team reads its own.
  const margin = g.scoreA !== null && g.scoreB !== null ? g.scoreA - g.scoreB : null;
  const ra = g.stage === "playoff" ? resolveSide(g.a, ctx.data, ctx.table, ctx.complete) : settled(g.a, ctx.data);
  const rb = g.stage === "playoff" ? resolveSide(g.b, ctx.data, ctx.table, ctx.complete) : settled(g.b, ctx.data);
  const projected = ra.state === "projected" || rb.state === "projected";
  const mine = ctx.me ? ra.team?.id === ctx.me.id || rb.team?.id === ctx.me.id : false;
  /**
   * EVERY GAME BOX TAKES A SCORE, in admin. Double-click opens the sheet on
   * its Score pane — a deliberate gesture, so a card cannot be scored by
   * brushing it while scrolling.
   *
   * `select-none` because the browser's own answer to a double-click is to
   * select the word under it, and a card that highlights its own text every
   * time it is opened looks broken.
   *
   * A team name keeps its single click for the roster: the name stops the
   * double-click from reaching the card, so double-clicking a name opens the
   * roster rather than the score.
   */
  const scoreable = ctx.admin && g.a.teamId !== null && g.b.teamId !== null;
  return (
    <div
      className={cn(
        "relative bg-card border rounded-xl shadow-sm overflow-hidden transition-colors",
        live ? "border-coral/40 ring-1 ring-coral/15" : mine ? "border-coral/30" : "border-ink/10",
        scoreable && "select-none",
        className,
      )}
      style={style}
      onDoubleClick={scoreable ? () => ctx.openNotes(g) : undefined}
      title={scoreable ? "Double-click to enter a score" : undefined}
    >
      {/* THE TIP-OFF LEADS THE CARD. It used to be a 9px grey label in the
          corner, and the same time was printed again in the meta band below —
          twice, small, in the two least-read places on the card. The time is
          the thing a reader came for, so it is set at the card's own headline
          size, and the court keeps its place as a quiet chip: four courts run
          at once at this venue, so it is the one other fact worth carrying. */}
      <div className="flex items-center gap-2.5 px-4 pt-3 pb-2.5 border-b border-hairline/70">
        <span className="font-display tabular text-[1.02rem] leading-none text-ink">
          {clock}
          {meridiem && <span className="ml-0.5 text-[0.66rem] font-medium text-ink-muted">{meridiem}</span>}
        </span>
        <span className="text-[0.62rem] uppercase tracking-[0.14em] font-semibold text-ink-muted">
          {dayLabel(g.date).split(",")[0]}
        </span>
        {(live || final) && (
          <span className={cn(
            "text-[0.6rem] uppercase tracking-[0.12em] font-bold",
            live ? "text-coral" : "text-ink-muted",
          )}>
            {live ? "Live" : "Final"}
          </span>
        )}
        {g.court && (
          <span className="ml-auto shrink-0 rounded-md border border-hairline px-2 py-0.5 text-[0.62rem] uppercase tracking-[0.08em] font-semibold text-ink-soft whitespace-nowrap">
            {g.court}
          </span>
        )}
      </div>
      <div className="px-4 pt-1 pb-3">
        <div className="divide-y divide-hairline/60">
          <SideRow r={ra} slot={g.a} score={g.scoreA} margin={margin} won={final && g.winnerTeamId !== null && g.winnerTeamId === g.a.teamId} ctx={ctx} onScore={scoreable ? () => ctx.openNotes(g) : undefined} />
          <SideRow r={rb} slot={g.b} score={g.scoreB} margin={margin === null ? null : -margin} won={final && g.winnerTeamId !== null && g.winnerTeamId === g.b.teamId} ctx={ctx} onScore={scoreable ? () => ctx.openNotes(g) : undefined} />
        </div>
      </div>
      {/* ONLY PLAYOFF GAMES KEEP A FOOT. It used to repeat the day and time
          the badge above now carries; what is left is the round and the match
          number, and those exist only in the bracket, where the rounds refer
          to each other by them ("Winner of Match 1"). A group game has nothing
          to put here, so it gets no band rather than an empty one. */}
      {g.stage === "playoff" && (
        <div className="px-4 py-2 border-t border-hairline bg-paper-deep/30 flex items-center gap-1.5 text-[0.6rem] text-ink-muted">
          <span className="uppercase tracking-widest font-semibold text-ink-muted/70">{g.round}</span>
          <span className="tabular">{g.name}</span>
          {projected && <span className="ml-auto italic">projected</span>}
        </div>
      )}
    </div>
  );
}

/**
 * One side of a game card: who they are, where they stand, what they scored.
 *
 * THE ROW ANSWERS "SO WHAT" WITHOUT A SECOND TAB. A name and a number tell you
 * the score and nothing about whether it was an upset — so the record and the
 * differential the team is carrying INTO the weekend's table sit next to the
 * name, and this game's own margin sits beside the score. The two are
 * deliberately different things: the coloured figure on the left is where the
 * team stands overall, the one on the right is what happened here.
 *
 * Both appear only once there is something to say — a team with no games
 * played gets a bare name, and a game with no score gets no margin.
 */
function SideRow({ r, slot, score, margin, won, ctx, onScore }: {
  r: Resolved; slot: Side; score: number | null; margin: number | null; won: boolean; ctx: Ctx;
  /** Present only where a score can be entered — see the note on the button. */
  onScore?: () => void;
}) {
  const { me, table, openTeam } = ctx;
  const isMe = me ? r.team?.id === me.id : false;
  const seed = /winner\s+(\d+)\s+of/i.exec(slot.name)?.[1] ?? null;
  const row = r.team ? table.find((x) => x.team.id === r.team!.id) ?? null : null;
  const tone = (n: number) => (n > 0 ? "text-good" : n < 0 ? "text-bad" : "text-ink-muted");
  return (
    <div className="flex items-center gap-2 py-1.5">
      {/* THE SAME CHIP THE TABLE USES. A bracket slot that reads "Seed 4" and
          a standings row that reads "#4" are the same fact, and the fact is
          colour-coded on the table — so a grey 4 here made the reader
          translate between two notations for one thing. It is the standings
          chip, unchanged, wherever a seed is named. */}
      {seed && <SeedBadge rank={Number(seed)} total={table.length} />}
      <TeamName
        team={r.team}
        onOpen={openTeam}
        className={cn(
          "min-w-0 truncate text-sm text-left",
          // ONE COLOUR CLASS, not two and a winner. `text-coral` and
          // `text-ink-soft` are the same specificity, so which one applied was
          // decided by their order in Tailwind's stylesheet rather than by the
          // order they are listed here — and ink-soft won, so the followed
          // team was bold but never blue. A single branch cannot tie.
          isMe ? "text-coral font-semibold"
            : r.state === "open" ? "text-ink-muted"
            : won ? "text-ink font-semibold"
            : "text-ink-soft",
          r.state === "projected" && "italic",
        )}
      >
        {r.name}
      </TeamName>
      {row && row.gp > 0 && (
        <span className="shrink-0 flex items-baseline gap-1.5 text-[0.7rem] tabular leading-none">
          <span className="text-ink-muted">({row.w}-{row.l})</span>
          <span className={cn("font-semibold", tone(row.diff))}>{diffLabel(row.diff)}</span>
        </span>
      )}
      {/* THE MARGIN LEADS INTO THE SCORE, bracketed and small: it is a gloss
          on the number beside it, not a second number competing with it.
          Fixed width even when empty, so scores line up down a column of
          cards whether or not the games have been played. */}
      <span className={cn("ml-auto shrink-0 w-9 text-right text-[0.62rem] font-semibold tabular leading-none", margin === null ? "text-transparent" : tone(margin))}>
        {margin === null ? "" : `(${diffLabel(margin)})`}
      </span>
      {/* ON A PHONE THERE IS NO DOUBLE-CLICK, so the score is the way in:
          tapping the number — or the dash standing in for one — opens the
          same sheet. It is the control whose meaning needs no explaining,
          because it is the thing being changed. */}
      {onScore ? (
        <button
          type="button"
          onClick={onScore}
          aria-label="Enter score"
          className={cn(
            "text-right tabular text-lg font-bold leading-none pl-1.5 rounded-sm transition-colors",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-coral/40 hover:text-coral",
            won ? "text-ink" : "text-ink-muted",
          )}
        >
          {score ?? "—"}
        </button>
      ) : (
        <span className={cn("text-right tabular text-lg font-bold leading-none pl-1.5", won ? "text-ink" : "text-ink-muted")}>
          {score ?? "—"}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ standings */

function Standings({ ctx }: { ctx: Ctx }) {
  const { table, me } = ctx;
  const played = table.some((r) => r.gp > 0);
  const maxAbs = Math.max(1, ...table.map((r) => Math.abs(r.diff)));
  return (
    <div>
      <div className="bg-paper-deep/25 -mx-6 lg:mx-0 rounded-none lg:rounded-xl border-y border-x-0 lg:border-x border-hairline shadow-sm p-6">
        <div className="mb-5">
          <h3 className="font-display text-xl text-ink">Standings</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse tabular text-sm">
            <thead>
              <tr className="text-[0.6rem] uppercase tracking-widest text-ink-muted">
                {/* GP IS A CONSTANT. Every team plays four, so a column of
                    sevens told the reader nothing and cost the width that the
                    differential — the actual tiebreak — needed. PD now sits
                    against the record it breaks ties for, rather than three
                    columns away past points for and against. */}
                <th className="py-2 pr-3 text-left font-medium w-10">Seed</th>
                <th className="py-2 text-left font-medium">Team</th>
                <th className="py-2 pl-3 text-right font-medium">W-L</th>
                <th className="py-2 pl-3 text-right font-medium">PD</th>
                <th className="py-2 pl-2.5 sm:pl-3 text-right font-medium">PF</th>
                <th className="py-2 pl-2.5 sm:pl-3 text-right font-medium">PA</th>
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
                    {/* NO WRAPPING. "Team Supreme" broke over two lines and
                        gave that row twice the height of the other six, which
                        made the table look like it had a section in it. The
                        table already scrolls sideways if it has to. */}
                    <td className={cn("py-2 font-medium whitespace-nowrap", mine ? "text-coral" : "text-ink")}>
                      <span className="inline-flex items-center gap-2">
                        <TeamName team={r.team} onOpen={ctx.openTeam}>{r.team.name}</TeamName>
                        {i === 0 && played && <span className="text-[0.6rem] uppercase tracking-widest text-gold font-semibold">bye</span>}
                      </span>
                    </td>
                    <td className="py-2 pl-3 text-right">{r.w}-{r.l}</td>
                    <td className={cn("py-2 pl-3 text-right font-semibold", r.diff > 0 && "text-good", r.diff < 0 && "text-bad")}>
                      {r.gp ? diffLabel(r.diff) : "—"}
                      {/* The uncapped figure is a footnote to the capped one,
                          and on a phone it was the ~40px that tipped the table
                          into sideways scroll. It returns from sm up. */}
                      {r.gp > 0 && r.rawDiff !== r.diff && (
                        <span className="hidden sm:inline ml-1 font-normal text-[0.65rem] text-ink-muted" title="uncapped">({diffLabel(r.rawDiff)})</span>
                      )}
                    </td>
                    <td className="py-2 pl-2.5 sm:pl-3 text-right">{r.gp ? r.pf : "—"}</td>
                    <td className="py-2 pl-2.5 sm:pl-3 text-right">{r.gp ? r.pa : "—"}</td>
                    <td className="py-2 pl-3 hidden sm:table-cell">
                      <DiffBar value={r.gp ? r.diff : 0} max={maxAbs} mine={mine} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

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

/* -------------------------------------------------------------- bracket */

/**
 * Drawn as a bracket from lg up, stacked as cards below.
 *
 * THE GRID IS THE GEOMETRY. Thirty-two rows of a fixed height; every card
 * spans eight and sits at the centre of its span, so each card's midline
 * lands on a row boundary and the connectors can be drawn with borders:
 *
 *   col 1   M1 (rows 1–8)  M2 (9–16)  M3 (17–24)
 *   col 3   SF1 (1–8, level with M1 — its other side is the bye)
 *           SF2 (13–20, fed by M2 at 12/13 and M3 at 20/21)
 *   col 5   Final (7–14, fed by SF1 at 4/5 and SF2 at 16/17)
 *
 * A connector is a box spanning its two feeders' midlines with a top, bottom
 * and right border — two stubs and a bar — and a one-pixel line at the
 * target's midline from the bar to the next column. No SVG and nothing
 * measured at runtime.
 *
 * THE BYE IS NOT DRAWN. It had a dashed card of its own, which spent a slot
 * the size of a real game on a team that is not playing one — and SF1 already
 * names seed 1 on its top row, so the card restated what the next column
 * said. What is left is a straight line into SF1: one feeder, one line.
 */
/**
 * THE ROW HEIGHT IS A CONSTRAINT, NOT A TASTE. A card is centred in its
 * eight-row span, so eight of these must be TALLER than the tallest card or
 * neighbours overlap — which is exactly what happened when the cards grew a
 * tip-off badge, a seed chip and a record: 8 × 17 = 136px of slot holding a
 * 158px card, and Round 1 collapsed into itself.
 *
 * 8 × 22 = 176px, which clears a 158px card by 18. Anything added to a game
 * card has to be checked against this number.
 */
const ROW_PX = 22;
const BRACKET_COLUMNS = "minmax(0,1fr) 32px minmax(0,1fr) 32px minmax(0,1fr)";

function Bracket({ ctx }: { ctx: Ctx }) {
  const { data } = ctx;
  const find = (re: RegExp) => data.games.find((g) => g.stage === "playoff" && re.test(g.name));
  const m1 = find(/^match\s*1$/i), m2 = find(/^match\s*2$/i), m3 = find(/^match\s*3$/i);
  const sf1 = find(/^semi.*1$/i), sf2 = find(/^semi.*2$/i), fin = find(/^final/i);
  const drawable = m1 && m2 && m3 && sf1 && sf2 && fin;
  const rounds = ["Round 1", "Semi-Finals", "Final"]
    .map((name) => ({ name, games: data.games.filter((g) => g.stage === "playoff" && g.round === name) }))
    .filter((r) => r.games.length > 0);

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
            gridTemplateRows: `repeat(24, ${ROW_PX}px)`,
          }}
        >
          <GameCard g={m1!} ctx={ctx} className="self-center" style={{ gridColumn: 1, gridRow: "1 / span 8" }} />
          <GameCard g={m2!} ctx={ctx} className="self-center" style={{ gridColumn: 1, gridRow: "9 / span 8" }} />
          <GameCard g={m3!} ctx={ctx} className="self-center" style={{ gridColumn: 1, gridRow: "17 / span 8" }} />

          {/* SF1 has one drawn feeder, not two: its other side is seed 1, who
              arrives without playing. A straight line, because a bracket fork
              with nothing on one arm is a question the drawing cannot answer. */}
          <Straight col={2} row={5} />
          <Connector col={2} from={13} to={21} target={17} />

          <GameCard g={sf1!} ctx={ctx} className="self-center" style={{ gridColumn: 3, gridRow: "1 / span 8" }} />
          <GameCard g={sf2!} ctx={ctx} className="self-center" style={{ gridColumn: 3, gridRow: "13 / span 8" }} />

          <Connector col={4} from={5} to={17} target={11} />

          <GameCard g={fin!} ctx={ctx} className="self-center ring-1 ring-gold/40 border-gold/50" style={{ gridColumn: 5, gridRow: "7 / span 8" }} />
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

      <AdminGate ctx={ctx} />
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

/**
 * The way into the coach's notes, at the very bottom of the bracket.
 *
 * DELIBERATELY QUIET. It is the last thing on the last tab, set in the muted
 * type the small print uses, because it is not for the players and parents
 * this link is shared with — it is one word for the one person looking for
 * it. Once the code is in, the page is unchanged except that the weekend
 * strip opens notes instead of jumping to the schedule.
 */
function AdminGate({ ctx }: { ctx: Ctx }) {
  const [asking, setAsking] = useState(false);
  const [code, setCode] = useState("");
  const [wrong, setWrong] = useState(false);

  const tryCode = (raw: string) => {
    const next = raw.replace(/\D/g, "").slice(0, ADMIN_CODE.length);
    setCode(next);
    if (wrong) setWrong(false);
    if (next.length < ADMIN_CODE.length) return;
    if (next === ADMIN_CODE) { ctx.setAdmin(true); setAsking(false); setCode(""); }
    else { setWrong(true); setCode(""); }
  };

  if (ctx.admin) {
    return (
      <div className="pt-6 flex items-center gap-3 text-[0.6rem] uppercase tracking-[0.14em] text-ink-muted">
        <span className="text-coral font-semibold">Notes on</span>
        <button type="button" onClick={() => ctx.setAdmin(false)} className="hover:text-ink transition-colors underline decoration-dotted underline-offset-4">
          Turn off
        </button>
      </div>
    );
  }

  if (!asking) {
    return (
      <div className="pt-6">
        <button
          type="button"
          onClick={() => setAsking(true)}
          className="text-[0.6rem] uppercase tracking-[0.14em] text-ink-muted/50 hover:text-ink-muted transition-colors"
        >
          Admin
        </button>
      </div>
    );
  }

  return (
    <div className="pt-6 flex items-center gap-2">
      <input
        autoFocus
        type="tel"
        inputMode="numeric"
        pattern="[0-9]*"
        value={code}
        onChange={(e) => tryCode(e.target.value)}
        onBlur={() => { if (!code) setAsking(false); }}
        aria-label="Admin passcode"
        placeholder="••••"
        className={cn(
          "w-24 h-8 rounded-md border bg-card px-2 text-center text-base tabular tracking-[0.3em] text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-coral/40",
          wrong ? "border-bad" : "border-hairline",
        )}
      />
      {wrong && <span className="text-[0.6rem] uppercase tracking-[0.14em] text-bad">No</span>}
    </div>
  );
}

/** One feeder, so one line: no stubs, no bar. */
function Straight({ col, row }: { col: number; row: number }) {
  return (
    <div className="self-center w-full h-px bg-hairline" style={{ gridColumn: col, gridRow: `${row - 1} / ${row + 1}` }} aria-hidden />
  );
}

/**
 * One game's notes, in the same sheet the roster uses.
 *
 * IT SAVES AS YOU TYPE. There is no Save button because there is no version of
 * this where a coach wants one: the sheet is opened between games, written in
 * with a thumb, and dismissed by dragging it away — a gesture that would lose
 * the writing if it needed a button first. Every keystroke goes to storage,
 * and closing is just closing.
 */
function NotesSheet({ g, ctx, value, onWrite, onGuard, onClose }: {
  g: Game;
  ctx: Ctx;
  value: string;
  onWrite: (text: string) => void;
  onGuard: (theirName: string, ourName: string) => void;
  onClose: () => void;
}) {
  const [pane, setPane] = useState<"score" | "notes" | "matchups">("score");

  /**
   * THE DRAFT IS LOCAL, AND THE PAGE HEARS ABOUT IT LATE.
   *
   * Notes live on the page component, because the strip needs to know which
   * games have one — but routing every keystroke up there re-rendered the
   * whole tournament, cards, tables and bracket, once per letter. The textarea
   * now runs off its own state, and the page is told once the typing pauses.
   * The flush on unmount is what makes that safe: the sheet can be dragged
   * away mid-word and the last letters still land.
   */
  const [draft, setDraft] = useState(value);
  const latest = useRef(value);
  const writeRef = useRef(onWrite);
  writeRef.current = onWrite;
  const timer = useRef<number | null>(null);

  const onType = (text: string) => {
    setDraft(text);
    latest.current = text;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => writeRef.current(latest.current), 400);
  };

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
    writeRef.current(latest.current);
  }, []);

  const me = ctx.me;
  /**
   * "vs Titans" only when it IS a game of ours. Every box on the page can be
   * scored now, and calling a game between two other teams "vs OGS" named the
   * wrong side of a match the followed team is not in.
   */
  const mine = me ? involves(g, me) : false;
  const opp = mine && me ? resolveSide(opponentSide(g, me, ctx), ctx.data, ctx.table, ctx.complete) : null;
  const sideA = g.stage === "playoff" ? resolveSide(g.a, ctx.data, ctx.table, ctx.complete).name : g.a.name;
  const sideB = g.stage === "playoff" ? resolveSide(g.b, ctx.data, ctx.table, ctx.complete).name : g.b.name;
  const title = opp ? `vs ${opp.name}` : `${sideA} v ${sideB}`;
  const theirs = matchupRoster(opp?.team);
  const ours = matchupRoster(me);
  const map = ctx.matchups[g.id] ?? {};
  const assigned = Object.values(map).reduce((n, list) => n + list.length, 0);
  const typed = ctx.scores[g.id] !== undefined;

  return (
    <Sheet
      label={`Notes for ${title}`}
      title={title}
      subtitle={`${dayLabel(g.date)} · ${timeLabel(g.time)}${g.court ? ` · ${g.court}` : ""}`}
      accent
      onClose={onClose}
    >
      {/* THE PANES ARE FOR OUR GAMES. Notes and matchups are the two halves
          of "what are we doing about this one", and there is no answer to
          that for a game between two other teams — those are opened to type a
          score off the scoreboard and close again, so they get the score and
          nothing to scroll past. */}
      {mine && (
      <div className="px-5 pt-4">
        <div className="inline-flex items-center gap-[2px] rounded-[10px] border border-hairline bg-paper-deep p-[3px]">
          {([["score", "Score"], ["notes", "Notes"], ["matchups", "Matchups"]] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setPane(key)}
              aria-current={pane === key ? "page" : undefined}
              className={cn(
                "flex items-center h-7 px-3 rounded-md border text-[0.8rem] whitespace-nowrap transition-colors",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-coral/40",
                pane === key
                  ? "border-hairline bg-card font-semibold text-coral shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                  : "border-transparent font-medium text-ink-muted hover:text-ink",
              )}
            >
              {label}
              {key === "matchups" && assigned > 0 && (
                <span className="ml-1.5 text-[0.6rem] tabular text-ink-muted">{assigned}</span>
              )}
              {key === "score" && typed && (
                <span className="ml-1.5 h-1 w-1 rounded-full bg-coral" aria-label="score entered" />
              )}
            </button>
          ))}
        </div>
      </div>
      )}

      {!mine || pane === "score" ? (
        <ScorePane g={g} ctx={ctx} />
      ) : pane === "notes" ? (
        <div className="px-5 pt-3 pb-5">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => onType(e.target.value)}
            placeholder="What to run out of a timeout, who is hot, what they did to us last time…"
            aria-label={`Notes for ${title}`}
            // 16px or larger, or iOS zooms the page in on focus and does not
            // zoom back out — the same trap the what-if margin field hit.
            className="w-full min-h-[42dvh] resize-y rounded-lg border border-hairline bg-paper-deep/40 px-3.5 py-3 text-base leading-relaxed text-ink placeholder:text-ink-muted/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-coral/40"
          />
        </div>
      ) : (
        <MatchupsPane theirs={theirs} ours={ours} map={map} onGuard={onGuard} oppName={opp?.name ?? "them"} />
      )}
    </Sheet>
  );
}

/**
 * A score typed from the gym, before the organiser posts theirs.
 *
 * IT BEHAVES LIKE A REAL RESULT until it is replaced by one. Saving locks the
 * game out of What If, moves the table, and re-seeds the bracket — which is
 * the entire point of typing it courtside rather than waiting. It can be
 * edited or cleared as often as needed, and the organiser's number silently
 * replaces it the moment their result lands.
 *
 * A GAME THE FEED HAS ALREADY CALLED IS NOT EDITABLE. There would be nothing
 * to do with the entry: the reconciliation would drop it on the next poll, so
 * offering the field would be offering a change that undoes itself.
 */
function ScorePane({ g, ctx }: { g: Game; ctx: Ctx }) {
  const live = ctx.data.games.find((x) => x.id === g.id) ?? g;
  const typed = ctx.scores[g.id];
  const confirmed = typed === undefined && live.status === "final";
  const [a, setA] = useState(typed ? String(typed.a) : "");
  const [b, setB] = useState(typed ? String(typed.b) : "");

  const nameA = live.a.name, nameB = live.b.name;
  const na = Number(a), nb = Number(b);
  const valid = a.trim() !== "" && b.trim() !== "" && Number.isFinite(na) && Number.isFinite(nb) && na >= 0 && nb >= 0;
  const digits = (raw: string) => raw.replace(/\D/g, "").slice(0, 3);

  if (confirmed) {
    return (
      <div className="px-5 pt-4 pb-6">
        <p className="text-sm text-ink-soft">
          Final, from the organiser: <span className="font-semibold text-ink tabular">{nameA} {live.scoreA} – {live.scoreB} {nameB}</span>
        </p>
        <p className="mt-2 text-[0.7rem] text-ink-muted">Their result stands; there is nothing to enter.</p>
      </div>
    );
  }

  return (
    <div className="px-5 pt-4 pb-6">
      <div className="space-y-2.5">
        {([[nameA, a, setA], [nameB, b, setB]] as const).map(([name, val, set]) => (
          <label key={name} className="flex items-center gap-3">
            <span className="flex-1 min-w-0 truncate text-sm text-ink-soft">{name}</span>
            <input
              type="tel"
              inputMode="numeric"
              pattern="[0-9]*"
              value={val}
              onChange={(e) => set(digits(e.target.value))}
              aria-label={`${name} score`}
              placeholder="—"
              // 16px, or iOS zooms in on focus and stays there.
              className="w-20 h-11 rounded-lg border border-hairline bg-paper-deep/40 px-3 text-base tabular text-right text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-coral/40"
            />
          </label>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          disabled={!valid}
          onClick={() => ctx.writeScore(g.id, { a: na, b: nb })}
          className={cn(
            "h-9 px-4 rounded-md text-sm font-semibold transition-colors",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-coral/40",
            valid ? "bg-coral text-accent-foreground" : "bg-paper-deep text-ink-muted cursor-not-allowed",
          )}
        >
          {typed ? "Update score" : "Save score"}
        </button>
        {typed && (
          <button
            type="button"
            onClick={() => { ctx.writeScore(g.id, null); setA(""); setB(""); }}
            className="h-9 px-3 rounded-md border border-hairline text-sm text-ink-muted hover:text-ink transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Only once there is something to explain. Before a score is saved the
          two fields and a button say all there is to say. */}
      {typed && (
        <p className="mt-3 text-[0.7rem] leading-relaxed text-ink-muted">
          Counting in the table and the bracket, and locked out of What If. The organiser&rsquo;s result replaces it when it lands.
        </p>
      )}
    </div>
  );
}

/**
 * Who guards who: their roster down the page, ours as chips under whichever
 * of them is open.
 *
 * TAP THEIRS, THEN TAP OURS. The alternative — pick one of ours and assign
 * them a man — reads the wrong way round for the question a coach is actually
 * asking, which starts with the player they are worried about. Assignments
 * stay visible on every row whether or not it is open, so the plan can be read
 * without touching it.
 */
function MatchupsPane({ theirs, ours, map, onGuard, oppName }: {
  theirs: { name: string; captain?: boolean }[];
  ours: { name: string; captain?: boolean }[];
  map: Record<string, string[]>;
  onGuard: (theirName: string, ourName: string) => void;
  oppName: string;
}) {
  const [openFor, setOpenFor] = useState<string | null>(null);
  const covered = theirs.filter((t) => (map[t.name] ?? []).length > 0).length;

  if (theirs.length === 0) {
    return (
      <div className="px-5 pt-3 pb-6">
        <p className="text-sm text-ink-muted">
          No roster published for {oppName} yet — matchups can be set once the organiser lists their players.
        </p>
      </div>
    );
  }

  return (
    <div className="px-5 pt-3 pb-6">
      <p className="text-[0.65rem] uppercase tracking-widest text-ink-muted tabular">
        {covered} of {theirs.length} covered
      </p>
      <ul className="mt-2.5 divide-y divide-hairline/40">
        {theirs.map((t) => {
          const on = map[t.name] ?? [];
          const open = openFor === t.name;
          return (
            <li key={t.name}>
              <button
                type="button"
                onClick={() => setOpenFor(open ? null : t.name)}
                aria-expanded={open}
                className="w-full flex items-baseline gap-3 py-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-coral/40 rounded-sm"
              >
                <span className={cn("text-sm shrink-0", on.length ? "text-ink font-semibold" : "text-ink-soft")}>
                  {t.name}
                </span>
                <span className="ml-auto text-right text-[0.7rem] leading-snug text-coral">
                  {on.length ? on.map(firstName).join(", ") : <span className="text-ink-muted/70">—</span>}
                </span>
              </button>
              {open && (
                <div className="pb-3 flex flex-wrap gap-1.5">
                  {ours.map((o) => {
                    const picked = on.includes(o.name);
                    return (
                      <button
                        key={o.name}
                        type="button"
                        onClick={() => onGuard(t.name, o.name)}
                        aria-pressed={picked}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[0.8rem] transition-colors",
                          "focus:outline-none focus-visible:ring-2 focus-visible:ring-coral/40",
                          picked
                            ? "border-coral bg-coral text-accent-foreground font-semibold"
                            : "border-hairline text-ink-soft hover:border-ink-muted hover:text-ink",
                        )}
                      >
                        {firstName(o.name)}
                      </button>
                    );
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** "Sehan Gilani" → "Sehan". A bench calls people by their first name. */
function firstName(n: string): string {
  return n.trim().split(/\s+/)[0] ?? n;
}

/* ---------------------------------------------------------- team name --- */

/**
 * A team's name, clickable when there is a team behind it.
 *
 * A BRACKET SLOT IS NOT A TEAM. "Winner 4 of Group A" before the group has
 * finished has no roster to show, so it renders as plain text rather than a
 * button that opens nothing — a control that does nothing when pressed is
 * worse than no control.
 */
function TeamName({
  team, onOpen, className, children,
}: { team: Team | null; onOpen: (t: Team) => void; className?: string; children: React.ReactNode }) {
  if (!team) return <span className={className}>{children}</span>;
  return (
    <button
      type="button"
      onClick={() => onOpen(team)}
      // The card above opens a score on a double-click; a name is not that
      // card. Two quick clicks here mean the roster, twice, which is once.
      onDoubleClick={(e) => e.stopPropagation()}
      title={`${team.name} roster`}
      className={cn(
        "hover:text-coral hover:underline decoration-dotted underline-offset-4 transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-coral/40 rounded-sm",
        className,
      )}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------- roster sheet --- */

/**
 * The iOS sheet curve: it leaves fast and lands slowly, which is what makes a
 * panel feel thrown rather than driven. EXIT_MS is the travel time and also
 * how long the parent is made to wait before it unmounts us.
 */
const SHEET_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
const EXIT_MS = 320;

/**
 * The page's bottom sheet: a panel over the page, whatever is in it.
 *
 * IT EXISTS BECAUSE THERE ARE TWO OF THEM. The roster sheet came first and
 * carried all of this — the slide, the drag-to-dismiss, the focus handling,
 * the scroll lock — and a second sheet would have meant a second copy of the
 * hardest part of the file. The chrome is here; what goes in it is a child.
 *
 * Escape closes it, the backdrop closes it, and focus moves to the panel on
 * open and back to where it was on close — the things a native <dialog> would
 * give for free and that a div pretending to be one has to be told.
 */
function Sheet({ label, title, subtitle, accent = false, onClose, children }: {
  /** What a screen reader announces the dialog as. */
  label: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Coral edge and title — the followed team's roster, or a note on its game. */
  accent?: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  /**
   * IT SLIDES. A sheet that appears in one frame reads as a page swap; a
   * sheet that rises from the edge it is anchored to reads as the same page
   * with something pulled up over it, which is what this is.
   *
   * `shown` drives both directions: false on the first paint so the panel is
   * parked off-screen, true one frame later, and false again on the way out —
   * so the exit is the entrance played backwards rather than a second set of
   * rules. The panel outlives the closing gesture by one transition, which is
   * why `close` defers `onClose` (the parent unmounts us) until it ends.
   *
   * Phone and desktop are different objects: on a phone the panel is docked to
   * the bottom edge and travels its own height, on a desktop it is a centred
   * dialog, where sliding a full height would be theatre — it lifts a few
   * pixels and fades instead. `compact` is read once at mount because a sheet
   * lives for a few seconds and nobody rotates a phone mid-roster.
   */
  const compact = useRef(typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches);
  const still = useRef(typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [shown, setShown] = useState(false);
  const [drag, setDrag] = useState(0);
  const grab = useRef<{ id: number; startY: number; lastY: number; lastT: number; v: number } | null>(null);
  const closing = useRef(false);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    if (still.current) { onClose(); return; }
    setShown(false);
    window.setTimeout(onClose, EXIT_MS);
  }, [onClose]);

  const raf = useRef<number | null>(null);
  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null;
    panelRef.current?.focus({ preventScroll: true });
    // Two frames: the first paints the panel parked, the second starts the
    // transition. One frame is not enough — the browser can coalesce a mount
    // and a same-frame style change into a single paint, and the sheet simply
    // appears in place with no travel.
    const r1 = requestAnimationFrame(() => { const r2 = requestAnimationFrame(() => setShown(true)); raf.current = r2; });
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    /**
     * The page behind must not scroll while a sheet is over it — and must not
     * MOVE either. Hiding the overflow takes the scrollbar away with it, and
     * on a desktop that hands the page back fifteen pixels it did not have:
     * everything behind the sheet slid right and the margins jumped. The lock
     * pays that width back as padding, so the page underneath holds still.
     */
    const gap = window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = document.body.style.overflow;
    const prevPad = document.body.style.paddingRight;
    document.body.style.overflow = "hidden";
    if (gap > 0) document.body.style.paddingRight = `${gap}px`;
    return () => {
      cancelAnimationFrame(r1);
      if (raf.current) cancelAnimationFrame(raf.current);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPad;
      returnTo?.focus?.();
    };
  }, [close]);

  /**
   * DRAG IT DOWN TO DISMISS, from the handle or the title — the two places a
   * thumb lands. Dragging up meets resistance rather than a wall, so the sheet
   * feels attached to the finger either way, and the release decides on the
   * distance OR the throw: a short fast flick dismisses, a long slow drag that
   * stops short springs back.
   */
  const onGrab = (e: React.PointerEvent) => {
    if (!compact.current || still.current) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    grab.current = { id: e.pointerId, startY: e.clientY, lastY: e.clientY, lastT: performance.now(), v: 0 };
  };
  const onGrabMove = (e: React.PointerEvent) => {
    const g = grab.current;
    if (!g || g.id !== e.pointerId) return;
    const now = performance.now();
    const dt = Math.max(1, now - g.lastT);
    g.v = (e.clientY - g.lastY) / dt;
    g.lastY = e.clientY;
    g.lastT = now;
    const dy = e.clientY - g.startY;
    setDrag(dy > 0 ? dy : dy / 3);
  };
  const onGrabEnd = (e: React.PointerEvent) => {
    const g = grab.current;
    if (!g || g.id !== e.pointerId) return;
    const dy = e.clientY - g.startY;
    grab.current = null;
    if (dy > 96 || (g.v > 0.5 && dy > 24)) { close(); return; }
    setDrag(0);
  };

  const held = grab.current !== null;
  const parked = compact.current ? "translateY(100%)" : "translateY(14px) scale(0.985)";
  const panelStyle: React.CSSProperties = {
    transform: shown ? `translateY(${drag}px)` : parked,
    opacity: compact.current || shown ? 1 : 0,
    transition: still.current || held ? "none" : `transform ${EXIT_MS}ms ${SHEET_EASE}, opacity 200ms ease-out`,
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={close}
        // NOT bg-ink/40. `--ink` is warm cream on the dark theme, so an
        // ink scrim BRIGHTENED the page it was meant to dim — the sheet ended
        // up floating over a washed-out grey. A scrim means "less light",
        // which is black in both themes.
        // NO BACKDROP BLUR. It reads as a nice touch and costs a full-screen
        // filter pass every frame the sheet moves, on the one surface that has
        // to stay at sixty — the slide up, and a thumb dragging it back down.
        // A darker scrim separates the sheet from the page just as well.
        className="absolute inset-0 bg-black/60 transition-opacity duration-300 ease-out"
        style={{ opacity: shown ? 1 : 0, transition: still.current ? "none" : undefined }}
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        style={panelStyle}
        className={cn(
          "relative w-full sm:max-w-md max-h-[85dvh] overflow-y-auto bg-card border shadow-xl focus:outline-none will-change-transform",
          "rounded-t-2xl sm:rounded-xl",
          accent ? "border-coral/50" : "border-hairline",
        )}
      >
        <div
          className="sticky top-0 z-10 bg-card border-b border-hairline"
          onPointerDown={onGrab}
          onPointerMove={onGrabMove}
          onPointerUp={onGrabEnd}
          onPointerCancel={onGrabEnd}
        >
          {/* The grab bar is the affordance for the drag above, so it exists
              only where the drag does — a mouse has the backdrop and the X. */}
          <div className="sm:hidden flex justify-center pt-2.5 pb-0.5 touch-none cursor-grab active:cursor-grabbing" aria-hidden>
            <span className="h-1 w-9 rounded-full bg-ink-muted/40" />
          </div>
          <div className="flex items-baseline justify-between gap-3 px-5 pt-3.5 pb-4 sm:pt-4 touch-none sm:touch-auto">
            <div className="min-w-0">
              <h2 className={cn("font-display text-2xl leading-none truncate", accent ? "text-coral" : "text-ink")}>{title}</h2>
              {subtitle && (
                <p className="mt-1.5 text-[0.65rem] uppercase tracking-widest text-ink-muted tabular">{subtitle}</p>
              )}
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="shrink-0 grid h-8 w-8 place-items-center rounded-md border border-hairline text-ink-muted hover:text-ink transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
                <path d="M3 3l8 8M11 3l-8 8" />
              </svg>
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * One team's roster, over the page.
 *
 * REPLACED THE TEAMS TAB. Seven roster cards on their own screen answered a
 * question nobody arrives with; "who is on THAT team" is asked while looking
 * at that team's game, so the answer belongs one tap from the name rather
 * than a tab away and a tab back.
 */
function RosterSheet({ team, me, onClose }: { team: Team; me: Team | null; onClose: () => void }) {
  const mine = me?.id === team.id;
  return (
    <Sheet
      label={`${team.name} roster`}
      title={team.name}
      subtitle={`${team.players.length} player${team.players.length === 1 ? "" : "s"}`}
      accent={mine}
      onClose={onClose}
    >
      <ul className="divide-y divide-hairline/40 px-5 py-1">
        {team.players.map((p) => (
          <li key={p.name} className="flex items-center gap-4 py-2.5 text-sm text-ink-soft">
            <span className="flex-1 min-w-0">{p.name}</span>
            {p.captain && (
              <span className="shrink-0 text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">Captain</span>
            )}
          </li>
        ))}
        {team.players.length === 0 && <li className="py-3 text-sm text-ink-muted">No roster listed.</li>}
      </ul>
    </Sheet>
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

/**
 * "09:30 AM" → ["9:30", "AM"], so the badge can set the numerals at headline
 * size and leave the meridiem small beside them. Anything that does not parse
 * falls through whole rather than being mangled.
 */
function splitTime(t: string): [string, string] {
  const m = /^(\d{1,2}:\d{2})\s*(AM|PM)$/i.exec(t.trim());
  if (!m) return [timeLabel(t), ""];
  return [m[1]!.replace(/^0/, ""), m[2]!.toUpperCase()];
}

function shortRound(round: string): string {
  if (/^final/i.test(round)) return "F";
  if (/semi/i.test(round)) return "SF";
  if (/quarter/i.test(round)) return "QF";
  return "R1";
}

/**
 * "7205, Eldorado Parkway, McKinney, Collin County, Texas, …" → "7205 Eldorado
 * Parkway, McKinney, TX 75070". The geocoder's county and country are noise on
 * a page about one gym. It is the link's tooltip now rather than body copy: the
 * address is what the maps app needs, not what a reader wants three lines of.
 */
/**
 * "CIG - Central Ismaili Games" → "Central Ismaili Games". The organiser
 * prefixes the event with its own short code, which is the least useful half
 * of the name and was taking the most prominent line on the page.
 */
function eventTitle(n: string): string {
  return n.replace(/^[A-Za-z0-9]{2,6}\s*[-–·]\s*/, "").trim() || n;
}

function shortAddress(a: string): string {
  const parts = a.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 3) return a;
  const [num, street, city] = parts;
  const zip = parts.find((p) => /^\d{5}$/.test(p));
  return `${num} ${street}, ${city}, TX${zip ? ` ${zip}` : ""}`;
}


/* --------------------------------------------------------------- what if */

const PICKS_KEY = "cig-whatif";
const FILTER_KEY = "cig-whatif-team";
/** The "show everything" value. Not a team name, so it cannot collide with one. */
const ALL = "__all";

function readFilter(): string {
  try { return localStorage.getItem(FILTER_KEY) ?? ALL; } catch { return ALL; }
}

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
  /**
   * ONE TEAM AT A TIME, OPTIONALLY. Fourteen cards is the whole group and the
   * honest default, but the question a coach actually brings here is "what do
   * WE need", and answering it meant scrolling past ten games that are not
   * theirs. The filter narrows the cards; it does not narrow the maths — the
   * table beside them always projects the full group, because a seed depends
   * on games this team is not in.
   */
  const [only, setOnly] = useState<string>(() => (typeof window === "undefined" ? ALL : readFilter()));

  useEffect(() => {
    try { localStorage.setItem(PICKS_KEY, JSON.stringify(picks)); } catch { /* ignore */ }
  }, [picks]);
  useEffect(() => {
    try { localStorage.setItem(FILTER_KEY, only); } catch { /* ignore */ }
  }, [only]);

  const open = pickableGames(data);
  const played = data.games.filter((g) => g.stage === "group" && g.status === "final");
  const table = projectStandings(data, picks);
  const decided = open.filter((g) => picks[g.id]).length;
  // A stored name whose team is gone (a renamed entry, a different event)
  // would silently hide every card, so it falls back to showing everything.
  const team = only === ALL || !data.teams.some((t) => t.name === only) ? null : only;
  /**
   * EVERY GROUP GAME, IN THE ORDER IT IS PLAYED. Played games used to be
   * swept into an "Already played" section under the pickable ones, which
   * re-ordered the day and put the 9:30 above the 2:00 only if both were
   * still open. The tab is a schedule with controls on it, so it keeps the
   * schedule's order and a final game simply renders as a result instead of
   * a picker.
   */
  const all = data.games
    .filter((g) => g.stage === "group" && g.a.teamId !== null && g.b.teamId !== null)
    .filter((g) => !team || involves(g, team))
    .slice()
    .sort((x, y) => (x.startMs ?? 0) - (y.startMs ?? 0));

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

  const days = [...new Set(all.map((g) => g.date))].sort();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-8 items-start">
      <div className="space-y-7">
        <div className="space-y-3">
          {/* THE FILTER LEADS. It decides what the rest of the column contains,
              so it sits where reading starts rather than tucked in beside the
              progress count it has nothing to do with. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <Select value={team ?? ALL} onChange={setOnly} ariaLabel="Show one team's games" compact className="w-36">
              <option value={ALL}>All games</option>
              {data.teams.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
            </Select>
            <div className="flex items-center gap-3 shrink-0 mr-auto">
              {/* The count stays the WHOLE group even when the cards are one
                  team's, because it is the progress bar for the table beside
                  them, and that table needs all fourteen. */}
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
          {/* No instructions. Two buttons and a slider per card explain
              themselves, and a paragraph saying so was the first thing on the
              tab. The one thing that is NOT self-evident — that a played game
              cannot be picked — is said only once there is a played game. */}
          {played.length > 0 && (
            <p className="text-sm text-ink-muted max-w-xl">Games already played are locked and count for real.</p>
          )}
        </div>

        {open.length === 0 && (
          <p className="text-sm text-ink-muted">Every group game is final — the table beside this is the real one.</p>
        )}
        {all.length === 0 && team && (
          <p className="text-sm text-ink-muted">
            {team} has no group games. Choose another team, or All games.
          </p>
        )}

        {days.map((day) => {
          const games = all.filter((g) => g.date === day);
          return (
            <section key={day}>
              <SectionRule label={dayLabel(day)} count={games.length} />
              <div className="grid gap-2.5 sm:grid-cols-2">
                {games.map((g) => (
                  // A final game keeps its place in the day and shows the
                  // result; anything still to come gets the picker.
                  g.status === "final" ? (
                    <GameCard key={g.id} g={g} ctx={ctx} />
                  ) : (
                    <PickCard
                      key={g.id}
                      g={g}
                      pick={picks[g.id]}
                      me={me}
                      onWinner={(id) => setWinner(g, id)}
                      onMargin={(m) => setMargin(g, m)}
                    />
                  )
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <div className="lg:sticky lg:top-6">
        <ProjectedTable table={table} me={me} decided={decided} open={open.length} onOpen={ctx.openTeam} />
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
          <span className="text-[0.6rem] uppercase tracking-[0.12em] font-semibold text-ink-muted shrink-0">By</span>
          {/* TOUCH-ACTION NONE, or the slider does not work on a phone at all:
              a drag starting on the thumb is claimed by the page as a scroll
              gesture and the value never moves. `touch-action: none` tells the
              browser this element handles its own pointer, which is the whole
              fix. h-8 gives the thumb a real target rather than a hairline. */}
          <input
            type="range"
            min={0}
            max={MAX_MARGIN}
            step={1}
            value={pick?.margin ?? 0}
            onChange={(e) => onMargin(Number(e.target.value))}
            disabled={!pick}
            aria-label="Winning margin"
            className="flex-1 h-8 accent-coral touch-none"
          />
          {/* 16px TYPE IS LOAD-BEARING. iOS zooms the whole page in on focus
              for any input under 16px and does not zoom back out, which is what
              made tapping the number throw the layout around. text-base is the
              fix; the alternative — maximum-scale=1 on the viewport — would
              also stop a reader pinch-zooming anything on the site. */}
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_MARGIN}
            value={pick?.margin ?? 0}
            onChange={(e) => onMargin(Number(e.target.value))}
            disabled={!pick}
            aria-label="Winning margin in points"
            className="w-14 h-9 px-2 rounded-md border border-hairline bg-paper-deep/40 text-base text-ink tabular text-right focus:outline-none focus-visible:ring-2 focus-visible:ring-coral/40"
          />
          {/* Fixed width across both words, so the card does not twitch when a
              margin is set. */}
          <span className="text-[0.6rem] uppercase tracking-[0.12em] font-semibold text-ink-muted shrink-0 w-12 whitespace-nowrap">
            {/* "n/k" was the honest abbreviation and read like a form field.
                A zero margin here means the margin has not been set, not that
                the game was a tie, so it says so. */}
            {pick?.margin === 0 ? "not set" : "pts"}
          </span>
        </div>
      </div>
    </div>
  );
}

/** The seeding as the picks would leave it. */
function ProjectedTable({
  table, me, decided, open, onOpen,
}: { table: ProjRow[]; me: Team | null; decided: number; open: number; onOpen: (t: Team) => void }) {
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
          {complete ? "all picked" : `${open - decided} left`}
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
                    <TeamName team={r.team} onOpen={onOpen}>{r.team.name}</TeamName>
                    {i === 0 && ranked && <span className="text-[0.6rem] uppercase tracking-widest text-gold font-semibold">bye</span>}
                    {r.tied && r.gp > 0 && (
                      <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted" title="Same win % and differential as another team — the rulebook goes to a further tiebreak this cannot know">
                        tied
                      </span>
                    )}
                  </span>
                </td>
                <td className="py-2 pl-2.5 sm:pl-3 text-right">{r.w}-{r.l}</td>
                <td className={cn("py-2 pl-3 text-right font-semibold", r.diff > 0 && "text-good", r.diff < 0 && "text-bad")}>
                  {r.gp ? diffLabel(r.diff) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
