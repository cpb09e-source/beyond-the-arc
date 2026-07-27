#!/usr/bin/env node
/**
 * build-cbbd-team-map.mjs — the CBBD teamId ↔ Bart team-name join table.
 *
 * WHY THIS EXISTS: every surface on the site (team pages, slugs, logos, coach
 * links, conference filters) is keyed on Bart Torvik's team names. CBBD uses
 * its own numeric teamIds and its own spellings ("Queens University", "UNC
 * Greensboro"). Migrating the game logs off CBB Analytics onto CBBD means every
 * CBBD row has to resolve to a Bart name before it can be written.
 *
 * Doing that match at export time, in three different exporters, is how you get
 * three slightly different answers (see the header of scripts/lib/cbbd-join.mjs
 * for the last time that happened). So it is resolved ONCE, here, and committed
 * as src/data/cbbd-team-map.json.
 *
 * MATCHING: normalized name equality first (shared `norm` from cbbd-join.mjs,
 * which folds "St."→"state", strips a lone "U", de-accents), then the existing
 * TEAM_RATING_ALIASES, then the hand overrides below. Anything still unmatched
 * is reported and left out — an absent id is a non-D1 opponent, which callers
 * are expected to handle, not a silent mis-join.
 *
 * Usage:
 *   node scripts/build-cbbd-team-map.mjs           # write the map
 *   node scripts/build-cbbd-team-map.mjs --probe   # report only, write nothing
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { ALIASES, norm } from "./lib/cbbd-join.mjs";

const ROOT = process.cwd();
const SEASONS = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
const PROBE = process.argv.includes("--probe");
const OUT = path.join(ROOT, "src/data/cbbd-team-map.json");

/**
 * CBBD spelling → Bart spelling, for the cases normalization can't reach.
 * Kept deliberately small: every entry here is a name where the two providers
 * genuinely disagree, not a normalization gap. If you find yourself adding a
 * family of these, fix `norm` instead.
 */
const OVERRIDES = {
  // filled in from the --probe report below
};

function bartUniverse() {
  const teams = JSON.parse(fs.readFileSync(path.join(ROOT, "public/data/teams-all.json"), "utf8"));
  const latest = new Map();
  for (const t of teams) {
    if (!t.name) continue;
    const cur = latest.get(t.name);
    if (!cur || t.year > cur.year) latest.set(t.name, { year: t.year });
  }
  return latest;
}

function cbbdUniverse() {
  const seen = new Map();
  for (const season of SEASONS) {
    const fp = path.join(ROOT, "data/cbbd", String(season), "box-teams-full.json.gz");
    if (!fs.existsSync(fp)) continue;
    for (const r of JSON.parse(zlib.gunzipSync(fs.readFileSync(fp)).toString())) {
      if (!r.teamId || !r.team) continue;
      const cur = seen.get(r.teamId);
      // Keep the most recent spelling + conference CBBD used for this id.
      if (!cur || season > cur.season) {
        seen.set(r.teamId, { season, team: r.team, conference: r.conference ?? null });
      }
    }
  }
  return seen;
}

const bart = bartUniverse();
const cbbd = cbbdUniverse();

// Bart name key → Bart name. Aliases point Bart spellings at CBBD spellings, so
// index both so either side resolves.
const bartByKey = new Map();
for (const name of bart.keys()) {
  bartByKey.set(norm(name), name);
  const alias = ALIASES[name];
  if (alias) bartByKey.set(norm(alias), name);
}

const map = {};
const unmatched = [];
for (const [id, v] of cbbd) {
  const bartName = OVERRIDES[v.team] ?? bartByKey.get(norm(v.team));
  if (!bartName) { unmatched.push(v); continue; }
  // NOTE: no conference here on purpose. A team's conference is a function of
  // (team, season) — realignment moved Maryland, Rutgers, Texas, Oklahoma, the
  // entire Pac-12 — so baking in "most recent" would silently rewrite history
  // on every pre-realignment game. Callers resolve conference per season from
  // teams-all.json instead.
  map[id] = { name: bartName, cbbd_name: v.team };
}

const matchedBart = new Set(Object.values(map).map((m) => m.name));
const bartMissing = [...bart.keys()].filter((n) => !matchedBart.has(n)).sort();

console.log(`CBBD teams seen:  ${cbbd.size}`);
console.log(`  mapped to Bart: ${Object.keys(map).length} (${((100 * Object.keys(map).length) / cbbd.size).toFixed(1)}%)`);
console.log(`  unmatched:      ${unmatched.length}`);
console.log(`Bart teams:       ${bart.size}`);
console.log(`  with CBBD id:   ${matchedBart.size} (${((100 * matchedBart.size) / bart.size).toFixed(1)}%)`);
console.log(`  no CBBD row:    ${bartMissing.length}`);

if (unmatched.length) {
  console.log(`\n--- UNMATCHED CBBD TEAMS (${unmatched.length}) ---`);
  for (const v of unmatched.sort((a, b) => a.team.localeCompare(b.team))) {
    console.log(`  ${v.team}  [${v.conference ?? "—"}]  (last seen ${v.season})`);
  }
}
if (bartMissing.length) {
  console.log(`\n--- BART TEAMS WITH NO CBBD ROW (${bartMissing.length}) ---`);
  console.log(bartMissing.map((n) => `  ${n}`).join("\n"));
}

if (!PROBE) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(map, null, 0));
  console.log(`\n✓ wrote ${OUT} (${Object.keys(map).length} ids)`);
} else {
  console.log("\n(probe — nothing written)");
}
