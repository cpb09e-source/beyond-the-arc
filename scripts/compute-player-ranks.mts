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
// Only the cohort-eligibility helpers are still needed here. The conference /
// top-team multipliers and the defensive tilt existed solely to build BTA PRTG,
// which this script no longer ranks — EPM arrives pre-computed from the RAPM
// fit, already adjusted for teammates and opponents, so none of that scaffolding
// applies to it.
import { computeCohortStats, type PlayerSeason, type CohortStats } from "./lib/bta-prtg.mts";
import { POWER_CONFS } from "../src/lib/conf-tiers.ts";

const PLAYER_DIR = path.resolve("public/data/player");
const OUT_DIR = path.resolve("public/data/player-ranks");
const DATA_DIR = path.resolve("public/data");

// ---------- EPM ----------
// Same precedence as readImpactForYear() in src/lib/static-data.ts: the real
// play-by-play fit (epm-<year>.json, 2025+) wins, and the estimated box-score
// fit (box-epm-<year>.json, all years) fills the gaps.
//
// This ordering is not optional. The players explorer already reads EPM
// through readImpactForYear, so loading only box-epm here would put two
// different EPMs for one player-season on the site — Jaden Bradley 2026 is
// 5.79 by the play-by-play fit and 4.95 by the box estimate.
const epmByYear = new Map<number, Map<number, number>>();
async function loadEpm(): Promise<void> {
  const files = await fs.readdir(DATA_DIR);
  const readInto = async (file: string, year: number, fillOnly: boolean) => {
    const j = JSON.parse(await fs.readFile(path.join(DATA_DIR, file), "utf8")) as {
      players: Record<string, { epm: number | null }>;
    };
    let m = epmByYear.get(year);
    if (!m) { m = new Map<number, number>(); epmByYear.set(year, m); }
    for (const [id, v] of Object.entries(j.players ?? {})) {
      if (typeof v?.epm !== "number" || !Number.isFinite(v.epm)) continue;
      const key = Number(id);
      if (fillOnly && m.has(key)) continue;
      m.set(key, v.epm);
    }
  };
  let real = 0;
  for (const f of files.filter((f) => /^epm-\d{4}\.json$/.test(f))) {
    const year = Number(f.slice("epm-".length, -".json".length));
    await readInto(f, year, false);
    real++;
  }
  for (const f of files.filter((f) => /^box-epm-\d{4}\.json$/.test(f))) {
    const year = Number(f.slice("box-epm-".length, -".json".length));
    await readInto(f, year, true);
  }
  const total = [...epmByYear.values()].reduce((n, m) => n + m.size, 0);
  console.log(`   EPM: ${epmByYear.size} seasons (${real} play-by-play, rest estimated), ${total.toLocaleString()} player-seasons`);
}

// ---------- Position bucket mapping ----------
const BUCKET_BY_NOTE: Record<string, "G" | "F" | "C"> = {
  "Pure PG": "G", "Scoring PG": "G", "Combo G": "G", "Wing G": "G",
  "Wing F": "F", "Stretch 4": "F",
  // Height-derived dual-eligibility notes for 2008-09 (see derive-positions.mts).
  "G/F": "G", "F/G": "F", "C/F": "C",
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
// ---------- Stat list ----------
// `read` receives bartId + the eligible season + that year's cohort stats.
// Most reads only need the season.
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
  // Box EPM — estimated plus-minus, joined by (year, bartId). Not every
  // eligible player has one; a null just leaves the tile out.
  { key: "epm",     label: "EPM",        read: (bartId, s) => epmByYear.get(s.year)?.get(bartId) ?? null, better: "high" },
  // Derived rating — PIR per game.
  //
  // BTA PRTG used to be ranked here too. It was a second composite impact
  // rating sitting next to EPM in the same best/worst list, saying the same
  // thing in different units and disagreeing about the answer. EPM is what the
  // rings, the leaderboard, the stat tiles and the portal all rank on now, so
  // the second one is gone rather than relabelled — relabelling a PRTG value
  // "EPM" would have put a number under a name that doesn't produce it.
  { key: "pir",       label: "PIR",      read: (_bartId, s) => pirFor(s.raw_row as RawRow),               better: "high" },
];

