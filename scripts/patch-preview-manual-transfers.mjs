#!/usr/bin/env node
/**
 * patch-preview-manual-transfers.mjs — apply hand-confirmed transfers to
 * season-preview.json, in place, no network.
 *
 * WHY. The automated sources each have a blind spot. portal.json only carries a
 * player once On3 has logged the commitment, and On3 misses people outright —
 * Seth Trimble, a four-year North Carolina starter, has no portal record at
 * all, so every derived source still has him at North Carolina. A school's own
 * roster page fills some of that in, but only after the school posts it, and a
 * summer commitment can sit unposted for weeks. That leaves a class of move
 * that is public knowledge and confirmed by eye while every feed we read still
 * shows the old team.
 *
 * This is the override for exactly that case: the list below is entered by
 * hand, so it outranks portal.json and the roster scrape both. Date the batch
 * when you add one — a manual claim ages, and knowing when it was made is what
 * lets a later reader decide whether it still holds.
 *
 * WHAT IT RESOLVES ON ITS OWN. Only the destination is asserted; everything
 * else is looked up, in falling order of authority:
 *   - the player's current preview row  → keeps his stats and carries his
 *     current team across as the "from" school
 *   - portal.json                        → bart id and team_from
 *   - players-index.json                 → bart id, height, and the team of his
 *     most recent season, with the class advanced a year the way a preview row
 *     stores it (a 2025-26 junior is a senior here)
 * A player none of those know is still added, as a transfer with no origin —
 * the badge renders without a school logo rather than inventing one.
 *
 * AMBIGUOUS NAMES ARE NOT GUESSED. Two Curtis Williamses played in 2025-26,
 * both 6-6 juniors, and only the suffix separates them; the index is matched on
 * the exact name first for that reason. Where a name still resolves to more
 * than one id the move is applied but no bart id is attached, and the case is
 * reported, because a wrong id silently grafts another man's career onto the row.
 *
 *   node scripts/patch-preview-manual-transfers.mjs [--dry]
 */
import fs from "node:fs";
import path from "node:path";

const DATA = path.resolve("public/data");
const PREVIEW = path.join(DATA, "season-preview.json");
const PORTAL = path.join(DATA, "portal.json");
const INDEX = path.join(DATA, "players-index.json");
const DRY = process.argv.includes("--dry");

/**
 * Confirmed by hand, in the order the batches were added — 22 on 2026-08-17,
 * three on 2026-08-18, two on 2026-08-19. Keep in step with the BATCHES list in
 * patch-portal-manual.mts: a move added to one and not the other leaves the
 * portal table and the team pages disagreeing about where the player is.
 *
 * Destination is written the way we name teams; the shorthand a human types
 * ("UNC", "Cincy") is mapped in DEST_ALIAS below.
 */
const MOVES = [
  ["BJ Edwards", "Oklahoma"],
  ["Kaleb Banks", "Tulsa"],
  ["Skyy Clark", "LSU"],
  ["Brody Robinson", "Creighton"],
  ["Seth Trimble", "Louisville"],
  ["Javon Bennett", "Gonzaga"],
  ["Amarri Monroe", "Syracuse"],
  ["Chendall Weaver", "Houston"],
  ["Cameron Fens", "UNC"],
  ["Jalen Washington", "Tennessee"],
  ["L.J. Cason", "Miami"],
  ["RJ Godfrey", "Arizona"],
  ["MJ Collins Jr.", "Cincy"],
  ["Jahki Howard", "Long Island"],
  ["Curtis Williams Jr.", "High Point"],
  ["Daquan Davis", "Long Island"],
  ["Chris Johnson", "Oregon State"],
  ["Skylar Wicks", "Gonzaga"],
  ["Malique Ewin", "Oregon"],
  ["Jamichael Stillwell", "Texas Tech"],
  ["Tavari Johnson", "Charleston"],
  ["Chauncey Wiggins", "Gonzaga"],
  // 2026-08-18 — these three were added to patch-portal-manual.mts and written
  // into portal.json without being added here, so the portal knew about the
  // move and the team pages did not: AJ Storr was still listed on Mississippi,
  // and Payne and King were on no roster at all. The two lists have to be
  // edited together.
  ["AJ Storr", "UNLV"],
  ["Stephon Payne", "New Mexico St."],
  ["Fredrick King", "Creighton"],
  // 2026-08-19
  ["Reed Bailey", "St. John's"],
  ["Braxton Stacker", "UNC Greensboro"],
  ["Jordan Pope", "Texas A&M"],
  ["Kenny Noland", "Michigan"],
  // 2026-08-20
  ["Lamar Washington", "Boise St."],
  ["Duke Brennan", "Oklahoma"],
  ["Jerald Colonel", "FIU"],
];

