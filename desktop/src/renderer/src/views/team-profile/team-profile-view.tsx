import { useMemo, useState } from "react";
import { coachSlug } from "@/lib/coach-slug";
import { ALL_SEASONS } from "@/lib/seasons";
import type { StaticTeamSeasonRow } from "@/lib/static-data";
import { T, TEAM_GAME_VIEWS, teamGameViewByKey } from "@/lib/team-game-index";
import { loadPlayerSeason, type Player } from "~/data/player-model";
import { logDate, useOpenGame } from "~/data/game-link";
import { loadTeamGameSeason, type TeamGame } from "~/data/team-game-model";
import { byCoach, ncaaLabel, runLabel, teamHistory } from "~/data/team-history";
import { shapeSeason, type Season, type Team } from "~/data/team-model";
import { useCorpus, useLoaded } from "~/data/use-corpus";
import { SeasonSwitcher } from "~/shell/season-switcher";
import { coachObj, type Obj } from "~/objects/object";
import { RailActions, RecordActions } from "~/objects/object-surfaces";
import { Picker } from "~/shell/picker";
import { useShell } from "~/shell/shell-context";
import { LoadError, TableSkeleton } from "~/shell/view-parts";
import type { ViewProps } from "~/shell/views";
import { DataTable, type Column } from "~/table/data-table";
import { ConfLogo } from "~/ui/conf-logo";
import { DetailLink, DetailRow, DetailSection, DetailsRail, DetailsToggle, howOf, useDetailsRail, type OpenHow } from "~/ui/details";
import { num1, pct1, seasonLabel, signed1 } from "~/ui/format";
import { TeamLogo } from "~/ui/logo";
import { ClassBadge, PlayerPhoto } from "~/ui/player-photo";
import { HighlightRow, ProfileHeader, ProfileNote, ProfileTabs, SectionTitle } from "~/ui/profile";
import { rosterColumns } from "~/views/players/player-columns";
import { PlayerPeekBody } from "~/views/players/player-peek";
import { statColumns as gameStatColumns } from "~/views/team-games/game-columns";
import { GamePeekBody } from "~/views/team-games/game-peek";
import { TEAM_GAME_IDENTITY, teamLogObject } from "~/views/team-games/team-games-view";
import { TeamStats } from "./team-stats";

/**
 * A team's page: who they were in a season, how their record splits, their
 * latest games, every number the site holds on them, every game, and the
 * roster.
 *
 * NOTHING ON IT IS NEW MATH. The stat cards are the site's Team Stats panel
 * (./team-stats.tsx), the game rows are the Team Game Log's, the roster is the
 * Player Explorer's numbers. The page only gathers one team out of each.
 *
 * THE SEASON IS THE TAB'S, like every view: [ and ] walk this team through its
 * seasons without leaving the page.
 */

type TabKey = "overview" | "games" | "roster";

const shapeTeams = (json: string, year: number): Season => shapeSeason(year, JSON.parse(json) as StaticTeamSeasonRow[]);
const gameKey = (g: TeamGame) => g.idx;
const inOrder = (a: TeamGame, b: TeamGame) => a.row[T.d]! - b.row[T.d]! || a.idx - b.idx;
const playerKey = (p: Player) => p.id;
const byMinutes = (a: Player, b: Player) => (b.s.min_pg ?? 0) - (a.s.min_pg ?? 0);

/** Date first and pinned: on one team's page the games are a log, read in order. */
const GAME_COLUMNS_IDENTITY: Column<TeamGame>[] = (() => {
  const pick = (key: string) => TEAM_GAME_IDENTITY.find((c) => c.key === key)!;
  return [{ ...pick("date"), pin: true }, pick("result"), pick("site"), pick("opp")];
})();

const GAME_VIEW_KEY = "bta.profile.teamGames.view";
const GAME_VIEW_OPTIONS = TEAM_GAME_VIEWS.map((v) => ({ key: v.key, label: v.label, desc: v.desc }));

/** Every column unless the reader picked a narrower view; the pick is remembered. */
function readGameView(): string {
  try {
    const v = localStorage.getItem(GAME_VIEW_KEY);
    return v ? teamGameViewByKey(v).key : "everything";
  } catch {
    return "everything";
  }
}