// ---------- Cohort eligibility ----------
const MIN_GAMES = 18;
/**
 * Lowered from 20 to 15 (2026-08).
 *
 * The floor decides who gets a rank file at all, and a rank file is what the
 * player page's whole Overview panel hangs off — percentile chips, splits, the
 * lot. At 20 it was excluding real rotation players for missing by a rounding
 * error: Kiyan Anthony played 29 games at 18.7 MPG and 8.0 PPG for Syracuse,
 * has an EPM and a full advanced line, and his page showed none of it because
 * he was 1.3 minutes a night short.
 *
 * This is a COHORT change, not a display change — every percentile on the site
 * is computed within it, so widening the floor moves everyone's chips slightly
 * as the denominator grows. That is correct rather than a side effect: a
 * percentile is only meaningful against a population, and 15 MPG is a defensible
 * line for "plays a real role" in a way that 20 was not.
 */
const MIN_MPG = 15;
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

  console.log("📂 loading box EPM…");
  await loadEpm();

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
  // All three are sorted by EPM desc. Players without an epm for the year are
  // excluded (their season ranks just won't carry these fields). POWER_CONFS
  // lives in src/lib/conf-tiers.ts.
  //
  // These used to sort by BTA PRTG, which put the player page's headline rings
  // in direct conflict with the /players leaderboard: the table sorts on EPM,
  // so Chet Holmgren's 2021-22 showed "#1" there and "#29 overall" on his own
  // page (97th percentile PRTG vs 100th percentile EPM). EPM is the site's
  // headline impact metric everywhere else now — the stat tiles, the transfer
  // portal's PVS — and the rings were the last holdout.
  console.log("\n📊 computing EPM ranks (bucket + overall + mid-major)…");
  type RatingEntry = { bartId: number; bucket: "G" | "F" | "C"; rating: number; conf: string | null };
  const ratingsByYear = new Map<number, RatingEntry[]>();
  for (const [bartId, byYear] of playerRanks) {
    for (const [year, info] of byYear) {
      const rating = info.stats.epm?.value;
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

  // ---------- Prune ----------
  // This directory IS the ranked set. readRankedPlayerIds(), the explorer's
  // has_page flag, emit-profileable-ids and generateStaticParams all answer
  // "does this player have a page?" by listing it — so a file left behind by an
  // older run keeps that player on the site with the old run's numbers.
  //
  // That is not theoretical. MIN_MPG went 18 → 20 and MIN_PPG 5 → 5.3 at some
  // point, and because writing is per-player and nothing ever deleted, 1,802
  // files survived the tightening: players who no longer clear the bar, still
  // counted as ranked, still given a profile page, and still serving percentiles
  // from a cohort that no longer exists. They also predate the leaderboard
  // fields (rank / rankOverall / rankNonPower), so their pages rendered a
  // strictly older schema than everyone else's.
  //
  // Deleting what this run did not write makes the eligibility constants above
  // the single source of truth again — loosen them and players come back,
  // tighten them and they leave, without a manual sweep either way.
  const onDisk = (await fs.readdir(OUT_DIR)).filter((f) => f.endsWith(".json"));
  const stale = onDisk.filter((f) => !playerRanks.has(parseInt(f, 10)));

  // A prune that can empty the directory is a prune that can silently take the
  // whole site's player pages down. If the run produced nothing, the run is
  // what's broken — leave the previous output alone and say so.
  if (written === 0) {
    console.error(`\n✗ wrote 0 rank files — refusing to prune ${stale.length} existing ones. Fix the run first.`);
    process.exitCode = 1;
    return;
  }

  for (const f of stale) await fs.unlink(path.join(OUT_DIR, f));
  console.log(
    stale.length
      ? `✓ pruned ${stale.length} stale rank file${stale.length === 1 ? "" : "s"} (no longer clear ${MIN_GAMES}g/${MIN_MPG}mpg/${MIN_PPG}ppg + bucket)`
      : `✓ no stale rank files to prune`,
  );
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
