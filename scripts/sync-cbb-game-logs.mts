/**
 * sync-cbb-game-logs.mts — pulls per-game stats from CBB Analytics for every
 * team-season we have, writing one row per (team, game) into game_logs.
 *
 *   1. Look up each year's MALE D-I competition ID (one call)
 *   2. Load src/data/cbb-team-ids.json + Bart teams to build a
 *      (bart_team_id, cbba_team_id, year) work list
 *   3. For each entry: GET /api/gs/team-game-stats?competitionId=&teamId=
 *      → array of ~30-40 games for that team in that season
 *   4. Project each game to our typed columns + upsert (chunked)
 *
 * Run: npm run sync:cbb-game-logs
 * Time: ~12-15 min for 2200 team-seasons at 3 req/sec.
 */

import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Database } from "../src/lib/database.types.ts";

loadEnv({ path: ".env.local" });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!URL || !SR) {
  console.error("Missing Supabase env vars");
  process.exit(1);
}
const sb = createClient<Database>(URL, SR, { auth: { persistSession: false } });

// CBB token
const CONFIG_PATH = path.join(os.homedir(), ".config", "cbb-analytics-pp-cli", "config.toml");
const TOKEN = (() => {
  if (!fs.existsSync(CONFIG_PATH)) throw new Error(`No CBB CLI config at ${CONFIG_PATH}`);
  const m = fs.readFileSync(CONFIG_PATH, "utf8").match(/^analytics_token\s*=\s*['"]([^'"]+)['"]/m);
  if (!m) throw new Error("analytics_token missing");
  return m[1]!;
})();

const BASE = "https://api.cbbanalytics.com";

