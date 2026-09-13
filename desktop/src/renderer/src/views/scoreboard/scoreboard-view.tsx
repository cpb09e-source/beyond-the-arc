import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { confDisplay } from "@/lib/conf-display";
import {
  dayNum,
  dowLabel,
  groupSlate,
  isLive,
  matchesSlateFilter,
  shiftDay,
  slateConferences,
  slateTournaments,
  todayEastern,
  weekDays,
  type ScoreGame,
} from "@/lib/scoreboard-core";
import { T } from "@/lib/team-game-index";
import { logDate } from "~/data/game-link";
import { loadTeamGameSeason } from "~/data/team-game-model";
import { loadOnce } from "~/data/use-corpus";
import { focusConf, focusTeam, sameConf, useFocusSubject } from "~/focus/focus-mode";
import { useIsActive } from "~/shell/active";
import { useShell } from "~/shell/shell-context";
import { useSetStatus } from "~/shell/status";
import { useTabTitle } from "~/shell/tab-title";
import { LoadError, ViewHeader } from "~/shell/view-parts";
import type { ViewProps } from "~/shell/views";
import { Popover } from "~/ui/popover";
import { SearchList, type ListItem } from "~/ui/search-list";
import { normalizeText } from "~/ui/text";
import {
  gameRecord,
  isKnownDay,
  latestDay,
  nextSeasonOpener,
  parseBoard,
  seasonOfDate,
  serializeBoard,
  sideOf,
  stepGameDay,
  useSlate,
  useTeamNames,
  type Board,
  type TeamNames,
} from "./board-model";
import { DayPicker } from "./day-picker";
import { objectDrag } from "~/objects/object";
import { useObjectMenu } from "~/objects/use-object-actions";
import { GameCard } from "./game-card";

/**
 * The Scoreboard: every game of a night, ranked games first, the rest grouped
 * by tournament and conference.
 *
 * THE SITE'S BOARD, ON THE SITE'S RULES. Grouping, filters, status and the line
 * all come from src/lib/scoreboard-core.ts; the archive's calendar from
 * src/lib/scoreboard-archive.ts. What the app adds is moving through it: [ and
 * ] step to the previous and next night with games, the week strip and the
 * calendar jump, and the arrow keys walk the cards like cells.
 *
 * THE NIGHT AND THE FILTER ARE THE TAB'S (see board-model), so a starred night
 * is that night, and Alt+Left goes back to the one before.
 */

const DAY_LONG = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" });
const DAY_SHORT = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
const dayLong = (d: string) => DAY_LONG.format(new Date(`${d}T12:00:00Z`));
const dayShort = (d: string) => DAY_SHORT.format(new Date(`${d}T12:00:00Z`));

const GROUP_LABEL: Record<string, string> = { NCAA: "NCAA Tournament" };

/** What the filter box searches on a game: both names, ours and CBBD's, and both conferences. */
function hayOf(g: ScoreGame, names: TeamNames | null): string {
  const a = sideOf(names, g.away.team);
  const h = sideOf(names, g.home.team);
  return normalizeText(
    [g.away.team, a.ours, g.home.team, h.ours, g.away.conference && confDisplay(g.away.conference), g.home.conference && confDisplay(g.home.conference)]
      .filter(Boolean)
      .join(" "),
  );
}

