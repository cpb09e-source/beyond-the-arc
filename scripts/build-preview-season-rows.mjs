#!/usr/bin/env node
/**
 * build-preview-season-rows.mjs — put the upcoming season into teams-all.json.
 *
 * WHAT THIS MAKES POSSIBLE. The team explorer's Seasons picker reads the same
 * cohort every other page does, so the upcoming season can only appear there if
 * it has rows. This writes one row per team for that season carrying the three
 * figures that can exist before a game is played — returning minutes and its two
 * inputs — and nothing else.
 *
 * EVERY OTHER STAT IS ABSENT, NOT ZERO. The row shaper reads each stat off
 * team_season_stats by key, so a key that is not there becomes null and renders
 * as an em dash. Writing zeros would put a team at the bottom of every
 * leaderboard on the site for stats it has not had the chance to record.
 *
 * ONLY CONFIRMED ROSTERS GET NUMBERS. A team whose projected roster does not
 * match its own athletics page — in either direction — gets the same nulls as
 * every other column. Returning minutes computed from a roster still carrying
 * departed players is not a smaller version of the right answer, it is a
 * different and wrong one, and it would sit at the top of the sort. See
 * build-preseason-continuity.mjs for how that is decided.
 *
 * IDEMPOTENT. Existing rows for the preview season are dropped before the new
 * ones are appended, so re-running after a roster fix replaces rather than
 * duplicates.
 *
 * Run AFTER build-preseason-continuity.mjs, and re-run both after any roster
 * change. Reads only committed data — safe during the freeze.
 *
 *   node scripts/build-preview-season-rows.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const TEAMS_ALL = path.join(ROOT, "public/data/teams-all.json");
const CONTINUITY = path.join(ROOT, "public/data/preseason-continuity.json");
const CONF_2027 = path.join(ROOT, "src/data/conferences-2027.json");
const RATINGS = path.join(ROOT, "public/data/team-adjusted-ratings.json");

const cont = JSON.parse(fs.readFileSync(CONTINUITY, "utf8"));
const SEASON = cont.season;

/**
 * Last season's adjusted net rating, which is the only rating a team that has
 * not played can be shown beside. Every other season gets this from
 * build-team-season-stats.mjs; the preview season has no row there.
 */
const ratings = JSON.parse(fs.readFileSync(RATINGS, "utf8"));

const rows = JSON.parse(fs.readFileSync(TEAMS_ALL, "utf8"));
const existing = rows.filter((r) => r.year === SEASON).length;
const kept = rows.filter((r) => r.year !== SEASON);

/** Next season's conference alignment, which is not last season's. */
let confMap = {};
try {
  confMap = JSON.parse(fs.readFileSync(CONF_2027, "utf8"));
} catch {
  console.warn("   ! conferences-2027.json unreadable — falling back to last season's alignment");
}

// Identity comes from the most recent season a team appears in, so a row keeps
// the id and name every other page links by.
const latestByName = new Map();
for (const r of kept) {
  const prev = latestByName.get(r.name);
  if (!prev || r.year > prev.year) latestByName.set(r.name, r);
}

const added = [];
let withNumbers = 0;
for (const [name, entry] of Object.entries(cont.teams)) {
  const base = latestByName.get(name);
  if (!base) continue;

  // Only the three knowable figures, and only when the roster is confirmed.
  // prev_a_net is attached whether or not the ROSTER is confirmed: it is last
  // season's result, and nothing about next season's roster can change it.
  const prevNet = ratings[`${name}|${SEASON - 1}`]?.a_net ?? null;
  const stats = entry.confirmed
    ? {
        prev_a_net: prevNet,
        ret_prior_min: entry.ret_prior_min,
        prior_team_min: entry.prior_team_min,
        ret_min_pct: entry.ret_min_pct,
        in_transfer_min: entry.in_transfer_min,
        proven_min_pct: entry.proven_min_pct,
      }
    : (prevNet === null ? null : { prev_a_net: prevNet });
  // Counts CONFIRMED rosters, not truthy objects: an unconfirmed team still
  // gets a row carrying last season's rating, and counting that as "has
  // figures" reported 364 of 364 populated when 223 were.
  if (entry.confirmed) withNumbers++;

  added.push({
    id: base.id,
    name,
    conference: confMap[name] ?? base.conference ?? null,
    year: SEASON,
    // Bart has no rows for a season that has not started.
    team_trank_stats: null,
    team_season_stats: stats,
    // BTA RTG is a z-composite over played results; there are none.
    bta_rtg: null,
    bta_rank: null,
  });
}

fs.writeFileSync(TEAMS_ALL, JSON.stringify([...kept, ...added]));

/**
 * The per-season file as well, not just the corpus.
 *
 * The explorer only ships the landing season inline and fetches any other one
 * from teams-by-year/<year>.json. Without this file, selecting the preview
 * season in the picker renders an empty table on the client no matter what
 * teams-all.json says — the corpus copy is only read at build time.
 */
const BY_YEAR = path.join(ROOT, "public/data/teams-by-year", `${SEASON}.json`);
fs.writeFileSync(BY_YEAR, JSON.stringify(added));

console.log(
  `✓ ${added.length} ${SEASON} rows written to ${path.relative(ROOT, TEAMS_ALL)}` +
  (existing ? ` (replaced ${existing})` : "") + "\n" +
  `  ${withNumbers} carry returning-minutes figures; ` +
  `${added.length - withNumbers} are blank pending roster confirmation\n` +
  `  total rows: ${kept.length + added.length}
` +
  `  also wrote ${path.relative(ROOT, path.join(ROOT, "public/data/teams-by-year", `${SEASON}.json`))}`,
);
