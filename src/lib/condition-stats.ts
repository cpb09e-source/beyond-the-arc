import type { StatOption } from "@/lib/game-filters";

/**
 * How a game-log stat reads as a condition: whether it is a yes/no flag, whether
 * it is a rate shown as a percentage, what it is called, and which section of a
 * picker it sits in.
 *
 * Out of src/components/filters/condition-sheet.tsx, which still re-exports all
 * of it, so the desktop app's Win Calculator can read the same rules without
 * importing a component.
 */

/** 0/1 flags — rendered as a Yes/No toggle, not a slider + comparator. */
export const FLAG_KEYS = new Set(["conf_game", "tourney", "postseason"]);

/** Rate-shaped keys (0–1 decimals shown as %). `_pct` also catches efg_pct_def. */
export function isPctKey(key: string): boolean {
  return key.includes("_pct") || key.startsWith("ff_");
}

/**
 * The sheet's own grouping — a display concern, deliberately NOT the shared
 * `group` strings in game-filters/game-box (those still feed the team/coach
 * "Find a game" modal). The rate-stat groups are dissolved into the
 * sections each stat actually belongs to, and offensive shooting lives under
 * Scoring; the defensive rates get a section of their own.
 */
const GROUP_ORDER = [
  "Context", "Scoring", "Differentials", "Defense",
  "Efficiency", "Box", "Game Shape", "Pace", "Opponent",
] as const;

function displayGroup(o: StatOption): string {
  const byKey: Record<string, string> = {
    ff_efg: "Scoring", ff_ftr: "Scoring",
    ff_tov: "Efficiency", ff_orb: "Efficiency",
    ff_efg_def: "Defense", ff_ftr_def: "Defense", ff_tov_def: "Defense", ff_orb_def: "Defense",
  };
  const key = o.key as string;
  if (byKey[key]) return byKey[key];
  if (o.group === "Shooting (off)") return "Scoring";
  if (o.group === "Shooting (def)") return "Defense";
  return o.group;
}

/**
 * Group a caller's stat list for display. Derived from the options passed in
 * rather than a module constant, because /calc runs on CALC_STAT_OPTIONS while
 * the team / coach "Find a game" modal runs on the smaller STAT_OPTIONS.
 */
export function conditionGroups(options: StatOption[]): Array<[string, StatOption[]]> {
  const seen = new Map<string, StatOption[]>();
  for (const o of options) {
    const g = displayGroup(o);
    const arr = seen.get(g);
    if (arr) arr.push(o);
    else seen.set(g, [o]);
  }
  return GROUP_ORDER.filter((g) => seen.has(g)).map((g) => [g, seen.get(g)!] as [string, StatOption[]]);
}

/** Strip the "(1=yes)" hack from flag labels — the toggle says it better. */
export function cleanLabel(label: string): string {
  return label.replace(/\s*\(1=yes\)/, "");
}
