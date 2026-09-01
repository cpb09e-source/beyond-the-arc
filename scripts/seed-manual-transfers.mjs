#!/usr/bin/env node
/**
 * seed-manual-transfers.mjs — move the hand-confirmed transfer list out of
 * source and into the table the admin page edits.
 *
 * RUN ONCE, after applying supabase/migrations/011_admin_control.sql.
 *
 * WHAT IT READS. The MOVES array in patch-preview-manual-transfers.mjs, parsed
 * out of the source text rather than imported — importing would execute the
 * script, which rewrites season-preview.json as a side effect of being loaded.
 * That is a real hazard here and not a hypothetical one: the whole reason this
 * project has a data freeze is that a patch script got run by accident.
 *
 * IDEMPOTENT. Every insert is guarded by the partial unique index on active
 * claims, so a second run reports the duplicates and changes nothing. Re-run it
 * freely.
 *
 * IT DOES NOT DELETE THE HARDCODED LIST. That is deliberate and it is the
 * cautious order: seed, check the admin page shows what you expect, then
 * switch the patch scripts over to reading the table, then delete. Deleting
 * first would leave the moves nowhere if the seed turned out to be wrong.
 *
 *   node scripts/seed-manual-transfers.mjs [--dry]
 */
import fs from "node:fs";
import path from "node:path";
import { config as dotenvConfig } from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenvConfig({ path: ".env.local" });

const DRY = process.argv.includes("--dry");
const SRC = path.resolve("scripts/patch-preview-manual-transfers.mjs");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  process.exit(1);
}

const src = fs.readFileSync(SRC, "utf8");
const block = src.match(/const MOVES = \[([\s\S]*?)\n\];/);
if (!block) {
  console.error(`Could not find the MOVES array in ${SRC}. It has been renamed or reshaped — read it and update this parser rather than guessing.`);
  process.exit(1);
}

/**
 * Only two-element string pairs. The array is hand-edited and has carried
 * comments between its entries; a regex over the whole block picks up exactly
 * the rows and ignores the prose around them.
 */
const moves = [...block[1].matchAll(/\[\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\]/g)]
  .map((m) => ({ player_name: m[1], destination: m[2] }));

if (moves.length === 0) {
  console.error("Parsed zero moves — refusing to report success on an empty seed.");
  process.exit(1);
}

console.log(`Parsed ${moves.length} hand-confirmed moves from ${path.basename(SRC)}\n`);
if (DRY) {
  for (const m of moves) console.log(`  ${m.player_name} → ${m.destination}`);
  console.log(`\n--dry: nothing written.`);
  process.exit(0);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

let added = 0, already = 0, failed = 0;
for (const m of moves) {
  const { error } = await sb.from("manual_transfers").insert({
    player_name: m.player_name,
    destination: m.destination,
    note: "Seeded from patch-preview-manual-transfers.mjs",
  });
  if (!error) { added++; continue; }
  if (error.code === "23505") { already++; continue; }
  // 42P01 is "relation does not exist" — the migration has not been applied.
  if (error.code === "42P01") {
    console.error("\nmanual_transfers does not exist. Apply supabase/migrations/011_admin_control.sql first.");
    process.exit(1);
  }
  console.error(`  ${m.player_name}: ${error.message}`);
  failed++;
}

console.log(`added ${added}, already present ${already}, failed ${failed}`);
if (failed) process.exit(1);
console.log("\nCheck /admin, then switch the patch scripts over to reading the table.");
