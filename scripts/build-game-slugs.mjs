#!/usr/bin/env node
/**
 * build-game-slugs.mjs — the id → URL map the browser needs to link a game.
 *
 *   node scripts/build-game-slugs.mjs
 *
 * Writes public/data/scoreboard/<season>/slugs.json for every season the
 * archive holds, from the index.json that scripts/build-scoreboard-archive.mts
 * already wrote. Idempotent; re-run it after any archive build.
 *
 * WHY THIS FILE HAS TO EXIST. A game page's URL carries both team names —
 * /games/2026/212784-queens-university-vs-winthrop/ — and the only place those
 * exact spellings live is CBBD's schedule. The game LOGS the rest of the site
 * runs on spell teams differently: "Morgan St" against the schedule's "Morgan
 * State", "Queens" against "Queens University", "IU Indy" against "IU
 * Indianapolis". Measured on 2025-26, building a slug from log names gets 41%
 * of them wrong — and a wrong slug is a 404, not a near miss.
 *
 * So anything linking to a game resolves through this map rather than guessing.
 * One file per season, fetched once and only when a link is actually wanted.
 * ~5,900 entries is ~250 KB raw and ~55 KB over the wire.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dir = path.join(root, "public", "data", "scoreboard");

function teamSlug(name) {
  return String(name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

if (!fs.existsSync(dir)) {
  console.error(`No archive at ${path.relative(root, dir)} — run build-scoreboard-archive first.`);
  process.exit(1);
}

let seasons = 0, total = 0;
for (const season of fs.readdirSync(dir).filter((d) => /^\d{4}$/.test(d)).sort()) {
  const indexFile = path.join(dir, season, "index.json");
  if (!fs.existsSync(indexFile)) continue;
  const idx = JSON.parse(fs.readFileSync(indexFile, "utf8"));
  const slugs = {};
  for (const g of idx.games ?? []) {
    // The id leads the URL and is stored separately, so only the name half
    // goes in the map — half the bytes for the same answer.
    slugs[g.id] = `${teamSlug(g.away.team)}-vs-${teamSlug(g.home.team)}`;
  }
  const out = path.join(dir, season, "slugs.json");
  fs.writeFileSync(out, JSON.stringify({ season: Number(season), slugs }));
  const kb = (fs.statSync(out).size / 1024).toFixed(0);
  console.log(`  ${season}: ${Object.keys(slugs).length} games, ${kb} KB`);
  seasons++;
  total += Object.keys(slugs).length;
}
console.log(`wrote slugs.json for ${seasons} seasons, ${total.toLocaleString()} games`);
