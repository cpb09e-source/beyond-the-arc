#!/usr/bin/env node
/**
 * build-player-photo-index.mjs — normalized player name → our bart player id,
 * for every player in a season who actually has a headshot on disk.
 *
 *   public/data/player-photo-index/<season>.json   { "<norm name>": bartId }
 *
 * WHY THIS EXISTS: the game pages read their box scores live from CBBD, which
 * keys athletes on its own ids — and on TWO of them (the box uses `athleteId`,
 * the play-by-play uses a different, smaller id for the same player). Neither
 * is our `bart_player_id`, which is what src/data/player-photos.json and every
 * player URL on the site are keyed by. Names are the only field the two worlds
 * share, so the join has to run through them.
 *
 * WHY NAME ONLY, NOT NAME + TEAM: team strings disagree across providers
 * ("Oregon State" vs "Oregon St.", "Miami" vs "Miami FL"), so keying on the
 * pair would need the alias table and would fail open — quietly dropping
 * matches. Names are near-unique inside a season: 4,604 distinct names among
 * 4,630 players with photos for 2026, i.e. 23 collisions.
 *
 * AMBIGUOUS NAMES ARE DROPPED, NOT GUESSED. Two players called Josh Smith get
 * no entry at all, so the UI falls back to a monogram. Showing a photo of the
 * wrong person is far worse than showing no photo, and 0.5% of players losing
 * a headshot is a cheap price for never being wrong.
 *
 * ONLY PLAYERS WITH A PHOTO ARE INCLUDED — the file's only consumer is the
 * headshot lookup, so an entry for someone we have no image of is dead weight.
 *
 * Run: node scripts/build-player-photo-index.mjs [season...]
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "public/data/player-photo-index");
const SEASONS = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2022, 2023, 2024, 2025, 2026];

/** Same shape of normalization the CBBD joins elsewhere use: fold accents,
 *  drop punctuation and suffixes, collapse whitespace, lowercase. */
export function normName(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, " ")
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const photos = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/player-photos.json"), "utf8"));
const wanted = process.argv.slice(2).map(Number).filter(Boolean);
const seasons = wanted.length > 0 ? wanted : SEASONS;

fs.mkdirSync(OUT_DIR, { recursive: true });

for (const season of seasons) {
  const src = path.join(ROOT, `public/data/players-by-year/${season}.json`);
  if (!fs.existsSync(src)) {
    console.warn(`· ${season}: no players-by-year file, skipped`);
    continue;
  }
  const rows = JSON.parse(fs.readFileSync(src, "utf8"));

  // First pass counts each name so collisions can be dropped wholesale.
  const counts = new Map();
  for (const p of rows) {
    if (!p?.bart_player_id || !photos[String(p.bart_player_id)]) continue;
    const k = normName(p.name);
    if (!k) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  const out = {};
  let dropped = 0;
  for (const p of rows) {
    if (!p?.bart_player_id || !photos[String(p.bart_player_id)]) continue;
    const k = normName(p.name);
    if (!k) continue;
    if (counts.get(k) > 1) { dropped++; continue; }
    out[k] = p.bart_player_id;
  }

  const dest = path.join(OUT_DIR, `${season}.json`);
  fs.writeFileSync(dest, JSON.stringify(out));
  const kb = (fs.statSync(dest).size / 1024).toFixed(0);
  console.log(`✓ ${season}: ${Object.keys(out).length} names, ${dropped} ambiguous dropped (${kb} KB)`);
}
