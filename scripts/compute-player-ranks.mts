/**
 * compute-player-ranks.mts — pre-computes every player's percentile rank
 * across ~20 stats, cohorted by year × position bucket (G/F/C). Used by the
 * player profile's "Where they rank best/worst" section.
 *
 * Cohort eligibility: 18+ games, 18+ minutes per game, 5+ points per game.
 *
 * Position bucket is derived from Bart's note (raw_row[64]):
 *   G = Pure PG / Scoring PG / Combo G / Wing G
 *   F = Wing F / Stretch 4
 *   C = PF/C / C
 *
 * For stats where lower-is-better (TOV%, fouls), we flip direction so the
 * percentile reads "ability". A player in the 95th percentile of ball
 * security has the LOWEST turnover rate in their cohort.
 *
 * PIR and BTA PRTG are derived stats — PIR is per-game (PTS+REB+AST+STL+BLK
 * - missedFG - missedFT), BTA PRTG is the production rating computed against
 * the year's D-I cohort. Both reuse the formula from scripts/lib/bta-prtg.mts
 * so the rating definition stays in one place.
 *
 * Output: public/data/player-ranks/<bartId>.json
 *   {
 *     "bartId": 76021,
 *     "seasonRanks": [
 *       {
 *         "year": 2026, "bucket": "G", "cohortSize": 1825,
 *         "stats": {
 *           "pts_pg": { value: 14.7, percentile: 86 },
 *           "ts_pct": { value: 0.602, percentile: 73 },
 *           ...
 *         }
 *       },
 *       ...
 *     ]
 *   }
 *
 * Run with: tsx scripts/compute-player-ranks.mts
 */

import fs from "node:fs/promises";
import path from "node:path";
import { computeCohortStats, type PlayerSeason, type CohortStats } from "./lib/bta-prtg.mts";
import {
  confMultiplier,
  topTeamMultiplier,
  top5Tier1Multiplier,
  top3InConfMultiplier,
} from "../src/lib/conf-tiers.ts";

const PLAYER_DIR = path.resolve("public/data/player");
const OUT_DIR = path.resolve("public/data/player-ranks");

// ---------- Position bucket mapping ----------
const BUCKET_BY_NOTE: Record<string, "G" | "F" | "C"> = {
  "Pure PG": "G", "Scoring PG": "G", "Combo G": "G", "Wing G": "G",
  "Wing F": "F", "Stretch 4": "F",
  "PF/C": "C", "C": "C",
};

type RawCell = string | number | null;
type RawRow = RawCell[] | null;

// ---------- Stat extraction ----------
function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function fromEnd(row: RawRow, offset: number): number | null {
  if (!Array.isArray(row) || row.length <= offset) return null;
  return num(row[row.length - 1 - offset]);
}
function fromStart(row: RawRow, idx: number): number | null {
  if (!Array.isArray(row) || row.length <= idx) return null;
  return num(row[idx]);
}

