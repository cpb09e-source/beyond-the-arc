#!/usr/bin/env node
/**
 * flatten-rsc-payloads.mjs — give every nested RSC segment payload a flat alias.
 *
 *   node scripts/flatten-rsc-payloads.mjs [outDir]
 *
 * THE BUG. Next 16's static export writes per-segment RSC payloads as nested
 * directories:
 *
 *   out/teams/arkansas/__next.teams/$d$slug.txt
 *   out/teams/arkansas/__next.teams/$d$slug/__PAGE__.txt
 *
 * but the App Router asks for them DOT-JOINED:
 *
 *   /teams/arkansas/__next.teams.$d$slug.txt          → 404
 *   /teams/arkansas/__next.teams.$d$slug.__PAGE__.txt → 404
 *
 * Every one of those misses. Measured on this build: 26,845 nested payloads,
 * two requests each, 53,690 404s — which matches the count seen in production
 * exactly. Reproduced locally by serving `out/` with a plain static server and
 * loading a player page.
 *
 * It is not fatal. The pages render, and unlike the missing-.txt incident of
 * May 2026 (see the note in scripts/build-with-r2-stash.mjs) there is no retry
 * loop — each miss is requested once. What is lost is the prefetch: a client
 * navigation that should have been served from a cached segment payload falls
 * back to fetching more than it needed, and the access log fills with 404s.
 *
 * THE FIX IS PURELY ADDITIVE. It copies, never moves and never deletes, so the
 * nested files every working request already uses stay exactly where they are.
 * That matters here more than usual: stripping .txt files from this build once
 * put the site into an infinite 404 retry loop, and the rule since has been to
 * only ever add.
 *
 * Netlify redirects cannot express this: rules match slash-delimited segments,
 * and the mapping needs a dot-to-slash translation inside one segment.
 */
import fs from "node:fs";
import path from "node:path";

const outDir = process.argv[2] ?? "out";
if (!fs.existsSync(outDir)) {
  console.error(`${outDir}/ not found — run the build first.`);
  process.exit(1);
}

let written = 0, skipped = 0, bytes = 0;

/** Every .txt under `dir`, as paths relative to it. */
function txtFilesUnder(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...txtFilesUnder(full, base));
    else if (e.name.endsWith(".txt")) out.push(path.relative(base, full));
  }
  return out;
}

/**
 * Walk the export looking for `__next.<segment>` DIRECTORIES. Everything inside
 * one is a nested payload that also needs to exist dot-joined beside it.
 */
function walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const full = path.join(dir, e.name);
    if (e.name.startsWith("__next.")) {
      for (const rel of txtFilesUnder(full)) {
        // __next.teams  +  $d$slug/__PAGE__.txt  →  __next.teams.$d$slug.__PAGE__.txt
        const flat = `${e.name}.${rel.split(path.sep).join(".")}`;
        const dest = path.join(dir, flat);
        if (fs.existsSync(dest)) { skipped++; continue; }
        fs.copyFileSync(path.join(full, rel), dest);
        bytes += fs.statSync(dest).size;
        written++;
      }
      // A __next.* directory can itself contain deeper __next.* directories.
      walk(full);
    } else {
      walk(full);
    }
  }
}

walk(outDir);

console.log(
  `flattened ${written} RSC segment payloads` +
  (skipped ? ` (${skipped} already present)` : "") +
  ` — ${(bytes / 1e6).toFixed(1)} MB added`,
);
