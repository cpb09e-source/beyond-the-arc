/**
 * Feature flags for things that are built but not yet running on live data.
 *
 * Deliberately plain constants rather than environment variables: this is a
 * static export deployed by hand, so a build-time boolean IS the switch, and a
 * flag you can read in the diff beats one you have to look up in a dashboard.
 */

/**
 * How the scoreboard, the score ticker and the game pages get their data.
 *
 *   "demo" — a slate baked into public/data at build time. No function call, no
 *            CBBD quota, no polling. Every game opens the same sample game.
 *   "live" — the Netlify function, CBBD, and the poll loop.
 *
 * DEMO UNTIL THE SEASON IS CLOSE, because there is nothing true to show yet:
 * CBBD has published no 2026-27 schedule (`/games?season=2027` returns zero
 * rows), so the live path falls through to DEMO_DATE and renders a February
 * 2026 slate anyway — just at the cost of a CBBD round trip per visitor.
 *
 * WHY BAKED RATHER THAN LIVE-WITH-A-PINNED-DATE. Serving the same fixed slate
 * through the function means every page load on the whole site waits on a
 * Netlify function that calls CBBD five times to produce a file that cannot
 * change. Baked, it is one gzipped static asset on the CDN, shared between the
 * ticker and the scoreboard, cached by the browser, with the poll loop off
 * entirely. Faster for the reader, free against the quota, and it takes the
 * ticker off the dev proxy that leaks on every request
 * (see docs/dev-scoreboard.md).
 *
 * TO GO LIVE: set this to "live", set DEMO_DATE to null in
 * netlify/functions/scoreboard.mts, and delete public/data/demo-*.json.
 * `npx tsx scripts/check-schedule.mts` says when CBBD is ready.
 */
export const SCOREBOARD_MODE: "demo" | "live" = "demo";

export const IS_DEMO = SCOREBOARD_MODE === "demo";

/** Where the baked slate and sample game live. Written by scripts/build-demo-slate.mjs. */
export const DEMO_SLATE_URL = "/data/demo-slate.json";
export const DEMO_GAME_URL = "/data/demo-game.json";

/**
 * The one game every demo link opens.
 *
 * In demo mode the ticker and the scoreboard carry a full slate, but only one
 * game has a box score baked behind it — a hundred and twenty-eight bundles
 * would be ~17 MB of static JSON to make every card openable with the same
 * data the reader already cannot act on. Duke at North Carolina, 7 Feb 2026:
 * a three-point game, a 2-1 four-factors split, and the best player on the
 * losing side, so every panel on the page has something to show.
 */
export const DEMO_GAME = { id: 214837, date: "2026-02-07" };
