#!/usr/bin/env node
/**
 * verify-player-links.mjs — fail the build if the explorer would link to a
 * player page that does not exist.
 *
 * WHY THIS EXISTS. /players renders a row per player-season and links each one
 * to /players/<bart_player_id>/. Those pages come from generateStaticParams,
 * which only emits ranked players plus the freshman pass — so for a long time
 * 30% of the explorer's rows (19,266 of 63,128) pointed at a 404, roughly
 * eight per screenful.
 *
 * The fix was a `has_page` flag in the explorer payload, computed by
 * scripts/build-players-explorer.mjs from a PORT of readRankedPlayerIds() in
 * src/lib/static-data.ts. A port can drift from its original, and the failure
 * mode is silent: nothing breaks at build time, the site just quietly starts
 * 404ing again. So this checks the port against the ground truth — the
 * directories `next build` actually wrote — rather than against the rules it
 * was ported from.
 *
 * Runs after next build, from scripts/build-with-r2-stash.mjs.
 *
 *   node scripts/verify-player-links.mjs [outDir]
 */
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve(process.argv[2] ?? "out");
const EXPLORER = path.resolve("public/data/players-explorer");

function main() {
  const playersDir = path.join(OUT, "players");
  if (!fs.existsSync(playersDir)) {
    console.error(`  ABORTED: ${path.relative(process.cwd(), playersDir)} not found. Run this after next build.`);
    process.exit(1);
  }

  const generated = new Set(
    fs.readdirSync(playersDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => parseInt(d.name, 10))
      .filter(Number.isFinite),
  );

  // A link that 404s is the bug this guards. A page nobody links to is only
  // wasted build output, so it is reported but not fatal.
  const brokenLinks = new Map();   // bartId -> sample "name (year)"
  const unlinkedPages = new Set(generated);
  let rows = 0, linked = 0;

  for (const file of fs.readdirSync(EXPLORER).filter((f) => f.endsWith(".json")).sort()) {
    const payload = JSON.parse(fs.readFileSync(path.join(EXPLORER, file), "utf8"));
    const bI = payload.fields.indexOf("bart_player_id");
    const hI = payload.fields.indexOf("has_page");
    const nI = payload.fields.indexOf("name");
    const yI = payload.fields.indexOf("year");
    if (bI < 0 || hI < 0) {
      console.error(`  ABORTED: ${file} has no bart_player_id/has_page field. Rebuild the explorer payload.`);
      process.exit(1);
    }
    for (const row of payload.rows) {
      rows++;
      const bartId = row[bI];
      if (row[hI] !== true) continue;
      linked++;
      if (bartId == null || !generated.has(bartId)) {
        if (!brokenLinks.has(bartId)) brokenLinks.set(bartId, `${row[nI]} (${row[yI]})`);
      }
      unlinkedPages.delete(bartId);
    }
  }

  console.log(`  ${rows.toLocaleString()} explorer rows, ${linked.toLocaleString()} linked, ${generated.size.toLocaleString()} pages generated.`);

  if (unlinkedPages.size > 0) {
    console.log(`  ${unlinkedPages.size.toLocaleString()} generated pages are not linked from the explorer (fine — reachable by search and team pages).`);
  }

  if (brokenLinks.size > 0) {
    console.error(`\n  ✗ ${brokenLinks.size} linked players have NO generated page. Sample:`);
    for (const [id, who] of [...brokenLinks].slice(0, 10)) console.error(`      /players/${id}/  ${who}`);
    console.error(
      "\n  has_page in scripts/build-players-explorer.mjs has drifted from\n" +
      "  readRankedPlayerIds() in src/lib/static-data.ts. Re-sync the two.",
    );
    process.exit(1);
  }

  console.log("  ✓ every linked player has a page.");
}

main();
