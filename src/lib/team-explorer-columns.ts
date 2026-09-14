/**
 * The Team Explorer's columns: the default set, a column for any stat a view
 * names or a reader pins, the same columns flattened for a download, and how a
 * cell prints.
 *
 * Moved out of src/components/explorer/explorer-client.tsx, unchanged, so the
 * desktop app builds its table from the same definitions.
 */
import { TEAM_STAT_COLUMNS, isLowerBetter, type TeamRow } from "@/lib/team-filters";
import type { TableView } from "@/lib/team-views";
import type { ExportCol } from "@/lib/table-export";

/**
 * The default column set, in display order.
 *
 * Deliberately mirrors the /players grid: one entry per column, a band label
 * spanning a group, a percentile chip under every value. Same shape, same
 * visual language, so moving between the two pages feels like one product.
 *
 * `total` is the hero value and `perGame` the small figure beneath it. Only the
 * Four Factors carry both — a rating is already a rate, but a differential reads
 * naturally either way, and seeing "+416" with "10.95/g" under it answers both
 * "how big was the edge" and "how big per night" at once.
 *
 * CHIPS RANK ON THE PER-GAME VALUE. Fast-break totals exist for ~1,500
 * team-seasons but the per-game figure for ~3,800, so ranking on the total would
 * place a team against a biased slice of its own era instead of the whole era.
 */
export type TeamCol = {
  label: string;
  total: keyof TeamRow;
  perGame?: keyof TeamRow;
  /** Key into `row.pct` — the percentile the chip renders. */
  pct: string;
  sortKey: string;
  /** Sorting ascending is the "good" direction (defensive rating, turnovers). */
  lowerBetter?: boolean;
  /** "int" is a count — whole, and unsigned, unlike "signed" margins. */
  fmt: "num1" | "signed" | "pct1" | "int";
  title: string;
};

// Labels drop the "a" prefix — the band caption says "(ADJUSTED)" once, which
// is less noisy than repeating it on every column head.
export const RATING_COLS: TeamCol[] = [
  { label: "NET",  total: "a_net",   pct: "a_net",   sortKey: "a_net",   fmt: "num1", title: "Schedule-adjusted net rating — points per 100 possessions vs an average D-I opponent on a neutral floor" },
  { label: "ORTG", total: "a_ortg",  pct: "a_ortg",  sortKey: "a_ortg",  fmt: "num1", title: "Schedule-adjusted offensive rating — points scored per 100 possessions" },
  { label: "DRTG", total: "a_drtg",  pct: "a_drtg",  sortKey: "a_drtg",  fmt: "num1", lowerBetter: true, title: "Schedule-adjusted defensive rating — points allowed per 100 possessions (lower is better)" },
  { label: "SOS",  total: "adj_sos", pct: "adj_sos", sortKey: "adj_sos", fmt: "num1", title: "Strength of schedule — average opponent adjusted net rating" },
  { label: "PACE", total: "cbb_pace", pct: "cbb_pace", sortKey: "cbb_pace", fmt: "num1", title: "Possessions per game" },
];

export const FOUR_FACTOR_COLS: TeamCol[] = [
  { label: "REB",  total: "reb_diff_ct",  perGame: "reb_diff_pg",   pct: "reb_diff_pg",   sortKey: "reb_diff_ct",  fmt: "signed", title: "Rebounds − opponent rebounds" },
  { label: "3PM",  total: "fg3m_diff_ct", perGame: "fg3m_diff_pg",  pct: "fg3m_diff_pg",  sortKey: "fg3m_diff_ct", fmt: "signed", title: "3-pointers made − allowed" },
  { label: "FBP",  total: "fbpts_diff",   perGame: "fbpts_diff_pg", pct: "fbpts_diff_pg", sortKey: "fbpts_diff",   fmt: "signed", title: "Fast-break points − allowed. The season total needs 90% of games to have tracked the split, so it is blank on older seasons where the per-game figure still stands." },
  { label: "TOV",  total: "tov_diff_ct",  perGame: "tov_diff_pg",   pct: "tov_diff_pg",   sortKey: "tov_diff_ct",  fmt: "signed", lowerBetter: true, title: "Turnovers − opponent turnovers (negative is good)" },
];