const ROSTER_IDENTITY: Column<Player>[] = [
  {
    key: "name", label: "Player", width: 244, align: "left", first: 1, pin: true,
    sortValue: (p) => p.name,
    cell: (p) => (
      <span className="flex min-w-0 items-center gap-2">
        <PlayerPhoto bartId={p.bartId} hasPhoto={p.hasPhoto} name={p.name} size={24} />
        <span className="truncate font-medium text-ink">{p.name}</span>
        <ClassBadge cls={p.cls} />
      </span>
    ),
  },
  {
    key: "gp", label: "GP", title: "Games played", width: 48, align: "right", first: -1,
    sortValue: (p) => p.s.games,
    cell: (p) => <span className="text-ink-soft tabular">{p.s.games ?? "–"}</span>,
  },
];

export function TeamProfileView({ year, setYear, record }: ViewProps) {
  const { openRecord } = useShell();
  const name = record?.kind === "team" ? record.name : "";
  const [tab, setTab] = useState<TabKey>("overview");
  const [detailsOpen, toggleDetails] = useDetailsRail();
  const [gameViewKey, setGameViewKey] = useState(readGameView);
  const gameView = teamGameViewByKey(gameViewKey);

  const [teamsState, retry] = useCorpus("teams", year, shapeTeams);
  const [gamesState] = useLoaded(`team-games|${year}`, () => loadTeamGameSeason(year));
  const [playersState] = useLoaded(`player-season|${year}`, () => loadPlayerSeason(year));

  const season = teamsState.status === "ready" ? teamsState.value : null;
  const team = season?.teams.find((t) => t.name === name);
  const gameSeason = gamesState.status === "ready" ? gamesState.value : null;
  const games = useMemo(() => (gameSeason ? gameSeason.games.filter((g) => g.team === name) : []), [gameSeason, name]);
  const playerSeason = playersState.status === "ready" ? playersState.value : null;
  const roster = useMemo(
    () => (playerSeason ? playerSeason.roster.filter((p) => p.team === name) : []),
    [playerSeason, name],
  );
  const d1 = useMemo(() => new Set(season?.teams.map((t) => t.name) ?? []), [season]);
  const logoId = team?.logoId ?? (record?.kind === "team" ? record.logoId : null);
  const split = useMemo(() => splits(games), [games]);
  const teamObj: Obj | null = name ? { kind: "team", name, logoId, year, conf: team?.conf } : null;

  const openTeam = (teamName: string, logo: number | null, newTab: boolean) =>
    openRecord({ kind: "team", name: teamName, logoId: logo }, { newTab, year });

  // A game opens its own page; the opponent's, as before, when the slate lacks it.
  const openGame = useOpenGame();
  const openLogGame = (g: TeamGame, how: { newTab: boolean; side?: boolean }) => {
    if (!gameSeason) return;
    openGame({ date: logDate(gameSeason.pack.epochMs, g.row[T.d]!), team: g.team, opp: g.opp }, how, () => {
      if (d1.has(g.opp)) openTeam(g.opp, g.oppLogoId, how.newTab);
    });
  };

  const gameColumns = useMemo(
    () => (gameSeason ? [...GAME_COLUMNS_IDENTITY, ...gameStatColumns(gameSeason.pack, gameView.keys, { chips: false })] : []),
    [gameSeason, gameView],
  );
  const rosterCols = useMemo(
    () => (playerSeason ? [...ROSTER_IDENTITY, ...rosterColumns(playerSeason.hasEwins)] : []),
    [playerSeason],
  );

  const pickGameView = (key: string) => {
    setGameViewKey(key);
    try {
      localStorage.setItem(GAME_VIEW_KEY, key);
    } catch {
      /* remembered for this session only */
    }
  };

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="shrink-0 px-6 pt-5">
          <ProfileHeader
            avatar={<TeamLogo id={logoId} name={name} size={52} />}
            name={name}
            badges={
              team && (
                <>
                  {team.btaRank != null && (
                    <span className="shrink-0 rounded-[5px] bg-[var(--accent-wash)] px-1.5 py-[3px] font-mono text-[11px] font-semibold text-accent tabular">
                      BTA #{team.btaRank}
                    </span>
                  )}
                </>
              )
            }
            facts={
              team
                ? [
                    team.confLabel,
                    <span key="rec" className="tabular">{`${team.wins}–${team.losses}`}</span>,
                    split.conf.w + split.conf.l > 0 && (
                      <span key="conf" className="tabular">{`${split.conf.w}–${split.conf.l} in conference`}</span>
                    ),
                  ]
                : [seasonLabel(year)]
            }
            actions={
              <>
                <SeasonSwitcher year={year} onChange={setYear} />
                <RecordActions obj={teamObj} primary={["explorer", "matchup", "compare", "snapshot"]} />
                <DetailsToggle open={detailsOpen} onToggle={toggleDetails} />
              </>
            }
          />

          {team && (
            <div className="mt-5">
              <HighlightRow
                items={[
                  { label: "Adj O", value: num1(team.adjO), pct: team.pct.a_ortg ?? null, title: "Adjusted offensive rating" },
                  { label: "Adj D", value: num1(team.adjD), pct: team.pct.a_drtg ?? null, title: "Adjusted defensive rating (lower is better)" },
                  { label: "Net", value: signed1(team.adjNet), pct: team.pct.a_net ?? null, title: "Adjusted net rating" },
                  { label: "Tempo", value: num1(team.tempo), pct: team.pct.adjt ?? null, neutral: true, title: "Adjusted tempo" },
                  { label: "eFG%", value: pct1(team.efg), pct: team.pct.cbb_efg ?? null, title: "Effective field goal %" },
                  { label: "SOS", value: num1(team.sos), pct: team.pct.adj_sos ?? null, title: "Strength of schedule" },
                ]}
              />
            </div>
          )}

          <div className="mt-5">
            <ProfileTabs
              value={tab}
              onChange={setTab}
              tabs={[
                { key: "overview", label: "Overview" },
                { key: "games", label: "Games", count: gameSeason ? games.length : null },
                { key: "roster", label: "Roster", count: playerSeason ? roster.length : null },
              ]}
            />
          </div>
        </div>

        {teamsState.status === "error" ? (
          <LoadError year={year} reason={teamsState.reason} message={teamsState.message} what="Teams" onRetry={retry} />
        ) : !season ? (
          <div className="relative min-h-0 flex-1">
            <TableSkeleton rowHeight={42} label="Loading team" />
          </div>
        ) : !team ? (
          <ProfileNote>
            {name} has no season in {seasonLabel(year)}. Press [ or ] to step to another season.
          </ProfileNote>
        ) : tab === "overview" ? (
          <TeamOverview year={year} team={team} split={split} games={games} onGame={openLogGame} />
        ) : tab === "games" ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-[46px] shrink-0 items-center gap-3 px-6">
              <Picker label="View" value={gameView.key} options={GAME_VIEW_OPTIONS} onChange={pickGameView} />
              <span className="min-w-0 truncate text-[12px] text-ink-muted">{gameView.desc}</span>
            </div>
            <div className="relative min-h-0 flex-1 border-t border-hairline">
              {gameSeason ? (
                <DataTable
                  key={`games:${year}:${name}:${gameView.key}`}
                  rows={games}
                  columns={gameColumns}
                  rowKey={gameKey}
                  rowHeight={38}
                  defaultSort={{ key: "date", dir: 1 }}
                  tieBreak={inOrder}
                  ariaLabel={`${name} games`}
                  empty={<ProfileNote>No games for {name} in {seasonLabel(year)}.</ProfileNote>}
                  peek={{
                    label: (g) => `${g.team} ${g.site === "away" ? "at" : "vs"} ${g.opp}`,
                    body: (g) => <GamePeekBody season={gameSeason} game={g} />,
                  }}
                  object={(g) => teamLogObject(g, gameSeason.pack.epochMs, year)}
                />
              ) : gamesState.status === "error" ? (
                <LoadError year={year} reason={gamesState.reason} message={gamesState.message} what="Team games" onRetry={() => {}} />
              ) : (
                <TableSkeleton rowHeight={38} label="Loading games" />
              )}
            </div>
          </div>
        ) : (
          <div className="relative min-h-0 flex-1">
            {playerSeason ? (
              <DataTable
                key={`roster:${year}:${name}`}
                rows={roster}
                columns={rosterCols}
                rowKey={playerKey}
                defaultSort={{ key: "mpg", dir: -1 }}
                tieBreak={byMinutes}
                ariaLabel={`${name} roster`}
                empty={<ProfileNote>No players listed for {name} in {seasonLabel(year)}.</ProfileNote>}
                peek={{ label: (p) => p.name, body: (p) => <PlayerPeekBody season={playerSeason} player={p} /> }}
                object={(p) =>
                  p.bartId == null
                    ? null
                    : { kind: "player", bartId: p.bartId, name: p.name, hasPhoto: p.hasPhoto, year, team: p.team, teamLogoId: p.teamLogoId, conf: p.conf }
                }
              />
            ) : playersState.status === "error" ? (
              <LoadError year={year} reason={playersState.reason} message={playersState.message} what="Players" onRetry={() => {}} />
            ) : (
              <TableSkeleton rowHeight={42} label="Loading roster" />
            )}
          </div>
        )}
      </div>
      {detailsOpen && <TeamDetails name={name} year={year} team={team ?? null} onSeason={setYear} />}
    </div>
  );
}

