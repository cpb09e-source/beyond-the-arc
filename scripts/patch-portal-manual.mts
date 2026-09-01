#!/usr/bin/env node
/**
 * patch-portal-manual.mts — put hand-confirmed transfers into portal.json.
 *
 * WHY. refresh-portal.mts can only publish what On3 has logged, and On3 both
 * lags and omits: Seth Trimble, a four-year North Carolina starter, has no
 * record there at all. scripts/patch-preview-manual-transfers.mjs already
 * fixes the team pages for that class of move, but the portal table and the
 * transfer-class rankings read portal.json, so a player corrected on one is
 * still absent from the other. This closes that gap with the SAME list.
 *
 * IT BUILDS ENTRIES THE WAY THE SCRAPER DOES. Production (gp/mpg/ppg/rpg/apg/
 * spg/bpg/pir), the conference of each school, and the D-I flags all come from
 * the same helpers refresh-portal.mts uses over the same frozen players-by-year
 * corpus — productionFor(), computeCohortStats(), the confBySchool map. A row
 * added here is therefore scored by rescore-portal.mjs on identical footing to
 * a scraped one, which is the point: a manual entry that skipped the stat join
 * would land with a null rating and quietly drag its new school's class score.
 *
 * WHAT IT WILL NOT DO. It never overwrites a destination On3 already agrees
 * with, and it will not invent production for a player the corpus does not
 * know: a name it cannot resolve to exactly one bart id lands with null stats
 * and scores as unrated rather than as a zero, because an unknown is not a bad
 * player and rescore-portal.mjs already distinguishes the two.
 *
 * Note that players-by-year is the fuller corpus and disagrees with
 * players-index.json, which the preview-side script reads. The index has no
 * Jahki Howard at all and stops Daquan Davis at Florida St. in 2024-25; this
 * corpus has Howard at Utah and Davis at Providence in 2025-26. Where the two
 * differ, this one is right, and the preview rows written from the index need
 * the same correction.
 *
 * ON date_entered. A hand-confirmed move has no feed timestamp. The date the
 * batch was confirmed is used, and marked source:"manual" on the row, so the
 * portal table's default COM-date sort stays meaningful and a later reader can
 * tell which rows never came from On3.
 *
 * RUN rescore-portal.mjs AFTERWARDS — this writes entries, not ratings.
 *
 *   npx tsx scripts/patch-portal-manual.mts [--dry]
 */
import fs from "node:fs/promises";
import path from "node:path";
// @ts-expect-error — plain .mjs helper with no type declarations.
import { readManualTransfers } from "./lib/manual-transfers.mjs";
import {
  computeCohortStats,
  productionFor,
  type PlayerSeason,
  type ProductionResult,
} from "./lib/bta-prtg.mts";
import { overrideTeamName } from "../src/lib/team-overrides.ts";

const OUT = path.resolve("public/data");
const PORTAL = path.join(OUT, "portal.json");
const DRY = process.argv.includes("--dry");

/**
 * Hand-confirmed moves, in dated batches — the same list as
 * patch-preview-manual-transfers.mjs, which must be kept in step with it.
 *
 * BATCHED BY DATE, not pooled, because date_entered is what the portal table's
 * default sort orders on. A move confirmed today but stamped with the first
 * batch's date sorts as though it had been known for days, which is the one
 * thing that field is read for. Add new moves as a NEW batch; never append to
 * an older one.
 */
// BATCHES was here. See the note on MOVES below.

/**
 * Entries On3 joined to the WRONG player, by cbba_player_id.
 *
 * The feed sends a name and the name is matched against our corpus. Where two
 * players share a school and an initial-and-surname key, that match can land
 * on the wrong one: "DJ Wagner" (Arkansas, 2026) resolved to Dequavious
 * Wagner, an Arkansas guard whose last season was 2014, and the row carried
 * his eight-game line into the portal table.
 *
 * The tie-break is fixed in refresh-portal.mts (most recent season wins), but
 * that script cannot run under the data freeze, so the correction lives here
 * as well: the id is set and everything derived from it — production, last
 * season, the school he is leaving — is recomputed from the corpus. Harmless
 * once a fresh pull agrees, since it will find nothing to change.
 */
const IDENTITY_FIXES: Array<{ cbba_player_id: number; bart_player_id: number; name: string; why: string }> = [
  {
    cbba_player_id: 269352,
    bart_player_id: 79249,
    name: "D.J. Wagner",
    why: "was bart 27594, Dequavious Wagner (Arkansas, last played 2014)",
  },
];

