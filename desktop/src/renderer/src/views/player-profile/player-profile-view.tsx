import { useMemo, useState } from "react";
import { PercentileChip } from "@/components/percentile-chip";
import { TopHundredPill } from "@/components/portal/top-hundred-pill";
import { coachSlug } from "@/lib/coach-slug";
import { F, GAME_VIEWS, gameStat } from "@/lib/game-index";
import { playerViewByKey } from "@/lib/player-views";
import { logDate, useOpenGame } from "~/data/game-link";
import { NO_PCT } from "~/data/midrank-by-value";
import {
  loadPlayerGameSeason,
  shortDate,
  siteOf,
  statPercentiles,
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
import { useShell } from "~/shell/shell-context";
import { LoadError, TableSkeleton } from "~/shell/view-parts";
import type { ViewProps } from "~/shell/views";
import { DataTable, type Column } from "~/table/data-table";
import { ConfLogo } from "~/ui/conf-logo";
import { DetailLink, DetailRow, DetailSection, DetailsRail, DetailsToggle, useDetailsRail, type OpenHow } from "~/ui/details";
import { seasonLabel } from "~/ui/format";
import { TeamLogo } from "~/ui/logo";
import { ClassBadge, PlayerPhoto } from "~/ui/player-photo";
import {
  HighlightRow,
  PercentileBar,
  ProfileHeader,
  ProfileNote,
  ProfileTabs,
  SectionTitle,
  type Highlight,
} from "~/ui/profile";
import { identityColumns, statColumns as gameStatColumns } from "~/views/player-games/player-game-columns";
import { PlayerGamePeekBody } from "~/views/player-games/player-game-peek";
import { playerStat } from "~/views/players/player-columns";

/**
 * A player's page: the season at a glance, where every number on the Player
 * Explorer's Overview sits in the field, the best nights, every game, and the
 * seasons before.
 *
 * THE PERCENTILE PROFILE IS THE HEART OF IT. The site's own Overview columns,
 * banded the way the site bands them (EPM, Role, Scoring, Shooting,
 * Rebounding, Handle, Defense), each a bar in the ramp. A reader sees the shape
 * of a player before reading a single number.
 *
 * NOTHING ON IT IS NEW MATH: the explorer's percentiles, the game log's rows
 * and chips, the site's search index for the career list.
 */

type TabKey = "overview" | "games" | "career";

const gameKey = (g: PlayerGame) => g.idx;
const inOrder = (a: PlayerGame, b: PlayerGame) => a.row[F.d]! - b.row[F.d]! || a.idx - b.idx;
const OVERVIEW_BANDS = playerViewByKey("overview").bands;
const OVERVIEW_GAME_KEYS = GAME_VIEWS[0]!.keys;

export function PlayerProfileView({ year, setYear, record }: ViewProps) {
  const { openRecord } = useShell();
  const ref = record?.kind === "player" ? record : null;
  const bartId = ref?.bartId ?? -1;
  const [tab, setTab] = useState<TabKey>("overview");
  const [detailsOpen, toggleDetails] = useDetailsRail();

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
    return [{ ...pick("date"), pin: true }, pick("result"), pick("site"), pick("opp"), ...gameStatColumns(gameSeason, OVERVIEW_GAME_KEYS)];
  }, [gameSeason]);

  const highlights = (p: Player, s: PlayerSeason): Highlight[] => {
    const read = (key: string): Highlight => {
      const st = playerStat(key)!;
      return {
        label: st.label,
        value: st.format(p.s[st.field] as number | null),
        pct: st.pctKey ? (p.pct[st.pctKey] ?? null) : null,
        title: st.desc,
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
                <DetailsToggle open={detailsOpen} onToggle={toggleDetails} />
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
          <PlayerOverview season={season} player={player} gameSeason={gameSeason} games={games} onGame={openLogGame} />
        ) : (
          <div className="relative min-h-0 flex-1">
            {gameSeason ? (
              <DataTable
                key={`games:${year}:${bartId}`}
                rows={games}
                columns={gameColumns}
                rowKey={gameKey}
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
              <TableSkeleton rowHeight={42} label="Loading games" />
            )}
          </div>
        )}
      </div>
      {detailsOpen && (
        <PlayerDetails
          name={name}
          year={year}
          bartId={ref?.bartId ?? null}
          player={player ?? null}
          career={career}
          onSeason={setYear}
          onTeam={(team, logoId, how) => openRecord({ kind: "team", name: team, logoId }, { newTab: how.newTab, side: how.side, year })}
        />
      )}
    </div>
  );
}

