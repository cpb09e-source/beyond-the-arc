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
import { rm, writeFile, rename, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { R2_MIRRORED_DIRS, BUILD_ONLY_DIRS, BUILD_ONLY_FILES, PAGE_MIRRORED_DIRS } from "./lib/out-strip-lists.mjs";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "out");

/**
 * --skip-build resumes the POST-BUILD half against an out/ that already exists.
 *
 * Why this exists: on 2026-09-10 the build was killed three times at
 * "Finalizing page optimization" with no error text at all — not a Node
 * exception, the whole process tree going down. It was Windows reclaiming
 * memory: free physical RAM measured 3.1 GB and falling at that step, against
 * an editor holding ~6 GB and a build asking for an 8 GB heap. `npm run build`
 * on its own then completed, leaving a finished out/ and none of the steps
 * below run — two of which (the RSC flatten and the paywall staging) are
 * load-bearing, so out/ was NOT deployable and also not obviously broken.
 *
 * Redoing eight minutes of prerendering to reach them is the wrong answer, so:
 *
 *     node scripts/build-with-r2-stash.mjs --skip-build
 *
 * It skips the three derive scripts and `next build`, and runs everything from
 * verify-player-links onward. Only use it when out/ came from the CURRENT
 * source — it cannot tell, and a stale out/ will sail straight through.
 */
const SKIP_BUILD = process.argv.includes("--skip-build");

/**
 * REFUSE TO START A BUILD THAT THE MACHINE CANNOT FINISH.
 *
 * On 2026-09-10 three builds died at "Finalizing page optimization" with no
 * error output whatsoever — no Node exception, no heap message, the whole
 * process tree going down at once, including this orchestrator. That last part
 * is the tell: Node does not kill its own parent. Windows was reclaiming
 * memory.
 *
 * Measured during the failing step: free physical RAM at 3.1 GB and falling,
 * from 10.9 GB at the start. The build itself sat around 4.7 GB resident, the
 * editor was holding ~6 GB, and `next build` is handed an 8 GB heap ceiling it
 * will happily grow into. Each of those is fine alone.
 *
 * The cost of finding this out the hard way is ~8 minutes of prerendering
 * before anything fails, so it is worth two lines to check up front. This is a
 * FLOOR, not a prediction: it does not know how big the site has become, only
 * that the last known-good run needed roughly 8 GB of headroom over its
 * lifetime.
 *
 * `--force` skips the check, for when you know better than a number written in
 * September 2026.
 */
const GB = 1024 ** 3;
const WARN_FREE_GB = 12;
const REFUSE_FREE_GB = 8;

