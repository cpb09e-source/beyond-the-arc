import { useMemo, useState } from "react";
import { TopHundredPill } from "@/components/portal/top-hundred-pill";
import { coachSlug } from "@/lib/coach-slug";
import { F, GAME_VIEWS, gameStat, gameViewByKey } from "@/lib/game-index";
import { logDate, useOpenGame } from "~/data/game-link";
import {
  loadPlayerGameSeason,
  shortDate,
  siteOf,
  statValues,
  wonGame,
  type PlayerGame,
  type PlayerGameSeason,
} from "~/data/player-game-model";
import { loadPlayerSeason, type Player, type PlayerSeason } from "~/data/player-model";
import { loadSearchData } from "~/data/search-model";
import { ncaaLabel, teamHistory } from "~/data/team-history";
import { useLoaded } from "~/data/use-corpus";
import { SeasonSwitcher } from "~/shell/season-switcher";
import { coachObj, type Obj } from "~/objects/object";
import { ObjectLink, RailActions, RecordActions } from "~/objects/object-surfaces";
import { playerLogObject } from "~/views/player-games/player-games-view";
import { Picker } from "~/shell/picker";
import { useShell } from "~/shell/shell-context";
import { LoadError, TableSkeleton } from "~/shell/view-parts";
import type { ViewProps } from "~/shell/views";
import { DataTable, type Column } from "~/table/data-table";
import { ConfLogo } from "~/ui/conf-logo";
import { DetailLink, DetailRow, DetailSection, DetailsCollapsed, DetailsRail, useDetailsRail, type OpenHow } from "~/ui/details";
import { seasonLabel } from "~/ui/format";
import { TeamLogo } from "~/ui/logo";
import { ClassBadge, PlayerPhoto } from "~/ui/player-photo";
import { HighlightRow, ProfileHeader, ProfileNote, ProfileTabs, SectionTitle, type Highlight } from "~/ui/profile";
import { identityColumns, statColumns as gameStatColumns } from "~/views/player-games/player-game-columns";
import { PlayerGamePeekBody } from "~/views/player-games/player-game-peek";
import { playerStat } from "~/views/players/player-columns";
import { playerLens } from "~/lens/stat-lens";
import { PlayerStats } from "./player-stats";

/**
 * A player's page: the season at a glance, his best and latest nights, every
 * number the site holds on him, every game, and the seasons before.
 *
 * THE STAT CARDS ARE THE SITE'S Player Overview: the same cards, views, splits
 * and per-40 basis (./player-stats.tsx), so the app and btacbb.xyz never
 * describe a player two ways.
 *
 * THE GAME LOG IS PLAIN NUMBERS, in the site's column views. A percentile under
 * every cell of one player's games was noise; the season's context lives in the
 * cards.
 */

type TabKey = "overview" | "games" | "career";

const gameKey = (g: PlayerGame) => g.idx;
const inOrder = (a: PlayerGame, b: PlayerGame) => a.row[F.d]! - b.row[F.d]! || a.idx - b.idx;

const GAME_VIEW_KEY = "bta.profile.playerGames.view";
const GAME_VIEW_OPTIONS = GAME_VIEWS.map((v) => ({ key: v.key, label: v.label, desc: v.desc }));

/** Every column unless the reader picked a narrower view; the pick is remembered. */
function readGameView(): string {
  try {
    const v = localStorage.getItem(GAME_VIEW_KEY);
    return v ? gameViewByKey(v).key : "everything";
  } catch {
    return "everything";
  }
}

