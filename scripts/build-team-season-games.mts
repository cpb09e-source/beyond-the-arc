/**
 * build-team-season-games.mts — splits each season's team game index into one
 * small file per team, with the season's percentiles already computed.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * A team page's Game Log section shows about 32 rows and downloads 1.6 MB to
 * do it. It has to, today: the percentile chip beside every number is ranked
 * against EVERY GAME IN THE SEASON (see the cohort note in
 * team-games-client.tsx), and the only way to rank against the season on the
 * client is to hold the season. So Duke's page pulls 11,504 rows to render 32.
 *
 * That is wasteful everywhere and wrong in one place. Team pages are free at
 * every season by decision, but the seasons behind them are not — so a free
 * 2019 team page currently fetches the whole gated 2019 corpus to draw its own
 * schedule. The bytes the paywall withholds from the explorer walk out through
 * the team page.
 *
 * Precomputing the percentiles here fixes both at once. The cohort is still
 * the whole season, because it is computed here where the whole season is in
 * memory; the client never sees it.
 *
 * ── THE RANKING RUNS THROUGH THE APP'S OWN CODE, DELIBERATELY ─────────────
 *
 * This imports TEAM_GAME_STATS and midrankPercentileMap from src/ rather than
 * reimplementing either. A second implementation of `get` for 45 columns would
 * drift the first time a stat's formula changed, and the failure mode is
 * silent — a chip that disagrees with the explorer's chip for the same game,
 * with nothing to compare it against on screen. tsx resolves the @/ paths, the
 * same way build-team-seasons.mts and compute-player-ranks.mts already do.
 *
 * Which columns get a percentile is TEAM_GAME_STATS' own `pct` flag, so the
 * result flags and the AP/seed context stay unranked here for exactly the
 * reasons documented there.
 *
 * ── OUTPUT ────────────────────────────────────────────────────────────────
 *
 *   public/data/team-season-games/<year>/<slug>.json
 *
 * A TeamGamePack with one team in its name table, its own opponents interned,
 * and a `pct` map alongside `rows`:
 *
 *   { season, epoch, fields, teams: { names: [one], confs: [one] },
 *     opps: [...], rows: [...], pct: { "<stat key>": [n | null, ...] } }
 *
 * `pct[key]` is aligned to `rows` by index, and a null there means the stat
 * was missing for that game — the same thing an absent key means in the map
 * the client builds, so the two paths render identically.
 *
 * Usage:
 *   npx tsx scripts/build-team-season-games.mts            # every season
 *   npx tsx scripts/build-team-season-games.mts --season 2026
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { T, TEAM_GAME_SEASONS, TEAM_GAME_STATS, type TeamGamePack } from "@/lib/team-game-index";
import { midrankPercentileMap } from "@/lib/percentile";
import { teamSlug } from "@/lib/team-slug";

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, "public", "data", "team-game-index");
const OUT_DIR = path.join(ROOT, "public", "data", "team-season-games");

/** The columns that carry a chip. `pct` defaults to true; only false opts out. */
const RANKED = TEAM_GAME_STATS.filter((s) => s.pct !== false);

function parseSeasons(): number[] {
  const i = process.argv.indexOf("--season");
  if (i === -1) return [...TEAM_GAME_SEASONS];
  const y = Number(process.argv[i + 1]);
  if (!Number.isFinite(y)) {
    console.error(`--season needs a year. Known: ${TEAM_GAME_SEASONS.join(", ")}`);
    process.exit(1);
  }
  return [y];
}

type SeasonFile = Omit<TeamGamePack, "epochMs">;

function buildSeason(year: number): { teams: number; bytes: number } | null {
  const src = path.join(SRC_DIR, `${year}.json`);
  if (!fs.existsSync(src)) {
    console.warn(`  ${year}: no team-game-index file, skipped`);
    return null;
  }
  const pack = JSON.parse(fs.readFileSync(src, "utf8")) as SeasonFile;

  /**
   * Percentiles first, over the WHOLE season, before anything is split. This
   * is the entire point of the file: once rows are grouped by team the cohort
   * is gone, and ranking Duke's 32 games against Duke's 32 games would answer
   * a different question on every team page.
   */
  const seasonPct = new Map<string, Map<number, number>>();
  for (const stat of RANKED) {
    seasonPct.set(
      stat.key,
      midrankPercentileMap(
        pack.rows.map((r, i) => [i, stat.get(r)] as const),
        !stat.lowerBetter,
      ),
    );
  }

  // Group row indices by team, preserving the season file's order.
  const byTeam = new Map<number, number[]>();
  for (let i = 0; i < pack.rows.length; i++) {
    const t = pack.rows[i]![T.t]!;
    const list = byTeam.get(t);
    if (list) list.push(i);
    else byTeam.set(t, [i]);
  }

  const outDir = path.join(OUT_DIR, String(year));
  fs.mkdirSync(outDir, { recursive: true });

  let bytes = 0;
  for (const [teamIdx, indices] of byTeam) {
    const name = pack.teams.names[teamIdx]!;
    const conf = pack.teams.confs[teamIdx]!;

    /**
     * Re-intern the opponents to the ones this team actually played. The
     * season table is 365 names and this team faced about 30 of them, so the
     * full table would be most of the file. It also makes the section's
     * Opponent picker list only real opponents, which is what a team page
     * should offer anyway.
     */
    const oppIds = new Map<number, number>();
    const opps: string[] = [];
    const rows: number[][] = [];
    for (const i of indices) {
      const r = [...pack.rows[i]!];
      const oldOpp = r[T.o]!;
      let next = oppIds.get(oldOpp);
      if (next === undefined) {
        next = opps.length;
        oppIds.set(oldOpp, next);
        opps.push(pack.opps[oldOpp]!);
      }
      r[T.o] = next;
      r[T.t] = 0; // one team in the name table now
      rows.push(r);
    }

    const pct: Record<string, Array<number | null>> = {};
    for (const stat of RANKED) {
      const m = seasonPct.get(stat.key)!;
      pct[stat.key] = indices.map((i) => (m.has(i) ? m.get(i)! : null));
    }

    const out: SeasonFile & { pct: typeof pct } = {
      season: pack.season,
      epoch: pack.epoch,
      fields: pack.fields,
      teams: { names: [name], confs: [conf] },
      opps,
      rows,
      pct,
    };
    const json = JSON.stringify(out);
    bytes += Buffer.byteLength(json);
    fs.writeFileSync(path.join(outDir, `${teamSlug(name)}.json`), json);
  }

  return { teams: byTeam.size, bytes };
}

const seasons = parseSeasons();
console.log(`Building per-team game files for ${seasons.length} season(s)`);
console.log(`  ${RANKED.length} ranked columns of ${TEAM_GAME_STATS.length}\n`);

let files = 0;
let total = 0;
for (const year of seasons) {
  const res = buildSeason(year);
  if (!res) continue;
  files += res.teams;
  total += res.bytes;
  const avg = Math.round(res.bytes / res.teams / 1024);
  console.log(`  ${year}: ${res.teams} teams, ${(res.bytes / 1024 / 1024).toFixed(1)} MB total, ~${avg} KB each`);
}
console.log(`\n${files} files, ${(total / 1024 / 1024).toFixed(1)} MB → public/data/team-season-games/`);
