/**
 * Table views for the team explorer — named column sets the reader switches
 * between, in place of building one column at a time.
 *
 * WHY THIS EXISTS. The picker can add any of ~120 stats as a column, one at a
 * time, which is the right tool when you know exactly what you want and a
 * miserable one when you want "the shooting numbers". A view answers the second
 * question in a single click: a curated, ordered set with its own band headers
 * and its own default sort.
 *
 * A VIEW REPLACES THE DEFAULT COLUMNS, NOT THE PINNED ONES. Anything the reader
 * added through Add a Filter stays put and stays leftmost — those are their
 * columns, and a view switch is a change of backdrop, not a reset. That also
 * means a view can never take away a column somebody is filtering on, which
 * would leave them looking at a filtered table with no way to see why a row
 * qualified.
 *
 * SWITCHING IS INSTANT, no Submit. Every view reads from the same cached,
 * fully-shaped cohort that the filters already run against — measured at 5.4ms
 * over the widest selection — so there is nothing to fetch and nothing to
 * recompute. Submit exists for filters because a half-typed value is not a
 * query; a view is complete the moment it is chosen.
 *
 * BANDS ARE PART OF THE VIEW. The three headers over the default table
 * (Ratings / Four Factors / Shooting) used to be hardcoded lengths in the
 * component. They are declared per view here instead, so a view with five
 * groups or one group renders correctly without the table knowing anything
 * about which view it is showing.
 *
 * Every key below is a TEAM_STAT_COLUMNS key. There is a test of that at the
 * bottom of this file — a typo would otherwise render an empty column rather
 * than fail.
 */
import { TEAM_STAT_COLUMNS, type TeamStatKey } from "@/lib/team-filters";
import { VIEW_ACCESS } from "@/lib/access";

export type ViewBand = {
  label: string;
  /** Rendered in the accent, for the band a view is really "about". */
  accent?: boolean;
  keys: TeamStatKey[];
};

export type TableView = {
  key: string;
  label: string;
  /** Section heading in the picker. */
  group: string;
  /** One-line explanation, shown as the option's title. */
  desc: string;
  bands: ViewBand[];
  /** Column this view sorts by when chosen. */
  sortBy: TeamStatKey;
  sortDir: "asc" | "desc";
  /**
   * An EMPTY view the reader fills in themselves. Excluded from the all-views
   * workbook, where a tab of nothing but team names would be a blank sheet
   * among twelve real ones — and where the reader's own columns already lead
   * every other tab.
   */
  custom?: boolean;
  /**
   * Sort to use when the PREVIEW season is selected, if `sortBy` is a stat that
   * cannot exist before games are played.
   *
   * Roster Continuity sorts by Continuity %, which needs this season's minute
   * shares — so on the upcoming season every value is null and the table lands
   * in whatever order the rows happened to be built in. Returning Minutes % is
   * the figure that does exist, so that is what it sorts by there.
   */
  previewSortBy?: TeamStatKey;
};

const k = (...keys: string[]) => keys as TeamStatKey[];