export function PlayerProfileView({ year, setYear, record }: ViewProps) {
  const { openRecord } = useShell();
  const ref = record?.kind === "player" ? record : null;
  const bartId = ref?.bartId ?? -1;
  const [tab, setTab] = useState<TabKey>("overview");
  const [detailsOpen, toggleDetails] = useDetailsRail();
  const [gameViewKey, setGameViewKey] = useState(readGameView);
  const gameView = gameViewByKey(gameViewKey);

  const [seasonState, retry] = useLoaded(`player-season|${year}`, () => loadPlayerSeason(year));
  const [gamesState] = useLoaded(`player-games|${year}`, () => loadPlayerGameSeason(year));
  const [searchState] = useLoaded("search", loadSearchData);

  const season = seasonState.status === "ready" ? seasonState.value : null;
  const player = season?.roster.find((p) => p.bartId === bartId);
  const gameSeason = gamesState.status === "ready" ? gamesState.value : null;
  const games = useMemo(() => {
    if (!gameSeason) return [];
    const index = gameSeason.players.findIndex((p) => p.bartId === bartId);
    return index < 0 ? [] : gameSeason.games.filter((g) => g.row[F.p] === index);
  }, [gameSeason, bartId]);
  const career = useMemo(
    () =>
      searchState.status === "ready"
        ? searchState.value.players.filter((p) => p.bartId === bartId).sort((a, b) => b.year - a.year)
        : [],
    [searchState, bartId],
  );

  const name = player?.name ?? ref?.name ?? "";
  const playerObj: Obj | null = ref
    ? { kind: "player", bartId: ref.bartId, name, hasPhoto: player?.hasPhoto ?? ref.hasPhoto, year, team: player?.team, teamLogoId: player?.teamLogoId, conf: player?.conf }
    : null;
  const openTeam = (team: string, logoId: number | null, newTab: boolean) =>
    openRecord({ kind: "team", name: team, logoId }, { newTab, year });

  // A game opens its own page; the opponent's, as before, when the slate lacks it.
  const openGame = useOpenGame();
  const openLogGame = (g: PlayerGame, how: { newTab: boolean; side?: boolean }) => {
    if (!gameSeason) return;
    const o = gameSeason.opps[g.row[F.o]!]!;
    const team = gameSeason.players[g.row[F.p]!]?.team ?? "";
    openGame({ date: logDate(gameSeason.pack.epochMs, g.row[F.d]!), team, opp: o.name }, how, () => openTeam(o.name, o.logoId, how.newTab));
  };

  const gameColumns = useMemo((): Column<PlayerGame>[] => {
    if (!gameSeason) return [];
    const identity = identityColumns(gameSeason);
    const pick = (key: string) => identity.find((c) => c.key === key)!;
    return [{ ...pick("date"), pin: true }, pick("result"), pick("site"), pick("opp"), ...gameStatColumns(gameSeason, gameView.keys, { chips: false })];
  }, [gameSeason, gameView]);

  const pickGameView = (key: string) => {
    setGameViewKey(key);
    try {
      localStorage.setItem(GAME_VIEW_KEY, key);
    } catch {
      /* remembered for this session only */
    }
  };

  const highlights = (p: Player, s: PlayerSeason): Highlight[] => {
    const read = (key: string): Highlight => {
      const st = playerStat(key)!;
      return {
        label: st.label,
        value: st.format(p.s[st.field] as number | null),
        pct: st.pctKey ? (p.pct[st.pctKey] ?? null) : null,
        title: st.desc,
        lens:
          p.bartId != null
            ? playerLens(key, { kind: "player", bartId: p.bartId, name: p.name, hasPhoto: p.hasPhoto, year }, { label: st.label, value: st.format(p.s[st.field] as number | null) })
            : null,
      };
    };
    return [read("epm"), s.hasEwins ? read("ewins") : read("usg_pct"), read("ppg"), read("rpg"), read("apg"), read("ts_pct")];
  };

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="shrink-0 px-6 pt-5">
          <ProfileHeader
            avatar={
              <PlayerPhoto bartId={ref?.bartId ?? null} hasPhoto={player?.hasPhoto ?? ref?.hasPhoto ?? false} name={name} size={60} />
            }
            name={name}
            badges={
              player && (
                <>
                  <ClassBadge cls={player.cls} />
                  {player.rank != null && player.rank <= 100 && (
                    <TopHundredPill
                      rank={player.rank}
                      title={`Top 100: #${player.rank} in the country in ${seasonLabel(year)}`}
                      className="h-[18px] px-1.5 text-[11px]"
                    />
                  )}
                </>
              )
            }
            facts={
              player
                ? [
                    <ObjectLink
                      key="team"
                      obj={{ kind: "team", name: player.team, logoId: player.teamLogoId, year, conf: player.conf }}
                      className="flex items-center gap-1.5 text-ink-soft underline-offset-2 hover:text-ink hover:underline"
                    >
                      <TeamLogo id={player.teamLogoId} name={player.team} size={15} />
                      {player.team}
                    </ObjectLink>,
                    player.position,
                    player.height,
                    player.hometown,
                  ]
                : [seasonLabel(year)]
            }
            actions={
              <>
                <SeasonSwitcher year={year} onChange={setYear} />
                <RecordActions obj={playerObj} primary={["explorer", "compare", "snapshot"]} />
              </>
            }
          />

          {player && season && (
            <div className="mt-5">
              <HighlightRow items={highlights(player, season)} />
            </div>
          )}

          <div className="mt-5">
            <ProfileTabs
              value={tab}
              onChange={setTab}
              tabs={[
                { key: "overview", label: "Overview" },
                { key: "games", label: "Game log", count: gameSeason ? games.length : null },
                { key: "career", label: "Career", count: career.length || null },
              ]}
            />
          </div>
        </div>

        {tab === "career" ? (
          <Career
            rows={career}
            year={year}
            onSeason={(y) => {
              setYear(y);
              setTab("overview");
            }}
          />
        ) : seasonState.status === "error" ? (
          <LoadError year={year} reason={seasonState.reason} message={seasonState.message} what="Players" onRetry={retry} />
        ) : !season ? (
          <div className="relative min-h-0 flex-1">
            <TableSkeleton rowHeight={42} label="Loading player" />
          </div>
        ) : !player ? (
          <ProfileNote>
            {name} has no season in {seasonLabel(year)}. The Career tab lists the seasons there are.
          </ProfileNote>
        ) : tab === "overview" ? (
          <PlayerOverview year={year} season={season} player={player} gameSeason={gameSeason} games={games} onGame={openLogGame} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-[46px] shrink-0 items-center gap-3 px-6">
              <Picker label="View" value={gameView.key} options={GAME_VIEW_OPTIONS} onChange={pickGameView} />
              <span className="min-w-0 truncate text-[12px] text-ink-muted">{gameView.desc}</span>
            </div>
            <div className="relative min-h-0 flex-1 border-t border-hairline">
              {gameSeason ? (
                <DataTable
                  key={`games:${year}:${bartId}:${gameView.key}`}
                  rows={games}
                  columns={gameColumns}
                  rowKey={gameKey}
                  rowHeight={38}
                  defaultSort={{ key: "date", dir: 1 }}
                  tieBreak={inOrder}
                  ariaLabel={`${name} games`}
                  empty={<ProfileNote>No games in the log for {name} in {seasonLabel(year)}.</ProfileNote>}
                  peek={{
                    label: (g) => {
                      const o = gameSeason.opps[g.row[F.o]!]!;
                      return `${name} ${siteOf(g.row) === "away" ? "at" : "vs"} ${o.name}`;
                    },
                    body: (g) => <PlayerGamePeekBody season={gameSeason} game={g} />,
                  }}
                  object={(g) => playerLogObject(gameSeason, g)}
                />
              ) : gamesState.status === "error" ? (
                <LoadError year={year} reason={gamesState.reason} message={gamesState.message} what="Player games" onRetry={() => {}} />
              ) : (
                <TableSkeleton rowHeight={38} label="Loading games" />
              )}
            </div>
          </div>
        )}
      </div>
      {detailsOpen ? (
        <PlayerDetails
          name={name}
          year={year}
          bartId={ref?.bartId ?? null}
          player={player ?? null}
          career={career}
          onSeason={setYear}
          onTeam={(team, logoId, how) => openRecord({ kind: "team", name: team, logoId }, { newTab: how.newTab, side: how.side, year })}
          onCollapse={toggleDetails}
        />
      ) : (
        <DetailsCollapsed onExpand={toggleDetails} />
      )}
    </div>
  );
}

