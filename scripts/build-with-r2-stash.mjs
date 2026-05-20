#!/usr/bin/env node
/**
 * Production build orchestrator for Netlify. Runs `npm run build`, then
 * strips R2-mirrored data subdirs out of out/ from inside the same Node
 * process so Netlify can't skip it.
 *
 * Background: the original setup relied on either an `npm postbuild`
 * lifecycle hook or a `command = "npm run build && node strip..."` chain
 * in netlify.toml. Neither fired on Netlify — the upload phase ballooned
 * to ~162k files and blew the 18-minute build budget. Doing the strip
 * directly inside the build command's Node process avoids whatever
 * runtime path was skipping the other approaches.
 *
 * We do NOT remove the R2 subdirs from public/ before the build:
 * `generateStaticParams` for team/player pages needs to read those JSONs
 * to enumerate slugs and render content. Stashing them out broke every
 * `/teams/<slug>/` page (404'd because readTeam returned null).
 *
 * Mirror DIRS with R2_DIRS in src/lib/data-url.ts when adding new R2
 * subdirs.
 */
import { rm, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "out");

const STRIP_DIRS = [
  "data/team-games",
  "data/player-games",
  "data/player",
  "data/player-ranks",
  "data/tournament-box",
  "data/team",
];

async function main() {
  console.log("→ npm run build…");
  const exitCode = await new Promise((resolve) => {
    const child = spawn("npm", ["run", "build"], {
      stdio: "inherit",
      shell: true,
      cwd: ROOT,
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) {
    console.error(`✗ build failed (exit ${exitCode})`);
    process.exit(exitCode);
  }

  console.log("\n→ Stripping R2-mirrored dirs from out/…");
  let stripped = 0;
  for (const d of STRIP_DIRS) {
    const full = path.join(OUT, d);
    try {
      await rm(full, { recursive: true, force: true });
      console.log(`   stripped ${d}`);
      stripped++;
    } catch (e) {
      console.warn(`   could not strip ${d}: ${e.message}`);
    }
  }

  // Next 16 emits an RSC prefetch payload (.txt) alongside every page —
  // ~8 per route, 192k files total at our page count. They're optional:
  // pages render fine without them, only <Link> client-nav prefetch is
  // affected (falls back to a full nav, ~100ms slower). Stripping them
  // cuts the Netlify CLI upload from 215k files to 32k, turning what
  // was a 30-minute upload into a sub-2-minute one.
  console.log("\n→ Stripping Next RSC .txt prefetch payloads from out/…");
  let txtRemoved = 0;
  async function rmTxtRecursive(dir) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await rmTxtRecursive(full);
      else if (e.name.endsWith(".txt")) {
        await rm(full, { force: true });
        txtRemoved++;
      }
    }
  }
  await rmTxtRecursive(OUT);
  console.log(`   removed ${txtRemoved.toLocaleString()} .txt files`);

  console.log(`\n✓ Stripped ${stripped}/${STRIP_DIRS.length} R2 dirs + ${txtRemoved.toLocaleString()} .txt files. Build complete.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
