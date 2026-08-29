/**
 * The seven views on /conferences, and how a stat key becomes a column.
 *
 * EACH ONE MIRRORS THE TEAM EXPLORER VIEW OF THE SAME NAME, column for column
 * and band for band, so a reader moving between the two pages is not relearning
 * a layout. Two deliberate departures, both explained in
 * docs/conference-rankings-spec.md:
 *
 *   1. Season-total differentials become per-game ones. A total says how many
 *      games a conference's teams played as much as it says anything else.
 *   2. `pts_diff_pg` exists here and not there — the team side carries the
 *      season total only, so this page derives the margin per game.
 *
 * Labels, number formats, tooltips and percentile direction all come from
 * TEAM_STAT_COLUMNS and isLowerBetter. There is no second catalogue to drift.
 */
import { TEAM_STAT_COLUMNS, isLowerBetter } from "@/lib/team-filters";

export type ConfViewBand = {
  label: string;
  /** Rendered in the accent, for the band the view is really about. */
  accent?: boolean;
  keys: string[];
};

export type ConfView = {
  key: string;
  label: string;
  desc: string;
  bands: ConfViewBand[];
  sortBy: string;
  sortDir: "asc" | "desc";
  /**
   * Columns to use INSTEAD of `bands` when a game split is active.
   *
   * Only Overview needs this, and it needs it badly: its headline band is the
   * schedule-ADJUSTED ratings, and there is no such thing as an adjusted
   * conference-games rating — the adjustment is a season-long fit over the
   * whole schedule. Under a split it shows the raw ratings the split does
   * have, and swaps the count differentials (also unavailable) for the four
   * factors themselves, which is the same question asked with the numbers
   * that exist.
   */
  splitBands?: ConfViewBand[];
};

export const CONF_VIEWS: ConfView[] = [
  {
    key: "overview",
    label: "Overview",
    desc: "Adjusted ratings, the four factors and shooting — the league at a glance",
    bands: [
      { label: "Ratings (adjusted)", accent: true, keys: ["a_net", "a_ortg", "a_drtg", "adj_sos", "cbb_pace"] },
      { label: "Four Factors", keys: ["reb_diff_pg", "fg3m_diff_pg", "fbpts_diff_pg", "tov_diff_pg"] },
      { label: "Shooting", keys: ["cbb_efg", "cbb_fg3", "cbb_fg3rate", "cbb_ft", "cbb_ftarate"] },
    ],
    splitBands: [
      { label: "Ratings", accent: true, keys: ["net_rtg", "cbb_ortg", "cbb_drtg", "cbb_pace"] },
      { label: "Four Factors", keys: ["cbb_efg", "cbb_orb", "cbb_tov", "cbb_ftarate"] },
      { label: "Shooting", keys: ["cbb_fg3", "cbb_ft", "cbb_fg3rate", "cbb_ts"] },
    ],
    sortBy: "a_net",
    sortDir: "desc",
  },
  {
    key: "adjusted",
    label: "Adjusted & Schedule",
    desc: "Our schedule-adjusted ratings and the schedule the league earned them against",
    bands: [
      { label: "Adjusted", accent: true, keys: ["a_net", "a_ortg", "a_drtg", "adjt", "cbb_pace"] },
      { label: "Schedule", keys: ["adj_sos", "nc_sos", "conf_sos", "sos_wp", "wab"] },
    ],
    sortBy: "a_net",
    sortDir: "desc",
  },
  {
    key: "traditional",
    label: "Traditional Box",
    desc: "The counting stats, per game",
    bands: [
      { label: "Scoring", keys: ["cbb_pts_pg", "cbb_fga_pg", "cbb_ast_pg"] },
      { label: "Rebounding", keys: ["cbb_orb_pg", "cbb_drb_pg", "cbb_reb_pg"] },
      { label: "Defense & fouls", keys: ["cbb_stl_pg", "cbb_blk_pg", "cbb_tov_pg", "cbb_pf_pg", "cbb_pfd_pg"] },
    ],
    sortBy: "cbb_pts_pg",
    sortDir: "desc",
  },
  {
    key: "scoring-context",
    label: "Scoring Context",
    desc: "Where the league's points come from — transition, paint, second chances, bench",
    bands: [
      { label: "Per game", keys: ["cbb_fbpts_pg", "cbb_pitp_pg", "cbb_scp_pg", "cbb_potov_pg", "cbb_bench_pg"] },
      { label: "Share of points", accent: true, keys: ["cbb_fbpts", "cbb_pitp", "cbb_scp_pct", "cbb_bench_pct"] },
      { label: "Creation", keys: ["cbb_ast", "cbb_unast_share", "cbb_ast_to"] },
    ],
    sortBy: "cbb_pitp_pg",
    sortDir: "desc",
  },
  {
    key: "differentials",
    label: "Differentials",
    desc: "The league minus its opponents, per game",
    bands: [
      { label: "Margin", accent: true, keys: ["pts_diff_pg", "reb_diff_pg", "fg3m_diff_pg", "tov_diff_pg"] },
      { label: "Situational", keys: ["fbpts_diff_pg", "pitp_diff_pg", "potov_diff_pg", "scp_diff_pg"] },
      { label: "Rate margins", keys: ["efg_diff", "fg3_diff", "orb_diff", "tov_diff"] },
    ],
    sortBy: "pts_diff_pg",
    sortDir: "desc",
  },
  {
    key: "defensive-events",
    label: "Defensive Events",
    desc: "Steal and block rates, and what the league pays in fouls to get them",
    bands: [
      { label: "Event rates", accent: true, keys: ["cbb_stl_pct", "cbb_blk_pct", "cbb_hakeem", "cbb_drb_pct"] },
      { label: "Per game", keys: ["cbb_stl_pg", "cbb_blk_pg", "cbb_pf_pg"] },
      { label: "Cost of fouling", keys: ["cbb_stl_pf", "cbb_blk_pf", "cbb_pf_eff"] },
    ],
    sortBy: "cbb_hakeem",
    sortDir: "desc",
  },
  {
    key: "record",
    label: "Record & Outcomes",
    desc: "What the league's teams did on average, and what the scoreboard looked like doing it",
    bands: [
      { label: "Record", accent: true, keys: ["wins", "losses", "win_pct", "wab"] },
      // The one band on the page that counts the WHOLE league rather than
      // the kept teams. A conference's March record is a fact about the
      // conference, and dropping two teams from it would make it wrong.
      { label: "March Madness", keys: ["ncaa_bids", "ncaa_w", "ncaa_l", "ncaa_s16", "ncaa_f4", "ncaa_nc"] },
      { label: "Never in doubt", keys: ["wins_no_trail", "wire_wins", "losses_no_lead", "wire_losses"] },
      { label: "Comebacks & collapses", keys: ["wins_trailing_10", "wins_trailing_20", "losses_leading_10", "losses_leading_20"] },
    ],
    sortBy: "win_pct",
    sortDir: "desc",
  },
];

