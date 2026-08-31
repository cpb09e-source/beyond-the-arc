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
import { execFileSync } from "node:child_process";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!URL || !SR) {
  console.error("Missing Supabase env vars");
  process.exit(1);
}
const sb = createClient(URL, SR, { auth: { persistSession: false } });

const OUT = path.resolve("public/data");

// Team-name overrides live in src/lib/team-overrides.ts so both the full
// export and the fast portal-only export apply the same rewrites (CBB and
// Bart sometimes use different names for the same school).
import { overrideTeamName } from "../src/lib/team-overrides.ts";
// @ts-expect-error — plain .mjs helper shared with build-search-index.mjs
// Data floor: 2013-14 season (year 2014) — first year with reliable
// possession/efficiency data. Mirrors ALL_YEARS + clampYear in the app.
// A re-export with this floor regenerates every per-entity file (profiles,
// game logs, indices) with pre-2014 seasons dropped.
const YEARS = [
  2014, 2015, 2016, 2017, 2018, 2019, 2020,
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
  // Paginate all team-seasons joined to their Bart (trank) stats.
  //
  // The `team_cbba_stats` join is gone. Those 32 stats now come from
  // public/data/team-season-stats.json, aggregated out of the CBBD box archive
  // by scripts/build-team-season-stats.mjs and attached below as
  // `team_season_stats`. See docs/data-sources.md.
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

/**
 * The CBBD-derived season aggregates, keyed "<team>|<year>". Built offline so
 * `npm run export:data` stays a pure read of things already on disk plus
 * Supabase's Bart tables — no API calls, no expiring tokens.
 */
async function loadTeamSeasonStats(): Promise<Record<string, Record<string, number | null>>> {
  const fp = path.join(OUT, "team-season-stats.json");
  try {
    return JSON.parse(await fs.readFile(fp, "utf8"));
  } catch {
    throw new Error(
      `Missing ${fp}. Run \`node scripts/build-team-season-stats.mjs\` first — ` +
      `team stats no longer come from Supabase.`,
    );
  }
}

/**
 * Per-game logs for a season.
 *
 * READS the file, no longer WRITES it. game-logs-by-year/<year>.json is built
 * from the CBBD box archive by scripts/build-game-logs-cbbd.mjs, which already
 * resolves Bart team names and per-season conferences. This export consumes it
 * only to compute the four-factor record carried on each team-season row.
 */
async function fetchGameLogsForYear(year: number) {
  const fp = path.join(OUT, "game-logs-by-year", `${year}.json`);
  try {
    return JSON.parse(await fs.readFile(fp, "utf8")) as unknown[];
  } catch {
    throw new Error(
      `Missing ${fp} — run \`node scripts/build-game-logs-cbbd.mjs\` first. ` +
      `Game logs no longer come from Supabase.`,
    );
  }
}

// ---------- Advanced player stats (CBBD player box, aggregated offline) ----------
// Attached to each row in players-by-year/<year>.json under `advanced_stats`.
//
// Built by scripts/build-player-season-adv.mjs from the CBBD player box archive.
// This replaces two Supabase tables sourced from CBB Analytics
// (player_game_stats, player_on_off_stats) — see docs/data-sources.md.
//
// FIELD CHANGES vs the CBB Analytics version:
//   - tov_pg, usage_pct: unchanged in meaning. Verified against the old values
//     at a median absolute difference of 0.0002 and 0.0023 respectively.
//   - plus_minus_pg: REMOVED. On-court plus/minus needs lineup data, and CBBD's
//     play-by-play has no onFloor and no substitution events before 2024, so it
//     is unrecoverable for 2014-2023 from any source we have.
//   - net_rtg: NEW, and deliberately not a rename of plus_minus_pg. It is
//     CBBD's individual offensive-minus-defensive rating per 100 possessions,
//     a different statistic.
//   - mins_pct / is_qualified: REMOVED. They came from the on/off table and no
//     UI surface read them.
//   - min_pg, game_score_pg: NEW, free from the same aggregation.
type PlayerAdvancedAggregate = {
  games: number;
  min_pg: number | null;
  tov_pg: number | null;
  /**
   * Turnover RATE — TOV / (FGA + 0.44·FTA + TOV), summed over the season rather
   * than averaged per game. Usage-adjusted, so it doesn't simply rank whoever
   * handles the ball most; it's what the players grid shows under Handle.
   */
  tov_pct: number | null;
  usage_pct: number | null;
  net_rtg: number | null;
  game_score_pg: number | null;
  // NOT on/off. That already ships via epm-<year>.json (export-epm-json.mjs
  // reads on_off + ewins out of epm-extras.csv), and the players grid merges it
  // from there. Duplicating it here would give one field two sources that could
  // silently disagree.
};

/**
 * Load the offline CBBD aggregation, keyed "<bartId>|<year>".
 *
 * This used to be two paginated Supabase scans over ~1.5M CBB Analytics rows
 * that had to be chunked per year to stay inside the statement timeout. It is
 * now one file read.
 */
async function loadPlayerAdvanced(): Promise<Record<string, PlayerAdvancedAggregate>> {
  const fp = path.join(OUT, "player-season-adv.json");
  try {
    return JSON.parse(await fs.readFile(fp, "utf8"));
  } catch {
    throw new Error(
      `Missing ${fp} — run \`node scripts/build-player-season-adv.mjs\` first. ` +
      `Advanced player stats no longer come from Supabase.`,
    );
  }
}

function buildAdvancedAggregate(
  bartId: number | null,
  year: number,
  adv: Record<string, PlayerAdvancedAggregate>,
): PlayerAdvancedAggregate | null {
  if (bartId == null) return null;
  return adv[`${bartId}|${year}`] ?? null;
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
    team_season_stats: unknown;
    bta_rtg?: number | null;
  }>;
  // Apply display-name overrides up front so byName / slugs / search index all
  // see the new name. Database stays untouched.
  for (const t of teams) t.name = overrideTeamName(t.name);

  // Attach the CBBD-derived season aggregates. Keyed on the OVERRIDDEN name,
  // because build-team-season-stats.mjs resolves teams through the same
  // CBBD↔Bart map and teams-all.json, which already carry the display name.
  const seasonStats = await loadTeamSeasonStats();
  let withSeasonStats = 0;
  for (const t of teams) {
    const hit = seasonStats[`${t.name}|${t.year}`] ?? null;
    t.team_season_stats = hit;
    if (hit) withSeasonStats++;
  }
  console.log(`   ${teams.length} team-season rows (${withSeasonStats} with CBBD season stats)`);

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

  console.log("\n🏀 Reading game logs (per year) for the four-factor record…");
  let totalLogs = 0;
  // (team NAME, year) → games where REB Diff + FBP Diff + 3PM Diff are all > 0.
  // Powers the "When all three positive" badge on the team page Four Factors card.
  //
  // KEYED ON NAME, NOT team_id. The logs now carry CBBD team ids while
  // teams-all.json carries Supabase ids — two different id spaces that happen to
  // both be small integers, so keying on the number silently matched nothing and
  // every team's record came back null. Names are the one identifier both sides
  // share, and build-game-logs-cbbd.mjs already resolves them to Bart spellings.
  type FFRecord = { wins: number; losses: number; games: number };
  const fourFactorByTeamYear = new Map<string, FFRecord>();
  for (const year of YEARS) {
    const logs = await fetchGameLogsForYear(year) as Array<{
      team_name: string;
      reb_diff?: number | null;
      fbpts_diff?: number | null;
      fg3_made_diff?: number | null;
      won?: boolean;
    }>;
    // Aggregate the four-factor record per team for this season.
    const perTeam = new Map<string, FFRecord>();
    for (const l of logs) {
      const reb = l.reb_diff ?? null;
      const fbp = l.fbpts_diff ?? null;
      const tp = l.fg3_made_diff ?? null;
      // fbpts_diff is null for any game whose arena didn't track the split, so
      // pre-2023 seasons legitimately contribute far fewer qualifying games.
      if (reb === null || fbp === null || tp === null) continue;
      if (!(reb > 0 && fbp > 0 && tp > 0)) continue;
      if (!l.team_name) continue;
      const rec = perTeam.get(l.team_name) ?? { wins: 0, losses: 0, games: 0 };
      rec.games += 1;
      if (l.won) rec.wins += 1; else rec.losses += 1;
      perTeam.set(l.team_name, rec);
    }
    for (const [name, rec] of perTeam.entries()) {
      fourFactorByTeamYear.set(`${name}|${year}`, rec);
    }

    // Flatten team join → top-level team_name / team_conference so the client
    // doesn't have to walk the nested array.
    // DO NOT WRITE game-logs-by-year HERE. build-game-logs-cbbd.mjs owns those
    // files; this loop only reads them to compute the four-factor record.
    //
    // There used to be a write-back that flattened a Supabase `teams` join onto
    // each row. When the query was replaced with a file read, the flattening
    // survived — and since the rows no longer carry a `teams` property, it
    // rewrote `team_name` as `t?.name ?? "—"` for EVERY row of EVERY season.
    // 11,433 rows in 2014, one distinct team name: an em dash. Re-exporting
    // silently destroyed the file it had just read.
    console.log(`   ${year}: ${logs.length} game-perspective rows, ${perTeam.size} teams with 4F-record`);
    totalLogs += logs.length;
  }
  console.log(`   total: ${totalLogs} game logs`);

  // Attach four-factor record to each team-season row, then write the team
  // JSONs (waited until now so the record is included in the per-team payload).
  for (const t of teams as Array<typeof teams[number] & { four_factor_record?: FFRecord | null }>) {
    // `t.name` has already had overrideTeamName applied, which is the same
    // spelling build-game-logs-cbbd.mjs writes into team_name.
    t.four_factor_record = fourFactorByTeamYear.get(`${t.name}|${t.year}`) ?? null;
  }
  // Load the coach snapshot (one-shot file committed to repo by
  // `npm run snapshot:coaches`). Keys are Bart raw names → apply overrideTeamName
  // so they line up with the team display names used everywhere else.
  type CoachEntry = { name: string; first_name: string; last_name: string; espn_id: string | null };
  const coachByTeam = new Map<string, CoachEntry>();
  try {
    const raw = JSON.parse(await fs.readFile(path.resolve("src/data/team-coaches.json"), "utf8")) as Record<string, CoachEntry>;
    for (const [bartName, info] of Object.entries(raw)) coachByTeam.set(overrideTeamName(bartName), info);
    console.log(`   ${coachByTeam.size} coaches loaded from team-coaches.json`);
  } catch {
    console.log("   no team-coaches.json found — coach field stays null. Run `npm run snapshot:coaches` to populate.");
  }

  await fs.writeFile(path.join(OUT, "teams-all.json"), JSON.stringify(teams));
  const LATEST_YEAR = YEARS[YEARS.length - 1];
  let teamSlugCount = 0;
  for (const [name, rows] of byName.entries()) {
    rows.sort((a, b) => b.year - a.year);
    // Attach current-season coach. Older seasons left null until we have
    // historical coach data (Sports Reference snapshot, separate phase).
    const coach = coachByTeam.get(name);
    if (coach) {
      for (const r of rows as Array<typeof rows[number] & { coach?: string | null }>) {
        if (r.year === LATEST_YEAR) r.coach = coach.name;
      }
    }
    const s = slug(name);
    await fs.writeFile(path.join(OUT, "team", `${s}.json`), JSON.stringify({ name, seasons: rows }));
    teamSlugCount++;
  }
  console.log(`   ${teamSlugCount} per-team JSON files written (with four-factor record + ${coachByTeam.size > 0 ? "coach" : "no coach"})`);

  console.log("\n📊 Loading advanced player aggregates (CBBD player box)…");
  const playerAdvanced = await loadPlayerAdvanced();
  console.log(`   ${Object.keys(playerAdvanced).length.toLocaleString()} player-seasons`);

  console.log("\n👥 Exporting players (per year)…");
  let totalPlayers = 0;
  const playersByBartId = new Map<number, Array<{ year: number; team_name: string; team_conference: string | null; class: string | null; raw_row: unknown; games: number | null; notes: string | null; projection: number | null; advanced_stats: PlayerAdvancedAggregate | null }>>();
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
    // Attach advanced stats (TOV/USG%/+- from game stats + on/off ratings)
    // to each player. Players without coverage just get `advanced_stats: null`.
    const enriched = players.map((p) => ({
      ...p,
      advanced_stats: buildAdvancedAggregate(p.bart_player_id, year, playerAdvanced),
    }));
    let withAdv = 0;
    for (const p of enriched) if (p.advanced_stats !== null) withAdv++;
    console.log(`   ${year}: ${enriched.length} players (${withAdv} with advanced stats)`);
    await fs.writeFile(path.join(OUT, "players-by-year", `${year}.json`), JSON.stringify(enriched));
    totalPlayers += enriched.length;
    // Accumulate for per-player files
    for (const p of enriched) {
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
        advanced_stats: p.advanced_stats,
      });
    }
  }
  console.log(`   total: ${totalPlayers} player-season rows`);

  // (The per-year PIR/PORPAG cohort stats used to be computed here for the
  // portal's BTA PRTG. The portal moved to its own scripts — see below — so
  // computeCohortStats now lives only in refresh-portal / export-portal-only.)

  console.log("\n🧑 Per-player JSON files…");
  let playerFileCount = 0;
  for (const [bartId, seasons] of playersByBartId.entries()) {
    seasons.sort((a, b) => b.year - a.year);
    await fs.writeFile(path.join(OUT, "player", `${bartId}.json`), JSON.stringify({ bart_player_id: bartId, seasons }));
    playerFileCount++;
  }
  console.log(`   ${playerFileCount} per-player JSON files`);

  // Per-player game logs are NOT written here any more.
  //
  // scripts/build-player-games-cbbd.mjs owns public/data/player-games/ now. This
  // block used to keyset-paginate ~1.59M rows out of the CBB Analytics
  //  table (OFFSET paging timed out past ~1.5M rows, hence the
  // keyset walk) and write one file per player, including cbb_<cbbaId>.json files
  // for players it could not join to Bart. Those unmatched files were unreachable
  // from the UI — every entry point goes through a bart_player_id — so the CBBD
  // rebuild writes bart-keyed files only. See docs/data-sources.md.

  // ---------- Transfer portal ----------
  // NOT EXPORTED HERE ANY MORE. portal.json is owned by two other scripts:
  //   scripts/refresh-portal.mts   — rebuilds entries from On3's public feed
  //   scripts/export-portal-only.mts — re-aggregates BTA PRTG / transfer classes
  //
  // This block used to fetch CBB Analytics' `vc-transfer-portal` endpoint with
  // a scraped session token that expired every ~30 days. That source is gone —
  // see docs/data-sources.md. Leaving the export here would have silently
  // overwritten the On3-sourced portal.json with an empty state on every run
  // once the token lapsed.

  console.log("\n🏷  Conferences per year…");
  const confsByYear: Record<number, string[]> = {};
  for (const year of YEARS) {
    const confs = new Set<string>();
    for (const t of teams) if (t.year === year && t.conference) confs.add(t.conference);
    confsByYear[year] = [...confs].sort();
  }
  await fs.writeFile(path.join(OUT, "conferences.json"), JSON.stringify(confsByYear));

  /**
   * Search index — delegated to scripts/build-search-index.mjs.
   *
   * This used to be a second implementation of that script, and the two drifted
   * the way duplicated code does. The copy here built its player list from
   * playersByBartId and then required a name read back out of
   * player/<id>.json, dropping anyone whose per-player file it could not read.
   * Measured against the standalone builder on the same corpus, that silently
   * lost 10,774 of 25,474 players from search — 1,761 of them from 2025-26
   * alone — which is why people who plainly exist could not be found. It also
   * predates the interned-schools encoding and the search-stats.json sidecar,
   * so running it would have quietly reverted both.
   *
   * One implementation, invoked. It reads files this script has just written,
   * so it has to run after them, which is where it already sat.
   */
  console.log("\n🔎 Search index…");
  execFileSync(process.execPath, [path.resolve("scripts/build-search-index.mjs")], { stdio: "inherit" });

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
  team_season_stats: unknown;
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
  // OURS, not Bart's. a_ortg / a_drtg come from build-adjusted-ratings.mjs and
  // validate against his T-Rank at r = 0.986 on net rating; `sos` is the same
  // file's net schedule strength, which replaced his win-probability figure so
  // the site carries one SOS rather than two in different units.
  { key: "a_ortg",        source: "cbb",   label: "Adj ORtg",     format: "num1",    higherBetter: true  },
  { key: "a_drtg",        source: "cbb",   label: "Adj DRtg",     format: "num1",    higherBetter: false },
  { key: "sos",           source: "cbb",   label: "SOS",          format: "num1",    higherBetter: true  },
  { key: "ts_pct",        source: "cbb",   label: "TS%",          format: "pct1",    higherBetter: true  },
  { key: "efg_pct",       source: "cbb",   label: "eFG%",         format: "pct1",    higherBetter: true  },
  { key: "fg3_pct",       source: "cbb",   label: "3P%",          format: "pct1",    higherBetter: true  },
  { key: "tov_pct",       source: "cbb",   label: "TOV%",         format: "pct1",    higherBetter: false },
  { key: "orb_pct",       source: "cbb",   label: "OREB%",        format: "pct1",    higherBetter: true  },
  { key: "fta_rate",      source: "cbb",   label: "FTAR",         format: "pct1",    higherBetter: true  },
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
    : (Array.isArray(r.team_season_stats) || !r.team_season_stats ? null : r.team_season_stats as Record<string, number | null>);
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
      const c = Array.isArray(r.team_season_stats) || !r.team_season_stats ? null : r.team_season_stats as Record<string, number | null>;
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
