#!/usr/bin/env node
/**
 * Postbuild: delete R2-mirrored data dirs from out/ before Netlify uploads.
 *
 * Next.js copies /public into /out at build time, including ~152k JSON files
 * we now serve from R2. Leaving them in out/ would re-introduce the upload
 * timeout we set R2 up to fix. We nuke them after build, after Netlify's
 * publish dir is finalized.
 *
 * Mirrors the R2_DIRS list in src/lib/data-url.ts — if you add an R2-served
 * dir there, add it here too.
 */
import { rm } from "node:fs/promises";
import path from "node:path";

const OUT = "out";
const DIRS = [
  "data/player-games",
  "data/player",
  "data/player-ranks",
  "data/player-splits",
  "data/tournament-box",
  "data/team",
  "data/game-players",
  "data/shots",
  "data/game-index",
  "data/team-game-index",
  "data/team-season-games",
  // NOT R2-mirrored — stripped for a different reason. team-splits is read at
  // BUILD time by readTeamSplits() and reaches the browser as props on the team
  // page, so nothing ever fetches it over the network. Left in place it would
  // ship ~14 MB of files no request can ask for. (Contrast game-box-by-year,
  // which looks similar but IS fetched client-side by the Win Calculator and
  // the box-score modal, so it has to stay.)
  "data/team-splits",
  // Same reasoning again, and the two largest additions yet. Both are read at
  // BUILD time and reach the browser as PROPS on the team page, so no request
  // can ask for either:
  //   lineup-stats  29 MB / 2,008 files  (readLineupStats, readLineupBenchmarks)
  //   team-seasons  7.6 MB / 368 files   (readTeamSeasonGrid)
  // They stay in public/ because the build reads them from there. Shipping
  // them would put ~37 MB of unreachable JSON into every deploy — which is the
  // upload timeout R2 was set up to avoid, arriving by a different door.
  "data/lineup-stats",
  "data/team-seasons",
  // Same again, 2026-08-31. readAssistForPlayer() reads these at BUILD time
  // and the numbers reach the browser as props on the player page, so no
  // request can ask for the files. 13 MB across 12 of them.
  "data/assist-players",
];

/**
 * Individual files, same reasoning as the build-time-only dirs above.
 *
 * teams-all.json is 12 MB and no longer reaches the browser: the home page
 * ships one season from data/teams-by-year/ plus data/teams-index.json, and the
 * team/coach pages read teams-all at BUILD time through readAllTeams(). It has
 * to stay in public/ for that, and out of out/ for the 12 MB.
 */
const FILES = [
  "data/teams-all.json",
  // 12.6 MB, and the same story as teams-all: readAssistNetwork() reads it
  // once at BUILD time and the panel gets its numbers as props. It was
  // suspected of belonging on R2 — it does not, because nothing fetches it.
  // R2 is for files the browser asks for; this one it never does.
  "data/assist-network.json",
];

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
