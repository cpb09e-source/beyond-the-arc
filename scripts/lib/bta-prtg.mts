/**
 * BTA PRTG formula — single source of truth used by both the full export
 * (scripts/export-static-data.mts) and the fast portal-only re-aggregation
 * (scripts/export-portal-only.mts). Modify the formula HERE and both scripts
 * pick it up on the next run.
 *
 * Mirror the client-side computations in:
 *   - src/components/players/players-client.tsx :: attachBtaIndOrtg
 *   - src/components/teams/team-page-view.tsx   :: computeYearMetrics
 * if you change the formula. (Those compute live in the browser / at SSG time
 * from on-disk JSON and don't share code with these scripts.)
 *
 * Conference tier multipliers live in src/lib/conf-tiers.ts and are imported
 * by all three sites.
 */

export { POWER_CONFS } from "../../src/lib/conf-tiers.ts";
import { confMultiplier, topTeamMultiplier, top5Tier1Multiplier, top3InConfMultiplier } from "../../src/lib/conf-tiers.ts";

/**
 * Fixed BTA PRTG cutoffs for portal star tiers. Replaces the old percentile
 * buckets — cleaner because a transfer's tier no longer drifts as other
 * transfers enter or leave the portal.
 *   5★ ≥ 50.0
 *   4★ 23.5 – 49.9
 *   3★ 14.6 – 23.4
 *   2★ 7.2 – 14.5
 *   1★ everything else (still subject to GP/MPG/PPG baseline before scoring)
 */
export function starsForPrtg(bta: number): 1 | 2 | 3 | 4 | 5 {
  if (bta >= 50.0) return 5;
  if (bta >= 23.5) return 4;
  if (bta >= 14.6) return 3;
  if (bta >= 7.2) return 2;
  return 1;
}

export type PlayerSeason = {
  year: number;
  team_name: string;
  team_conference: string | null;
  class: string | null;
  raw_row: unknown;
  games: number | null;
  notes: string | null;
  projection: number | null;
};

export type CohortStats = {
  pirMean: number;
  pirSd: number;
  porMean: number;
  porSd: number;
  // Map<bartId, percentile 0..100> for the player's WORSE-OF TS% / eFG%
  // percentile within their position bucket. Drives the volume-shooter
  // penalty. Players with no position note or no efficiency stats are
  // absent from the map; their penalty resolves to 0.
  effPositionPctile: Map<number, number>;
};

// Position bucket mapping. Mirrors src/components/players/players-client.tsx
// and src/components/teams/team-page-view.tsx — keep these in sync.
const BUCKET_BY_NOTE: Record<string, "G" | "F" | "C"> = {
  "Pure PG": "G", "Scoring PG": "G", "Combo G": "G", "Wing G": "G",
  "Wing F": "F", "Stretch 4": "F",
  "PF/C": "C", "C": "C",
};

// Volume-shooter penalty — punish high-PPG / low-efficiency scorers, where
// "efficiency" = worst-of(TS%-pctile, eFG%-pctile) within position bucket.
// Catches both pure brick-throwers and FT-line-inflated scorers (Jahmir
// Young archetype: 90% FT props up TS while eFG sits at 25th pctile).
//   ppgFactor: 0 at ≤12 PPG, 1 at ≥20 PPG
//   effFactor: 0 at ≥40th-percentile efficiency, 1 at ≤10th
// Max: −8 BTA points. Applied AFTER multipliers as a flat adjustment.
export function volumeShooterPenalty(ppg: number | null, effPositionPctile: number | null): number {
  if (ppg == null || effPositionPctile == null) return 0;
  const ppgFactor = Math.max(0, Math.min(1, (ppg - 12) / 8));
  const effFactor = Math.max(0, Math.min(1, (40 - effPositionPctile) / 30));
  return -8 * ppgFactor * effFactor;
}

