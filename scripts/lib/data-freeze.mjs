/**
 * data-freeze.mjs — one place that knows the archive is closed.
 *
 * WHY THIS EXISTS. The site's data is frozen until the 2026-27 season opens in
 * October 2026. Everything published between now and then is a derivation over
 * committed data, so the numbers on the site can be traced back to a known
 * archive. A single upstream pull breaks that: it mixes a live snapshot into a
 * frozen set, and because the pull succeeds silently there is nothing to notice
 * afterwards except two files that disagree about the same season.
 *
 * That is not hypothetical. scripts/daily-refresh.mjs was written for the live
 * season and calls build-season-preview.mjs unconditionally, which fetches
 * Bart's offseason feed. It is scheduled to start on 2026-11-01, but nothing
 * stopped anyone from running it by hand today — and someone did, at 16:27 on
 * 2026-07-29, which rewrote season-preview.json mid-freeze.
 *
 * WHAT THIS DOES. Network-touching scripts call assertUnfrozen() before their
 * first fetch. Before the thaw date it exits with a non-zero status and says
 * which script tried, rather than throwing something a caller might swallow.
 *
 * THE ESCAPE HATCH IS DELIBERATE and deliberately awkward: BTA_ALLOW_NETWORK=1
 * is long enough to be typed on purpose and never by habit. Use it when a pull
 * is genuinely the intent (checking whether a feed changed shape, say); the
 * override is logged so the run is attributable afterwards.
 *
 * AFTER THE THAW this file stops doing anything at all — the date passes, every
 * guard turns into a no-op, and none of the call sites need to be touched.
 */

/** First day the archive reopens: the 2026-27 season is under way. */
export const THAW = new Date("2026-10-01T00:00:00Z");

export const OVERRIDE_ENV = "BTA_ALLOW_NETWORK";

export function isFrozen(now = new Date()) {
  return now < THAW;
}

/**
 * Stop a script that is about to pull upstream data during the freeze.
 *
 * @param {string} script  what to name in the message — usually the filename
 * @param {string} what    the feed being pulled, so the log says what was stopped
 */
export function assertUnfrozen(script, what = "upstream data") {
  if (!isFrozen()) return;

  if (process.env[OVERRIDE_ENV] === "1") {
    console.warn(
      `⚠ ${OVERRIDE_ENV}=1 — ${script} is pulling ${what} during the data freeze.\n` +
      `  Deliberate override. The archive is no longer purely committed data.`,
    );
    return;
  }

  const days = Math.ceil((THAW - new Date()) / 86_400_000);
  console.error(
    `\n✗ DATA FREEZE — ${script} refused to pull ${what}.\n\n` +
    `  The archive is closed until ${THAW.toISOString().slice(0, 10)} (${days} days).\n` +
    `  Everything published until then is derived from committed data; a live\n` +
    `  pull mixes a fresh snapshot into a frozen season and nothing downstream\n` +
    `  would flag the mismatch.\n\n` +
    `  To repair season-preview.json without the network:\n` +
    `      node scripts/relink-season-preview.mjs\n\n` +
    `  To override anyway, on purpose:\n` +
    `      ${OVERRIDE_ENV}=1 node ${script}\n`,
  );
  process.exit(2);
}
