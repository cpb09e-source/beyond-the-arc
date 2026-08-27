#!/usr/bin/env node
/**
 * audit-preview-departures.mjs — find players our 2026-27 preview roster still
 * lists who are NOT on the school's official roster.
 *
 * WHAT WENT WRONG THAT THIS CATCHES. season-preview.json is seeded from Bart,
 * and Bart (like ESPN) keeps departed players on a roster through the
 * offseason. patch-preview-departures.mjs removes them, but it has only been
 * run against part of the field — so a team like Gonzaga still shows Graham Ike
 * and Jalen Warley as returning months after they left, which then reads as
 * "high roster continuity" on any metric built from that roster.
 *
 * THE AUTHORITY IS THE SCHOOL'S OWN ROSTER PAGE, already scraped into
 * official-rosters-2026.json by audit-rosters.mjs. That is the only source that
 * is current in the offseason, which is the whole reason that scrape exists.
 *
 * RETURNERS AND TRANSFERS MEAN OPPOSITE THINGS WHEN THEY GO MISSING, and the
 * first run of this conflated them. A `returning` player the school does not
 * list has LEFT and the preview has not caught up — that is the Graham Ike
 * case, and it inflates continuity. A `transfer` the school does not list is
 * almost always the scrape being older than the preview: official-rosters was
 * captured 2026-08-13 and manual transfers are still being patched in weeks
 * later, so a commit from last Tuesday cannot be on a page scraped a fortnight
 * ago. Reported separately, because acting on the second list the way you act
 * on the first would delete real signings.
 *
 * BOTH DIRECTIONS ARE CHECKED, because the first version only did one and let
 * Florida through clean. Every Florida player we listed was on the school's
 * page, so nothing looked wrong — but the page had two players we did not
 * have, one of whom (Xaivian Lee) our data had at another school entirely. A
 * one-way check can only ever find people we should drop, never people we are
 * missing, and a missing returner understates continuity exactly as a stale one
 * overstates it.
 *
 * A name on the official roster that we do not carry is only reported when the
 * player HAS prior D-I minutes. A name we have never seen is almost always a
 * true freshman, and a preview built before signing day will not have him.
 *
 * NOTHING IS PATCHED HERE. This reports; a human decides. Name matching across
 * two sources is good but not perfect — "Joaquim ArauzMoore" against "Joaquim
 * Arauz Moore" is a normalisation problem, not a departure — and silently
 * deleting players from a roster on a fuzzy match is exactly the kind of edit
 * that is invisible until someone notices a team is missing its best player.
 *
 * WHERE THE SCRAPE ITSELF FAILED, the team is reported separately rather than
 * treated as "everyone departed". Gonzaga's page yields four players because the
 * roster renders client-side; a comparison against that would flag fifteen false
 * departures. 324 of 336 scraped teams carry a plausible 12-18 man roster, and
 * only those are compared.
 *
 * Reads only committed data — safe during the freeze. (Re-running the scrape
 * itself is audit-rosters.mjs, which is deliberately ungated because it reads
 * athletics roster pages rather than the stat archive.)
 *
 *   node scripts/audit-preview-departures.mjs
 *   node scripts/audit-preview-departures.mjs Gonzaga "Saint Mary's"
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PREVIEW = path.join(ROOT, "public/data/season-preview.json");
const OFFICIAL = path.join(ROOT, "public/data/official-rosters-2026.json");
const PLAYERS = path.join(ROOT, "public/data/players-explorer/2026.json");

/** A scraped roster outside this range did not scrape properly. */
const MIN_PLAUSIBLE = 10;
const MAX_PLAUSIBLE = 22;

const preview = JSON.parse(fs.readFileSync(PREVIEW, "utf8"));
const official = JSON.parse(fs.readFileSync(OFFICIAL, "utf8"));

/**
 * Names are compared on letters only, accents folded, suffixes dropped.
 *
 * The two sources disagree about spacing and punctuation far more often than
 * about who is on the team: "ArauzMoore" vs "Arauz Moore", "D'Angelo" vs
 * "DAngelo", "Jr." vs "Jr". Stripping to letters makes those the same string
 * without any fuzzy distance matching, which would start producing false
 * matches between different players on the same roster.
 */
function norm(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z]/g, "");
}

/** Last name + first initial, the fallback when a first name is a nickname. */
function loose(s) {
  const parts = String(s ?? "").toLowerCase().normalize("NFKD")
    .replace(/[̀-ͯ]/g, "").replace(/[^a-z\s]/g, " ")
    .split(/\s+/).filter(Boolean)
    .filter((w) => !["jr", "sr", "ii", "iii", "iv", "v"].includes(w));
  if (parts.length < 2) return null;
  return `${parts[0][0]}|${parts[parts.length - 1]}`;
}

/**
 * Last season's players, by normalised name, with the team they played for.
 *
 * Used to tell a missing veteran from a missing freshman, and to say where a
 * player we have misfiled actually came from.
 */
const priorByName = new Map();
try {
  const pe = JSON.parse(fs.readFileSync(PLAYERS, "utf8"));
  const iName = pe.fields.indexOf("name"), iTeam = pe.fields.indexOf("team_name");
  const iG = pe.fields.indexOf("games"), iM = pe.fields.indexOf("min_pg");
  for (const r of pe.rows) {
    const mins = (Number(r[iM]) || 0) * (Number(r[iG]) || 0);
    if (mins <= 0) continue;
    priorByName.set(norm(r[iName]), { team: r[iTeam], mins: Math.round(mins) });
  }
} catch {
  console.warn("   ! players-explorer 2026 unreadable — missing-player check disabled");
}

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));

