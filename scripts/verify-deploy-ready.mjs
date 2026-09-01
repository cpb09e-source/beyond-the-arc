#!/usr/bin/env node
/**
 * Everything that must be true about `out/` before a deploy — checked, not
 * remembered.
 *
 *   node scripts/verify-deploy-ready.mjs
 *
 * WHY A SCRIPT AND NOT A CHECKLIST. The deploy is 45+ minutes and 300k files;
 * finding out afterwards that a paid season shipped, or that a new page was
 * never generated, costs another 45. Every check here is one that has actually
 * gone wrong at least once on this project.
 *
 * Exits 1 on any failure, so it can gate a deploy rather than merely be read.
 */
import fs from "node:fs";
import path from "node:path";
import { ALL_STRIP_DIRS, BUILD_ONLY_FILES, R2_MIRRORED_DIRS } from "./lib/out-strip-lists.mjs";

const OUT = path.resolve("out");
const fail = [];
const warn = [];
const ok = [];

const exists = (rel) => fs.existsSync(path.join(OUT, rel));
const read = (rel) => fs.readFileSync(path.join(OUT, rel), "utf8");

function check(label, condition, detail = "") {
  (condition ? ok : fail).push(`${label}${detail ? ` — ${detail}` : ""}`);
}

if (!fs.existsSync(OUT)) {
  console.error("No out/ — nothing to verify.");
  process.exit(1);
}

// ── 1. The build produced the pages ───────────────────────────────────────
check("home page", exists("index.html"));
check("players explorer", exists("players/index.html"));
check("game log explorer", exists("players/games/index.html"));
check("conference rankings", exists("conferences/index.html"));

// ── 2. The paywall holds ──────────────────────────────────────────────────
// Policy read the same way stage-gated-data.mjs reads it, so this cannot drift.
const accessSrc = fs.readFileSync(path.resolve("src/lib/access.ts"), "utf8");
const freeLine = accessSrc.match(/^export const FREE_SEASONS: readonly number\[\] = (.+?);$/m);
const paywallOff = !freeLine || freeLine[1].includes("EXPLORER_SEASONS");
const freeYears = paywallOff ? [] : [...freeLine[1].matchAll(/\d{4}/g)].map((m) => Number(m[0]));

if (paywallOff) {
  warn.push("Paywall is OFF — every season public. No gating to check.");
} else {
  /**
   * THE SAME WINDOW stage-gated-data.mjs uses, not "every file on disk".
   *
   * public/data/teams-by-year holds 2008-2013 and 2027 as well — pre-window
   * history the site never renders, and the preview season. The first version
   * of this check called all of them paid and then reported the build had
   * leaked eight seasons it had never been asked to gate.
   */
  const seasonsSrc = fs.readFileSync(path.resolve("src/lib/seasons.ts"), "utf8");
  // NOT a template literal with \d in it: inside backticks JS reads \d as a
  // plain 'd', so the pattern silently became `= (d+)`, matched nothing, and
  // floor/ceil came back NaN — which made the paid set EMPTY and every gating
  // check pass by having nothing to check. A false pass on a deploy gate is
  // worse than a failure, so the pattern is built from a string instead.
  const num = (name) => Number(seasonsSrc.match(new RegExp("export const " + name + " = ([0-9]+)"))?.[1]);
  const need = (name, v) => {
    if (!Number.isFinite(v)) { console.error(`Could not read ${name} from seasons.ts`); process.exit(1); }
    return v;
  };
  const floor = need("SEASON_FLOOR", num("SEASON_FLOOR"));
  const ceil = need("SEASON_CEIL", num("SEASON_CEIL"));
  const preview = need("PREVIEW_SEASON", num("PREVIEW_SEASON"));
  // Anchored to the declaration line — see the long note in
  // scripts/stage-gated-data.mjs for what the unanchored version read instead.
  const excludedDecl = seasonsSrc.match(/^export const EXCLUDED_SEASONS[^=]*=([^;]*);/m)?.[1] ?? "";
  const excluded = [...excludedDecl.matchAll(/\d+/g)].map((m) => Number(m[0]));

  const seasons = [];
  for (let y = floor; y <= ceil; y++) if (!excluded.includes(y)) seasons.push(y);
  // isSeasonFree() treats the preview season as free whatever the list says.
  const paid = seasons.filter((y) => !freeYears.includes(y) && y !== preview);

  check("paid season list is non-empty", paid.length > 0, `${paid.length} paid seasons`);

  for (const corpus of ["teams-by-year", "players-explorer"]) {
    const leaked = paid.filter((y) => exists(`data/${corpus}/${y}.json`));
    check(`${corpus}: no paid season published`, leaked.length === 0, leaked.join(", "));
    const staged = paid.filter((y) => fs.existsSync(path.resolve("gated-data", corpus, `${y}.json`)));
    check(`${corpus}: every paid season staged`, staged.length === paid.length,
      `${staged.length}/${paid.length}`);
  }
  for (const y of freeYears) {
    check(`free season ${y} still published`, exists(`data/teams-by-year/${y}.json`));
  }

  /**
   * ENTITY PAGES ARE FREE AT EVERY SEASON — see the note at the top of §1 in
   * src/lib/access.ts. So this asserts the opposite of what it did for a few
   * hours on 2026-08-30: an archive team page must RENDER, not gate.
   *
   * It is still worth checking. A build that quietly stopped rendering old
   * seasons would look like a successful build, and 22,000 pages are exactly
   * the kind of thing nobody opens one of before deploying.
   */
  const sample = ["teams/duke", "teams/kansas", "teams/vermont"]
    .map((t) => `${t}/${paid[0]}/index.html`)
    .find(exists);
  if (sample) {
    const html = read(sample);
    check(`archive team page renders (${sample})`, html.includes("Net Rating"));
    check("archive team page is NOT gated", !html.includes("Season Pass"));
  } else {
    fail.push(`no archive team page at teams/<team>/${paid[0]}/ — they should all render`);
  }
}