function PlayerOverview({
  year,
  season,
  player,
  gameSeason,
  games,
  onGame,
}: {
  year: number;
  season: PlayerSeason;
  player: Player;
  gameSeason: PlayerGameSeason | null;
  games: PlayerGame[];
  onGame: (g: PlayerGame, how: { newTab: boolean; side?: boolean }) => void;
}) {
  // Best by Game Score, which ranks a night better than any one number does,
  // though the list itself shows the line, not the score.
  const { best, recent } = useMemo((): { best: PlayerGame[]; recent: PlayerGame[] } => {
    if (!gameSeason || games.length === 0) return { best: [], recent: [] };
    const values = statValues(gameSeason.pack, gameStat("gmsc")!);
    return {
      best: [...games].sort((a, b) => values[b.idx]! - values[a.idx]!).slice(0, 5),
      recent: [...games].sort((a, b) => inOrder(b, a)).slice(0, 5),
    };
  }, [gameSeason, games]);
  const recentWins = recent.filter((g) => wonGame(g.row)).length;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-10 pt-5">
      <div className="grid gap-x-6 gap-y-6 @4xl:grid-cols-2">
        <GameList title="Best games" games={best} season={gameSeason} onGame={onGame} />
        <GameList
          title="Last 5 games"
          aside={recent.length ? `${recentWins}–${recent.length - recentWins}` : undefined}
          games={recent}
          season={gameSeason}
          onGame={onGame}
        />
      </div>
      <div className="mt-8">
        <PlayerStats year={year} player={player} season={season} />
      </div>
    </div>
  );
}