const stale = [];
const absent = [];
const pendingTransfers = [];
const unscraped = [];
let compared = 0, listed = 0;

for (const [team, entry] of Object.entries(preview.teams ?? {})) {
  if (only.length && !only.includes(team)) continue;

  const off = official.teams?.[team];
  const size = off?.players?.length ?? 0;
  if (!off || size < MIN_PLAUSIBLE || size > MAX_PLAUSIBLE) {
    unscraped.push({ team, size, url: off?.url ?? null });
    continue;
  }
  compared++;

  const exact = new Set(off.players.map((p) => norm(p.name)));
  const fuzzy = new Set(off.players.map((p) => loose(p.name)).filter(Boolean));

  // Newcomers are excluded: a true freshman is often added to the athletics
  // roster later than he is to a preview, so his absence is a timing artefact
  // rather than a departure. Returners and transfers should both be listed.
  const shouldBeListed = (entry.roster ?? []).filter((p) => p.status !== "newcomer");
  const missing = shouldBeListed.filter(
    (p) => !exact.has(norm(p.name)) && !fuzzy.has(loose(p.name)),
  );
  listed += shouldBeListed.length;

  const departed = missing.filter((p) => p.status === "returning");
  const unlisted = missing.filter((p) => p.status !== "returning");
  if (departed.length) {
    stale.push({
      team,
      officialSize: size,
      previewSize: (entry.roster ?? []).length,
      missing: departed.map((p) => `${p.name}${p.cls ? ` (${p.cls})` : ""}`),
      url: off.url,
    });
  }
  if (unlisted.length) {
    pendingTransfers.push({ team, names: unlisted.map((p) => p.name) });
  }

  // The other direction: on the school's page, absent from ours.
  const ourExact = new Set((entry.roster ?? []).map((p) => norm(p.name)));
  const ourLoose = new Set((entry.roster ?? []).map((p) => loose(p.name)).filter(Boolean));
  for (const p of off.players) {
    if (ourExact.has(norm(p.name)) || ourLoose.has(loose(p.name))) continue;
    const prior = priorByName.get(norm(p.name));
    if (!prior) continue;
    absent.push({
      team,
      name: p.name,
      priorTeam: prior.team,
      mins: prior.mins,
      // Filed at another school in our data is a different, worse error than
      // simply not being on the roster yet.
      misfiled: prior.team !== team,
    });
  }
}

stale.sort((a, b) => b.missing.length - a.missing.length);

console.log(
  `Compared ${compared} teams (${listed} returners + transfers) against their ` +
  `official roster pages.\n`,
);

if (stale.length) {
  console.log(
    `── ${stale.length} teams still list a RETURNING player the school does not ──
` +
    `   Departures the preview has not caught up with; each inflates that
` +
    `   team’s returning-minutes and roster continuity.
`,
  );
  for (const t of stale) {
    console.log(`${t.team}  (preview ${t.previewSize}, official ${t.officialSize})`);
    for (const m of t.missing) console.log(`    ${m}`);
    console.log(`    ${t.url}`);
  }
  console.log();
}

if (unscraped.length) {
  console.log(
    `── ${unscraped.length} teams could not be checked: the roster scrape is ` +
    `missing or implausible ──`,
  );
  for (const u of unscraped) {
    console.log(`    ${u.team.padEnd(26)} ${u.size} players  ${u.url ?? "(no URL resolved)"}`);
  }
  console.log(
    `\n    Re-scrape these with: node scripts/audit-rosters.mjs\n` +
    `    (ungated during the freeze — it reads athletics pages, not the stat archive)`,
  );
}

if (absent.length) {
  absent.sort((a, b) => b.mins - a.mins);
  console.log(
    `── ${absent.length} players are on a school's roster but not in our preview ──`,
  );
  console.log("   All have prior D-I minutes, so none is a true freshman.");
  console.log();
  for (const a of absent) {
    const where = a.misfiled
      ? `we have him at ${a.priorTeam}`
      : `played for ${a.priorTeam}`;
    console.log(`    ${a.team.padEnd(22)} ${a.name.padEnd(22)} ${String(a.mins).padStart(5)}m  ${where}`);
  }
  console.log();
}

const totalStale = stale.reduce((a, t) => a + t.missing.length, 0);
const totalPending = pendingTransfers.reduce((a, t) => a + t.names.length, 0);

if (pendingTransfers.length) {
  console.log(
    `── ${pendingTransfers.length} teams list an incoming TRANSFER the school does not ──`,
  );
  console.log("   Expected rather than wrong: the scrape predates these commitments.");
  console.log("   Shown so a genuinely bad signing can be spotted among them.");
  console.log();
  for (const t of pendingTransfers) {
    console.log(`    ${t.team.padEnd(22)} ${t.names.join(", ")}`);
  }
  console.log();
}

console.log(
  `${totalStale} un-recorded departures across ${stale.length} teams  ` +
  `·  ${totalPending} transfers ahead of the scrape  ` +
  `·  ${unscraped.length} teams unverifiable`,
);