// ---------- PIR + BTA PRTG ----------
// PIR (per-game) — mirrors pirOfRow in scripts/lib/bta-prtg.mts. Inlined here
// to avoid an export churn on bta-prtg.mts.
function pirFor(row: RawRow): number | null {
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
function porpagOf(row: RawRow): number | null { return fromStart(row, 28); }

// BTA PRTG for a single season — uses year cohort stats + conf/team multipliers,
// matching the formula in scripts/lib/bta-prtg.mts :: productionFor.
function btaPortgFor(season: PlayerSeason, stats: CohortStats | undefined): number | null {
  if (!stats) return null;
  const row = season.raw_row as RawRow;
  const pir = pirFor(row);
  const porpag = porpagOf(row);
  const zs: number[] = [];
  if (typeof pir === "number" && stats.pirSd > 0) zs.push(((pir - stats.pirMean) / stats.pirSd) * 0.69);
  if (typeof porpag === "number" && stats.porSd > 0) zs.push((porpag - stats.porMean) / stats.porSd);
  if (zs.length === 0) return null;
  const raw = (zs.reduce((s, v) => s + v, 0) / zs.length) * 20;
  return raw
    * confMultiplier(season.team_conference)
    * topTeamMultiplier(season.team_name)
    * top5Tier1Multiplier(season.team_name)
    * top3InConfMultiplier(season.team_name);
}

// ---------- Stat list ----------
// `read` receives the eligible season plus that year's cohort stats (used by
// bta_portg). Most reads just look at the row.
type StatDef = {
  key: string;
  label: string;
  read: (season: PlayerSeason, yearStats: CohortStats | undefined) => number | null;
  better: "high" | "low";
};

const STATS: StatDef[] = [
  // Per-game counting
  { key: "pts_pg", label: "PTS/G",       read: (s) => fromEnd(s.raw_row as RawRow, 3),  better: "high" },
  { key: "reb_pg", label: "REB/G",       read: (s) => fromEnd(s.raw_row as RawRow, 7),  better: "high" },
  { key: "ast_pg", label: "AST/G",       read: (s) => fromEnd(s.raw_row as RawRow, 6),  better: "high" },
  { key: "stl_pg", label: "STL/G",       read: (s) => fromEnd(s.raw_row as RawRow, 5),  better: "high" },
  { key: "blk_pg", label: "BLK/G",       read: (s) => fromEnd(s.raw_row as RawRow, 4),  better: "high" },
  // Efficiency / advanced
  { key: "ortg",    label: "ORtg",       read: (s) => num((s.raw_row as RawRow)?.[5]),  better: "high" },
  { key: "usage",   label: "Usage%",     read: (s) => num((s.raw_row as RawRow)?.[6]),  better: "high" },
  { key: "efg_pct", label: "eFG%",       read: (s) => num((s.raw_row as RawRow)?.[7]),  better: "high" },
  { key: "ts_pct",  label: "TS%",        read: (s) => num((s.raw_row as RawRow)?.[8]),  better: "high" },
  { key: "orb_pct", label: "OREB%",      read: (s) => num((s.raw_row as RawRow)?.[9]),  better: "high" },
  { key: "drb_pct", label: "DREB%",      read: (s) => num((s.raw_row as RawRow)?.[10]), better: "high" },
  { key: "ast_pct", label: "AST%",       read: (s) => num((s.raw_row as RawRow)?.[11]), better: "high" },
  { key: "tov_pct", label: "TOV%",       read: (s) => num((s.raw_row as RawRow)?.[12]), better: "low" },   // flip
  { key: "ft_pct",  label: "FT%",        read: (s) => num((s.raw_row as RawRow)?.[15]), better: "high" },
  { key: "fg2_pct", label: "2P%",        read: (s) => num((s.raw_row as RawRow)?.[18]), better: "high" },
  { key: "fg3_pct", label: "3P%",        read: (s) => num((s.raw_row as RawRow)?.[21]), better: "high" },
  { key: "blk_pct", label: "BLK%",       read: (s) => num((s.raw_row as RawRow)?.[22]), better: "high" },
  { key: "stl_pct", label: "STL%",       read: (s) => num((s.raw_row as RawRow)?.[23]), better: "high" },
  // Hakeem Percentage — BLK% + STL%. Both raw fields must be present.
  { key: "hkm_pct", label: "HKM%",       read: (s) => {
      const r = s.raw_row as RawRow;
      const b = num(r?.[22]); const sx = num(r?.[23]);
      return (b == null || sx == null) ? null : b + sx;
    }, better: "high" },
  { key: "ftr",     label: "FT Rate",    read: (s) => num((s.raw_row as RawRow)?.[24]), better: "high" },
  { key: "porpag",  label: "PORPAG",     read: (s) => num((s.raw_row as RawRow)?.[28]), better: "high" },
  // Derived ratings — PIR per game and BTA PRTG (cohort-z-scored production).
  { key: "pir",       label: "PIR",      read: (s) => pirFor(s.raw_row as RawRow),               better: "high" },
  { key: "bta_portg", label: "BTA PRTG", read: (s, yearStats) => btaPortgFor(s, yearStats),      better: "high" },
];

// ---------- Cohort eligibility ----------
const MIN_GAMES = 18;
const MIN_MPG = 18;
const MIN_PPG = 5;

function eligible(season: PlayerSeason): boolean {
  if (!season || !Array.isArray(season.raw_row)) return false;
  const games = num(season.games);
  if (games == null || games < MIN_GAMES) return false;
  const row = season.raw_row as RawRow;
  const mpg = fromStart(row, 54);
  if (mpg == null || mpg < MIN_MPG) return false;
  const ppg = fromEnd(row, 3);
  if (ppg == null || ppg < MIN_PPG) return false;
  return true;
}

function bucketFor(season: PlayerSeason): "G" | "F" | "C" | null {
  if (!Array.isArray(season.raw_row)) return null;
  const note = (season.raw_row as RawRow)?.[64];
  if (typeof note !== "string") return null;
  return BUCKET_BY_NOTE[note] ?? null;
}

// ---------- Main ----------
async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  console.log("📂 scanning player files…");
  const playerFiles = await fs.readdir(PLAYER_DIR);
  const jsonFiles = playerFiles.filter((f) => f.endsWith(".json"));
  console.log(`   ${jsonFiles.length} player files`);

  // bucketKey "year|bucket" → list of { bartId, season }
  const cohorts = new Map<string, { bartId: number; season: PlayerSeason }[]>();
  // For BTA PRTG: bartId → seasons[] (newest first). Mirrors the shape that
  // computeCohortStats() expects.
  const allByBartId = new Map<number, PlayerSeason[]>();
  let totalSeasonsScanned = 0;
  let eligibleSeasons = 0;
  let i = 0;
  for (const f of jsonFiles) {
    i++;
    if (i % 5000 === 0) process.stdout.write(`   ${i}/${jsonFiles.length}\r`);
    const bartId = parseInt(f.replace(".json", ""), 10);
    if (!Number.isFinite(bartId)) continue;
    let p: { seasons?: PlayerSeason[] };
    try { p = JSON.parse(await fs.readFile(path.join(PLAYER_DIR, f), "utf8")); } catch { continue; }
    const seasons = p.seasons ?? [];
    // Track ALL seasons (not just eligible) for the BTA PRTG cohort stats —
    // matches the players-page baseline used elsewhere.
    if (seasons.length > 0) allByBartId.set(bartId, seasons);
    for (const s of seasons) {
      totalSeasonsScanned++;
      if (!eligible(s)) continue;
      const bucket = bucketFor(s);
      if (!bucket) continue;
      eligibleSeasons++;
      const key = `${s.year}|${bucket}`;
      const arr = cohorts.get(key) ?? [];
      arr.push({ bartId, season: s });
      cohorts.set(key, arr);
    }
  }
  console.log(`\n   total seasons scanned: ${totalSeasonsScanned}`);
  console.log(`   eligible (${MIN_GAMES}g/${MIN_MPG}mpg/${MIN_PPG}ppg + bucket): ${eligibleSeasons}`);
  console.log(`   cohort buckets: ${cohorts.size}`);

  // Compute year cohort stats (PIR + PORPAG means/sds) for BTA PRTG. Uses the
  // broader eligibility from bta-prtg.mts (NOT our rank cohort) so the rating
  // is consistent with the values shown on /portal and /players.
  console.log("\n📊 computing year cohort stats (PIR + PORPAG)…");
  const yearCohortStats = computeCohortStats(allByBartId);
  console.log(`   ${yearCohortStats.size} year-cohorts`);

  // Rank each cohort by every stat.
  console.log("\n📊 ranking cohorts…");
  // playerRanks: bartId → year → { bucket, cohortSize, stats: { key → { value, percentile } } }
  const playerRanks = new Map<number, Map<number, { bucket: "G" | "F" | "C"; cohortSize: number; stats: Record<string, { value: number; percentile: number }> }>>();
  for (const [key, members] of cohorts) {
    const [yearStr, bucket] = key.split("|");
    const year = parseInt(yearStr, 10);
    const cohortSize = members.length;
    const yearStats = yearCohortStats.get(year);
    for (const stat of STATS) {
      const valued = members
        .map((m) => ({ bartId: m.bartId, value: stat.read(m.season, yearStats) }))
        .filter((x): x is { bartId: number; value: number } => x.value != null);
      if (valued.length < 10) continue; // cohort too small for this stat
      valued.sort((a, b) => stat.better === "high" ? b.value - a.value : a.value - b.value);
      const n = valued.length;
      for (let rank0 = 0; rank0 < n; rank0++) {
        const { bartId, value } = valued[rank0]!;
        const percentile = Math.round(((n - rank0) / n) * 100);
        if (!playerRanks.has(bartId)) playerRanks.set(bartId, new Map());
        const byYear = playerRanks.get(bartId)!;
        if (!byYear.has(year)) byYear.set(year, { bucket: bucket as "G" | "F" | "C", cohortSize, stats: {} });
        byYear.get(year)!.stats[stat.key] = { value, percentile };
      }
    }
  }
  console.log(`   players with at least one ranked season: ${playerRanks.size}`);

  // Write one JSON file per player.
  console.log("\n💾 writing rank files…");
  let written = 0;
  for (const [bartId, byYear] of playerRanks) {
    const seasonRanks = [...byYear.entries()]
      .sort((a, b) => b[0] - a[0]) // newest first
      .map(([year, info]) => ({
        year,
        bucket: info.bucket,
        cohortSize: info.cohortSize,
        stats: info.stats,
      }));
    const out = { bartId, seasonRanks };
    await fs.writeFile(path.join(OUT_DIR, `${bartId}.json`), JSON.stringify(out));
    written++;
    if (written % 2500 === 0) process.stdout.write(`   ${written}/${playerRanks.size}\r`);
  }
  console.log(`\n✓ wrote ${written} player-rank files to ${path.relative(process.cwd(), OUT_DIR)}`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
