#!/usr/bin/env node
/**
 * build-team-names.mjs — the list of team names, exactly as the data spells
 * them, small enough for a browser to hold.
 *
 * WHY. The admin page's transfer form needs a destination that matches how
 * teams are named everywhere else, because the pipeline resolves that string
 * against the team table. Type "UNC" and the move is applied to a school that
 * does not exist; type "Miami" and it is ambiguous between two.
 *
 * The existing patch script handles this with DEST_ALIAS, a hand-kept map of
 * shorthands — which works for the shorthands somebody already thought of and
 * silently fails for the next one. Offering the real names instead removes the
 * guess rather than catching it.
 *
 * WHY NOT JUST READ teams-all.json IN THE BROWSER. It is 18 MB. This is the
 * same 365 names in about 8 KB.
 *
 * WHY NOT index.json, WHICH IS ALREADY SMALL. It carries slugs, not names, and
 * a slug does not reverse: "ohio-st" is "Ohio St." and "miami-fl" is "Miami
 * FL", and no rule recovers the punctuation and capitals from the slug.
 *
 * NEWEST SEASON FIRST, then every other name a program has had. A team that
 * has been renamed keeps both spellings in the list, because a move confirmed
 * today might be typed against either and the pipeline matches on the string.
 *
 *   node scripts/build-team-names.mjs
 */
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve("public/data/teams-all.json");
const OUT = path.resolve("public/data/team-names.json");

if (!fs.existsSync(SRC)) {
  console.error(`Missing ${SRC}. Run the data export first.`);
  process.exit(1);
}

const rows = JSON.parse(fs.readFileSync(SRC, "utf8"));
if (!Array.isArray(rows) || rows.length === 0) {
  console.error("teams-all.json is not a non-empty array — refusing to write an empty list.");
  process.exit(1);
}

// Newest year a name appears under, so current programs sort ahead of ones
// that have not existed for a decade.
const latestYear = new Map();
for (const r of rows) {
  const name = r?.name;
  const year = Number(r?.year);
  if (typeof name !== "string" || !name || !Number.isFinite(year)) continue;
  if (!latestYear.has(name) || latestYear.get(name) < year) latestYear.set(name, year);
}

if (latestYear.size === 0) {
  console.error("No usable team names found — refusing to write an empty list.");
  process.exit(1);
}

const names = [...latestYear.entries()]
  .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
  .map(([name, year]) => ({ name, last: year }));

fs.writeFileSync(OUT, JSON.stringify({ generated_at: new Date().toISOString(), teams: names }));
const current = names.filter((n) => n.last === names[0].last).length;
console.log(`${names.length} names (${current} in ${names[0].last}) → public/data/team-names.json  ${(fs.statSync(OUT).size / 1024).toFixed(1)} KB`);
