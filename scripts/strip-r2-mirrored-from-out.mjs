#!/usr/bin/env node
/**
 * Postbuild: delete R2-mirrored data dirs from out/ before Netlify uploads.
 *
 * Next.js copies /public into /out at build time, including ~152k JSON files
 * we now serve from R2. Leaving them in out/ would re-introduce the upload
 * timeout we set R2 up to fix. We nuke them after build, after Netlify's
 * publish dir is finalized.
 *
 * THE LISTS LIVE IN scripts/lib/out-strip-lists.mjs, not here. They used to be
 * written out in this file and again in build-with-r2-stash.mjs and again in
 * verify-deploy-ready.mjs, and the copies had already drifted — read that
 * file's header for what went missing and what it would have cost.
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import { ALL_STRIP_DIRS, BUILD_ONLY_FILES } from "./lib/out-strip-lists.mjs";

const OUT = "out";
const DIRS = ALL_STRIP_DIRS;
const FILES = BUILD_ONLY_FILES;

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

let removedFiles = 0;
for (const f of FILES) {
  const full = path.join(OUT, f);
  try {
    await rm(full, { force: true });
    console.log(`  stripped ${full}`);
    removedFiles++;
  } catch (e) {
    console.warn(`  could not strip ${full}: ${e.message}`);
  }
}
console.log(`Stripped ${removedFiles}/${FILES.length} files from ${OUT}/.`);
