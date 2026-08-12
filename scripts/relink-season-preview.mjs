#!/usr/bin/env node
/**
 * relink-season-preview.mjs — repair season-preview.json IN PLACE, no network.
 *
 * WHY THIS EXISTS SEPARATELY. build-season-preview.mjs fetches Bart's living
 * offseason feed, and the data freeze runs until October 2026, so re-running it
 * to pick up a code fix would pull upstream data we are not supposed to pull.
 * This applies the same repair to the file already on disk, using only data we
 * already hold.
 *
 * WHAT IT REPAIRS. The overlays inside the builder (portal, recruits, official
 * rosters, draftees) add players by NAME. Anyone they add therefore lands with
 * bart_id null, status "newcomer" and an empty stat line — even when we already
 * hold that player's 2025-26 season. Arizona showed Jaden Bradley, Brayden
 * Burries, Koa Peat and Dwayne Aristode as statless newcomers immediately after
 * all four played there. Across 365 teams it is 657 rows.
 *
 * The fix is a name join back to players-by-year/<PREV>, which restores the
 * bart id, the correct returning / transfer tag, height, the profile link and
 * last season's numbers.
 *
 * ONLY UNIQUE NAMES RESOLVE. Two players sharing a normalised name is precisely
 * the case where a guess staples one man's season onto another, and a blank row
 * is better than a confidently wrong one. Suffixes are stripped for matching
 * because the feeds disagree about them ("MJ Collins Jr." vs "MJ Collins").
 *
 * Idempotent: rows that already carry a bart_id are never touched, so running
 * it twice changes nothing.
 *
 *   Run: node scripts/relink-season-preview.mjs [--dry]
 */
import fs from "node:fs";
import path from "node:path";

const DATA = path.resolve("public/data");
const FILE = path.join(DATA, "season-preview.json");
const DRY = process.argv.includes("--dry");

const doc = JSON.parse(fs.readFileSync(FILE, "utf8"));
const PREV_YEAR = doc.season - 1;

const normName = (s) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
const linkKey = (s) => normName(s).replace(/\s+(jr|sr|ii|iii|iv|v)$/, "");

const prev = JSON.parse(fs.readFileSync(path.join(DATA, "players-by-year", `${PREV_YEAR}.json`), "utf8"));
const byKey = new Map();
const teamById = new Map();
for (const p of prev) {
  if (p.bart_player_id == null) continue;
  const t = Array.isArray(p.teams) ? p.teams[0] : p.teams;
  teamById.set(p.bart_player_id, t?.name ?? null);
  const k = linkKey(p.name);
  byKey.set(k, byKey.has(k) ? "AMBIGUOUS" : p);
}

// Stat line, off the same rank file the builder reads and in the same shape.
// Mirrors statsFor() in build-season-preview.mjs — including the two quirks
// documented there: the impact column is `epm` (not the retired `bta_portg`),
// and usage is keyed `usage`, not `usage_pct`.
const round1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

// eWins + on/off, which live in epm-<year>.json rather than the rank files.
// Same source and same no-box-fallback rule as the builder — see the note on
// impactExtras there.
const impactExtras = (() => {
  const m = new Map();
  try {
    const j = JSON.parse(fs.readFileSync(path.join(DATA, `epm-${PREV_YEAR}.json`), "utf8"));
    const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
    for (const [bid, v] of Object.entries(j.players || {})) {
      m.set(Number(bid), { ewins: num(v.ewins), on_off: num(v.on_off) });
    }
  } catch { /* leave blank */ }
  return m;
})();

// Their percentile chips, over the same pool poolPercentiles uses on a normal
// team page: every bart id in players-by-year/<PREV>, ranked ascending.
const percentilesOver = (pick) => {
  const vals = [];
  for (const p of prev) {
    const v = p.bart_player_id != null ? impactExtras.get(p.bart_player_id) : null;
    const x = v ? pick(v) : null;
    if (x != null) vals.push([p.bart_player_id, x]);
  }
  vals.sort((a, b) => a[1] - b[1]);
  const out = new Map();
  if (vals.length < 2) return out;
  vals.forEach(([id], i) => out.set(id, Math.round((i / (vals.length - 1)) * 100)));
  return out;
};
const ewinsPct = percentilesOver((v) => v.ewins);
const onOffPct = percentilesOver((v) => v.on_off);

