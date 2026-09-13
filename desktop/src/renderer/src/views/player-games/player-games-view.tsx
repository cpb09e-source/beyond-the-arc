import { useEffect, useMemo, useState } from "react";
import { F, GAME_PRESETS, GAME_VIEWS, gameStat, gameViewByKey, passesFilters, type GameStat } from "@/lib/game-index";
import {
  gameMatcher,
  loadPlayerGameSeason,
  siteOf,
  statPercentiles,
  statValues,
  type PlayerGame,
} from "~/data/player-game-model";
import { SOURCE_LABEL, useLoaded } from "~/data/use-corpus";
import { Picker } from "~/shell/picker";
import { ShortcutBar } from "~/shell/shortcut-bar";
import { useSetStatus } from "~/shell/status";
import { LoadError, NoMatches, TableSkeleton, ViewHeader } from "~/shell/view-parts";
import type { ViewProps } from "~/shell/views";
import { DataTable } from "~/table/data-table";
import { identityColumns, NO_CHIP, statColumns } from "./player-game-columns";
import { PEEK_KEYS, PlayerGamePeekBody } from "./player-game-peek";

/**
 * Player Game Log: every player-game of a season, about 118,000 rows, all of
 * them on the table rather than the site's top 500.
 *
 * The site's five column views in a picker that is remembered, its eight
 * shortcuts composing through its passesFilters, Game Score as the default
 * sort, and a Peek on every row.
 */

const ROW_H = 42;
const VIEW_KEY = "bta.playerGames.view";

const gameKey = (g: PlayerGame) => g.idx;
/** Equal values fall back to the latest game. */
const latestFirst = (a: PlayerGame, b: PlayerGame) => b.row[F.d]! - a.row[F.d]! || a.idx - b.idx;

const VIEW_OPTIONS = GAME_VIEWS.map((v) => ({ key: v.key, label: v.label, desc: v.desc }));

function readView(): string {
  try {
    return gameViewByKey(localStorage.getItem(VIEW_KEY)).key;
  } catch {
    return GAME_VIEWS[0]!.key;
  }
}

export function PlayerGamesView({ year, setYear, query }: ViewProps) {
  const [state, retry] = useLoaded(`player-games|${year}`, () => loadPlayerGameSeason(year));
  const setStatus = useSetStatus();
  const [viewKey, setViewKey] = useState(readView);
  const [on, setOn] = useState<string[]>([]);

  const season = state.status === "ready" ? state.value : null;
  const view = gameViewByKey(viewKey);

  const columns = useMemo(
    () => (season ? [...identityColumns(season), ...statColumns(season, view.keys)] : []),
    [season, view],
  );
  const filters = useMemo(() => GAME_PRESETS.filter((p) => on.includes(p.key)).flatMap((p) => p.filters), [on]);
  const rows = useMemo(() => {
    if (!season) return [];
    const match = gameMatcher(season, query);
    // Nothing to narrow: the season's own array, so the table's sort memo holds.
    if (!match && filters.length === 0) return season.games;
    return season.games.filter(
      (g) => (filters.length === 0 || passesFilters(g.row, filters)) && (!match || match(g)),
    );
  }, [season, filters, query]);

  // Rank what a Peek shows while nothing else is happening, one stat per idle
  // slot, so the first Space opens at once instead of paying for ten
  // percentile passes in the middle of a keypress.
  useEffect(() => {
    if (!season) return;
    const queue = PEEK_KEYS.map((k) => gameStat(k)).filter((s): s is GameStat => !!s);
    let handle = 0;
    const step = (deadline: IdleDeadline) => {
      while (queue.length > 0 && deadline.timeRemaining() > 4) {
        const st = queue.shift()!;
        statValues(season.pack, st);
        if (!NO_CHIP.has(st.key)) statPercentiles(season.pack, st);
      }
      if (queue.length > 0) handle = requestIdleCallback(step);
    };
    handle = requestIdleCallback(step);
    return () => cancelIdleCallback(handle);
  }, [season]);

  useEffect(() => {
    if (state.status === "ready") setStatus(`${SOURCE_LABEL[state.source]} in ${state.ms} ms`);
    else if (state.status === "loading") setStatus("Loading…");
    else setStatus("Not loaded");
  }, [state, setStatus]);

  const pickView = (key: string) => {
    setViewKey(key);
    try {
      localStorage.setItem(VIEW_KEY, key);
    } catch {
      /* remembered for this session only */
    }
  };

  const total = season?.games.length ?? 0;
  const meta = season
    ? rows.length !== total
      ? `${rows.length.toLocaleString()} of ${total.toLocaleString()} player games`
      : `${total.toLocaleString()} player games`
    : undefined;
  // Game Score where the view has it, the site's own default; otherwise points.
  const sortKey = view.keys.includes("gmsc") ? "gmsc" : "pts";

  return (
    <>
      <ViewHeader
        kicker="Players"
        title="Player Game Log"
        year={year}
        setYear={setYear}
        meta={meta}
        controls={<Picker label="View" value={view.key} options={VIEW_OPTIONS} onChange={pickView} />}
      />
      <ShortcutBar presets={GAME_PRESETS} on={on} onChange={setOn} />

      <div className="relative min-h-0 flex-1 border-t border-hairline">
        {state.status === "ready" ? (
          <DataTable
            key={`${year}:${view.key}`}
            rows={rows}
            columns={columns}
            rowKey={gameKey}
            rowHeight={ROW_H}
            defaultSort={{ key: sortKey, dir: -1 }}
            tieBreak={latestFirst}
            ariaLabel="Player games"
            empty={
              query.trim() ? (
                <NoMatches query={query} noun="player, team, opponent or conference" />
              ) : (
                <p className="px-5 py-10 text-[13px] text-ink-muted">No game this season matches every shortcut that is on.</p>
              )
            }
            peek={{
              label: (g) => {
                const p = state.value.players[g.row[F.p]!]!;
                const o = state.value.opps[g.row[F.o]!]!;
                return `${p.name} ${siteOf(g.row) === "away" ? "at" : "vs"} ${o.name}`;
              },
              body: (g) => <PlayerGamePeekBody season={state.value} game={g} />,
            }}
          />
        ) : state.status === "loading" ? (
          <TableSkeleton rowHeight={ROW_H} label="Loading player games" />
        ) : (
          <LoadError year={year} reason={state.reason} message={state.message} what="Player games" onRetry={retry} />
        )}
      </div>
    </>
  );
}