type Record = { w: number; l: number };
type Splits = Record_<"overall" | "home" | "away" | "neutral" | "conf" | "nonconf" | "ranked" | "close">;
type Record_<K extends string> = { [k in K]: Record };

/** Win-loss splits from the game log: where, against whom, and how close. */
function splits(games: TeamGame[]): Splits {
  const rec = (): Record => ({ w: 0, l: 0 });
  const out: Splits = {
    overall: rec(), home: rec(), away: rec(), neutral: rec(),
    conf: rec(), nonconf: rec(), ranked: rec(), close: rec(),
  };
  for (const g of games) {
    const add = (r: Record) => (g.won ? r.w++ : r.l++);
    add(out.overall);
    add(out[g.site]);
    add(g.conference ? out.conf : out.nonconf);
    if (g.oppAp >= 1 && g.oppAp <= 25) add(out.ranked);
    if (Math.abs(g.pts - g.pa) <= 5) add(out.close);
  }
  return out;
}

const SPLIT_ROWS: Array<[label: string, key: keyof Splits]> = [
  ["Overall", "overall"],
  ["Home", "home"],
  ["Away", "away"],
  ["Neutral", "neutral"],
  ["Conference", "conf"],
  ["Non-conf.", "nonconf"],
  ["vs AP top 25", "ranked"],
  ["Within 5 pts", "close"],
];

