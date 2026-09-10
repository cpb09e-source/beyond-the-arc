/**
 * The columns the team scatter can plot, and how to read one off a season row.
 *
 * EVERY METRIC HERE HAS FULL COVERAGE. Checked against 2026: all 365 D-I teams
 * carry a finite value for all of these. That matters more on a scatter than in
 * a table — a table shows a dash and moves on, while a missing value silently
 * drops a team off the plot, and a reader has no way to tell an absent team
 * from one they did not select. Anything added here should be checked the same
 * way before it goes in.
 *
 * DIRECTION IS PART OF THE DEFINITION, not a rendering choice. Adjusted
 * defensive rating is better when it is lower, turnover rate is better when it
 * is lower, and tempo is neither. The chart inverts an axis whose metric is
 * `lowerBetter` so that better is always up and to the right, which is the only
 * way two arbitrary metrics can share a plot without the reader having to hold
 * which corner is good for each one separately.
 */

export type MetricFormat = "num1" | "num2" | "num3" | "pct1";

export type Metric = {
  key: string;
  /** Full name, for the axis and the pickers. */
  label: string;
  /** Table-column form — must fit in about six characters. */
  short: string;
  group: string;
  fmt: MetricFormat;
  /** A LOWER value is better. The axis is drawn inverted so better stays up/right. */
  lowerBetter?: boolean;
  /** Neither direction is good or bad — no inversion, and no "better" arrow. */
  neutral?: boolean;
};

export const METRICS: Metric[] = [
  // ── Ratings ────────────────────────────────────────────────────────────
  { key: "adjoe", label: "Adjusted offensive rating", short: "ORtg", group: "Ratings", fmt: "num1" },
  { key: "adjde", label: "Adjusted defensive rating", short: "DRtg", group: "Ratings", fmt: "num1", lowerBetter: true },
  // TWO NET NUMBERS, and they are not the same one. `margin` is Torvik's
  // adjusted offense minus his adjusted defense; `net_rtg_adj` is the site's
  // own adjusted net rating, carried on the season row. They disagree by
  // several points a team — Saint Mary's 2026 is +24.4 against a +19.9 margin
  // — so collapsing them into one entry would quietly pick a winner.
  { key: "margin", label: "Adjusted margin (ORtg − DRtg)", short: "Margin", group: "Ratings", fmt: "num1" },
  { key: "net_rtg_adj", label: "Adjusted net rating", short: "NetRtg", group: "Ratings", fmt: "num1" },
  { key: "adjt", label: "Adjusted tempo", short: "Tempo", group: "Ratings", fmt: "num1", neutral: true },
  { key: "sos", label: "Strength of schedule", short: "SOS", group: "Ratings", fmt: "num3" },
  { key: "wab", label: "Wins above bubble", short: "WAB", group: "Ratings", fmt: "num1" },

  // ── Shooting ───────────────────────────────────────────────────────────
  { key: "efg_pct", label: "Effective FG%", short: "eFG%", group: "Shooting", fmt: "pct1" },
  { key: "ts_pct", label: "True shooting %", short: "TS%", group: "Shooting", fmt: "pct1" },
  { key: "fg3_pct", label: "3-point %", short: "3P%", group: "Shooting", fmt: "pct1" },
  { key: "ft_pct", label: "Free throw %", short: "FT%", group: "Shooting", fmt: "pct1" },
  { key: "fg3a_rate", label: "3-point attempt rate", short: "3PA%", group: "Shooting", fmt: "pct1", neutral: true },
  { key: "fta_rate", label: "Free throw rate", short: "FTr", group: "Shooting", fmt: "pct1", neutral: true },

  // ── Four factors ───────────────────────────────────────────────────────
  { key: "orb_pct", label: "Offensive rebound rate", short: "OREB%", group: "Four factors", fmt: "pct1" },
  { key: "tov_pct", label: "Turnover rate", short: "TOV%", group: "Four factors", fmt: "pct1", lowerBetter: true },
  { key: "ast_pct", label: "Assist rate", short: "AST%", group: "Four factors", fmt: "pct1" },

  // ── Defense ────────────────────────────────────────────────────────────
  { key: "efg_pct_def", label: "Effective FG% allowed", short: "eFG%A", group: "Defense", fmt: "pct1", lowerBetter: true },
  { key: "fg3_pct_def", label: "3-point % allowed", short: "3P%A", group: "Defense", fmt: "pct1", lowerBetter: true },
  { key: "tov_pct_def", label: "Turnover rate forced", short: "TOV%F", group: "Defense", fmt: "pct1" },
  { key: "orb_pct_def", label: "Offensive rebound rate allowed", short: "OREB%A", group: "Defense", fmt: "pct1", lowerBetter: true },

  // ── Where the points come from ─────────────────────────────────────────
  { key: "pitp_pct", label: "Share of points in the paint", short: "PITP%", group: "Scoring mix", fmt: "pct1", neutral: true },
  { key: "fbpts_pct", label: "Share of points on the break", short: "FB%", group: "Scoring mix", fmt: "pct1", neutral: true },
  { key: "pot_pct", label: "Share of points off turnovers", short: "POT%", group: "Scoring mix", fmt: "pct1", neutral: true },
];