/**
 * The moves, from the table the admin page edits.
 *
 * THIS WAS TWO HARDCODED ARRAYS — the BATCHES list that used to sit above, and
 * an identical flat one in patch-preview-manual-transfers.mjs, each carrying a
 * comment telling whoever edited it to keep the other in step. Nothing enforced
 * that, and a move added to one and not the other left the portal table and the
 * team pages disagreeing about where a player is.
 *
 * STILL BATCHED BY DATE, and that survives the move: the portal table's default
 * sort is on date_entered, so a move stamped with the wrong day sorts as though
 * it had been known for longer than it was. The date now comes from the row's
 * own confirmed_on rather than from which array literal it was typed into.
 */
const MOVES: Array<[string, string, string]> = (await readManualTransfers()).map(
  (m) => [m.name, m.destination, m.confirmed] as [string, string, string],
);

const YEARS = Array.from({ length: 14 }, (_, i) => 2013 + i);

/** Only the fields this script reads off a players-by-year row. */
type RawPlayerRow = {
  bart_player_id: number | null;
  name: string;
  year: number;
  class: string | null;
  teams: { name?: string; conference?: string | null } | Array<{ name?: string; conference?: string | null }>;
  player_bart_stats:
    | { raw_row?: unknown; games?: number | null; notes?: string | null; projection?: number | null }
    | Array<{ raw_row?: unknown; games?: number | null; notes?: string | null; projection?: number | null }>;
};

/** Only the fields this script reads or writes on a portal entry. */
type PortalEntry = {
  cbba_player_id: number;
  bart_player_id: number | null;
  name: string;
  status: string;
  team_from: string | null;
  team_to: string | null;
  conf_to: string | null;
  rating?: number | null;
  [k: string]: unknown;
};

const normName = (s: string | null) => (s ?? "").toLowerCase().normalize("NFKD")
  .replace(/[̀-ͯ]/g, "").replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
const nameKey = (s: string | null) => normName(s).replace(/\s+(jr|sr|ii|iii|iv|v|vi)$/, "").replace(/\s+/g, "");
const normTeam = (s: string | null) => (s ?? "").toLowerCase().normalize("NFKD")
  .replace(/[̀-ͯ]/g, "").replace(/\bstate\b/g, "st").replace(/[^a-z0-9]+/g, "").trim();

/** On3 words the class the player just finished; match that vocabulary. */
const ELIG_FROM_CLASS: Record<string, string> = {
  Fr: "Freshman", So: "Sophomore", Jr: "Junior", Sr: "Senior", Gr: "Graduate",
};

/**
 * A synthetic stand-in for On3's record key, which a hand-entered row has no
 * value for. It has to be UNIQUE and STABLE, not merely absent: the portal
 * table keys its rows on `cbba_player_id + "-" + date_entered`, so leaving
 * every manual row at 0 with a shared confirmation date collides them all onto
 * one React key, and React's own warning for that is that children "may be
 * duplicated and/or omitted" — rows silently missing from the table.
 *
 * Negative keeps it clear of every real On3 key, which is positive. Deriving it
 * from the bart id, or failing that from a hash of the name, keeps it identical
 * across re-runs so the row does not churn.
 */
function syntheticKey(bart: number | null, name: string): number {
  if (bart !== null) return -bart;
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 1_000_000;
  return -(1_000_000 + h);
}

