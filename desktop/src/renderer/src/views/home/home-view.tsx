import { ArrowRight, Sparkles } from "lucide-react";
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { PercentileChip } from "@/components/percentile-chip";
import type { ScoreGame, Slate } from "@/lib/scoreboard-core";
import { groupSlate } from "@/lib/scoreboard-core";
import { SEASON_CEIL } from "@/lib/seasons";
import type { StaticTeamSeasonRow } from "@/lib/static-data";
import { loadPlayerSeason, type Player } from "~/data/player-model";
import { shapeSeason, type Team } from "~/data/team-model";
import { useCorpus, useLoaded } from "~/data/use-corpus";
import { useRecents, type Visit } from "~/shell/recents";
import { useShell } from "~/shell/shell-context";
import { useSetStatus } from "~/shell/status";
import { viewById, type ViewProps } from "~/shell/views";
import { seasonLabel, signed1 } from "~/ui/format";
import { Kbd } from "~/ui/kbd";
import { TeamLogo } from "~/ui/logo";
import { PlayerPhoto } from "~/ui/player-photo";
import { CoachAvatar } from "~/ui/coach-avatar";
import { gameRecord, latestDay, nextSeasonOpener, seasonOfDate, stepGameDay, useTeamNames } from "~/views/scoreboard/board-model";
import { GameCard } from "~/views/scoreboard/game-card";

/**
 * Home: where the app opens, and where to go back to.
 *
 * THE FIRST SCREEN SHOULD ANSWER "WHERE WAS I" AND "WHAT'S HAPPENING", the way
 * Linear, Notion and Attio open on a home rather than on a list. So it leads
 * with the places the reader was just in, then the most recent games and the
 * top of this season's boards, each a click from its full page. A question for
 * the Win Calculator can be asked straight from here.
 *
 * NOTHING ON IT IS ITS OWN DATA. The teams and players are the explorers'
 * seasons, the games are the Scoreboard's slates, and every row opens the page
 * it comes from.
 */

const shapeTeams = (json: string, year: number) => shapeSeason(year, JSON.parse(json) as StaticTeamSeasonRow[]);

const EXAMPLES = [
  "How do top-25 teams do on the road when they shoot under 30% from three?",
  "Kansas games under Bill Self with more fast break points than their opponent",
  "Teams that trailed by 10 or more at halftime since 2022",
];

const TODAY = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" });
const DAY = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric" });
const dayText = (d: string) => DAY.format(new Date(`${d}T12:00:00Z`));

function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function ago(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return "Just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "Yesterday" : `${d} days ago`;
}

const howOf = (e: MouseEvent) => ({ newTab: e.ctrlKey || e.metaKey, side: e.shiftKey });

type LastGames = { games: Array<{ g: ScoreGame; day: string }>; first: string; last: string };

/**
 * The last games the archive holds, walking back a night at a time.
 *
 * THE NCAA TOURNAMENT FIRST. Out of season the last nights are the Final Four
 * and the title game, played alongside the NIT and the smaller events; "how the
 * season ended" means the bracket, so its games lead and the rest only fill in
 * when there are not enough of them.
 */
async function loadLastGames(want: number): Promise<{ value: LastGames; source: "memory" }> {
  const ncaa: Array<{ g: ScoreGame; day: string }> = [];
  const other: Array<{ g: ScoreGame; day: string }> = [];
  let day: string | null = latestDay();
  const last = day;
  let first = day;
  for (let nights = 0; day && nights < 6 && ncaa.length < want; nights++) {
    const { json } = await window.bta.data("scoreboard-day", seasonOfDate(day), day);
    const slate = JSON.parse(json) as Slate | null;
    if (slate?.games.length) {
      const { ranked, groups } = groupSlate(slate.games, "");
      for (const g of [...ranked, ...groups.flatMap(([, list]) => list)]) {
        (g.tournament === "NCAA" ? ncaa : other).push({ g, day });
      }
      first = day;
    }
    day = stepGameDay(day, -1);
  }
  const games = [...ncaa, ...other].slice(0, want);
  const days = games.map((x) => x.day).sort();
  return { value: { games, first: days[0] ?? first, last: days[days.length - 1] ?? last }, source: "memory" };
}

