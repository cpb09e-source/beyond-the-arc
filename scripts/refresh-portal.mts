/**
 * refresh-portal.mts — rebuild public/data/portal.json from On3's PUBLIC
 * transfer-portal feed. No CBB analytics token, no Supabase: the live feed is
 * `api.on3.com/public/rdb/v2/transfers/latest` (open JSON), and production
 * stats come from name-matching each entry against the on-disk players-by-year
 * corpus (frozen). Only portal.json changes — tiny deploy, no 23k-page rebuild.
 *
 * Background: the original feed (CBB `vc-transfer-portal`) needs an
 * analytics_token that expires every ~30 days. The 25-26 portal is effectively
 * final now, so this is a one-time static refresh off a source that needs no
 * auth. Re-runnable any time the season's portal reopens.
 *
 * Run: npm run refresh:portal
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  POWER_CONFS,
  computeCohortStats,
  productionFor,
  starsForPrtg,
  volumeShooterPenalty,
  type PlayerSeason,
} from "./lib/bta-prtg.mts";
import {
  confMultiplier,
  topTeamMultiplier,
  top5Tier1Multiplier,
  top3InConfMultiplier,
} from "../src/lib/conf-tiers.ts";
import { overrideTeamName } from "../src/lib/team-overrides.ts";
import { assertUnfrozen } from "./lib/data-freeze.mjs";

// Raw-row accessors (mirror productionFor in lib/bta-prtg.mts).
function fe(r: Array<string | number | null> | null, o: number): number | null {
  if (!r || r.length <= o) return null;
  const n = Number(r[r.length - 1 - o]);
  return Number.isFinite(n) ? n : null;
}
function fsi(r: Array<string | number | null> | null, i: number): number | null {
  if (!r || r.length <= i) return null;
  const n = Number(r[i]);
  return Number.isFinite(n) ? n : null;
}
// PORTAL-ONLY defensive score. BTA PRTG is otherwise all-offense (PIR + PORPAG),
// which buries elite rim protectors like Flory Bidunga (13/9/2.6 blk) beneath
// volume scorers. This blends a per-game defensive index — blocks (weighted
// most), steals, then defensive glass — as a third z-scored term so the portal
// ranking values two-way bigs. Site-wide BTA PRTG is untouched.
const DEF_WEIGHT = 0.20;
function defScore(r: Array<string | number | null> | null): number {
  const blk = fe(r, 4) ?? 0, stl = fe(r, 5) ?? 0, reb = fe(r, 7) ?? 0;
  return blk * 1.0 + stl * 0.7 + reb * 0.25;
}
// PORTAL-ONLY conference tweaks. WAC is a one-bid low-major; the shared table
// rates it Tier 3 (×0.89), which lets pure WAC volume scorers (Dior Johnson,
// 24 ppg at Tarleton St.) rank too high. Drop it to Tier 5 (×0.77) for the
// portal only — the site-wide conf-tiers table is unchanged.
function portalConfMultiplier(conf: string | null | undefined): number {
  if (conf === "WAC") return 0.77;
  return confMultiplier(conf);
}

const OUT = path.resolve("public/data");
const YEARS = [
  2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020,
  2021, 2022, 2023, 2024, 2025, 2026,
];
// On3 sportKey 2 = men's basketball; year = recruiting/portal class year.
const ON3_URL = "https://api.on3.com/public/rdb/v2/transfers/latest?sportKey=2&year=2026&page=1&limit=5000";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function normName(s: string | null): string {
  return (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ").replace(/\s+(jr|sr|ii|iii|iv|v)$/i, "");
}
function normTeam(s: string | null): string {
  return (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "").trim();
}

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
  school: string; conference: string | null; net: number;
  in_count: number; out_count: number;
  in_players: TCPlayer[]; out_players: TCPlayer[];
};

// On3 feed shapes (only the fields we read).
type On3Asset = { name?: string | null; abbreviation?: string | null };
type On3Entry = {
  recKey?: number; psoKey?: number; personSportKey?: number;
  player?: { firstName?: string; lastName?: string; fullName?: string; classRank?: string };
  organization?: On3Asset;
  status?: {
    type?: string; date?: string;
    transferEntered?: string | null; transferWithdrawn?: string | null;
    committedAsset?: On3Asset | null; transferredAsset?: On3Asset | null;
  };
};

async function main() {
  const t0 = Date.now();
  console.log("🌀 On3 transfer-portal refresh (token-free)\n");

  // 1. playersByBartId + name index from on-disk per-year JSONs (frozen corpus).
  console.log("📥 Loading per-year player JSONs…");
  const playersByBartId = new Map<number, PlayerSeason[]>();
  // Three name indices, each: key -> bartId -> { teams (normalized), latestYear }.
  //   full  — exact normalized full name ("milan momcilovic")
  //   fl    — first + last token only, drops middle names ("papa amadou kante" → "papa kante")
  //   il    — first initial + last token ("p suder"); only used WITH a school match,
  //           so nicknames (Pete↔Peter, Mike↔Michael) resolve without false positives.
  type IdxRec = { teams: Set<string>; year: number };
  type NameIdx = Map<string, Map<number, IdxRec>>;
  const idxFull: NameIdx = new Map();
  const idxFL: NameIdx = new Map();
  const idxIL: NameIdx = new Map();
  function register(idx: NameIdx, key: string, pid: number, teamName: string | null, year: number) {
    if (!key) return;
    if (!idx.has(key)) idx.set(key, new Map());
    const byId = idx.get(key)!;
    if (!byId.has(pid)) byId.set(pid, { teams: new Set(), year: 0 });
    const rec = byId.get(pid)!;
    if (teamName) rec.teams.add(normTeam(teamName));
    if (year > rec.year) rec.year = year;
  }
  let yearsLoaded = 0;
  for (const year of YEARS) {
    const fp = path.join(OUT, "players-by-year", `${year}.json`);
    // A year we do not hold is not an error. YEARS starts at 2013 and the
    // corpus starts at 2014, so this script threw ENOENT on its first file and
    // could not be run at all — which is the likeliest reason portal.json sat
    // two months stale while the feed it reads was live the whole time.
    let text: string;
    try {
      text = await fs.readFile(fp, "utf8");
    } catch {
      console.log(`   skip ${year} — no players-by-year file`);
      continue;
    }
    yearsLoaded++;
    const players = JSON.parse(text) as Array<{
      bart_player_id: number | null; name: string; year: number; class: string | null;
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
      const nn = normName(p.name);
      if (nn) {
        const toks = nn.split(" ");
        register(idxFull, nn, pid, team?.name ?? null, p.year);
        if (toks.length >= 2) {
          register(idxFL, `${toks[0]} ${toks[toks.length - 1]}`, pid, team?.name ?? null, p.year);
          register(idxIL, `${toks[0]![0]} ${toks[toks.length - 1]}`, pid, team?.name ?? null, p.year);
        }
      }
    }
  }
  if (yearsLoaded === 0) {
    console.error("✗ no players-by-year files loaded — refusing to rebuild the portal against an empty corpus.");
    process.exit(1);
  }
  for (const seasons of playersByBartId.values()) seasons.sort((a, b) => b.year - a.year);
  console.log(`   ${playersByBartId.size.toLocaleString()} bart_player_ids · ${idxFull.size.toLocaleString()} distinct names`);

  const yearCohortStats = computeCohortStats(playersByBartId);

  // Per-year defensive-score distribution, over the SAME loose-eligible cohort
  // computeCohortStats uses (≥8 games, ≥3.5 ppg), so the def z-score lines up
  // with the PIR/PORPAG z-scores it's averaged against.
  const defByYear = new Map<number, { mean: number; sd: number }>();
  {
    const bag = new Map<number, number[]>();
    for (const seasons of playersByBartId.values()) {
      for (const s of seasons) {
        if ((s.games ?? 0) < 8 || (fe(s.raw_row, 3) ?? 0) < 3.5) continue;
        if (!bag.has(s.year)) bag.set(s.year, []);
        bag.get(s.year)!.push(defScore(s.raw_row));
      }
    }
    for (const [year, arr] of bag) {
      const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
      const sd = Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length);
      defByYear.set(year, { mean, sd });
    }
  }

  // Portal-specific BTA PRTG: same blend as productionFor (0.69·z(PIR) + z(PORPAG))
  // PLUS a defensive term (DEF_WEIGHT·z(def)), then the conf/team multipliers and
  // volume-shooter penalty. Used only for the portal — the shared lib stays as-is.
  function portalBta(bartId: number): number | null {
    const seasons = playersByBartId.get(bartId);
    if (!seasons || seasons.length === 0) return null;
    const s = seasons[0]!;
    const r = s.raw_row;
    const cs = yearCohortStats.get(s.year);
    const ds = defByYear.get(s.year);
    if (!cs) return null;
    const pts = fe(r, 3), reb = fe(r, 7), ast = fe(r, 6), stl = fe(r, 5), blk = fe(r, 4);
    const pir = (pts !== null && reb !== null && ast !== null && stl !== null && blk !== null)
      ? pts + reb + ast + stl + blk - (fsi(r, 52) ?? 0) - (fsi(r, 44) ?? 0)
      : null;
    const porpag = fsi(r, 28);
    const zs: number[] = [];
    if (typeof pir === "number" && cs.pirSd > 0) zs.push(((pir - cs.pirMean) / cs.pirSd) * 0.69);
    if (typeof porpag === "number" && cs.porSd > 0) zs.push((porpag - cs.porMean) / cs.porSd);
    if (ds && ds.sd > 0) zs.push(((defScore(r) - ds.mean) / ds.sd) * DEF_WEIGHT);
    if (zs.length === 0) return null;
    const raw = (zs.reduce((a, b) => a + b, 0) / zs.length) * 20;
    const base = raw
      * portalConfMultiplier(s.team_conference)
      * topTeamMultiplier(s.team_name)
      * top5Tier1Multiplier(s.team_name)
      * top3InConfMultiplier(s.team_name);
    return base + volumeShooterPenalty(pts, cs.effPositionPctile.get(bartId) ?? null);
  }

  // Conf lookup (latest-year Bart conference per school name). Membership in
  // this map also doubles as "is a D-I school" since the corpus is D-I only.
  const confBySchool = new Map<string, string | null>();
  {
    const latestByName = new Map<string, { year: number; conf: string | null }>();
    for (const seasons of playersByBartId.values()) {
      for (const s of seasons) {
        const cur = latestByName.get(s.team_name);
        if (!cur || s.year > cur.year) latestByName.set(s.team_name, { year: s.year, conf: s.team_conference });
      }
    }
    for (const [name, v] of latestByName.entries()) confBySchool.set(normTeam(name), v.conf);
  }
  const isD1 = (name: string | null) => !!name && confBySchool.has(normTeam(name));
  const confFor = (name: string | null) => (name ? confBySchool.get(normTeam(name)) ?? null : null);

  // Resolve a candidate set to a single bartId. With a known origin school we
  // require a school match (safe); otherwise fall back to the most-recent
  // season. `requireSchool` is set for the fuzzy initial-based index so we
  // never guess across unrelated players who happen to share a last name.
  function resolve(cands: Map<number, IdxRec> | undefined, ft: string, requireSchool: boolean): number | null {
    if (!cands || cands.size === 0) return null;
    if (ft) for (const [id, rec] of cands) if (rec.teams.has(ft)) return id;
    if (requireSchool) return null;
    if (cands.size === 1) return [...cands.keys()][0]!;
    let best: number | null = null, by = -1;
    for (const [id, rec] of cands) if (rec.year > by) { by = rec.year; best = id; }
    return best;
  }
  // Name → bart_player_id. Cascade: exact full name → first+last (drop middle
  // names) → first-initial+last gated by a school match (catches nicknames like
  // Pete↔Peter, Mike↔Michael without risking false hits).
  function matchBart(name: string, fromTeam: string | null): number | null {
    const nn = normName(name);
    if (!nn) return null;
    const ft = normTeam(fromTeam);
    const toks = nn.split(" ");
    const fl = toks.length >= 2 ? `${toks[0]} ${toks[toks.length - 1]}` : nn;
    const il = toks.length >= 2 ? `${toks[0]![0]} ${toks[toks.length - 1]}` : "";
    return resolve(idxFull.get(nn), ft, false)
      ?? resolve(idxFL.get(fl), ft, false)
      ?? (il ? resolve(idxIL.get(il), ft, true) : null);
  }

  // 2. Pull On3's public portal feed (whole season in one request).
  //
  // This was the one network-touching script without the guard, which is how
  // portal.json sat two months stale while every other feed was correctly
  // refusing to run. It is a real upstream pull and it belongs behind the same
  // deliberate override as the rest — see scripts/lib/data-freeze.mjs.
  //
  // Worth noting what it does and does not touch: the pull brings back transfer
  // EVENTS only. Every stat attached to them is name-matched against the frozen
  // players-by-year corpus, so refreshing this file cannot mix live production
  // numbers into the archive — it only updates who moved where.
  assertUnfrozen("refresh-portal.mts", "the On3 public transfer-portal feed");
  console.log("\n📡 Fetching On3 public portal feed…");
  const res = await fetch(ON3_URL, {
    headers: { "user-agent": UA, accept: "application/json", origin: "https://www.on3.com", referer: "https://www.on3.com/" },
  });
  if (!res.ok) throw new Error(`On3 HTTP ${res.status}`);
  const json = (await res.json()) as { list?: On3Entry[]; pagination?: { count?: number } };
  const rawAll = json.list ?? [];
  console.log(`   ${rawAll.length.toLocaleString()} portal rows from On3 (reported count: ${json.pagination?.count ?? "?"})`);

  // Dedup: On3's wire emits one row per portal EVENT, so a player who entered
  // then committed shows up twice. Collapse to one row per (player, origin),
  // keeping the most-advanced status (committed > active > withdrew), then the
  // most-recent event date.
  const statusRank = (t: string | undefined) => {
    switch ((t ?? "").toLowerCase()) {
      case "committed": case "enrolled": case "signed": return 3;
      case "withdrawn": case "withdrew": return 1;
      default: return 2; // entered / active
    }
  };
  const dedup = new Map<string, On3Entry>();
  for (const e of rawAll) {
    const name = e.player?.fullName ?? `${e.player?.firstName ?? ""} ${e.player?.lastName ?? ""}`.trim();
    const from = e.status?.transferredAsset?.name ?? e.organization?.name ?? null;
    const key = `${normName(name)}|${normTeam(from)}`;
    const cur = dedup.get(key);
    if (!cur) { dedup.set(key, e); continue; }
    const a = statusRank(e.status?.type), b = statusRank(cur.status?.type);
    if (a > b || (a === b && (e.status?.date ?? "") > (cur.status?.date ?? ""))) dedup.set(key, e);
  }
  const raw = [...dedup.values()];
  console.log(`   ${raw.length.toLocaleString()} after dedup (${(rawAll.length - raw.length).toLocaleString()} duplicate events collapsed)`);

  // 3. Map On3 → our PortalEntry schema.
  function mapStatus(t: string | undefined): "Transferred" | "Active" | "Withdrew" {
    switch ((t ?? "").toLowerCase()) {
      case "committed": case "enrolled": case "signed": return "Transferred";
      case "withdrawn": case "withdrew": return "Withdrew";
      default: return "Active"; // "Entered" / unknown → still in the portal
    }
  }
  const enriched = raw.map((e) => {
    const name = e.player?.fullName ?? `${e.player?.firstName ?? ""} ${e.player?.lastName ?? ""}`.trim();
    const status = mapStatus(e.status?.type);
    const fromRaw = e.status?.transferredAsset?.name ?? e.organization?.name ?? null;
    const toRaw = status === "Transferred" ? (e.status?.committedAsset?.name ?? null) : null;
    const team_from = overrideTeamName(fromRaw);
    const team_to = overrideTeamName(toRaw);
    const bartId = name ? matchBart(name, team_from) : null;
    const prod = bartId !== null ? productionFor(bartId, playersByBartId, yearCohortStats) : null;
    return {
      cbba_player_id: e.recKey ?? e.psoKey ?? e.personSportKey ?? 0,
      bart_player_id: bartId,
      name,
      eligibility: e.player?.classRank ?? "—",
      status,
      division: isD1(team_from) ? 1 : null,
      division_from: isD1(team_from) ? 1 : 2,
      division_to: team_to ? (isD1(team_to) ? 1 : 2) : null,
      date_entered: e.status?.transferEntered ?? e.status?.date ?? null,
      date_updated: e.status?.date ?? null,
      team_from,
      conf_from: confFor(team_from),
      team_to,
      conf_to: confFor(team_to),
      ...(prod ?? {
        last_year: null, last_team: null, last_conf: null,
        gp: null, mpg: null, ppg: null, rpg: null, apg: null, spg: null, bpg: null,
        pir: null, bta_portg: null,
      }),
      // Override the lib's offense-only BTA with the portal's defense-aware one.
      bta_portg: bartId !== null ? portalBta(bartId) : (prod?.bta_portg ?? null),
      stars: 0 as 0 | 1 | 2 | 3 | 4 | 5,
    };
  });

  // 3b. Committed-only. Drop players with no destination ("N/A" in the To
  // column — still in the portal — and "Withdrew" returns). They're neither a
  // completed transfer nor a real loss, so they don't belong in the table OR in
  // any school's incoming/outgoing net.
  const entries = enriched.filter((e) => e.team_to != null);

  // 4. Stars — fixed BTA PRTG cutoffs, gated by the eligibility baseline.
  const eligibleForStars = entries.filter(
    (e) => typeof e.bta_portg === "number"
      && (e.gp ?? 0) >= 10 && (e.mpg ?? 0) >= 12 && (e.ppg ?? 0) >= 4,
  );
  for (const e of eligibleForStars) e.stars = starsForPrtg(e.bta_portg as number);

  // 5. Transfer-class aggregation (mirrors export-static-data.mts).
  const perSchool = new Map<string, { school: string; conference: string | null; in_players: TCPlayer[]; out_players: TCPlayer[] }>();
  function getBucket(name: string) {
    let b = perSchool.get(name);
    if (!b) { b = { school: name, conference: confFor(name), in_players: [], out_players: [] }; perSchool.set(name, b); }
    return b;
  }
  for (const e of entries) {
    // entries are committed-only, so every row counts as OUT for its origin
    // AND IN for its destination. Uncommitted players were already dropped.
    if (!e.team_from || !e.team_to) continue;
    if (typeof e.bta_portg !== "number") continue;
    if (e.stars < 2) continue;
    const player: TCPlayer = {
      cbba_player_id: e.cbba_player_id, bart_player_id: e.bart_player_id, name: e.name,
      bta_portg: e.bta_portg, stars: e.stars, counter_team: null, counter_conf: null,
    };
    getBucket(e.team_from).out_players.push({ ...player, counter_team: e.team_to, counter_conf: e.conf_to });
    getBucket(e.team_to).in_players.push({ ...player, counter_team: e.team_from, counter_conf: e.conf_from });
  }
  function classBonus(players: TCPlayer[]): number {
    let bonus = 0;
    for (const p of players) { if (p.stars === 5) bonus += 8; else if (p.stars === 4) bonus += 5; }
    return bonus;
  }
  const allRows: TransferClassRow[] = [];
  for (const b of perSchool.values()) {
    const sumIn = b.in_players.reduce((s, p) => s + (p.bta_portg ?? 0), 0);
    const sumOut = b.out_players.reduce((s, p) => s + (p.bta_portg ?? 0), 0);
    b.in_players.sort((a, c) => (c.bta_portg ?? 0) - (a.bta_portg ?? 0));
    b.out_players.sort((a, c) => (c.bta_portg ?? 0) - (a.bta_portg ?? 0));
    allRows.push({
      school: b.school, conference: b.conference,
      net: (sumIn + classBonus(b.in_players)) - (sumOut + classBonus(b.out_players)),
      in_count: b.in_players.length, out_count: b.out_players.length,
      in_players: b.in_players, out_players: b.out_players,
    });
  }
  const top_overall = [...allRows].sort((a, c) => c.net - a.net).slice(0, 10);
  const worst_power = allRows
    .filter((r) => r.conference && POWER_CONFS.has(r.conference))
    .sort((a, c) => a.net - c.net)
    .slice(0, 10);
  const by_school: Record<string, TransferClassRow> = {};
  for (const r of allRows) by_school[r.school] = r;

  // 6. Write.
  await fs.writeFile(path.join(OUT, "portal.json"), JSON.stringify({
    competition_id: null,
    source: "on3",
    generated_at: new Date().toISOString(),
    entries,
    transfer_classes: { top_overall, worst_power, by_school },
  }));
  const matched = entries.filter((e) => e.bart_player_id !== null).length;
  const dt = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(`\n✅ portal.json refreshed — ${entries.length.toLocaleString()} committed transfers (dropped ${(enriched.length - entries.length).toLocaleString()} uncommitted/withdrew) · ${matched.toLocaleString()} matched to Bart · ${eligibleForStars.length.toLocaleString()} pass baseline · ${allRows.length} schools ranked (${dt}s)`);
}

main().catch((err) => { console.error(err); process.exit(1); });