// ── 3. The strips ran ─────────────────────────────────────────────────────
/**
 * READ FROM scripts/lib/out-strip-lists.mjs, not restated here.
 *
 * The copy that used to sit in this file was four dirs short of what the
 * postbuild hook strips — team-game-index, team-season-games, live and
 * team-splits — so the gate would have passed a deploy carrying every one of
 * them. A check with a stale copy of the list it is checking is worse than no
 * check: it reports a pass.
 */
const MUST_BE_GONE = [...ALL_STRIP_DIRS, ...BUILD_ONLY_FILES];
const stillThere = MUST_BE_GONE.filter(exists);
check("R2-mirrored and build-only data stripped", stillThere.length === 0, stillThere.join(", "));

// ── 4. Things a past deploy got wrong ─────────────────────────────────────
if (exists("robots.txt")) {
  const robots = read("robots.txt");
  check("robots names the custom domain", robots.includes("btacbb.xyz"));
  check("robots does NOT name the netlify subdomain", !robots.includes("beyond-the-arc.netlify.app"));
}
if (exists("sitemap.xml")) {
  check("sitemap is on the custom domain", !read("sitemap.xml").includes("beyond-the-arc.netlify.app"));
}

// The RSC payloads. Stripping these broke /coaches on a May 2026 deploy.
let txt = 0;
(function count(dir, depth = 0) {
  if (depth > 3) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) count(path.join(dir, e.name), depth + 1);
    else if (e.name.endsWith(".txt")) txt++;
  }
})(OUT);
check("RSC .txt payloads present", txt > 100, `${txt} found`);

// ── 5. The R2 mirror lists agree ──────────────────────────────────────────
/**
 * FOUR LISTS DESCRIBE THE SAME SET OF DIRECTORIES, and nothing made them agree.
 *
 *   src/lib/data-url.ts            R2_DIRS  — what the browser fetches from R2
 *   scripts/sync-data-to-r2.mjs    ALL_DIRS — what actually gets uploaded
 *   scripts/strip-r2-mirrored-from-out.mjs  — what is deleted from out/
 *
 * Get them out of step and the failure is silent in the worst direction. A dir
 * added to R2_DIRS but not to the sync list points the browser at a 404 —
 * which is exactly what happened twice on this project, first with game-index
 * and then, with the lesson already written down, again with team-game-index.
 * A dir synced and NOT stripped ships megabytes twice.
 *
 * READ OUT OF THE SOURCE FILES, not re-declared here. A fourth hand-kept copy
 * of the list inside its own consistency check would be the same bug wearing a
 * hat.
 */
function dirsFrom(file, re, clean) {
  const src = fs.readFileSync(path.resolve(file), "utf8");
  // Comments in these files mention directory names in prose; only the string
  // literals in the array count.
  return new Set([...src.matchAll(re)].map((m) => clean(m[1])));
}

