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

/** Every column a view renders, bands flattened, unknown keys dropped. */
export function confViewCols(view: ConfView): ConfCol[] {
  return view.bands.flatMap((b) => b.keys.map(confCol).filter((c): c is ConfCol => c !== null));
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
