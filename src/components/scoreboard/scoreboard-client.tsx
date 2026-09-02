"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { TeamLogo } from "@/components/team-logo";
import { confDisplay } from "@/lib/conf-display";
import { isPowerConference } from "@/lib/conf-tiers";
import { cn } from "@/lib/utils";
import { Select } from "@/components/select";
import { IS_DEMO } from "@/lib/flags";
import { DatePicker } from "./date-picker";
import {
  EMPTY_SLATE, POLL_MS, dateLabel, fetchSlate, gameHref, isFinal, isLive, isRanked, lineLabel, recordLabel, slateIsSettled, tipLabel,
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
  //
  // In demo mode there is exactly ONE baked day, so the heading is pinned to it
  // and the day controls are hidden below. Left in, they would relabel the same
  // 128 games with whatever date you clicked, which is a worse answer than not
  // offering the control.
  const shown = IS_DEMO ? (slate.date ?? "2026-02-07") : (pinned ?? slate.date ?? todayEastern());

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

  /**
   * The filter takes a GROUP token or a single conference's display name.
   *
   * Tokens are prefixed so they can never collide with a real conference name.
   * A night's slate is thirty-odd leagues deep and the question a reader
   * actually arrives with is nearly always one of four — everything, the
   * ranked games, the high-major games, or everyone else — and answering that
   * used to mean knowing which of thirty entries to pick.
   *
   * POWER AND MID ARE A PARTITION, not two overlapping filters. Power is any
   * game with a high-major team on either side; mid is every game with none.
   * Together they are the whole slate and nothing appears twice, so a reader
   * flipping between them sees each game exactly once. Defining mid as "any
   * game involving a mid-major" instead would put Duke at Vermont in both,
   * which reads as a bug.
   *
   * isPowerConference, NOT POWER_CONFS directly. The scoreboard feed spells
   * conferences its own way — "Big Ten", "Big 12", "Big East" — while
   * POWER_CONFS holds Bart's codes. Only ACC and SEC collide, so a direct
   * lookup half-worked and put Arizona under Mid Majors. See the long note in
   * conf-tiers.ts.
   */
  const isPowerGame = (g: ScoreGame) =>
    isPowerConference(g.home.conference) || isPowerConference(g.away.conference);

  // Matches on EITHER side for a named conference, so picking the Big Ten keeps
  // a Big Ten team's non-conference game — the thing a reader following that
  // league wants.
  const inConf = (g: ScoreGame) => {
    if (!conf) return true;
    if (conf === "@top25") return isRanked(g);
    if (conf === "@power") return isPowerGame(g);
    if (conf === "@mid") return !isPowerGame(g);
    return Boolean(
      (g.home.conference && confDisplay(g.home.conference) === conf) ||
      (g.away.conference && confDisplay(g.away.conference) === conf),
    );
  };

  // Conference games group under their own conference; everything else is
  // non-conference. Sorted by tip so the page reads down the evening.
  //
  // Ranked games are EXCLUDED here, because they already lead the page under
  // Top 25 and printing them twice made the ACC read as if Duke played North
  // Carolina in two different buildings. Top 25 is filtered by the same
  // conference selection, so choosing the ACC still shows its ranked games —
  // just once, at the top, where they belong.
  const groups = useMemo(() => {
    const m = new Map<string, ScoreGame[]>();
    for (const g of slate.games) {
      if (!inConf(g) || isRanked(g)) continue;
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
  // matchup first). These are the ONLY place a ranked game appears; the
  // conference groups below skip them.
  const ranked = useMemo(() => slate.games.filter(isRanked), [slate.games]);


  const liveCount = slate.games.filter(isLive).length;

  return (
    <div className="mx-auto max-w-7xl px-6 lg:px-10 pt-6 pb-20">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
        <div>
          <div className="text-[0.6rem] uppercase tracking-[0.18em] text-coral font-bold mb-1.5 flex items-center gap-2">
            <span className="h-px w-6 bg-coral" />
            {IS_DEMO
              ? "Sample slate"
              : slate.source === "live" && liveCount > 0
              ? `${liveCount} game${liveCount === 1 ? "" : "s"} in progress`
              : slate.source === "upcoming"
              ? "Next up"
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
                  // No demo caption. The eyebrow above already says "Sample
                  // slate", so explaining it again under the count was the
                  // page apologising for itself in the one place a reader
                  // looks for the number.
                  slate.source === "live"
                    ? " · updating every minute"
                    : slate.source === "upcoming"
                    ? " · none tipped yet"
                    : ""
                }`}
          </p>
        </div>

        {/* Jump straight to a date. A native date input is deliberate: it gives
            the platform's own calendar, keyboard entry, and localisation for
            free, and on a phone it opens the OS picker — all things a
            hand-rolled calendar would have to reimplement worse. */}
        {!IS_DEMO && (
          <div className="flex items-center gap-2">
            <span className="text-[0.6rem] uppercase tracking-[0.12em] font-semibold text-ink-muted">Jump to</span>
            <DatePicker value={shown} onChange={setPinned} />
          </div>
        )}
      </div>

      {/* Week strip: the shown day centred, three either side, arrows stepping a
          week at a time. Gives the whole week at a glance and makes "the night
          before" one tap instead of a round trip through the picker. */}
      {!IS_DEMO && <WeekStrip shown={shown} onPick={setPinned} />}

      {confOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-6">
          {/* "Show", not "Conference" — two of the four groups above the divider
              are not conferences, and a label that says otherwise makes Top 25
              look misfiled. */}
          <span className="text-[0.6rem] uppercase tracking-[0.12em] font-semibold text-ink-muted">Show</span>
          <Select
            value={conf}
            onChange={setConf}
            ariaLabel="Filter the slate"
          >
            <option value="">All</option>
            <option value="@top25">Top 25</option>
            <option value="@power">Power Conferences</option>
            <option value="@mid">Mid Majors</option>
            {/* The individual leagues stay, under the four groups rather than
                instead of them. Someone who follows one conference is exactly
                the reader most likely to use this control, and the groups
                answer the common question without taking that away. */}
            {/* A distinct value, not "" — the Select keys options by value and
                reusing "" collided with All, which React reports as two
                children with the same key. Disabled, so it can never be
                chosen; unreachable in inConf either way. */}
            {confOptions.length > 0 && (
              <option value="@divider" disabled>──────────</option>
            )}
            {confOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
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
            <Link href="/" className="text-coral hover:underline" prefetch={false}>team explorer</Link> in the meantime.
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
  // The window the strip is SHOWING, which is not the same thing as the day
  // that is selected. Arrows move this and nothing else: paging to next week
  // should let you look at it before committing, not silently swap the slate
  // out from under you and fire a fetch for a day you never asked for.
  const [anchor, setAnchor] = useState(shown);
  // Re-centre when the selection changes from outside (calendar, a day click).
  // Adjust-during-render rather than an effect, so the strip never paints one
  // frame around the old week.
  const [lastShown, setLastShown] = useState(shown);
  if (shown !== lastShown) {
    setLastShown(shown);
    setAnchor(shown);
  }

  const days = [-3, -2, -1, 0, 1, 2, 3].map((n) => shiftDay(anchor, n));
  const today = todayEastern();
  return (
    <div className="flex items-stretch gap-1 mb-6">
      <StripArrow label="Previous week" onClick={() => setAnchor(shiftDay(anchor, -7))}>‹</StripArrow>
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
              <span className="text-[0.55rem] uppercase tracking-widest font-semibold">{dowLabel(d)}</span>
              <span className={cn("text-sm tabular leading-none", active && "font-bold")}>{dayNum(d)}</span>
              {/* A quiet marker for the real today, so a reader three weeks deep
                  in February still knows where the present is. */}
              {d === today && <span className="h-1 w-1 rounded-full bg-coral" aria-label="today" />}
            </button>
          );
        })}
      </div>
      <StripArrow label="Next week" onClick={() => setAnchor(shiftDay(anchor, 7))}>›</StripArrow>
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
  const line = lineLabel(g);
  // Halves only once they exist. A scheduled game has none, and a live first
  // half has one — an empty "2H" column would read as a zero.
  const halves = Math.max(g.home.periods.length, g.away.periods.length);
  const labels = periodLabels(halves);
  return (
    <div className={cn(
      "relative bg-card border rounded-xl shadow-sm overflow-hidden transition-colors",
      live ? "border-coral/40 ring-1 ring-coral/15" : "border-ink/10 hover:border-ink/25",
    )}>
      {/* The whole card opens the game. A stretched overlay rather than a Link
          wrapping the card, because the two team names inside are links of
          their own and an anchor may not contain another one. The team links
          are lifted above it so they still win a click on the name. */}
      <Link
        href={gameHref(g)}
        aria-label={`${g.away.team} at ${g.home.team} — full box score`}
        className="absolute inset-0 z-1 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-coral/50" prefetch={false} />
      <div className="flex items-center justify-between gap-2 px-4 pt-3">
        {/* THE CREST ANSWERS "WHOSE GYM IS THIS". An arena name only reads as
            a home team if you already know it — Gill Coliseum is Oregon State
            to about a thousand people and a place name to everyone else. The
            home side is otherwise signalled only by the small `@` beside the
            away team, which is easy to miss at this size.

            Nothing on a NEUTRAL site, because there is no home team to name and
            a crest there would assert one. */}
        <span className="flex items-center gap-1.5 min-w-0 text-[0.58rem] uppercase tracking-[0.12em] font-semibold text-ink-muted">
          {!g.neutralSite && g.venue && (
            <TeamLogo name={g.home.team} size={14} className="shrink-0 opacity-80" />
          )}
          <span className="truncate">{g.neutralSite ? "Neutral site" : g.venue ?? ""}</span>
        </span>
        <span className={cn(
          "shrink-0 text-[0.58rem] uppercase tracking-[0.12em] font-bold tabular",
          live ? "text-coral" : "text-ink-muted",
        )}>
          {live ? `${g.clock ?? "Live"}${g.period != null ? ` · ${ordinalPeriod(g.period)}` : ""}`
            : final ? "Final" : tipLabel(g.startDate)}
        </span>
      </div>

      <div className="px-4 pb-3">
        {halves > 0 && (
          <div className="flex items-center gap-2 pb-1 text-[0.5rem] uppercase tracking-widest font-bold text-ink-muted/70">
            <span className="flex-1" />
            {labels.map((p) => <span key={p} className="w-7 text-center">{p}</span>)}
            <span className="w-10 text-right">T</span>
          </div>
        )}
        {/* A hairline between the two rows rather than around them: the pair is
            one result, and a divider inside reads as the scoreline it is. */}
        <div className="divide-y divide-hairline/60">
          <TeamRow t={g.away} final={final} halves={halves} at={false} />
          <TeamRow t={g.home} final={final} halves={halves} at={!g.neutralSite} />
        </div>
      </div>

      {/* The pre-tip line rides the paper-deep wash the headline cards use for
          their meta band: context for the result above it, not a headline.
          Absent for most small-conference games, so it collapses rather than
          reserving space. */}
      {line && (
        <div className="px-4 py-2 border-t border-hairline bg-paper-deep/30 flex items-center gap-1.5 text-[0.6rem] text-ink-muted">
          <span className="uppercase tracking-widest font-semibold text-ink-muted/70">Line</span>
          <span className="tabular">{line}</span>
        </div>
      )}
    </div>
  );
}

/** ["1H","2H","OT","2OT"] for however many periods were played. */
function periodLabels(n: number): string[] {
  return Array.from({ length: n }, (_, i) => (i === 0 ? "1H" : i === 1 ? "2H" : i === 2 ? "OT" : `${i - 1}OT`));
}

function TeamRow({ t, final, halves, at }: { t: ScoreGame["home"]; final: boolean; halves: number; at: boolean }) {
  const won = final && t.winner === true;
  const rec = recordLabel(t);
  return (
    <div className="flex items-center gap-2 py-1.5">
      {/* "@" marks the HOME team: in "Duke @ North Carolina" the glyph attaches
          to the host, because the game is played AT their building. It used to
          sit on the road team, which read "@ Gonzaga" while Gonzaga stood in
          Gill Coliseum, Oregon State's floor. Neutral-site games carry no
          glyph; the venue line above already says "Neutral site". */}
      <span className="w-2 shrink-0 text-[0.6rem] text-ink-muted/70 tabular">{at ? "@" : ""}</span>
      <TeamLogo name={t.team} size={20} />
      {/* Poll rank displaces tournament seed where a team carries both — two
          small numerals beside one team read as a score. */}
      {t.rank != null ? <RankBadge rank={t.rank} /> : t.seed != null ? (
        <span className="text-[0.6rem] text-ink-muted tabular">{t.seed}</span>
      ) : null}
      <Link
        href={`/teams/${teamSlug(t.team)}`}
        className={cn("relative z-2 min-w-0 truncate text-sm hover:text-coral transition-colors", won ? "text-ink font-semibold" : "text-ink-soft")} prefetch={false}>
        {t.team}
      </Link>
      {rec && <span className="shrink-0 text-[0.6rem] text-ink-muted tabular">({rec})</span>}

      <span className="ml-auto flex items-center">
        {halves > 0 && Array.from({ length: halves }, (_, i) => (
          <span key={i} className="w-7 text-center text-[0.7rem] tabular text-ink-muted">
            {t.periods[i] ?? "—"}
          </span>
        ))}
        {/* The total in the SAME face as the half scores beside it, one size up
            and bold. The display face draws `1` as a bare stem with no flag or
            foot, so 81 set in it reads "8I" directly above a 38 and a 43 that
            are set in the sans — two typefaces disagreeing about what a digit
            looks like, inside one row of numbers. */}
        <span className={cn(
          "text-right tabular text-lg font-bold leading-none",
          halves > 0 ? "w-10" : "w-auto pl-2",
          won ? "text-ink" : "text-ink-muted",
        )}>
          {t.points ?? "—"}
        </span>
      </span>
    </div>
  );
}

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
