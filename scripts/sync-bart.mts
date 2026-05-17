/**
 * sync-bart.mts — pulls Bart Torvik's bulk CSVs and upserts to Supabase.
 *
 * Run with: npm run sync:bart
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY in .env.local (bypasses RLS).
 *
 * Sources:
 *   - Team T-Rank:        https://barttorvik.com/{year}_team_results.csv      (has header)
 *   - Player advanced:    https://barttorvik.com/getadvstats.php?year={year}&csv=1   (NO header)
 *
 * The player CSV's column layout is undocumented; the script stashes the full
 * row as JSONB in player_bart_stats.raw_row and extracts only the columns
 * verified against known-player ground truth (Name, School, Conf, Games, Class,
 * Height, Year, PlayerID, Hometown, Notes, Projection, DOB).
 */

import { config as loadEnv } from "dotenv";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/database.types.ts";

// .env.local is Next's convention but isn't auto-loaded by dotenv. Load it
// explicitly so `npm run sync:bart` works without --env-file flags.
loadEnv({ path: ".env.local" });

const YEARS = [
  2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020,
  2021, 2022, 2023, 2024, 2025, 2026,
] as const;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Add them to .env.local."
  );
  process.exit(1);
}
const sb = createClient<Database>(url, serviceKey, {
  auth: { persistSession: false },
});

// ---------- helpers ----------
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, " ")     // punct → space
    .trim()
    .replace(/\s+/g, " ");
}

