/**
 * Measure a plausible range for EVERY filterable player stat, and write it
 * into src/lib/player-stat-bounds.ts.
 *
 * WHY. The players filter drawer shipped with thirty stats and hand-written
 * min/max — "rebounds per game, 0 to 20" — picked by eye. The catalogue is now
 * 137 stats across two sources, and hand-writing bounds for those would be a
 * hundred more guesses. Worse, a guessed bound is not neutral: it is the
 * placeholder the reader is told a normal value looks like, and the extent of
 * any slider built on it.
 *
 * METHOD, and it is the team side's exactly (scripts/build-stat-bounds.mts):
 * the 1st and 99th percentile of the real distribution across every
 * player-season we hold, in DISPLAY units, rounded outward to a round number.
 *
 *   1st/99th rather than min/max   one broken season should not define normal
 *   outward rather than nearest    the hint must never exclude a value that
 *                                  genuinely occurs
 *
 * WHERE THE NUMBERS COME FROM. Four sources, because that is how the page
 * assembles a player: the explorer payload, the stat packs, the EPM file and
 * the shooting-profile file. Measuring the built artifacts rather than
 * re-deriving anything means the bounds describe what the reader will actually
 * see, including every floor and gate applied on the way.
 *
 * Usage:  npx tsx scripts/build-player-stat-bounds.mts [--write]
 * Without --write it prints a summary and changes nothing.
 */
import fs from "node:fs";
import path from "node:path";
import { PLAYER_STAT_COLUMNS } from "../src/lib/players";
import { PACK_STAT_COLUMNS } from "../src/lib/player-stat-pack";

/**
 * Only keys the filter drawer can actually offer.
 *
 * The explorer payload carries identity alongside the stats — ids, the season,
 * the leaderboard rank — and those are numbers, so they measure perfectly well
 * and are perfectly useless. "bart_player_id: 0 to 140000" is not a hint about
 * anything.
 */
const FILTERABLE = new Set<string>([
  ...PLAYER_STAT_COLUMNS.map((c) => c.key),
  ...PACK_STAT_COLUMNS.map((c) => c.key),
]);

const ROOT = process.cwd();
const TARGET = path.join(ROOT, "src/lib/player-stat-bounds.ts");
const WRITE = process.argv.includes("--write");

// 2021 JOINED THE RUN 2026-09-02, when box-players-full.json.gz was finally
// pulled. It is NOT excluded site-wide — see FLAGGED_SEASONS in
// src/lib/seasons.ts, which marks the COVID season as incomparable, not as
// absent. What is still missing for it is the play-by-play (~157
// plays-*.json.gz day files), a separate and much larger pull.
const SEASONS = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

/** Percentile of a sorted array, linear interpolation. */
function pct(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? sorted[lo]! : sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
}

/**
 * Round a pair outward to something a person would say.
 *
 * The step is chosen from the SPAN rather than the magnitude, so a stat that
 * runs 0.31 to 0.64 gets hundredths and one that runs 3 to 880 gets hundreds.
 * Rounding to the magnitude instead flattens every narrow rate to "0 to 1".
 */
function roundOutward(lo: number, hi: number): [number, number] {
  const span = Math.abs(hi - lo);
  if (!Number.isFinite(span) || span === 0) return [lo, hi];
  const mag = Math.pow(10, Math.floor(Math.log10(span)));
  const step = span / mag >= 5 ? mag : span / mag >= 2 ? mag / 2 : mag / 5;
  const dp = Math.max(0, -Math.floor(Math.log10(step)));
  const r = (v: number, dir: -1 | 1) => {
    const x = dir < 0 ? Math.floor(v / step) * step : Math.ceil(v / step) * step;
    return Number(x.toFixed(dp + 2));
  };
  return [r(lo, -1), r(hi, 1)];
}

// ── Collect every value of every stat, across every season ─────────────────

const values = new Map<string, number[]>();
const push = (key: string, v: unknown) => {
  if (typeof v !== "number" || !Number.isFinite(v)) return;
  let a = values.get(key);
  if (!a) { a = []; values.set(key, a); }
  a.push(v);
};

const readJson = (p: string) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null);

/**
 * Fields on the explorer payload whose stat KEY differs from the field name.
 * The filter drawer speaks in keys, so the bounds table has to as well.
 */
const FIELD_TO_KEY: Record<string, string> = {
  min_pg: "mpg", pts_pg: "ppg", reb_pg: "rpg", ast_pg: "apg",
  stl_pg: "spg", blk_pg: "bpg", orb_pg: "orpg", drb_pg: "drpg",
  hkm_pct: "hkm", usage_pct: "usg_pct", ast_to_tov: "ast_tov",
  games: "gp", bta_porpag: "bta_porpag",
};