try {
  const urlDirs = dirsFrom(
    "src/lib/data-url.ts",
    /^\s*"\/data\/([a-z0-9-]+)\/",/gm,
    (d) => d,
  );
  const syncDirs = dirsFrom(
    "scripts/sync-data-to-r2.mjs",
    /^\s*"public\/data\/([a-z0-9-]+)",/gm,
    (d) => d,
  );
  // Straight from the module both strippers import — there is no third copy to
  // parse any more, and nothing to drift.
  const stripDirs = new Set(R2_MIRRORED_DIRS.map((d) => d.replace(/^data\//, "")));

  // A guard on the guard: if a refactor changes these files' formatting the
  // regexes go quiet, and a check that silently matches nothing passes forever.
  check(
    "R2 dir lists were actually parsed",
    urlDirs.size > 3 && syncDirs.size > 3 && stripDirs.size > 3,
    `data-url ${urlDirs.size}, sync ${syncDirs.size}, strip ${stripDirs.size}`,
  );

  const notSynced = [...urlDirs].filter((d) => !syncDirs.has(d));
  check(
    "every R2-served dir is in the sync list",
    notSynced.length === 0,
    notSynced.length ? `${notSynced.join(", ")} would 404 in the browser` : "",
  );

  const notStripped = [...syncDirs].filter((d) => !stripDirs.has(d));
  check(
    "every synced dir is stripped from out/",
    notStripped.length === 0,
    notStripped.length ? `${notStripped.join(", ")} would ship twice` : "",
  );

  // Present on disk, so `npm run sync:r2` has something to upload.
  const missingLocally = [...syncDirs].filter(
    (d) => !fs.existsSync(path.resolve("public/data", d)),
  );
  check(
    "every synced dir exists locally",
    missingLocally.length === 0,
    missingLocally.join(", "),
  );
} catch (e) {
  check("R2 mirror lists readable", false, e.message);
}

// ── 6. The numbers are not obviously wrong ────────────────────────────────
/**
 * RANGE ASSERTIONS ON THE DATA ITSELF, because every other check in this file
 * asks whether a FILE exists and none of them asks whether it is sane.
 *
 * The bug that earned this section: the Team Game Log Explorer shipped an
 * offensive rating of 592.3 — Houston 77-52 over Tulane, on an upstream
 * possession count of 13 — and the corpus held ratings up to 11,500. It sat at
 * the top of the default sort, on the site, looking exactly like a number.
 * Nothing here would have caught it, and no amount of clicking around a staging
 * copy would have either, because a wrong number renders perfectly.
 *
 * Bounds are deliberately loose. This is a smoke alarm for a broken
 * denominator or an empty season, not a model of college basketball: the real
 * extremes measured across all 13 seasons are ORTG 171, pace 98, and these sit
 * well outside them. A check that fires on a merely unusual game would be
 * turned off within a month.
 *
 * Reads public/data rather than out/, because these files are R2-mirrored and
 * section 3 has just confirmed they are NOT in out/.
 */
/**
 * [column index, label, min, max] against team-game-index's packed rows.
 *
 * THE RATING FLOOR IS 30, NOT 40, AND THAT WAS MEASURED. Savannah St. scored
 * 26 on Louisville in 2015 for an offensive rating of 34.7, and Arkansas Pine
 * Bluff 25 on Missouri for 36.2. Both are real, both have complete box scores,
 * and a bound that flagged them is a bound that gets switched off. Sixteen rows
 * in the corpus sit under 45 and the lowest real one is 34.7.
 */
const RANGES = {
  ortg: [21, "ORtg", 30, 200],
  drtg: [22, "DRtg", 30, 200],
  pace: [7, "pace", 40, 110],
};
const TGI = path.resolve("public/data/team-game-index");
if (fs.existsSync(TGI)) {
  const seasons = fs.readdirSync(TGI).filter((f) => f.endsWith(".json"));
  const empty = [];
  const outOfRange = [];
  let inconsistent = 0;
  let scanned = 0;

  for (const file of seasons) {
    const pack = JSON.parse(fs.readFileSync(path.join(TGI, file), "utf8"));
    const rows = pack.rows ?? [];
    if (rows.length === 0) { empty.push(file); continue; }
    for (const r of rows) {
      scanned++;
      for (const [key, [i, label, lo, hi]] of Object.entries(RANGES)) {
        // 0 is this format's null — the builder writes it where a value was
        // suppressed, so it is a pass, not a zero.
        const v = r[i];
        if (!v) continue;
        const real = v / 10;
        if (real < lo || real > hi) {
          if (outOfRange.length < 5) {
            outOfRange.push(`${file.replace(".json", "")} ${label} ${real.toFixed(1)}`);
          }
          void key;
        }
      }
      // The row has to agree with itself: PTS / POSS * 100 is the ORtg printed
      // beside it. This is what makes the table checkable by a reader, and it
      // is the invariant the 592.3 broke.
      const [pts, poss, ortg] = [r[4], r[6], r[21]];
      if (ortg && poss > 0 && Math.abs((pts / poss) * 100 - ortg / 10) > 1.5) inconsistent++;
    }
  }

  check("every team-game season has rows", empty.length === 0, empty.join(", "));
  check(
    "team-game ratings and pace are in range",
    outOfRange.length === 0,
    outOfRange.join("; "),
  );
  check(
    "team-game ORtg agrees with PTS and POSS",
    inconsistent === 0,
    inconsistent ? `${inconsistent} of ${scanned.toLocaleString()} rows disagree` : "",
  );
}

// ── Report ────────────────────────────────────────────────────────────────
for (const line of ok) console.log(`  ok    ${line}`);
for (const line of warn) console.log(`  warn  ${line}`);
for (const line of fail) console.error(`  FAIL  ${line}`);
console.log(`\n${ok.length} passed, ${warn.length} warnings, ${fail.length} failed`);
if (fail.length) {
  console.error("\nNOT deploy-ready.");
  process.exit(1);
}
console.log("\nDeploy-ready. Next: npm run sync:r2, then netlify deploy --prod --dir=out --no-build");
