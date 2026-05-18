/**
 * export-portal-only.mts — fast re-aggregation of /portal data without touching
 * Supabase. Reads the per-year player JSONs + the existing portal.json already
 * on disk, then rewrites only public/data/portal.json with fresh BTA PRTG +
 * star buckets + transfer-class rankings.
 *
 * Use this when iterating on the BTA PRTG formula in scripts/lib/bta-prtg.mts
 * (or on the portal aggregation logic below). ~10 seconds vs. 7 minutes for
 * the full `npm run export:data`.
 *
 * Run: npm run export:portal
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  POWER_CONFS,
  computeCohortStats,
  productionFor,
  starsForPrtg,
  type PlayerSeason,
} from "./lib/bta-prtg.mts";
import { overrideTeamName } from "../src/lib/team-overrides.ts";

const OUT = path.resolve("public/data");
const YEARS = [
  2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020,
  2021, 2022, 2023, 2024, 2025, 2026,
];

type TCPlayer = {
  cbba_player_id: number;
  bart_player_id: number | null;
  name: string;
  bta_portg: number | null;
  stars: 0 | 1 | 2 | 3 | 4 | 5;
  counter_team: string | null;
  counter_conf: string | null;
};
type TransferClassRow = {
  school: string;
  conference: string | null;
  net: number;
  in_count: number;
  out_count: number;
  in_players: TCPlayer[];
  out_players: TCPlayer[];
};

async function main() {
  const t0 = Date.now();
  console.log("⚡ portal-only re-export\n");

  // 1. Rebuild playersByBartId from on-disk per-year JSONs.
  console.log("📥 Loading per-year player JSONs…");
  const playersByBartId = new Map<number, PlayerSeason[]>();
  for (const year of YEARS) {
    const fp = path.join(OUT, "players-by-year", `${year}.json`);
    const players = JSON.parse(await fs.readFile(fp, "utf8")) as Array<{
      bart_player_id: number | null;
      year: number;
      class: string | null;
      teams: { name?: string; conference?: string | null } | Array<{ name?: string; conference?: string | null }>;
      player_bart_stats:
        | { raw_row?: unknown; games?: number | null; notes?: string | null; projection?: number | null }
        | Array<{ raw_row?: unknown; games?: number | null; notes?: string | null; projection?: number | null }>;
    }>;
    for (const p of players) {
      const pid = p.bart_player_id;
      if (!pid) continue;
      const team = Array.isArray(p.teams) ? p.teams[0] : p.teams;
      const stats = Array.isArray(p.player_bart_stats) ? p.player_bart_stats[0] : p.player_bart_stats;
      if (!playersByBartId.has(pid)) playersByBartId.set(pid, []);
      playersByBartId.get(pid)!.push({
        year: p.year,
        team_name: team?.name ?? "—",
        team_conference: team?.conference ?? null,
        class: p.class,
        raw_row: stats?.raw_row ?? null,
        games: stats?.games ?? null,
        notes: stats?.notes ?? null,
        projection: stats?.projection ?? null,
      });
    }
  }
  // Newest year first — productionFor() picks seasons[0] as latest.
  for (const seasons of playersByBartId.values()) seasons.sort((a, b) => b.year - a.year);
  console.log(`   ${playersByBartId.size.toLocaleString()} bart_player_ids · ${YEARS.length} years`);

  // 2. Cohort stats from the same playersByBartId.
  const yearCohortStats = computeCohortStats(playersByBartId);
  console.log(`   cohort stats for ${yearCohortStats.size} years`);

  // 3. Load existing portal.json — keeps the raw CBB metadata (status, teams,
  // dates, etc.); we only recompute the production block + stars + buckets.
  console.log("\n🌀 Loading existing portal.json…");
  const portalPath = path.join(OUT, "portal.json");
  type PortalEntry = {
    cbba_player_id: number;
    bart_player_id: number | null;
    name: string;
    eligibility: string;
    status: string;
    division: number | null;
    division_from: number | null;
    division_to: number | null;
    date_entered: string | null;
    date_updated: string | null;
    team_from: string | null;
    conf_from: string | null;
    team_to: string | null;
    conf_to: string | null;
    last_year: number | null;
    last_team: string | null;
    last_conf: string | null;
    gp: number | null;
    mpg: number | null;
    ppg: number | null;
    rpg: number | null;
    apg: number | null;
    spg: number | null;
    bpg: number | null;
    pir: number | null;
    bta_portg: number | null;
    stars: 0 | 1 | 2 | 3 | 4 | 5;
  };
  const portal = JSON.parse(await fs.readFile(portalPath, "utf8")) as {
    competition_id: number | null;
    generated_at: string;
    entries: PortalEntry[];
    transfer_classes: unknown;
  };
  console.log(`   ${portal.entries.length.toLocaleString()} entries`);

  // 4. Re-derive production stats per entry. Also normalize team_from / team_to
  // against TEAM_NAME_OVERRIDES so the buckets below key on the displayed name
  // (existing portal.json may still have raw CBB names like "Southern California"
  // that pre-date the override).
  const enriched: PortalEntry[] = portal.entries.map((e) => {
    const prod = e.bart_player_id !== null
      ? productionFor(e.bart_player_id, playersByBartId, yearCohortStats)
      : null;
    return {
      ...e,
      team_from: overrideTeamName(e.team_from),
      team_to: overrideTeamName(e.team_to),
      ...(prod ?? {
        last_year: null, last_team: null, last_conf: null,
        gp: null, mpg: null, ppg: null, rpg: null, apg: null, spg: null, bpg: null,
        pir: null, bta_portg: null,
      }),
      stars: 0 as 0 | 1 | 2 | 3 | 4 | 5,
    };
  });

  // 5. Stars: fixed BTA PRTG cutoffs (see starsForPrtg in lib/bta-prtg.mts).
  // Eligibility baseline (GP ≥ 10, MPG ≥ 12, PPG ≥ 4) still gates who can be
  // bucketed — below-baseline players stay at 0 stars regardless of PRTG.
  const eligibleForStars = enriched.filter(
    (e) => typeof e.bta_portg === "number"
      && (e.gp ?? 0) >= 10
      && (e.mpg ?? 0) >= 12
      && (e.ppg ?? 0) >= 4,
  );
  for (const e of eligibleForStars) e.stars = starsForPrtg(e.bta_portg as number);

  // 6. Conference lookup from the in-memory playersByBartId (latest year wins).
  function tcNorm(s: string) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "").trim(); }
  const confBySchool = new Map<string, string | null>();
  {
    const latestByName = new Map<string, { year: number; conf: string | null }>();
    for (const seasons of playersByBartId.values()) {
      for (const s of seasons) {
        const cur = latestByName.get(s.team_name);
        if (!cur || s.year > cur.year) latestByName.set(s.team_name, { year: s.year, conf: s.team_conference });
      }
    }
    for (const [name, v] of latestByName.entries()) confBySchool.set(tcNorm(name), v.conf);
  }
  function confFor(name: string | null) {
    if (!name) return null;
    return confBySchool.get(tcNorm(name)) ?? null;
  }

  // 7. Transfer-class aggregation. Must match the rules in
  // scripts/export-static-data.mts — keep these two loops in sync.
  const perSchool = new Map<string, { school: string; conference: string | null; in_players: TCPlayer[]; out_players: TCPlayer[] }>();
  function getBucket(name: string) {
    let b = perSchool.get(name);
    if (!b) { b = { school: name, conference: confFor(name), in_players: [], out_players: [] }; perSchool.set(name, b); }
    return b;
  }
  for (const e of enriched) {
    if (!e.team_from) continue;
    if (typeof e.bta_portg !== "number") continue;
    if (e.stars < 2) continue;
    const isCommitted = e.team_to !== null;
    const isActive = e.status === "Active";
    if (!isCommitted && !isActive) continue;
    const player: TCPlayer = {
      cbba_player_id: e.cbba_player_id,
      bart_player_id: e.bart_player_id,
      name: e.name,
      bta_portg: e.bta_portg,
      stars: e.stars,
      counter_team: null,
      counter_conf: null,
    };
    getBucket(e.team_from).out_players.push({ ...player, counter_team: e.team_to, counter_conf: e.conf_to });
    if (isCommitted) {
      getBucket(e.team_to!).in_players.push({ ...player, counter_team: e.team_from, counter_conf: e.conf_from });
    }
  }
  // Flat star bonuses applied symmetrically: +8 per 5★ and +5 per 4★. Mirror
  // of the same logic in export-static-data.mts — keep these in sync.
  function classBonus(players: TCPlayer[]): number {
    let bonus = 0;
    for (const p of players) {
      if (p.stars === 5) bonus += 8;
      else if (p.stars === 4) bonus += 5;
    }
    return bonus;
  }
  const allRows: TransferClassRow[] = [];
  for (const b of perSchool.values()) {
    const sumIn = b.in_players.reduce((s, p) => s + (p.bta_portg ?? 0), 0);
    const sumOut = b.out_players.reduce((s, p) => s + (p.bta_portg ?? 0), 0);
    const inBonus = classBonus(b.in_players);
    const outBonus = classBonus(b.out_players);
    b.in_players.sort((a, c) => (c.bta_portg ?? 0) - (a.bta_portg ?? 0));
    b.out_players.sort((a, c) => (c.bta_portg ?? 0) - (a.bta_portg ?? 0));
    allRows.push({
      school: b.school,
      conference: b.conference,
      net: (sumIn + inBonus) - (sumOut + outBonus),
      in_count: b.in_players.length,
      out_count: b.out_players.length,
      in_players: b.in_players,
      out_players: b.out_players,
    });
  }
  const top_overall = [...allRows].sort((a, c) => c.net - a.net).slice(0, 10);
  const worst_power = allRows
    .filter((r) => r.conference && POWER_CONFS.has(r.conference))
    .sort((a, c) => a.net - c.net)
    .slice(0, 10);
  // Keyed lookup so the portal table can open the same transfer-class modal
  // for any school logo (not just the 20 in top/worst sidebars).
  const by_school: Record<string, TransferClassRow> = {};
  for (const r of allRows) by_school[r.school] = r;

  // 8. Write.
  await fs.writeFile(portalPath, JSON.stringify({
    competition_id: portal.competition_id,
    generated_at: new Date().toISOString(),
    entries: enriched,
    transfer_classes: { top_overall, worst_power, by_school },
  }));
  const dt = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(`\n✅ portal.json rewritten (${enriched.length.toLocaleString()} entries, ${perSchool.size.toLocaleString()} schools) in ${dt}s`);
}

main().catch((err) => { console.error(err); process.exit(1); });
