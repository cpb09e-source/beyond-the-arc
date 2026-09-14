import { ListChecks } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { StaticTeamSeasonRow } from "@/lib/static-data";
import { loadTeamGameSeason } from "~/data/team-game-model";
import { shapeSeason, type Season, type Team } from "~/data/team-model";
import { loadOnce, SOURCE_LABEL, useCorpus } from "~/data/use-corpus";
import type { Obj } from "~/objects/object";
import { focusTeam, useFocusSubject } from "~/focus/focus-mode";
import { teamLens } from "~/lens/stat-lens";
import { useEcho, useSelection, type SelectMode } from "~/selection/selection";
import { useTabTitle } from "~/shell/tab-title";
import { useSetStatus } from "~/shell/status";
import { LoadError, NoMatches, TableSkeleton, ViewHeader } from "~/shell/view-parts";
import type { ViewProps } from "~/shell/views";
import { DataTable, type Column } from "~/table/data-table";
import { StatCell } from "~/table/stat-cell";
import { num1, pct1, seasonLabel, signed1 } from "~/ui/format";
import { TeamLogo } from "~/ui/logo";
import { conditionTest, filterHelp, filterProblem, parseFilter, sortedNames, statIndex } from "~/ui/filter-query";
import { sameName, scopedNames, type Scope } from "~/ui/scoped-query";
import { matchesQuery, normalizeText } from "~/ui/text";
import { TeamPeekBody } from "./team-peek";

/**
 * Team Explorer: every team in a season, with the site's percentile chip on
 * every stat and a Peek on every row.
 *
 * A ROW IS A TEAM OBJECT, so its menu, C, F, drag and Enter are the registry's
 * (~/objects/actions.tsx). The filter also takes the registry's exact forms:
 * "conf: Big Ten", "opponents: Michigan", "team: Duke", "teams: Duke, Houston",
 * and conditions on its numbers beside them: "conf: SEC net>20 tempo<68".
 *
 * LINKED TO EVERY OTHER TEAM VIEW. Its picked rows are the shared selection
 * (~/selection/selection.tsx), so a lasso on Team Scatter tints them here and
 * Ctrl-click here rings the crests there; the row under the pointer is echoed
 * to the chart the same way.
 */

const ROW_H = 42;

const shapeTeams = (json: string, year: number): Season => shapeSeason(year, JSON.parse(json) as StaticTeamSeasonRow[]);
const teamKey = (t: Team) => t.id;
const byBtaRank = (a: Team, b: Team) => (a.btaRank ?? 1e9) - (b.btaRank ?? 1e9);