/** Common shorthand → the name season-preview.json uses. */
const DEST_ALIAS = {
  "UNC": "North Carolina",
  "Miami": "Miami FL",
  "Cincy": "Cincinnati",
  "Oregon State": "Oregon St.",
  "Long Island": "LIU",
};

const norm = (s) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
const key = (s) => norm(s).replace(/\s+(jr|sr|ii|iii|iv|v|vi)$/, "");
const tight = (s) => key(s).replace(/\s+/g, "");

/** A preview row stores the class the player will BE, not the one he just was. */
const NEXT_CLS = { Fr: "So", So: "Jr", Jr: "Sr", Sr: "Gr", Gr: "Gr" };
/** The season the preview advances FROM — 2025-26, stored as 2026. */
const PREV_SEASON = 2026;

const NULL_STATS = {
  epm: null, epmP: null, pir: null, pirP: null, pts: null, ptsP: null,
  reb: null, rebP: null, ast: null, astP: null, fg3: null, fg3P: null, ft: null, ftP: null,
  ts: null, tsP: null, usg: null, usgP: null, ewins: null, on_off: null, ewinsP: null, on_offP: null,
};

const doc = JSON.parse(fs.readFileSync(PREVIEW, "utf8"));
const portalRaw = JSON.parse(fs.readFileSync(PORTAL, "utf8"));
const portal = Array.isArray(portalRaw) ? portalRaw : (portalRaw.entries ?? Object.values(portalRaw).find(Array.isArray) ?? []);
const portalBy = new Map(portal.map((e) => [tight(e.name), e]));
const idxRaw = JSON.parse(fs.readFileSync(INDEX, "utf8"));
const index = Array.isArray(idxRaw) ? idxRaw : (idxRaw.players ?? Object.values(idxRaw).find(Array.isArray) ?? []);