function PlayerOverview({
  season,
  player,
  gameSeason,
  games,
  onGame,
}: {
  season: PlayerSeason;
  player: Player;
  gameSeason: PlayerGameSeason | null;
  games: PlayerGame[];
  onGame: (g: PlayerGame, how: { newTab: boolean; side?: boolean }) => void;
}) {
  const line: Array<[label: string, value: number | null, digits: number]> = [
    ["GP", player.s.games, 0],
    ["MPG", player.s.min_pg, 1],
    ["PPG", player.s.pts_pg, 1],
    ["RPG", player.s.reb_pg, 1],
    ["APG", player.s.ast_pg, 1],
    ["SPG", player.s.stl_pg, 1],
    ["BPG", player.s.blk_pg, 1],
    ["TOV", player.s.tov_pg, 1],
  ];

  const best = useMemo(() => {
    if (!gameSeason || games.length === 0) return [];
    const st = gameStat("gmsc")!;
    const values = statValues(gameSeason.pack, st);
    const pcts = statPercentiles(gameSeason.pack, st);
    return [...games]
      .sort((a, b) => values[b.idx]! - values[a.idx]!)
      .slice(0, 5)
      .map((g) => ({ g, gmsc: values[g.idx]!, pct: pcts[g.idx]! === NO_PCT ? null : pcts[g.idx]! }));
  }, [gameSeason, games]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-10 pt-5">
      <div className="grid gap-x-10 gap-y-7 @5xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <section>
          <SectionTitle aside="Percentile among the season's players">Percentile profile</SectionTitle>
          <div className="rounded-lg border border-hairline bg-card px-4 py-2">
            {OVERVIEW_BANDS.map((band, i) => (
              <div key={band.label} className={i > 0 ? "mt-2 border-t border-hairline pt-2" : ""}>
                <div className="flex items-baseline justify-between py-1">
                  <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted">{band.label}</h3>
                  {band.label === "EPM" && season.estimated && (
                    <span className="text-[11px] text-ink-muted">Estimated from the box score</span>
                  )}
                </div>
                {band.keys.map((key) => {
                  const st = playerStat(key);
                  if (!st) return null;
                  if (key === "ewins" && !season.hasEwins) return null;
                  return (
                    <PercentileBar
                      key={key}
                      label={st.label}
                      value={st.format(player.s[st.field] as number | null)}
                      pct={st.pctKey ? (player.pct[st.pctKey] ?? null) : null}
                      title={st.desc}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </section>

        <div className="flex flex-col gap-7">
          <section>
            <SectionTitle>Season line</SectionTitle>
            <div className="grid grid-cols-4 gap-px overflow-hidden rounded-lg border border-hairline bg-hairline">
              {line.map(([label, value, digits]) => (
                <div key={label} className="bg-card px-3 py-2.5">
                  <div className="text-[11.5px] text-ink-muted">{label}</div>
                  <div className="mt-1 text-[16px] font-semibold text-ink tabular">
                    {value == null ? "–" : value.toFixed(digits)}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <SectionTitle aside="By Game Score">Best games</SectionTitle>
            {!gameSeason ? (
              <p className="text-[13px] text-ink-muted">Loading the game log…</p>
            ) : best.length === 0 ? (
              <p className="text-[13px] text-ink-muted">No games in the log this season.</p>
            ) : (
              <ul className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline bg-card">
                {best.map(({ g, gmsc, pct }) => {
                  const o = gameSeason.opps[g.row[F.o]!]!;
                  const won = wonGame(g.row);
                  const site = siteOf(g.row);
                  return (
                    <li key={g.idx}>
                      <button
                        type="button"
                        title="Open the game  ·  Ctrl-click for a new tab, Shift-click for the side"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => onGame(g, { newTab: e.ctrlKey || e.metaKey, side: e.shiftKey })}
                        className="grid h-[50px] w-full grid-cols-[48px_minmax(0,1fr)_44px] items-center gap-3 px-3.5 text-left text-[13px] transition-colors hover:bg-[var(--row-hover)]"
                      >
                        <span className="whitespace-nowrap text-ink-muted">{shortDate(gameSeason.pack, g.row)}</span>
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
                        <span className="flex justify-end">
                          <PercentileChip pct={pct} ariaLabel={`Game Score ${gmsc.toFixed(1)}`} className="min-w-[40px] text-[11px]">
                            {gmsc.toFixed(1)}
                          </PercentileChip>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
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
}: {
  name: string;
  year: number;
  bartId: number | null;
  player: Player | null;
  career: Array<{ year: number; team: string; teamLogoId: number | null; cls: string | null }>;
  onSeason: (y: number) => void;
  onTeam: (team: string, logoId: number | null, how: OpenHow) => void;
}) {
  const { openRecord } = useShell();
  const history = player ? teamHistory(player.team) : [];
  const now = history.find((h) => h.year === year) ?? null;
  const openCoach = (coach: string, how: OpenHow) =>
    openRecord({ kind: "coach", slug: coachSlug(coach), name: coach, team: player?.team ?? null }, { newTab: how.newTab, side: how.side });

  return (
    <DetailsRail label={`${name} details`}>
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