export const TABLE_VIEWS: TableView[] = [
  // ── Ratings ───────────────────────────────────────────────────────────────
  {
    key: "overview",
    label: "Overview",
    group: "Ratings",
    desc: "The default table — adjusted ratings, the four factors, and shooting",
    sortBy: "a_net" as TeamStatKey,
    sortDir: "desc",
    bands: [
      { label: "Ratings (adjusted)", keys: k("a_net", "a_ortg", "a_drtg", "adj_sos", "cbb_pace") },
      { label: "Four Factors", accent: true, keys: k("reb_diff_ct", "fg3m_diff_ct", "fbpts_diff", "tov_diff_ct") },
      { label: "Shooting", keys: k("cbb_efg", "cbb_fg3", "cbb_fg3rate", "cbb_ft", "cbb_ftarate") },
    ],
  },
  {
    key: "four-factors",
    label: "Four Factors",
    group: "Ratings",
    desc: "Dean Oliver's four factors, yours against theirs",
    sortBy: "cbb_efg" as TeamStatKey,
    sortDir: "desc",
    bands: [
      { label: "Offense", accent: true, keys: k("cbb_efg", "cbb_tov", "cbb_orb", "cbb_ftarate") },
      { label: "Defense", keys: k("cbb_efg_def", "cbb_tov_def", "cbb_orb_def", "cbb_fg3_def") },
      { label: "Margins", keys: k("efg_diff", "tov_diff", "orb_diff") },
    ],
  },
  {
    key: "adjusted",
    label: "Adjusted & Schedule",
    group: "Ratings",
    desc: "Our schedule-adjusted ratings and the schedule they were earned against",
    sortBy: "a_net" as TeamStatKey,
    sortDir: "desc",
    bands: [
      { label: "Adjusted", accent: true, keys: k("a_net", "a_ortg", "a_drtg", "adjt", "cbb_pace") },
      { label: "Schedule", keys: k("adj_sos", "nc_sos", "conf_sos", "sos_wp", "wab") },
    ],
  },

  // ── Shooting ──────────────────────────────────────────────────────────────
  {
    key: "shooting",
    label: "Shooting Splits",
    group: "Shooting",
    desc: "Accuracy from every level, plus the two efficiency composites",
    sortBy: "cbb_ts" as TeamStatKey,
    sortDir: "desc",
    bands: [
      { label: "Accuracy", accent: true, keys: k("cbb_fg", "cbb_fg2", "cbb_fg3", "cbb_ft") },
      { label: "Efficiency", keys: k("cbb_efg", "cbb_ts", "cbb_ppp") },
      { label: "Volume", keys: k("cbb_fga_pg", "cbb_fg3a_pg", "cbb_fta_pg", "cbb_fg3rate", "cbb_ftarate") },
    ],
  },
  {
    key: "shot-profile",
    label: "Shot Profile",
    group: "Shooting",
    desc: "Where the shots come from and how they fall — 2022 on, where coordinates exist",
    sortBy: "cbb_rim_rate" as TeamStatKey,
    sortDir: "desc",
    bands: [
      { label: "Frequency", accent: true, keys: k("cbb_rim_rate", "cbb_mid_rate", "cbb_three_rate", "cbb_corner3_share") },
      { label: "Accuracy by zone", keys: k("cbb_rim_fg", "cbb_mid_fg", "cbb_corner3_fg", "cbb_atb3_fg") },
      { label: "Allowed", keys: k("cbb_rim_rate_def", "cbb_mid_rate_def", "cbb_three_rate_def") },
    ],
  },

  // ── Box score ─────────────────────────────────────────────────────────────
  {
    key: "traditional",
    label: "Traditional Box",
    group: "Box Score",
    desc: "The counting stats, per game",
    sortBy: "cbb_pts_pg" as TeamStatKey,
    sortDir: "desc",
    bands: [
      { label: "Scoring", accent: true, keys: k("cbb_pts_pg", "cbb_fga_pg", "cbb_ast_pg") },
      { label: "Rebounding", keys: k("cbb_orb_pg", "cbb_drb_pg", "cbb_reb_pg") },
      { label: "Defense & fouls", keys: k("cbb_stl_pg", "cbb_blk_pg", "cbb_tov_pg", "cbb_pf_pg", "cbb_pfd_pg") },
    ],
  },
  {
    key: "scoring-context",
    label: "Scoring Context",
    group: "Box Score",
    desc: "Where the points actually come from — transition, paint, second chances, bench",
    sortBy: "cbb_pitp_pg" as TeamStatKey,
    sortDir: "desc",
    bands: [
      { label: "Per game", accent: true, keys: k("cbb_fbpts_pg", "cbb_pitp_pg", "cbb_scp_pg", "cbb_potov_pg", "cbb_bench_pg") },
      { label: "Share of points", keys: k("cbb_fbpts", "cbb_pitp", "cbb_scp_pct", "cbb_bench_pct") },
      { label: "Creation", keys: k("cbb_ast", "cbb_unast_share", "cbb_ast_to") },
    ],
  },
  {
    key: "differentials",
    label: "Differentials",
    group: "Box Score",
    desc: "You minus them, per game",
    sortBy: "pts_diff" as TeamStatKey,
    sortDir: "desc",
    bands: [
      { label: "Margin", accent: true, keys: k("pts_diff", "reb_diff_pg", "fg3m_diff_pg", "tov_diff_pg") },
      { label: "Situational", keys: k("fbpts_diff_pg", "pitp_diff_pg", "potov_diff_pg", "scp_diff_pg") },
      { label: "Rate margins", keys: k("efg_diff", "fg3_diff", "orb_diff", "tov_diff") },
    ],
  },

  // ── Defense ───────────────────────────────────────────────────────────────
  {
    key: "opp-shooting",
    label: "Opponent Shooting",
    group: "Defense",
    desc: "What the defense allowed, and from where",
    sortBy: "cbb_efg_def" as TeamStatKey,
    sortDir: "asc",
    bands: [
      { label: "Allowed", accent: true, keys: k("cbb_efg_def", "cbb_fg3_def", "cbb_orb_def", "cbb_tov_def") },
      { label: "Shot diet allowed", keys: k("cbb_rim_rate_def", "cbb_mid_rate_def", "cbb_three_rate_def") },
      { label: "Rating", keys: k("a_drtg", "cbb_drtg") },
    ],
  },
  {
    key: "defensive-events",
    label: "Defensive Events",
    group: "Defense",
    desc: "Steals, blocks and what they cost in fouls",
    sortBy: "cbb_hakeem" as TeamStatKey,
    sortDir: "desc",
    bands: [
      { label: "Event rates", accent: true, keys: k("cbb_stl_pct", "cbb_blk_pct", "cbb_hakeem", "cbb_drb_pct") },
      { label: "Per game", keys: k("cbb_stl_pg", "cbb_blk_pg", "cbb_pf_pg") },
      { label: "Cost of fouling", keys: k("cbb_stl_pf", "cbb_blk_pf", "cbb_pf_eff") },
    ],
  },

  // ── Team profile ──────────────────────────────────────────────────────────
  {
    key: "record",
    label: "Record & Outcomes",
    group: "Team Profile",
    desc: "The record, and what the scoreboard looked like getting there",
    sortBy: "win_pct" as TeamStatKey,
    sortDir: "desc",
    bands: [
      { label: "Record", accent: true, keys: k("wins", "losses", "win_pct", "wab") },
      { label: "Never in doubt", keys: k("wins_no_trail", "wire_wins", "losses_no_lead", "wire_losses") },
      { label: "Comebacks & collapses", keys: k("wins_trailing_10", "wins_trailing_20", "losses_leading_10", "losses_leading_20") },
    ],
  },
  {
    key: "continuity",
    label: "Roster Continuity",
    group: "Team Profile",
    desc: "How much of last season's rotation came back, and whether it kept its roles",
    sortBy: "cont_pct" as TeamStatKey,
    previewSortBy: "ret_min_pct" as TeamStatKey,
    sortDir: "desc",
    bands: [
      // LAST SEASON'S net rating, not this one's. Continuity is a statement
      // about a roster that has not played yet, so the rating it is changing
      // FROM is the one that gives the percentage meaning: 80% continuity on a
      // returning contender and on a returning bottom-quartile roster are
      // opposite stories. On the preview season it is also the only rating that
      // exists at all.
      // LAST SEASON NET RATING, not this one. Continuity is a claim about a
      // roster that has not played, so the rating it is changing FROM is what
      // gives the percentage meaning: 80% continuity on a returning contender
      // and on a returning bottom-quartile roster are opposite stories. On the
      // upcoming season it is also the only rating that exists.
      { label: "Prior season", keys: k("prev_a_net") },
      // ORDERED SO THE POPULATED BANDS COME FIRST ON EITHER SEASON. Minutes
      // returned and Incoming are knowable before a game is played; Stability
      // and Returner share need minutes from the season in progress. Putting
      // the two preseason bands next to each other means the upcoming season
      // reads left-to-right without crossing four columns of dashes, and a
      // played season still reads in its own order after them.
      { label: "Minutes returned", accent: true, keys: k("ret_prior_min", "prior_team_min", "ret_min_pct") },
      // The portal side: what a team bought, and the two halves together.
      // Blank on played seasons, the mirror of the two bands below.
      { label: "Incoming", keys: k("in_transfer_min", "proven_min_pct") },
      { label: "Stability", keys: k("cont_pct") },
      { label: "Returner share", keys: k("ret_curr_min", "curr_team_min", "rrot_pct") },
    ],
  },
  {
    key: "roster",
    label: "Roster & Experience",
    group: "Team Profile",
    desc: "How big and how old the rotation actually is, weighted by minutes played",
    sortBy: "eff_height" as TeamStatKey,
    sortDir: "desc",
    bands: [
      { label: "Size", accent: true, keys: k("eff_height", "cbb_orb", "cbb_orb_def") },
      { label: "Minutes by class", keys: k("fr_min_pct", "so_min_pct", "jr_min_pct", "sr_min_pct") },
      { label: "Points by class", keys: k("fr_pts_pct", "so_pts_pct", "jr_pts_pct", "sr_pts_pct") },
    ],
  },

  // ── Custom ────────────────────────────────────────────────────────────────
  /**
   * THE EMPTY ONE. Team, conference, season and record, and not one stat.
   *
   * Every other view answers "show me the shooting numbers" — a question we
   * guessed at in advance. This answers "show me exactly these six things and
   * nothing else", which no curated set ever will, because the reader's six
   * are not the same as anyone else's.
   *
   * The columns come from Add a Filter, which already pins whatever it filters
   * on and renders it under "Your columns". So this view needs no machinery of
   * its own — it is the absence of a column set, and the pinning behaviour that
   * already exists does the rest.
   *
   * DECLARED LAST on purpose. TABLE_VIEWS[0] is the default view the toolbar
   * falls back to, and a reader who arrives at an empty table has been given a
   * blank page instead of a product.
   *
   * It still sorts by NET underneath. The column is not shown, but the rows
   * have to arrive in SOME order, and "best teams first" is the only order that
   * is not arbitrary.
   */
  {
    key: "custom",
    label: "Build My Own Table",
    group: "Custom",
    desc: "Start with nothing but the teams, then add exactly the columns you want",
    custom: true,
    sortBy: "a_net" as TeamStatKey,
    sortDir: "desc",
    bands: [],
  },
];