export function HomeView(_props: ViewProps) {
  const { openRecord, openView } = useShell();
  const recents = useRecents();
  const setStatus = useSetStatus();
  useEffect(() => setStatus("Home"), [setStatus]);

  const [teamsState] = useCorpus("teams", SEASON_CEIL, shapeTeams);
  const [playersState] = useLoaded(`player-season|${SEASON_CEIL}`, () => loadPlayerSeason(SEASON_CEIL));
  const [gamesState] = useLoaded(`home-last-games|${latestDay()}`, () => loadLastGames(4));
  const namesState = useTeamNames();
  const names = namesState.status === "ready" ? namesState.value : null;

  const opener = nextSeasonOpener();
  const today = TODAY.format(new Date());
  const seasonLine = opener
    ? `${seasonLabel(SEASON_CEIL)} is in the books. ${seasonLabel(SEASON_CEIL + 1)} opens ${dayText(opener)}.`
    : `${seasonLabel(SEASON_CEIL)} season`;

  const openVisit = (v: Visit, e: MouseEvent) => {
    const how = howOf(e);
    if (v.record) openRecord(v.record, { ...how, year: v.year });
    else openView(v.viewId, { ...how, query: v.query, year: v.year });
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1120px] px-8 pb-16 pt-10">
        <header>
          <p className="text-[13px] text-ink-muted">{today}</p>
          <h1 className="mt-1 text-[28px] font-semibold leading-tight tracking-[-0.025em] text-ink">{greeting()}</h1>
          <p className="mt-1 text-[14px] text-ink-soft">{seasonLine}</p>
        </header>

        <AskBox onAsk={(q, e) => openView("win-calc", { query: `ask=${encodeURIComponent(q)}`, ...howOf(e) })} />

        <Section title="Jump back in" aside={recents.length > 0 ? `${recents.length} ${recents.length === 1 ? "place" : "places"}` : undefined}>
          {recents.length === 0 ? (
            <p className="rounded-lg border border-dashed border-hairline px-4 py-6 text-[13px] text-ink-muted">
              The teams, players, games and views you open will show up here.
            </p>
          ) : (
            <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(236px, 1fr))" }}>
              {recents.slice(0, 8).map((v) => (
                <VisitCard key={`${v.viewId}:${v.at}`} v={v} onOpen={(e) => openVisit(v, e)} />
              ))}
            </div>
          )}
        </Section>

        <Section
          title={opener ? `How ${seasonLabel(SEASON_CEIL)} ended` : "The latest games"}
          aside={
            gamesState.status === "ready"
              ? gamesState.value.first === gamesState.value.last
                ? dayText(gamesState.value.last)
                : `${dayText(gamesState.value.first)} to ${dayText(gamesState.value.last)}`
              : undefined
          }
          action={{ label: "Scoreboard", onClick: (e) => openView("scoreboard", howOf(e)) }}
        >
          {gamesState.status === "ready" ? (
            // Two by two: four games in three columns left one alone on a second row.
            <div className="grid gap-2.5 @3xl:grid-cols-2">
              {gamesState.value.games.map(({ g, day }) => (
                <GameCard
                  key={g.id}
                  g={g}
                  names={names}
                  focused={false}
                  onFocus={() => {}}
                  onOpen={(how) =>
                    openRecord(gameRecord(seasonOfDate(day), g, names), { newTab: how.newTab, side: how.side, year: seasonOfDate(day) })
                  }
                />
              ))}
            </div>
          ) : (
            <Placeholder count={4} height={112} pairs />
          )}
        </Section>

        <div className="mt-10 grid items-start gap-x-8 gap-y-10 @4xl:grid-cols-2">
          <Section
            flush
            title={`Top teams, ${seasonLabel(SEASON_CEIL)}`}
            aside="BTA rank"
            action={{ label: "Team Explorer", onClick: (e) => openView("team-explorer", { ...howOf(e), year: SEASON_CEIL }) }}
          >
            {teamsState.status === "ready" ? (
              <TopTeams
                teams={teamsState.value.teams}
                onOpen={(t, e) => openRecord({ kind: "team", name: t.name, logoId: t.logoId }, { ...howOf(e), year: SEASON_CEIL })}
              />
            ) : (
              <Placeholder count={8} height={38} />
            )}
          </Section>

          <Section
            flush
            title={`Top players, ${seasonLabel(SEASON_CEIL)}`}
            aside={playersState.status === "ready" ? (playersState.value.defaultSort === "ewins" ? "eWins" : "EPM") : undefined}
            action={{ label: "Player Explorer", onClick: (e) => openView("player-explorer", { ...howOf(e), year: SEASON_CEIL }) }}
          >
            {playersState.status === "ready" ? (
              <TopPlayers
                players={playersState.value.players}
                by={playersState.value.defaultSort}
                onOpen={(p, e) => {
                  if (p.bartId != null) {
                    openRecord({ kind: "player", bartId: p.bartId, name: p.name, hasPhoto: p.hasPhoto }, { ...howOf(e), year: SEASON_CEIL });
                  }
                }}
              />
            ) : (
              <Placeholder count={8} height={38} />
            )}
          </Section>
        </div>

        <Section title="Worth knowing">
          <ul className="grid gap-px overflow-hidden rounded-lg border border-hairline bg-hairline @3xl:grid-cols-2">
            <Tip keys="Ctrl K" text="Find any team, player, coach or night, or ask a question in plain English." />
            <Tip keys="Space" text="Peek at a row without leaving the table. The arrow keys walk the Peek down the rows." />
            <Tip keys="Shift Enter" text="Open a row beside the table, and keep the table where it is." />
            <Tip keys="[  ]" text="Step through the seasons, or through the nights on the Scoreboard." />
            <Tip keys="Ctrl D" text="Star the tab in front: its view, season, filter and question." />
            <Tip keys="Alt ←" text="Go back to where this tab was, filter and all." />
          </ul>
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  aside,
  action,
  flush = false,
  children,
}: {
  title: string;
  aside?: ReactNode;
  action?: { label: string; onClick: (e: MouseEvent) => void };
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={flush ? "min-w-0" : "mt-10 min-w-0"}>
      <div className="mb-2.5 flex items-baseline gap-2.5">
        <h2 className="text-[14px] font-medium text-ink">{title}</h2>
        {aside != null && <span className="text-[12px] text-ink-muted">{aside}</span>}
        {action && (
          <button
            type="button"
            title="Ctrl-click for a new tab"
            onMouseDown={(e) => e.preventDefault()}
            onClick={action.onClick}
            className="ml-auto inline-flex items-center gap-1 text-[12px] text-ink-muted transition-colors hover:text-ink"
          >
            {action.label}
            <ArrowRight size={13} strokeWidth={2} />
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function AskBox({ onAsk }: { onAsk: (question: string, e: MouseEvent) => void }) {
  const [text, setText] = useState("");
  const ask = (q: string, e: MouseEvent) => {
    if (q.trim().length >= 3) onAsk(q.trim(), e);
  };
  return (
    <div className="mt-7">
      <form
        onSubmit={(e) => e.preventDefault()}
        className="flex h-[46px] items-center gap-3 rounded-xl border border-hairline bg-card pl-4 pr-2 transition-colors focus-within:border-accent"
        style={{ boxShadow: "0 1px 2px rgb(0 0 0 / 0.04)" }}
      >
        <Sparkles size={17} strokeWidth={2} className="shrink-0 text-accent" aria-hidden />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              e.stopPropagation();
              ask(text, e as unknown as MouseEvent);
            } else if (e.key === "Escape") {
              e.stopPropagation();
              if (text) setText("");
              else e.currentTarget.blur();
            }
          }}
          maxLength={500}
          spellCheck={false}
          aria-label="Ask the Win Calculator"
          placeholder="Ask anything about thirteen seasons of games"
          className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-muted"
        />
        {text.trim().length >= 3 ? (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => ask(text, e)}
            className="h-[30px] shrink-0 rounded-lg bg-accent px-3 text-[12.5px] font-medium text-white transition-[filter] hover:brightness-110"
          >
            Ask
          </button>
        ) : (
          <span className="shrink-0 pr-1.5">
            <Kbd>Enter</Kbd>
          </span>
        )}
      </form>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {EXAMPLES.map((q) => (
          <button
            key={q}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => ask(q, e)}
            className="h-[26px] max-w-full truncate rounded-md border border-hairline px-2.5 text-[12px] text-ink-soft transition-colors hover:border-ink-muted hover:text-ink"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

function VisitCard({ v, onOpen }: { v: Visit; onOpen: (e: MouseEvent) => void }) {
  const view = viewById(v.viewId);
  const Icon = view.icon;
  const r = v.record;
  const leading =
    r?.kind === "team" ? (
      <TeamLogo id={r.logoId} name={r.name} size={28} />
    ) : r?.kind === "player" ? (
      <PlayerPhoto bartId={r.bartId} hasPhoto={r.hasPhoto} name={r.name} size={30} />
    ) : r?.kind === "coach" ? (
      <CoachAvatar name={r.name} team={r.team} size={30} />
    ) : r?.kind === "game" ? (
      <span className="flex items-center">
        <TeamLogo id={r.awayLogo} name={r.away} size={22} />
        <span className="-ml-1.5">
          <TeamLogo id={r.homeLogo} name={r.home} size={22} />
        </span>
      </span>
    ) : (
      <span className="grid size-[30px] place-items-center rounded-md bg-[color-mix(in_oklab,var(--ink)_6%,var(--card))] text-ink-soft">
        <Icon size={16} strokeWidth={2} />
      </span>
    );
  const sub =
    r?.kind === "game"
      ? `Game · ${seasonLabel(r.season)}`
      : r?.kind === "coach"
        ? r.team
          ? `Coach · ${r.team}`
          : "Coach"
        : r
        ? `${view.label} · ${seasonLabel(v.year)}`
        : view.seasonless || view.season
          ? view.label === v.title
            ? view.section
            : view.label
          : `${view.label === v.title ? view.section : view.label} · ${seasonLabel(v.year)}`;
  return (
    <button
      type="button"
      title={`${v.title}  ·  Ctrl-click for a new tab`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onOpen}
      className="group flex min-w-0 items-center gap-3 rounded-lg border border-hairline bg-card px-3 py-2.5 text-left transition-colors hover:border-[color-mix(in_oklab,var(--ink-muted)_55%,var(--hairline))]"
    >
      <span className="flex w-[34px] shrink-0 justify-center">{leading}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">{v.title}</span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] text-ink-muted">
          <span className="truncate">{sub}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0">{ago(v.at)}</span>
        </span>
      </span>
    </button>
  );
}

function TopTeams({ teams, onOpen }: { teams: Team[]; onOpen: (t: Team, e: MouseEvent) => void }) {
  const top = teams
    .filter((t) => t.btaRank != null)
    .sort((a, b) => a.btaRank! - b.btaRank!)
    .slice(0, 8);
  return (
    <ul className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline bg-card">
      {top.map((t) => (
        <li key={t.id}>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => onOpen(t, e)}
            className="grid h-[38px] w-full grid-cols-[22px_20px_minmax(0,1fr)_auto_78px] items-center gap-3 px-3.5 text-left text-[13px] transition-colors hover:bg-[var(--row-hover)]"
          >
            <span className="text-right text-[12px] text-ink-muted tabular">{t.btaRank}</span>
            <TeamLogo id={t.logoId} name={t.name} size={20} />
            <span className="min-w-0 truncate">
              <span className="font-medium text-ink">{t.name}</span>
              <span className="ml-2 text-[12px] text-ink-muted">{t.confLabel}</span>
            </span>
            <span className="text-[12.5px] text-ink-soft tabular">
              {t.wins}–{t.losses}
            </span>
            <span className="flex items-center justify-end gap-2">
              <span className="text-[12.5px] text-ink tabular">{signed1(t.adjNet)}</span>
              <PercentileChip pct={t.pct.a_net ?? null} className="min-w-[28px] px-1 py-[2px] text-[10.5px]" />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function TopPlayers({ players, by, onOpen }: { players: Player[]; by: "ewins" | "epm"; onOpen: (p: Player, e: MouseEvent) => void }) {
  const value = (p: Player) => (by === "ewins" ? p.s.ewins : p.s.epm);
  const top = [...players]
    .filter((p) => value(p) != null)
    .sort((a, b) => value(b)! - value(a)!)
    .slice(0, 8);
  return (
    <ul className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline bg-card">
      {top.map((p, i) => {
        const v = value(p)!;
        const pct = (p.pct as Record<string, number | undefined>)[by] ?? null;
        return (
          <li key={p.id}>
            <button
              type="button"
              disabled={p.bartId == null}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => onOpen(p, e)}
              className="grid h-[38px] w-full grid-cols-[22px_24px_minmax(0,1fr)_78px] items-center gap-3 px-3.5 text-left text-[13px] transition-colors enabled:hover:bg-[var(--row-hover)]"
            >
              <span className="text-right text-[12px] text-ink-muted tabular">{i + 1}</span>
              <PlayerPhoto bartId={p.bartId} hasPhoto={p.hasPhoto} name={p.name} size={24} />
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium text-ink">{p.name}</span>
                <TeamLogo id={p.teamLogoId} name={p.team} size={14} />
                <span className="truncate text-[12px] text-ink-muted">{p.team}</span>
              </span>
              <span className="flex items-center justify-end gap-2">
                <span className="text-[12.5px] text-ink tabular">{by === "ewins" ? v.toFixed(2) : signed1(v)}</span>
                <PercentileChip pct={pct} className="min-w-[28px] px-1 py-[2px] text-[10.5px]" />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Tip({ keys, text }: { keys: string; text: string }) {
  return (
    <li className="flex items-center gap-3 bg-card px-3.5 py-2.5">
      <span className="w-[86px] shrink-0">
        <Kbd>{keys}</Kbd>
      </span>
      <span className="text-[12.5px] leading-snug text-ink-soft">{text}</span>
    </li>
  );
}

function Placeholder({ count, height, pairs = false }: { count: number; height: number; pairs?: boolean }) {
  return (
    <div aria-busy="true" className={`grid gap-2.5 ${pairs ? "@3xl:grid-cols-2" : ""}`}>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="skeleton rounded-lg" style={{ height }} />
      ))}
    </div>
  );
}
