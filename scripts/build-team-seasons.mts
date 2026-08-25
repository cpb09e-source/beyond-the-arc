/**
 * build-team-seasons.mts — bake one file per team holding every season we
 * hold for it, with percentiles and BTA RTG already computed.
 *
 * WHY THIS EXISTS. The team page's "By season" table is moving to the same
 * grid the explorer uses on `/`: band headers, and a percentile chip under
 * every value. Those chips rank a team-season against the FULL D-I cohort for
 * that year (see the comment above attachPercentiles in team-filters.ts —
 * they deliberately do not shift when the reader narrows the view), so
 * rendering one is not a function of the one team's own numbers. It needs all
 * ~360 teams from that season.
 *
 * That leaves three ways to get the chips onto a team page, and only one of
 * them is affordable:
 *
 *   - Fetch the cohort in the browser. 12 seasons x ~300 KB of
 *     teams-by-year/*.json is ~3.6 MB on a page that currently fetches none.
 *   - Compute it in the server component at build time. readAllTeams() has no
 *     cache (unlike readConfRecordsByTeam right below it), so it re-reads and
 *     re-parses the 12 MB teams-all.json on EVERY call — measured at 51 ms —
 *     and there are 5,009 team pages. Reshaping 6,689 rows and running 34
 *     percentile sorts per season would then ride on top of that, per page.
 *   - Compute it once, offline, and write the answer down. This file.
 *
 * WHY THAT IS SAFE. A finished season's percentiles are immutable: the cohort
 * is closed, so every input to the ranking is fixed forever. Only the season
 * currently being played moves, and it moves on the daily data build, which is
 * exactly when this script runs. Nothing here is a cache that can go stale
 * behind our back — it is a derived value with the same lifetime as its source.
 *
 * NO REIMPLEMENTATION. The rows are produced by calling the production
 * processTeams() from src/lib/team-filters.ts, not by a copy of its reshaping
 * logic. A hand-rolled second implementation would drift silently, and the
 * failure mode is the worst kind: chips that are subtly wrong rather than
 * obviously missing. The trade is that this script must run under tsx so it
 * can import from src/ through the @/ alias.
 *
 * Output:
 *   public/data/team-seasons/<slug>.json   one team, newest season first
 *
 * The slug matches the one the team route uses, so a page can read its own
 * file by name with no index in between.
 *
 * PERCENTILES ALWAYS COME FROM THE WHOLE COHORT, even when --team narrows what
 * gets WRITTEN. The filter is applied after processTeams has already ranked
 * every team-season, never before. Baking "Vermont only" from Vermont-only
 * input would rank Vermont against itself and produce twelve meaningless
 * chips.
 *
 * Reads only committed data, so it is safe to run during the freeze.
 *
 * Usage:
 *   npx tsx scripts/build-team-seasons.mts                 all teams
 *   npx tsx scripts/build-team-seasons.mts --team Vermont  one team
 *   npx tsx scripts/build-team-seasons.mts --team "Ohio St." --team Duke
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { processTeams, DEFAULT_SPEC, ALL_YEARS, type RawTeamSeason, type TeamRow } from "@/lib/team-filters";
import { isUsableSeason } from "@/lib/seasons";
import { teamSlug } from "@/lib/team-slug";

const DATA = path.resolve("public/data");
const SRC = path.join(DATA, "teams-all.json");
const OUT_DIR = path.join(DATA, "team-seasons");

/** `--team X --team Y` → ["X","Y"]. Empty = write every team. */
function parseTeamFilter(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--team" && argv[i + 1]) out.push(argv[++i]!);
  }
  return out;
}

function main() {
  const only = parseTeamFilter(process.argv.slice(2));

  if (!fs.existsSync(SRC)) {
    console.error(`  ABORTED: ${SRC} not found.`);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(SRC, "utf8")) as RawTeamSeason[];
  if (!Array.isArray(raw) || raw.length === 0) {
    console.error("  ABORTED: teams-all.json is not a non-empty array.");
    process.exit(1);
  }

  // Match readAllTeams(): the pages only ever render usable seasons, and an
  // excluded year left in here would be ranked into the cohort and then never
  // displayed — a percentile computed against a season nobody can see.
  const all = raw.filter((t) => isUsableSeason(t.year));

  // Every season, every conference, no filters, no truncation. sortBy is
  // irrelevant to what gets written (each team's file is re-sorted by year
  // below) but the spec requires one.
  const { rows } = processTeams(all, {
    ...DEFAULT_SPEC,
    years: [...ALL_YEARS],
    conf: [],
    teams: [],
    filters: [],
    cols: [],
    limit: -1,
  });

  const byTeam = new Map<string, TeamRow[]>();
  for (const r of rows) {
    const list = byTeam.get(r.team_name);
    if (list) list.push(r);
    else byTeam.set(r.team_name, [r]);
  }

  if (only.length > 0) {
    const missing = only.filter((n) => !byTeam.has(n));
    if (missing.length > 0) {
      console.error(`  ABORTED: no such team(s): ${missing.join(", ")}`);
      console.error("  Names must match teams-all.json exactly (e.g. \"Ohio St.\", not \"Ohio State\").");
      process.exit(1);
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const wanted = only.length > 0 ? only : [...byTeam.keys()];
  let bytes = 0;
  let seasons = 0;
  for (const name of wanted) {
    const teamRows = [...byTeam.get(name)!].sort((a, b) => b.team_year - a.team_year);
    const json = JSON.stringify(teamRows);
    fs.writeFileSync(path.join(OUT_DIR, `${teamSlug(name)}.json`), json);
    bytes += Buffer.byteLength(json);
    seasons += teamRows.length;
  }

  const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
  console.log(`  ranked ${rows.length.toLocaleString()} team-seasons across ${byTeam.size} teams`);
  console.log(`  wrote  ${wanted.length} file(s), ${seasons} season rows, ${kb(bytes)} total`);
  console.log(`  avg    ${kb(bytes / wanted.length)} per team`);
  if (only.length > 0) {
    console.log(`  NOTE: --team was set, so this is a PARTIAL bake. Re-run without it to write every team.`);
  }
}

main();
