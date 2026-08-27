#!/usr/bin/env node
/**
 * refresh-embedded-season-stats.mjs — re-attach team-season-stats.json to every
 * static file that embeds a copy of it.
 *
 * WHY THIS EXISTS. build-team-season-stats.mjs writes one file, but the site
 * never reads that file at runtime: export-static-data.mts copies each
 * `<team>|<year>` record into teams-all.json, teams-by-year/<year>.json and
 * team/<slug>.json so a page needs one fetch instead of two. Adding a stat to
 * the builder therefore changes nothing on the site until the copies are
 * refreshed — the new column simply reads null everywhere, which looks exactly
 * like a broken stat rather than a stale file.
 *
 * The alternative is re-running export-static-data.mts, which is the correct
 * step in a normal pipeline run. This exists for the case where ONLY the season
 * stats changed: that script also talks to Supabase for Bart's tables, rebuilds
 * ~15k player files and recomputes national ranks, none of which is implicated
 * by a new box-derived column.
 *
 * The attach is byte-identical to what the exporter does — a whole-object
 * assignment keyed on `${name}|${year}` — so running this is equivalent to
 * re-running that one step, not an approximation of it.
 *
 *   node scripts/refresh-embedded-season-stats.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "public/data");
const STATS = JSON.parse(fs.readFileSync(path.join(DATA, "team-season-stats.json"), "utf8"));

let files = 0, rows = 0, hits = 0, eligible = 0;

/**
 * First season with a CBBD box archive. Before it, team_season_stats is null
 * for every row and always has been — so the health check below has to measure
 * against 2014+ only. Measured against ALL rows it reads 69%, which looks like
 * a broken join key and is actually just the 2,069 pre-archive team-seasons.
 */
const FIRST_CBBD_SEASON = 2014;

/**
 * The upcoming season is NOT re-attached from here.
 *
 * Its rows are written by build-preview-season-rows.mjs and carry the three
 * preseason figures; team-season-stats.json has no entry for a season that has
 * not been played. Re-attaching from this file therefore set them all to null
 * and silently emptied the season the moment it was added — caught only because
 * the health check below counted them as unmatched.
 */
const PREVIEW_SEASON = 2027;

/** Walk any shape the exporter writes and re-attach in place. */
function attach(row) {
  if (!row || typeof row !== "object") return;
  if (!("team_season_stats" in row)) return;
  rows++;
  const name = row.name ?? row.team_name;
  const year = row.year ?? row.team_year;
  if (year === PREVIEW_SEASON) return;
  const hit = STATS[`${name}|${year}`] ?? null;
  row.team_season_stats = hit;
  if (year >= FIRST_CBBD_SEASON) {
    eligible++;
    if (hit) hits++;
  }
}

function rewrite(fp) {
  const doc = JSON.parse(fs.readFileSync(fp, "utf8"));
  if (Array.isArray(doc)) doc.forEach(attach);
  else if (Array.isArray(doc?.seasons)) doc.seasons.forEach(attach);
  else attach(doc);
  fs.writeFileSync(fp, JSON.stringify(doc));
  files++;
}

rewrite(path.join(DATA, "teams-all.json"));
for (const d of ["teams-by-year", "team"]) {
  const dir = path.join(DATA, d);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith(".json")) rewrite(path.join(dir, f));
  }
}

const pct = eligible > 0 ? (100 * hits) / eligible : 0;
console.log(
  `✓ ${files} files, ${rows} embedded rows — ` +
  `${hits}/${eligible} of the ${FIRST_CBBD_SEASON}+ rows matched (${pct.toFixed(2)}%)`,
);
if (pct < 99) {
  console.error("! under 99% of eligible rows matched — check the name|year key before shipping this");
  process.exit(1);
}
