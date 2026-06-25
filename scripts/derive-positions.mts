/**
 * derive-positions.mts — fills missing Bart position notes for 2008-2009.
 *
 * Bart Torvik's player CSV only carries a position note ("Wing G", "Stretch 4",
 * "PF/C", …) from 2010 onward. The 2008 + 2009 seasons have none, which leaves
 * those players without a position bucket (no ranking-cohort placement, no 32-0
 * eligibility). We fill the gap two ways, in order:
 *
 *   1. CARRY-FORWARD — if the same bart_player_id has a real note in any other
 *      year (almost always a 2010+ season), reuse it. ~63% of 2009 players.
 *   2. HEIGHT-BAND fallback — derive from listed height, with dual-eligibility
 *      bands so boundary guys can fill two buckets in the 32-0 draft:
 *        ≤6'3"  -> G/F   (guard, also forward)
 *        6'4-6'5-> F/G   (forward, also guard)
 *        6'6-6'8-> Wing F(forward)
 *        6'9"   -> C/F   (center, also forward)
 *        ≥6'10" -> C     (center)
 *      Unknown height -> Combo G.
 *
 * The derived note is written to BOTH player_bart_stats.notes AND raw_row[64]
 * (Bart's note slot, 3rd-from-last in a 67-col row) so every downstream reader
 * — whether it reads the `notes` column or indexes raw_row — sees it.
 *
 * Idempotent: only touches 2008-2009 rows whose note is still empty. The new
 * dual notes (G/F, F/G, C/F) are added to BUCKET_BY_NOTE in:
 *   - scripts/lib/bta-prtg.mts, scripts/compute-player-ranks.mts
 *   - src/components/teams/team-page-view.tsx, src/components/players/players-client.tsx
 *   - scripts/build-thirty-two-zero-index.mjs (alt-bucket handling)
 *
 * Run: npm run derive:positions        (writes)
 *      DRY=1 npm run derive:positions   (prints a summary, no writes)
 */

import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/database.types.ts";

loadEnv({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  process.exit(1);
}
const sb = createClient<Database>(url, serviceKey, { auth: { persistSession: false } });

const DRY = process.env.DRY === "1";
const TARGET_YEARS = new Set([2008, 2009]);
const NOTE_IDX = 64; // raw_row position note (3rd-from-last in a 67-col row)

function heightInches(h: string | null): number | null {
  const m = /(\d+)-(\d+)/.exec(h ?? "");
  return m ? Number(m[1]) * 12 + Number(m[2]) : null;
}
// Height-band note with dual-eligibility (see header).
function heightNote(inches: number | null): string {
  if (inches == null) return "Combo G";
  if (inches <= 75) return "G/F";   // ≤6'3
  if (inches <= 77) return "F/G";   // 6'4-6'5
  if (inches <= 80) return "Wing F"; // 6'6-6'8
  if (inches <= 81) return "C/F";   // 6'9
  return "C";                        // ≥6'10
}

type StatRow = {
  player_id: number;
  year: number;
  games: number | null;
  notes: string | null;
  projection: number | null;
  raw_row: (string | number | null)[] | null;
};

async function pageAll<T>(
  table: string,
  columns: string,
  orderCol: string,
): Promise<T[]> {
  const out: T[] = [];
  const PAGE = 1000;
  // Order is REQUIRED: range pagination without a stable sort lets Postgres
  // return the same row on two pages (and skip others), which then breaks the
  // upsert with "ON CONFLICT cannot affect row a second time".
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from(table)
      .select(columns)
      .order(orderCol, { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table} select: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...(data as T[]));
    if (data.length < PAGE) break;
  }
  return out;
}

async function main() {
  console.log(`🧭 derive-positions ${DRY ? "(DRY RUN — no writes)" : "(writing to Supabase)"}\n`);

  console.log("📥 loading players (id → bart_player_id, height)…");
  const players = await pageAll<{ id: number; bart_player_id: number | null; height: string | null }>(
    "players",
    "id, bart_player_id, height",
    "id",
  );
  const metaById = new Map(players.map((p) => [p.id, p]));
  console.log(`   ${players.length.toLocaleString()} player rows`);

  console.log("📥 loading player_bart_stats…");
  const stats = await pageAll<StatRow>(
    "player_bart_stats",
    "player_id, year, games, notes, projection, raw_row",
    "player_id",
  );
  console.log(`   ${stats.length.toLocaleString()} stat rows`);

  // Carry map: bart_player_id → first real note seen in any year.
  const carry = new Map<number, string>();
  for (const s of stats) {
    const note = (s.notes ?? "").trim();
    if (!note) continue;
    const bid = metaById.get(s.player_id)?.bart_player_id;
    if (bid != null && !carry.has(bid)) carry.set(bid, note);
  }
  console.log(`   carry-forward source notes: ${carry.size.toLocaleString()} players\n`);

  let viaCarry = 0, viaHeight = 0;
  const dist: Record<string, number> = {};
  const updates: StatRow[] = [];
  const samples: string[] = [];

  for (const s of stats) {
    if (!TARGET_YEARS.has(s.year)) continue;
    if ((s.notes ?? "").trim()) continue; // already has one — idempotent skip
    const meta = metaById.get(s.player_id);
    const bid = meta?.bart_player_id ?? null;

    let note: string, src: string;
    if (bid != null && carry.has(bid)) { note = carry.get(bid)!; src = "carry"; viaCarry++; }
    else { note = heightNote(heightInches(meta?.height ?? null)); src = "height"; viaHeight++; }
    dist[note] = (dist[note] ?? 0) + 1;

    const raw = Array.isArray(s.raw_row) ? [...s.raw_row] : null;
    if (raw) { while (raw.length <= NOTE_IDX) raw.push(null); raw[NOTE_IDX] = note; }
    updates.push({ ...s, notes: note, raw_row: raw });
    if (samples.length < 10) samples.push(`  ${meta?.height ?? "?"} ${bid} -> ${note} [${src}]`);
  }

  console.log(`derived ${updates.length.toLocaleString()} positions (${viaCarry.toLocaleString()} carry / ${viaHeight.toLocaleString()} height)`);
  console.log("note distribution:", dist);
  console.log("samples:\n" + samples.join("\n"));

  if (DRY) { console.log("\n(dry run — nothing written)"); return; }

  // Dedup by player_id so no chunk updates the same conflict key twice.
  const deduped = [...new Map(updates.map((u) => [u.player_id, u])).values()];
  console.log(`\n💾 upserting ${deduped.length.toLocaleString()} rows…`);
  const CHUNK = 500;
  for (let i = 0; i < deduped.length; i += CHUNK) {
    const slice = deduped.slice(i, i + CHUNK);
    const { error } = await sb.from("player_bart_stats").upsert(slice, { onConflict: "player_id" });
    if (error) throw new Error(`upsert chunk ${i}: ${error.message}`);
    process.stdout.write(`   ${Math.min(i + CHUNK, deduped.length)}/${deduped.length}\r`);
  }
  console.log(`\n✓ done.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