function statsFor(bartId) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(DATA, "player-ranks", `${bartId}.json`), "utf8"));
    const s = ((j.seasonRanks || []).find((x) => x.year === PREV_YEAR) || {}).stats || {};
    const v = (k) => (typeof s[k]?.value === "number" ? s[k].value : null);
    const p = (k) => (typeof s[k]?.percentile === "number" ? s[k].percentile : null);
    const asFrac = (k) => { const x = v(k); return x == null ? null : x > 1.5 ? x / 100 : x; };
    if (v("pts_pg") === null && v("epm") === null) return null;
    const ex = impactExtras.get(bartId) ?? { ewins: null, on_off: null };
    return {
      epm: round1(v("epm")), epmP: p("epm"),
      ewins: ex.ewins == null ? null : Math.round(ex.ewins * 100) / 100,
      ewinsP: ewinsPct.get(bartId) ?? null,
      on_off: round1(ex.on_off),
      on_offP: onOffPct.get(bartId) ?? null,
      pir: round1(v("pir")), pirP: p("pir"),
      pts: round1(v("pts_pg")), ptsP: p("pts_pg"),
      reb: round1(v("reb_pg")), rebP: p("reb_pg"),
      ast: round1(v("ast_pg")), astP: p("ast_pg"),
      fg3: asFrac("fg3_pct"), fg3P: p("fg3_pct"),
      ft: asFrac("ft_pct"), ftP: p("ft_pct"),
      ts: asFrac("ts_pct"), tsP: p("ts_pct"),
      usg: asFrac("usage"), usgP: p("usage"),
    };
  } catch { return null; }
}

// Class carried forward one year, matching advanceClass() in the builder.
const NEXT_CLASS = { Fr: "So", So: "Jr", Jr: "Sr", Sr: "Gr", Gr: "Gr" };
const heightById = new Map();
for (const pl of prev) {
  if (pl.bart_player_id == null) continue;
  const st = Array.isArray(pl.player_bart_stats) ? pl.player_bart_stats[0] : pl.player_bart_stats;
  const h = Array.isArray(st?.raw_row) ? st.raw_row[26] : null;
  if (h) heightById.set(pl.bart_player_id, h);
}
const classById = new Map(prev.filter((x) => x.bart_player_id != null).map((x) => [x.bart_player_id, x.class ?? null]));

let scanned = 0, linked = 0, ambiguous = 0, noMatch = 0, withStats = 0;
const moved = { returning: 0, transfer: 0, newcomer: 0 };
const examples = [];

for (const [teamName, team] of Object.entries(doc.teams)) {
  for (const row of team.roster ?? []) {
    if (row.bart_id != null) continue;
    scanned++;
    const hit = byKey.get(linkKey(row.name));
    if (hit === "AMBIGUOUS") { ambiguous++; continue; }
    if (!hit) { noMatch++; continue; }

    const id = hit.bart_player_id;
    const prevTeam = teamById.get(id) ?? null;
    const status = prevTeam == null ? "newcomer" : prevTeam === teamName ? "returning" : "transfer";
    row.bart_id = id;
    row.status = status;
    moved[status]++;
    if (status === "transfer") row.from = prevTeam; else delete row.from;
    row.ht = row.ht ?? heightById.get(id) ?? null;
    row.cls = row.cls ?? NEXT_CLASS[classById.get(id) ?? ""] ?? null;
    const st = statsFor(id);
    if (st) { Object.assign(row, st); withStats++; }
    linked++;
    if (examples.length < 8) examples.push(`${teamName}: ${row.name} → ${status}${st ? ` (EPM ${st.epm ?? "—"})` : " (no rank file)"}`);
  }
  // Keep the roster ordered the way the builder leaves it.
  team.roster?.sort((a, b) => (b.epm ?? -99) - (a.epm ?? -99));
}

console.log(`unlinked rows scanned: ${scanned}`);
console.log(`  linked:      ${linked}  (${moved.returning} returning, ${moved.transfer} transfer, ${moved.newcomer} still newcomer)`);
console.log(`  with stats:  ${withStats}`);
console.log(`  ambiguous:   ${ambiguous}  (name shared by 2+ players — left blank on purpose)`);
console.log(`  no match:    ${noMatch}  (genuinely new — no prior D-I season)`);
console.log(examples.map((e) => `    ${e}`).join("\n"));

if (DRY) { console.log("\n--dry: nothing written."); process.exit(0); }
doc.relinked_at = new Date().toISOString();
fs.writeFileSync(FILE, JSON.stringify(doc));
console.log(`\n✓ rewrote ${FILE}`);