export const CONF_VIEW_BY_KEY = new Map(CONF_VIEWS.map((v) => [v.key, v]));

export function confViewByKey(key: string | null | undefined): ConfView {
  return (key ? CONF_VIEW_BY_KEY.get(key) : undefined) ?? CONF_VIEWS[0]!;
}

export type ConfCol = {
  key: string;
  label: string;
  title: string;
  fmt: "num1" | "num2" | "pct1" | "int" | "signed";
  lowerBetter: boolean;
  /**
   * Rank this column against nothing.
   *
   * For a stat where the number is mostly a function of how many chances the
   * conference had. NCAA losses is the case: the SEC lost ten tournament
   * games in 2026 because it sent ten teams, and painting that the deepest
   * red on the page says the opposite of what happened.
   */
  noPct?: boolean;
};

/**
 * The one key the team catalogue does not have.
 *
 * The team explorer shows `pts_diff` — a season total — because a team plays a
 * fixed number of games and the total is the more familiar figure. A
 * conference does not: its teams play different counts and two of them have
 * been dropped, so only the per-game margin means anything.
 */
const EXTRA: Record<string, Omit<ConfCol, "key">> = {
  pts_diff_pg: {
    label: "PTS",
    title: "Points scored minus points allowed, per game",
    fmt: "signed",
    lowerBetter: false,
  },
  /**
   * March, from src/data/tournament-games.json.
   *
   * BIDS IS THE ROUND OF 64, not the 68-team field: the source carries the
   * 63-game bracket, so a team that lost in the First Four never appears.
   * Counted over EVERY team in the league — the two a row drops included —
   * because a bid is a bid however the team rated.
   */
  ncaa_bids: { label: "Bids", title: "Teams in the round of 64 (First Four losers not counted)", fmt: "int", lowerBetter: false },
  ncaa_w: { label: "NCAA W", title: "NCAA tournament wins by the whole conference", fmt: "int", lowerBetter: false },
  ncaa_l: { label: "NCAA L", title: "NCAA tournament losses by the whole conference — not ranked, since a league loses more by sending more", fmt: "int", lowerBetter: true, noPct: true },
  ncaa_s16: { label: "S16", title: "Teams reaching the Sweet 16", fmt: "int", lowerBetter: false, noPct: true },
  // Not ranked: on any given season all but a handful of leagues sit at
  // zero, and a percentile chip on a column of zeroes ranks nothing while
  // looking like it ranks something.
  ncaa_f4: { label: "F4", title: "Teams reaching the Final Four", fmt: "int", lowerBetter: false, noPct: true },
  ncaa_nc: { label: "NC", title: "National champions", fmt: "int", lowerBetter: false, noPct: true },

  /** Raw, not adjusted — the only kind a game split can have. */
  net_rtg: {
    label: "NET",
    title: "Net rating over these games — points per 100 possessions, unadjusted",
    fmt: "signed",
    lowerBetter: false,
  },
};

