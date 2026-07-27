#!/usr/bin/env node
/**
 * build-tournament-game-ids.mjs — map each scraped tournament box score to the
 * CBBD game it is.
 *
 *   public/data/tournament-game-ids.json  →  { "<year>/<slug>": "<game_id>" }
 *
 * WHY: the coach pages open a box score from Sports-Reference scrapes
 * (public/data/tournament-box/<year>/<slug>.json) using their own older, plainer
 * modal, while every other surface now renders the shared one. To point them at
 * the shared modal they need our game_id, and the scrape has no id in common
 * with CBBD — only a date, two team names and two scores.
 *
 * RESOLVED OFFLINE, ON PURPOSE. Doing this match at runtime would mean a name
 * that resolves slightly wrong silently opens a DIFFERENT game's box score,
 * which is worse than an inconsistent style. Here it is verified once, the match
 * rate is reported, and anything unmatched simply keeps the old modal.
 *
 * THE KEY: (ET date, normalized team name, points scored). Date plus one team
 * would already be close to unique; requiring the score to agree as well makes a
 * wrong match essentially impossible — two different games on the same day
 * involving the same team with the same final score does not happen. The date is
 * allowed +/-1 day because the scrape and CBBD occasionally disagree about which
 * calendar day a late tip belongs to.
 *
 * Usage: node scripts/build-tournament-game-ids.mjs [--verbose]
 */
import fs from "node:fs";
import path from "node:path";
import { ALIASES, norm } from "./lib/cbbd-join.mjs";

const ROOT = process.cwd();
const BOX_DIR = path.join(ROOT, "public/data/tournament-box");
const OUT = path.join(ROOT, "public/data/tournament-game-ids.json");
const VERBOSE = process.argv.includes("--verbose");

/** Our log rows for a season, indexed by (date | normalized team | points). */
function logIndex(season) {
  const fp = path.join(ROOT, `public/data/game-logs-by-year/${season}.json`);
  const idx = new Map();
  if (!fs.existsSync(fp)) return idx;
  for (const g of JSON.parse(fs.readFileSync(fp, "utf8"))) {
    if (!g.game_date || !g.team_name || typeof g.pts_scored !== "number") continue;
    idx.set(`${g.game_date}|${norm(g.team_name)}|${g.pts_scored}`, g.game_id);
  }
  return idx;
}

const shiftDate = (ymd, days) =>
  new Date(new Date(`${ymd}T12:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);

/**
 * Sports-Reference spellings the shared alias table doesn't cover, because that
 * table maps OUR names onto CBBD's and this is a third vocabulary.
 * Deliberately tiny — anything that can be handled by normalization should be.
 */
const SCRAPE_ALIASES = {
  "Ole Miss": "Mississippi",
};

/**
 * Scrape name → the key our logs normalize to.
 *
 * Yields more than one candidate on purpose. A trailing parenthetical qualifier
 * ("St. John's (NY)" where our logs say "St. John's") is common in the scrape
 * and can't be normalized away without also merging genuinely distinct schools,
 * so it's tried as an ALTERNATIVE rather than applied unconditionally. The
 * date+score half of the key is what makes trying several spellings safe.
 */
function teamKeys(name) {
  const out = new Set();
  const add = (n) => { if (n) out.add(norm(n)); };
  add(SCRAPE_ALIASES[name] ?? name);
  add(ALIASES[name]);
  const stripped = name.replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (stripped !== name) add(stripped);
  return [...out];
}

const out = {};
let total = 0, matched = 0;
const unmatched = [];

const years = fs.existsSync(BOX_DIR)
  ? fs.readdirSync(BOX_DIR).filter((d) => /^\d{4}$/.test(d)).sort()
  : [];

for (const year of years) {
  const season = Number(year);
  const idx = logIndex(season);
  const files = fs.readdirSync(path.join(BOX_DIR, year)).filter((f) => f.endsWith(".json"));
  let hit = 0;

  for (const file of files) {
    total++;
    let box;
    try {
      box = JSON.parse(fs.readFileSync(path.join(BOX_DIR, year, file), "utf8"));
    } catch { continue; }
    const date = box.date;
    const teams = Array.isArray(box.teams) ? box.teams : [];
    if (!date || teams.length !== 2) { unmatched.push(`${year}/${file} (no date or teams)`); continue; }

    // Try each side, and each of three candidate dates. The first hit wins —
    // both sides resolve to the same game, so whichever matches is correct.
    let found = null;
    outer:
    for (const t of teams) {
      if (!t?.name || typeof t.score !== "number") continue;
      for (const key of teamKeys(t.name)) {
        for (const d of [date, shiftDate(date, -1), shiftDate(date, 1)]) {
          const id = idx.get(`${d}|${key}|${t.score}`);
          if (id) { found = id; break outer; }
        }
      }
    }

    const slug = file.replace(/\.json$/, "");
    if (found) {
      out[`${year}/${slug}`] = found;
      matched++; hit++;
    } else {
      unmatched.push(`${year}/${slug}  ${date}  ${teams.map((t) => `${t.name} ${t.score}`).join(" vs ")}`);
    }
  }
  console.log(`${year}: ${hit}/${files.length} matched${idx.size === 0 ? "  (no game log for this season)" : ""}`);
}

fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`\n${matched}/${total} tournament box scores mapped (${((100 * matched) / total).toFixed(1)}%)`);
console.log(`✓ ${path.relative(ROOT, OUT)}`);
if (unmatched.length) {
  console.log(`\n${unmatched.length} unmatched — these keep the Sports-Reference modal:`);
  for (const u of unmatched.slice(0, VERBOSE ? unmatched.length : 15)) console.log(`  ${u}`);
  if (!VERBOSE && unmatched.length > 15) console.log(`  … ${unmatched.length - 15} more (--verbose to list)`);
}
