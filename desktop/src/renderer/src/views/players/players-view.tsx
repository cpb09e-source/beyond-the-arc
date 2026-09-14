import { useEffect, useMemo } from "react";
import { TopHundredPill } from "@/components/portal/top-hundred-pill";
import { PLAYER_STAT_COLUMNS } from "@/lib/players";
import { loadPlayerSeason, type Player, type PlayerSeason } from "~/data/player-model";
import { SOURCE_LABEL, useLoaded } from "~/data/use-corpus";
import { useFocusSubject } from "~/focus/focus-mode";
import type { Obj } from "~/objects/object";
import { useTabTitle } from "~/shell/tab-title";
import { useSetStatus } from "~/shell/status";
import { LoadError, NoMatches, TableSkeleton, ViewHeader } from "~/shell/view-parts";
import type { ViewProps } from "~/shell/views";
import { DataTable, type Column } from "~/table/data-table";
import { seasonLabel } from "~/ui/format";
import { TeamLogo } from "~/ui/logo";
import { ClassBadge, PlayerPhoto } from "~/ui/player-photo";
import { catalogStats, conditionTest, filterHelp, filterProblem, parseFilter, sortedNames, statIndex } from "~/ui/filter-query";
import { sameName, scopedNames, type Scope } from "~/ui/scoped-query";
import { matchesQuery, normalizeText } from "~/ui/text";
import { playerLens } from "~/lens/stat-lens";
import { playerStat, statColumns } from "./player-columns";
import { PlayerPeekBody } from "./player-peek";

/**
 * Player Explorer: every player on the season's leaderboard, the site's
 * Overview columns with percentile chips, and a Peek on every row.
 *
 * WIDE ON PURPOSE. Seventeen stats do not fit beside a name at 1440px, so the
 * rank and the player stay pinned while the stats scroll under them.
 *
 * A ROW IS A PLAYER OBJECT; the filter also takes "team: Duke", "conf: SEC" and
 * "player: Cooper Flagg", which is where "Duke players" and the like land, and
 * conditions on any stat the site's player filters take: "ppg>15 3p>38".
 */

const ROW_H = 42;

const playerKey = (p: Player) => p.id;
const byRank = (a: Player, b: Player) => (a.rank ?? 1e9) - (b.rank ?? 1e9);

/**
 * THE # IS THE ROW'S PLACE IN THE CURRENT SORT, as on the site. BTA's overall
 * rank covers only the top of each season (659 of 2,614 players in 2025-26), so
 * as a column it was a dash on three rows in four. It rides with the name
 * instead, as the site's top-100 mark, where it is a fact about the player.
 */
const IDENTITY: Column<Player>[] = [
  {
    key: "pos", label: "#", title: "Place in the current sort", width: 48, align: "right", first: 1, pin: true,
    cell: (_p, i) => <span className="text-ink-muted tabular">{i + 1}</span>,
  },
  {
    key: "name", label: "Player", width: 244, align: "left", first: 1, pin: true,
    sortValue: (p) => p.name,
    cell: (p) => (
      <span className="flex min-w-0 items-center gap-2">
        <PlayerPhoto bartId={p.bartId} hasPhoto={p.hasPhoto} name={p.name} size={24} />
        <span className="truncate font-medium text-ink">{p.name}</span>
        <ClassBadge cls={p.cls} />
        {p.rank != null && p.rank <= 100 && (
          <TopHundredPill rank={p.rank} title={`Top 100: #${p.rank} in the country in ${seasonLabel(p.s.year)}`} />
        )}
      </span>
    ),
  },
  {
    key: "team", label: "Team", width: 156, align: "left", first: 1,
    sortValue: (p) => p.team,
    cell: (p) => (
      <span className="flex min-w-0 items-center gap-1.5">
        <TeamLogo id={p.teamLogoId} name={p.team} size={16} />
        <span className="truncate text-ink-soft">{p.team}</span>
      </span>
    ),
  },
  {
    key: "gp", label: "GP", title: "Games played", width: 44, align: "right", first: -1,
    sortValue: (p) => p.s.games,
    cell: (p) => <span className="text-ink-soft tabular">{p.s.games ?? "–"}</span>,
  },
];

const COLUMNS: Column<Player>[] = [...IDENTITY, ...statColumns()];
/** For seasons without eWins. Module-level, so the table sees a stable list. */
const COLUMNS_NO_EWINS: Column<Player>[] = COLUMNS.filter((c) => c.key !== "ewins");

/** What "ppg>15" can name: the rank, and every stat the site's player filters take, by its header. */
const PLAYER_STATS = statIndex<Player>([
  { name: "rank", aliases: ["btarank"], label: "BTA rank", desc: "BTA's overall player rank", digits: 0, get: (p) => p.rank },
  ...catalogStats(PLAYER_STAT_COLUMNS, {
    get: (c) => (p: Player) => p.s[c.field] as number | null,
    fmt: (c) => c.format,
    desc: (c) => c.desc,
    aliases: { ppg: ["pts"], rpg: ["reb"], apg: ["ast"], spg: ["stl"], bpg: ["blk"], mpg: ["min"], epm: ["arc"] },
  }),
]);
const PLAYER_SCOPES: Scope[] = ["player", "team", "teams", "conf"];

