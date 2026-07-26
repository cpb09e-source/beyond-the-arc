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
  rows: Record<string, Array<number | null>>;
};

/** Every box-derived key, and how it should be labelled/grouped in the UI. */
export const BOX_FIELDS = [
  // Four factors — offense
  { key: "ff_efg",       label: "eFG% (FF)",     group: "Four Factors" },
  { key: "ff_ftr",       label: "FT Rate",       group: "Four Factors" },
  { key: "ff_tov",       label: "TOV%",          group: "Four Factors", lower: true },
  { key: "ff_orb",       label: "OREB%",         group: "Four Factors" },
  // Four factors — defense (what the opponent managed)
  { key: "ff_efg_def",   label: "Opp eFG% (FF)", group: "Four Factors (def)", lower: true },
  { key: "ff_ftr_def",   label: "Opp FT Rate",   group: "Four Factors (def)", lower: true },
  { key: "ff_tov_def",   label: "Opp TOV%",      group: "Four Factors (def)" },
  { key: "ff_orb_def",   label: "Opp OREB%",     group: "Four Factors (def)", lower: true },
  // Efficiency
  { key: "ortg",         label: "ORtg",          group: "Efficiency" },
  { key: "drtg",         label: "DRtg",          group: "Efficiency", lower: true },
  { key: "game_score",   label: "Game Score",    group: "Efficiency" },
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
  // non-conference. Clunky; these want to be dropdowns in the design pass.
  //
  // Seed is deliberately absent: populated for only ~1.2% of rows (NCAA/NIT
  // games), so it would behave like a dead option.
  { key: "conf_game",    label: "Conf Game (1=yes)",   group: "Context" },
  { key: "tourney",      label: "Tourney Game (1=yes)", group: "Context" },
  { key: "postseason",   label: "NCAA/NIT (1=yes)",     group: "Context" },
] as const;

export type BoxFieldKey = (typeof BOX_FIELDS)[number]["key"];

/**
 * Merge a season's sidecar onto its game-log rows. Rows with no box entry are
 * returned untouched (all box keys stay undefined).
 */
export function attachGameBox(rows: GameLog[], box: GameBoxFile | null): GameLog[] {
  if (!box?.rows || !Array.isArray(box.fields)) return rows;
  const idx = new Map<string, number>();
  box.fields.forEach((f, i) => idx.set(f, i));

  return rows.map((r) => {
    const vals = r.cbba_game_id ? box.rows[r.cbba_game_id] : undefined;
    if (!vals) return r;
    const out: Record<string, number | null> = {};
    for (const f of BOX_FIELDS) {
      const i = idx.get(f.key);
      out[f.key] = i === undefined ? null : vals[i] ?? null;
    }
    return { ...r, ...out } as GameLog;
  });
}