async function main() {
  console.log("🌀 manual portal entries\n");

  // Same corpus, same shape, as refresh-portal.mts.
  const playersByBartId = new Map<number, PlayerSeason[]>();
  const byName = new Map<string, Map<number, { teams: Set<string>; year: number; exact: Set<string> }>>();
  let yearsLoaded = 0;
  for (const year of YEARS) {
    let text: string;
    try { text = await fs.readFile(path.join(OUT, "players-by-year", `${year}.json`), "utf8"); }
    catch { continue; }
    yearsLoaded++;
    const players = JSON.parse(text) as RawPlayerRow[];
    for (const p of players) {
      const pid = p.bart_player_id;
      if (!pid) continue;
      const team = Array.isArray(p.teams) ? p.teams[0] : p.teams;
      const stats = Array.isArray(p.player_bart_stats) ? p.player_bart_stats[0] : p.player_bart_stats;
      if (!playersByBartId.has(pid)) playersByBartId.set(pid, []);
      playersByBartId.get(pid)!.push({
        year: p.year, team_name: team?.name ?? "—", team_conference: team?.conference ?? null,
        class: p.class, raw_row: stats?.raw_row ?? null, games: stats?.games ?? null,
        notes: stats?.notes ?? null, projection: stats?.projection ?? null,
      });
      const k = nameKey(p.name);
      if (!k) continue;
      if (!byName.has(k)) byName.set(k, new Map());
      const rec = byName.get(k)!.get(pid) ?? { teams: new Set<string>(), year: 0, exact: new Set<string>() };
      if (team?.name) rec.teams.add(normTeam(team.name));
      if (p.year > rec.year) rec.year = p.year;
      rec.exact.add(normName(p.name));
      byName.get(k)!.set(pid, rec);
    }
  }
  if (yearsLoaded === 0) {
    console.error("✗ no players-by-year files loaded — refusing to write against an empty corpus.");
    process.exit(1);
  }
  for (const seasons of playersByBartId.values()) seasons.sort((a, b) => b.year - a.year);
  console.log(`   corpus: ${playersByBartId.size.toLocaleString()} bart ids across ${yearsLoaded} years`);

  const yearCohortStats = computeCohortStats(playersByBartId);

  // Conference per school from the latest season we hold; membership doubles as
  // "is D-I", exactly as refresh-portal.mts treats it.
  const confBySchool = new Map<string, string | null>();
  {
    const latest = new Map<string, { year: number; conf: string | null }>();
    for (const seasons of playersByBartId.values()) {
      for (const s of seasons) {
        const cur = latest.get(s.team_name);
        if (!cur || s.year > cur.year) latest.set(s.team_name, { year: s.year, conf: s.team_conference });
      }
    }
    for (const [n, v] of latest) confBySchool.set(normTeam(n), v.conf);
  }
  const isD1 = (n: string | null) => !!n && confBySchool.has(normTeam(n));
  const confFor = (n: string | null) => (n ? confBySchool.get(normTeam(n)) ?? null : null);

  /**
   * Newest season wins; the exact spelling only breaks a tie between players
   * whose newest season is the same year.
   *
   * Both halves are load-bearing, and each one alone gets a name wrong. Rank
   * on the spelling first and "BJ Edwards" resolves to a Jacksonville player
   * who last appeared a decade ago and literally carries that spelling, while
   * the man being transferred is written "B.J. Edwards" and loses. Rank on
   * recency alone and the two Curtis Williamses — one at Tulane, one at
   * Gardner-Webb, both with a 2025-26 season — tie, and the suffix that is the
   * only thing separating them never gets consulted. Recency first, spelling
   * as the tiebreak, resolves both.
   *
   * A tie the spelling cannot break returns nothing. A wrong id grafts another
   * man's career onto the row; an unrated row is the cheaper mistake.
   */
  function resolveBart(name: string): number | null {
    const cands = byName.get(nameKey(name));
    if (!cands || cands.size === 0) return null;
    if (cands.size === 1) return [...cands.keys()][0]!;

    const newest = Math.max(...[...cands.values()].map((c) => c.year));
    const recent = [...cands.entries()].filter(([, c]) => c.year === newest);
    if (recent.length === 1) return recent[0]![0];

    const wanted = normName(name);
    const exact = recent.filter(([, c]) => c.exact.has(wanted));
    return exact.length === 1 ? exact[0]![0] : null;
  }

  const doc = JSON.parse(await fs.readFile(PORTAL, "utf8"));
  const entries: PortalEntry[] = doc.entries;
  const byKey = new Map(entries.map((e) => [nameKey(e.name), e]));

  let added = 0, fixed = 0, already = 0;
  const lines: string[] = [];

  for (const [name, destRaw, confirmedAt] of MOVES) {
    const team_to = overrideTeamName(destRaw) ?? destRaw;
    const existing = byKey.get(nameKey(name));

    if (existing) {
      const fixes: string[] = [];
      if (existing.team_to !== team_to) { existing.team_to = team_to; existing.conf_to = confFor(team_to); fixes.push(`team_to → ${team_to}`); }
      if (existing.status !== "Transferred") { existing.status = "Transferred"; fixes.push("status → Transferred"); }
      // A manual row appended to an older batch carries that batch's date, so
      // it sorts as older news than it is. Only ever correct rows this script
      // wrote — an On3 row's date is the feed's to state, not ours.
      if (existing.source === "manual" && existing.date_entered !== confirmedAt) {
        existing.date_entered = confirmedAt;
        existing.date_updated = confirmedAt;
        fixes.push(`confirmed → ${confirmedAt.slice(0, 10)}`);
      }
      if (fixes.length) { fixed++; lines.push(`~ ${name.padEnd(21)} ${fixes.join(", ")}`); }
      else { already++; lines.push(`· ${name.padEnd(21)} already correct (${existing.team_to}, rating ${existing.rating})`); }
      continue;
    }

    const bart = resolveBart(name);
    const prod: ProductionResult | null = bart !== null ? productionFor(bart, playersByBartId, yearCohortStats) : null;
    const team_from = overrideTeamName(prod?.last_team ?? null) ?? prod?.last_team ?? null;

    const entry = {
      cbba_player_id: syntheticKey(bart, name),
      bart_player_id: bart,
      name,
      eligibility: prod?.last_year != null
        ? (ELIG_FROM_CLASS[playersByBartId.get(bart!)?.[0]?.class ?? ""] ?? "—")
        : "—",
      status: "Transferred",
      division: isD1(team_from) ? 1 : null,
      division_from: isD1(team_from) ? 1 : 2,
      division_to: isD1(team_to) ? 1 : 2,
      date_entered: confirmedAt,
      date_updated: confirmedAt,
      team_from,
      conf_from: confFor(team_from),
      team_to,
      conf_to: confFor(team_to),
      last_year: prod?.last_year ?? null,
      last_team: prod?.last_team ?? null,
      last_conf: prod?.last_conf ?? null,
      gp: prod?.gp ?? null,
      mpg: prod?.mpg ?? null,
      ppg: prod?.ppg ?? null,
      rpg: prod?.rpg ?? null,
      apg: prod?.apg ?? null,
      spg: prod?.spg ?? null,
      bpg: prod?.bpg ?? null,
      pir: prod?.pir ?? null,
      bta_portg: prod?.bta_portg ?? null,
      stars: 0,
      source: "manual",          // never came from On3; see the header note
    };
    entries.push(entry);
    byKey.set(nameKey(name), entry);
    added++;
    lines.push(`+ ${name.padEnd(21)} ${String(team_from ?? "UNKNOWN").padEnd(16)} → ${team_to.padEnd(15)} ${bart ? `bart ${String(bart).padEnd(7)}` : "no bart  "}${prod ? `${prod.gp}gp ${(prod.mpg ?? 0).toFixed(1)}mpg ${(prod.ppg ?? 0).toFixed(1)}ppg pir ${(prod.pir ?? 0).toFixed(1)}` : "NO PRODUCTION — will score unrated"}`);
  }

  // ── Identity corrections ────────────────────────────────────────────
  let identified = 0;
  for (const fix of IDENTITY_FIXES) {
    const entry = entries.find((e: { cbba_player_id?: number }) => e.cbba_player_id === fix.cbba_player_id);
    if (!entry) { lines.push(`? ${fix.name.padEnd(21)} no entry ${fix.cbba_player_id} to correct`); continue; }
    if (entry.bart_player_id === fix.bart_player_id) {
      lines.push(`· ${fix.name.padEnd(21)} identity already correct (bart ${fix.bart_player_id})`);
      continue;
    }
    const prod: ProductionResult | null = productionFor(fix.bart_player_id, playersByBartId, yearCohortStats);
    entry.bart_player_id = fix.bart_player_id;
    entry.name = fix.name;
    // Everything below is a function of who he is, so all of it is redone.
    entry.last_year = prod?.last_year ?? null;
    entry.last_team = prod?.last_team ?? null;
    entry.last_conf = prod?.last_conf ?? null;
    entry.gp = prod?.gp ?? null;
    entry.mpg = prod?.mpg ?? null;
    entry.ppg = prod?.ppg ?? null;
    entry.rpg = prod?.rpg ?? null;
    entry.apg = prod?.apg ?? null;
    entry.spg = prod?.spg ?? null;
    entry.bpg = prod?.bpg ?? null;
    entry.pir = prod?.pir ?? null;
    entry.bta_portg = prod?.bta_portg ?? null;
    identified++;
    lines.push(`= ${fix.name.padEnd(21)} bart ${fix.bart_player_id} — ${fix.why}; now ${prod?.last_team ?? "?"} ${prod?.last_year ?? "?"}, ${prod?.gp ?? "?"}gp ${(prod?.mpg ?? 0).toFixed(1)}mpg ${(prod?.ppg ?? 0).toFixed(1)}ppg`);
  }

  console.log(lines.join("\n"));
  console.log(`\nadded ${added} · fixed ${fixed} · identities corrected ${identified} · already correct ${already} · entries now ${entries.length}`);

  if (DRY) { console.log("\n--dry: nothing written."); return; }
  doc.manual_entries_at = new Date().toISOString();
  await fs.writeFile(PORTAL, JSON.stringify(doc));
  console.log(`✓ rewrote ${PORTAL}`);
  console.log("→ now run: npx tsx scripts/rescore-portal.mjs");
}

main().catch((e) => { console.error(e); process.exit(1); });
