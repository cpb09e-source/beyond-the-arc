/**
 * The Player Explorer's grid: a view's columns and bands from either stat
 * catalog, a column for a stat a reader pins, the columns flattened for a
 * download, how a cell prints, and which field a sort key orders.
 *
 * Moved out of src/components/players/players-client.tsx, unchanged, so the
 * desktop app builds its table from the same definitions.
 */
import { PLAYER_STAT_COLUMNS, type PlayerSummary } from "@/lib/players";
import type { PlayerView } from "@/lib/player-views";
import { PACK_STAT_BY_KEY, type IndexedPack } from "@/lib/player-stat-pack";
import { PCT_KEYS, type PctKey } from "@/lib/player-cohort";
import type { ExportCol } from "@/lib/table-export";

// ---- Grouped stat-band grid (see docs/players-grid-rebuild-spec.md) ----
// One entry per data column. `pct` names the percentile map feeding the chip
// (null = no chip, e.g. MPG). `band` marks the EPM trio for the coral wash.
export type GridFmt = "num1" | "num2" | "pct1" | "pct100" | "int" | "epm";
export type GridCol = {
  label: string;
  /**
   * Where the number comes from. Exactly one of these is set.
   *
   * `field` reads PlayerSummary, which is what every column did before the
   * stat pack existed. `packKey` reads a lazily-fetched group file — see
   * src/lib/player-stat-pack.ts — and those columns carry their percentile
   * with them rather than having one computed here, because the pack's cohort
   * is not the same as the table's (per-40 stats rank only over players past a
   * minutes floor).
   */
  field?: keyof PlayerSummary;
  packKey?: string;
  fmt: GridFmt;
  pct: PctKey | null;
  sortKey?: string;
  band?: boolean;
  /** Raw count, no chip — milestone counts and technicals. */
  noPct?: boolean;
  /** Tooltip on the column header. */
  desc?: string;
};
// GRID_COLS, GRID_BANDS and GRID_FIELDS used to live here: one hardcoded
// seventeen-column table, with a parallel list of band spans that had to be
// kept in step by hand.
//
// Both are now derived from a view — the default table is PLAYER_VIEWS's
// "overview", declared column for column as it shipped — so the spans cannot
// drift from the columns beneath them, and adding a view costs no changes in
// this file. See viewGrid() below.

/**
 * A view's stat keys, flattened into export columns.
 *
 * Mirrors viewGrid below — same walk, same two catalogs, same precedence —
 * but produces the spreadsheet's column model rather than the table's. Kept as
 * a separate function rather than a second use of viewGrid because the file
 * wants a percentile column beside every value, which the table does not.
 */
/**
 * Flatten fetched group files into (season|column) -> player -> value maps.
 *
 * MODULE SCOPE, AND TAKING THE MAP AS AN ARGUMENT, because the export needs
 * the same flattening over packs that are NOT the ones in state. A multi-view
 * download fetches the groups its other sheets need and has to read them
 * immediately — setPacks would not have re-rendered yet, and waiting a render
 * to write a file is a race, not a design.
 */
export function packLookups(packs: Map<string, IndexedPack>) {
  const val = new Map<string, Map<number, number | null>>();
  const pct = new Map<string, Map<number, number | null>>();
  let anyPbpThin = false;
  for (const [key, pk] of packs) {
    const year = key.split("|")[0]!;
    for (const [col, m] of pk.value) val.set(`${year}|${col}`, m);
    for (const [col, m] of pk.pct) pct.set(`${year}|${col}`, m);
    if (pk.pbpCoverage < 0.9) anyPbpThin = true;
  }
  return { val, pct, anyPbpThin };
}

export function exportColsFor(v: PlayerView): ExportCol[] {
  return v.bands.flatMap((band) => band.keys.flatMap((key): ExportCol[] => {
    const summary = PLAYER_STAT_COLUMNS.find((c) => c.key === key);
    if (summary && !summary.filterOnly) {
      // Same test the on-screen grid makes below. Only the stats in PCT_KEYS
      // have a percentile map built for them; naming any other field here
      // produced a header with nothing under it — "GP Pctl" was the visible
      // one, blank in every row of every players export.
      const field = summary.field as string;
      return [{
        label: summary.label, total: field,
        pct: (PCT_KEYS as readonly string[]).includes(field) ? field : "",
        fmt: summary.format === "pct1" ? "pct1" : "num1", band: band.label,
      }];
    }
    const pack = PACK_STAT_BY_KEY.get(key);
    if (!pack) return [];
    return [{
      // A milestone count has no percentile, so it gets no Pctl column — an
      // empty one would read as data we failed to compute.
      label: pack.label, total: pack.key, pct: pack.noPct ? "" : pack.key,
      fmt: pack.format === "pct1" ? "pct1" : pack.format === "int" ? "int" : "num1",
      band: band.label,
    }];
  }));
}

/**
 * A view's stat keys, turned into grid columns and band spans.
 *
 * Keys may name EITHER catalog, and which one decides where the value comes
 * from: PLAYER_STAT_COLUMNS resolves to a PlayerSummary field, PACK_STAT_COLUMNS
 * to a key in a fetched group file. The reader is not shown the difference.
 *
 * BANDS ARE BUILT FROM THE SAME WALK as the columns, so a band's span can never
 * drift out of step with the columns under it — the failure the hardcoded
 * GRID_BANDS list was one edit away from at all times.
 */
