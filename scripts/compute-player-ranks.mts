/**
 * compute-player-ranks.mts — pre-computes every player's percentile rank
 * across ~20 stats, cohorted by year × position bucket (G/F/C). Used by the
 * player profile's "Where they rank best/worst" section.
 *
 * Cohort eligibility: 18+ games, 20+ minutes per game, 5.3+ points per game.
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
import { computeCohortStats, volumeShooterPenalty, type PlayerSeason, type CohortStats } from "./lib/bta-prtg.mts";
import {
  confMultiplier,
  topTeamMultiplier,
  top5Tier1Multiplier,
  top3InConfMultiplier,
  POWER_CONFS,
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
// PORPAG — Bart Torvik's Points Over Replacement Per Adjusted Game (idx 28).
// Second component of the BTA PRTG z-blend, paired with PIR.
function porpagOf(row: RawRow): number | null { return fromStart(row, 28); }

// BTA PRTG for a single season — uses year cohort stats + conf/team multipliers,
// then adds the volume-shooter penalty (TS% percentile vs position bucket).
// Matches the formula in scripts/lib/bta-prtg.mts :: productionFor.
function btaPortgFor(bartId: number, season: PlayerSeason, stats: CohortStats | undefined): number | null {
  if (!stats) return null;
  const row = season.raw_row as RawRow;
  const pir = pirFor(row);
  const porpag = porpagOf(row);
  const zs: number[] = [];
  if (typeof pir === "number" && stats.pirSd > 0) zs.push(((pir - stats.pirMean) / stats.pirSd) * 0.69);
  if (typeof porpag === "number" && stats.porSd > 0) zs.push((porpag - stats.porMean) / stats.porSd);
  if (zs.length === 0) return null;
  const raw = (zs.reduce((s, v) => s + v, 0) / zs.length) * 20;
  const base = raw
    * confMultiplier(season.team_conference)
    * topTeamMultiplier(season.team_name)
    * top5Tier1Multiplier(season.team_name)
    * top3InConfMultiplier(season.team_name);
  const ppg = fromEnd(row, 3);
  return base + volumeShooterPenalty(ppg, stats.effPositionPctile.get(bartId) ?? null);
}

// ---------- Stat list ----------
// `read` receives bartId + the eligible season + that year's cohort stats.
// Most reads only need the season; bta_portg uses bartId to look up the
// player's TS-by-position percentile from the cohort stats for the
// volume-shooter penalty.
type StatDef = {
  key: string;
  label: string;
  read: (bartId: number, season: PlayerSeason, yearStats: CohortStats | undefined) => number | null;
  better: "high" | "low";
};

const STATS: StatDef[] = [
  // Per-game counting
  { key: "pts_pg", label: "PTS/G",       read: (_bartId, s) => fromEnd(s.raw_row as RawRow, 3),  better: "high" },
  { key: "reb_pg", label: "REB/G",       read: (_bartId, s) => fromEnd(s.raw_row as RawRow, 7),  better: "high" },
  { key: "ast_pg", label: "AST/G",       read: (_bartId, s) => fromEnd(s.raw_row as RawRow, 6),  better: "high" },
  { key: "stl_pg", label: "STL/G",       read: (_bartId, s) => fromEnd(s.raw_row as RawRow, 5),  better: "high" },
  { key: "blk_pg", label: "BLK/G",       read: (_bartId, s) => fromEnd(s.raw_row as RawRow, 4),  better: "high" },
  // Efficiency / advanced
  { key: "ortg",    label: "ORtg",       read: (_bartId, s) => num((s.raw_row as RawRow)?.[5]),  better: "high" },
  { key: "usage",   label: "Usage%",     read: (_bartId, s) => num((s.raw_row as RawRow)?.[6]),  better: "high" },
  { key: "efg_pct", label: "eFG%",       read: (_bartId, s) => num((s.raw_row as RawRow)?.[7]),  better: "high" },
  { key: "ts_pct",  label: "TS%",        read: (_bartId, s) => num((s.raw_row as RawRow)?.[8]),  better: "high" },
  { key: "orb_pct", label: "OREB%",      read: (_bartId, s) => num((s.raw_row as RawRow)?.[9]),  better: "high" },
  { key: "drb_pct", label: "DREB%",      read: (_bartId, s) => num((s.raw_row as RawRow)?.[10]), better: "high" },
  { key: "ast_pct", label: "AST%",       read: (_bartId, s) => num((s.raw_row as RawRow)?.[11]), better: "high" },
  { key: "tov_pct", label: "TOV%",       read: (_bartId, s) => num((s.raw_row as RawRow)?.[12]), better: "low" },   // flip
  { key: "ft_pct",  label: "FT%",        read: (_bartId, s) => num((s.raw_row as RawRow)?.[15]), better: "high" },
  { key: "fg2_pct", label: "2P%",        read: (_bartId, s) => num((s.raw_row as RawRow)?.[18]), better: "high" },
  { key: "fg3_pct", label: "3P%",        read: (_bartId, s) => num((s.raw_row as RawRow)?.[21]), better: "high" },
  { key: "blk_pct", label: "BLK%",       read: (_bartId, s) => num((s.raw_row as RawRow)?.[22]), better: "high" },
  { key: "stl_pct", label: "STL%",       read: (_bartId, s) => num((s.raw_row as RawRow)?.[23]), better: "high" },
  // Hakeem Percentage — BLK% + STL%. Both raw fields must be present.
  { key: "hkm_pct", label: "HKM%",       read: (_bartId, s) => {
      const r = s.raw_row as RawRow;
      const b = num(r?.[22]); const sx = num(r?.[23]);
      return (b == null || sx == null) ? null : b + sx;
    }, better: "high" },
  { key: "ftr",     label: "FT Rate",    read: (_bartId, s) => num((s.raw_row as RawRow)?.[24]), better: "high" },
  // FTA per game — raw FTA / games. Descriptive (not quality), so "better
  // high" reads as "higher percentile = more aggressive at drawing fouls".
  { key: "fta_pg",  label: "FTA/G",      read: (_bartId, s) => {
      const fta = num((s.raw_row as RawRow)?.[14]);
      const g = num(s.games);
      return fta != null && g != null && g > 0 ? fta / g : null;
    }, better: "high" },
  // 3-Point Attempt Rate (3PAr) — 3PA / FGA. Descriptive style stat
  // (perimeter-heavy shooters score higher); not a quality indicator.
  { key: "tpar",    label: "3PAr",       read: (_bartId, s) => {
      const fg3a = num((s.raw_row as RawRow)?.[20]);
      const fg2a = num((s.raw_row as RawRow)?.[17]);
      const fga = (fg3a ?? 0) + (fg2a ?? 0);
      return fga > 0 && fg3a != null ? fg3a / fga : null;
    }, better: "high" },
  { key: "porpag",  label: "PORPAG",     read: (_bartId, s) => num((s.raw_row as RawRow)?.[28]), better: "high" },
  // Derived ratings — PIR per game and BTA PRTG (cohort-z-scored production).
  { key: "pir",       label: "PIR",      read: (_bartId, s) => pirFor(s.raw_row as RawRow),               better: "high" },
  { key: "bta_portg", label: "BTA PRTG", read: (bartId, s, yearStats) => btaPortgFor(bartId, s, yearStats), better: "high" },
];

// ---------- Cohort eligibility ----------
const MIN_GAMES = 18;
const MIN_MPG = 20;
const MIN_PPG = 5.3;

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
        .map((m) => ({ bartId: m.bartId, value: stat.read(m.bartId, m.season, yearStats) }))
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

  // Build a (bartId, year) → conference map by walking each cohort member's
  // season metadata. Powers the mid-major split below.
  const confByBartYear = new Map<string, string | null>();
  for (const members of cohorts.values()) {
    for (const m of members) {
      confByBartYear.set(`${m.bartId}|${m.season.year}`, m.season.team_conference ?? null);
    }
  }

  // Compute per-(bartId, year) leaderboard ranks:
  //   - rank within position bucket (#3 guard)
  //   - rank overall across all eligible D-I players (#5 overall)
  //   - rank within non-power-conference cohort (#2 mid-major) — only
  //     populated for players whose own conference is NOT a power league
  // All three are sorted by BTA PRTG desc. Players without a bta_portg
  // for the year are excluded (their season ranks just won't carry these
  // fields). POWER_CONFS lives in src/lib/conf-tiers.ts.
  console.log("\n📊 computing BTA PRTG ranks (bucket + overall + mid-major)…");
  type RatingEntry = { bartId: number; bucket: "G" | "F" | "C"; rating: number; conf: string | null };
  const ratingsByYear = new Map<number, RatingEntry[]>();
  for (const [bartId, byYear] of playerRanks) {
    for (const [year, info] of byYear) {
      const rating = info.stats.bta_portg?.value;
      if (typeof rating !== "number") continue;
      if (!ratingsByYear.has(year)) ratingsByYear.set(year, []);
      ratingsByYear.get(year)!.push({
        bartId,
        bucket: info.bucket,
        rating,
        conf: confByBartYear.get(`${bartId}|${year}`) ?? null,
      });
    }
  }
  const yearLeaderRanks = new Map<
    number,
    Map<number, {
      rank: number;
      rankOverall: number;
      cohortOverall: number;
      rankNonPower: number | null;
      cohortNonPower: number | null;
    }>
  >();
  for (const [year, list] of ratingsByYear) {
    // Overall rank
    const sortedOverall = [...list].sort((a, b) => b.rating - a.rating);
    const total = sortedOverall.length;
    const overallByBart = new Map<number, number>();
    for (let i = 0; i < sortedOverall.length; i++) {
      overallByBart.set(sortedOverall[i]!.bartId, i + 1);
    }
    // In-bucket rank
    const byBucket: Record<"G" | "F" | "C", RatingEntry[]> = { G: [], F: [], C: [] };
    for (const e of list) byBucket[e.bucket].push(e);
    const bucketByBart = new Map<number, number>();
    for (const bucket of ["G", "F", "C"] as const) {
      byBucket[bucket].sort((a, b) => b.rating - a.rating);
      for (let i = 0; i < byBucket[bucket].length; i++) {
        bucketByBart.set(byBucket[bucket][i]!.bartId, i + 1);
      }
    }
    // Mid-major (non-power) rank
    const nonPowerList = list.filter((e) => e.conf == null || !POWER_CONFS.has(e.conf));
    const nonPowerTotal = nonPowerList.length;
    const sortedNonPower = [...nonPowerList].sort((a, b) => b.rating - a.rating);
    const nonPowerByBart = new Map<number, number>();
    for (let i = 0; i < sortedNonPower.length; i++) {
      nonPowerByBart.set(sortedNonPower[i]!.bartId, i + 1);
    }
    const perYear = new Map<number, {
      rank: number;
      rankOverall: number;
      cohortOverall: number;
      rankNonPower: number | null;
      cohortNonPower: number | null;
    }>();
    for (const e of list) {
      const isMidMajor = e.conf == null || !POWER_CONFS.has(e.conf);
      perYear.set(e.bartId, {
        rank: bucketByBart.get(e.bartId)!,
        rankOverall: overallByBart.get(e.bartId)!,
        cohortOverall: total,
        rankNonPower: isMidMajor ? nonPowerByBart.get(e.bartId) ?? null : null,
        cohortNonPower: isMidMajor ? nonPowerTotal : null,
      });
    }
    yearLeaderRanks.set(year, perYear);
  }

  // Players index — denormalized list of every ranked (bartId, year, team,
  // conference, name) tuple. Drives the Compare Players modal picker so it
  // can offer every ranked player-season without lazy-loading 14 separate
  // players-by-year files at modal-open time. Compact field names (id/n/y/t/c)
  // to keep the bundle small; gzipped it lands around 250-400 KB.
  console.log("\n💾 writing players index…");
  type IndexEntry = {
    id: number;
    n: string;
    y: number;
    t: string;
    c: string | null;
    cl: string | null;
    h: string | null;
    g: number | null;   // games
    m: number | null;   // mpg
  };
  const indexEntries: IndexEntry[] = [];
  for (const [bartId, byYear] of playerRanks) {
    const seasons = allByBartId.get(bartId);
    if (!seasons) continue;
    for (const year of byYear.keys()) {
      const s = seasons.find((x) => x.year === year);
      if (!s) continue;
      const row = s.raw_row;
      const name = Array.isArray(row) && typeof row[0] === "string" ? row[0] : null;
      if (!name) continue;
      const height = Array.isArray(row) && typeof row[26] === "string" ? row[26] : null;
      const mpg = Array.isArray(row) && typeof row[54] === "number" ? row[54] : null;
      indexEntries.push({
        id: bartId,
        n: name,
        y: year,
        t: s.team_name,
        c: s.team_conference ?? null,
        cl: s.class ?? null,
        h: height,
        g: s.games ?? null,
        m: mpg !== null ? Math.round(mpg * 10) / 10 : null,
      });
    }
  }
  // Newest year first, then alpha by name so picker defaults read sensibly.
  indexEntries.sort((a, b) => b.y - a.y || a.n.localeCompare(b.n));
  await fs.writeFile(
    path.resolve("public/data/players-index.json"),
    JSON.stringify(indexEntries),
  );
  console.log(`✓ wrote ${indexEntries.length} entries to public/data/players-index.json`);

  // Write one JSON file per player.
  console.log("\n💾 writing rank files…");
  let written = 0;
  for (const [bartId, byYear] of playerRanks) {
    const seasonRanks = [...byYear.entries()]
      .sort((a, b) => b[0] - a[0]) // newest first
      .map(([year, info]) => {
        const leader = yearLeaderRanks.get(year)?.get(bartId);
        return {
          year,
          bucket: info.bucket,
          cohortSize: info.cohortSize,
          rank: leader?.rank ?? null,
          rankOverall: leader?.rankOverall ?? null,
          cohortOverall: leader?.cohortOverall ?? null,
          rankNonPower: leader?.rankNonPower ?? null,
          cohortNonPower: leader?.cohortNonPower ?? null,
          stats: info.stats,
        };
      });
    const out = { bartId, seasonRanks };
    await fs.writeFile(path.join(OUT_DIR, `${bartId}.json`), JSON.stringify(out));
    written++;
    if (written % 2500 === 0) process.stdout.write(`   ${written}/${playerRanks.size}\r`);
  }
  console.log(`\n✓ wrote ${written} player-rank files to ${path.relative(process.cwd(), OUT_DIR)}`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
