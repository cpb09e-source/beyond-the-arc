import { CalendarDays, Calculator, ChartScatter, ClipboardCopy, FileDown, GitCompareArrows, Scale, Table2, X, type LucideIcon } from "lucide-react";
import { recordStep } from "~/shell/research-history";
import { csvField } from "~/table/table-export";
import { differenceQuery } from "~/explain/explain-query";
import type { StaticTeamSeasonRow } from "@/lib/static-data";
import { overrideTeam } from "@/lib/win-calc";
import { shapeSeason, type Season } from "~/data/team-model";
import { loadOnce } from "~/data/use-corpus";
import type { ActionEnv, How } from "~/objects/actions";
import type { PaletteItem } from "~/palette/command-palette";
import { COMPARE_MAX, compareRefsQuery } from "~/shell/compare";
import { Kbd } from "~/ui/kbd";
import { seasonLabel } from "~/ui/format";
import type { MenuEntry } from "~/ui/menu";
import { scopedQuery } from "~/ui/scoped-query";
import { DEFAULT_CALC, serializeCalc } from "~/views/win-calc/calc-state";
import type { TeamSelection } from "./selection";

/**
 * What can be done with several teams at once: the selection's half of the
 * registry (~/objects/actions.tsx has the one-object half).
 *
 * ONE LIST, THREE SURFACES. The floating selection bar, Ctrl K and the submenu a
 * right-click on a picked team opens all read SELECTION_ACTIONS, as every
 * single-object surface reads ACTIONS.
 */

export type SelectionAction = {
  id: string;
  icon: LucideIcon;
  /** On the selection bar, where room is short. */
  short: string;
  /** In a menu about the selection. */
  label: string;
  /** In Ctrl K, where nothing else names the selection. */
  phrase: (s: TeamSelection) => string;
  hint?: string;
  keywords?: string[];
  /** Hidden where it would only lead back to the view in front. */
  when: (s: TeamSelection, env: ActionEnv) => boolean;
  /** Why it cannot run on this selection; null when it can. */
  blocked?: (s: TeamSelection) => string | null;
  run: (s: TeamSelection, env: ActionEnv, how: How, clear: () => void) => void;
};

const teams = (n: number) => `${n} ${n === 1 ? "team" : "teams"}`;

/** The selection as a tab's filter: `teams: Michigan, Duke, Houston`. */
export const selectionQuery = (s: TeamSelection): string => scopedQuery("teams", s.names.join(", "));

export const SELECTION_ACTIONS: SelectionAction[] = [
  {
    id: "compare",
    icon: GitCompareArrows,
    short: "Compare",
    label: "Compare",
    phrase: (s) => `Compare the ${teams(s.names.length)} selected`,
    keywords: ["compare", "side by side", "versus"],
    when: () => true,
    blocked: (s) =>
      s.names.length < 2 ? "Select at least two teams to compare" : s.names.length > COMPARE_MAX ? `Compare holds ${COMPARE_MAX} teams at a time` : null,
    run: (s, env, how) => env.openView("compare", { ...how, query: compareRefsQuery("team", s.names.map((id) => ({ year: s.year, id }))) }),
  },
  {
    id: "difference",
    icon: Scale,
    short: "Explain",
    label: "Explain the difference",
    phrase: (s) => `Explain why ${s.names.join(" and ")} differ`,
    keywords: ["difference", "explain", "why", "versus", "vs", "gap"],
    // Only with a pair: the bar is short on room, and a disabled button for every other count says nothing useful.
    when: (s) => s.names.length === 2,
    run: (s, env, how) =>
      env.openView("difference", { ...how, query: differenceQuery({ year: s.year, name: s.names[0]! }, { year: s.year, name: s.names[1]! }) }),
  },
  {
    id: "explorer",
    icon: Table2,
    short: "Explorer",
    label: "Show in Team Explorer",
    phrase: (s) => `Show the ${teams(s.names.length)} selected in the Team Explorer`,
    keywords: ["explorer", "table", "filter"],
    when: (s, env) => !(env.here.viewId === "team-explorer" && env.here.query === selectionQuery(s)),
    run: (s, env, how) => env.openView("team-explorer", { ...how, year: s.year, query: selectionQuery(s) }),
  },
  {
    id: "scatter",
    icon: ChartScatter,
    short: "Scatter",
    label: "Plot on Team Scatter",
    phrase: (s) => `Plot the ${teams(s.names.length)} selected on Team Scatter`,
    keywords: ["scatter", "chart", "plot"],
    when: (_s, env) => env.here.viewId !== "team-scatter",
    run: (s, env, how) => env.openView("team-scatter", { ...how, year: s.year, query: "field=selected" }),
  },
  {
    id: "game-log",
    icon: CalendarDays,
    short: "Game logs",
    label: "Game logs",
    phrase: (s) => `Every game the ${teams(s.names.length)} selected played, in the Team Game Log`,
    keywords: ["games", "log", "schedule"],
    when: () => true,
    run: (s, env, how) => env.openView("team-game-log", { ...how, year: s.year, query: selectionQuery(s) }),
  },
  {
    id: "win-calc",
    icon: Calculator,
    short: "Win Calculator",
    label: "Win Calculator",
    phrase: (s) => `The ${teams(s.names.length)} selected, in the Win Calculator`,
    keywords: ["win calculator", "how often"],
    when: () => true,
    run: (s, env, how) =>
      env.openView("win-calc", { ...how, query: serializeCalc({ ...DEFAULT_CALC, teams: s.names.map((n) => overrideTeam(n)), years: [s.year] }) }),
  },
  {
    id: "copy",
    icon: ClipboardCopy,
    short: "Copy",
    label: "Copy as a table",
    phrase: (s) => `Copy the ${teams(s.names.length)} selected as a table`,
    keywords: ["copy", "spreadsheet", "table", "clipboard"],
    when: () => true,
    run: (s, env) => {
      void selectionGrid(s).then(
        (grid) => env.copyText(grid.map((r) => r.join("\t")).join("\n"), `Copied ${teams(s.names.length)}, ready to paste into a spreadsheet`),
        () => env.toast({ title: "The table could not be copied", body: `${seasonLabel(s.year)} did not load.` }),
      );
    },
  },
  {
    id: "save-csv",
    icon: FileDown,
    short: "CSV",
    label: "Save as CSV",
    phrase: (s) => `Save the ${teams(s.names.length)} selected as a CSV file`,
    keywords: ["save", "export", "csv", "file", "spreadsheet", "excel", "download"],
    when: () => true,
    run: (s, env) => {
      void selectionGrid(s).then(
        (grid) => env.saveCsv(grid.map((r) => r.map(csvField).join(",")).join("\r\n"), `Selected teams ${seasonLabel(s.year)}`, s.names.length),
        () => env.toast({ title: "The file could not be saved", body: `${seasonLabel(s.year)} did not load.` }),
      );
    },
  },
  {
    id: "clear",
    icon: X,
    short: "Clear",
    label: "Clear the selection",
    phrase: () => "Clear the selection",
    hint: "Esc",
    keywords: ["deselect", "clear", "none"],
    when: () => true,
    run: (_s, _env, _how, clear) => clear(),
  },
];

