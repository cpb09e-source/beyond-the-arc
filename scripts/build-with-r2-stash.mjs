#!/usr/bin/env node
/**
 * Production build wrapper. Temporarily moves R2-mirrored data directories
 * OUT of public/ before invoking `npm run build`, then moves them back
 * (even on failure). Keeps Next.js from copying ~153k JSON files into
 * out/, where the strip-r2-mirrored-from-out.mjs postbuild step wasn't
 * firing reliably on Netlify — leaving the deploy with ~160k files to
 * upload and blowing the 18-minute build budget.
 *
 * Why a wrapper instead of just relying on postbuild:
 *   - Cleanup-after-the-fact is best-effort. Some Netlify Next.js Runtime
 *     plugin path was skipping the npm `postbuild` hook AND ignoring
 *     `&& node ...` chained into the build command in netlify.toml.
 *   - Stashing the dirs BEFORE the build is preventive: those files
 *     literally can't end up in out/ because they don't exist in public/
 *     at build time.
 *
 * The mirrored dirs all live on R2 in production (see src/lib/data-url.ts
 * + scripts/sync-data-to-r2.mjs). Build-time server code that needs to
 * read them does so directly from public/data/ — but the team page now
 * uses pre-embedded roster_ranks, so the only build-time read paths that
 * touched these subdirs at all are gone.
 *
 * Local dev: harmless. The script restores dirs in a finally block, so
 * if you run `node scripts/build-with-r2-stash.mjs` locally the files
 * end up exactly where they started.
 */
import { rename, mkdir, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const ROOT = process.cwd();
const PUBLIC_DATA = path.join(ROOT, "public", "data");
const STASH = path.join(ROOT, ".r2-stash");

// Must match R2_DIRS in src/lib/data-url.ts. If you add a new R2-served
// data subdir, add it here too.
const DIRS = [
  "team-games",
  "player-games",
  "player",
  "player-ranks",
  "tournament-box",
  "team",
];

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function moveIfPresent(from, to) {
  if (!(await exists(from))) return false;
  await rename(from, to);
  return true;
}

async function main() {
  await mkdir(STASH, { recursive: true });

  console.log("→ Stashing R2-mirrored dirs out of public/data/…");
  const stashed = [];
  for (const d of DIRS) {
    const moved = await moveIfPresent(path.join(PUBLIC_DATA, d), path.join(STASH, d));
    if (moved) {
      stashed.push(d);
      console.log(`   stashed ${d}`);
    } else {
      console.log(`   (skip ${d}: not present)`);
    }
  }

  let exitCode = 1;
  try {
    console.log("\n→ npm run build…");
    exitCode = await new Promise((resolve) => {
      const child = spawn("npm", ["run", "build"], {
        stdio: "inherit",
        shell: true,
        cwd: ROOT,
      });
      child.on("close", (code) => resolve(code ?? 1));
    });
  } finally {
    console.log("\n→ Restoring stashed dirs back into public/data/…");
    for (const d of stashed) {
      try {
        await rename(path.join(STASH, d), path.join(PUBLIC_DATA, d));
        console.log(`   restored ${d}`);
      } catch (e) {
        console.warn(`   could not restore ${d}: ${e.message}`);
      }
    }
  }

  console.log(`\n✓ build exited with code ${exitCode}`);
  process.exit(exitCode);
}

main().catch((e) => { console.error(e); process.exit(1); });