const BY_KEY = new Map(TEAM_STAT_COLUMNS.map((c) => [c.key, c]));

/** A column, or null for a key nothing knows about. */
export function confCol(key: string): ConfCol | null {
  const extra = EXTRA[key];
  if (extra) return { key, ...extra };
  const meta = BY_KEY.get(key);
  if (!meta) return null;
  const fmt: ConfCol["fmt"] =
    meta.format === "pct1" ? "pct1"
      : meta.format === "int" ? "num1"        // per-team means, so never an int
      : meta.format === "num2" ? "num2"
      // Everything in the diffs group is a margin and reads with a sign.
      : meta.group === "diffs" ? "signed"
      : "num1";
  return { key, label: meta.label, title: meta.desc, fmt, lowerBetter: isLowerBetter(key) };
}

/**
 * Stats the conference-games / non-conference-games splits carry.
 *
 * MIRRORS SPLIT_STATS in scripts/build-conference-rankings.mjs. Everything
 * missing from it is missing for a reason rather than an oversight: the
 * adjusted ratings and the schedule numbers are season-long fits, the
 * outcome counts are not split anywhere upstream, and the count
 * differentials come from season totals.
 */
export const SPLIT_STAT_KEYS: ReadonlySet<string> = new Set([
  "cbb_ortg", "cbb_drtg", "net_rtg", "cbb_pace", "pts_diff_pg",
  "cbb_efg", "cbb_ts", "cbb_orb", "cbb_tov", "cbb_ftarate", "cbb_fg3", "cbb_ft", "cbb_fg3rate",
  "cbb_pts_pg", "cbb_fga_pg", "cbb_ast_pg", "cbb_orb_pg", "cbb_drb_pg", "cbb_reb_pg",
  "cbb_stl_pg", "cbb_blk_pg", "cbb_tov_pg", "cbb_pf_pg", "cbb_pfd_pg",
  "cbb_fbpts_pg", "cbb_pitp_pg", "cbb_potov_pg", "cbb_fbpts", "cbb_pitp",
  "cbb_ast", "cbb_ast_to",
  "cbb_stl_pct", "cbb_blk_pct", "cbb_hakeem", "cbb_drb_pct",
  "cbb_stl_pf", "cbb_blk_pf", "cbb_pf_eff",
]);

/**
 * A view is offered under a split only if the split can fill most of it.
 * Four is the floor: below that the table is a couple of columns wearing a
 * view's name, which is worse than not offering the view at all.
 */
const MIN_SPLIT_COLS = 4;

/** Every column a view renders, bands flattened, unknown keys dropped. */
export function confViewCols(view: ConfView, split: string = "full"): ConfCol[] {
  const bands = split !== "full" && view.splitBands ? view.splitBands : view.bands;
  const cols = bands.flatMap((b) => b.keys.map(confCol).filter((c): c is ConfCol => c !== null));
  return split === "full" ? cols : cols.filter((c) => SPLIT_STAT_KEYS.has(c.key));
}

/** The bands a view renders, for the caption row. */
export function confViewBands(view: ConfView, split: string = "full"): ConfViewBand[] {
  return split !== "full" && view.splitBands ? view.splitBands : view.bands;
}

/** Views worth offering for a split — see MIN_SPLIT_COLS. */
export function confViewsFor(split: string): ConfView[] {
  if (split === "full") return CONF_VIEWS;
  return CONF_VIEWS.filter((v) => confViewCols(v, split).length >= MIN_SPLIT_COLS);
}

/**
 * Dev-time check that every key in every view resolves. A view naming a stat
 * nothing can render would otherwise show up as a silently narrower table.
 */
if (process.env.NODE_ENV !== "production") {
  const missing: string[] = [];
  for (const v of CONF_VIEWS) {
    for (const b of v.bands) for (const k of b.keys) if (!confCol(k)) missing.push(`${v.key}/${k}`);
    if (!confCol(v.sortBy)) missing.push(`${v.key}/sortBy:${v.sortBy}`);
  }
  if (missing.length) throw new Error(`conference-views: unknown stat keys — ${missing.join(", ")}`);
}
