/**
 * The Player Explorer's per-season pass: packed rows in, rated and ranked
 * players out.
 *
 * MOVED OUT OF src/components/players/players-client.tsx, unchanged, so the
 * site and the desktop app run ONE implementation. It used to live inside the
 * page component, where nothing else could import it, and the alternative was
 * a second copy in the app. Two copies of a percentile rule drift the first
 * time one of them learns something; the BTA rating was computed in two places
 * and ended up disagreeing by up to 48 places in the same season.
 *
 * WHAT A SEASON GOES THROUGH, in order:
 *
 *   1. Rows expand into PlayerSummary objects, with the late fields defaulted.
 *   2. Impact attaches by bart id: the real RAPM fit where the season has one,
 *      else the box-score estimate on the ARC scale (the `_s` copies).
 *   3. The box half of EPM attaches from its own file, so the component and
 *      the blend never point at the same numbers.
 *   4. The shooting profile attaches (filter-only fields).
 *   5. Percentiles are ranked over the ELIGIBLE pool: past the leaderboard
 *      floor, before any reader filter, so a chip never moves because someone
 *      else was filtered out.
 */

import { midrankPercentileMap } from "@/lib/percentile";
import type { PlayerSummary } from "@/lib/players";

/**
 * One season of the explorer's packed payload.
 *
 * `fields` is read from the file rather than assumed, so the builder owns the
 * column order and the two cannot drift apart silently.
 */
export type ExplorerPayload = {
  fields: string[];
  rows: Array<Array<string | number | null>>;
};

/**
 * Possessions a player needs before their raw on-off is worth printing.
 *
 * Matches MIN_POSS in export-epm-json.mjs, which already treats 300 as the
 * point below which "the RAPM is mostly shrinkage". Unregularized on-off is
 * noisier still, so the same floor is the least it should carry.
 */
export const MIN_ON_OFF_POSS = 300;

/** Fields attached after load, from the EPM and shooting files. */
const LATE_FIELDS = {
  epm: null, off_epm: null, def_epm: null, epm_estimated: false, epm_covered: false,
  box_epm: null, poss: null,
  ewins: null, on_off: null,
  rim_pct: null, mid_pct: null, assisted_pct: null, rim_rate: null, tp_rate: null,
} as const;

/**
 * Payload rows -> PlayerSummary objects.
 *
 * A fresh object every call, deliberately: the season pass mutates what it is
 * given (EPM, shooting and percentiles are attached in place), so callers that
 * keep payloads in state keep them immutable by expanding here.
 */
export function expandRows(payload: ExplorerPayload): PlayerSummary[] {
  const { fields, rows } = payload;
  return rows.map((row) => {
    const o: Record<string, unknown> = { ...LATE_FIELDS };
    for (let i = 0; i < fields.length; i++) o[fields[i]!] = row[i] ?? null;
    return o as unknown as PlayerSummary;
  });
}

// Position bucket from Bart's position note. Mirrors the mapping in
// scripts/compute-player-ranks.mts so the volume-shooter penalty's
// "compared to their position" cohort matches the player-profile rank
// section. Keep these in sync.
const BUCKET_BY_NOTE: Record<string, "G" | "F" | "C"> = {
  "Pure PG": "G", "Scoring PG": "G", "Combo G": "G", "Wing G": "G",
  "Wing F": "F", "Stretch 4": "F",
  // Height-derived dual-eligibility notes for 2008-09 (see derive-positions.mts).
  "G/F": "G", "F/G": "F", "C/F": "C",
  "PF/C": "C", "C": "C",
};

export function positionBucket(note: string | null | undefined): "G" | "F" | "C" | null {
  return note ? (BUCKET_BY_NOTE[note] ?? null) : null;
}

