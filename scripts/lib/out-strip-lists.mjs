/**
 * out-strip-lists.mjs — what must NOT be in `out/` when the deploy starts.
 *
 * WHY THIS FILE EXISTS. The same list was written out three times:
 * strip-r2-mirrored-from-out.mjs (the postbuild hook), build-with-r2-stash.mjs
 * (the entry point netlify.toml actually names) and verify-deploy-ready.mjs
 * (the gate). Each said "mirror the other when you add a dir", which is a
 * contract enforced by nothing — and it had already failed:
 *
 *   data/team-season-games   4,631 files / 40 MB   missing from the wrapper
 *   data/live                                       missing from the wrapper
 *   data/team-splits         ~14 MB                 missing from the wrapper
 *
 * The postbuild hook knew about all three. The wrapper did not, and the
 * wrapper is the one that runs on Netlify — `npm postbuild` is an npm
 * lifecycle hook and does not fire when the wrapper is invoked directly, which
 * is exactly how netlify.toml invokes it. So a deploy made the documented way
 * would have shipped ~54 MB and 4,600 files that are served from R2.
 *
 * Nothing here changes what gets stripped. It makes the three callers read the
 * same list, so the next dir added is added once.
 *
 * WHAT BELONGS IN WHICH LIST:
 *
 *   R2_MIRRORED   the browser fetches these from R2 (see R2_DIRS in
 *                 src/lib/data-url.ts). They must ALSO be in the sync list in
 *                 scripts/sync-data-to-r2.mjs, or the browser gets a 404.
 *   BUILD_ONLY    read off the filesystem at BUILD time and delivered to the
 *                 browser as props. No request can ask for them, so shipping
 *                 them is pure upload weight. They stay in public/.
 *
 * Both lists stay in public/ either way — this is only about `out/`.
 */

/**
 * R2-mirrored directories. Mirror R2_DIRS in src/lib/data-url.ts when adding
 * one; verify-deploy-ready.mjs checks that these three lists agree and fails
 * the deploy if they do not.
 */
export const R2_MIRRORED_DIRS = [
  "data/player-games",
  "data/player",
  "data/player-ranks",
  "data/player-splits",
  "data/tournament-box",
  "data/team",
  "data/game-players",
  "data/shots",
  // Added 2026-08-30 with the Game Log Explorer. 80 MB in twelve files: not a
  // file-count problem like the rest of this list, a git-history one.
  "data/game-index",
  "data/team-game-index",
  // Added 2026-09-01. One ~9 KB file per team-season with the percentiles
  // already ranked, so a team page's Game Log stops downloading the season's
  // whole 1.6 MB corpus to draw thirty rows. 4,631 files.
  "data/team-season-games",
  // The live season, published nightly without a build. Everything under here
  // is written by scripts/nightly-refresh.mts and fetched at runtime.
  "data/live",
];

/**
 * Not R2-mirrored — build-time inputs no browser asks for.
 *
 *   players-by-year  48 MB / 13 files   readPlayersForYear(), 19 pipeline scripts
 *   lineup-stats     29 MB / 2,008      readLineupStats, readLineupBenchmarks
 *   team-seasons     7.6 MB / 368       readTeamSeasonGrid
 *   assist-players   13 MB / 12         readAssistForPlayer
 *   team-splits      ~14 MB             readTeamSplits
 *
 * team-splits looks like game-box-by-year, which is NOT here: that one is
 * fetched client-side by the Win Calculator and the box-score modal, so it has
 * to ship. The test is always "can a request ask for this file", not "is it
 * big".
 */
export const BUILD_ONLY_DIRS = [
  "data/players-by-year",
  "data/lineup-stats",
  "data/team-seasons",
  "data/assist-players",
  "data/team-splits",
];

/**
 * Individual files, same reasoning as BUILD_ONLY_DIRS.
 *
 * assist-network.json was suspected of belonging on R2 — it does not, because
 * nothing fetches it. R2 is for files the browser asks for.
 */
export const BUILD_ONLY_FILES = [
  "data/teams-all.json",
  "data/assist-network.json",
];

/** Everything that must be absent from out/ by the time the deploy runs. */
export const ALL_STRIP_DIRS = [...R2_MIRRORED_DIRS, ...BUILD_ONLY_DIRS];