function GameList({
  title,
  aside,
  games,
  season,
  onGame,
}: {
  title: string;
  aside?: string;
  games: PlayerGame[];
  season: PlayerGameSeason | null;
  onGame: (g: PlayerGame, how: { newTab: boolean; side?: boolean }) => void;
}) {
  return (
    <section className="min-w-0">
      <SectionTitle aside={aside}>{title}</SectionTitle>
      {!season ? (
        <p className="text-[13px] text-ink-muted">Loading the game log…</p>
      ) : games.length === 0 ? (
        <p className="text-[13px] text-ink-muted">No games in the log this season.</p>
      ) : (
        <ul className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline bg-card">
          {games.map((g) => {
            const o = season.opps[g.row[F.o]!]!;
            const won = wonGame(g.row);
            const site = siteOf(g.row);
            return (
              <li key={g.idx}>
                <button
                  type="button"
                  title="Open the game  ·  Ctrl-click for a new tab, Shift-click for the side"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => onGame(g, { newTab: e.ctrlKey || e.metaKey, side: e.shiftKey })}
                  className="grid h-[50px] w-full grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-3 px-3.5 text-left text-[13px] transition-colors hover:bg-[var(--row-hover)]"
                >
                  <span className="whitespace-nowrap text-ink-muted">{shortDate(season.pack, g.row)}</span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="w-4 shrink-0 text-center text-[12px] text-ink-muted">
                        {site === "home" ? "vs" : site === "away" ? "@" : "N"}
                      </span>
                      <TeamLogo id={o.logoId} name={o.name} size={16} />
                      <span className="truncate text-ink-soft">{o.name}</span>
                      <span className={`shrink-0 text-[12px] font-semibold ${won ? "text-good" : "text-bad"}`}>{won ? "W" : "L"}</span>
                    </span>
                    <span className="truncate pl-6 text-[12px] text-ink-muted tabular">
                      <span className="text-ink">{g.row[F.pts]}</span> pts · <span className="text-ink">{g.row[F.reb]}</span> reb ·{" "}
                      <span className="text-ink">{g.row[F.ast]}</span> ast
                    </span>
                  </span>
                  <span className="whitespace-nowrap text-[12px] text-ink-muted tabular">
                    {g.row[F.fgm]}-{g.row[F.fga]} FG
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Career({
  rows,
  year,
  onSeason,
}: {
  rows: Array<{ year: number; team: string; teamLogoId: number | null; cls: string | null; games: number | null; minutes: number | null }>;
  year: number;
  onSeason: (y: number) => void;
}) {
  if (rows.length === 0) return <ProfileNote>No seasons in the index for this player.</ProfileNote>;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-10 pt-5">
      <div className="max-w-[720px] overflow-hidden rounded-lg border border-hairline bg-card">
        <div className="grid h-[32px] grid-cols-[84px_minmax(0,1fr)_56px_48px_56px] items-center gap-3 border-b border-hairline px-3.5 text-[10.5px] font-semibold uppercase tracking-[0.07em] text-ink-muted">
          <span>Season</span>
          <span>Team</span>
          <span>Class</span>
          <span className="text-right">GP</span>
          <span className="text-right">MPG</span>
        </div>
        <ul className="divide-y divide-hairline">
          {rows.map((r) => (
            <li key={r.year}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onSeason(r.year)}
                className={`grid h-[40px] w-full grid-cols-[84px_minmax(0,1fr)_56px_48px_56px] items-center gap-3 px-3.5 text-left text-[13px] transition-colors hover:bg-[var(--row-hover)] ${
                  r.year === year ? "bg-[var(--row-focus)]" : ""
                }`}
              >
                <span className="text-ink tabular">{seasonLabel(r.year)}</span>
                <span className="flex min-w-0 items-center gap-2">
                  <TeamLogo id={r.teamLogoId} name={r.team} size={16} />
                  <span className="truncate text-ink-soft">{r.team}</span>
                </span>
                <span>
                  <ClassBadge cls={r.cls} />
                </span>
                <span className="text-right text-ink-soft tabular">{r.games ?? "–"}</span>
                <span className="text-right text-ink-soft tabular">{r.minutes == null ? "–" : r.minutes.toFixed(1)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-3 text-[12px] text-ink-muted">Choose a season to open it on the Overview.</p>
    </div>
  );
}

/** The player's rail: the team around him that season, his seasons, and a link to share. */
function PlayerDetails({
  name,
  year,
  bartId,
  player,
  career,
  onSeason,
  onTeam,
  onCollapse,
}: {
  name: string;
  year: number;
  bartId: number | null;
  player: Player | null;
  career: Array<{ year: number; team: string; teamLogoId: number | null; cls: string | null }>;
  onSeason: (y: number) => void;
  onTeam: (team: string, logoId: number | null, how: OpenHow) => void;
  onCollapse: () => void;
}) {
  const { openRecord } = useShell();
  const history = player ? teamHistory(player.team) : [];
  const now = history.find((h) => h.year === year) ?? null;
  const openCoach = (coach: string, how: OpenHow) =>
    openRecord({ kind: "coach", slug: coachSlug(coach), name: coach, team: player?.team ?? null }, { newTab: how.newTab, side: how.side });

  return (
    <DetailsRail label={`${name} details`} onCollapse={onCollapse}>
      <DetailSection title="This season" aside={seasonLabel(year)}>
        {player ? (
          <>
            <DetailRow label="Team">
              <DetailLink
                title="Open the team  ·  Ctrl-click for a new tab"
                object={{ kind: "team", name: player.team, logoId: player.teamLogoId, year, conf: player.conf }}
                onOpen={(how) => onTeam(player.team, player.teamLogoId, how)}
              >
                <TeamLogo id={player.teamLogoId} name={player.team} size={16} />
                <span className="truncate">{player.team}</span>
              </DetailLink>
            </DetailRow>
            <DetailRow label="Conference">
              <ConfLogo conf={player.conf} size={16} />
              <span className="truncate">{player.confLabel}</span>
            </DetailRow>
            <DetailRow label="Coach">
              {now ? (
                <DetailLink title={`Open ${now.coach}'s page  ·  Ctrl-click for a new tab`} object={coachObj(now.coach, player.team)} onOpen={(how) => openCoach(now.coach, how)}>
                  <span className="truncate">{now.coach}</span>
                </DetailLink>
              ) : (
                <span className="text-ink-muted">Not on record</span>
              )}
            </DetailRow>
            <DetailRow label="Team NCAA">
              {now?.seed != null ? <span className="truncate">{ncaaLabel(now)}</span> : <span className="text-ink-muted">{now ? "No bid" : "Not on record"}</span>}
            </DetailRow>
            {player.cls && (
              <DetailRow label="Class">
                <ClassBadge cls={player.cls} />
              </DetailRow>
            )}
          </>
        ) : (
          <p className="py-1 text-[12.5px] text-ink-muted">No season in {seasonLabel(year)}.</p>
        )}
      </DetailSection>

      {career.length > 0 && (
        <DetailSection title="Seasons" aside={`${career.length} on record`}>
          <ul>
            {career.map((r) => {
              const current = r.year === year;
              return (
                <li key={r.year}>
                  <button
                    type="button"
                    aria-current={current || undefined}
                    title={`Open ${seasonLabel(r.year)}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onSeason(r.year)}
                    className={`-mx-2 grid h-[30px] w-[calc(100%+16px)] grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 text-left text-[12.5px] transition-colors ${
                      current ? "bg-[var(--nav-active)] text-ink" : "text-ink-soft hover:bg-[var(--row-hover)] hover:text-ink"
                    }`}
                  >
                    <span className="text-ink-muted tabular">{seasonLabel(r.year).slice(2)}</span>
                    <span className="flex min-w-0 items-center gap-1.5">
                      <TeamLogo id={r.teamLogoId} name={r.team} size={14} />
                      <span className="truncate">{r.team}</span>
                    </span>
                    <ClassBadge cls={r.cls} />
                  </button>
                </li>
              );
            })}
          </ul>
        </DetailSection>
      )}

      {bartId != null && (
        <>
          <DetailSection title="Go to">
            <RailActions
              obj={{ kind: "player", bartId, name, hasPhoto: player?.hasPhoto ?? false, year, team: player?.team, teamLogoId: player?.teamLogoId, conf: player?.conf }}
              groups={["goto", "filter"]}
            />
          </DetailSection>
          <DetailSection title="Share">
            <RailActions
              obj={{ kind: "player", bartId, name, hasPhoto: player?.hasPhoto ?? false, year, team: player?.team, teamLogoId: player?.teamLogoId, conf: player?.conf }}
              groups={["share"]}
            />
          </DetailSection>
        </>
      )}
    </DetailsRail>
  );
}
