import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { confDisplay } from "@/lib/conf-display";
import type { GameLog } from "@/lib/game-filters";
import { SEASON_CEIL } from "@/lib/seasons";
import {
  CALC_STAT_KEYS,
  conditionBounds,
  labelFor,
  opponentNamesIn,
  rowsToFilters,
  runWinCalc,
  teamNamesIn,
} from "@/lib/win-calc";
import { compareDrag, useCompare } from "~/shell/compare";
import { useShell } from "~/shell/shell-context";
import { useSetStatus } from "~/shell/status";
import { useTabTitle } from "~/shell/tab-title";
import { LoadError, NoMatches, TableSkeleton, ViewHeader } from "~/shell/view-parts";
import type { ViewProps } from "~/shell/views";
import { DataTable } from "~/table/data-table";
import { TeamLogo } from "~/ui/logo";
import type { ListItem } from "~/ui/search-list";
import { normalizeText } from "~/ui/text";
import { AskBar } from "./ask-bar";
import { calcColumns, ROW_H } from "./calc-columns";
import { coachLookup, crestOf, useCalcSeasons } from "./calc-model";
import { CalcPeekBody } from "./calc-peek";
import { columnsOf, isAsking, parseCalc, scopeOf, serializeCalc, type CalcState } from "./calc-state";
import { CalcSummary } from "./calc-summary";
import { FilterBar } from "./filter-bar";

/**
 * The Win Calculator: when this happened, how often did the team win?
 *
 * THE SITE'S CALCULATOR, answered live. Every rule that decides the answer is
 * the site's (src/lib/win-calc.ts): which games a season holds, how a condition
 * filters, how a question in plain English lands. What the app changes is the
 * shape of the work. The question is a row of chips that edit in place, the
 * answer follows every change without a Calculate button, and the matching
 * games are the app's own table: sortable, Peekable, openable, every
 * condition a column over its percentile.
 *
 * THE QUESTION LIVES IN THE TAB (./calc-state.ts), so it can be starred,
 * duplicated, split beside another, and gone back to.
 *
 * TYPING STAYS AHEAD OF THE ARITHMETIC. The answer is worked out from a
 * deferred copy of the question, so a value box never waits on a pass over a
 * hundred and fifty thousand games.
 */

const ALL_KEYS = [...CALC_STAT_KEYS];
const NO_BOUNDS = new Map<string, [number, number]>();
const rowKey = (g: GameLog) => `${g.year}:${g.game_id}`;
const latestFirst = (a: GameLog, b: GameLog) =>
  (b.game_date ?? "").localeCompare(a.game_date ?? "") || a.game_id.localeCompare(b.game_id);

/** What the filter box searches: both teams, the conference and the coach, folded once per game. */
const hay = new WeakMap<GameLog, string>();
function hayOf(g: GameLog): string {
  let h = hay.get(g);
  if (h === undefined) {
    const coach = coachLookup().coachByTeamYear[g.team_name]?.[g.year] ?? "";
    h = normalizeText(
      `${g.team_name} ${g.opp_team_market ?? ""} ${g.team_conference ? confDisplay(g.team_conference) : ""} ${coach}`,
    );
    hay.set(g, h);
  }
  return h;
}

let coachItems: ListItem[] | null = null;
/** Every coach, each with the school they were last at, which is how most people place a name. */
function coachList(): ListItem[] {
  if (!coachItems) {
    const { coachByTeamYear, allCoaches } = coachLookup();
    const latest = new Map<string, { team: string; year: number }>();
    for (const [team, byYear] of Object.entries(coachByTeamYear)) {
      for (const [y, name] of Object.entries(byYear)) {
        const year = Number(y);
        const cur = latest.get(name);
        if (!cur || year > cur.year) latest.set(name, { team, year });
      }
    }
    coachItems = allCoaches.map((c) => ({ key: c, label: c, meta: latest.get(c)?.team, keywords: latest.get(c)?.team }));
  }
  return coachItems;
}

