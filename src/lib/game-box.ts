/**
 * Per-game team box sidecar — CBBD's /games/teams data joined onto our game
 * logs by scripts/export-game-box-json.mjs.
 *
 *   public/data/game-box-by-year/<season>.json
 *   { season, fields: string[], rows: { [cbba_game_id]: (number|null)[] } }
 *
 * Stored columnar (positional arrays + one shared field list) rather than as
 * objects: repeating 27 key names across ~11k rows was 4.6 MB/season vs 1.5 MB
 * this way, and it parses faster. The `fields` array travels with the file, so
 * this reader maps by name and stays correct even if the export order changes.
 *
 * A sidecar rather than a widening of game-logs-by-year: those log files are
 * ~7.5 MB and are also read by team pages and the "Find a game" modal, neither
 * of which needs any of this.
 *
 * Coverage is ~94-98% of non-exhibition rows. The shortfall is games CBBD's box
 * doesn't carry; those rows simply keep null for every box field, which the
 * filter layer treats as "no match" rather than as a zero.
 */

import type { GameLog } from "@/lib/game-filters";

export type GameBoxFile = {
  season: number;
  fields: string[];
  /** Values are strings for the two label columns (tourney_name, round). */
  rows: Record<string, Array<number | string | null>>;
};

/** Every box-derived key, and how it should be labelled/grouped in the UI. */
export const BOX_FIELDS = [
  // Rate stats — offense
  { key: "ff_efg",       label: "eFG% (box)",     group: "Rates" },
  { key: "ff_ftr",       label: "FT Rate",       group: "Rates" },
  { key: "ff_tov",       label: "TOV%",          group: "Rates", lower: true },
  { key: "ff_orb",       label: "OREB%",         group: "Rates" },
  // Rate stats — defense (what the opponent managed)
  { key: "ff_efg_def",   label: "Opp eFG% (box)", group: "Opponent Rates", lower: true },
  { key: "ff_ftr_def",   label: "Opp FT Rate",   group: "Opponent Rates", lower: true },
  { key: "ff_tov_def",   label: "Opp TOV%",      group: "Opponent Rates" },
  { key: "ff_orb_def",   label: "Opp OREB%",     group: "Opponent Rates", lower: true },
  // Efficiency
  { key: "ortg",         label: "ORtg",          group: "Efficiency" },
  { key: "drtg",         label: "DRtg",          group: "Efficiency", lower: true },
  // These four were previously dead options on the game logs (null in every
  // season). CBBD's box carries the real counts, so they work again.
  { key: "ast_diff",     label: "AST Diff",      group: "Differentials" },
  { key: "stl_diff",     label: "STL Diff",      group: "Differentials" },
  { key: "blk_diff",     label: "BLK Diff",      group: "Differentials" },
  { key: "ft_att_diff",  label: "FTA Diff",      group: "Differentials" },
  { key: "fouls_diff",   label: "Fouls Diff",    group: "Differentials", lower: true },
  // Raw counts
  { key: "ast",          label: "Assists",       group: "Box" },
  { key: "stl",          label: "Steals",        group: "Box" },
  { key: "blk",          label: "Blocks",        group: "Box" },
  { key: "fouls",        label: "Fouls",         group: "Box", lower: true },
  // Game shape
  { key: "largest_lead",     label: "Largest Lead",     group: "Game Shape" },
  { key: "largest_lead_opp", label: "Opp Largest Lead", group: "Game Shape", lower: true },
  { key: "h1_margin",        label: "1st-Half Margin",  group: "Game Shape" },
  { key: "h2_margin",        label: "2nd-Half Margin",  group: "Game Shape" },
  // Yes/no flags. Exposed as 0/1 because the condition row is a numeric
  // comparator — "Conf Game = 1" is conference games only, "= 0" is
  // non-conference. The UI renders these as Any/Yes/No toggles.
  { key: "conf_game",    label: "Conf Game (1=yes)",   group: "Context" },
  { key: "tourney",      label: "NCAA Tournament (1=yes)", group: "Context" },
  { key: "postseason",   label: "NCAA/NIT (1=yes)",     group: "Context" },
] as const;

export type BoxFieldKey = (typeof BOX_FIELDS)[number]["key"];

/**
 * Carried onto each row for DISPLAY only — the box-score modal and the result
 * table's seed/round badges — and deliberately kept out of BOX_FIELDS so they
 * never become filter tiles.
 *
 * Seeds and rounds exist on roughly 1% of rows (NCAA/NIT games only). As
 * filters that sparseness reads as "this never happened"; as badges it reads
 * correctly as "not applicable" and simply renders nothing. Raw counts are
 * excluded for a different reason: the sheet already offers them as
 * differentials, and 10 more near-duplicate tiles would bury the useful ones.
 */
export const BOX_DISPLAY_FIELDS = [
  "poss_box", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta",
  "tov", "oreb", "reb", "seed", "opp_seed", "tourney_name", "round",
  "ap_rank", "opp_ap_rank", "fbpts", "pitp", "pot",
] as const;

/**
 * Merge a season's sidecar onto its game-log rows. Rows with no box entry are
 * returned untouched (all box keys stay undefined).
 */
export function attachGameBox(rows: GameLog[], box: GameBoxFile | null): GameLog[] {
  if (!box?.rows || !Array.isArray(box.fields)) return rows;
  const idx = new Map<string, number>();
  box.fields.forEach((f, i) => idx.set(f, i));

  const keys: string[] = [...BOX_FIELDS.map((f) => f.key), ...BOX_DISPLAY_FIELDS];

  return rows.map((r) => {
    const vals = r.cbba_game_id ? box.rows[r.cbba_game_id] : undefined;
    if (!vals) return r;
    const out: Record<string, number | string | null> = {};
    for (const key of keys) {
      const i = idx.get(key);
      out[key] = i === undefined ? null : vals[i] ?? null;
    }
    return { ...r, ...out } as GameLog;
  });
}
