#!/usr/bin/env node
/**
 * patch-preview-impact.mjs — re-stamp the IMPACT columns (EPM, eWins, on/off)
 * in season-preview.json, in place, no network.
 *
 * TWO THINGS WERE WRONG WITH THE PREVIEW ROSTER'S IMPACT GROUP.
 *
 * 1. eWINS and ON/OFF were blank for all 365 teams. Not a join failure:
 *    build-season-preview reads its carried-over line out of
 *    player-ranks/<id>.json, and those files carry neither key — sampled 273
 *    players with a 2026 season and zero had `ewins` or `on_off`. Both live in
 *    epm-<year>.json instead, next to the EPM the preview was already showing,
 *    so a roster displaying last season's EPM had no reason to withhold them.
 *
 * 2. The EPM already on the page was STALE. Comparing every preview row against
 *    its current rank file: 1,256 of 1,530 disagreed, and the rank files agree
 *    with epm-<year>.json (Patrick Ngongba: preview 4.3, rank file and epm file
 *    both 5.33). The EPM rebuild never reached this file, because the only
 *    script that writes it is the builder and the builder is frozen out. So
 *    every preview roster was ordered by, and showing, superseded numbers.
 *
 * WHY ONLY THE IMPACT GROUP. The rest of the carried line was checked the same
 * way and is current — PIR/PPG/RPG/APG drift by 11-14 rows out of 1,530 and the
 * shooting/usage percentiles by 3. Re-stamping those would be churn.
 *
 * SOURCES, matching what a normal team page does:
 *   EPM + its percentile   → player-ranks/<id>.json (same read as the builder)
 *   eWins, on/off          → epm-<year>.json, no box-epm fallback
 *   their percentiles      → recomputed over the same pool buildRoster uses:
 *                            every bart id in players-by-year/<PREV>, ranked
 *                            ascending, round(i / (n-1) * 100)
 *
 * The no-box-fallback rule mirrors readImpactExtrasForYear: the box fit is a
 * projection from a box line with no lineup information, so it cannot produce
 * an on/off at all and its eWins would be a different quantity wearing the same
 * label. A player the play-by-play fit never reached stays "—", exactly as he
 * does on his own profile page.
 *
 * WHY IT IS A SEPARATE SCRIPT. build-season-preview.mjs pulls Bart's living
 * offseason feed and the data freeze holds until 2026-10-01, so re-running it
 * to pick up a code fix is not available. Both it and relink-season-preview.mjs
 * now read the same two sources; this applies the result to the file on disk.
 *
 * Idempotent — it rewrites from source every run. Refuses to write if either
 * source comes back empty, so a truncated file cannot silently blank a column
 * that currently works.
 *
 *   Run: node scripts/patch-preview-impact.mjs [--dry]
 */
import fs from "node:fs";
import path from "node:path";

const DATA = path.resolve("public/data");
const FILE = path.join(DATA, "season-preview.json");
const DRY = process.argv.includes("--dry");

const doc = JSON.parse(fs.readFileSync(FILE, "utf8"));
const PREV_YEAR = doc.season - 1;

const round1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const round2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);

// ---- sources -------------------------------------------------------------
const src = JSON.parse(fs.readFileSync(path.join(DATA, `epm-${PREV_YEAR}.json`), "utf8"));
const extras = new Map(
  Object.entries(src.players || {}).map(([bid, v]) => [
    Number(bid),
    { ewins: num(v.ewins), on_off: num(v.on_off) },
  ]),
);
if (extras.size === 0) {
  console.error(`✗ epm-${PREV_YEAR}.json carries no players — refusing to blank the columns.`);
  process.exit(1);
}

// The percentile pool. buildRoster ranks over the whole year's player list, so
// a bart id that exists in the epm fit but not in players-by-year is outside
// the pool there and is outside it here.
const prev = JSON.parse(fs.readFileSync(path.join(DATA, "players-by-year", `${PREV_YEAR}.json`), "utf8"));
const poolIds = new Set(prev.map((p) => p.bart_player_id).filter((x) => x != null));

/** round(i / (n-1) * 100) over ascending non-null values — poolPercentiles. */
function percentilesOver(pick) {
  const vals = [];
  for (const id of poolIds) {
    const v = extras.get(id);
    const x = v ? pick(v) : null;
    if (x != null) vals.push([id, x]);
  }
  vals.sort((a, b) => a[1] - b[1]);
  const out = new Map();
  const n = vals.length;
  if (n < 2) return out;
  vals.forEach(([id], i) => out.set(id, Math.round((i / (n - 1)) * 100)));
  return out;
}
const ewinsPct = percentilesOver((v) => v.ewins);
const onOffPct = percentilesOver((v) => v.on_off);
console.log(
  `epm-${PREV_YEAR}.json: ${extras.size} players · percentile pool ` +
    `${ewinsPct.size} eWins / ${onOffPct.size} on-off`,
);

