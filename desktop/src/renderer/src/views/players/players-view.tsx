import { useEffect, useMemo } from "react";
import { TopHundredPill } from "@/components/portal/top-hundred-pill";
import { loadPlayerSeason, type Player, type PlayerSeason } from "~/data/player-model";
import { SOURCE_LABEL, useLoaded } from "~/data/use-corpus";
import { useSetStatus } from "~/shell/status";
import { LoadError, NoMatches, TableSkeleton, ViewHeader } from "~/shell/view-parts";
import type { ViewProps } from "~/shell/views";
import { DataTable, type Column } from "~/table/data-table";
import { seasonLabel } from "~/ui/format";
import { TeamLogo } from "~/ui/logo";
import { ClassBadge, PlayerPhoto } from "~/ui/player-photo";
import { matchesQuery } from "~/ui/text";
import { statColumns } from "./player-columns";
import { PlayerPeekBody } from "./player-peek";

/**
 * Player Explorer: every player on the season's leaderboard, the site's
 * Overview columns with percentile chips, and a Peek on every row.
 *
 * WIDE ON PURPOSE. Seventeen stats do not fit beside a name at 1440px, so the
 * rank and the player stay pinned while the stats scroll under them.
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

export function PlayersView({ year, setYear, query }: ViewProps) {
  const [state, retry] = useLoaded(`player-season|${year}`, () => loadPlayerSeason(year));
  const setStatus = useSetStatus();

  const season: PlayerSeason | null = state.status === "ready" ? state.value : null;
  const rows = useMemo(
    () =>
      season
        ? season.players.filter((p) =>
            matchesQuery(query, p.name, p.team, p.confLabel, p.conf, p.cls ?? "", p.position ?? "", p.hometown ?? ""),
          )
        : [],
    [season, query],
  );

  useEffect(() => {
    if (state.status === "ready") setStatus(`${SOURCE_LABEL[state.source]} in ${state.ms} ms`);
    else if (state.status === "loading") setStatus("Loading…");
    else setStatus("Not loaded");
  }, [state, setStatus]);

  const total = season?.players.length ?? 0;
  const meta = season
    ? `${query.trim() && rows.length !== total ? `${rows.length.toLocaleString()} of ${total.toLocaleString()}` : total.toLocaleString()} players · ${season.minGames}+ games${season.estimated ? " · EPM estimated" : ""}`
    : undefined;

  return (
    <>
      <ViewHeader kicker="Players" title="Player Explorer" year={year} setYear={setYear} meta={meta} />
      <div className="relative min-h-0 flex-1 border-t border-hairline">
        {state.status === "ready" ? (
          <DataTable
            key={year}
            rows={rows}
            columns={state.value.hasEwins ? COLUMNS : COLUMNS_NO_EWINS}
            rowKey={playerKey}
            rowHeight={ROW_H}
            defaultSort={{ key: state.value.defaultSort, dir: -1 }}
            tieBreak={byRank}
            ariaLabel="Players"
            empty={<NoMatches query={query} noun="player, team or conference" />}
            peek={{ label: (p) => p.name, body: (p) => <PlayerPeekBody season={state.value} player={p} /> }}
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