export function WinCalcView({ query, setQuery }: ViewProps) {
  const state = useMemo(() => parseCalc(query), [query]);
  const latest = useRef(state);
  useLayoutEffect(() => {
    latest.current = state;
  }, [state]);
  /** Every change goes through the tab's query, from the newest state even between renders. */
  const update = useCallback(
    (fn: (s: CalcState) => CalcState) => {
      const next = fn(latest.current);
      latest.current = next;
      setQuery(serializeCalc(next));
    },
    [setQuery],
  );

  const seasons = useCalcSeasons(state.years);
  const { coachByTeamYear } = coachLookup();
  const asked = useDeferredValue(state);
  const filters = useMemo(() => rowsToFilters(asked.rows), [asked.rows]);
  const result = useMemo(
    () => (seasons.complete ? runWinCalc(seasons.games, { ...scopeOf(asked), filters }, coachByTeamYear) : null),
    [seasons.complete, seasons.games, asked, filters, coachByTeamYear],
  );
  const asking = isAsking(asked);
  // Worked out once the seasons are all in, not again for each one that lands.
  const bounds = useMemo(
    () => (seasons.complete ? conditionBounds(seasons.games, ALL_KEYS) : NO_BOUNDS),
    [seasons.complete, seasons.games],
  );

  const [text, setText] = useState("");
  const [picked, setPicked] = useState<number | null>(null);
  const pickedYear = picked != null && state.years.includes(picked) ? picked : null;

  const rows = useMemo(() => {
    if (!result) return [];
    const words = normalizeText(text).split(" ").filter(Boolean);
    if (pickedYear == null && words.length === 0) return result.matching;
    return result.matching.filter(
      (g) => (pickedYear == null || g.year === pickedYear) && words.every((w) => hayOf(g).includes(w)),
    );
  }, [result, text, pickedYear]);

  const colsKey = columnsOf(state).join(",");
  const showConf = state.conferences.length > 0;
  const showCoach = state.coaches.length > 0;
  const columns = useMemo(
    () => calcColumns(colsKey ? colsKey.split(",") : [], { conf: showConf, coach: showCoach }),
    [colsKey, showConf, showCoach],
  );

  // The pickers' lists, from the seasons in play.
  const confsKey = state.conferences.join("|");
  const teamsKey = state.teams.join("|");
  const oppsKey = state.opponents.join("|");
  const confOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of seasons.games) if (g.team_conference && !m.has(g.team_name)) m.set(g.team_name, g.team_conference);
    return m;
  }, [seasons.games]);
  const teamItems = useMemo<ListItem[]>(() => {
    const chosen = teamsKey ? teamsKey.split("|") : [];
    const names = [...new Set([...chosen, ...teamNamesIn(seasons.games, confsKey ? confsKey.split("|") : [])])];
    return names.map((t) => {
      const c = confOf.get(t);
      return { key: t, label: t, leading: <TeamLogo id={crestOf(t)} name={t} size={16} />, meta: c ? confDisplay(c) : undefined, keywords: c };
    });
  }, [seasons.games, confsKey, teamsKey, confOf]);
  const opponentItems = useMemo<ListItem[]>(() => {
    const chosen = oppsKey ? oppsKey.split("|") : [];
    return [...new Set([...chosen, ...opponentNamesIn(seasons.games)])].map((t) => ({
      key: t,
      label: t,
      leading: <TeamLogo id={crestOf(t)} name={t} size={16} />,
    }));
  }, [seasons.games, oppsKey]);

  const setStatus = useSetStatus();
  useEffect(() => {
    if (seasons.error) setStatus("Not loaded");
    else if (!seasons.complete) setStatus(`Loading game logs · ${seasons.ready} of ${seasons.total}`);
    else
      setStatus(
        `${seasons.games.length.toLocaleString()} team-games in ${seasons.total} ${seasons.total === 1 ? "season" : "seasons"}`,
      );
  }, [seasons.error, seasons.complete, seasons.ready, seasons.total, seasons.games.length, setStatus]);

  // The tab is named by the question: "Duke · 3P% ≥ 40%".
  const title = useMemo(() => {
    const subject =
      state.teams.length === 1
        ? state.teams[0]
        : state.coaches.length === 1
          ? state.coaches[0]
          : state.conferences.length === 1
            ? confDisplay(state.conferences[0]!)
            : state.opponents.length === 1
              ? `vs ${state.opponents[0]}`
              : null;
    const first = rowsToFilters(state.rows)[0];
    const parts = [subject, first ? labelFor(first) : null].filter(Boolean);
    return parts.length ? parts.join(" · ") : null;
  }, [state]);
  useTabTitle(title);

  const { openRecord } = useShell();
  const { add } = useCompare();

  const meta = result
    ? rows.length !== result.total
      ? `${rows.length.toLocaleString()} of ${result.total.toLocaleString()} games`
      : `${result.total.toLocaleString()} games`
    : undefined;

  return (
    <>
      <ViewHeader
        kicker="Tools"
        title="Win Calculator"
        year={SEASON_CEIL}
        season={false}
        meta={meta}
        filter={{ value: text, onChange: setText, placeholder: "Filter games" }}
      />
      <AskBar update={update} seasons={seasons} />
      <FilterBar
        state={state}
        update={update}
        bounds={bounds}
        teams={teamItems}
        opponents={opponentItems}
        coaches={coachList()}
      />

      <div className="flex min-h-0 flex-1 flex-col border-t border-hairline">
        <CalcSummary
          state={state}
          result={result}
          seasons={seasons}
          asking={asking}
          picked={pickedYear}
          onPick={setPicked}
          onStarter={update}
        />
        <div className="relative min-h-0 flex-1 border-t border-hairline">
          {seasons.error ? (
            <LoadError
              year={state.years[0] ?? SEASON_CEIL}
              reason={seasons.error.includes("season-gated") ? "gated" : "failed"}
              message={seasons.error}
              what="Game logs"
              onRetry={seasons.retry}
            />
          ) : result ? (
            <DataTable
              key={colsKey}
              rows={rows}
              columns={columns}
              rowKey={rowKey}
              rowHeight={ROW_H}
              defaultSort={{ key: "date", dir: -1 }}
              tieBreak={latestFirst}
              drag={(g) => compareDrag({ kind: "team", name: g.team_name, logoId: crestOf(g.team_name), year: g.year })}
              keys={{ c: (g) => add({ kind: "team", name: g.team_name, logoId: crestOf(g.team_name), year: g.year }) }}
              onOpen={(g, how) =>
                openRecord(
                  { kind: "team", name: g.team_name, logoId: crestOf(g.team_name) },
                  { newTab: how.newTab, side: how.side, year: g.year },
                )
              }
              ariaLabel="Matching games"
              empty={
                text.trim() ? (
                  <NoMatches query={text} noun="team, opponent, conference or coach" />
                ) : (
                  <p className="px-5 py-10 text-[13px] text-ink-muted">
                    {result.total === 0 ? "No game matches every filter." : "No matching game in that season."}
                  </p>
                )
              }
              peek={{
                label: (g) => `${g.team_name} ${g.is_home || g.is_neutral ? "vs" : "at"} ${g.opp_team_market ?? ""}`,
                body: (g) => <CalcPeekBody game={g} filters={filters} />,
              }}
            />
          ) : (
            <TableSkeleton rowHeight={ROW_H} label="Loading game logs" />
          )}
        </div>
      </div>
    </>
  );
}
