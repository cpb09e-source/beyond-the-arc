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
import { spawn } from "node:child_process";
import path from "node:path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "out");

const STRIP_DIRS = [
  "data/player-games",
  "data/player",
  "data/player-ranks",
  "data/tournament-box",
  "data/team",
  // These two were R2-served but missing from this list (present in
  // strip-r2-mirrored-from-out.mjs) — game-players since it shipped, shots
  // since 2026-07. Harmless while absent (just re-uploaded dead weight), but
  // the lists are supposed to mirror R2_DIRS in src/lib/data-url.ts exactly.
  "data/game-players",
  "data/shots",
];

/**
 * Not R2-mirrored — build-time inputs that no browser asks for, so shipping
 * them is pure upload weight.
 *
 * players-by-year is the Supabase row for every player-season (48 MB across 13
 * files). readPlayersForYear() reads it off the filesystem to build the team
 * pages, and 19 pipeline scripts read it offline, so it stays in public/ — but
 * since /players moved to the slim players-explorer payload nothing fetches it
 * over the network any more.
 */
const BUILD_ONLY_DIRS = ["data/players-by-year"];

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

  console.log(`\n✓ Stripped ${stripped}/${STRIP_DIRS.length} R2 dirs. Build complete.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
