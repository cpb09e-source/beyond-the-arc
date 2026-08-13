#!/usr/bin/env node
/**
 * patch-preview-departures.mjs — drop players who left for the NBA from
 * season-preview.json, in place, no network.
 *
 * WHAT WENT WRONG. Michigan's 2026-27 preview roster listed Yaxel Lendeborg,
 * Aday Mara and Morez Johnson Jr., who went 11th, 12th and 9th in the June 2026
 * draft. Nineteen of the sixty players drafted were still on a preview roster,
 * across eleven teams, and they were the highest-EPM names on several of them —
 * so the team preview pages showed departed lottery picks as returners and the
 * projection ranked those teams on their production.
 *
 * build-season-preview.mjs HAS a draft filter (step 6). Two things defeat it:
 *
 *  1. It matches on normName, which deliberately keeps suffixes so the recruit
 *     matching elsewhere works. The roster says "Morez Johnson JR" and the draft
 *     list says "morez johnson", so they never met. Suffix-insensitive matching
 *     is what linkKey already does in the same file.
 *
 *  2. It runs BEFORE step 7, the official-roster reconciliation, which adds
 *     anyone on the school's athletics page that we are missing. Schools keep
 *     drafted players posted for weeks, so step 7 puts back what step 6 removed.
 *     Order matters: departures must be applied last.
 *
 * The key bug is fixed in the builder. The ordering one cannot be — step 7 has
 * to run after step 6 to add late roster additions — so THIS SCRIPT IS THE
 * FINAL PASS and belongs at the end of any preview rebuild, not just as a
 * one-off repair of the frozen artifact.
 *
 * COLLEGE MUST CORROBORATE, exactly as the builder intends: a drafted player is
 * only removed from the team he actually played for (or transferred from), so a
 * different man with the same name elsewhere is never touched.
 *
 *   Run: node scripts/patch-preview-departures.mjs [--dry]
 */
import fs from "node:fs";
import path from "node:path";

const DATA = path.resolve("public/data");
const FILE = path.join(DATA, "season-preview.json");
const DRY = process.argv.includes("--dry");

const normName = (s) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
// The fix: suffix-insensitive, matching linkKey in the builder.
const linkKey = (s) => normName(s).replace(/\s+(jr|sr|ii|iii|iv|v)$/, "");
/**
 * The draft feed writes schools the way a broadcast does — "UNC", "Ole Miss",
 * "Pitt" — and our roster data uses Bart's names. Without these, the college
 * corroboration silently fails OPEN and leaves the player on the roster: Caleb
 * Wilson went 4th overall and stayed on North Carolina's projected roster
 * because "unc" is not "northcarolina".
 */
const TEAM_ALIAS = {
  unc: "northcarolina", olemiss: "mississippi", pitt: "pittsburgh",
  uconn: "connecticut", smu: "smu", ucf: "ucf", lsu: "lsu", vcu: "vcu",
  byu: "byu", tcu: "tcu", usc: "usc", ucla: "ucla",
  miami: "miamifl", miamifla: "miamifl", stjohns: "stjohns",
  ncstate: "ncst", northcarolinast: "ncst",
};
const normTeamRaw = (s) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/\buniversity\b|\bthe\b/g, "").replace(/\bstate\b/g, "st").replace(/[^a-z0-9]+/g, "");
const normTeam = (s) => { const k = normTeamRaw(s); return TEAM_ALIAS[k] ?? k; };

const doc = JSON.parse(fs.readFileSync(FILE, "utf8"));
const DRAFT_YEAR = doc.season - 1;          // the June draft that ended last season

const draftees = JSON.parse(fs.readFileSync(path.join(DATA, "nba-draftees.json"), "utf8"));
const byKey = new Map();
for (const [name, v] of Object.entries(draftees)) {
  if (v.year !== DRAFT_YEAR) continue;
  byKey.set(linkKey(name), { pick: v.pick, college: normTeam(v.college ?? ""), name });
}
if (byKey.size === 0) {
  console.error(`✗ no ${DRAFT_YEAR} draftees in nba-draftees.json — refusing to run.`);
  process.exit(1);
}
console.log(`${DRAFT_YEAR} draft class: ${byKey.size} players\n`);

let removed = 0, kept = 0;
const gone = [];
for (const [teamName, t] of Object.entries(doc.teams ?? {})) {
  const before = t.roster?.length ?? 0;
  t.roster = (t.roster ?? []).filter((p) => {
    const d = byKey.get(linkKey(p.name));
    if (!d) return true;
    const here = normTeam(teamName), from = normTeam(p.from ?? "");
    // Blank college in the draft data cannot corroborate anything, so it is
    // treated as a match rather than left on the roster — a drafted name with
    // no college attached is far more likely to be the player than a coincidence.
    if (d.college === "" || d.college === here || d.college === from) {
      removed++;
      gone.push({ team: teamName, name: p.name, pick: d.pick, epm: p.epm });
      return false;
    }
    kept++;
    return true;
  });
  if (before !== t.roster.length) t.roster_pruned_departures = before - t.roster.length;
}

gone.sort((a, b) => a.pick - b.pick);
console.log(`removed ${removed} drafted players from preview rosters:`);
for (const g of gone) {
  console.log(`  pick ${String(g.pick).padStart(2)}  ${g.name.padEnd(22)} ${g.team}${g.epm != null ? `   (EPM ${g.epm})` : ""}`);
}
if (kept) console.log(`\n${kept} same-name players left alone — college did not corroborate.`);

if (removed === 0) { console.log("\nnothing to do."); process.exit(0); }
if (DRY) { console.log("\n--dry: nothing written."); process.exit(0); }

doc.departures_patched_at = new Date().toISOString();
fs.writeFileSync(FILE, JSON.stringify(doc));
console.log(`\n✓ rewrote ${FILE}`);
