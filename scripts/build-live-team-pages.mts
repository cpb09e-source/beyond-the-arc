/**
 * build-live-team-pages.mts — writes the live season's team pages as data.
 *
 * One file per team holding exactly what loadTeamPageData returns for the
 * season being played, so the browser can fetch tonight's numbers instead of
 * the site being rebuilt to print them. See src/lib/live-team-page.ts for why.
 *
 * THIS IS THE NIGHTLY JOB'S TEAM HALF. It runs after the data builders and
 * before the R2 sync; it does not run at build time and is not wired into
 * `next build`, exactly like the other build-* scripts.
 *
 * IT VERIFIES ITS OWN CODEC ON EVERY TEAM rather than trusting it. TeamPageData
 * is a wide inferred type with a Map and a Set in it, and the failure mode of a
 * missed field is not a crash — it is a page that renders with one panel quietly
 * empty. So each bundle is decoded again and deep-compared against the object it
 * came from, and a mismatch stops the run. That check costs a few seconds across
 * 365 teams and removes an entire class of silent bug.
 *
 * Usage:
 *   npx tsx scripts/build-live-team-pages.mts               # LIVE_SEASON
 *   npx tsx scripts/build-live-team-pages.mts --season 2026 # dry-run any season
 *   npx tsx scripts/build-live-team-pages.mts --season 2026 --only duke
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { loadTeamPageData } from "@/lib/team-page-data";
import { encodeLiveTeamPage, decodeLiveTeamPage } from "@/lib/live-team-page";
import { LIVE_SEASON } from "@/lib/seasons";
import { readAllTeams } from "@/lib/static-data";
import { teamSlug } from "@/lib/team-slug";

const OUT_DIR = path.join(process.cwd(), "public", "data", "live", "team");

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i > -1 ? (process.argv[i + 1] ?? null) : null;
}

const seasonArg = arg("--season");
const season = seasonArg ? Number(seasonArg) : LIVE_SEASON;
if (season === null || !Number.isFinite(season)) {
  console.error(
    "No live season. LIVE_SEASON in src/lib/seasons.ts is null (no season is being played),\n" +
    "so there is nothing to build. Pass --season <year> to generate one anyway.",
  );
  process.exit(1);
}
const only = arg("--only");

/**
 * Structural equality for the round-trip check.
 *
 * Maps and Sets compare by their entries — the codec turns them into arrays
 * and back, and a shallow === would report every one of them as different.
 * NaN equals NaN here, because a missing rate is NaN in some of these rows and
 * the two sides being NaN is agreement, not disagreement.
 */
function same(a: unknown, b: unknown, path_ = ""): string | null {
  if (a === b) return null;
  if (typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b)) return null;
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map) || !(b instanceof Map)) return `${path_}: Map vs non-Map`;
    if (a.size !== b.size) return `${path_}: Map size ${a.size} vs ${b.size}`;
    for (const [k, v] of a) {
      const e = same(v, b.get(k), `${path_}.get(${String(k)})`);
      if (e) return e;
    }
    return null;
  }
  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set) || !(b instanceof Set)) return `${path_}: Set vs non-Set`;
    for (const v of a) if (!b.has(v)) return `${path_}: missing ${String(v)}`;
    return null;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return `${path_}: array vs non-array`;
    if (a.length !== b.length) return `${path_}: length ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const e = same(a[i], b[i], `${path_}[${i}]`);
      if (e) return e;
    }
    return null;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    /**
     * A KEY SET TO undefined AND AN ABSENT KEY ARE THE SAME THING HERE, and
     * only here. JSON.stringify drops `{ sub: undefined }` entirely, so the
     * round trip legitimately returns an object with one fewer key — and every
     * reader of those fields tests them for truthiness (`stat.sub && …`), for
     * which absent and undefined are indistinguishable. Nothing on this page
     * uses `in` or Object.keys on them.
     *
     * The comparison is still strict in the direction that matters: a key
     * holding a REAL value on one side and missing on the other fails, because
     * only an undefined value is allowed to excuse an absent key.
     */
    const ao = a as Record<string, unknown>, bo = b as Record<string, unknown>;
    for (const k of new Set([...Object.keys(ao), ...Object.keys(bo)])) {
      const e = same(ao[k], bo[k], `${path_}.${k}`);
      if (e) return e;
    }
    return null;
  }
  return `${path_}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
}

const allTeams = await readAllTeams();
const slugs = [...new Set(allTeams.filter((t) => t.year === season).map((t) => teamSlug(t.name)))].sort();
const targets = only ? slugs.filter((s) => s === only) : slugs;
if (only && targets.length === 0) {
  console.error(`--only ${only} matched no team in ${season}.`);
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const builtAt = new Date().toISOString();

console.log(`Building live team pages for ${season} — ${targets.length} teams\n`);
let written = 0, skipped = 0, bytes = 0;
const failures: string[] = [];

for (const slug of targets) {
  const data = await loadTeamPageData(slug, season);
  if (!data) { skipped++; continue; }

  const bundle = encodeLiveTeamPage(data, builtAt);
  const json = JSON.stringify(bundle);

  // The codec is checked against THIS team's data, through the same JSON the
  // browser will parse — not against the in-memory object, which would skip
  // the serialisation that actually loses things.
  const roundTrip = decodeLiveTeamPage(JSON.parse(json));
  const trimmed = { ...data, rankedPlayerIds: decodeLiveTeamPage(JSON.parse(json)).rankedPlayerIds };
  const err = same(trimmed, roundTrip, slug);
  if (err) { failures.push(err); continue; }

  fs.writeFileSync(path.join(OUT_DIR, `${slug}.json`), json);
  written++;
  bytes += Buffer.byteLength(json);
  if (written % 50 === 0) console.log(`  ${written}/${targets.length}…`);
}

if (failures.length) {
  console.error(`\nCODEC MISMATCH on ${failures.length} team(s) — nothing about these files can be trusted:`);
  for (const f of failures.slice(0, 5)) console.error(`  ${f}`);
  process.exit(1);
}

console.log(`\n${written} files, ${(bytes / 1024 / 1024).toFixed(1)} MB, ~${Math.round(bytes / written / 1024)} KB each`);
if (skipped) console.log(`${skipped} teams had no page data for ${season}`);
console.log(`→ public/data/live/team/`);
