#!/usr/bin/env node
/**
 * Postbuild: delete R2-mirrored data dirs from out/ before Netlify uploads.
 *
 * Next.js copies /public into /out at build time, including ~152k JSON files
 * we now serve from R2. Leaving them in out/ would re-introduce the upload
 * timeout we set R2 up to fix. We nuke them after build, after Netlify's
 * publish dir is finalized.
 *
 * Mirrors the R2_DIRS list in src/lib/data-url.ts — if you add an R2-served
 * dir there, add it here too.
 */
import { rm } from "node:fs/promises";
import path from "node:path";

const OUT = "out";
const DIRS = [
  "data/team-games",
  "data/player-games",
  "data/player",
  "data/player-ranks",
  "data/tournament-box",
  "data/team",
];

let removed = 0;
for (const d of DIRS) {
  const full = path.join(OUT, d);
  try {
    await rm(full, { recursive: true, force: true });
    console.log(`  stripped ${full}`);
    removed++;
  } catch (e) {
    console.warn(`  could not strip ${full}: ${e.message}`);
  }
}
console.log(`Stripped ${removed}/${DIRS.length} dirs from ${OUT}/.`);
