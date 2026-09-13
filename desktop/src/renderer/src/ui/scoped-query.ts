import { normalizeText } from "./text";

/**
 * A filter that names one thing exactly: "team: Michigan", "conf: Big Ten",
 * "opponents: Michigan", "player: Cooper Flagg", "teams: Duke, Houston, Auburn".
 *
 * WRITTEN IN THE FILTER BOX, IN WORDS. An action like "Michigan's game log"
 * lands in a table with this in its filter, where the reader can see why the
 * rows are the rows, change the name, or press Esc to see everything. It is a
 * tab's query like any other, so history and favorites keep it.
 *
 * EXACT, because plain words are not: "michigan" also finds Michigan St. and
 * every team that played Michigan.
 */

export type Scope = "team" | "teams" | "player" | "conf" | "opponents";
export type Scoped = { scope: Scope; value: string };

const SCOPED = /^\s*(teams|team|player|conf|opponents)\s*:\s*(.+?)\s*$/i;

export function parseScoped(query: string): Scoped | null {
  const m = SCOPED.exec(query);
  return m ? { scope: m[1]!.toLowerCase() as Scope, value: m[2]! } : null;
}

export const scopedQuery = (scope: Scope, value: string): string => `${scope}: ${value}`;

/** The names in a "teams:" filter: comma separated, as a selection writes them. */
export const scopedNames = (value: string): string[] => value.split(",").map((s) => s.trim()).filter(Boolean);

/** The same name, however it was capitalized or accented. */
export const sameName = (a: string | null | undefined, b: string): boolean => a != null && normalizeText(a) === normalizeText(b);
