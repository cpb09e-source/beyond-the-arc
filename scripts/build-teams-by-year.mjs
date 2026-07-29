/**
 * build-teams-by-year.mjs — shard teams-all.json so the home page stops
 * shipping every season it isn't showing.
 *
 * THE PROBLEM THIS SOLVES. `/` passed the whole of teams-all.json to
 * ExplorerClient as props, which Next serialises into the page's RSC payload.
 * Measured on the 2026-07-29 build: index.html was 10.73 MB raw / 1.51 MB
 * gzipped, of which 99.9% was one <script> block holding 4,273 team-season
 * objects — 21x the weight of /players, which renders a comparable table. The
 * explorer only ever displays the seasons the picker has selected (one, by
 * default), so the other eleven years were pure cost on every cold visit to the
 * site's front door.
 *
 * Outputs, both read at RUNTIME by the browser:
 *   public/data/teams-by-year/<year>.json  full rows for one season
 *   public/data/teams-index.json           {n,y,c} for every team-season
 *
 * The index exists because two pickers need to know about seasons that are not
 * loaded: the Team filter lists every school we have ever held, and the Compare
 * picker offers every (team, season) pair. Both need names and years only, so
 * they get a few hundred KB of strings instead of the full stat rows. Keys are
 * one letter for the same reason — at 4,273 entries, "conference" repeated as a
 * JSON key costs more than the values do.
 *
 * teams-all.json itself stays: the team and coach pages read it at build time
 * via readAllTeams(). It is only the CLIENT that no longer needs it, which is
 * why it also becomes strippable from out/ (see
 * scripts/strip-r2-mirrored-from-out.mjs).
 *
 * Reads only committed data, so it is safe to run during the freeze.
 *
 * Usage: node scripts/build-teams-by-year.mjs
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const DATA = path.resolve("public/data");
const SRC = path.join(DATA, "teams-all.json");
const OUT_DIR = path.join(DATA, "teams-by-year");
const INDEX = path.join(DATA, "teams-index.json");

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`  ABORTED: ${SRC} not found.`);
    process.exit(1);
  }
  const all = JSON.parse(fs.readFileSync(SRC, "utf8"));
  if (!Array.isArray(all) || all.length === 0) {
    console.error("  ABORTED: teams-all.json is not a non-empty array.");
    process.exit(1);
  }

  const byYear = new Map();
  for (const t of all) {
    if (!Number.isFinite(t?.year)) continue;
    const list = byYear.get(t.year) ?? byYear.set(t.year, []).get(t.year);
    list.push(t);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  // Clear stale shards so a season dropped upstream cannot linger and be
  // fetched by a picker that no longer lists it.
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (f.endsWith(".json")) fs.rmSync(path.join(OUT_DIR, f));
  }

  const years = [...byYear.keys()].sort((a, b) => a - b);
  let totalMb = 0;
  for (const y of years) {
    const file = path.join(OUT_DIR, `${y}.json`);
    fs.writeFileSync(file, JSON.stringify(byYear.get(y)));
    totalMb += fs.statSync(file).size / 1e6;
  }

  // Compact keys: n=name, y=year, c=conference.
  const index = all
    .filter((t) => Number.isFinite(t?.year) && t?.name)
    .map((t) => ({ n: t.name, y: t.year, c: t.conference ?? null }));
  fs.writeFileSync(INDEX, JSON.stringify(index));
  const indexMb = fs.statSync(INDEX).size / 1e6;
  const srcMb = fs.statSync(SRC).size / 1e6;

  console.log(`  source teams-all.json:  ${srcMb.toFixed(2)} MB (${all.length} team-seasons)`);
  console.log(`  shards:                 ${years.length} seasons, ${totalMb.toFixed(2)} MB total`);
  console.log(`  largest season:         ${Math.max(...years.map((y) => fs.statSync(path.join(OUT_DIR, `${y}.json`)).size)) / 1e6 > 0 ? (Math.max(...years.map((y) => fs.statSync(path.join(OUT_DIR, `${y}.json`)).size)) / 1e6).toFixed(2) : "0"} MB`);
  console.log(`  teams-index.json:       ${indexMb.toFixed(2)} MB (${index.length} entries)`);
  console.log(`\n✓ the home page now ships one season plus the index, not all ${years.length}`);
}

main();