export type ProductionResult = {
  last_year: number;
  last_team: string;
  last_conf: string | null;
  gp: number | null;
  mpg: number | null;
  ppg: number | null;
  rpg: number | null;
  apg: number | null;
  spg: number | null;
  bpg: number | null;
  pir: number | null;
  bta_portg: number | null;
};

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") { const n = Number(v); return Number.isFinite(n) ? n : null; }
  return null;
}
function fromEnd(row: unknown, off: number): number | null {
  if (!Array.isArray(row) || row.length <= off) return null;
  return num(row[row.length - 1 - off]);
}
function fromStart(row: unknown, idx: number): number | null {
  if (!Array.isArray(row) || row.length <= idx) return null;
  return num(row[idx]);
}
function pirOfRow(row: unknown): number | null {
  const pts = fromEnd(row, 3);
  const reb = fromEnd(row, 7);
  const ast = fromEnd(row, 6);
  const stl = fromEnd(row, 5);
  const blk = fromEnd(row, 4);
  if (pts === null || reb === null || ast === null || stl === null || blk === null) return null;
  const missedFg = fromStart(row, 52) ?? 0;
  const missedFt = fromStart(row, 44) ?? 0;
  return pts + reb + ast + stl + blk - missedFg - missedFt;
}
// Second component of the BTA PRTG z-blend: Bart Torvik's PORPAG (Points Over
// Replacement Per Adjusted Game), column 28 of the player raw row.
function porpagOfRow(row: unknown): number | null { return fromStart(row, 28); }
function mpgOfRow(row: unknown): number | null { return fromStart(row, 54); }
// Volume-shooter penalty inputs — must match the live attachBtaIndOrtg in
// src/components/players/players-client.tsx so the BTA PRTG stored in
// player-ranks JSONs (and shown on the Player Overview card) matches what
// users see on the /players leaderboard. The live page computes both
// metrics from raw box-score counts rather than reading Bart's pre-computed
// `raw_row[7]/[8]` cells, and pairs TS% with **FG%** (not eFG%) when picking
// the worst-of percentile for the penalty.
function fg2MadeOfRow(row: unknown): number | null { return fromStart(row, 16); }
function fg2AttOfRow(row: unknown): number | null { return fromStart(row, 17); }
function fg3MadeOfRow(row: unknown): number | null { return fromStart(row, 19); }
function fg3AttOfRow(row: unknown): number | null { return fromStart(row, 20); }
function ftAttOfRow(row: unknown): number | null { return fromStart(row, 14); }
function fgPctOfRow(row: unknown): number | null {
  const m2 = fg2MadeOfRow(row); const m3 = fg3MadeOfRow(row);
  const a2 = fg2AttOfRow(row);  const a3 = fg3AttOfRow(row);
  if (m2 == null || m3 == null || a2 == null || a3 == null) return null;
  const made = m2 + m3, att = a2 + a3;
  return att > 0 ? made / att : null;
}
function tsOfRow(row: unknown, games: number | null, ppg: number | null): number | null {
  // TS% = PTS / (2 × (FGA + 0.44 × FTA)). Uses season totals — ppg × games
  // for points, full-season FGA / FTA from the boxscore columns.
  const a2 = fg2AttOfRow(row); const a3 = fg3AttOfRow(row); const fta = ftAttOfRow(row);
  if (a2 == null || a3 == null || fta == null || games == null || ppg == null) return null;
  const fga = a2 + a3;
  const denom = 2 * (fga + 0.44 * fta);
  return denom > 0 ? (ppg * games) / denom : null;
}
// Bart's position note lives at the third-from-end column of raw_row, but we
// also pass the parsed `notes` field on PlayerSeason directly. Helper that
// prefers the parsed field.
function bucketOf(notes: string | null): "G" | "F" | "C" | null {
  return notes ? (BUCKET_BY_NOTE[notes] ?? null) : null;
}

/**
 * Build per-year mean/sd over the eligible D-I cohort. Eligibility matches
 * the players-page baseline filter (excluded if GP<8 AND MPG<10 AND PPG<3).
 */