// Index by exact name first — the suffix is the only thing separating the two
// Curtis Williamses — then fall back to the suffix-insensitive key.
const byExact = new Map(), byLoose = new Map();
for (const r of index) {
  for (const [m, k] of [[byExact, norm(r.n)], [byLoose, tight(r.n)]]) {
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
}
/** Most recent season row for a name, plus whether the name was ambiguous. */
function lookupIndex(name) {
  const rows = byExact.get(norm(name))?.length ? byExact.get(norm(name)) : (byLoose.get(tight(name)) ?? []);
  if (!rows.length) return null;
  const ids = new Set(rows.map((r) => r.id));
  const latest = rows.reduce((a, b) => (b.y > a.y ? b : a));
  return { ...latest, ambiguous: ids.size > 1 };
}

// Where every carried player currently sits.
const at = new Map();
for (const [tn, t] of Object.entries(doc.teams ?? {})) {
  for (const r of t.roster ?? []) if (!at.has(tight(r.name))) at.set(tight(r.name), { team: tn, row: r });
}

let moved = 0, added = 0, noop = 0, failed = 0;
const lines = [];

for (const [name, destRaw] of MOVES) {
  const dest = DEST_ALIAS[destRaw] ?? destRaw;
  const t = doc.teams?.[dest];
  if (!t) { failed++; lines.push(`✗ ${name} — destination "${destRaw}" (${dest}) is not a team in the preview`); continue; }

  const cur = at.get(tight(name));
  const pe = portalBy.get(tight(name));
  const ix = lookupIndex(name);

  // Already where he belongs: make sure he reads as a transfer, then leave him.
  if (cur && cur.team === dest) {
    const fixes = [];
    if (cur.row.status !== "transfer") { cur.row.status = "transfer"; fixes.push("status → transfer"); }
    // portal.json outranks players-index.json here. The index is the thinner
    // corpus — it has no Jahki Howard at all, and stops Daquan Davis at Florida
    // St. a year before his Providence season — so a row first written from the
    // index can name the wrong previous school. Once patch-portal-manual.mts
    // has resolved these against players-by-year, re-running this corrects them.
    if (cur.row.bart_id == null) {
      const id = pe?.bart_player_id ?? (ix && !ix.ambiguous ? ix.id : null);
      if (id != null) { cur.row.bart_id = id; fixes.push(`bart ${id}`); }
    }
    const origin = pe?.team_from ?? (ix && ix.t !== dest ? ix.t : null);
    if (origin && cur.row.from !== origin) {
      fixes.push(cur.row.from ? `from "${cur.row.from}" → "${origin}"` : `from ${origin}`);
      cur.row.from = origin;
    }
    if (fixes.length) { moved++; lines.push(`= ${name.padEnd(21)} already on ${dest} — ${fixes.join(", ")}`); }
    else { noop++; lines.push(`· ${name.padEnd(21)} already on ${dest} as a transfer, unchanged`); }
    continue;
  }

  // Carried by another team → move the row, keeping whatever stats it holds.
  if (cur) {
    const src = doc.teams[cur.team];
    src.roster = src.roster.filter((r) => r !== cur.row);
    const row = cur.row;
    row.status = "transfer";
    row.from = cur.team;
    if (row.bart_id == null && ix && !ix.ambiguous) row.bart_id = ix.id;
    t.roster.push(row);
    at.set(tight(name), { team: dest, row });
    moved++;
    lines.push(`→ ${name.padEnd(21)} ${cur.team} → ${dest}${row.bart_id ? `  bart ${row.bart_id}` : ""}${row.epm != null ? `  epm ${row.epm}` : ""}`);
    continue;
  }

  // Not carried anywhere → build the row from whatever we can resolve.
  const bart = pe?.bart_player_id ?? (ix && !ix.ambiguous ? ix.id : null);
  const origin = pe?.team_from ?? ix?.t ?? null;
  const row = {
    name,
    bart_id: bart,
    cls: ix?.cl ? (NEXT_CLS[ix.cl] ?? null) : (pe?.eligibility ? (NEXT_CLS[{ Freshman: "Fr", Sophomore: "So", Junior: "Jr", Senior: "Sr" }[pe.eligibility]] ?? null) : null),
    ht: ix?.h ?? null,
    status: "transfer",
    link: false,                 // refresh-preview-links.mjs decides this properly
    ...NULL_STATS,
  };
  if (origin) row.from = origin;
  t.roster.push(row);
  at.set(tight(name), { team: dest, row });
  added++;
  const why = pe ? "portal" : ix ? `index ${ix.y}` : "name only";
  lines.push(`+ ${name.padEnd(21)} → ${dest.padEnd(15)} ${String(row.cls ?? "?").padEnd(3)} ${String(row.ht ?? "?").padEnd(5)} from ${origin ?? "UNKNOWN"}${bart ? `  bart ${bart}` : "  (no bart id)"}  [${why}]`);
  if (ix?.ambiguous) lines.push(`    ! "${name}" matches more than one player id — moved, but no bart id attached`);
  // The class advance assumes the indexed season is the one just played. When
  // it isn't, the player sat out a year and how that year counts against his
  // eligibility is not something this file records — so say so rather than
  // quietly publish a class that is a year light.
  if (ix && !pe && ix.y < PREV_SEASON) {
    lines.push(`    ! newest season on file is ${ix.y}, not ${PREV_SEASON} — class "${row.cls}" assumes no year was lost; check by hand`);
  }
  if (!bart) lines.push(`    ! no bart id — no profile link and no impact numbers; badge renders without a school logo`);
}

console.log(lines.join("\n"));
console.log(`\nmoved ${moved} · added ${added} · unchanged ${noop} · failed ${failed}`);

if (DRY) { console.log("\n--dry: nothing written."); process.exit(0); }
doc.manual_transfers_at = new Date().toISOString();
fs.writeFileSync(PREVIEW, JSON.stringify(doc));
console.log(`✓ rewrote ${PREVIEW}`);