/**
 * Current EPM + percentile.
 *
 * Rank file first — that's the builder's own read, and its percentile is the
 * one the player's own profile page shows. When there is no rank file, fall
 * back to the EPM in epm-<year>.json with NO percentile.
 *
 * The fallback is safe because the two agree exactly: of the 1,188 preview
 * players carrying both, all 1,188 matched to the cent. And it is necessary
 * because without it 650 rows end up showing an eWins and an on/off with a
 * blank EPM beside them — a player is in the play-by-play fit or he isn't, and
 * a roster that reports two thirds of his impact line and withholds the third
 * looks broken rather than incomplete. Houston's Dedan Thomas Jr. was the case
 * that made it obvious: +18.0 on/off, no EPM, sorted to the bottom of the team.
 *
 * No percentile on the fallback rows, deliberately. The rank-file percentile is
 * ranked against a wider cohort (it includes box-fit players), so a percentile
 * computed here over the play-by-play pool alone runs ~4 points high and up to
 * 17 — close enough to look like the same number and far enough to be a
 * different one. A bare value is the honest option.
 */
function epmFor(bartId) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(DATA, "player-ranks", `${bartId}.json`), "utf8"));
    const s = ((j.seasonRanks || []).find((x) => x.year === PREV_YEAR) || {}).stats || {};
    const e = s.epm;
    if (e && typeof e.value === "number") {
      return { epm: round1(e.value), epmP: typeof e.percentile === "number" ? e.percentile : null };
    }
  } catch { /* fall through */ }
  const v = src.players?.[String(bartId)];
  if (v && typeof v.epm === "number") return { epm: round1(v.epm), epmP: null, fallback: true };
  return null;
}

// ---- stamp ---------------------------------------------------------------
let rows = 0, withId = 0, extrasHit = 0, epmHit = 0, epmChanged = 0, epmFallback = 0, notInFit = 0;
const examples = [];
for (const [teamName, team] of Object.entries(doc.teams ?? {})) {
  for (const row of team.roster ?? []) {
    rows++;
    if (row.bart_id == null) {
      row.ewins = null; row.on_off = null; row.ewinsP = null; row.on_offP = null;
      continue;
    }
    withId++;

    const before = row.epm;
    const e = epmFor(row.bart_id);
    if (e) {
      row.epm = e.epm; row.epmP = e.epmP;
      epmHit++;
      if (before !== e.epm) epmChanged++;
      if (e.fallback) epmFallback++;
    }

    const ex = extras.get(row.bart_id);
    if (!ex) {
      row.ewins = null; row.on_off = null; row.ewinsP = null; row.on_offP = null;
      notInFit++;
      continue;
    }
    row.ewins = round2(ex.ewins);
    row.on_off = round1(ex.on_off);
    row.ewinsP = ewinsPct.get(row.bart_id) ?? null;
    row.on_offP = onOffPct.get(row.bart_id) ?? null;
    if (row.ewins != null || row.on_off != null) {
      extrasHit++;
      if (examples.length < 8) {
        examples.push(
          `${teamName}: ${row.name} — EPM ${before ?? "—"} → ${row.epm ?? "—"}, ` +
            `eWins ${row.ewins ?? "—"}, on/off ${row.on_off ?? "—"}`,
        );
      }
    }
  }
  // Leave the roster ordered the way the builder does — by the EPM we just
  // refreshed, so a stale number can't hold a stale position either.
  team.roster?.sort((a, b) => (b.epm ?? -99) - (a.epm ?? -99));
}

console.log(`roster rows:          ${rows}`);
console.log(`  with a bart id:     ${withId}`);
console.log(`  EPM re-stamped:     ${epmHit}  (${epmChanged} changed value, ${epmFallback} from the epm file with no rank file)`);
console.log(`  eWins/on-off set:   ${extrasHit}`);
console.log(`  not in the fit:     ${notInFit}  (box-only or under the minutes floor — stays "—")`);
console.log(examples.map((e) => `    ${e}`).join("\n"));

if (extrasHit === 0) {
  console.error("\n✗ not one row matched — refusing to write.");
  process.exit(1);
}
if (DRY) { console.log("\n--dry: nothing written."); process.exit(0); }

doc.impact_patched_at = new Date().toISOString();
fs.writeFileSync(FILE, JSON.stringify(doc));
console.log(`\n✓ rewrote ${FILE}`);