export function computeCohortStats(
  playersByBartId: Map<number, PlayerSeason[]>,
): Map<number, CohortStats> {
  type EffEntry = { id: number; ts: number | null; eFg: number | null; strict: boolean };
  type Bag = {
    pir: number[];
    por: number[];
    // Loose-eligible (bartId, ts, eFg, strict) tuples bucketed by position.
    // We rank TS and eFG within each bucket against the STRICT cohort's
    // sorted distribution (18g / 20mpg / 5.3ppg — matches the profile's SHOOTING
    // chips), then look up each loose-eligible player's percentile via
    // binary search. Per-player effPositionPctile = worst of (TS, eFG).
    byBucket: { G: EffEntry[]; F: EffEntry[]; C: EffEntry[] };
  };
  const bags = new Map<number, Bag>();
  for (const [bartId, seasons] of playersByBartId.entries()) {
    for (const s of seasons) {
      const row = s.raw_row;
      const games = s.games;
      const mpg = mpgOfRow(row);
      const ppg = fromEnd(row, 3);
      // Leaderboard floor: hide players with <8 games OR <3.5 PPG. Stricter
      // than the previous AND-style filter — keeps deep-bench players off
      // the table entirely.
      const eligible = (games ?? 0) >= 8 && (ppg ?? 0) >= 3.5;
      if (!eligible) continue;
      let bag = bags.get(s.year);
      if (!bag) { bag = { pir: [], por: [], byBucket: { G: [], F: [], C: [] } }; bags.set(s.year, bag); }
      const pir = pirOfRow(row);
      const por = porpagOfRow(row);
      if (pir !== null) bag.pir.push(pir);
      if (por !== null) bag.por.push(por);
      const ts = tsOfRow(row, games, ppg);
      const eFg = fgPctOfRow(row);  // Note: variable name kept for downstream compat; this is FG%, not eFG%.
      const bucket = bucketOf(s.notes);
      const strict = (games ?? 0) >= 18 && (mpg ?? 0) >= 20 && (ppg ?? 0) >= 5.3;
      if (bucket && (ts !== null || eFg !== null)) bag.byBucket[bucket].push({ id: bartId, ts, eFg, strict });
    }
  }
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const sd = (a: number[], mu: number) => Math.sqrt(a.reduce((s, v) => s + (v - mu) ** 2, 0) / a.length);
  const out = new Map<number, CohortStats>();
  for (const [year, bag] of bags.entries()) {
    const pMu = bag.pir.length ? mean(bag.pir) : 0;
    const pSd = bag.pir.length ? sd(bag.pir, pMu) : 0;
    const oMu = bag.por.length ? mean(bag.por) : 0;
    const oSd = bag.por.length ? sd(bag.por, oMu) : 0;
    const effPositionPctile = new Map<number, number>();
    for (const bucket of ["G", "F", "C"] as const) {
      const arr = bag.byBucket[bucket];
      const strictArr = arr.filter((e) => e.strict);
      function rankerFor(metric: (e: EffEntry) => number | null): (v: number) => number | null {
        const sorted = strictArr
          .map(metric)
          .filter((v): v is number => v !== null)
          .sort((a, b) => a - b);
        const n = sorted.length;
        if (n < 2) return () => null;
        return (v: number) => {
          let lo = 0, hi = n;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (sorted[mid]! < v) lo = mid + 1;
            else hi = mid;
          }
          return Math.max(0, Math.min(100, Math.round((lo / (n - 1)) * 100)));
        };
      }
      const tsRanker = rankerFor((e) => e.ts);
      const fgRanker = rankerFor((e) => e.eFg);
      for (const e of arr) {
        const t = e.ts !== null ? tsRanker(e.ts) : null;
        const f = e.eFg !== null ? fgRanker(e.eFg) : null;
        if (t == null && f == null) continue;
        effPositionPctile.set(e.id, t == null ? f! : f == null ? t : Math.min(t, f));
      }
    }
    out.set(year, { pirMean: pMu, pirSd: pSd, porMean: oMu, porSd: oSd, effPositionPctile });
  }
  return out;
}

/**
 * Look up a Bart player's most-recent season and compute production stats +
 * BTA PRTG. Formula:
 *   avg(0.69 × z(PIR), z(PORPAG))
 *     × 20
 *     × confMultiplier(conf)         // +19 % Tier 1 → −23 % Tier 5
 *     × topTeamMultiplier(team)      // +8 % if top-32 D-I team for 2025-26
 *     × top5Tier1Multiplier(team)    // +6 % if top-5 in a Tier 1 conference
 *     × top3InConfMultiplier(team)   // +6 % if top-3 in any conference by record
 * PIR is weighted at 69 % (31 % reduction) because raw PIR over-rewards
 * high-usage scorers. See src/lib/conf-tiers.ts for the constants.
 */
export function productionFor(
  bartId: number,
  playersByBartId: Map<number, PlayerSeason[]>,
  yearCohortStats: Map<number, CohortStats>,
): ProductionResult | null {
  const seasons = playersByBartId.get(bartId);
  if (!seasons || seasons.length === 0) return null;
  const latest = seasons[0]!; // newest year first
  const row = latest.raw_row;
  const pts = fromEnd(row, 3);
  const reb = fromEnd(row, 7);
  const ast = fromEnd(row, 6);
  const stl = fromEnd(row, 5);
  const blk = fromEnd(row, 4);
  const missedFg = fromStart(row, 52);
  const missedFt = fromStart(row, 44);
  const mins = fromStart(row, 54);
  const pir = (pts !== null && reb !== null && ast !== null && stl !== null && blk !== null)
    ? pts + reb + ast + stl + blk - (missedFg ?? 0) - (missedFt ?? 0)
    : null;
  const porpag = fromStart(row, 28);
  const stats = yearCohortStats.get(latest.year);
  let bta_portg: number | null = null;
  if (stats) {
    const zs: number[] = [];
    if (typeof pir === "number" && stats.pirSd > 0) zs.push(((pir - stats.pirMean) / stats.pirSd) * 0.69);
    if (typeof porpag === "number" && stats.porSd > 0) zs.push((porpag - stats.porMean) / stats.porSd);
    if (zs.length > 0) {
      const raw = (zs.reduce((s, v) => s + v, 0) / zs.length) * 20;
      const base =
        raw
        * confMultiplier(latest.team_conference)
        * topTeamMultiplier(latest.team_name)
        * top5Tier1Multiplier(latest.team_name)
        * top3InConfMultiplier(latest.team_name);
      bta_portg = base + volumeShooterPenalty(pts, stats.effPositionPctile.get(bartId) ?? null);
    }
  }
  return {
    last_year: latest.year,
    last_team: latest.team_name,
    last_conf: latest.team_conference,
    gp: latest.games,
    mpg: mins,
    ppg: pts,
    rpg: reb,
    apg: ast,
    spg: stl,
    bpg: blk,
    pir,
    bta_portg,
  };
}