export function ScoreboardView({ query, setQuery }: ViewProps) {
  const board = useMemo(() => parseBoard(query), [query]);
  const setBoard = (patch: Partial<Board>) => setQuery(serializeBoard({ ...board, ...patch }));
  const season = seasonOfDate(board.date);

  const [state, retry] = useSlate(board.date);
  const namesState = useTeamNames();
  const names = namesState.status === "ready" ? namesState.value : null;
  const slate = state.status === "ready" ? state.value : null;
  const games = useMemo(() => slate?.games ?? [], [slate]);
  const ready = state.status === "ready" && namesState.status !== "loading";

  const [text, setText] = useState("");
  const words = normalizeText(text).split(" ").filter(Boolean);
  const shown = useMemo(
    () => (words.length ? games.filter((g) => words.every((w) => hayOf(g, names).includes(w))) : games),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [games, names, words.join(" ")],
  );
  const { ranked, groups } = useMemo(() => groupSlate(shown, board.filter), [shown, board.filter]);
  const visible = ranked.length + groups.reduce((n, [, list]) => n + list.length, 0);

  const { openRecord } = useShell();
  const menu = useObjectMenu();

  // Focus: every other game steps back, and the week strip marks the nights the focused team played.
  const focusSubject = useFocusSubject();
  const fTeam = focusTeam(focusSubject);
  const fConf = focusSubject?.kind === "conference" ? focusConf(focusSubject) : null;
  const involved = (g: ScoreGame): boolean | undefined => {
    if (fTeam) return sideOf(names, g.away.team).ours === fTeam || sideOf(names, g.home.team).ours === fTeam;
    if (fConf) return sameConf(fConf, g.away.conference) || sameConf(fConf, g.home.conference);
    return undefined;
  };
  const nights = useTeamNights(season, fTeam);
  const openGame = (g: ScoreGame, how: { newTab: boolean; side: boolean }) =>
    openRecord(gameRecord(season, g, names), { newTab: how.newTab, side: how.side, year: season });

  const step = (dir: -1 | 1) => {
    const d = stepGameDay(board.date, dir);
    if (d) setBoard({ date: d });
  };

  // [ and ] walk the nights, the way they walk seasons everywhere else.
  const active = useIsActive();
  const gridRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable))) return;
      if (e.key === "[" || e.key === "]") {
        e.preventDefault();
        step(e.key === "[" ? -1 : 1);
        return;
      }
      // An arrow with no card in focus picks up the first one.
      if (["ArrowDown", "ArrowRight", "j"].includes(e.key) && !gridRef.current?.contains(document.activeElement)) {
        const first = gridRef.current?.querySelector<HTMLElement>("[data-card]");
        if (first) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const [focusId, setFocusId] = useState<number | null>(null);
  const firstId = ranked[0]?.id ?? groups[0]?.[1][0]?.id ?? null;
  const focusable = (id: number) => (focusId != null && [...ranked, ...groups.flatMap(([, l]) => l)].some((g) => g.id === focusId) ? id === focusId : id === firstId);

  /** Arrows move between cards as a grid: across a row, and to the nearest card above or below. */
  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const cards = [...(gridRef.current?.querySelectorAll<HTMLElement>("[data-card]") ?? [])];
    const i = cards.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    let to = -1;
    if (e.key === "ArrowRight" || e.key === "l") to = i + 1;
    else if (e.key === "ArrowLeft" || e.key === "h") to = i - 1;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = cards.length - 1;
    else if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "j" || e.key === "k") {
      const down = e.key === "ArrowDown" || e.key === "j";
      const r = cards[i]!.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      let best: { j: number; dy: number; dx: number } | null = null;
      cards.forEach((el, j) => {
        const q = el.getBoundingClientRect();
        const dy = down ? q.top - r.bottom : r.top - q.bottom;
        if (dy < -2) return;
        const dx = Math.abs(q.left + q.width / 2 - cx);
        if (!best || dy < best.dy - 4 || (Math.abs(dy - best.dy) <= 4 && dx < best.dx)) best = { j, dy, dx };
      });
      to = best ? (best as { j: number }).j : -1;
    } else return;
    e.preventDefault();
    const el = cards[Math.max(0, Math.min(cards.length - 1, to))];
    if (el) {
      el.focus();
      el.scrollIntoView({ block: "nearest" });
    }
  };

  const setStatus = useSetStatus();
  const liveCount = games.filter(isLive).length;
  useEffect(() => {
    if (state.status === "loading") setStatus("Loading…");
    else if (state.status === "error") setStatus("Not loaded");
    else setStatus(liveCount ? `${liveCount} in progress` : `${games.length} ${games.length === 1 ? "game" : "games"} · ${season - 1}-${String(season).slice(2)}`);
  }, [state.status, games.length, liveCount, season, setStatus]);

  useTabTitle(`Scores · ${dayShort(board.date)}, ${board.date.slice(0, 4)}`);

  return (
    <>
      <ViewHeader
        kicker="Games"
        title="Scoreboard"
        year={season}
        season={false}
        controls={<DateNav date={board.date} onDate={(d) => setBoard({ date: d })} onStep={step} />}
        meta={
          ready
            ? words.length || board.filter
              ? `${visible} of ${games.length} ${games.length === 1 ? "game" : "games"}`
              : `${games.length} ${games.length === 1 ? "game" : "games"}`
            : undefined
        }
        filter={{ value: text, onChange: setText, placeholder: "Filter teams" }}
      />

      <WeekStrip date={board.date} onPick={(d) => setBoard({ date: d })} marked={nights} />

      {ready && games.length > 0 && <FilterRow games={shown} filter={board.filter} onFilter={(f) => setBoard({ filter: f })} />}

      <div ref={gridRef} onKeyDown={onGridKey} className="min-h-0 flex-1 overflow-y-auto border-t border-hairline px-5 pb-12 pt-4">
        {state.status === "error" ? (
          <LoadError year={season} reason={state.reason} message={state.message} what="Scores" onRetry={retry} />
        ) : !ready ? (
          <CardSkeleton />
        ) : games.length === 0 ? (
          <NoGames date={board.date} onDate={(d) => setBoard({ date: d })} />
        ) : visible === 0 ? (
          <p className="py-10 text-[13px] text-ink-muted">
            No game tonight matches{text.trim() ? <> &ldquo;{text.trim()}&rdquo;</> : " that filter"}.{" "}
            <button
              type="button"
              onClick={() => {
                setText("");
                setBoard({ filter: "" });
              }}
              className="text-accent hover:underline"
            >
              Show every game
            </button>
          </p>
        ) : (
          <div className="flex flex-col gap-6">
            {ranked.length > 0 && (
              <CardSection label="Top 25" accent count={ranked.length}>
                {ranked.map((g) => (
                  <GameCard key={`r-${g.id}`} g={g} names={names} focused={focusable(g.id)} onFocus={() => setFocusId(g.id)} onOpen={(how) => openGame(g, how)} onMenu={(e) => menu(e, gameRecord(season, g, names))} drag={objectDrag(gameRecord(season, g, names))} focus={involved(g)} />
                ))}
              </CardSection>
            )}
            {groups.map(([key, list]) => (
              <CardSection key={key} label={GROUP_LABEL[key] ?? key} count={list.length}>
                {list.map((g) => (
                  <GameCard key={g.id} g={g} names={names} focused={focusable(g.id)} onFocus={() => setFocusId(g.id)} onOpen={(how) => openGame(g, how)} onMenu={(e) => menu(e, gameRecord(season, g, names))} drag={objectDrag(gameRecord(season, g, names))} focus={involved(g)} />
                ))}
              </CardSection>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function CardSection({ label, count, accent = false, children }: { label: string; count: number; accent?: boolean; children: ReactNode }) {
  return (
    <section aria-label={label}>
      <h2 className="mb-2 flex items-center gap-2 text-[12px] font-medium">
        <span className={accent ? "text-accent" : "text-ink-soft"}>{label}</span>
        <span className="text-ink-muted tabular">{count}</span>
        <span aria-hidden className="h-px flex-1 bg-hairline" />
      </h2>
      <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(292px, 1fr))" }}>
        {children}
      </div>
    </section>
  );
}

function CardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading scores" className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(292px, 1fr))" }}>
      {Array.from({ length: 12 }, (_, i) => (
        <div key={i} className="flex h-[112px] flex-col gap-3 rounded-lg border border-hairline bg-card px-3 py-3">
          <span className="skeleton h-[8px] w-[64px] rounded" />
          <span className="skeleton h-[10px] rounded" style={{ width: `${60 + ((i * 17) % 30)}%` }} />
          <span className="skeleton h-[10px] rounded" style={{ width: `${55 + ((i * 23) % 35)}%` }} />
        </div>
      ))}
    </div>
  );
}

function NoGames({ date, onDate }: { date: string; onDate: (d: string) => void }) {
  const before = stepGameDay(date, -1);
  const after = stepGameDay(date, 1);
  const opener = nextSeasonOpener();
  return (
    <div className="grid place-content-center gap-2 py-16 text-center">
      <p className="text-[14px] font-medium text-ink">No games on {dayLong(date)}.</p>
      <p className="text-[12.5px] text-ink-muted">College basketball runs from November into April.</p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        {before && <QuietButton onClick={() => onDate(before)}>{`Back to ${dayShort(before)}`}</QuietButton>}
        {after && after !== opener && <QuietButton onClick={() => onDate(after)}>{`On to ${dayShort(after)}`}</QuietButton>}
        {date !== latestDay() && <QuietButton onClick={() => onDate(latestDay())}>Latest night</QuietButton>}
        {opener && opener > date && <QuietButton onClick={() => onDate(opener)}>{`Opening night, ${dayShort(opener)}`}</QuietButton>}
      </div>
    </div>
  );
}

function QuietButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="h-[28px] rounded-md border border-hairline bg-card px-2.5 text-[12.5px] text-ink-soft transition-colors hover:border-ink-muted hover:text-ink"
    >
      {children}
    </button>
  );
}

