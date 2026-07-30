/**
 * flatten-rsc-segment-files.mjs — rename Next 16's segment-prefetch payloads
 * from the layout the export writes to the one its own client asks for.
 *
 * THE BUG. In `output: "export"` mode the client cannot send the segment path
 * as a header, so it appends it to the pathname using this encoder
 * (node_modules/next/dist/shared/lib/segment-cache/segment-value-encoding.js):
 *
 *     function convertSegmentPathToStaticExportFilename(segmentPath) {
 *       return `__next${segmentPath.replace(/\//g, '.')}.txt`;
 *     }
 *
 * Slashes become dots. The build, however, writes the un-flattened form — the
 * slash-joined segment key, as nested directories. So every prefetch 404s:
 *
 *     browser asks   /players/__next.players.__PAGE__.txt          404
 *     build wrote    /players/__next.players/__PAGE__.txt          exists
 *
 * The nesting is deliberate but only for humans. From the comment on
 * appendSegmentRequestKeyPart in that same file: "segment keys are also designed
 * so that each segment and parallel route creates its own subdirectory ... This
 * is mostly just for easier debugging (you can open up the build folder and
 * navigate the output); if we wanted to do we could just use a flat structure."
 *
 * On a static host there is no server to bridge the two, so the wire format has
 * to BE the storage format. This applies the encoder the client uses, which is
 * why the transform is a faithful copy of it rather than a guess.
 *
 * Measured on the 2026-07-29 build: 49,061 files across three nesting depths
 * (`__next.calc/__PAGE__.txt`, `__next.coaches/$d$slug/__PAGE__.txt`,
 * `__next.teams/$d$slug/$d$year/__PAGE__.txt`), producing ~70 failed requests
 * on a single home-page load.
 *
 * NOT a file-count reduction — the same files come out the other side under new
 * names, so this does nothing for the ~45-minute deploys. What it buys is
 * working prefetch: navigations resolve from cache instead of falling back to a
 * full document fetch, and the console stops filling with 404s.
 *
 * Idempotent: a second run finds no `__next.*` directories and does nothing.
 *
 * Usage: node scripts/flatten-rsc-segment-files.mjs [--dry-run] [outDir]
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const OUT = path.resolve(args.find((a) => !a.startsWith("--")) ?? "out");

/**
 * Every file living under a `__next.*` directory, with the flat name it should
 * have. Walks iteratively — a recursive walk over ~225k entries is fine on
 * depth but this is simpler to reason about.
 */
function collect(root) {
  const moves = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name.startsWith("__next.")) {
          // Everything below this point belongs in one flat filename beside it.
          for (const rel of filesUnder(full)) {
            const flat = `${e.name}.${rel.split(path.sep).join(".")}`;
            moves.push({ from: path.join(full, rel), to: path.join(dir, flat) });
          }
        } else {
          stack.push(full);
        }
      }
    }
  }
  return moves;
}

/** Relative paths of every file beneath `dir`, at any depth. */
function filesUnder(dir) {
  const out = [];
  const stack = [""];
  while (stack.length > 0) {
    const rel = stack.pop();
    const abs = path.join(dir, rel);
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const childRel = rel ? path.join(rel, e.name) : e.name;
      if (e.isDirectory()) stack.push(childRel);
      else out.push(childRel);
    }
  }
  return out;
}

function main() {
  if (!fs.existsSync(OUT)) {
    console.error(`  ABORTED: ${OUT} does not exist. Run the build first.`);
    process.exit(1);
  }

  const moves = collect(OUT);
  if (moves.length === 0) {
    console.log("  no nested __next.* segment files found (already flat, or none emitted)");
    return;
  }

  console.log(`  ${moves.length} segment files to flatten. Sample:`);
  for (const m of moves.slice(0, 3)) {
    console.log(`    ${path.relative(OUT, m.from)}`);
    console.log(`      -> ${path.relative(OUT, m.to)}`);
  }

  if (dryRun) {
    console.log("\n  --dry-run: nothing written");
    return;
  }

  // Collisions would mean the flat name is already taken by a real file, which
  // should be impossible (the flat forms are the ones 404ing) — but silently
  // overwriting a payload is not a risk worth taking for zero benefit.
  let moved = 0;
  const collisions = [];
  for (const m of moves) {
    if (fs.existsSync(m.to)) { collisions.push(m.to); continue; }
    fs.renameSync(m.from, m.to);
    moved++;
  }

  // Remove the now-empty __next.* directory trees.
  let dirsRemoved = 0;
  const dirs = new Set(moves.map((m) => topNextDir(OUT, m.from)));
  for (const d of dirs) {
    try {
      fs.rmSync(d, { recursive: true });
      dirsRemoved++;
    } catch { /* left behind because something in it survived; harmless */ }
  }

  console.log(`\n  flattened ${moved} files, removed ${dirsRemoved} empty __next.* dirs`);
  if (collisions.length > 0) {
    console.warn(`  ⚠ ${collisions.length} skipped — flat name already existed:`);
    for (const c of collisions.slice(0, 5)) console.warn(`      ${path.relative(OUT, c)}`);
  }
  if (moved === 0) {
    console.error("  ABORTED: found files to flatten but moved none. Something is wrong.");
    process.exit(1);
  }
}

/** The `__next.*` directory nearest the root on this file's path. */
function topNextDir(root, file) {
  const parts = path.relative(root, file).split(path.sep);
  const i = parts.findIndex((p) => p.startsWith("__next."));
  return path.join(root, ...parts.slice(0, i + 1));
}

main();
