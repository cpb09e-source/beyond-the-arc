/**
 * export-static-data.mts — pre-builds every JSON file the site needs at runtime
 * so we can drop Supabase entirely from production. Run before `next build`.
 *
 * Output:
 *   public/data/teams-all.json              — flat array of all team-season rows
 *                                              with stats + cbb (drives /, team explorer)
 *   public/data/players-by-year/<year>.json — players for a single season
 *                                              (drives /players client filter)
 *   public/data/team/<slug>.json            — per-team multi-season + roster
 *   public/data/player/<bartId>.json        — per-player multi-season
 *   public/data/conferences.json            — distinct conferences per year
 *   public/data/index.json                  — slug/id manifests for SSG
 *
 * Run: npm run export:data
 */

import fs from "node:fs/promises";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import {
  POWER_CONFS,
  computeCohortStats,
  productionFor as productionForShared,
  type PlayerSeason,
} from "./lib/bta-prtg.mts";

loadEnv({ path: ".env.local" });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!URL || !SR) {
  console.error("Missing Supabase env vars");
  process.exit(1);
}
const sb = createClient(URL, SR, { auth: { persistSession: false } });

const OUT = path.resolve("public/data");

// Display-name overrides. We KEEP Bart's canonical name in the DB (and in
// cbb-team-ids.json keys) so sync scripts continue to match, but rewrite the
// name as it goes into every JSON file the site reads. Side effect: the URL
// slug derives from the override (so /teams/usc/ instead of /teams/southern-california/).
const TEAM_NAME_OVERRIDES: Record<string, string> = {
  "Southern California": "USC",
};
function overrideTeamName<T extends string | null | undefined>(n: T): T {
  if (typeof n !== "string") return n;
  return (TEAM_NAME_OVERRIDES[n] ?? n) as T;
}
const YEARS = [
  2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020,
  2021, 2022, 2023, 2024, 2025, 2026,
];


function slug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