let seasonsSeen = 0;
for (const year of SEASONS) {
  // 1. Explorer payload — column-oriented { fields, rows }.
  const ex = readJson(path.join(ROOT, "public/data/players-explorer", `${year}.json`));
  if (ex?.fields && Array.isArray(ex.rows)) {
    seasonsSeen++;
    const fields: string[] = ex.fields;
    for (const row of ex.rows as unknown[][]) {
      fields.forEach((f, i) => {
        const key = FIELD_TO_KEY[f] ?? f;
        push(key, row[i]);
      });
    }
  }

  // 2. Stat packs — already column-major, so this is a straight read.
  const packDir = path.join(ROOT, "public/data/player-stats", String(year));
  if (fs.existsSync(packDir)) {
    for (const f of fs.readdirSync(packDir)) {
      const pk = readJson(path.join(packDir, f));
      if (!pk?.cols) continue;
      pk.cols.forEach((c: string, ci: number) => {
        for (const v of pk.vals[ci] ?? []) push(c, v);
      });
    }
  }

  // 3. EPM, attached client-side and therefore absent from the payload.
  const epm = readJson(path.join(ROOT, "public/data", `epm-${year}.json`));
  if (epm?.players) {
    for (const p of Object.values(epm.players) as Array<Record<string, unknown>>) {
      push("epm", p.epm); push("off_epm", p.off); push("def_epm", p.def);
      push("ewins", p.ewins); push("on_off", p.on_off);
    }
  }
  const boxEpm = readJson(path.join(ROOT, "public/data", `box-epm-${year}.json`));
  if (boxEpm?.players) {
    for (const p of Object.values(boxEpm.players) as Array<Record<string, unknown>>) {
      push("box_epm", typeof p === "number" ? p : p.epm);
    }
  }

  // 4. Shooting profile — 0-100 values, same as they are displayed.
  const shoot = readJson(path.join(ROOT, "public/data", `shooting-${year}.json`));
  if (shoot?.players) {
    for (const p of Object.values(shoot.players) as Array<Record<string, unknown>>) {
      push("rim_pct", p.rim_pct); push("mid_pct", p.mid_pct);
      push("asst_pct", p.asst); push("rim_rate", p.rim_rate); push("tp_rate", p.tp_rate);
    }
  }
}

// ── Reduce to bounds ───────────────────────────────────────────────────────

/**
 * Stats stored as FRACTIONS and shown as percentages. The bound has to be in
 * the units the box is typed in, or the hint under a shooting percentage reads
 * "0.31-0.64" while the reader is expected to type 64.
 */
const PCT_FRACTION = new Set([
  "fg_pct", "fg3_pct", "fg2_pct", "ft_pct", "ts_pct", "efg_pct", "fta_rate",
  "tov_pct", "usg_pct", "win_pct", "pitp_share", "scp_share", "fbp_share",
  "pts2_share", "pts3_share", "ptsft_share", "ftm_rate", "rts_pct",
]);

const bounds: Array<[string, number, number, number]> = [];
for (const [key, arr] of [...values].sort(([a], [b]) => a.localeCompare(b))) {
  if (!FILTERABLE.has(key)) continue;
  // Under a hundred observations a 1st percentile is one unusual player.
  if (arr.length < 100) continue;
  arr.sort((a, b) => a - b);
  const scale = PCT_FRACTION.has(key) ? 100 : 1;
  const [lo, hi] = roundOutward(pct(arr, 0.01) * scale, pct(arr, 0.99) * scale);
  if (lo === hi) continue;
  bounds.push([key, lo, hi, arr.length]);
}

console.log(`${seasonsSeen} seasons, ${values.size} stats seen, ${bounds.length} with usable bounds`);
for (const [k, lo, hi, n] of bounds.slice(0, 12)) {
  console.log(`  ${k.padEnd(16)} ${String(lo).padStart(9)} … ${String(hi).padEnd(9)} (n=${n.toLocaleString()})`);
}
if (bounds.length > 12) console.log(`  … and ${bounds.length - 12} more`);

if (!WRITE) {
  console.log("\n(dry run — pass --write to update src/lib/player-stat-bounds.ts)");
  process.exit(0);
}

const body = bounds.map(([k, lo, hi]) => `  ${JSON.stringify(k)}: [${lo}, ${hi}],`).join("\n");
const out = `/**
 * Measured range of every filterable player stat, in DISPLAY units.
 *
 * GENERATED — do not edit by hand. Run:
 *   npx tsx scripts/build-player-stat-bounds.mts --write
 *
 * The 1st and 99th percentile of the real distribution across every
 * player-season the site holds, rounded outward to a round number. The 1st and
 * 99th rather than the min and max because one broken season should not define
 * what "normal" looks like; outward rather than nearest so the hint never
 * excludes a value that genuinely occurs.
 *
 * Percentage stats are stored as fractions but typed as percentages, so their
 * bounds are scaled to match the box the reader types in.
 *
 * Measured over ${seasonsSeen} seasons. Stats with fewer than 100 observations are
 * omitted: a 1st percentile over eighty players is one unusual player.
 */
export const PLAYER_STAT_BOUNDS: Record<string, [number, number]> = {
${body}
};

/** The measured range for a stat, or undefined where there is not enough data. */
export function playerStatBounds(key: string): [number, number] | undefined {
  return PLAYER_STAT_BOUNDS[key];
}
`;
fs.writeFileSync(TARGET, out);
console.log(`\n✓ ${bounds.length} bounds → ${path.relative(ROOT, TARGET)}`);
