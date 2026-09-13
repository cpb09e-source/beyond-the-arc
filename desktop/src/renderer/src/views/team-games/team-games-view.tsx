import { useEffect, useMemo, useState } from "react";
import { T, TEAM_GAME_PRESETS, TEAM_GAME_VIEWS, passesTeamFilters, teamGameViewByKey } from "@/lib/team-game-index";
import { logDate } from "~/data/game-link";
import { loadTeamGameSeason, type TeamGame } from "~/data/team-game-model";
import type { Obj } from "~/objects/object";
import { SOURCE_LABEL, useLoaded } from "~/data/use-corpus";
import { Picker } from "~/shell/picker";
import { ShortcutBar } from "~/shell/shortcut-bar";
import { useSetStatus } from "~/shell/status";
import { LoadError, NoMatches, TableSkeleton, ViewHeader } from "~/shell/view-parts";
import type { ViewProps } from "~/shell/views";
import { DataTable, type Column } from "~/table/data-table";
import { TeamLogo } from "~/ui/logo";
import { parseScoped, sameName } from "~/ui/scoped-query";
import { normalizeText } from "~/ui/text";
import { statColumns } from "./game-columns";
import { GamePeekBody } from "./game-peek";

/**
 * Team Game Log: every team's every game of a season, eleven thousand rows, the
 * site's seven column views, and its shortcuts.
 *
 * SHORTCUTS COMPOSE, as they do on the site: "30-point wins" and "Beat a ranked
 * team" together mean both. Each is a named filter from TEAM_GAME_PRESETS and
 * runs through the site's passesTeamFilters.
 *
 * THE VIEW IS REMEMBERED, the season is not: the season belongs to the
 * workspace, and which columns a reader likes to see belongs to this table.
 */

const ROW_H = 42;
const VIEW_KEY = "bta.teamGames.view";

const gameKey = (g: TeamGame) => g.idx;
/** Equal values fall back to the latest game. */
const latestFirst = (a: TeamGame, b: TeamGame) => b.row[T.d]! - a.row[T.d]! || a.idx - b.idx;

const VIEW_OPTIONS = TEAM_GAME_VIEWS.map((v) => ({ key: v.key, label: v.label, desc: v.desc }));

function readView(): string {
  try {
    return teamGameViewByKey(localStorage.getItem(VIEW_KEY)).key;
  } catch {
    return TEAM_GAME_VIEWS[0]!.key;
  }
}

/** An AP rank in front of a name, the way a box score prints it. */
function Rank({ ap }: { ap: number }) {
  if (ap <= 0) return null;
  return <span className="shrink-0 text-[10.5px] font-medium text-ink-muted tabular">{ap}</span>;
}

function Tag({ children }: { children: string }) {
  return (
    <span className="shrink-0 rounded-[4px] border border-hairline px-1 py-px text-[9.5px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
      {children}
    </span>
  );
}

export const TEAM_GAME_IDENTITY: Column<TeamGame>[] = [
  {
    key: "pos", label: "#", title: "Place in the current sort", width: 60, align: "right", first: 1, pin: true,
    cell: (_g, i) => <span className="text-ink-muted tabular">{(i + 1).toLocaleString()}</span>,
  },
  {
    key: "team", label: "Team", width: 188, align: "left", first: 1, pin: true,
    sortValue: (g) => g.team,
    cell: (g) => (
      <span className="flex min-w-0 items-center gap-2">
        <TeamLogo id={g.teamLogoId} name={g.team} size={20} />
        <Rank ap={g.ap} />
        <span className="truncate font-medium text-ink">{g.team}</span>
      </span>
    ),
  },
  {
    key: "result", label: "Result", title: "Wins first, then by margin", width: 104, align: "left", first: -1,
    sortValue: (g) => (g.won ? 1000 : 0) + g.pts - g.pa,
    cell: (g) => (
      <span className="flex items-baseline gap-2 tabular">
        <span className={`w-3 font-semibold ${g.won ? "text-good" : "text-bad"}`}>{g.won ? "W" : "L"}</span>
        <span className="text-ink">
          {g.pts}–{g.pa}
        </span>
        {g.ot && <span className="text-[10.5px] text-ink-muted">OT</span>}
      </span>
    ),
  },
  {
    key: "site", label: "Site", title: "Home (vs), away (@) or a neutral floor (N)", width: 52, align: "center", first: -1,
    sortValue: (g) => (g.site === "home" ? 2 : g.site === "neutral" ? 1 : 0),
    cell: (g) => <span className="text-ink-muted">{g.site === "home" ? "vs" : g.site === "away" ? "@" : "N"}</span>,
  },
  {
    key: "opp", label: "Opponent", width: 220, align: "left", first: 1,
    sortValue: (g) => g.opp,
    cell: (g) => (
      <span className="flex min-w-0 items-center gap-2">
        <TeamLogo id={g.oppLogoId} name={g.opp} size={18} />
        <Rank ap={g.oppAp} />
        <span className="truncate text-ink-soft">{g.opp}</span>
        {g.tourney ? <Tag>NCAA</Tag> : g.post ? <Tag>Post</Tag> : null}
      </span>
    ),
  },
  {
    key: "date", label: "Date", width: 76, align: "right", first: -1,
    sortValue: (g) => g.row[T.d]!,
    cell: (g) => <span className="text-ink-soft tabular">{g.dateShort}</span>,
  },
];