// Research history (~/shell/research-history.ts): each selection action is a step, with the teams it ran on.
for (const a of SELECTION_ACTIONS) {
  if (a.id === "clear") continue;
  const run = a.run;
  a.run = (s, env, how, clear) => {
    recordStep({ kind: "selection", title: a.phrase(s), selection: { year: s.year, names: [...s.names] }, action: a.id });
    run(s, env, how, clear);
  };
}

/** The picked teams' numbers, one row each in BTA rank order, as cells for a spreadsheet. */
async function selectionGrid(s: TeamSelection): Promise<string[][]> {
  const season = await loadOnce<Season>(`teams|${s.year}`, async () => {
    const { json, source } = await window.bta.data("teams", s.year);
    return { value: shapeSeason(s.year, JSON.parse(json) as StaticTeamSeasonRow[]), source };
  });
  const picked = new Set(s.names);
  const rows = season.teams.filter((t) => picked.has(t.name)).sort((a, b) => (a.btaRank ?? 1e9) - (b.btaRank ?? 1e9));
  const one = (v: number | null) => (v == null ? "" : v.toFixed(1));
  return [
    ["Team", "Conference", "W", "L", "BTA rank", "Adj O", "Adj D", "Net", "Tempo", "eFG%", "SOS"],
    ...rows.map((t) =>
      [t.name, t.confLabel, t.wins, t.losses, t.btaRank ?? "", one(t.adjO), one(t.adjD), one(t.adjNet), one(t.tempo), t.efg == null ? "" : (t.efg * 100).toFixed(1), one(t.sos)].map(String),
    ),
  ];
}

/** "Michigan, Duke, Houston" or "Michigan, Duke, Houston and 9 more". */
export const selectionPreview = (s: TeamSelection): string =>
  s.names.length <= 3 ? s.names.join(", ") : `${s.names.slice(0, 3).join(", ")} and ${s.names.length - 3} more`;

export function selectionMenuEntries(s: TeamSelection, env: ActionEnv, clear: () => void): MenuEntry[] {
  return SELECTION_ACTIONS.filter((a) => a.when(s, env)).map((a) => {
    const Icon = a.icon;
    return {
      kind: "item",
      id: `selection:${a.id}`,
      label: a.label,
      icon: <Icon size={14} strokeWidth={2} />,
      hint: a.hint ? <Kbd>{a.hint}</Kbd> : undefined,
      disabled: !!a.blocked?.(s),
      onSelect: () => a.run(s, env, { newTab: false }, clear),
    };
  });
}

/** The selection's actions as Ctrl K rows, above the page's own: with twelve teams picked, "compare" means them. */
export function selectionPaletteItems(s: TeamSelection, env: ActionEnv, clear: () => void): PaletteItem[] {
  return SELECTION_ACTIONS.filter((a) => a.when(s, env) && !a.blocked?.(s)).map((a) => {
    const Icon = a.icon;
    return {
      id: `selection:${a.id}`,
      group: "selection",
      title: a.phrase(s),
      subtitle: `${seasonLabel(s.year)} · ${selectionPreview(s)}`,
      keywords: [...(a.keywords ?? []), "selection", "selected"],
      weight: 360,
      leading: <Icon size={15} strokeWidth={2} />,
      trailing: a.hint ? <Kbd>{a.hint}</Kbd> : undefined,
      run: (how) => a.run(s, env, how, clear),
    };
  });
}
