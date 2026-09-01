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
import { rm } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { R2_MIRRORED_DIRS, BUILD_ONLY_DIRS, BUILD_ONLY_FILES } from "./lib/out-strip-lists.mjs";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "out");

/**
 * WHAT GETS STRIPPED LIVES IN scripts/lib/out-strip-lists.mjs.
 *
 * It used to live here as well, and the two copies drifted: this file — the
 * one netlify.toml names, and therefore the one that actually runs — was
 * missing data/team-season-games (4,631 files, 40 MB), data/live and
 * data/team-splits (~14 MB). The postbuild hook that knew about all three does
 * not fire when this script is invoked directly, which is exactly how it is
 * invoked. Read that file's header for the full account.
 */
const STRIP_DIRS = R2_MIRRORED_DIRS;

async function main() {
  // Regenerate the per-season shards the home page fetches at runtime BEFORE
  // building. They are derived wholly from teams-all.json, so leaving them to a
  // manual step means a data refresh silently serves last export's numbers on
  // the explorer while every server-rendered page shows the new ones — a
  // divergence with nothing to signal it. Cheap (a couple of seconds) and
  // idempotent, so it runs every build.
  console.log("→ node scripts/build-teams-by-year.mjs…");
  const shardCode = await new Promise((resolve) => {
    const child = spawn("node", ["scripts/build-teams-by-year.mjs"], {
      stdio: "inherit",
      shell: true,
      cwd: ROOT,
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
  if (shardCode !== 0) {
    console.error(`✗ teams-by-year shard build failed (exit ${shardCode})`);
    process.exit(shardCode);
  }

  // BTA points-over-replacement, from the CBBD box scores. Must run BEFORE the
  // explorer payload, which merges its output in as the bta_porpag column.
  console.log("\n→ node scripts/build-bta-porpag.mjs…");
  const porpagCode = await new Promise((resolve) => {
    const child = spawn("node", ["scripts/build-bta-porpag.mjs"], {
      stdio: "inherit",
      shell: true,
      cwd: ROOT,
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
  if (porpagCode !== 0) {
    console.error(`✗ bta-porpag build failed (exit ${porpagCode})`);
    process.exit(porpagCode);
  }

  // Same reasoning as the shards above: the explorer payload is derived wholly
  // from players-by-year, so regenerating it every build keeps the two from
  // drifting after a data refresh.
  console.log("\n→ node scripts/build-players-explorer.mjs…");
  const explorerCode = await new Promise((resolve) => {
    const child = spawn("node", ["scripts/build-players-explorer.mjs"], {
      stdio: "inherit",
      shell: true,
      cwd: ROOT,
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
  if (explorerCode !== 0) {
    console.error(`✗ players-explorer build failed (exit ${explorerCode})`);
    process.exit(explorerCode);
  }

  console.log("\n→ npm run build…");
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

  // Next writes its segment-prefetch payloads as nested directories but its own
  // client asks for the dot-flattened names, so every prefetch 404s until these
  // are renamed. See the header of the script for the encoder this mirrors.
  // Must run AFTER next build (it rewrites out/) and is idempotent.
  // The explorer's has_page flag is a port of readRankedPlayerIds(); this
  // checks it against the pages next build actually wrote, so a drifted port
  // fails the build instead of quietly restoring the 404 links.
  console.log("\n→ node scripts/verify-player-links.mjs…");
  const linkCode = await new Promise((resolve) => {
    const child = spawn("node", ["scripts/verify-player-links.mjs"], {
      stdio: "inherit",
      shell: true,
      cwd: ROOT,
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
  if (linkCode !== 0) {
    console.error(`✗ player-link verification failed (exit ${linkCode})`);
    process.exit(linkCode);
  }

  console.log("\n→ node scripts/flatten-rsc-segment-files.mjs…");
  const flattenCode = await new Promise((resolve) => {
    const child = spawn("node", ["scripts/flatten-rsc-segment-files.mjs"], {
      stdio: "inherit",
      shell: true,
      cwd: ROOT,
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
  if (flattenCode !== 0) {
    console.error(`✗ segment-file flatten failed (exit ${flattenCode})`);
    process.exit(flattenCode);
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

  // DO NOT strip Next 16's .txt files (the RSC payloads + __next._tree.txt
  // route manifest). They're not optional prefetches — the App Router
  // fetches them aggressively on hydration, and missing files cause an
  // infinite 404 retry loop on any page with <Link> children (broke
  // /coaches/ on the May 20 2026 deploy). The CLI upload of ~215k files
  // is slow but only happens once per data change; subsequent deploys
  // dedupe by content hash and finish in <2 min.

  console.log("\n→ Stripping build-only files from out/…");
  for (const f of BUILD_ONLY_FILES) {
    const full = path.join(OUT, f);
    try {
      await rm(full, { force: true });
      console.log(`   stripped ${f}`);
    } catch (e) {
      console.warn(`   could not strip ${f}: ${e.message}`);
    }
  }

  console.log("\n→ Stripping build-only dirs from out/…");
  for (const d of BUILD_ONLY_DIRS) {
    const full = path.join(OUT, d);
    try {
      await rm(full, { recursive: true, force: true });
      console.log(`   stripped ${d}`);
    } catch (e) {
      console.warn(`   could not strip ${d}: ${e.message}`);
    }
  }

  // The paywall, last: it deletes the paid seasons from out/ and stages them
  // for the function bundle. It runs AFTER the strips so nothing can put a
  // gated file back, and it exits non-zero if a paid season is still
  // published — a paywall that silently does not hold is worse than none.
  console.log("");
  const gate = spawnSync(process.execPath, [path.join(ROOT, "scripts/stage-gated-data.mjs")], { stdio: "inherit" });
  if (gate.status !== 0) throw new Error("stage-gated-data.mjs failed — refusing to finish the build");

  console.log(`\n✓ Stripped ${stripped}/${STRIP_DIRS.length} R2 dirs. Build complete.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
