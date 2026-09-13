/**
 * The Team Stats panel's cards: the split payload's shape, how a value prints,
 * and which groups each view shows.
 *
 * MOVED HERE VERBATIM from src/components/teams/team-stats-panel.tsx, so the
 * desktop app reads the panel the way the site does. The site's panel imports
 * them from here.
 */

export type TeamSplitStat = { key: string; group: string; label: string; fmt: "num1" | "num2" | "pct1" | "x2"; neutral?: boolean };
export type TeamSplitRow = { games: number; v: (number | null)[]; p: (number | null)[] };
export type TeamSplits = {
  season: number;
  splits: { key: string; label: string }[];
  stats: TeamSplitStat[];
  groups: Record<string, string>;
  /** split key -> that split's row for THIS team. */
  rows: Record<string, TeamSplitRow>;
};

export function fmtValue(v: number | null, fmt: TeamSplitStat["fmt"]): string {
  if (v === null || v === undefined) return "—";
  switch (fmt) {
    case "pct1": return v.toFixed(1) + "%";
    case "num2": return v.toFixed(2);
    case "x2":   return v.toFixed(2) + "x";
    default:     return v.toFixed(1);
  }
}

/**
 * Which stat groups each view shows, by the group KEY the data uses.
 *
 * THE CARDS COME FROM THE DATA, not from a list in this file — every group in
 * team-splits is rendered, in the order it appears there. So a view is a
 * filter over group keys rather than a second definition of the panels, and
 * adding a stat to an existing group needs no change here.
 *
 * EVERYTHING IS THE DEFAULT, and there is no Overview. An Overview view is
 * worth having when the full set is too much to land on; nine cards on a
 * three-column grid is three tidy rows, so the shortened version was hiding
 * two thirds of the panel to save a scroll nobody minded. The narrower views
 * stay for when a reader has a side of the ball in mind.
 *
 * THE OTHER TWO ARE GROUPED BY THE QUESTION, matching the player overview.
 * Someone reading a team wants to know how they score or how they defend —
 * "Adv Offense" and "Box Score" describe where a number came from, which is
 * this site's problem rather than the reader's.
 *
 * CORE RIDES IN BOTH, for the same reason Role does on the player page: net
 * rating, tempo and the four factors are the context every other number is
 * read against, and nobody should switch views to find out a team plays at 62
 * possessions. Box Score appears in both because rebounds, steals and blocks
 * are as much a defensive answer as an offensive one.
 *
 * A GROUP IN THE DATA AND IN NEITHER VIEW would show only under Everything.
 * That is the safe direction — it stays reachable, and it is now what the
 * reader sees first — but if a group is added upstream it belongs in a view
 * here too.
 */
export type TeamStatsView = "everything" | "offense" | "defense";

export const TEAM_VIEWS: Array<{ key: TeamStatsView; label: string; groups: string[] | null }> = [
  // null is not a group list — it is the absence of one. Filtering Everything
  // would mean a list that has to be updated every time a group is added.
  { key: "everything", label: "Everything", groups: null },
  { key: "offense", label: "Scoring & shooting", groups: ["Core", "Shooting", "Misc", "AdvOff"] },
  { key: "defense", label: "Defense & rebounding", groups: ["Core", "OppShoot", "Allowed", "AdvDef", "Box"] },
];
