/**
 * sync-cbb-player-on-off.mts — pulls per-player season on-off impact from
 * CBB Analytics. One row per (player, season) into player_on_off_stats.
 *
 *   1. Competitions per year (MALE)
 *   2. Bart teams × CBB ids (same work-list as game-log sync)
 *   3. (year, our team_pk, normalized name) → bart_player_id lookup
 *   4. For each team-season: GET /api/gs/on-off-agg-stats?competitionId=&teamId=
 *      → filter to scope=seasonAll, onOffDiff=diff, isOffense=true.
 *      That's the season-long "ON minus OFF" net-rating diff row.
 *   5. Upsert on cbba_row_id.
 *
 * Run: npm run sync:cbb-player-on-off
 * Time: ~15 min for 4,949 team-seasons at 3 req/sec.
 *
 * Env: SKIP_EXISTING=1  → skip (year, team) pairs already populated
 *      YEARS=2013,2014  → only sync these years
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
if (!URL || !SR) { console.error("Missing Supabase env vars"); process.exit(1); }
const sb = createClient<Database>(URL, SR, { auth: { persistSession: false } });

const CONFIG_PATH = path.join(os.homedir(), ".config", "cbb-analytics-pp-cli", "config.toml");
const TOKEN = (() => {
  if (!fs.existsSync(CONFIG_PATH)) throw new Error(`No CBB CLI config at ${CONFIG_PATH}`);
  const m = fs.readFileSync(CONFIG_PATH, "utf8").match(/^analytics_token\s*=\s*['"]([^'"]+)['"]/m);
  if (!m) throw new Error("analytics_token missing");
  return m[1]!;
})();

const BASE = "https://api.cbbanalytics.com";
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

function num(x: unknown): number | null {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string") { const n = Number(x); return Number.isFinite(n) ? n : null; }
  return null;
}
function bool(x: unknown): boolean | null {
  if (typeof x === "boolean") return x;
  if (typeof x === "number") return x !== 0;
  return null;
}
function normalize(s: string): string {
  return s
    .toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

async function main() {
  console.log("CBB player on-off sync");
  console.log("  Supabase:", URL);

  // 1) competitions per year
  type Comp = { competitionId: number; season: number; gender: string };
  const comps = await throttledGet<Comp[]>("/api/gs/competitions/") ?? [];
  const compByYear = new Map<number, number>();
  for (const c of comps.filter((x) => x.gender === "MALE")) compByYear.set(c.season, c.competitionId);
  console.log(`  MALE competitions: ${compByYear.size}`);

  // 2) work list — (year, team_pk, cbba_id)
  const cbbIds = JSON.parse(fs.readFileSync("src/data/cbb-team-ids.json", "utf8")) as Record<string, { id: number }>;
  type Work = { year: number; team_pk: number; cbba_id: number };
  let work: Work[] = [];
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

  // YEARS override
  const yearOverride = process.env.YEARS?.trim();
  if (yearOverride) {
    const keep = new Set(yearOverride.split(",").map((s) => Number(s.trim())).filter(Number.isFinite));
    const before = work.length;
    work = work.filter((w) => keep.has(w.year));
    console.log(`  YEARS override active (${[...keep].join(",")}): ${before} → ${work.length}`);
  }

  // 3) (year, team_pk, normalized name) → bart_player_id
  const bartByKey = new Map<string, number>();
  {
    let from = 0;
    while (true) {
      const { data, error } = await sb.from("players").select("bart_player_id, name, team_id, year").range(from, from + 999);
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

  // 4) optional skip-existing
  if (process.env.SKIP_EXISTING === "1") {
    const have = new Set<string>();
    let f = 0;
    while (true) {
      const { data } = await sb.from("player_on_off_stats").select("team_id, year").range(f, f + 999);
      if (!data || data.length === 0) break;
      for (const r of data) have.add(`${r.year}|${r.team_id}`);
      if (data.length < 1000) break;
      f += 1000;
    }
    const before = work.length;
    work = work.filter((w) => !have.has(`${w.year}|${w.team_pk}`));
    console.log(`  SKIP_EXISTING=1: ${before} → ${work.length}`);
  }

  // 5) sync
  type Row = Database["public"]["Tables"]["player_on_off_stats"]["Insert"];
  type ApiRow = Record<string, unknown> & {
    _id?: string; scope?: string; onOffDiff?: string; isOffense?: boolean;
    playerId?: number; fullName?: string; teamId?: number;
    netRtg?: number; ortg?: number; drtg?: number;
    minsOn?: number; minsOff?: number; minsPct?: number; isQualified?: boolean;
  };

  const t0 = Date.now();
  let inserted = 0, failed = 0, unmatched = 0, i = 0;
  const CHUNK = 500;
  let pending: Row[] = [];

  async function flush() {
    if (pending.length === 0) return;
    const { error } = await sb.from("player_on_off_stats").upsert(pending, { onConflict: "cbba_row_id" });
    if (error) { failed += pending.length; console.log(`  ✗ chunk: ${error.message}`); }
    else inserted += pending.length;
    pending = [];
  }

  for (const w of work) {
    i++;
    const compId = compByYear.get(w.year);
    if (!compId) continue;
    const rows = await throttledGet<ApiRow[]>(
      `/api/gs/on-off-agg-stats?competitionId=${compId}&teamId=${w.cbba_id}`,
    );
    if (!rows || rows.length === 0) continue;

    // Pull only the seasonAll diff row, offense-perspective.
    for (const r of rows) {
      if (r.scope !== "seasonAll") continue;
      if (r.onOffDiff !== "diff") continue;
      if (r.isOffense !== true) continue;
      if (!r._id || !r.playerId || !r.fullName) continue;

      const cbbaPlayerId = Math.trunc(r.playerId);
      const bartId = bartByKey.get(`${w.year}|${w.team_pk}|${normalize(r.fullName)}`) ?? null;
      if (bartId === null) unmatched++;

      pending.push({
        cbba_row_id: String(r._id),
        year: w.year,
        competition_id: compId,
        cbba_player_id: cbbaPlayerId,
        bart_player_id: bartId,
        full_name: String(r.fullName),
        team_id: w.team_pk,
        net_onoff: num(r.netRtg),
        ortg_onoff: num(r.ortg),
        drtg_onoff: num(r.drtg),
        mins_on: num(r.minsOn),
        mins_off: num(r.minsOff),
        mins_pct: num(r.minsPct),
        is_qualified: bool(r.isQualified),
      });
      if (pending.length >= CHUNK) await flush();
    }

    if (i % 50 === 0) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      process.stdout.write(`  ${i}/${work.length} (${elapsed}s, ${inserted} rows so far)\r`);
    }
  }
  await flush();

  const seconds = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n${"═".repeat(60)}`);
  console.log(`Done in ${seconds}s.`);
  console.log(`  team-seasons processed:  ${work.length}`);
  console.log(`  rows inserted:           ${inserted}`);
  console.log(`  rows w/o bart_player_id: ${unmatched}`);
  console.log(`  rows failed:             ${failed}`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