// ---------- queries ----------
async function fetchAllTeamSeasons() {
  // Paginate all team-seasons joined to trank + cbba stats.
  const all: unknown[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from("teams")
      .select(
        `
        id, name, conference, year,
        team_trank_stats!inner (
          rank, record, wins, losses, adjoe, adjde, adjt, wab, sos, ncsos, consos
        ),
        team_cbba_stats (
          efg_pct, ts_pct, tov_pct, orb_pct, fta_rate,
          fg3_pct, fg3a_rate, ast_pct,
          efg_pct_def, tov_pct_def, orb_pct_def, fg3_pct_def,
          ortg, drtg, net_rtg, ortg_adj, drtg_adj, net_rtg_adj,
          pace, pace_adj, fbpts_pct, pitp_pct,
          fg3_made, fg3_attempts, fg3_made_def, fg3_attempts_def,
          fg3_made_diff, fg3_att_diff, fg2_made_diff, fg2_att_diff,
          fg_made_diff, ft_made_diff, ft_att_diff,
          reb_diff, orb_diff_ct, drb_diff, tov_diff_ct,
          fbpts_diff, pitp_diff, pts_diff, scp_diff, potov_diff
        )
        `
      )
      .range(from, from + 999);
    if (error) throw new Error(`teams: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return all;
}

async function fetchGameLogsForYear(year: number) {
  // Paginate game_logs for a year, joining team name + conference so the
  // /calc page can render rows without an extra lookup.
  const all: unknown[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from("game_logs")
      .select(
        `
        cbba_game_id, year, game_date, team_id, opp_team_market,
        is_home, is_neutral, won, pts_scored, pts_against, pts_diff,
        poss, pace,
        fg3_made_diff, fg3_att_diff, fg2_made_diff, fg_made_diff,
        ft_made_diff, reb_diff, orb_diff, drb_diff, tov_diff,
        ast_diff, stl_diff, blk_diff, fbpts_diff, pitp_diff, scp_diff,
        fg3_pct, fg2_pct, ft_pct, efg_pct, ts_pct,
        fg3_pct_def, efg_pct_def,
        teams!team_id!inner ( name, conference )
        `
      )
      .eq("year", year)
      .range(from, from + 999);
    if (error) throw new Error(`game_logs ${year}: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return all;
}

async function fetchAllPlayers(year: number) {
  const all: unknown[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from("players")
      .select(
        `
        id, bart_player_id, name, year, class, height, hometown,
        teams!inner ( id, name, conference ),
        player_bart_stats!inner ( raw_row, games, notes, projection )
        `
      )
      .eq("year", year)
      .range(from, from + 999);
    if (error) throw new Error(`players ${year}: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return all;
}

// ---------- main ----------
async function main() {
  await ensureDir(OUT);
  await ensureDir(path.join(OUT, "team"));
  await ensureDir(path.join(OUT, "player"));
  await ensureDir(path.join(OUT, "players-by-year"));
  await ensureDir(path.join(OUT, "player-games"));

  const t0 = Date.now();

  console.log("📦 Exporting team-seasons…");
  const teams = await fetchAllTeamSeasons() as Array<{
    id: number;
    name: string;
    conference: string | null;
    year: number;
    team_trank_stats: unknown;
    team_cbba_stats: unknown;
    bta_rtg?: number | null;
  }>;
  // Apply display-name overrides up front so byName / slugs / search index all
  // see the new name. Database stays untouched.
  for (const t of teams) t.name = overrideTeamName(t.name);
  console.log(`   ${teams.length} team-season rows`);

  // Pre-compute BTA RTG (weighted z-composite ×40) per team-season, using
  // each season's own cohort as the z reference. Same formula as the explorer.
  attachBtaRtgToExport(teams);
  // Per-season national rank for ~22 stats, then top-5 + bottom-5 per team.
  // Powers the "Where they rank best / worst" hero block.
  attachNationalRanksToExport(teams);

  // Group seasons by team name — used both for per-team JSONs (written below
  // AFTER we have the four-factor record) and for the slug manifest.
  const byName = new Map<string, typeof teams>();
  for (const t of teams) {
    const k = t.name;
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k)!.push(t);
  }

  console.log("\n🏀 Exporting game logs (per year)…");
  await ensureDir(path.join(OUT, "game-logs-by-year"));
  let totalLogs = 0;
  // (team_id, year) → games where REB Diff + FBP Diff + 3PM Diff are all > 0.
  // Powers the "When all three positive" badge on the team page Four Factors card.
  type FFRecord = { wins: number; losses: number; games: number };
  const fourFactorByTeamYear = new Map<string, FFRecord>();
  for (const year of YEARS) {
    const logs = await fetchGameLogsForYear(year) as Array<{
      team_id: number;
      teams: { name?: string; conference?: string | null } | Array<{ name?: string; conference?: string | null }>;
      reb_diff?: number | null;
      fbpts_diff?: number | null;
      fg3_made_diff?: number | null;
      won?: boolean;
    }>;
    // Aggregate the four-factor record per team for this season.
    const perTeam = new Map<number, FFRecord>();
    for (const l of logs) {
      const reb = l.reb_diff ?? null;
      const fbp = l.fbpts_diff ?? null;
      const tp = l.fg3_made_diff ?? null;
      if (reb === null || fbp === null || tp === null) continue;
      if (!(reb > 0 && fbp > 0 && tp > 0)) continue;
      const rec = perTeam.get(l.team_id) ?? { wins: 0, losses: 0, games: 0 };
      rec.games += 1;
      if (l.won) rec.wins += 1; else rec.losses += 1;
      perTeam.set(l.team_id, rec);
    }
    for (const [tid, rec] of perTeam.entries()) {
      fourFactorByTeamYear.set(`${tid}|${year}`, rec);
    }

    // Flatten team join → top-level team_name / team_conference so the client
    // doesn't have to walk the nested array.
    const flat = logs.map((l) => {
      const t = Array.isArray(l.teams) ? l.teams[0] : l.teams;
      const { teams: _drop, ...rest } = l;
      void _drop;
      return { ...rest, team_name: overrideTeamName(t?.name ?? "—"), team_conference: t?.conference ?? null };
    });
    await fs.writeFile(path.join(OUT, "game-logs-by-year", `${year}.json`), JSON.stringify(flat));
    console.log(`   ${year}: ${flat.length} game-perspective rows, ${perTeam.size} teams with 4F-record`);
    totalLogs += flat.length;
  }
  console.log(`   total: ${totalLogs} game logs`);

  // Attach four-factor record to each team-season row, then write the team
  // JSONs (waited until now so the record is included in the per-team payload).
  for (const t of teams as Array<typeof teams[number] & { four_factor_record?: FFRecord | null }>) {
    t.four_factor_record = fourFactorByTeamYear.get(`${t.id}|${t.year}`) ?? null;
  }
  await fs.writeFile(path.join(OUT, "teams-all.json"), JSON.stringify(teams));
  let teamSlugCount = 0;
  for (const [name, rows] of byName.entries()) {
    rows.sort((a, b) => b.year - a.year);
    const s = slug(name);
    await fs.writeFile(path.join(OUT, "team", `${s}.json`), JSON.stringify({ name, seasons: rows }));
    teamSlugCount++;
  }
  console.log(`   ${teamSlugCount} per-team JSON files written (with four-factor record)`);

  console.log("\n👥 Exporting players (per year)…");
  let totalPlayers = 0;
  const playersByBartId = new Map<number, Array<{ year: number; team_name: string; team_conference: string | null; class: string | null; raw_row: unknown; games: number | null; notes: string | null; projection: number | null }>>();
  for (const year of YEARS) {
    const players = await fetchAllPlayers(year) as Array<{
      bart_player_id: number | null;
      year: number;
      class: string | null;
      teams: { id?: number; name?: string; conference?: string | null } | { id?: number; name?: string; conference?: string | null }[];
      player_bart_stats: { raw_row?: unknown; games?: number | null; notes?: string | null; projection?: number | null } | Array<{ raw_row?: unknown; games?: number | null; notes?: string | null; projection?: number | null }>;
    }>;
    // Apply team-name overrides on the joined teams (the row's team display name).
    for (const p of players) {
      if (Array.isArray(p.teams)) {
        for (const tt of p.teams) if (tt?.name) tt.name = overrideTeamName(tt.name);
      } else if (p.teams?.name) {
        p.teams.name = overrideTeamName(p.teams.name);
      }
    }
    console.log(`   ${year}: ${players.length}`);
    await fs.writeFile(path.join(OUT, "players-by-year", `${year}.json`), JSON.stringify(players));
    totalPlayers += players.length;
    // Accumulate for per-player files
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
  console.log(`   total: ${totalPlayers} player-season rows`);

  // Per-year cohort PIR/PORPAG mean+sd over the eligible D-I pool — used by
  // productionFor() to z-score and average. Formula lives in scripts/lib/bta-prtg.mts.
  const yearCohortStats = computeCohortStats(playersByBartId as Map<number, PlayerSeason[]>);

  console.log("\n🧑 Per-player JSON files…");
  let playerFileCount = 0;
  for (const [bartId, seasons] of playersByBartId.entries()) {
    seasons.sort((a, b) => b.year - a.year);
    await fs.writeFile(path.join(OUT, "player", `${bartId}.json`), JSON.stringify({ bart_player_id: bartId, seasons }));
    playerFileCount++;
  }
  console.log(`   ${playerFileCount} per-player JSON files`);

  // Per-player game-log files. One JSON per Bart player, all years concatenated,
  // sorted newest game first. Fed by the "Career → click season" modal on the
  // player profile (filters client-side by year).
  console.log("\n🎯 Per-player game logs…");
  type PgsRow = {
    id: number;
    bart_player_id: number | null;
    year: number;
    game_date: string | null;
    cbba_game_id: number;
    opp_team_market: string | null;
    is_home: boolean | null;
    is_neutral: boolean | null;
    won: boolean | null;
    is_starter: boolean | null;
    mins: number | null;
    pts_scored: number | null;
    fgm: number | null; fga: number | null;
    fgm3: number | null; fga3: number | null;
    ftm: number | null; fta: number | null;
    reb: number | null; orb: number | null; drb: number | null;
    ast: number | null; stl: number | null; blk: number | null;
    tov: number | null; pf: number | null;
    plus_minus: number | null;
    fg_pct: number | null; fg3_pct: number | null;
    ft_pct: number | null; efg_pct: number | null;
    ts_pct: number | null; usage_pct: number | null;
  };
  const gamesByPlayer = new Map<number, PgsRow[]>();
  let lastId = 0;
  let pgsTotal = 0;
  // Keyset pagination on `id`. OFFSET pagination timed out at ~1.5M rows
  // because Postgres has to skip every prior row each page. With keyset we
  // ride the primary-key index and each page is O(1) regardless of position.
  while (true) {
    const { data, error } = await sb
      .from("player_game_stats")
      .select("id, bart_player_id, year, game_date, cbba_game_id, opp_team_market, is_home, is_neutral, won, is_starter, mins, pts_scored, fgm, fga, fgm3, fga3, ftm, fta, reb, orb, drb, ast, stl, blk, tov, pf, plus_minus, fg_pct, fg3_pct, ft_pct, efg_pct, ts_pct, usage_pct")
      .not("bart_player_id", "is", null)
      .gt("id", lastId)
      .order("id", { ascending: true })
      .limit(1000);
    if (error) throw new Error(`player_game_stats: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as PgsRow[]) {
      const pid = r.bart_player_id;
      if (pid === null) continue;
      if (!gamesByPlayer.has(pid)) gamesByPlayer.set(pid, []);
      gamesByPlayer.get(pid)!.push(r);
    }
    pgsTotal += data.length;
    lastId = data[data.length - 1]!.id;
    if (data.length < 1000) break;
  }
  console.log(`   ${pgsTotal.toLocaleString()} matched game-player rows`);
  let pgFileCount = 0;
  for (const [bartId, games] of gamesByPlayer.entries()) {
    games.sort((a, b) => (b.game_date ?? "").localeCompare(a.game_date ?? ""));
    // Drop bart_player_id + id from each row — redundant for the JSON output.
    const slim = games.map(({ bart_player_id: _b, id: _i, ...rest }) => { void _b; void _i; return rest; });
    await fs.writeFile(
      path.join(OUT, "player-games", `${bartId}.json`),
      JSON.stringify({ bart_player_id: bartId, games: slim }),
    );
    pgFileCount++;
  }
  console.log(`   ${pgFileCount} per-player game-log JSON files`);

  // ---------- Transfer portal ----------
  // Pull current-competition portal entries from CBB and enrich each with the
  // player's most-recent Bart season (PPG/RPG/APG/PIR/etc.) so the UI can
  // sort by production. Powers /portal.
  console.log("\n🌀 Transfer portal…");
  try {
    const CURRENT_COMP_ID = 41097; // 2025-26 MALE D-I
    const fs_node = await import("node:fs");
    const os_node = await import("node:os");
    const path_node = await import("node:path");
    const cfgPath = path_node.join(os_node.homedir(), ".config", "cbb-analytics-pp-cli", "config.toml");
    const tokenMatch = fs_node.readFileSync(cfgPath, "utf8").match(/^analytics_token\s*=\s*['"]([^'"]+)['"]/m);
    const TOKEN = tokenMatch?.[1];
    if (!TOKEN) throw new Error("CBB token missing");

    const res = await fetch(
      `https://api.cbbanalytics.com/api/gs/vc-transfer-portal?competitionId=${CURRENT_COMP_ID}`,
      { headers: { "x-auth-token": TOKEN, origin: "https://cbbanalytics.com", accept: "application/json" } },
    );
    if (!res.ok) throw new Error(`portal HTTP ${res.status}`);
    type PortalRaw = {
      playerId: number; firstName?: string; lastName?: string;
      status?: string; eligibilityYear?: string;
      divisionId?: number; divisionIdFrom?: number; divisionIdTo?: number | null;
      createdWhen?: string; updatedWhen?: string;
      teamIdFrom?: number | null; teamMarketFrom?: string | null; conferenceShortNameFrom?: string | null;
      teamIdTo?: number | null;   teamMarketTo?: string | null;   conferenceShortNameTo?: string | null;
    };
    const raw = (await res.json()) as PortalRaw[];
    console.log(`   ${raw.length.toLocaleString()} portal rows from CBB`);

    // cbba_player_id → bart_player_id (built from player_game_stats matches)
    const bartByCbba = new Map<number, number>();
    let mf = 0;
    while (true) {
      const { data } = await sb
        .from("player_game_stats")
        .select("cbba_player_id, bart_player_id")
        .not("bart_player_id", "is", null)
        .order("id", { ascending: true })
        .range(mf, mf + 999);
      if (!data || data.length === 0) break;
      for (const r of data as { cbba_player_id: number; bart_player_id: number }[]) {
        if (!bartByCbba.has(r.cbba_player_id)) bartByCbba.set(r.cbba_player_id, r.bart_player_id);
      }
      if (data.length < 1000) break;
      mf += 1000;
    }
    console.log(`   cbba→bart map: ${bartByCbba.size.toLocaleString()} entries`);

    // productionFor + cohort math live in scripts/lib/bta-prtg.mts so both the
    // full export and the fast portal-only export apply the same formula.
    const productionFor = (bartId: number) =>
      productionForShared(bartId, playersByBartId as Map<number, PlayerSeason[]>, yearCohortStats);
    function eligPretty(e: string | undefined): string {
      if (!e) return "—";
      return e.replace(/^COLLEGE_/, "").replace(/_/g, " ").toLowerCase()
        .replace(/\b\w/g, (c) => c.toUpperCase());
    }

    const enriched = raw.map((p) => {
      const bartId = bartByCbba.get(p.playerId) ?? null;
      const prod = bartId !== null ? productionFor(bartId) : null;
      return {
        cbba_player_id: p.playerId,
        bart_player_id: bartId,
        name: `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim(),
        eligibility: eligPretty(p.eligibilityYear),
        status: p.status ?? "Unknown",
        division: p.divisionId ?? null,
        division_from: p.divisionIdFrom ?? null,
        division_to: p.divisionIdTo ?? null,
        date_entered: p.createdWhen ?? null,
        date_updated: p.updatedWhen ?? null,
        team_from: p.teamMarketFrom ?? null,
        conf_from: p.conferenceShortNameFrom ?? null,
        team_to: p.teamMarketTo ?? null,
        conf_to: p.conferenceShortNameTo ?? null,
        ...(prod ?? {
          last_year: null, last_team: null, last_conf: null,
          gp: null, mpg: null, ppg: null, rpg: null, apg: null, spg: null, bpg: null,
          pir: null, bta_portg: null,
        }),
        stars: 0 as 0 | 1 | 2 | 3 | 4 | 5,
      };
    });

    // Star buckets: percentile-rank BTA PORTG within the portal pool that
    // passes the display baseline (GP ≥ 10, MPG ≥ 12, PPG ≥ 4) AND has a
    // computed bta_portg. 5★ = top 20%, 4★ = next 20%, etc.
    const eligibleForStars = enriched.filter(
      (e) => typeof e.bta_portg === "number"
        && (e.gp ?? 0) >= 10
        && (e.mpg ?? 0) >= 12
        && (e.ppg ?? 0) >= 4
    );
    eligibleForStars.sort((a, b) => (b.bta_portg as number) - (a.bta_portg as number));
    const n = eligibleForStars.length;
    eligibleForStars.forEach((e, i) => {
      const pct = i / Math.max(1, n - 1); // 0 = best, 1 = worst
      const stars = pct < 0.2 ? 5 : pct < 0.4 ? 4 : pct < 0.6 ? 3 : pct < 0.8 ? 2 : 1;
      e.stars = stars as 1 | 2 | 3 | 4 | 5;
    });

    // Transfer-class rankings. Score each school by Net BTA PORTG:
    //   (sum of BTA PORTG of players who committed TO the school)
    //   − (sum of BTA PORTG of players who committed AWAY from the school).
    // Only Committed moves with both endpoints populated and a non-null
    // bta_portg count — that naturally drops graduating / withdrawn entries.
    type TCPlayer = {
      cbba_player_id: number;
      bart_player_id: number | null;
      name: string;
      bta_portg: number | null;
      stars: 0 | 1 | 2 | 3 | 4 | 5;
      counter_team: string | null;     // OUT: where they went · IN: where from
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
    // school name (normalized) → latest-year Bart conference
    function tcNorm(s: string) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "").trim(); }
    const confBySchool = new Map<string, string | null>();
    {
      const latestByName = new Map<string, { year: number; conf: string | null; name: string }>();
      for (const t of teams) {
        const cur = latestByName.get(t.name);
        if (!cur || t.year > cur.year) latestByName.set(t.name, { year: t.year, conf: t.conference, name: t.name });
      }
      for (const v of latestByName.values()) confBySchool.set(tcNorm(v.name), v.conf);
    }
    function confFor(name: string | null): string | null {
      if (!name) return null;
      return confBySchool.get(tcNorm(name)) ?? null;
    }

    // Aggregate commits per school.
    const perSchool = new Map<string, {
      school: string;
      conference: string | null;
      in_players: TCPlayer[];
      out_players: TCPlayer[];
    }>();
    function getBucket(name: string) {
      let b = perSchool.get(name);
      if (!b) {
        b = { school: name, conference: confFor(name), in_players: [], out_players: [] };
        perSchool.set(name, b);
      }
      return b;
    }
    for (const e of enriched) {
      // CBB's `status` field uses "Transferred" (committed elsewhere) / "Active"
      // (in portal, undecided) / "Withdrew" (returned to original team). For
      // transfer-class scoring:
      //   - Transferred → counts as OUT for old school AND IN for new school
      //   - Active (uncommitted) → counts as OUT only (school has lost them
      //     from the roster as of now; they're sitting in the portal)
      //   - Withdrew → skip (they came back, no net movement)
      if (!e.team_from) continue;
      if (typeof e.bta_portg !== "number") continue;
      // Skip 0/1-star moves: they shouldn't move the needle on a school's
      // transfer-class ranking (think walk-ons, end-of-bench depth pieces).
      if (e.stars < 2) continue;
      const isCommitted = e.team_to !== null;
      const isActive = e.status === "Active";
      if (!isCommitted && !isActive) continue; // Withdrew or unknown — skip
      const player: TCPlayer = {
        cbba_player_id: e.cbba_player_id,
        bart_player_id: e.bart_player_id,
        name: e.name,
        bta_portg: e.bta_portg,
        stars: e.stars,
        counter_team: null,
        counter_conf: null,
      };
      // OUT from e.team_from. Counterpart = destination (or null if still in portal).
      const outBucket = getBucket(e.team_from);
      outBucket.out_players.push({ ...player, counter_team: e.team_to, counter_conf: e.conf_to });
      // IN to e.team_to only if they've committed somewhere.
      if (isCommitted) {
        const inBucket = getBucket(e.team_to!);
        inBucket.in_players.push({ ...player, counter_team: e.team_from, counter_conf: e.conf_from });
      }
    }
    const allRows: TransferClassRow[] = [];
    for (const b of perSchool.values()) {
      const sumIn = b.in_players.reduce((s, p) => s + (p.bta_portg ?? 0), 0);
      const sumOut = b.out_players.reduce((s, p) => s + (p.bta_portg ?? 0), 0);
      // Sort each list by BTA PORTG desc for popup display.
      b.in_players.sort((a, c) => (c.bta_portg ?? 0) - (a.bta_portg ?? 0));
      b.out_players.sort((a, c) => (c.bta_portg ?? 0) - (a.bta_portg ?? 0));
      allRows.push({
        school: b.school,
        conference: b.conference,
        net: sumIn - sumOut,
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

    await fs.writeFile(path.join(OUT, "portal.json"), JSON.stringify({
      competition_id: CURRENT_COMP_ID,
      generated_at: new Date().toISOString(),
      entries: enriched,
      transfer_classes: { top_overall, worst_power },
    }));
    const matched = enriched.filter((e) => e.bart_player_id !== null).length;
    console.log(`   ${enriched.length.toLocaleString()} portal entries · ${matched.toLocaleString()} matched to Bart · ${eligibleForStars.length.toLocaleString()} pass baseline · ${allRows.length} schools ranked`);
  } catch (e) {
    console.log(`   ⚠ portal export failed: ${(e as Error).message} — /portal will show empty state`);
  }

  console.log("\n🏷  Conferences per year…");
  const confsByYear: Record<number, string[]> = {};
  for (const year of YEARS) {
    const confs = new Set<string>();
    for (const t of teams) if (t.year === year && t.conference) confs.add(t.conference);
    confsByYear[year] = [...confs].sort();
  }
  await fs.writeFile(path.join(OUT, "conferences.json"), JSON.stringify(confsByYear));

  // Search index — slim entries the navbar ⌘K dialog loads lazily.
  // Mirrors scripts/build-search-index.mjs (standalone one-off variant).
  console.log("\n🔎 Search index…");
  const searchTeamByName = new Map<string, { name: string; year: number; conf: string | null }>();
  for (const t of teams) {
    const cur = searchTeamByName.get(t.name);
    if (!cur || t.year > cur.year) searchTeamByName.set(t.name, { name: t.name, year: t.year, conf: t.conference });
  }
  const searchTeams = [...searchTeamByName.values()]
    .map((t) => ({ t: "t" as const, n: t.name, s: slug(t.name), c: t.conference ?? null }))
    .sort((a, b) => a.n.localeCompare(b.n));
  const latestByBart = new Map<number, { name: string; year: number; team: string; bartId: number }>();
  for (const [bartId, seasons] of playersByBartId.entries()) {
    // seasons already sorted newest-first earlier in the per-player loop
    const latest = seasons[0]!;
    latestByBart.set(bartId, { name: "", year: latest.year, team: latest.team_name, bartId });
  }
  // Need name — wasn't captured in seasons. Pull from the latest year's players file.
  // Cheaper: read the per-player JSON we just wrote.
  for (const bartId of latestByBart.keys()) {
    try {
      const obj = JSON.parse(await fs.readFile(path.join(OUT, "player", `${bartId}.json`), "utf8"));
      const row = obj.seasons?.[0]?.raw_row;
      if (Array.isArray(row) && typeof row[0] === "string") {
        const e = latestByBart.get(bartId)!;
        e.name = row[0];
      }
    } catch {}
  }
  const searchPlayers = [...latestByBart.values()]
    .filter((p) => p.name)
    .map((p) => ({ t: "p" as const, n: p.name, b: p.bartId, tm: p.team, y: p.year }))
    .sort((a, b) => a.n.localeCompare(b.n));
  const searchAll = [...searchTeams, ...searchPlayers];
  await fs.writeFile(path.join(OUT, "search-index.json"), JSON.stringify(searchAll));
  console.log(`   ${searchTeams.length} teams + ${searchPlayers.length.toLocaleString()} players → search-index.json`);

  console.log("\n📜 SSG manifest…");
  const teamSlugs = [...byName.keys()].map((n) => slug(n));
  const playerIds = [...playersByBartId.keys()];
  await fs.writeFile(
    path.join(OUT, "index.json"),
    JSON.stringify({
      teamSlugs,
      playerIds,
      generated_at: new Date().toISOString(),
    })
  );

  const seconds = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n${"═".repeat(60)}`);
  console.log(`Done in ${seconds}s.`);
  console.log(`  Routes to pre-render at build time:`);
  console.log(`    /teams/<slug>     × ${teamSlugs.length}`);
  console.log(`    /players/<id>     × ${playerIds.length}`);
}

// ---------- bta_rtg pre-computation (mirrors src/lib/team-filters.ts) -----
type Row = {
  id: number;
  year: number;
  team_trank_stats: unknown;
  team_cbba_stats: unknown;
  bta_rtg?: number | null;
  bta_rank?: number | null;
  national_ranks?: {
    top: Array<{ key: string; label: string; format: "num1" | "num2" | "pct1" | "intDiff"; value: number; rank: number; total: number }>;
    bottom: Array<{ key: string; label: string; format: "num1" | "num2" | "pct1" | "intDiff"; value: number; rank: number; total: number }>;
  };
};
// ---------- national ranks (top-5 strengths, bottom-5 weaknesses) ----------
type RankableDef = {
  key: string;                      // field on raw cbb/trank blob
  source: "trank" | "cbb";
  label: string;
  format: "num1" | "num2" | "pct1" | "intDiff";
  higherBetter: boolean;
};
const RANKABLE: RankableDef[] = [
  { key: "adjoe",         source: "trank", label: "Adj ORtg",     format: "num1",    higherBetter: true  },
  { key: "adjde",         source: "trank", label: "Adj DRtg",     format: "num1",    higherBetter: false },
  { key: "sos",           source: "trank", label: "SoS",          format: "num2",    higherBetter: true  },
  { key: "ts_pct",        source: "cbb",   label: "TS%",          format: "pct1",    higherBetter: true  },
  { key: "efg_pct",       source: "cbb",   label: "eFG%",         format: "pct1",    higherBetter: true  },
  { key: "fg3_pct",       source: "cbb",   label: "3P%",          format: "pct1",    higherBetter: true  },
  { key: "tov_pct",       source: "cbb",   label: "TOV%",         format: "pct1",    higherBetter: false },
  { key: "orb_pct",       source: "cbb",   label: "OREB%",        format: "pct1",    higherBetter: true  },
  { key: "fta_rate",      source: "cbb",   label: "FTA Rate",     format: "pct1",    higherBetter: true  },
  { key: "ast_pct",       source: "cbb",   label: "AST%",         format: "pct1",    higherBetter: true  },
  { key: "fbpts_pct",     source: "cbb",   label: "FB Pts %",     format: "pct1",    higherBetter: true  },
  { key: "pitp_pct",      source: "cbb",   label: "Paint Pts %",  format: "pct1",    higherBetter: true  },
  { key: "efg_pct_def",   source: "cbb",   label: "Opp eFG%",     format: "pct1",    higherBetter: false },
  { key: "tov_pct_def",   source: "cbb",   label: "Opp TOV%",     format: "pct1",    higherBetter: true  },
  { key: "orb_pct_def",   source: "cbb",   label: "Opp OREB%",    format: "pct1",    higherBetter: false },
  { key: "fg3_pct_def",   source: "cbb",   label: "Opp 3P%",      format: "pct1",    higherBetter: false },
  { key: "reb_diff",      source: "cbb",   label: "REB Diff",     format: "intDiff", higherBetter: true  },
  { key: "fbpts_diff",    source: "cbb",   label: "FB Pts Diff",  format: "intDiff", higherBetter: true  },
  { key: "fg3_made_diff", source: "cbb",   label: "3PM Diff",     format: "intDiff", higherBetter: true  },
  { key: "potov_diff",    source: "cbb",   label: "PO TOV Diff",  format: "intDiff", higherBetter: true  },
  { key: "pts_diff",      source: "cbb",   label: "Pts Diff",     format: "intDiff", higherBetter: true  },
];

function pickStatValue(r: Row, def: RankableDef): number | null {
  const blob = def.source === "trank"
    ? (Array.isArray(r.team_trank_stats) ? null : r.team_trank_stats as Record<string, number | null> | null)
    : (Array.isArray(r.team_cbba_stats) || !r.team_cbba_stats ? null : r.team_cbba_stats as Record<string, number | null>);
  const v = blob?.[def.key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function attachNationalRanksToExport(rows: Row[]) {
  const byYear = new Map<number, Row[]>();
  for (const r of rows) {
    if (!byYear.has(r.year)) byYear.set(r.year, []);
    byYear.get(r.year)!.push(r);
  }
  for (const cohort of byYear.values()) {
    // Per stat: sort the cohort, assign rank 1..M (1 = best per `higherBetter`).
    const ranksByStat = new Map<string, Map<number, number>>();
    const totalByStat = new Map<string, number>();
    for (const def of RANKABLE) {
      const indexed: Array<{ tid: number; v: number }> = [];
      for (const r of cohort) {
        const v = pickStatValue(r, def);
        if (v !== null) indexed.push({ tid: r.id, v });
      }
      if (indexed.length < 2) continue;
      indexed.sort((a, b) => def.higherBetter ? b.v - a.v : a.v - b.v);
      const rankMap = new Map<number, number>();
      indexed.forEach((x, i) => rankMap.set(x.tid, i + 1));
      ranksByStat.set(def.key, rankMap);
      totalByStat.set(def.key, indexed.length);
    }
    // Per team: collect (rank, value, total) tuples, pick top-5 and bottom-5.
    for (const r of cohort) {
      const collected: Array<{
        key: string; label: string; format: RankableDef["format"];
        value: number; rank: number; total: number;
      }> = [];
      for (const def of RANKABLE) {
        const v = pickStatValue(r, def);
        if (v === null) continue;
        const rank = ranksByStat.get(def.key)?.get(r.id);
        const total = totalByStat.get(def.key);
        if (!rank || !total) continue;
        collected.push({ key: def.key, label: def.label, format: def.format, value: v, rank, total });
      }
      const asc = [...collected].sort((a, b) => a.rank - b.rank);
      r.national_ranks = {
        top: asc.slice(0, 5),
        bottom: [...asc].reverse().slice(0, 5),
      };
    }
  }
}

function attachBtaRtgToExport(rows: Row[]) {
  const byYear = new Map<number, Row[]>();
  for (const r of rows) {
    if (!byYear.has(r.year)) byYear.set(r.year, []);
    byYear.get(r.year)!.push(r);
  }
  for (const cohort of byYear.values()) {
    const pick = (r: Row, src: "trank" | "cbb", col: string): number | null => {
      const t = Array.isArray(r.team_trank_stats) ? null : r.team_trank_stats as Record<string, number | null> | null;
      const c = Array.isArray(r.team_cbba_stats) || !r.team_cbba_stats ? null : r.team_cbba_stats as Record<string, number | null>;
      const v = src === "trank" ? t?.[col] : c?.[col];
      return typeof v === "number" ? v : null;
    };
    const meanStd = (extract: (r: Row) => number | null) => {
      const vals = cohort.map(extract).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      if (vals.length === 0) return null;
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
      const std = Math.sqrt(variance);
      return std > 1e-9 ? { mean, std } : null;
    };
    const adjoe = meanStd((r) => pick(r, "trank", "adjoe"));
    const adjde = meanStd((r) => pick(r, "trank", "adjde"));
    const cbbO = meanStd((r) => pick(r, "cbb", "ortg_adj"));
    const cbbD = meanStd((r) => pick(r, "cbb", "drtg_adj"));
    const sos = meanStd((r) => pick(r, "trank", "sos"));
    // Small-weight diff terms — ORTG side (offensive tells)
    const orbDiff   = meanStd((r) => pick(r, "cbb", "orb_diff_ct"));
    const fg3mDiff  = meanStd((r) => pick(r, "cbb", "fg3_made_diff"));
    const fbptsDiff = meanStd((r) => pick(r, "cbb", "fbpts_diff"));
    // Small-weight diff terms — DRTG side (defensive tells)
    const rebDiff   = meanStd((r) => pick(r, "cbb", "reb_diff"));
    const potovDiff = meanStd((r) => pick(r, "cbb", "potov_diff"));
    for (const r of cohort) {
      let sum = 0;
      let weight = 0;
      const add = (z: number, w: number) => { sum += z * w; weight += w; };
      const v_adjoe = pick(r, "trank", "adjoe");
      const v_adjde = pick(r, "trank", "adjde");
      const v_cbbO = pick(r, "cbb", "ortg_adj");
      const v_cbbD = pick(r, "cbb", "drtg_adj");
      const v_sos = pick(r, "trank", "sos");
      const v_orbDiff   = pick(r, "cbb", "orb_diff_ct");
      const v_fg3mDiff  = pick(r, "cbb", "fg3_made_diff");
      const v_fbptsDiff = pick(r, "cbb", "fbpts_diff");
      const v_rebDiff   = pick(r, "cbb", "reb_diff");
      const v_potovDiff = pick(r, "cbb", "potov_diff");
      if (adjoe && v_adjoe !== null) add((v_adjoe - adjoe.mean) / adjoe.std, 1);
      if (cbbO && v_cbbO !== null) add((v_cbbO - cbbO.mean) / cbbO.std, 1);
      if (adjde && v_adjde !== null) add(-((v_adjde - adjde.mean) / adjde.std), 1);
      if (cbbD && v_cbbD !== null) add(-((v_cbbD - cbbD.mean) / cbbD.std), 1);
      if (sos && v_sos !== null) add((v_sos - sos.mean) / sos.std, 0.5);
      // ORTG-side small-weight tells (+z = bigger advantage = better)
      if (orbDiff   && v_orbDiff   !== null) add((v_orbDiff   - orbDiff.mean)   / orbDiff.std,   0.25);
      if (fg3mDiff  && v_fg3mDiff  !== null) add((v_fg3mDiff  - fg3mDiff.mean)  / fg3mDiff.std,  0.25);
      if (fbptsDiff && v_fbptsDiff !== null) add((v_fbptsDiff - fbptsDiff.mean) / fbptsDiff.std, 0.25);
      // DRTG-side small-weight tells (+z = bigger advantage = better)
      if (rebDiff   && v_rebDiff   !== null) add((v_rebDiff   - rebDiff.mean)   / rebDiff.std,   0.25);
      if (potovDiff && v_potovDiff !== null) add((v_potovDiff - potovDiff.mean) / potovDiff.std, 0.25);
      r.bta_rtg = weight === 0 ? null : (sum / weight) * 40;
    }
    // Per-season BTA Rank: sort cohort by bta_rtg desc, assign 1..N.
    const ranked = cohort
      .map((r, i) => ({ r, i, v: r.bta_rtg ?? null }))
      .filter((x) => x.v !== null) as { r: Row; i: number; v: number }[];
    ranked.sort((a, b) => b.v - a.v);
    ranked.forEach((x, idx) => { x.r.bta_rank = idx + 1; });
    for (const r of cohort) if (r.bta_rank === undefined) r.bta_rank = null;
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
