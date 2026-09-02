/**
 * How many CBBD calls have been spent this month.
 *
 * ── WHY A FILE BESIDE THE ARCHIVE ─────────────────────────────────────────
 *
 * CBBD bills by the month and answers 429 when the month is gone, which is a
 * fact worth knowing on the 20th rather than at 3am on the 28th. CBBD itself
 * does not report a running total, so the only way to have one is to count.
 *
 * The count lives at `data/cbbd/.meter.json` — inside the archive directory,
 * not in the repo — because that directory is the one thing that survives
 * between runs: Actions caches `data/cbbd` under a rolling `cbbd-archive-`
 * key, and `backup-archive-to-r2.mjs` walks it without filtering dotfiles, so
 * the meter rides both the cache and the cold-start restore. Anywhere else
 * and the number resets nightly on an ephemeral runner.
 *
 * ── THE NUMBER IS A FLOOR, NOT A TOTAL ────────────────────────────────────
 *
 * Two things it cannot see. The Netlify functions that call CBBD live
 * (`scoreboard.mts`, `game.mts`) spend from the same quota and have no way to
 * write here — they are stateless and this file is not in the deploy. And if
 * the cache is ever lost AND the R2 restore is skipped, the month starts over
 * at zero. Both make the meter read LOW. Whatever consumes it has to say so;
 * a floor presented as a total is worse than no number, because it is the
 * number someone would decide not to upgrade on.
 *
 * Months are UTC, which is not necessarily the boundary CBBD bills on. Close
 * enough to answer "are we near the edge", wrong for reconciling an invoice.
 */

import fs from "node:fs";
import path from "node:path";

const FILE = path.join(process.cwd(), "data", "cbbd", ".meter.json");

/** Thirteen, so this month can be read against the same month last year. */
const KEEP = 13;

/** "2026-09" — the bucket a call lands in. */
export function monthKey(when = new Date()) {
  return when.toISOString().slice(0, 7);
}

/** @typedef {{ months: Record<string, number>, updatedAt: string }} Meter */

/** The meter, or null when nothing has been recorded yet. */
export function read() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (!raw || typeof raw !== "object" || typeof raw.months !== "object") return null;
    return /** @type {Meter} */ (raw);
  } catch {
    return null;
  }
}

/**
 * Add `calls` to this month's total. Returns the new meter, or null if there
 * was nothing to add.
 *
 * NEVER THROWS. This is bookkeeping at the end of a job that has already done
 * the expensive part; a full disk or a read-only mount must not turn a
 * successful ingest into a failed one.
 */
export function record(calls, when = new Date()) {
  if (!Number.isFinite(calls) || calls <= 0) return null;
  try {
    const meter = read() ?? { months: {}, updatedAt: "" };
    const key = monthKey(when);
    meter.months[key] = (meter.months[key] ?? 0) + calls;
    // Trim oldest-first so the file cannot grow without bound on a runner
    // that keeps the archive for years.
    const keys = Object.keys(meter.months).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - KEEP))) delete meter.months[k];
    meter.updatedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(meter, null, 2));
    return meter;
  } catch (e) {
    console.warn(`  (could not write the CBBD meter: ${e.message})`);
    return null;
  }
}

/** Oldest first, for a chart. */
export function months(meter) {
  if (!meter) return [];
  return Object.keys(meter.months).sort().map((month) => ({ month, calls: meter.months[month] }));
}