export const METRIC_BY_KEY: Record<string, Metric> = Object.fromEntries(METRICS.map((m) => [m.key, m]));

/** The groups, in the order METRICS declares them — for the picker's optgroups. */
export const METRIC_GROUPS: string[] = [...new Set(METRICS.map((m) => m.group))];

/**
 * Pairs worth looking at, for the preset picker.
 *
 * Every one of these is a question somebody actually asks, rather than a
 * demonstration that the axes are configurable. The first is the default
 * because it is the argument the sport has every day.
 */
export const METRIC_PRESETS: { label: string; x: string; y: string }[] = [
  { label: "Offense vs defense", x: "adjoe", y: "adjde" },
  { label: "Tempo vs offense", x: "adjt", y: "adjoe" },
  { label: "Three-point rate vs shooting", x: "fg3a_rate", y: "efg_pct" },
  { label: "Crash the glass vs give it away", x: "orb_pct", y: "tov_pct" },
  { label: "Shooting defense vs turnovers forced", x: "efg_pct_def", y: "tov_pct_def" },
  { label: "Schedule vs résumé", x: "sos", y: "wab" },
  { label: "Paint scoring vs three-point rate", x: "pitp_pct", y: "fg3a_rate" },
];

type Nested = {
  team_trank_stats?: Record<string, unknown> | null;
  team_season_stats?: Record<string, unknown> | null;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Flatten one teams-all row into the metric map the chart plots from.
 *
 * `margin` is the one value that is not a stored column — it is the difference
 * the whole chart's default view is about, and computing it here keeps the
 * chart from having to know that two of its metrics are related.
 */
export function extractMetrics(row: Nested): Record<string, number | null> {
  const tr = row.team_trank_stats ?? {};
  const ss = row.team_season_stats ?? {};
  const out: Record<string, number | null> = {};

  for (const m of METRICS) {
    if (m.key === "margin") continue;
    out[m.key] = num(tr[m.key]) ?? num(ss[m.key]);
  }

  const oe = num(tr.adjoe), de = num(tr.adjde);
  out.margin = oe != null && de != null ? oe - de : null;
  return out;
}

export function fmtMetric(m: Metric, v: number | null): string {
  if (v == null) return "—";
  switch (m.fmt) {
    case "pct1": return `${(v * 100).toFixed(1)}%`;
    case "num2": return v.toFixed(2);
    case "num3": return v.toFixed(3);
    default: return v.toFixed(1);
  }
}

/**
 * A tick's label. Same formatter as a cell, minus the trailing tenth when there
 * is not one — an axis reading 104.0, 106.0, 108.0 spends three characters a
 * tick saying nothing, and the column beside it is where precision belongs.
 */
export function fmtTick(m: Metric, v: number): string {
  return fmtMetric(m, v).replace(/\.0(?=%?$)/, "");
}

/**
 * How many ticks an axis of this many pixels should carry.
 *
 * Fixed at five, a 810px tall axis got a gridline every 160px and a step of 5
 * rating points, which is coarse enough that a team's position has to be
 * estimated rather than read. Deriving the count from the length instead gets
 * the step down to 2 on a tall axis without crowding a short one — and because
 * niceTicks only ever picks 1, 2, 5 or 10 times a power of ten, asking for a
 * few more is safe: it lands on the next step down, not on an ugly number.
 *
 * 75px per tick vertically and 62 horizontally. The vertical number is larger
 * on purpose: at 60 an 18-point rating range asked for 14 ticks, niceTicks
 * rounded the step down to 1, and the axis came back with eighteen gridlines
 * 45px apart. Asking for slightly fewer lands on a step of 2, which is the
 * density a rating axis wants.
 */
export function tickCount(px: number, axis: "x" | "y"): number {
  return Math.max(4, Math.min(14, Math.round(px / (axis === "y" ? 75 : 62))));
}

/** Axis tick values that land on round numbers, whatever the metric's scale. */
export function niceTicks(lo: number, hi: number, want = 5): number[] {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / want;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) {
    out.push(Number(v.toPrecision(12)));
  }
  return out;
}