function checkMemory() {
  if (process.argv.includes("--force")) return;
  const freeGb = os.freemem() / GB;
  const totalGb = os.totalmem() / GB;
  if (freeGb >= WARN_FREE_GB) return;

  const line = `free RAM ${freeGb.toFixed(1)} GB of ${totalGb.toFixed(1)} GB`;
  if (freeGb < REFUSE_FREE_GB) {
    console.error(`
✗ Not enough memory to build — ${line}.`);
    console.error(`  A build of this site needs about ${REFUSE_FREE_GB} GB of headroom and takes`);
    console.error("  ~8 minutes to reach the step that runs out. Close what you can (an editor");
    console.error("  with a large workspace is usually the biggest single consumer) and retry.");
    console.error("  If the build then dies anyway AFTER `next build` prints its route table,");
    console.error("  resume with --skip-build rather than starting over.");
    console.error("  Override with --force.");
    console.error("");
    process.exit(1);
  }
  console.warn(`
⚠ Low memory — ${line}.`);
  console.warn(`  Builds have been killed silently below about ${REFUSE_FREE_GB} GB free. Continuing,`);
  console.warn('  but if this dies with no error at "Finalizing page optimization", that is why.');
  console.warn("");
}

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
  if (!SKIP_BUILD) checkMemory();

  if (SKIP_BUILD) {
    if (!existsSync(OUT)) {
      console.error("✗ --skip-build needs an existing out/. There is none.");
      process.exit(1);
    }
    console.log("--skip-build: resuming from verify-player-links against the existing out/.");
    console.log("");
  }

  // Regenerate the per-season shards the home page fetches at runtime BEFORE
  // building. They are derived wholly from teams-all.json, so leaving them to a
  // manual step means a data refresh silently serves last export's numbers on
  // the explorer while every server-rendered page shows the new ones — a
  // divergence with nothing to signal it. Cheap (a couple of seconds) and
  // idempotent, so it runs every build.
  if (!SKIP_BUILD) {
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

  /**
   * WHICH COMMIT THIS IS. A static export carries no build metadata, so a
   * deployed site cannot say what it was built from — and this site is
   * deployed by hand, which means "is what is live current" is a real
   * question with no other answer. The admin page reads this and asks GitHub
   * how far main has moved past it.
   *
   * It is written before the strips run, not after, only because it must not
   * be in a directory any of them touch: out/build-info.json is a top-level
   * file and nothing strips it. `dirty` is here because a build from a tree
   * with uncommitted changes is NOT the commit it names, and a deploy that
   * quietly disagrees with the repository is the thing worth knowing.
   */
  const git = (args) => spawnSync("git", args, { cwd: ROOT, encoding: "utf8" }).stdout?.trim() ?? "";
  const buildInfo = {
    sha: git(["rev-parse", "HEAD"]),
    branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
    builtAt: new Date().toISOString(),
    // TRACKED changes only. Five files sit permanently untracked in this
    // working tree (a stray deno.lock, two scratch .html, two source .ai/.svg)
    // and none of them reach the build, so counting them would mark every
    // deploy dirty and the flag would stop meaning anything.
    dirty: git(["status", "--porcelain", "--untracked-files=no"]).length > 0,
  };
  if (buildInfo.sha) {
    await writeFile(path.join(OUT, "build-info.json"), JSON.stringify(buildInfo));
    console.log(`\n→ build-info.json — ${buildInfo.sha.slice(0, 7)} on ${buildInfo.branch}${buildInfo.dirty ? " (dirty)" : ""}`);
  } else {
    console.log("\n→ No git metadata; skipping build-info.json.");
  }

  // The paywall, last: it deletes the paid seasons from out/ and stages them
  // for the function bundle. It runs AFTER the strips so nothing can put a
  // gated file back, and it exits non-zero if a paid season is still
  // published — a paywall that silently does not hold is worse than none.
  console.log("");
  const gate = spawnSync(process.execPath, [path.join(ROOT, "scripts/stage-gated-data.mjs")], { stdio: "inherit" });
  if (gate.status !== 0) throw new Error("stage-gated-data.mjs failed — refusing to finish the build");

  /**
   * The game pages MOVE out of the deploy rather than being deleted, because
   * something still has to upload them. See PAGE_MIRRORED_DIRS for why they
   * cannot ship (743,070 files broke Netlify's CDN diff twice).
   *
   * A move, not a copy: leaving them in out/ is exactly the failure this is
   * here to prevent, and a half-stripped out/ is worse than an obvious one.
   * page-mirror/ is rebuilt from scratch each time so a slug that disappears
   * between builds cannot linger and get re-uploaded forever.
   *
   * THE UPLOAD IS A SEPARATE STEP ON PURPOSE — `node scripts/sync-pages-to-r2.mjs`,
   * the same shape as `npm run sync:r2` for the data. The build stays offline
   * and needs no credentials; syncing stays re-runnable after a failure.
   */
  console.log("\n→ Moving page dirs out of out/ for the R2 mirror…");
  const MIRROR = path.join(ROOT, "page-mirror");
  await rm(MIRROR, { recursive: true, force: true });
  let movedDirs = 0;
  for (const d of PAGE_MIRRORED_DIRS) {
    const from = path.join(OUT, d);
    if (!existsSync(from)) {
      console.log(`   (no out/${d} — nothing to move)`);
      continue;
    }
    const to = path.join(MIRROR, d);
    await mkdir(path.dirname(to), { recursive: true });
    await rename(from, to);
    console.log(`   moved out/${d} → page-mirror/${d}`);
    movedDirs++;
  }
  if (movedDirs) {
    console.log("   NEXT: node scripts/sync-pages-to-r2.mjs  (or every game page 404s)");
  }

  console.log(`\n✓ Stripped ${stripped}/${STRIP_DIRS.length} R2 dirs. Build complete.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
