import { useEffect, useMemo } from "react";
import type { StaticTeamSeasonRow } from "@/lib/static-data";
import { shapeSeason, type Season, type Team } from "~/data/team-model";
import { SOURCE_LABEL, useCorpus } from "~/data/use-corpus";
import { useSetStatus } from "~/shell/status";
import { LoadError, NoMatches, TableSkeleton, ViewHeader } from "~/shell/view-parts";
import type { ViewProps } from "~/shell/views";
import { DataTable, type Column } from "~/table/data-table";
import { StatCell } from "~/table/stat-cell";
import { num1, pct1, seasonLabel, signed1 } from "~/ui/format";
import { TeamLogo } from "~/ui/logo";
import { matchesQuery } from "~/ui/text";
import { TeamPeekBody } from "./team-peek";

/**
 * Team Explorer: every team in a season, with the site's percentile chip on
 * every stat and a Peek on every row.
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
  {
    key: "zone", label: "Zone", title: "Inside the contender trapezoid", width: 60, align: "center", first: -1,
    sortValue: (t) => (t.inZone == null ? null : t.inZone ? 1 : 0),
    cell: (t) =>
      t.inZone == null ? null : t.inZone ? (
        <span role="img" aria-label="Inside the trapezoid" className="inline-block h-[7px] w-[7px] rounded-full bg-good" />
      ) : (
        <span role="img" aria-label="Outside the trapezoid" className="inline-block h-[5px] w-[5px] rounded-full bg-hairline" />
      ),
  },
];

export function TeamsView({ year, setYear, query, focus, onLanded }: ViewProps) {
  const [state, retry] = useCorpus("teams", year, shapeTeams);
  const setStatus = useSetStatus();

  const season = state.status === "ready" ? state.value : null;
  // A Ctrl K result for a team in this season, and its row if the season has one.
  const target = focus?.kind === "team" && focus.year === year ? focus : null;
  const landing = target && season ? season.teams.find((t) => t.name === target.name) : undefined;
  const rows = useMemo(
    () => (season ? season.teams.filter((t) => matchesQuery(query, t.name, t.confLabel, t.conf)) : []),
    [season, query],
  );

  useEffect(() => {
    if (state.status === "ready") setStatus(`${SOURCE_LABEL[state.source]} in ${state.ms} ms`);
    else if (state.status === "loading") setStatus("Loading…");
    else setStatus("Not loaded");
  }, [state, setStatus]);

  const total = season?.teams.length ?? 0;
  const meta = !season
    ? undefined
    : target && !landing
      ? `${target.name} has no row in ${seasonLabel(year)}`
      : `${query.trim() && rows.length !== total ? `${rows.length} of ${total}` : total} teams · Final`;

  return (
    <>
      <ViewHeader kicker="Teams" title="Team Explorer" year={year} setYear={setYear} meta={meta} />
      <div className="relative min-h-0 flex-1 border-t border-hairline">
        {state.status === "ready" ? (
          <DataTable
            key={year}
            rows={rows}
            columns={COLUMNS}
            rowKey={teamKey}
            rowHeight={ROW_H}
            defaultSort={{ key: "rank", dir: 1 }}
            tieBreak={byBtaRank}
            ariaLabel="Teams"
            empty={<NoMatches query={query} noun="team or conference" />}
            peek={{ label: (t) => t.name, body: (t) => <TeamPeekBody season={state.value} team={t} /> }}
            landOn={landing && target ? { key: landing.id, nonce: target.nonce } : undefined}
            onLanded={onLanded}
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
