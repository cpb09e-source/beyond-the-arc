/**
 * sync-cbb-teams.mts — pulls CBB Analytics team season aggregates and upserts
 * them into team_cbba_stats. Run with: npm run sync:cbb-teams
 *
 * For each year in 2021..2026:
 *   1. Look up the MALE D-I competition ID from /api/gs/competitions/
 *   2. For each team in our DB that has a matched cbba_team_id (via
 *      src/data/cbb-team-ids.json), call
 *          /api/gs/team-agg-stats/competition/{compId}/team/{cbbaTeamId}/
 *      which returns ~80 rows (one per scope: season, conf, quad1, etc.)
 *   3. Find the scope='season', isOffense=true row and extract the columns
 *      we promoted in migration 002. Defensive stats come from the same row's
 *      `*Agst` suffix fields.
 *   4. Upsert into team_cbba_stats.
 *
 * Auth: reads `analytics_token` from C:\Users\Colin\.config\cbb-analytics-pp-cli\config.toml.
 *
 * Rate-limited to 3 req/sec to stay polite to the API.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/database.types.ts";

loadEnv({ path: ".env.local" });

// ---------- env + auth ----------
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const sb = createClient<Database>(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CONFIG_PATH = path.join(os.homedir(), ".config", "cbb-analytics-pp-cli", "config.toml");
function readCbbToken(): string {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`CBB CLI config not found at ${CONFIG_PATH}. Run 'cbb-analytics-pp-cli auth login' first.`);
  }
  const text = fs.readFileSync(CONFIG_PATH, "utf8");
  const m = text.match(/^analytics_token\s*=\s*['"]([^'"]+)['"]/m);
  if (!m) throw new Error(`No analytics_token in ${CONFIG_PATH}`);
  return m[1]!;
}
const TOKEN = readCbbToken();

// ---------- HTTP ----------
const BASE = "https://api.cbbanalytics.com";
async function cbbGet<T = unknown>(pathOrUrl: string): Promise<T> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${BASE}${pathOrUrl}`;
  const res = await fetch(url, {
    headers: {
      "x-auth-token": TOKEN,
      origin: "https://cbbanalytics.com",
      accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  return res.json() as Promise<T>;
}

// rate limit: max 3 req/sec
const MIN_INTERVAL_MS = 333;
let lastFetchAt = 0;
async function throttledGet<T>(p: string): Promise<T> {
  const wait = Math.max(0, lastFetchAt + MIN_INTERVAL_MS - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastFetchAt = Date.now();
  return cbbGet<T>(p);
}

// ---------- types & helpers ----------
type Competition = {
  competitionId: number;
  season: number;             // 2025 for 2024-25
  gender: "MALE" | "FEMALE";
  isCurrent?: string;
  competitionName: string;
};

type TeamAggRow = Record<string, unknown> & {
  scope: string;
  isOffense: boolean;
  teamId: number;
  teamMarket?: string;
  competitionId: number;
};

function num(x: unknown): number | null {
  if (x === null || x === undefined) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

// ---------- per-year drivers ----------
async function getCompetitionsByYear(): Promise<Map<number, number>> {
  // Returns map: season (2021..2026) → competitionId for MALE
  const comps = await cbbGet<Competition[]>("/api/gs/competitions/");
  const male = comps.filter((c) => c.gender === "MALE");
  const byYear = new Map<number, number>();
  for (const c of male) byYear.set(c.season, c.competitionId);
  return byYear;
}

type TeamMapEntry = { name_normalized: string; bart_year: number; team_pk: number; cbba_id: number };

async function loadTeamMap(): Promise<TeamMapEntry[]> {
  // For each Bart team in our DB that has a matching cbba_team_id in the JSON,
  // produce a row we can use to drive the sync.
  const cbbJsonPath = path.resolve("src/data/cbb-team-ids.json");
  const cbbIds = JSON.parse(fs.readFileSync(cbbJsonPath, "utf8")) as Record<
    string,
    { id: number }
  >;

  const rows: TeamMapEntry[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from("teams")
      .select("id, name, name_normalized, year")
      .range(from, from + 999);
    if (error) throw new Error(`teams lookup: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const t of data) {
      const entry = cbbIds[t.name_normalized];
      if (!entry) continue;  // no CBB match — skip (logo fallback shows monogram)
      rows.push({
        name_normalized: t.name_normalized,
        bart_year: t.year,
        team_pk: t.id,
        cbba_id: entry.id,
      });
    }
    if (data.length < 1000) break;
    from += 1000;
  }
  return rows;
}

// ---------- pull and project ----------
function extractSeasonRow(rows: TeamAggRow[]): TeamAggRow | null {
  // The endpoint returns ~80 rows per team — one per scope. We want full-season
  // offense. CBB Analytics' "season" scope is the canonical full-season aggregate.
  return rows.find((r) => r.scope === "season" && r.isOffense === true) ?? null;
}

function projectCbbStats(row: TeamAggRow) {
  // Map CBB field names to our typed columns. `*Agst` fields come from the
  // SAME row (CBB packs both sides of the ball into the offense row).
  const g = (k: string) => num(row[k]);
  return {
    // four-factor offense
    efg_pct: g("efgPct"),
    ts_pct: g("tsPct"),
    tov_pct: g("tovPct"),
    orb_pct: g("orbPct"),
    fta_rate: g("ftaRate"),
    fg3_pct: g("fg3Pct"),
    fg2_pct: g("fg2Pct"),
    ft_pct: g("ftPct"),
    fg3a_rate: g("fga3Rate"),
    ast_pct: g("astPct"),

    // four-factor defense (allowed)
    efg_pct_def: g("efgPctAgst"),
    tov_pct_def: g("tovPctAgst"),
    orb_pct_def: g("orbPctAgst"),
    fta_rate_def: g("ftaRateAgst"),
    fg3_pct_def: g("fg3PctAgst"),

    // ratings
    ortg: g("ortg"),
    drtg: g("drtg"),
    net_rtg: g("netRtg"),
    ortg_adj: g("ortgAdj"),
    drtg_adj: g("drtgAdj"),
    net_rtg_adj: g("netRtgAdj"),

    // pace
    pace: g("pace"),
    pace_adj: g("paceAdj"),

    // volume / context
    gp: g("gp") === null ? null : Math.trunc(g("gp")!),
    poss: g("poss"),
    sos_cbb: g("sos"),

    // shot mix
    fbpts_pct: g("fbptsPctPts"),
    pitp_pct: g("pitpPctPts"),
    bench_pts_pct: null,  // CBB has benchPts but no benchPtsPctPts field directly

    // Migration-003 columns. Only spread when applied, so the upsert doesn't
    // try to write columns the database doesn't know about.
    ...(HAS_MIG_003 ? {
      fg3_made:         g("fgm3")     === null ? null : Math.trunc(g("fgm3")!),
      fg3_attempts:     g("fga3")     === null ? null : Math.trunc(g("fga3")!),
      fg3_made_def:     g("fgm3Agst") === null ? null : Math.trunc(g("fgm3Agst")!),
      fg3_attempts_def: g("fga3Agst") === null ? null : Math.trunc(g("fga3Agst")!),
      fg3_made_diff: g("fgm3Diff") === null ? null : Math.trunc(g("fgm3Diff")!),
      fg3_att_diff:  g("fga3Diff") === null ? null : Math.trunc(g("fga3Diff")!),
      fg2_made_diff: g("fgm2Diff") === null ? null : Math.trunc(g("fgm2Diff")!),
      fg2_att_diff:  g("fga2Diff") === null ? null : Math.trunc(g("fga2Diff")!),
      fg_made_diff:  g("fgmDiff")  === null ? null : Math.trunc(g("fgmDiff")!),
      ft_made_diff:  g("ftmDiff")  === null ? null : Math.trunc(g("ftmDiff")!),
      ft_att_diff:   g("ftaDiff")  === null ? null : Math.trunc(g("ftaDiff")!),
      reb_diff:      g("rebDiff")  === null ? null : Math.trunc(g("rebDiff")!),
      orb_diff_ct:   g("orbDiff")  === null ? null : Math.trunc(g("orbDiff")!),
      drb_diff:      g("drbDiff")  === null ? null : Math.trunc(g("drbDiff")!),
      tov_diff_ct:   g("tovDiff")  === null ? null : Math.trunc(g("tovDiff")!),
      fbpts_diff:    g("fbptsDiff")=== null ? null : Math.trunc(g("fbptsDiff")!),
      pitp_diff:     g("pitpDiff") === null ? null : Math.trunc(g("pitpDiff")!),
      pts_diff:      g("ptsScoredDiff") === null ? null : Math.trunc(g("ptsScoredDiff")!),
      scp_diff:      g("scpDiff")  === null ? null : Math.trunc(g("scpDiff")!),
      potov_diff:    g("potovDiff")=== null ? null : Math.trunc(g("potovDiff")!),
    } : {}),
  };
}

// Set by main() after probing whether migration 003 has been applied.
// projectCbbStats reads it to conditionally include the new column set.
let HAS_MIG_003 = false;

// ---------- main ----------
async function main() {
  console.log("CBB Analytics team-aggs sync");
  console.log("  Supabase:", SUPABASE_URL);
  console.log("  Token len:", TOKEN.length);

  // Probe migration 003 by SELECTing one of its columns. If the column
  // doesn't exist, PostgREST returns an error mentioning "schema cache".
  const { error: probeErr } = await sb.from("team_cbba_stats").select("drb_diff").limit(1);
  HAS_MIG_003 = !probeErr;
  console.log(
    `  Migration 003: ${HAS_MIG_003 ? "applied — syncing full column set" : "NOT applied — skipping count-diff columns (3PM Diff, FB Pts Diff, etc.)"}`
  );

  // 1) competition IDs
  const compByYear = await getCompetitionsByYear();
  console.log(`\nMALE competitions found: ${compByYear.size}`);
  for (const [year, id] of [...compByYear.entries()].sort()) {
    console.log(`  ${year} → competitionId ${id}`);
  }

  // 2) Bart team rows that have a CBB ID match
  let teamMap = await loadTeamMap();
  console.log(`\nBart team-seasons with CBB match: ${teamMap.length}`);

  // Allow env override: YEARS=2013,2014,2015 npm run sync:cbb-teams
  const yearOverride = process.env.YEARS?.trim();
  if (yearOverride) {
    const keep = new Set(yearOverride.split(",").map((s) => Number(s.trim())).filter(Number.isFinite));
    const before = teamMap.length;
    teamMap = teamMap.filter((t) => keep.has(t.bart_year));
    console.log(`YEARS override active (${[...keep].join(",")}): filtered ${before} → ${teamMap.length}`);
  }

  // Optional: SKIP_EXISTING=1 filters out (year, team_id) pairs that already
  // have CBB stats in the DB. Lets a name-mapping refresh sync just the
  // newly-matched teams (~70 sec) instead of re-syncing the whole set.
  if (process.env.SKIP_EXISTING === "1") {
    const have = new Set<string>();
    let from = 0;
    while (true) {
      const { data, error } = await sb
        .from("team_cbba_stats")
        .select("team_id, year")
        .range(from, from + 999);
      if (error) throw new Error(`existing CBB stats lookup: ${error.message}`);
      if (!data || data.length === 0) break;
      for (const r of data) have.add(`${r.year}|${r.team_id}`);
      if (data.length < 1000) break;
      from += 1000;
    }
    const before = teamMap.length;
    teamMap = teamMap.filter((t) => !have.has(`${t.bart_year}|${t.team_pk}`));
    console.log(`SKIP_EXISTING=1: filtered ${before} → ${teamMap.length} (skipping ${before - teamMap.length} already-synced)`);
  }

  // Group by year so we can stop early if a year's competition isn't published
  const byYear = new Map<number, TeamMapEntry[]>();
  for (const r of teamMap) {
    if (!byYear.has(r.bart_year)) byYear.set(r.bart_year, []);
    byYear.get(r.bart_year)!.push(r);
  }

  const t0 = Date.now();
  let totalUpserted = 0;
  let totalFailed = 0;

  for (const [year, teams] of [...byYear.entries()].sort()) {
    const compId = compByYear.get(year);
    if (!compId) {
      console.log(`\n--- ${year}: no MALE competition found, skipping ${teams.length} teams ---`);
      continue;
    }
    console.log(`\n--- ${year} (compId ${compId}, ${teams.length} teams) ---`);

    const upserts: Array<{
      team_id: number;
      year: number;
      competition_id: number;
    } & ReturnType<typeof projectCbbStats>> = [];

    let okCount = 0;
    let failCount = 0;
    let skipCount = 0;

    for (let i = 0; i < teams.length; i++) {
      const t = teams[i]!;
      try {
        const url = `/api/gs/team-agg-stats/competition/${compId}/team/${t.cbba_id}/`;
        const rows = await throttledGet<TeamAggRow[]>(url);
        const season = extractSeasonRow(rows);
        if (!season) {
          skipCount++;
          continue;
        }
        upserts.push({
          team_id: t.team_pk,
          year,
          competition_id: compId,
          ...projectCbbStats(season),
        });
        okCount++;
      } catch (err) {
        failCount++;
        if (failCount <= 3) {
          console.log(`  ✗ team_pk=${t.team_pk} cbba_id=${t.cbba_id}: ${err instanceof Error ? err.message : err}`);
        }
      }
      if ((i + 1) % 50 === 0) {
        process.stdout.write(`  ${i + 1}/${teams.length} fetched...\r`);
      }
    }

    // Chunk upserts
    const CHUNK = 500;
    for (let i = 0; i < upserts.length; i += CHUNK) {
      const slice = upserts.slice(i, i + CHUNK);
      const { error } = await sb
        .from("team_cbba_stats")
        .upsert(slice, { onConflict: "team_id" });
      if (error) {
        console.log(`  ✗ upsert chunk ${i}: ${error.message}`);
        totalFailed += slice.length;
      } else {
        totalUpserted += slice.length;
      }
    }
    console.log(
      `  ${year}: fetched=${okCount} skip(no-season)=${skipCount} fetch-fail=${failCount} upserted=${upserts.length}`
    );
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n${"═".repeat(60)}`);
  console.log(`Done in ${elapsed}s — upserted ${totalUpserted}, failed ${totalFailed}`);

  await sb.from("sync_runs").insert({
    source: "cbba_teams",
    year: 2026,
    rows_inserted: totalUpserted,
    notes: `${totalUpserted} upserted across ${compByYear.size} seasons`,
  });
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
