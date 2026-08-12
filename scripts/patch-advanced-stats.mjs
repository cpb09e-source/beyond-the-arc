#!/usr/bin/env node
/**
 * Re-stamp `advanced_stats` into the two exports that carry it, from a
 * freshly rebuilt public/data/player-season-adv.json.
 *
 * WHY THIS EXISTS: `advanced_stats` is a pure lookup —
 * `adv[`${bartId}|${year}`] ?? null` — but the only thing that writes it is
 * export-static-data.mts, which pulls every player row from Supabase and
 * rewrites the whole export. When the only thing that changed is the
 * Bart↔CBBD join (see scripts/lib/cbbd-join.mjs), that is a network round
 * trip and a full rewrite to update one derived field.
 *
 * So this patches in place instead: same lookup, same shape, no upstream
 * read. It is not a replacement for the full export — it cannot add or
 * remove players, only re-stamp the field on players that already exist.
 *
 * Usage: node scripts/patch-advanced-stats.mjs [--dry]
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "public/data");
const ADV = path.join(DATA, "player-season-adv.json");
const dry = process.argv.includes("--dry");

const adv = JSON.parse(fs.readFileSync(ADV, "utf8"));
const advCount = Object.keys(adv).length;

// Same guard as the rank prune: a lookup table that came back empty means the
// upstream build failed, and stamping null over every player would look like a
// successful run that silently deleted the column.
if (advCount === 0) {
  console.error("✗ player-season-adv.json is empty — refusing to blank every advanced_stats. Rebuild it first.");
  process.exit(1);
}
console.log(`${advCount.toLocaleString()} player-seasons in the lookup${dry ? "  (DRY RUN)" : ""}\n`);

const at = (bartId, year) => adv[`${bartId}|${year}`] ?? null;
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

let ybFiles = 0, ybRows = 0, ybChanged = 0;
for (const f of fs.readdirSync(path.join(DATA, "players-by-year")).filter((f) => f.endsWith(".json"))) {
  const fp = path.join(DATA, "players-by-year", f);
  const rows = JSON.parse(fs.readFileSync(fp, "utf8"));
  let touched = 0;
  for (const p of rows) {
    ybRows++;
    const next = at(p.bart_player_id, p.year);
    if (same(p.advanced_stats, next)) continue;
    p.advanced_stats = next;
    touched++;
  }
  if (touched && !dry) fs.writeFileSync(fp, JSON.stringify(rows));
  if (touched) { ybFiles++; ybChanged += touched; }
}
console.log(`players-by-year: ${ybChanged.toLocaleString()} of ${ybRows.toLocaleString()} rows re-stamped across ${ybFiles} files`);

let pFiles = 0, pRows = 0, pChanged = 0, gained = 0, lost = 0;
const PDIR = path.join(DATA, "player");
for (const f of fs.readdirSync(PDIR).filter((f) => f.endsWith(".json"))) {
  const fp = path.join(PDIR, f);
  let j;
  try { j = JSON.parse(fs.readFileSync(fp, "utf8")); } catch { continue; }
  if (!Array.isArray(j.seasons)) continue;
  let touched = 0;
  for (const s of j.seasons) {
    pRows++;
    const next = at(j.bart_player_id, s.year);
    if (same(s.advanced_stats, next)) continue;
    if (s.advanced_stats == null && next != null) gained++;
    if (s.advanced_stats != null && next == null) lost++;
    s.advanced_stats = next;
    touched++;
  }
  if (touched && !dry) fs.writeFileSync(fp, JSON.stringify(j));
  if (touched) { pFiles++; pChanged += touched; }
}
console.log(`player/*.json : ${pChanged.toLocaleString()} of ${pRows.toLocaleString()} seasons re-stamped across ${pFiles.toLocaleString()} files`);
console.log(`                ${gained.toLocaleString()} gained advanced stats, ${lost.toLocaleString()} lost them`);
if (lost > 0) console.log(`\n⚠ ${lost} player-seasons LOST advanced stats — expected 0 when only the join widened.`);
console.log(dry ? "\n(dry run — nothing written)" : "\n✓ done");
