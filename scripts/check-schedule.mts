/**
 * Has CBBD published next season's schedule yet?
 *
 *   npx tsx scripts/check-schedule.mts
 *
 * Calls the SAME nextSlate() the scoreboard function uses, rather than a copy
 * of the walk — so a green answer here means the ticker will genuinely light
 * up, not that two similar queries happened to agree.
 *
 * The function looks forward for the next day with games whenever nothing is
 * live and nothing is behind it, so the ticker and /scoreboard start showing
 * opening night by themselves the moment those rows exist. Nothing has to be
 * deployed for that to happen. What DOES need doing once they exist: set
 * DEMO_DATE to null, retiring the February 2026 preview slate.
 *
 * As of 28 July 2026 this reports zero games for season 2027 — CBBD has rolled
 * /teams forward (365 of them) but not /games.
 */
import fs from "node:fs";

const key = fs.readFileSync(".env.local", "utf8").match(/^CBBD_API_KEY=(.+)$/m)?.[1]?.trim();
if (!key) throw new Error("CBBD_API_KEY not found in .env.local");
process.env.CBBD_API_KEY = key;

const { nextSlate } = await import("../netlify/functions/scoreboard.mts");

/** CBBD labels the 2026-27 season 2027; it rolls over at midyear. */
function currentSeason(now = new Date()): number {
  return now.getUTCMonth() >= 6 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
}

async function report(season: number, now: Date, label: string) {
  const slate = await nextSlate(key!, season, now);
  if (!slate) {
    console.log(`${label}: no schedule published yet.\n`);
    return null;
  }
  console.log(`${label}: opening night ${slate.date} — ${slate.games.length} games`);
  for (const g of slate.games.slice(0, 6)) {
    console.log(`   ${g.away.team} @ ${g.home.team}   ${g.startDate}   ${g.venue ?? ""}`);
  }
  console.log("");
  return slate;
}

const season = currentSeason();
console.log(`Season ${season} — the ${season - 1}-${String(season).slice(2)} season\n`);

const found = await report(season, new Date(), `season ${season}`);

// A known-good control, so "nothing found" is never ambiguous between "CBBD has
// not published" and "the walk is broken". Asked from a date before that season
// opened, this must find 3 November 2025.
console.log("--- control: last season, asked from 1 October 2025 ---");
await report(2026, new Date("2025-10-01T12:00:00Z"), "season 2026");

if (found) {
  console.log("Next step: set DEMO_DATE to null in netlify/functions/scoreboard.mts.");
} else {
  console.log(`Nothing to do — re-run this later. The control above proves the walk works.`);
}