// Leaderboard visibility floor: hide players with <8 games OR <3.5 PPG.
// Stricter than the previous AND-style filter — keeps deep-bench cameos
// off the leaderboard entirely. Players above this floor but below the
// strict 18g / 20mpg / 5.3ppg cohort still appear and are ranked against
// the cohort's distribution via binary search.
export function isBelowBaseline(p: PlayerSummary): boolean {
  const gp = p.games ?? 0;
  const ppg = p.pts_pg ?? 0;
  return gp < 8 || ppg < 3.5;
}

/**
 * Whether a player belongs on the leaderboard at a minimum games count.
 *
 * The three rules the explorer applies before any reader filter: the baseline
 * floor, the games minimum, and "no EPM, no row" in seasons that HAVE EPM.
 * Players under the 13 mpg floor are deliberately absent from the fit, and a
 * leaderboard built around impact should not list players it cannot rate. They
 * stay everywhere else: search, team pages, rosters and their own profile.
 */
export function passesLeaderboardFloor(p: PlayerSummary, minGames: number): boolean {
  if (isBelowBaseline(p)) return false;
  if (p.epm_covered && p.epm === null) return false;
  return (p.games ?? 0) >= minGames;
}

// Chip-bearing stats. TOV inverts (fewer turnovers = higher percentile).
export const PCT_KEYS = [
  "pir", "fg_pct", "fg3_pct", "ts_pct",
  "epm", "off_epm", "def_epm", "usage_pct", "pts_pg",
  "orb_pg", "drb_pg", "reb_pg", "ast_pg", "tov_pg", "tov_pct", "stl_pg", "blk_pg", "hkm_pct",
  // Filterable extras that can appear as dynamic columns:
  "efg_pct", "fg2_pct", "ft_pct", "fta_rate", "ast_to_tov", "porpag", "bta_porpag", "min_pg", "ppp",
  "ewins",
] as const;
export type PctKey = (typeof PCT_KEYS)[number];
export type PctMaps = Record<PctKey, Map<number, number>>;
const INVERTED_PCT = new Set<PctKey>(["tov_pg", "tov_pct"]);

// Per-season percentile rank for each chip-bearing stat. Computed across the
// eligible D-I pool (post-baseline, pre-filter) so chips remain meaningful
// when filters narrow the visible list. Higher value = higher percentile.
export function attachPercentiles(players: PlayerSummary[]): PctMaps {
  const out = Object.fromEntries(PCT_KEYS.map((k) => [k, new Map<number, number>()])) as PctMaps;
  for (const key of PCT_KEYS) {
    // Ties share a percentile — see src/lib/percentile.ts. Sorted position gave
    // two players with the same number different chips, which on a leaderboard
    // of thousands happens constantly.
    //
    // INVERSION IS PASSED IN rather than applied as 100 - pct afterwards. The
    // two are not the same once ties exist: flipping a midrank after the fact
    // is correct only when the block is symmetric about the middle, and the
    // ranker already knows how to sort the other way.
    out[key] = midrankPercentileMap(
      players.map((p) => [p.id, p[key] as number | null | undefined] as const),
      !INVERTED_PCT.has(key),
    );
  }
  return out;
}

/** One player in an impact file, keyed by bart id. */
export type ImpactEntry = {
  epm: number;
  off: number;
  def: number;
  poss?: number | null;
  ewins?: number | null;
  on_off?: number | null;
  /** ARC-scaled copies, present only on ESTIMATED (box-score) seasons. */
  epm_s?: number | null;
  off_s?: number | null;
  def_s?: number | null;
};

/**
 * A season's impact: the real play-by-play fit, or the box-score estimate for
 * seasons without one. `estimated` marks the second, for the UI marker.
 */
export type ImpactSeason = { players: Record<string, ImpactEntry>; estimated: boolean };

type ImpactFile = { players?: Record<string, ImpactEntry> } | null | undefined;

/** Whether an impact file actually rates anybody. An empty fit is no fit. */
export function hasImpactPlayers(file: ImpactFile): boolean {
  return !!file && Object.keys(file.players ?? {}).length > 0;
}