function num(x: unknown): number | null {
  if (x === null || x === undefined) return null;
  const s = String(x).trim();
  if (s === "" || s === "NA" || s === "null") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function int(x: unknown): number | null {
  const n = num(x);
  return n === null ? null : Math.trunc(n);
}

function parseRecord(rec: string | null | undefined): { wins: number | null; losses: number | null } {
  if (!rec) return { wins: null, losses: null };
  const m = rec.trim().match(/^(\d+)-(\d+)$/);
  if (!m) return { wins: null, losses: null };
  return { wins: Number(m[1]), losses: Number(m[2]) };
}

function logHeader(label: string) {
  console.log(`\n${"─".repeat(60)}\n${label}\n${"─".repeat(60)}`);
}

// ---------- TEAM CSV ----------
type RawTeamRow = {
  rank: string;
  team: string;
  conf: string;
  record: string;
  adjoe: string;
  "oe Rank": string;
  adjde: string;
  "de Rank": string;
  barthag: string;
  "proj. W": string;
  "Proj. L": string;
  "Pro Con W": string;
  "Pro Con L": string;
  "Con Rec.": string;
  sos: string;
  ncsos: string;
  consos: string;
  WAB: string;
  "WAB Rk": string;
  adjt: string;
  FUN: string;
  "Fun Rk": string;
  "Qual O": string;
  "Qual D": string;
  "Qual Barthag": string;
  ConOE: string;
  ConDE: string;
  "Conf Win%": string;
};

async function syncTeamsForYear(year: number): Promise<Map<string, number> | null> {
  const url = `https://barttorvik.com/${year}_team_results.csv`;
  process.stdout.write(`  teams ${year}: fetching ${url} ... `);
  const res = await fetch(url);
  if (!res.ok) {
    console.log(`skip (HTTP ${res.status})`);
    return null;
  }
  const text = await res.text();
  // duplicate column name "rank" — disable the safety check so csv-parse keeps the first
  const rows = parse(text, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  }) as RawTeamRow[];
  console.log(`parsed ${rows.length} teams`);

  // Upsert teams first
  const teamUpserts = rows.map((r) => ({
    year,
    name: r.team.trim(),
    name_normalized: normalize(r.team),
    conference: r.conf?.trim() || null,
  }));
  const { error: teamErr } = await sb
    .from("teams")
    .upsert(teamUpserts, { onConflict: "year,name" });
  if (teamErr) throw new Error(`teams upsert (${year}): ${teamErr.message}`);

  // Reload team IDs so we can join to stats
  const { data: teamIds, error: lookupErr } = await sb
    .from("teams")
    .select("id, name_normalized")
    .eq("year", year);
  if (lookupErr) throw new Error(`team id lookup (${year}): ${lookupErr.message}`);
  const teamIdByNormName = new Map<string, number>();
  for (const t of teamIds ?? []) teamIdByNormName.set(t.name_normalized, t.id);

  // Upsert T-Rank stats
  const statUpserts = rows
    .map((r) => {
      const teamId = teamIdByNormName.get(normalize(r.team));
      if (!teamId) return null;
      const { wins, losses } = parseRecord(r.record);
      return {
        team_id: teamId,
        year,
        rank: int(r.rank),
        record: r.record?.trim() || null,
        wins,
        losses,
        adjoe: num(r.adjoe),
        oe_rank: int(r["oe Rank"]),
        adjde: num(r.adjde),
        de_rank: int(r["de Rank"]),
        barthag: num(r.barthag),
        proj_w: num(r["proj. W"]),
        proj_l: num(r["Proj. L"]),
        proj_con_w: num(r["Pro Con W"]),
        proj_con_l: num(r["Pro Con L"]),
        conf_record: r["Con Rec."]?.trim() || null,
        sos: num(r.sos),
        ncsos: num(r.ncsos),
        consos: num(r.consos),
        wab: num(r.WAB),
        wab_rank: int(r["WAB Rk"]),
        adjt: num(r.adjt),
        fun: num(r.FUN),
        fun_rank: int(r["Fun Rk"]),
        qual_o: num(r["Qual O"]),
        qual_d: num(r["Qual D"]),
        qual_barthag: num(r["Qual Barthag"]),
        conf_oe: num(r.ConOE),
        conf_de: num(r.ConDE),
        conf_win_pct: num(r["Conf Win%"]),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const { error: statErr } = await sb
    .from("team_trank_stats")
    .upsert(statUpserts, { onConflict: "team_id" });
  if (statErr) throw new Error(`team_trank_stats upsert (${year}): ${statErr.message}`);

  console.log(`  teams ${year}: upserted ${teamUpserts.length} teams + ${statUpserts.length} stat rows`);
  return teamIdByNormName;
}

// ---------- PLAYER CSV ----------
// CSV has no header. Verified columns by position against Cooper Flagg (2025):
//   0 name | 1 school | 2 conference | 3 games | 25 class | 26 height
//   31 year | 32 bart_player_id | 33 hometown
//   notes is 3rd-from-last (string), projection is 2nd-from-last (number), DOB is last (YYYY-MM-DD)
//
// All other columns are stashed in raw_row for later promotion.
const COL = {
  name: 0,
  school: 1,
  conference: 2,
  games: 3,
  class: 25,
  height: 26,
  year: 31,
  player_id: 32,
  hometown: 33,
} as const;

async function syncPlayersForYear(year: number, teamMap: Map<string, number>) {
  const url = `https://barttorvik.com/getadvstats.php?year=${year}&csv=1`;
  process.stdout.write(`  players ${year}: fetching ${url} ... `);
  const res = await fetch(url);
  if (!res.ok) {
    console.log(`skip (HTTP ${res.status})`);
    return;
  }
  const text = await res.text();
  const rows = parse(text, {
    columns: false,
    skip_empty_lines: true,
    relax_column_count: true,
  }) as string[][];
  console.log(`parsed ${rows.length} players`);

  // Step 1: upsert player identity rows
  const playerUpserts: Array<{
    year: number;
    team_id: number;
    bart_player_id: number | null;
    name: string;
    name_normalized: string;
    class: string | null;
    height: string | null;
    hometown: string | null;
  }> = [];
  const rowsByPlayerKey: Map<string, string[]> = new Map();
  let unmatchedTeams = 0;

  for (const r of rows) {
    const teamId = teamMap.get(normalize(r[COL.school] ?? ""));
    if (!teamId) {
      unmatchedTeams++;
      continue;
    }
    const name = (r[COL.name] ?? "").trim();
    if (!name) continue;
    playerUpserts.push({
      year,
      team_id: teamId,
      bart_player_id: int(r[COL.player_id]),
      name,
      name_normalized: normalize(name),
      class: r[COL.class]?.trim() || null,
      height: r[COL.height]?.trim() || null,
      hometown: r[COL.hometown]?.trim() || null,
    });
    rowsByPlayerKey.set(`${year}|${teamId}|${name}`, r);
  }

  if (unmatchedTeams > 0) {
    console.log(`  players ${year}: ${unmatchedTeams} rows skipped — team not in team CSV`);
  }

  // Supabase has a row limit per upsert; chunk to be safe
  const CHUNK = 500;
  for (let i = 0; i < playerUpserts.length; i += CHUNK) {
    const slice = playerUpserts.slice(i, i + CHUNK);
    const { error } = await sb
      .from("players")
      .upsert(slice, { onConflict: "year,team_id,name" });
    if (error) throw new Error(`players upsert ${year} chunk ${i}: ${error.message}`);
  }

  // Step 2: reload player IDs so we can attach stats. Supabase caps
  // `.select()` at 1000 rows by default; paginate explicitly so we don't
  // silently drop 4000+ players per year.
  const playerIdByKey = new Map<string, number>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error: pidErr } = await sb
      .from("players")
      .select("id, team_id, name")
      .eq("year", year)
      .range(from, from + PAGE - 1);
    if (pidErr) throw new Error(`player id lookup (${year}): ${pidErr.message}`);
    if (!data || data.length === 0) break;
    for (const p of data) {
      playerIdByKey.set(`${year}|${p.team_id}|${p.name}`, p.id);
    }
    if (data.length < PAGE) break;
  }

  // Step 3: build stat rows — raw_row carries the full CSV row
  const statRows: Array<{
    player_id: number;
    year: number;
    games: number | null;
    notes: string | null;
    projection: number | null;
    raw_row: (string | number | null)[];
  }> = [];

  for (const [key, r] of rowsByPlayerKey.entries()) {
    const playerId = playerIdByKey.get(key);
    if (!playerId) continue;
    const lastIdx = r.length - 1;
    statRows.push({
      player_id: playerId,
      year,
      games: int(r[COL.games]),
      notes: r[lastIdx - 2]?.trim() || null,
      projection: num(r[lastIdx - 1]),
      raw_row: r.map((v) => {
        // Try to coerce numeric strings to numbers so the JSONB is searchable
        if (v === "" || v === null) return null;
        const n = Number(v);
        return Number.isFinite(n) && String(n) === v.trim() ? n : v;
      }),
    });
  }

  for (let i = 0; i < statRows.length; i += CHUNK) {
    const slice = statRows.slice(i, i + CHUNK);
    const { error } = await sb
      .from("player_bart_stats")
      .upsert(slice, { onConflict: "player_id" });
    if (error) throw new Error(`player_bart_stats upsert ${year} chunk ${i}: ${error.message}`);
  }
  console.log(`  players ${year}: upserted ${playerUpserts.length} players + ${statRows.length} stat rows`);
}

// ---------- MAIN ----------
async function main() {
  console.log(`Bart Torvik sync → ${url}`);
  const t0 = Date.now();
  let totalInserted = 0;
  let totalErrors = 0;

  // Allow env override: YEARS=2013,2014,2015 npm run sync:bart
  const yearOverride = process.env.YEARS?.trim();
  const yearsToSync: readonly number[] = yearOverride
    ? yearOverride.split(",").map((s) => Number(s.trim())).filter(Number.isFinite)
    : YEARS;
  if (yearOverride) console.log(`  YEARS override active: ${yearsToSync.join(",")}`);

  // Idempotently seed the `seasons` reference table for every year we plan to
  // sync. `teams.year` has an FK to seasons(year); without this, brand-new
  // years fail upsert with a foreign-key violation (which is what bit us
  // when extending coverage back to 2012-13).
  const seasonRows = yearsToSync.map((y) => ({
    year: y,
    label: `${y - 1}-${String(y).slice(-2)}`,
  }));
  {
    const { error } = await sb.from("seasons").upsert(seasonRows, { onConflict: "year" });
    if (error) console.warn(`  ⚠ seasons upsert: ${error.message}`);
    else console.log(`  seeded seasons: ${seasonRows.map((s) => s.year).join(",")}`);
  }

  for (const year of yearsToSync) {
    logHeader(`Year ${year} (${year - 1}-${String(year).slice(-2)})`);
    try {
      const teamMap = await syncTeamsForYear(year);
      if (teamMap) {
        await syncPlayersForYear(year, teamMap);
        totalInserted++;
      }
    } catch (err) {
      console.error(`  ✗ ${year} failed: ${err instanceof Error ? err.message : String(err)}`);
      totalErrors++;
    }
  }

  const seconds = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n${"═".repeat(60)}`);
  console.log(`Done in ${seconds}s — ${totalInserted} years synced, ${totalErrors} failed.`);

  // Best-effort sync log row
  await sb.from("sync_runs").insert({
    source: "bart",
    year: yearsToSync[yearsToSync.length - 1] ?? YEARS[YEARS.length - 1],
    rows_inserted: totalInserted,
    rows_updated: 0,
    notes: `${totalInserted} years synced, ${totalErrors} failures`,
  });
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
