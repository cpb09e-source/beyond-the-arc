import { EXPORT_ORIGIN, exportSeasonLabel, type ExportMeta } from "@/lib/table-export";
import { describeConditions, parseFilter, scopeValues, type StatIndex } from "~/ui/filter-query";

/**
 * A table's About sheet, read off the tab: its season, the names and
 * conditions in the filter box, the words left over, and the sort.
 *
 * The site writes the same sheet from its URL; the app writes it from the words
 * that stand in for one, so a workbook saved here says what it holds as plainly.
 */
export function exportMeta<R>({
  viewLabel,
  year,
  query,
  index,
  sort,
  path,
}: {
  viewLabel: string;
  year: number;
  query: string;
  index: StatIndex<R>;
  /** "Net, high to low". */
  sort: string;
  /** The site page this table is, for the Source line: "/players". */
  path: string;
}): ExportMeta {
  const parsed = parseFilter(query);
  const conf = scopeValues(query, ["conf"]);
  const teams = scopeValues(query, ["team", "teams"]);
  const others = parsed.scopes.filter((s) => s.scope !== "conf" && s.scope !== "team" && s.scope !== "teams").map((s) => `${s.scope}: ${s.value}`);
  return {
    viewLabel,
    seasons: exportSeasonLabel(year),
    conference: conf.length > 0 ? conf.join(", ") : "All conferences",
    teams: teams.length > 0 ? teams.join(", ") : "All teams",
    filters: [...others, ...describeConditions(parsed.conditions, index)],
    sort,
    search: parsed.words.trim(),
    url: `${EXPORT_ORIGIN}${path}`,
  };
}

/** "Net, high to low": the sort as the About sheet names it. */
export const sortText = (label: string | undefined, dir: 1 | -1): string =>
  label ? `${label}, ${dir === -1 ? "high to low" : "low to high"}` : "The view's own order";