/** ‹ the night › — the arrows skip to the nearest night with games, the date opens a calendar. */
function DateNav({ date, onDate, onStep }: { date: string; onDate: (d: string) => void; onStep: (dir: -1 | 1) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <div className="flex items-center gap-0.5">
      <StepButton label="Previous night with games  ·  [" onClick={() => onStep(-1)} disabled={!stepGameDay(date, -1)}>
        <ChevronLeft size={15} strokeWidth={2} />
      </StepButton>
      <button
        ref={ref}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex h-[26px] items-center gap-1.5 rounded-md border border-hairline bg-card px-2 text-[12.5px] font-medium text-ink transition-colors hover:border-ink-muted ${
          open ? "border-ink-muted" : ""
        }`}
      >
        <CalendarDays size={13} strokeWidth={2} className="text-ink-muted" />
        {dayLong(date)}
      </button>
      <StepButton label="Next night with games  ·  ]" onClick={() => onStep(1)} disabled={!stepGameDay(date, 1)}>
        <ChevronRight size={15} strokeWidth={2} />
      </StepButton>
      {open && (
        <DayPicker
          anchor={ref}
          value={date}
          onPick={(d) => {
            onDate(d);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function StepButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="grid size-[26px] place-items-center rounded-md text-ink-muted transition-colors enabled:hover:bg-[var(--row-hover)] enabled:hover:text-ink disabled:opacity-35"
    >
      {children}
    </button>
  );
}

/** Seven days around the night shown; the arrows page a week without leaving it. */
function WeekStrip({ date, onPick, marked }: { date: string; onPick: (d: string) => void; marked?: ReadonlySet<string> | null }) {
  const [anchor, setAnchor] = useState(date);
  const [last, setLast] = useState(date);
  if (date !== last) {
    setLast(date);
    setAnchor(date);
  }
  const today = todayEastern();
  return (
    <div className="flex shrink-0 items-stretch gap-1 px-5 pb-3">
      <StepButton label="Previous week" onClick={() => setAnchor(shiftDay(anchor, -7))} disabled={false}>
        <ChevronLeft size={15} strokeWidth={2} />
      </StepButton>
      <div className="grid min-w-0 flex-1 grid-cols-7 gap-1">
        {weekDays(anchor).map((d) => {
          const chosen = d === date;
          const games = isKnownDay(d);
          return (
            <button
              key={d}
              type="button"
              aria-current={chosen ? "date" : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(d)}
              className={`relative flex h-[42px] min-w-0 flex-col items-center justify-center rounded-md border leading-tight transition-colors ${
                chosen
                  ? "border-accent bg-[var(--accent-wash)]"
                  : games
                    ? "border-hairline bg-card hover:border-ink-muted"
                    : "border-transparent"
              }`}
            >
              <span className={`text-[10.5px] uppercase tracking-[0.06em] ${chosen ? "text-accent" : "text-ink-muted"}`}>{dowLabel(d)}</span>
              <span
                className={`text-[12.5px] ${
                  chosen ? "font-semibold text-ink" : games ? "text-ink-soft" : "text-[color-mix(in_oklab,var(--ink-muted)_55%,transparent)]"
                }`}
              >
                {dayNum(d) === "1" || d === weekDays(anchor)[0] ? dayShort(d) : dayNum(d)}
              </span>
              {d === today && <span aria-label="today" className="absolute right-[6px] top-[6px] size-[4px] rounded-full bg-accent" />}
              {marked?.has(d) && <span aria-label="The focused team played" className="absolute bottom-[3px] left-1/2 h-[3px] w-[14px] -translate-x-1/2 rounded-full bg-accent" />}
            </button>
          );
        })}
      </div>
      <StepButton label="Next week" onClick={() => setAnchor(shiftDay(anchor, 7))} disabled={false}>
        <ChevronRight size={15} strokeWidth={2} />
      </StepButton>
    </div>
  );
}

/** The nights a team played in a season, from the Team Game Log's file, while Focus asks for them. */
function useTeamNights(season: number, team: string | null): ReadonlySet<string> | null {
  const [found, setFound] = useState<{ key: string; set: Set<string> } | null>(null);
  const key = `${season}|${team ?? ""}`;
  useEffect(() => {
    if (!team) return;
    let stale = false;
    loadOnce(`team-games|${season}`, () => loadTeamGameSeason(season)).then(
      (s) => {
        if (!stale) setFound({ key, set: new Set(s.games.filter((g) => g.team === team).map((g) => logDate(s.pack.epochMs, g.row[T.d]!))) });
      },
      () => {
        if (!stale) setFound({ key, set: new Set() });
      },
    );
    return () => {
      stale = true;
    };
  }, [season, team, key]);
  return team && found?.key === key ? found.set : null;
}

/** What to show: everything, a tournament, the ranked games, a tier, or one conference. */
function FilterRow({ games, filter, onFilter }: { games: ScoreGame[]; filter: string; onFilter: (f: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const count = (token: string) => games.filter((g) => matchesSlateFilter(g, token)).length;
  const chips = [
    { token: "", label: "All" },
    ...slateTournaments(games).map((t) => ({ token: `@t:${t}`, label: GROUP_LABEL[t] ?? t })),
    { token: "@top25", label: "Top 25" },
    { token: "@power", label: "Power conferences" },
    { token: "@mid", label: "Mid-majors" },
  ]
    .map((c) => ({ ...c, n: c.token ? count(c.token) : games.length }))
    .filter((c) => c.token === "" || c.n > 0);
  const confs = slateConferences(games);
  const isConf = !!filter && !filter.startsWith("@");
  const confItems: ListItem[] = confs.map((c) => ({ key: c, label: c, meta: String(count(c)) }));

  return (
    <div role="group" aria-label="Show" className="flex shrink-0 flex-wrap items-center gap-1.5 px-5 pb-3">
      {chips.map((c) => {
        const on = filter === c.token;
        return (
          <button
            key={c.token || "all"}
            type="button"
            aria-pressed={on}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onFilter(c.token)}
            className={`inline-flex h-[24px] items-center gap-1.5 rounded-md border px-2 text-[12px] transition-colors ${
              on ? "border-accent bg-[var(--accent-wash)] text-ink" : "border-hairline text-ink-soft hover:border-ink-muted hover:text-ink"
            }`}
          >
            {c.label}
            <span className="text-[11px] text-ink-muted tabular">{c.n}</span>
          </button>
        );
      })}
      {confs.length > 0 && (
        <button
          ref={ref}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen((o) => !o)}
          className={`inline-flex h-[24px] items-center gap-1 rounded-md border px-2 text-[12px] transition-colors ${
            isConf ? "border-accent bg-[var(--accent-wash)] text-ink" : "border-hairline text-ink-soft hover:border-ink-muted hover:text-ink"
          }`}
        >
          {isConf ? filter : "Conference"}
          {isConf && <span className="text-[11px] text-ink-muted tabular">{count(filter)}</span>}
          <ChevronDown size={13} strokeWidth={2} className="text-ink-muted" />
        </button>
      )}
      {open && (
        <Popover anchor={ref} onClose={() => setOpen(false)} width={260} label="Conference">
          <SearchList
            items={confItems}
            label="Conferences"
            placeholder="Find a conference"
            selected={new Set(isConf ? [filter] : [])}
            onPick={(k) => {
              onFilter(k === filter ? "" : k);
              setOpen(false);
            }}
            onClose={() => setOpen(false)}
          />
        </Popover>
      )}
    </div>
  );
}