export function PlayersView({ year, setYear, query, setQuery, focus, onLanded }: ViewProps) {
  const [state, retry] = useLoaded(`player-season|${year}`, () => loadPlayerSeason(year));
  const setStatus = useSetStatus();
  useTabTitle(query.trim() ? `Players: ${query.trim()}` : null);

  const season: PlayerSeason | null = state.status === "ready" ? state.value : null;
  // A Ctrl K result for a player in this season. The index can name a player the
  // leaderboard floor leaves out, and then there is no row to land on.
  const target = focus?.kind === "player" && focus.year === year ? focus : null;
  const landing = target && season ? season.players.find((p) => p.bartId === target.bartId) : undefined;
  const parsed = useMemo(() => parseFilter(query), [query]);
  const rows = useMemo(() => {
    if (!season) return [];
    const scopes = parsed.scopes.map((s): ((p: Player) => boolean) => {
      const v = s.value;
      if (s.scope === "team") return (p) => sameName(p.team, v);
      if (s.scope === "teams") {
        const names = new Set(scopedNames(v).map(normalizeText));
        return (p) => names.has(normalizeText(p.team));
      }
      if (s.scope === "conf") return (p) => sameName(p.confLabel, v) || sameName(p.conf, v);
      if (s.scope === "player") return (p) => sameName(p.name, v);
      return () => false;
    });
    const stats = conditionTest(PLAYER_STATS, parsed.conditions);
    return season.players.filter(
      (p) =>
        matchesQuery(parsed.words, p.name, p.team, p.confLabel, p.conf, p.cls ?? "", p.position ?? "", p.hometown ?? "") &&
        scopes.every((f) => f(p)) &&
        (!stats || stats(p)),
    );
  }, [season, parsed]);

  const help = useMemo(() => {
    if (!season) return undefined;
    const teams = () => sortedNames(season.players.map((p) => p.team));
    return filterHelp({
      noun: "players",
      index: PLAYER_STATS,
      rows: season.players,
      scopes: PLAYER_SCOPES,
      names: {
        player: () => [...season.players].sort(byRank).map((p) => p.name),
        team: teams,
        teams,
        conf: () => sortedNames(season.players.map((p) => p.confLabel)),
      },
    });
  }, [season]);

  useEffect(() => {
    if (state.status === "ready") setStatus(`${SOURCE_LABEL[state.source]} in ${state.ms} ms`);
    else if (state.status === "loading") setStatus("Loading…");
    else setStatus("Not loaded");
  }, [state, setStatus]);

  // Focus on a player lights his row among his team's (the team comes as the filter).
  const focusSubject = useFocusSubject();
  const spotKey =
    focusSubject?.kind === "player" && season ? (season.players.find((p) => p.bartId === focusSubject.bartId)?.id ?? null) : null;

  const total = season?.players.length ?? 0;
  const meta = !season
    ? undefined
    : target && !landing
      ? `${target.name} is not on the ${seasonLabel(year)} leaderboard`
      : `${query.trim() && rows.length !== total ? `${rows.length.toLocaleString()} of ${total.toLocaleString()}` : total.toLocaleString()} players · ${season.minGames}+ games${season.estimated ? " · EPM estimated" : ""}`;

  const object = (p: Player): Obj | null =>
    p.bartId == null
      ? null
      : { kind: "player", bartId: p.bartId, name: p.name, hasPhoto: p.hasPhoto, year, team: p.team, teamLogoId: p.teamLogoId, conf: p.conf };
  // Alt-click or right-click a number: the games behind it.
  const statLens = (p: Player, key: string) => {
    const st = playerStat(key);
    if (!st || p.bartId == null) return null;
    return playerLens(key, { kind: "player", bartId: p.bartId, name: p.name, hasPhoto: p.hasPhoto, year }, { label: st.label, value: st.format(p.s[st.field] as number | null) });
  };

  return (
    <>
      <ViewHeader
        kicker="Players"
        title="Player Explorer"
        year={year}
        setYear={setYear}
        meta={meta}
        filter={{ value: query, onChange: setQuery, placeholder: "Filter players", help }}
      />
      <div className="relative min-h-0 flex-1 border-t border-hairline">
        {state.status === "ready" ? (
          <DataTable
            key={year}
            id="player-explorer"
            rows={rows}
            columns={state.value.hasEwins ? COLUMNS : COLUMNS_NO_EWINS}
            rowKey={playerKey}
            rowHeight={ROW_H}
            defaultSort={{ key: state.value.defaultSort, dir: -1 }}
            tieBreak={byRank}
            ariaLabel="Players"
            empty={<NoMatches query={query} noun="player, team or conference" problem={filterProblem(parsed, PLAYER_STATS, PLAYER_SCOPES)} />}
            peek={{ label: (p) => p.name, body: (p) => <PlayerPeekBody season={state.value} player={p} /> }}
            landOn={landing && target ? { key: landing.id, nonce: target.nonce } : undefined}
            onLanded={onLanded}
            object={object}
            spotlight={spotKey}
            statLens={statLens}
          />
        ) : state.status === "loading" ? (
          <TableSkeleton rowHeight={ROW_H} label="Loading players" />
        ) : (
          <LoadError year={year} reason={state.reason} message={state.message} what="Players" onRetry={retry} />
        )}
      </div>
    </>
  );
}
