/**
 * Feature flags for things that are built but not yet running on live data.
 *
 * Deliberately plain constants rather than environment variables: this is a
 * static export deployed by hand, so a build-time boolean IS the switch, and a
 * flag you can read in the diff beats one you have to look up in a dashboard.
 */

/**
 * Score rail on/off, sitewide.
 *
 * Off for now. The rail is the only thing on the page that arrives after
 * first paint and changes the page height when it does, so it pushes
 * everything below it down a second or two in. Flip to true to bring it
 * back; nothing else has to change.
 */
export const SHOW_SCORE_TICKER = false;

/**
 * How the scoreboard, the score ticker and the game pages get their data.
 *
 *   "demo" — no season is being played. Every date the site can reach is in
 *            the baked archive (public/data/scoreboard and public/data/games,
 *            written by scripts/build-scoreboard-archive.mts), so nothing
 *            calls the Netlify function and nothing spends CBBD quota. The
 *            ticker and /scoreboard open on the last night of the last
 *            completed season.
 *   "live"  — a season is under way. Today's slate, and any game in it, come
 *            from the function; every COMPLETED season still comes from the
 *            archive, because a finished game cannot change.
 *
 * THE NAME IS NOW WRONG, AND KEPT ANYWAY. "demo" stopped meaning fake data on
 * 2026-09-08, when the archive replaced the two baked sample files — a real
 * slate of 128 games where only one had a box score behind it. It now means
 * "no live season", and it is the one line that changes when 2026-27 tips off.
 *
 * TO GO LIVE: set this to "live", and set DEMO_DATE to null in
 * netlify/functions/scoreboard.mts. `npx tsx scripts/check-schedule.mts` says
 * when CBBD has a schedule to serve.
 */
export const SCOREBOARD_MODE: "demo" | "live" = "demo";

export const IS_DEMO = SCOREBOARD_MODE === "demo";
