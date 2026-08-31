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
  const excluded = [...(seasonsSrc.match(/EXCLUDED_SEASONS[^=]*= new Set\(\[([^\]]*)\]/)?.[1] ?? "")
    .matchAll(/\d+/g)].map((m) => Number(m[0]));

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
const MUST_BE_GONE = [
  "data/player-games", "data/player", "data/player-ranks", "data/player-splits",
  "data/tournament-box", "data/team", "data/game-players", "data/shots",
  "data/game-index", "data/players-by-year", "data/lineup-stats",
  "data/team-seasons", "data/assist-players",
  "data/teams-all.json", "data/assist-network.json",
];
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