const COLUMNS: Column<Team>[] = [
  {
    key: "rank", label: "#", title: "BTA rank", width: 48, align: "right", first: 1, pin: true,
    sortValue: (t) => t.btaRank,
    cell: (t) => <span className="text-ink-muted tabular">{t.btaRank ?? "–"}</span>,
  },
  {
    key: "name", label: "Team", width: 216, align: "left", first: 1, pin: true,
    sortValue: (t) => t.name,
    cell: (t) => (
      <span className="flex min-w-0 items-center gap-2">
        <TeamLogo id={t.logoId} name={t.name} size={20} />
        <span className="truncate font-medium text-ink">{t.name}</span>
      </span>
    ),
  },
  {
    key: "conf", label: "Conf", width: 100, align: "left", first: 1,
    sortValue: (t) => t.confLabel,
    cell: (t) => <span className="block truncate text-ink-soft">{t.confLabel}</span>,
  },
  {
    key: "record", label: "W-L", width: 64, align: "right", first: -1,
    sortValue: (t) => t.wins - t.losses,
    cell: (t) => <StatCell value={`${t.wins}-${t.losses}`} pct={t.pct.win_pct} />,
  },
  {
    key: "adjO", label: "Adj O", title: "Adjusted offensive rating", width: 64, align: "right", first: -1,
    sortValue: (t) => t.adjO,
    cell: (t) => <StatCell value={num1(t.adjO)} pct={t.pct.a_ortg} />,
  },
  {
    key: "adjD", label: "Adj D", title: "Adjusted defensive rating (lower is better)", width: 64, align: "right", first: 1,
    sortValue: (t) => t.adjD,
    cell: (t) => <StatCell value={num1(t.adjD)} pct={t.pct.a_drtg} />,
  },
  {
    key: "adjNet", label: "Net", title: "Adjusted net rating", width: 64, align: "right", first: -1,
    sortValue: (t) => t.adjNet,
    cell: (t) => <StatCell value={signed1(t.adjNet)} pct={t.pct.a_net} strong />,
  },
  {
    // NEUTRAL, deliberately: pace has no good end, as percentile-chip.tsx prescribes.
    key: "tempo", label: "Tempo", title: "Adjusted tempo", width: 64, align: "right", first: -1,
    sortValue: (t) => t.tempo,
    cell: (t) => <StatCell value={num1(t.tempo)} pct={t.pct.adjt} neutral />,
  },
  {
    key: "efg", label: "eFG%", title: "Effective field goal %", width: 62, align: "right", first: -1,
    sortValue: (t) => t.efg,
    cell: (t) => <StatCell value={pct1(t.efg)} pct={t.pct.cbb_efg} />,
  },
  {
    key: "efgDef", label: "Opp eFG%", title: "Opponent effective field goal % (lower is better)", width: 80, align: "right", first: 1,
    sortValue: (t) => t.efgDef,
    cell: (t) => <StatCell value={pct1(t.efgDef)} pct={t.pct.cbb_efg_def} />,
  },
  {
    key: "tov", label: "TOV%", title: "Turnover rate (lower is better)", width: 62, align: "right", first: 1,
    sortValue: (t) => t.tov,
    cell: (t) => <StatCell value={pct1(t.tov)} pct={t.pct.cbb_tov} />,
  },
  {
    key: "orb", label: "OREB%", title: "Offensive rebound rate", width: 68, align: "right", first: -1,
    sortValue: (t) => t.orb,
    cell: (t) => <StatCell value={pct1(t.orb)} pct={t.pct.cbb_orb} />,
  },
  {
    key: "fg3", label: "3P%", title: "Three-point %", width: 60, align: "right", first: -1,
    sortValue: (t) => t.fg3,
    cell: (t) => <StatCell value={pct1(t.fg3)} pct={t.pct.cbb_fg3} />,
  },
  {
    key: "sos", label: "SOS", title: "Strength of schedule", width: 60, align: "right", first: -1,
    sortValue: (t) => t.sos,
    cell: (t) => <StatCell value={num1(t.sos)} pct={t.pct.adj_sos} />,
  },
];

/** A cell's number as it reads in the table, for the Stat Lens to repeat. */
const SHOWN: Record<string, (t: Team) => string> = {
  record: (t) => `${t.wins}-${t.losses}`,
  adjO: (t) => num1(t.adjO),
  adjD: (t) => num1(t.adjD),
  adjNet: (t) => signed1(t.adjNet),
  tempo: (t) => num1(t.tempo),
  efg: (t) => pct1(t.efg),
  efgDef: (t) => pct1(t.efgDef),
  tov: (t) => pct1(t.tov),
  orb: (t) => pct1(t.orb),
  fg3: (t) => pct1(t.fg3),
};

/** What "net>20" can name here: every number the table prints, by its header. */
const TEAM_STATS = statIndex<Team>([
  { name: "rank", aliases: ["bta", "btarank"], label: "BTA rank", digits: 0, get: (t) => t.btaRank },
  { name: "wins", aliases: ["w"], label: "Wins", digits: 0, get: (t) => t.wins },
  { name: "losses", aliases: ["l"], label: "Losses", digits: 0, get: (t) => t.losses },
  { name: "adjo", aliases: ["ortg"], label: "Adj O", desc: "Adjusted offensive rating", digits: 1, get: (t) => t.adjO },
  { name: "adjd", aliases: ["drtg"], label: "Adj D", desc: "Adjusted defensive rating", digits: 1, get: (t) => t.adjD },
  { name: "net", aliases: ["adjnet"], label: "Net", desc: "Adjusted net rating", digits: 1, get: (t) => t.adjNet },
  { name: "tempo", aliases: ["pace", "adjt"], label: "Tempo", desc: "Adjusted tempo", digits: 1, get: (t) => t.tempo },
  { name: "efg", label: "eFG%", desc: "Effective field goal %", pct: true, digits: 1, get: (t) => t.efg },
  { name: "oppefg", aliases: ["efgd", "defefg"], label: "Opp eFG%", desc: "Opponent effective field goal %", pct: true, digits: 1, get: (t) => t.efgDef },
  { name: "tov", aliases: ["tovr"], label: "TOV%", desc: "Turnover rate", pct: true, digits: 1, get: (t) => t.tov },
  { name: "oreb", aliases: ["orb", "orbr"], label: "OREB%", desc: "Offensive rebound rate", pct: true, digits: 1, get: (t) => t.orb },
  { name: "3p", aliases: ["fg3", "3pt"], label: "3P%", desc: "Three-point %", pct: true, digits: 1, get: (t) => t.fg3 },
  { name: "sos", label: "SOS", desc: "Strength of schedule", digits: 1, get: (t) => t.sos },
]);
const TEAM_SCOPES: Scope[] = ["team", "teams", "conf", "opponents"];
const NO_OPPONENTS: Set<string>[] = [];

