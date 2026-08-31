#!/usr/bin/env node
/**
 * Move the paid seasons out of the website and into the function bundle.
 *
 * Run as part of the production build, AFTER `next build` and alongside the
 * R2 strip. Two things happen, and both must, or the paywall is a costume:
 *
 *   1. `gated-data/teams-by-year/<year>.json` is written from public/data.
 *      netlify.toml's `[functions] included_files` ships that directory with
 *      the function, where a URL cannot reach it.
 *   2. The same file is DELETED from `out/`. This is the half that actually
 *      does the work. Leaving it published means the function is a locked
 *      front door on a building with no walls — anyone can keep fetching
 *      /data/teams-by-year/2019.json directly and never meet the check.
 *
 * The policy lives in src/lib/access.ts and nowhere else. This script asks it
 * which seasons are paid and does as it is told, so the build cannot drift
 * from what the browser believes.
 *
 * IDEMPOTENT, and safe when the paywall is off: with every season free it
 * clears any previously staged files and leaves `out/` untouched, which is
 * what makes turning the paywall off a one-line edit rather than a cleanup.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "out");

/**
 * Read the season policy out of the TypeScript module.
 *
 * Parsed rather than imported: this script runs in plain Node with no
 * TypeScript loader, and adding tsx to the production build to read one array
 * is a dependency in the deploy path for no benefit. The shapes matched are
 * exactly the two the file documents, and an unreadable policy throws instead
 * of defaulting — a paywall that silently decides "everything is free"
 * because a regex missed is the failure that must not happen quietly.
 */
function readPolicy() {
  const src = fs.readFileSync(path.join(ROOT, "src/lib/access.ts"), "utf8");

  const free = src.match(/^export const FREE_SEASONS: readonly number\[\] = (.+?);$/m);
  if (!free) throw new Error("access.ts: could not find FREE_SEASONS");

  const seasons = fs.readFileSync(path.join(ROOT, "src/lib/seasons.ts"), "utf8");
  const floor = Number(seasons.match(/export const SEASON_FLOOR = (\d+)/)?.[1]);
  const ceil = Number(seasons.match(/export const SEASON_CEIL = (\d+)/)?.[1]);
  const preview = Number(seasons.match(/export const PREVIEW_SEASON = (\d+)/)?.[1]);
  const excluded = [...(seasons.match(/EXCLUDED_SEASONS[^=]*= new Set\(\[([^\]]*)\]/)?.[1] ?? "")
    .matchAll(/\d+/g)].map((m) => Number(m[0]));
  if (!floor || !ceil || !preview) throw new Error("seasons.ts: could not read the season window");

  const all = [];
  for (let y = floor; y <= ceil; y++) if (!excluded.includes(y)) all.push(y);

  const body = free[1].trim();
  // The inert default spreads the whole window; anything else is a literal list.
  const freeYears = body.includes("EXPLORER_SEASONS")
    ? all.slice()
    : [...body.matchAll(/\d{4}/g)].map((m) => Number(m[0]));
  if (!body.includes("EXPLORER_SEASONS") && freeYears.length === 0) {
    throw new Error("access.ts: FREE_SEASONS parsed as empty — refusing to gate every season");
  }

  freeYears.push(preview); // always free, per isSeasonFree
  return { all, paid: all.filter((y) => !freeYears.includes(y)) };
}

const { all, paid } = readPolicy();

/**
 * The corpora to stage. MIRRORS GATED_CORPORA in src/lib/access.ts — a dir
 * added there and forgotten here is a season the browser asks the function
 * for and the function does not have, which reads to a paying subscriber as a
 * broken table.
 *
 * game-index is deliberately absent: 7 MB a season would put ~77 MB of the
 * Game Log Explorer's corpus into a function bundle capped at 50 MB zipped.
 * That page is product-gated instead.
 */
const CORPORA = ["teams-by-year", "players-explorer"];

// Always start clean: a season that just became free must not be left behind
// in the bundle, where it would keep being served through the function to
// nobody, and must not be missing from out/, where it now belongs.
fs.rmSync(path.join(ROOT, "gated-data"), { recursive: true, force: true });

if (paid.length === 0) {
  console.log(`→ Paywall is OFF — all ${all.length} seasons stay public. Nothing staged.`);
  process.exit(0);
}

let staged = 0;
let removed = 0;
for (const corpus of CORPORA) {
  const gatedDir = path.join(ROOT, "gated-data", corpus);
  fs.mkdirSync(gatedDir, { recursive: true });
  for (const year of paid) {
    const src = path.join(ROOT, "public/data", corpus, `${year}.json`);
    if (!fs.existsSync(src)) {
      console.warn(`   ! ${corpus}/${year}.json missing from public/data — skipped`);
      continue;
    }
    fs.copyFileSync(src, path.join(gatedDir, `${year}.json`));
    staged++;

    const published = path.join(OUT, "data", corpus, `${year}.json`);
    if (fs.existsSync(published)) {
      fs.rmSync(published);
      removed++;
    }
  }
}

console.log(`→ Gated ${paid.length} season(s): ${paid.join(", ")}`);
console.log(`   staged into gated-data/  ${staged}`);
console.log(`   removed from out/        ${removed}`);

// The check that matters. If a paid season is still published, the function is
// decorative — fail the build rather than deploy a paywall that does nothing.
// EVERY corpus is checked: a gate that holds on teams and leaks on players is
// not a gate, and the leak would be invisible from the team explorer.
const leaked = [];
for (const corpus of CORPORA) {
  for (const y of paid) {
    if (fs.existsSync(path.join(OUT, "data", corpus, `${y}.json`))) leaked.push(`${corpus}/${y}`);
  }
}
if (leaked.length) {
  console.error(`✗ STILL PUBLIC in out/: ${leaked.join(", ")} — the gate would not hold.`);
  process.exit(1);
}
const expected = paid.length * CORPORA.length;
if (staged !== expected) {
  console.error(`✗ Staged ${staged} of ${expected} paid season files — the gate would 404 for subscribers.`);
  process.exit(1);
}
console.log("✓ Paid seasons are out of the published site and inside the function bundle.");