export const DEFAULT_VIEW = TABLE_VIEWS[0]!;

const BY_KEY = new Map(TABLE_VIEWS.map((v) => [v.key, v]));

/** A view by key, or the default. Never throws — a stale URL falls back. */
export function viewByKey(key: string | undefined | null): TableView {
  return (key && BY_KEY.get(key)) || DEFAULT_VIEW;
}

/** Picker sections, in declaration order. */
export function viewGroups(): Array<{ group: string; views: TableView[] }> {
  const out: Array<{ group: string; views: TableView[] }> = [];
  for (const v of TABLE_VIEWS) {
    let g = out.find((x) => x.group === v.group);
    if (!g) { g = { group: v.group, views: [] }; out.push(g); }
    g.views.push(v);
  }
  return out;
}

/**
 * Every stat key a view names, flattened in band order.
 *
 * VALIDATED AT MODULE LOAD in development. A key that is not in
 * TEAM_STAT_COLUMNS would otherwise render as a column of dashes — present,
 * headed, and empty — which reads as missing data rather than as the typo it
 * is. Throwing is right here because the fix is a one-character edit and the
 * failure is silent otherwise.
 */
const KNOWN = new Set(TEAM_STAT_COLUMNS.map((c) => c.key));
if (process.env.NODE_ENV !== "production") {
  const bad: string[] = [];
  for (const v of TABLE_VIEWS) {
    for (const b of v.bands) for (const key of b.keys) if (!KNOWN.has(key)) bad.push(`${v.key}/${key}`);
    if (!KNOWN.has(v.sortBy)) bad.push(`${v.key}/sortBy:${v.sortBy}`);
  }
  if (bad.length) {
    throw new Error(`team-views.ts names stat keys that do not exist: ${bad.join(", ")}`);
  }
}