/** Who each named team played in a season, read off the Team Game Log's file when a filter asks; null while it loads. */
function useOpponents(year: number, teams: string[]): Set<string>[] | null {
  const [found, setFound] = useState<{ key: string; sets: Set<string>[] } | null>(null);
  const key = `${year}|${teams.join("|")}`;
  useEffect(() => {
    if (teams.length === 0) return;
    let stale = false;
    loadOnce(`team-games|${year}`, () => loadTeamGameSeason(year)).then(
      (s) => {
        if (!stale) setFound({ key, sets: teams.map((team) => new Set(s.games.filter((g) => sameName(g.team, team)).map((g) => g.opp))) });
      },
      () => {
        if (!stale) setFound({ key, sets: teams.map(() => new Set()) });
      },
    );
    return () => {
      stale = true;
    };
    // `teams` is read through `key`, which changes exactly when it does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, key]);
  if (teams.length === 0) return NO_OPPONENTS;
  return found?.key === key ? found.sets : null;
}

export function TeamsView({ year, setYear, query, setQuery, focus, onLanded }: ViewProps) {
  const [state, retry] = useCorpus("teams", year, shapeTeams);
  const setStatus = useSetStatus();
  useTabTitle(query.trim() ? `Teams: ${query.trim()}` : null);
  const { namesIn, select, clear } = useSelection();
  const picked = namesIn(year);
  const [onlyPicked, setOnlyPicked] = useState(false);
  const { nameIn: echoIn, publish } = useEcho();

  const season = state.status === "ready" ? state.value : null;
  const parsed = useMemo(() => parseFilter(query), [query]);
  const opponentsOf = parsed.scopes.filter((s) => s.scope === "opponents").map((s) => s.value);
  const opponents = useOpponents(year, opponentsOf);
  // A Ctrl K result for a team in this season, and its row if the season has one.
  const target = focus?.kind === "team" && focus.year === year ? focus : null;
  const landing = target && season ? season.teams.find((t) => t.name === target.name) : undefined;
  const rows = useMemo(() => {
    if (!season) return [];
    const base = onlyPicked && picked.size > 0 ? season.teams.filter((t) => picked.has(t.name)) : season.teams;
    if (!opponents) return [];
    let nth = 0;
    const scopes = parsed.scopes.map((s): ((t: Team) => boolean) => {
      const v = s.value;
      if (s.scope === "conf") return (t) => sameName(t.confLabel, v) || sameName(t.conf, v);
      if (s.scope === "team") return (t) => sameName(t.name, v);
      if (s.scope === "teams") {
        const names = new Set(scopedNames(v).map(normalizeText));
        return (t) => names.has(normalizeText(t.name));
      }
      if (s.scope === "opponents") {
        const played = opponents[nth++];
        return (t) => !!played?.has(t.name);
      }
      return () => false;
    });
    const stats = conditionTest(TEAM_STATS, parsed.conditions);
    return base.filter(
      (t) => matchesQuery(parsed.words, t.name, t.confLabel, t.conf) && scopes.every((f) => f(t)) && (!stats || stats(t)),
    );
  }, [season, parsed, opponents, onlyPicked, picked]);

  const help = useMemo(() => {
    if (!season) return undefined;
    const byRank = () => [...season.teams].sort(byBtaRank).map((t) => t.name);
    return filterHelp({
      noun: "teams",
      index: TEAM_STATS,
      rows: season.teams,
      scopes: TEAM_SCOPES,
      names: { team: byRank, teams: byRank, opponents: byRank, conf: () => sortedNames(season.teams.map((t) => t.confLabel)) },
    });
  }, [season]);

  useEffect(() => {
    if (state.status === "ready") setStatus(`${SOURCE_LABEL[state.source]} in ${state.ms} ms`);
    else if (state.status === "loading") setStatus("Loading…");
    else setStatus("Not loaded");
  }, [state, setStatus]);

  const selection = useMemo(
    () => ({
      isSelected: (t: Team) => picked.has(t.name),
      change: (list: Team[], mode: SelectMode) => select(year, list.map((t) => t.name), mode),
      clear,
      size: picked.size,
    }),
    [picked, select, clear, year],
  );
  const onFocusRow = useCallback((t: Team | undefined) => publish(year, t?.name ?? null), [publish, year]);
  const echoName = echoIn(year);
  const echoKey = echoName && season ? (season.teams.find((t) => t.name === echoName)?.id ?? null) : null;
  // Focus lights the focused team's row, or a focused player's team; a conference narrows the table instead.
  const focusName = focusTeam(useFocusSubject());
  const spotKey = focusName && season ? (season.teams.find((t) => t.name === focusName)?.id ?? null) : null;

  const total = season?.teams.length ?? 0;
  const meta = !season
    ? undefined
    : target && !landing
      ? `${target.name} has no row in ${seasonLabel(year)}`
      : !opponents
        ? "Finding opponents…"
        : opponentsOf.length === 1 && parsed.clauses.length === 1
          ? `${rows.length} opponents of ${opponentsOf[0]}`
        : `${rows.length !== total ? `${rows.length} of ${total}` : total} teams${picked.size > 0 ? ` · ${picked.size} selected` : ""} · Final`;

  const object = (t: Team): Obj => ({ kind: "team", name: t.name, logoId: t.logoId, year, conf: t.conf });
  // Alt-click or right-click a number: the games behind it.
  const statLens = useCallback(
    (t: Team, key: string) => {
      const col = COLUMNS.find((c) => c.key === key);
      const shown = SHOWN[key];
      return teamLens(key, { kind: "team", name: t.name, logoId: t.logoId, year }, col && shown ? { label: col.label, value: shown(t) } : undefined);
    },
    [year],
  );

  return (
    <>
      <ViewHeader
        kicker="Teams"
        title="Team Explorer"
        year={year}
        setYear={setYear}
        meta={meta}
        controls={
          picked.size > 0 ? (
            <button
              type="button"
              aria-pressed={onlyPicked}
              title="Show only the selected teams"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setOnlyPicked((v) => !v)}
              className={`inline-flex h-[26px] items-center gap-1.5 rounded-md border px-2 text-[12.5px] transition-colors ${
                onlyPicked
                  ? "border-[color-mix(in_oklab,var(--accent)_45%,var(--hairline))] bg-[var(--accent-wash)] text-ink"
                  : "border-hairline bg-card text-ink-soft hover:border-ink-muted hover:text-ink"
              }`}
            >
              <ListChecks size={13} strokeWidth={2} />
              Selected only
              <span className="text-ink-muted tabular">{picked.size}</span>
            </button>
          ) : undefined
        }
        filter={{ value: query, onChange: setQuery, placeholder: "Filter teams", help }}
      />
      <div className="relative min-h-0 flex-1 border-t border-hairline">
        {state.status === "ready" ? (
          <DataTable
            key={year}
            id="team-explorer"
            rows={rows}
            columns={COLUMNS}
            rowKey={teamKey}
            rowHeight={ROW_H}
            defaultSort={{ key: "rank", dir: 1 }}
            tieBreak={byBtaRank}
            ariaLabel="Teams"
            empty={
              onlyPicked && picked.size > 0 ? (
                <p className="px-5 py-10 text-[13px] text-ink-muted">None of the selected teams match the filter.</p>
              ) : (
                <NoMatches query={query} noun="team or conference" problem={filterProblem(parsed, TEAM_STATS, TEAM_SCOPES)} />
              )
            }
            peek={{ label: (t) => t.name, body: (t) => <TeamPeekBody season={state.value} team={t} /> }}
            landOn={landing && target ? { key: landing.id, nonce: target.nonce } : undefined}
            onLanded={onLanded}
            object={object}
            selection={selection}
            echo={echoKey}
            spotlight={spotKey}
            statLens={statLens}
            onFocusRow={onFocusRow}
          />
        ) : state.status === "loading" ? (
          <TableSkeleton rowHeight={ROW_H} label="Loading teams" />
        ) : (
          <LoadError year={year} reason={state.reason} message={state.message} what="Teams" onRetry={retry} />
        )}
      </div>
    </>
  );
}
