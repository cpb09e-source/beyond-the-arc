/**
 * The column model for the team page's "By season" grid. ONE surface uses this.
 *
 * IT USED TO BE TWO, AND THAT WAS A MISTAKE. This module was written to be
 * shared with the explorer on `/` on the theory that a stat appearing in one
 * grid and not the other "reads as a bug in whichever one the reader saw
 * second". The explorer was rewired to import from here at the same time, which
 * silently applied every By-season column decision to the site's front page:
 * PACE and FBP vanished, 3PA Rate and FTA Rate vanished, OREB% appeared, and a
 * Coach column arrived. None of that was asked for on the explorer, and it was
 * caught only by eye afterwards.
 *
 * THE TWO GRIDS ARE ALLOWED TO DIFFER, AND DO. The explorer keeps its own
 * definitions inline in explorer-client.tsx. Do not "de-duplicate" them back
 * together: they answer different questions (every team in one season vs every
 * season for one team) and the column sets that serve those questions are not
 * the same set. Sharing the model makes an edit to one an unannounced edit to
 * the other, which is exactly how this went wrong.
 *
 * What legitimately belongs here is only what By season itself renders.
 * This module is deliberately NOT a shared component: sharing the <table> would
 * mean dragging the explorer's URL-driven sorting, pagination and drag-pan onto
 * a page that wants none of them.
 *
 * `total` is the hero value and `perGame` the small figure beneath it. Only the
 * differential columns carry both — a rating or a rate is already normalised,
 * but a differential reads naturally either way, and seeing "+202" with "5.9/g"
 * under it answers both "how big was the edge" and "how big per night" at once.
 *
 * WHERE A COLUMN HAS BOTH, THE CHIP RANKS ON THE PER-GAME VALUE. Coverage of
 * season totals is uneven across eras, so ranking on the total would place a
 * team against a biased slice of its own season rather than the whole of it.
 */
import type { TeamRow } from "@/lib/team-filters";

export type TeamCol = {
  label: string;
  total: keyof TeamRow;
  perGame?: keyof TeamRow;
  /** Key into `row.pct` — the percentile the chip renders. */
  pct: string;
  sortKey: string;
  /** Sorting ascending is the "good" direction (defensive rating, turnovers). */
  lowerBetter?: boolean;
  fmt: "num1" | "signed" | "pct1";
  title: string;
};

// Labels drop the "a" prefix — the band caption says "(ADJUSTED)" once, which
// is less noisy than repeating it on every column head.
export const RATING_COLS: TeamCol[] = [
  { label: "NET",  total: "a_net",   pct: "a_net",   sortKey: "a_net",   fmt: "num1", title: "Schedule-adjusted net rating — points per 100 possessions vs an average D-I opponent on a neutral floor" },
  { label: "ORTG", total: "a_ortg",  pct: "a_ortg",  sortKey: "a_ortg",  fmt: "num1", title: "Schedule-adjusted offensive rating — points scored per 100 possessions" },
  { label: "DRTG", total: "a_drtg",  pct: "a_drtg",  sortKey: "a_drtg",  fmt: "num1", lowerBetter: true, title: "Schedule-adjusted defensive rating — points allowed per 100 possessions (lower is better)" },
  { label: "SOS",  total: "adj_sos", pct: "adj_sos", sortKey: "adj_sos", fmt: "num1", title: "Strength of schedule — average opponent adjusted net rating" },
  // PACE was here and was removed on request. It stays a filterable and
  // pinnable stat in TEAM_STAT_COLUMNS, and its percentile is still baked.
];

export const FOUR_FACTOR_COLS: TeamCol[] = [
  { label: "REB",  total: "reb_diff_ct",  perGame: "reb_diff_pg",   pct: "reb_diff_pg",   sortKey: "reb_diff_ct",  fmt: "signed", title: "Rebounds − opponent rebounds" },
  { label: "3PM",  total: "fg3m_diff_ct", perGame: "fg3m_diff_pg",  pct: "fg3m_diff_pg",  sortKey: "fg3m_diff_ct", fmt: "signed", title: "3-pointers made − allowed" },
  // Replaced FBP (fast-break points differential) on request, and the band is
  // more honest for it: offensive rebounding IS one of the four factors, and
  // fast-break points never were. It also drops the one column whose season
  // total was missing before 2023 — the "/g fallback" path below exists for
  // FBP and nothing else, and is left in place for any future column with the
  // same coverage problem.
  //
  // A rate, not a differential, so no perGame figure and no signed format.
  { label: "OREB%", total: "cbb_orb", pct: "cbb_orb", sortKey: "cbb_orb", fmt: "pct1", title: "Offensive rebound % — share of available offensive rebounds collected" },
  { label: "TOV",  total: "tov_diff_ct",  perGame: "tov_diff_pg",   pct: "tov_diff_pg",   sortKey: "tov_diff_ct",  fmt: "signed", lowerBetter: true, title: "Turnovers − opponent turnovers (negative is good)" },
];

/**
 * 3PA Rate and FTA Rate were here and were removed on request.
 *
 * They remain fully wired as stats — TEAM_STAT_COLUMNS still carries both, so
 * they are still filterable and still pinnable as leading columns from the
 * Filters drawer, and every percentile for them is still baked. Only their
 * place in the DEFAULT column set is gone. Restoring them is two lines.
 */
export const SHOOTING_COLS: TeamCol[] = [
  { label: "eFG%",  total: "cbb_efg",     pct: "cbb_efg",     sortKey: "cbb_efg",     fmt: "pct1", title: "Effective field-goal % — (FGM + 0.5 × 3PM) / FGA" },
  { label: "3P%",   total: "cbb_fg3",     pct: "cbb_fg3",     sortKey: "cbb_fg3",     fmt: "pct1", title: "3-point %" },
  { label: "FT%",   total: "cbb_ft",      pct: "cbb_ft",      sortKey: "cbb_ft",      fmt: "pct1", title: "Free-throw %" },
];

export const DEFAULT_COLS = [...RATING_COLS, ...FOUR_FACTOR_COLS, ...SHOOTING_COLS];

export function fmtColValue(v: number | null | undefined, fmt: TeamCol["fmt"]): string {
  if (v === null || v === undefined) return "—";
  if (fmt === "pct1") return (v * 100).toFixed(1) + "%";
  if (fmt === "signed") return (v > 0 ? "+" : "") + v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