// Polite rate limiter — 3 req/sec
const MIN_INTERVAL_MS = 333;
let lastFetchAt = 0;
async function throttledGet<T>(p: string): Promise<T | null> {
  const wait = Math.max(0, lastFetchAt + MIN_INTERVAL_MS - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  lastFetchAt = Date.now();
  const res = await fetch(`${BASE}${p}`, {
    headers: { "x-auth-token": TOKEN, origin: "https://cbbanalytics.com", accept: "application/json" },
  });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

// ---------- helpers ----------
function num(x: unknown): number | null {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string") {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function int(x: unknown): number | null {
  const n = num(x);
  return n === null ? null : Math.trunc(n);
}
function bool(x: unknown): boolean | null {
  if (typeof x === "boolean") return x;
  if (typeof x === "number") return x !== 0;
  if (typeof x === "string") {
    if (x === "1" || x === "true") return true;
    if (x === "0" || x === "false") return false;
  }
  return null;
}
function dateStr(x: unknown): string | null {
  if (typeof x !== "string") return null;
  // Accept "2024-12-17", "2024-12-17T00:00:00.000Z", etc.
  const m = x.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

// ---------- main ----------
async function main() {
  console.log("CBB game-log sync");
  console.log("  Supabase:", URL);

  // 1) competitions per year (MALE)
  type Comp = { competitionId: number; season: number; gender: string; isCurrent?: string };
  const comps = await throttledGet<Comp[]>("/api/gs/competitions/") ?? [];
  const compByYear = new Map<number, number>();
  for (const c of comps.filter((x) => x.gender === "MALE")) compByYear.set(c.season, c.competitionId);
  console.log(`  MALE competitions: ${compByYear.size}`);

  // 2) work list (year, bart_team_id, cbba_team_id)
  const cbbIds = JSON.parse(fs.readFileSync("src/data/cbb-team-ids.json", "utf8")) as Record<string, { id: number }>;
  type Work = { year: number; team_pk: number; cbba_id: number };
  const work: Work[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb.from("teams").select("id, name_normalized, year").range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const t of data) {
      const cbb = cbbIds[t.name_normalized];
      if (cbb) work.push({ year: t.year, team_pk: t.id, cbba_id: cbb.id });
    }
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`  team-seasons with CBB match: ${work.length}`);

  // 3) Optional skip-existing mode
  const skipExisting = process.env.SKIP_EXISTING === "1";
  const haveByTeamYear = new Set<string>();
  if (skipExisting) {
    let f = 0;
    while (true) {
      const { data } = await sb.from("game_logs").select("team_id, year").range(f, f + 999);
      if (!data || data.length === 0) break;
      for (const r of data) haveByTeamYear.add(`${r.year}|${r.team_id}`);
      if (data.length < 1000) break;
      f += 1000;
    }
    const before = work.length;
    const filtered = work.filter((w) => !haveByTeamYear.has(`${w.year}|${w.team_pk}`));
    console.log(`  SKIP_EXISTING=1: ${before} → ${filtered.length}`);
    work.splice(0, work.length, ...filtered);
  }

  // Cbba team_id → our team_id lookup so we can resolve opp_team_id during projection
  const ourTeamByCbb = new Map<number, number>();
  for (const w of work) ourTeamByCbb.set(w.cbba_id, w.team_pk);

  // 4) sync
  const t0 = Date.now();
  let inserted = 0;
  let failed = 0;
  let i = 0;
  const CHUNK = 500;
  let pending: Array<Database["public"]["Tables"]["game_logs"]["Insert"]> = [];

  async function flush() {
    if (pending.length === 0) return;
    const { error } = await sb.from("game_logs").upsert(pending, { onConflict: "cbba_game_id,team_id" });
    if (error) {
      failed += pending.length;
      console.log(`  ✗ chunk upsert failed: ${error.message}`);
    } else {
      inserted += pending.length;
    }
    pending = [];
  }

  for (const w of work) {
    i++;
    const compId = compByYear.get(w.year);
    if (!compId) continue;
    type GameRow = Record<string, unknown> & { _id?: string; teamId?: number; gameDate?: string; isHome?: boolean; isNeutral?: boolean; isOffense?: boolean; isWin?: boolean | string | number; ptsScored?: number; ptsAgst?: number };
    const games = await throttledGet<GameRow[]>(
      `/api/gs/team-game-stats?competitionId=${compId}&teamId=${w.cbba_id}`
    );
    if (!games || games.length === 0) continue;

    for (const g of games) {
      if (!g._id) continue;
      // CBB returns 2 rows per game (isOffense true/false). Keep only the
      // offensive row — `*Agst` columns in it already cover what defense saw.
      if (g["isOffense"] !== true) continue;
      const won = bool(g.isWin ?? g["won"] ?? g["winLoss"]) ?? ((num(g.ptsScored) ?? 0) > (num(g.ptsAgst) ?? 0));
      const oppCbbaId = num(g["teamIdAgst"]);
      pending.push({
        cbba_game_id: g._id,
        year: w.year,
        team_id: w.team_pk,
        opp_team_id: oppCbbaId !== null ? ourTeamByCbb.get(Math.trunc(oppCbbaId)) ?? null : null,
        opp_team_market: typeof g["teamMarketAgst"] === "string" ? g["teamMarketAgst"] as string : null,
        game_date: dateStr(g.gameDate),
        is_home: bool(g.isHome),
        is_neutral: bool(g.isNeutral),
        won,
        pts_scored: int(g.ptsScored),
        pts_against: int(g.ptsAgst),
        pts_diff: int(g["ptsScoredDiff"]),
        poss: num(g["poss"]),
        pace: num(g["pace"]),
        fg3_made_diff: int(g["fgm3Diff"]),
        fg3_att_diff: int(g["fga3Diff"]),
        fg2_made_diff: int(g["fgm2Diff"]),
        fg_made_diff: int(g["fgmDiff"]),
        ft_made_diff: int(g["ftmDiff"]),
        ft_att_diff: int(g["ftaDiff"]),
        reb_diff: int(g["rebDiff"]),
        orb_diff: int(g["orbDiff"]),
        drb_diff: int(g["drbDiff"]),
        tov_diff: int(g["tovDiff"]),
        ast_diff: int(g["astDiff"]),
        stl_diff: int(g["stlDiff"]),
        blk_diff: int(g["blkDiff"]),
        fbpts_diff: int(g["fbptsDiff"]),
        pitp_diff: int(g["pitpDiff"]),
        scp_diff: int(g["scpDiff"]),
        fg3_pct: num(g["fg3Pct"]),
        fg2_pct: num(g["fg2Pct"]),
        ft_pct: num(g["ftPct"]),
        efg_pct: num(g["efgPct"]),
        ts_pct: num(g["tsPct"]),
        fg3_pct_def: num(g["fg3PctAgst"]),
        efg_pct_def: num(g["efgPctAgst"]),
      });
      if (pending.length >= CHUNK) await flush();
    }

    if (i % 50 === 0) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      process.stdout.write(`  ${i}/${work.length} (${elapsed}s elapsed, ${inserted} rows so far)\r`);
    }
  }
  await flush();

  const seconds = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n${"═".repeat(60)}`);
  console.log(`Done in ${seconds}s.`);
  console.log(`  team-seasons processed: ${work.length}`);
  console.log(`  game-log rows inserted: ${inserted}`);
  console.log(`  game-log rows failed:   ${failed}`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