function TeamOverview({
  year,
  team,
  split,
  games,
  onGame,
}: {
  year: number;
  team: Team;
  split: Splits;
  games: TeamGame[];
  onGame: (g: TeamGame, how: { newTab: boolean; side?: boolean }) => void;
}) {
  const recent = [...games].sort((a, b) => b.row[T.d]! - a.row[T.d]!).slice(0, 5);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-10 pt-5">
      <div className="grid gap-x-6 gap-y-6 @4xl:grid-cols-2">
        <section className="min-w-0">
          <SectionTitle aside="From the game log">Record</SectionTitle>
          {/* Two across beside the games, so the pair ends level; four across when stacked. */}
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-hairline bg-hairline @xl:grid-cols-4 @4xl:grid-cols-2">
            {SPLIT_ROWS.map(([label, key]) => {
              const r = split[key];
              const n = r.w + r.l;
              return (
                <div key={key} className="bg-card px-3 py-2.5">
                  <div className="truncate text-[11.5px] text-ink-muted">{label}</div>
                  <div className="mt-1 flex items-baseline gap-1.5">
                    <span className={`text-[16px] font-semibold tabular ${n ? "text-ink" : "text-ink-muted"}`}>
                      {n ? `${r.w}–${r.l}` : "–"}
                    </span>
                    {n > 0 && <span className="text-[11px] text-ink-muted tabular">{Math.round((100 * r.w) / n)}%</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="min-w-0">
          <SectionTitle aside={games.length ? `${games.length} games` : undefined}>Recent games</SectionTitle>
          {recent.length === 0 ? (
            <p className="text-[13px] text-ink-muted">No games in the log for this season.</p>
          ) : (
            <ul className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline bg-card">
              {recent.map((g) => (
                <li key={g.idx}>
                  <button
                    type="button"
                    title="Open the game  ·  Ctrl-click for a new tab, Shift-click for the side"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => onGame(g, { newTab: e.ctrlKey || e.metaKey, side: e.shiftKey })}
                    className="grid h-[46px] w-full grid-cols-[52px_14px_minmax(0,1fr)_auto] items-center gap-3 px-3.5 text-left text-[13px] transition-colors hover:bg-[var(--row-hover)]"
                  >
                    <span className="whitespace-nowrap text-ink-muted">{g.dateShort}</span>
                    <span className={`font-semibold ${g.won ? "text-good" : "text-bad"}`}>{g.won ? "W" : "L"}</span>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="w-4 shrink-0 text-center text-[12px] text-ink-muted">
                        {g.site === "home" ? "vs" : g.site === "away" ? "@" : "N"}
                      </span>
                      <TeamLogo id={g.oppLogoId} name={g.opp} size={16} />
                      <span className="truncate text-ink-soft">{g.opp}</span>
                    </span>
                    <span className="text-ink tabular">
                      {g.pts}–{g.pa}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="mt-8">
        <TeamStats year={year} team={team.name} />
      </div>
    </div>
  );
}

/**
 * The team's rail: who coached and how the season ended, every season on record
 * under each coach, and the ways out.
 */
function TeamDetails({ name, year, team, onSeason }: { name: string; year: number; team: Team | null; onSeason: (y: number) => void }) {
  const { openRecord } = useShell();
  const history = useMemo(() => teamHistory(name), [name]);
  const shown = useMemo(() => history.filter((h) => ALL_SEASONS.includes(h.year)), [history]);
  const now = history.find((h) => h.year === year) ?? null;
  const bids = shown.filter((h) => h.seed != null).length;

  const openCoach = (coach: string, how: OpenHow) =>
    openRecord({ kind: "coach", slug: coachSlug(coach), name: coach, team: name }, { newTab: how.newTab, side: how.side });

  return (
    <DetailsRail label={`${name} details`}>
      <DetailSection title="This season" aside={seasonLabel(year)}>
        {team && (
          <DetailRow label="Conference">
            <ConfLogo conf={team.conf} size={16} />
            <span className="truncate">{team.confLabel}</span>
          </DetailRow>
        )}
        <DetailRow label="Coach">
          {now ? (
            <DetailLink title={`Open ${now.coach}'s page  ·  Ctrl-click for a new tab`} object={coachObj(now.coach, name)} onOpen={(how) => openCoach(now.coach, how)}>
              <span className="truncate">{now.coach}</span>
            </DetailLink>
          ) : (
            <span className="text-ink-muted">Not on record</span>
          )}
        </DetailRow>
        <DetailRow label="NCAA">
          {now?.seed != null ? <span className="truncate">{ncaaLabel(now)}</span> : <span className="text-ink-muted">{now ? "No bid" : "Not on record"}</span>}
        </DetailRow>
      </DetailSection>

      {shown.length > 0 && (
        <DetailSection title="Seasons" aside={`${bids} NCAA ${bids === 1 ? "bid" : "bids"}`}>
          <div className="flex flex-col gap-2.5">
            {byCoach(shown).map((run) => (
              <div key={`${run.coach}:${run.seasons[0]!.year}`}>
                <button
                  type="button"
                  title={`Open ${run.coach}'s page  ·  Ctrl-click for a new tab`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => openCoach(run.coach, howOf(e))}
                  className="-mx-2 flex h-[24px] w-[calc(100%+16px)] items-center gap-2 rounded-md px-2 text-left text-[11.5px] text-ink-muted transition-colors hover:text-ink"
                >
                  <span className="truncate font-medium text-ink-soft">{run.coach}</span>
                  <span className="ml-auto shrink-0">{runLabel(run, history)}</span>
                </button>
                <ul>
                  {run.seasons.map((h) => {
                    const current = h.year === year;
                    return (
                      <li key={h.year}>
                        <button
                          type="button"
                          aria-current={current || undefined}
                          title={`Open ${seasonLabel(h.year)}`}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => onSeason(h.year)}
                          className={`-mx-2 grid h-[28px] w-[calc(100%+16px)] grid-cols-[42px_44px_minmax(0,1fr)] items-center gap-2 rounded-md px-2 text-left text-[12.5px] transition-colors ${
                            current ? "bg-[var(--nav-active)] text-ink" : "text-ink-soft hover:bg-[var(--row-hover)] hover:text-ink"
                          }`}
                        >
                          <span className="text-ink-muted tabular">{seasonLabel(h.year).slice(2)}</span>
                          <span className="tabular">{h.wins != null && h.losses != null ? `${h.wins}–${h.losses}` : "–"}</span>
                          <span className="truncate text-ink-muted">{ncaaLabel(h)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </DetailSection>
      )}

      <DetailSection title="Go to">
        <RailActions obj={{ kind: "team", name, logoId: team?.logoId ?? null, year, conf: team?.conf }} groups={["goto", "filter"]} />
      </DetailSection>

      <DetailSection title="Share">
        <RailActions obj={{ kind: "team", name, logoId: team?.logoId ?? null, year, conf: team?.conf }} groups={["share"]} />
      </DetailSection>
    </DetailsRail>
  );
}
