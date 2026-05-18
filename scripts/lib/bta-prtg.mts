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
};

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
function porpagOfRow(row: unknown): number | null { return fromStart(row, 28); }
function mpgOfRow(row: unknown): number | null { return fromStart(row, 54); }

/**
 * Build per-year mean/sd over the eligible D-I cohort. Eligibility matches
 * the players-page baseline filter (excluded if GP<8 AND MPG<10 AND PPG<3).
 */
export function computeCohortStats(
  playersByBartId: Map<number, PlayerSeason[]>,
): Map<number, CohortStats> {
  const bags = new Map<number, { pir: number[]; por: number[] }>();
  for (const [, seasons] of playersByBartId.entries()) {
    for (const s of seasons) {
      const row = s.raw_row;
      const games = s.games;
      const mpg = mpgOfRow(row);
      const ppg = fromEnd(row, 3);
      const eligible = !((games ?? 0) < 8 && (mpg ?? 0) < 10 && (ppg ?? 0) < 3);
      if (!eligible) continue;
      let bag = bags.get(s.year);
      if (!bag) { bag = { pir: [], por: [] }; bags.set(s.year, bag); }
      const pir = pirOfRow(row);
      const por = porpagOfRow(row);
      if (pir !== null) bag.pir.push(pir);
      if (por !== null) bag.por.push(por);
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
    out.set(year, { pirMean: pMu, pirSd: pSd, porMean: oMu, porSd: oSd });
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
      bta_portg =
        raw
        * confMultiplier(latest.team_conference)
        * topTeamMultiplier(latest.team_name)
        * top5Tier1Multiplier(latest.team_name)
        * top3InConfMultiplier(latest.team_name);
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