export const SHOOTING_COLS: TeamCol[] = [
  { label: "eFG%",  total: "cbb_efg",     pct: "cbb_efg",     sortKey: "cbb_efg",     fmt: "pct1", title: "Effective field-goal % — (FGM + 0.5 × 3PM) / FGA" },
  { label: "3P%",   total: "cbb_fg3",     pct: "cbb_fg3",     sortKey: "cbb_fg3",     fmt: "pct1", title: "3-point %" },
  { label: "3PAR",  total: "cbb_fg3rate", pct: "cbb_fg3rate", sortKey: "cbb_fg3rate", fmt: "pct1", title: "3-point attempt rate — 3PA / FGA, how much of the offense comes from deep" },
  { label: "FT%",   total: "cbb_ft",      pct: "cbb_ft",      sortKey: "cbb_ft",      fmt: "pct1", title: "Free-throw %" },
  { label: "FTAR",  total: "cbb_ftarate", pct: "cbb_ftarate", sortKey: "cbb_ftarate", fmt: "pct1", title: "Free-throw attempt rate — FTA / FGA, how often the team gets to the line" },
];

export const DEFAULT_COLS = [...RATING_COLS, ...FOUR_FACTOR_COLS, ...SHOOTING_COLS];
const DEFAULT_COL_BY_KEY = new Map(DEFAULT_COLS.map((c) => [c.total as string, c]));

/**
 * Build a renderable column for a stat the reader pinned in the filter drawer.
 *
 * When the stat is already a default column we reuse that definition verbatim,
 * so a pinned REB Diff arrives with its per-game sub-figure and its chip keyed
 * to reb_diff_pg — a hand-rolled copy would quietly drop both. Everything else
 * is synthesized from the shared TEAM_STAT_COLUMNS metadata.
 */
export function pinnedColumn(key: string): TeamCol | null {
  const reuse = DEFAULT_COL_BY_KEY.get(key);
  if (reuse) return reuse;
  const meta = TEAM_STAT_COLUMNS.find((c) => c.key === key);
  if (!meta) return null;
  const fmt: TeamCol["fmt"] =
    meta.format === "pct1" ? "pct1"
      : meta.format === "int" ? "int"
      // Everything in the diffs group is a margin, so it reads with a sign.
      : meta.group === "diffs" ? "signed"
      : "num1";
  return {
    label: meta.label,
    total: key as keyof TeamRow,
    pct: key,
    sortKey: key,
    lowerBetter: isLowerBetter(key),
    fmt,
    title: meta.desc,
  };
}

/** A renderable column, flattened for the exporter. */
export function toExportCol(c: TeamCol, band: string): ExportCol {
  return {
    label: c.label,
    total: c.total as string,
    perGame: c.perGame as string | undefined,
    pct: c.pct,
    fmt: c.fmt,
    band,
  };
}

/**
 * The export columns for ANY view, not just the one on screen.
 *
 * The pinned columns lead and are de-duplicated against that view's own keys —
 * the same rule the table applies — so a stat filtered on shows up exactly
 * once on every tab, under "Your columns" where the view does not already
 * carry it and in its proper band where it does.
 */
export function exportColsForView(v: TableView, pinned: readonly string[]): ExportCol[] {
  const viewKeys = new Set<string>(v.bands.flatMap((b) => b.keys as string[]));
  const out: ExportCol[] = [];
  for (const k of pinned) {
    if (viewKeys.has(k)) continue;
    const c = pinnedColumn(k);
    if (c) out.push(toExportCol(c, "Your columns"));
  }
  for (const b of v.bands) {
    for (const k of b.keys) {
      const c = pinnedColumn(k);
      if (c) out.push(toExportCol(c, b.label));
    }
  }
  return out;
}

export function fmtColValue(v: number | null | undefined, fmt: TeamCol["fmt"]): string {
  if (v === null || v === undefined) return "—";
  if (fmt === "int") return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (fmt === "pct1") return (v * 100).toFixed(1) + "%";
  if (fmt === "signed") return (v > 0 ? "+" : "") + v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