/**
 * Which impact a season uses: the real play-by-play fit when it rates anybody,
 * otherwise the box-score estimate, otherwise nothing.
 *
 * A LOADING RULE, kept here with the pass that consumes it, so the site and the
 * desktop app cannot disagree about which file a season's EPM came from.
 */
export function impactFromFiles(realFit: ImpactFile, estimate: ImpactFile): ImpactSeason {
  if (realFit && hasImpactPlayers(realFit)) return { players: realFit.players ?? {}, estimated: false };
  if (estimate) return { players: estimate.players ?? {}, estimated: true };
  return { players: {}, estimated: false };
}

/** The box half of EPM, by bart id. */
export type BoxEntry = { epm: number; off: number; def: number };

/** The shooting profile, by bart id. Filter-only. */
export type ShootingEntry = {
  rim_pct: number | null;
  mid_pct: number | null;
  asst: number | null;
  rim_rate: number | null;
  tp_rate: number | null;
};

/**
 * One season's cohort: every player, with impact and shooting attached, and the
 * percentile maps ranked over the eligible pool.
 */
export function processPlayerSeason(
  raw: ExplorerPayload,
  impact: ImpactSeason | undefined,
  box: Record<string, BoxEntry> | undefined,
  shooting: Record<string, ShootingEntry> | undefined,
): { players: PlayerSummary[]; pctMaps: PctMaps } {
  const arr = expandRows(raw);
  // Does this season have EPM at all? Below the 13 mpg floor the fit is
  // essentially the prior, so those players are omitted from the file rather
  // than published as a shrunk-to-zero number, and the explorer hides them
  // (see passesLeaderboardFloor). This flag is what keeps that from emptying
  // the table for a season whose EPM was never built: no coverage, no hiding.
  const seasonHasEpm = !!impact && Object.keys(impact.players).length > 0;
  for (const p of arr) p.epm_covered = seasonHasEpm;
  if (impact) {
    for (const p of arr) {
      const e = p.bart_player_id != null ? impact.players[String(p.bart_player_id)] : undefined;
      if (e) {
        // On estimated seasons prefer the EPM-SCALED copy. Box-EPM is a shrunk
        // prediction of ARC and lives on roughly half its spread, so showing it
        // raw in the ARC column put two different units on one axis, and no
        // pre-play-by-play season could ever place on an all-seasons board.
        // export-box-epm-json.mjs fits the mapping on the seasons where both
        // exist. Real fits have no _s fields and fall through unchanged.
        p.epm = e.epm_s ?? e.epm;
        p.off_epm = e.off_s ?? e.off;
        p.def_epm = e.def_s ?? e.def;
        p.epm_estimated = impact.estimated;
        p.ewins = e.ewins ?? null;
        p.poss = e.poss ?? null;
        // On-off is raw and unregularized: Juan Reyna reads +89.5 on four
        // possessions. Published only above a floor, because a number that
        // wrong is worse than no number.
        p.on_off = typeof e.poss === "number" && e.poss >= MIN_ON_OFF_POSS ? e.on_off ?? null : null;
      }
    }
  }
  // Box half of EPM, from its own file so it stays distinct from the blend.
  if (box) {
    for (const p of arr) {
      const b = p.bart_player_id != null ? box[String(p.bart_player_id)] : undefined;
      if (b) p.box_epm = b.epm;
    }
  }
  // Shooting profile (filter-only fields).
  if (shooting) {
    for (const p of arr) {
      const s = p.bart_player_id != null ? shooting[String(p.bart_player_id)] : undefined;
      if (s) {
        p.rim_pct = s.rim_pct;
        p.mid_pct = s.mid_pct;
        p.assisted_pct = s.asst;
        p.rim_rate = s.rim_rate;
        p.tp_rate = s.tp_rate;
      }
    }
  }
  const eligible = arr.filter((p) => !isBelowBaseline(p));
  return { players: arr, pctMaps: attachPercentiles(eligible) };
}
