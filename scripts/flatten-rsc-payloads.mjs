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
 * loop — each miss is requested once. What is lost is the prefetch.
 *
 * DO NOT WIRE THIS INTO THE BUILD. Measured, the 404s are cheaper than the fix.
 * Serving out/ locally and loading one player page:
 *
 *                        .txt requests   .txt bytes
 *   flat aliases present       29           232 KB
 *   404s (production today)    29            36 KB
 *
 * Same request count either way — the difference is that the misses transfer
 * nothing while the hits pull a full __PAGE__ payload for every link on the
 * page. Those payloads are not small: a team page's __PAGE__.txt is 188 KB, the
 * whole route's index.txt is 196 KB. So repairing the prefetch costs about
 * 196 KB of speculative download on EVERY page view, to preload four to six
 * destinations a reader will mostly not visit.
 *
 * The other side, also measured: without the aliases a click-through fetches
 * 81 KB at click time and navigates fine. So a visitor who reads one page and
 * clicks one link transfers 117 KB as things stand, against 232 KB with the
 * aliases in place. The fix only pays for a reader who clicks three or more of
 * the prefetched links from the same page.
 *
 * What the 404s actually cost, then: noise in the access log, and one deferred
 * fetch at click time instead of an early one. Both cheaper than the cure.
 *
 * The script stays because the diagnosis is worth keeping and because it is the
 * right fix if the trade ever changes — if a future Next version prefetches
 * segments rather than whole pages, these aliases become small and worth
 * having.
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
