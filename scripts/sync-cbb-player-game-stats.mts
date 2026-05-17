/**
 * sync-cbb-player-game-stats.mts — pulls per-game player box scores from CBB
 * Analytics for every team-season we have, writing one row per (player, game)
 * into player_game_stats.
 *
 *   1. Look up each year's MALE D-I competition ID (one call)
 *   2. Load src/data/cbb-team-ids.json + Bart teams → (year, team_pk, cbba_team_id)
 *   3. Build a (year, team_pk, normalized_name) → bart_player_id lookup from
 *      our `players` table so we can join CBB's playerId to Bart's id.
 *   4. For each team-season:  GET /api/gs/player-game-stats?competitionId=&teamId=
 *      → 200-400 rows (one per game × player)
 *   5. Project to typed columns + upsert (chunked) on cbba_game_player_id.
 *
 * Run: npm run sync:cbb-player-game-stats
 * Time: ~15-20 min for 2200 team-seasons at 3 req/sec.
 *
 * Env:
 *   SKIP_EXISTING=1  → skip any (year, team) that already has rows
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

const CONFIG_PATH = path.join(os.homedir(), ".config", "cbb-analytics-pp-cli", "config.toml");
const TOKEN = (() => {
  if (!fs.existsSync(CONFIG_PATH)) throw new Error(`No CBB CLI config at ${CONFIG_PATH}`);
  const m = fs.readFileSync(CONFIG_PATH, "utf8").match(/^analytics_token\s*=\s*['"]([^'"]+)['"]/m);
  if (!m) throw new Error("analytics_token missing");
  return m[1]!;
})();

const BASE = "https://api.cbbanalytics.com";

// 3 req/sec polite rate limit
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
  const m = x.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// ---------- main ----------
async function main() {
  console.log("CBB player-game-stats sync");
  console.log("  Supabase:", URL);

  // 1) competitions per year (MALE)
  type Comp = { competitionId: number; season: number; gender: string };
  const comps = await throttledGet<Comp[]>("/api/gs/competitions/") ?? [];
  const compByYear = new Map<number, number>();
  for (const c of comps.filter((x) => x.gender === "MALE")) compByYear.set(c.season, c.competitionId);
  console.log(`  MALE competitions: ${compByYear.size}`);

  // 2) work list: every (year, our team_id, cbba_team_id) we know about
  const cbbIds = JSON.parse(fs.readFileSync("src/data/cbb-team-ids.json", "utf8")) as Record<string, { id: number }>;
  type Work = { year: number; team_pk: number; cbba_id: number };
  const work: Work[] = [];
  {
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
  }
  console.log(`  team-seasons with CBB match: ${work.length}`);

  // 3) (year, team_pk, normalized_name) → bart_player_id  (for CBB → Bart join)
  const bartByKey = new Map<string, number>();
  {
    let from = 0;
    while (true) {
      const { data, error } = await sb
        .from("players")
        .select("bart_player_id, name, team_id, year")
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      for (const p of data) {
        if (p.bart_player_id === null || p.team_id === null) continue;
        bartByKey.set(`${p.year}|${p.team_id}|${normalize(p.name)}`, p.bart_player_id);
      }
      if (data.length < 1000) break;
      from += 1000;
    }
  }
  console.log(`  bart-player lookups: ${bartByKey.size}`);

  // CBB team_id → our team_id (for resolving opponent FK)
  const ourTeamByCbb = new Map<number, number>();
  for (const w of work) ourTeamByCbb.set(w.cbba_id, w.team_pk);

  // 4) optional skip-existing
  const skipExisting = process.env.SKIP_EXISTING === "1";
  if (skipExisting) {
    const haveByTeamYear = new Set<string>();
    let f = 0;
    while (true) {
      const { data } = await sb.from("player_game_stats").select("team_id, year").range(f, f + 999);
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

  // 5) sync
  type Row = Database["public"]["Tables"]["player_game_stats"]["Insert"];
  type GameRow = Record<string, unknown> & {
    _id?: string; gameId?: number; period?: string;
    playerId?: number; fullName?: string;
    teamId?: number; teamIdAgst?: number; teamMarketAgst?: string;
    gameDate?: string; isHome?: boolean; isNeutral?: boolean; isWin?: boolean;
    isStarter?: boolean;
  };

  const t0 = Date.now();
  let inserted = 0;
  let failed = 0;
  let unmatchedPlayers = 0;
  let i = 0;
  const CHUNK = 500;
  let pending: Row[] = [];

  async function flush() {
    if (pending.length === 0) return;
    const { error } = await sb
      .from("player_game_stats")
      .upsert(pending, { onConflict: "cbba_game_player_id" });
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
    const rows = await throttledGet<GameRow[]>(
      `/api/gs/player-game-stats?competitionId=${compId}&teamId=${w.cbba_id}`
    );
    if (!rows || rows.length === 0) continue;

    for (const r of rows) {
      // CBB returns rows per (player, game, period). We only want full-game rows.
      if (r.period !== "game") continue;
      if (!r._id || !r.gameId || !r.playerId || !r.fullName) continue;

      const oppCbbaId = num(r.teamIdAgst);
      const cbbaPlayerId = int(r.playerId)!;
      const normName = normalize(String(r.fullName));
      const bartId = bartByKey.get(`${w.year}|${w.team_pk}|${normName}`) ?? null;
      if (bartId === null) unmatchedPlayers++;

      pending.push({
        cbba_game_player_id: String(r._id),
        cbba_game_id: int(r.gameId)!,
        year: w.year,
        game_date: dateStr(r.gameDate),
        cbba_player_id: cbbaPlayerId,
        bart_player_id: bartId,
        full_name: String(r.fullName),
        jersey_num: typeof r["jerseyNum"] === "string" ? (r["jerseyNum"] as string) : null,
        position: typeof r["position"] === "string" ? (r["position"] as string) : null,
        team_id: w.team_pk,
        opp_team_id: oppCbbaId !== null ? (ourTeamByCbb.get(Math.trunc(oppCbbaId)) ?? null) : null,
        opp_team_market: typeof r.teamMarketAgst === "string" ? (r.teamMarketAgst as string) : null,
        is_home: bool(r.isHome),
        is_neutral: bool(r.isNeutral),
        is_starter: bool(r.isStarter),
        won: bool(r.isWin),
        mins: num(r["mins"]),
        poss: num(r["poss"]),
        pts_scored: int(r["ptsScored"]),
        fgm: int(r["fgm"]),
        fga: int(r["fga"]),
        fgm2: int(r["fgm2"]),
        fga2: int(r["fga2"]),
        fgm3: int(r["fgm3"]),
        fga3: int(r["fga3"]),
        ftm: int(r["ftm"]),
        fta: int(r["fta"]),
        orb: int(r["orb"]),
        drb: int(r["drb"]),
        reb: int(r["reb"]),
        ast: int(r["ast"]),
        stl: int(r["stl"]),
        blk: int(r["blk"]),
        tov: int(r["tov"]),
        pf: int(r["pf"]),
        plus_minus: int(r["plusMinus"]),
        fg_pct: num(r["fgPct"]),
        fg3_pct: num(r["fg3Pct"]),
        ft_pct: num(r["ftPct"]),
        efg_pct: num(r["efgPct"]),
        ts_pct: num(r["tsPct"]),
        usage_pct: num(r["usagePct"]),
      });
      if (pending.length >= CHUNK) await flush();
    }

    if (i % 25 === 0) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      process.stdout.write(`  ${i}/${work.length} (${elapsed}s elapsed, ${inserted} rows so far)\r`);
    }
  }
  await flush();

  const seconds = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n${"═".repeat(60)}`);
  console.log(`Done in ${seconds}s.`);
  console.log(`  team-seasons processed:     ${work.length}`);
  console.log(`  player-game rows inserted:  ${inserted}`);
  console.log(`  rows w/o bart_player_id:    ${unmatchedPlayers}`);
  console.log(`  rows failed:                ${failed}`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