/** A row as the object it is: one team's game, found on its night's slate when it is opened. */
export const teamLogObject = (g: TeamGame, epochMs: number, year: number): Obj => ({
  kind: "log-game",
  year,
  date: logDate(epochMs, g.row[T.d]!),
  team: g.team,
  teamLogoId: g.teamLogoId,
  opp: g.opp,
  oppLogoId: g.oppLogoId,
  site: g.site,
  summary: `${g.team} ${g.pts}, ${g.opp} ${g.pa}${g.ot ? " (OT)" : ""}`,
});

export function TeamGamesView({ year, setYear, query, setQuery }: ViewProps) {
  const [state, retry] = useLoaded(`team-games|${year}`, () => loadTeamGameSeason(year));
  const setStatus = useSetStatus();
  const [viewKey, setViewKey] = useState(readView);
  const [on, setOn] = useState<string[]>([]);

  const season = state.status === "ready" ? state.value : null;
  const view = teamGameViewByKey(viewKey);

  const columns = useMemo(
    () => (season ? [...TEAM_GAME_IDENTITY, ...statColumns(season.pack, view.keys)] : TEAM_GAME_IDENTITY),
    [season, view],
  );
  const filters = useMemo(() => TEAM_GAME_PRESETS.filter((p) => on.includes(p.key)).flatMap((p) => p.filters), [on]);
  const rows = useMemo(() => {
    if (!season) return [];
    const scoped = parseScoped(query);
    const words = scoped ? [] : normalizeText(query).split(" ").filter(Boolean);
    const inScope = (g: TeamGame): boolean =>
      !scoped ||
      (scoped.scope === "team"
        ? sameName(g.team, scoped.value)
        : scoped.scope === "opponents"
          ? sameName(g.opp, scoped.value)
          : scoped.scope === "conf" && (sameName(g.confLabel, scoped.value) || sameName(g.conf, scoped.value)));
    return season.games.filter(
      (g) =>
        (filters.length === 0 || passesTeamFilters(g.row, filters)) && inScope(g) && words.every((w) => g.hay.includes(w)),
    );
  }, [season, filters, query]);

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
      ? `${rows.length.toLocaleString()} of ${total.toLocaleString()} games`
      : `${total.toLocaleString()} games`
    : undefined;
  // Net rating where the view has it, the site's own default; otherwise the view's lead stat.
  const sortKey = view.keys.includes("net") ? "net" : view.keys[0]!;

  return (
    <>
      <ViewHeader
        kicker="Teams"
        title="Team Game Log"
        year={year}
        setYear={setYear}
        meta={meta}
        controls={<Picker label="View" value={view.key} options={VIEW_OPTIONS} onChange={pickView} />}
        filter={{ value: query, onChange: setQuery, placeholder: "Filter games" }}
      />

      <ShortcutBar presets={TEAM_GAME_PRESETS} on={on} onChange={setOn} />

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
            id="team-game-log"
            object={(g) => teamLogObject(g, state.value.pack.epochMs, year)}
            ariaLabel="Team games"
            empty={
              query.trim() ? (
                <NoMatches query={query} noun="team, opponent or conference" />
              ) : (
                <p className="px-5 py-10 text-[13px] text-ink-muted">No game this season matches every shortcut that is on.</p>
              )
            }
            peek={{
              label: (g) => `${g.team} ${g.site === "away" ? "at" : "vs"} ${g.opp}`,
              body: (g) => <GamePeekBody season={state.value} game={g} />,
            }}
          />
        ) : state.status === "loading" ? (
          <TableSkeleton rowHeight={ROW_H} label="Loading team games" />
        ) : (
          <LoadError year={year} reason={state.reason} message={state.message} what="Team games" onRetry={retry} />
        )}
      </div>
    </>
  );
}