/**
 * The same guarantee for the paywall, which is the one place a typo would be
 * WORSE than a column of dashes.
 *
 * src/lib/access.ts decides what a free reader sees, and for two views it does
 * so by naming bands — "Record" is free, the rest of Record & Outcomes is not.
 * Those names are strings matched against band labels, so renaming a band here
 * would not break anything visible: it would quietly stop matching, the band
 * would fall out of the free list, and the view would either give away more
 * than intended or lock something that should be public. Nobody would notice
 * either way until a customer did.
 *
 * Checked in BOTH directions, because each catches a different mistake: a
 * policy naming a band that no longer exists (a rename), and a view with no
 * policy entry at all (a new view shipped ungated by omission).
 */
if (process.env.NODE_ENV !== "production") {
  const bad: string[] = [];
  for (const v of TABLE_VIEWS) {
    const rule = VIEW_ACCESS[v.key];
    if (!rule) {
      bad.push(`view "${v.key}" has no entry in VIEW_ACCESS`);
      continue;
    }
    if (rule.kind !== "bands") continue;
    const labels = new Set(v.bands.map((b) => b.label));
    for (const label of rule.free) {
      if (!labels.has(label)) {
        bad.push(`"${v.key}" has no band called "${label}" — it has [${[...labels].join(" | ")}]`);
      }
    }
  }
  for (const key of Object.keys(VIEW_ACCESS)) {
    if (!BY_KEY.has(key)) bad.push(`VIEW_ACCESS names "${key}", which is not a view`);
  }
  if (bad.length) {
    throw new Error(`access.ts and team-views.ts disagree: ${bad.join("; ")}`);
  }
}

export function viewKeys(v: TableView): TeamStatKey[] {
  return v.bands.flatMap((b) => b.keys);
}