export function viewGrid(view: PlayerView): { cols: GridCol[]; bands: Array<{ label: string; span: number; epm?: boolean }> } {
  const cols: GridCol[] = [];
  const bands: Array<{ label: string; span: number; epm?: boolean }> = [];
  for (const band of view.bands) {
    let span = 0;
    for (const key of band.keys) {
      const summary = PLAYER_STAT_COLUMNS.find((c) => c.key === key);
      if (summary && !summary.filterOnly) {
        cols.push({
          label: summary.label,
          field: summary.field,
          fmt: summary.field === "games" ? "int"
            : band.accent && summary.group === "impact" ? "epm"
            : summary.format === "pct1" ? "pct1" : summary.format === "num2" ? "num2" : "num1",
          pct: (PCT_KEYS as readonly string[]).includes(summary.field as string)
            ? (summary.field as PctKey) : null,
          sortKey: SORT_KEY_BY_FIELD.get(summary.field as string) ?? summary.key,
          band: band.accent,
          desc: summary.desc,
        });
        span++;
        continue;
      }
      const pack = PACK_STAT_BY_KEY.get(key);
      if (!pack) continue;
      cols.push({
        label: pack.label,
        packKey: pack.key,
        fmt: pack.format,
        pct: null,
        sortKey: pack.key,
        band: band.accent,
        noPct: pack.noPct,
        desc: pack.desc,
      });
      span++;
    }
    if (span > 0) bands.push({ label: band.label, span, epm: band.accent });
  }
  return { cols, bands };
}

export function fmtGrid(v: number | null, fmt: GridFmt): string {
  if (v === null || v === undefined) return "—";
  switch (fmt) {
    case "int": return String(Math.round(v));
    case "pct1": return (v * 100).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "%";
    case "pct100": return v.toLocaleString("en-US", { maximumFractionDigits: 1 }) + "%";
    case "epm": return (v >= 0 ? "+" : "") + v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    // eWins runs about 0 to 6 across a season, so one decimal collapses the
    // middle of the board into ties.
    case "num2": return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    default: return v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }
}

/**
 * Sort key → the PlayerSummary field it orders on.
 *
 * Module-level because two places need the same answer: applySpec, which does
 * the sorting, and the header, which has to decide whether a pinned column can
 * be sorted at all.
 */
export const SORT_FIELD: Partial<Record<string, keyof PlayerSummary>> = {
  pir: "pir",
  bta_porpag: "bta_porpag",
  pts: "pts_pg", reb: "reb_pg", ast: "ast_pg",
  fg_pct: "fg_pct", fg3_pct: "fg3_pct", ts_pct: "ts_pct",
  games: "games",
  name: "name",
  epm: "epm", off_epm: "off_epm", def_epm: "def_epm", ewins: "ewins", ppp: "ppp",
  min: "min_pg", usage: "usage_pct", orb: "orb_pg", drb: "drb_pg",
  tov: "tov_pg", tov_pct: "tov_pct", stl: "stl_pg", blk: "blk_pg", hkm: "hkm_pct",
  on_off: "on_off", box_epm: "box_epm", net_rtg: "net_rtg", ast_tov: "ast_to_tov",
  fg2_pct: "fg2_pct", ft_pct: "ft_pct", efg_pct: "efg_pct", fta_rate: "fta_rate",
};

/**
 * The same map read backwards: PlayerSummary field → the sort key that orders
 * it.
 *
 * A pinned column used to be matched to a sort key by comparing the stat's own
 * key against VALID_SORTS, and the two lists do not share a vocabulary — the
 * sort layer says "pts", "min", "usage", "gp"; the column layer says "ppg",
 * "mpg", "usg_pct", "games". Nineteen columns therefore rendered as plain text
 * that could not be clicked, even though eleven of them were already fully
 * sortable under another name. Matching on the FIELD is what makes the two
 * vocabularies stop mattering: whatever a stat is called, it resolves to one
 * column of PlayerSummary, and that is what the sort actually reads.
 */
export const SORT_KEY_BY_FIELD = new Map<string, string>(
  (Object.entries(SORT_FIELD) as Array<[string, keyof PlayerSummary]>)
    .map(([sortKey, field]) => [field as string, sortKey]),
);

/**
 * A column for one stat a reader pinned, from either catalog; null for a stat
 * that never becomes a column (the filter-only shooting profile).
 *
 * THE EXPLORER'S OWN RULE, lifted out of its dynamicCols so another table pins
 * the same way. De-duplication against the view stays with the caller, which
 * is the only thing that knows the view.
 */
export function pinnedGridCol(key: string): GridCol | null {
  const col = PLAYER_STAT_COLUMNS.find((c) => c.key === key);
  if (!col) {
    // A PINNED STAT FROM THE PACK. Without this branch the picker could
    // commit ?cols=pitp_share and the table would show nothing for it.
    const pack = PACK_STAT_BY_KEY.get(key);
    if (!pack) return null;
    return { label: pack.label, packKey: pack.key, fmt: pack.format, pct: null, noPct: pack.noPct, sortKey: pack.key, desc: pack.desc };
  }
  if (col.filterOnly) return null;
  return {
    label: col.label,
    field: col.field,
    // games + plus/minus display as whole numbers.
    fmt: col.field === "games" ? "int" : col.format === "pct1" ? "pct1" : "num1",
    pct: (PCT_KEYS as readonly string[]).includes(col.field as string) ? (col.field as PctKey) : null,
    // Sortable when the FIELD this stat displays is one the sort can order on:
    // see SORT_KEY_BY_FIELD.
    sortKey: SORT_KEY_BY_FIELD.get(col.field as string),
  };
}
