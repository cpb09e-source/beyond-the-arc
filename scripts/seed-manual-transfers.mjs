#!/usr/bin/env node
/**
 * seed-manual-transfers.mjs — move the hand-confirmed transfer list out of
 * source and into the table the admin page edits.
 *
 * RUN ONCE, after applying supabase/migrations/011_admin_control.sql. Safe to
 * re-run: see the update path below.
 *
 * IT READS patch-portal-manual.mts, NOT THE PREVIEW SCRIPT. They hold the same
 * 53 moves, but only this one carries the DATES — it batches them by
 * confirmation day because the portal table sorts on date_entered, and a move
 * stamped with the wrong day sorts as though it had been known for longer than
 * it was. The preview script has a flat list with no dates at all.
 *
 * That distinction was learned the expensive way. The first version of this
 * seeded from the flat list and stamped all 53 rows with the day the seed ran,
 * collapsing eleven batches spanning 17-28 August into a single date. The
 * update path exists to repair exactly that.
 *
 * WHY IT PARSES THE SOURCE INSTEAD OF IMPORTING IT. Importing would execute
 * the script, and these scripts rewrite data files as a side effect of being
 * loaded. That is not hypothetical here: this project has a data freeze
 * because a patch script got run by accident.
 *
 * IT DOES NOT DELETE THE HARDCODED LISTS. Cautious order: seed, check the
 * admin page, switch the scripts to read the table, then delete. Deleting
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
const SRC = path.resolve("scripts/patch-portal-manual.mts");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  process.exit(1);
}

const src = fs.readFileSync(SRC, "utf8");
const block = src.match(/const BATCHES[\s\S]*?\n\];/);
if (!block) {
  console.error(`Could not find the BATCHES array in ${SRC}. It has been renamed or reshaped — read it and update this parser rather than guessing.`);
  process.exit(1);
}

/**
 * Each batch is a confirmation date and its moves. Only two-element string
 * pairs count: the arrays are hand-edited and carry comments between their
 * entries, so a regex over the block picks up the rows and ignores the prose.
 */
const moves = [];
for (const b of block[0].matchAll(/confirmed:\s*"([^"]+)"[\s\S]*?moves:\s*\[([\s\S]*?)\n\s*\],/g)) {
  const confirmed_on = b[1].slice(0, 10);
  for (const m of b[2].matchAll(/\[\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\]/g)) {
    moves.push({ player_name: m[1], destination: m[2], confirmed_on });
  }
}

if (moves.length === 0) {
  console.error("Parsed zero moves — refusing to report success on an empty seed.");
  process.exit(1);
}

const dates = [...new Set(moves.map((m) => m.confirmed_on))].sort();
console.log(`Parsed ${moves.length} moves in ${dates.length} batches (${dates[0]} to ${dates.at(-1)}) from ${path.basename(SRC)}\n`);

if (DRY) {
  for (const m of moves) console.log(`  ${m.confirmed_on}  ${m.player_name} → ${m.destination}`);
  console.log(`\n--dry: nothing written.`);
  process.exit(0);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

let added = 0, updated = 0, failed = 0;
for (const m of moves) {
  const { error } = await sb.from("manual_transfers").insert({
    player_name: m.player_name,
    destination: m.destination,
    confirmed_on: m.confirmed_on,
  });
  if (!error) { added++; continue; }

  /**
   * Already present, from an earlier run — possibly with the wrong date.
   * Correcting it in place is the whole reason a re-run does anything at all
   * rather than reporting a no-op and leaving the flattened dates behind.
   */
  if (error.code === "23505") {
    const { error: upd } = await sb
      .from("manual_transfers")
      .update({ destination: m.destination, confirmed_on: m.confirmed_on })
      .eq("player_name", m.player_name)
      .eq("active", true);
    if (upd) { console.error(`  ${m.player_name}: ${upd.message}`); failed++; }
    else updated++;
    continue;
  }

  if (error.code === "42P01") {
    console.error("\nmanual_transfers does not exist. Apply supabase/migrations/011_admin_control.sql first.");
    process.exit(1);
  }
  console.error(`  ${m.player_name}: ${error.message}`);
  failed++;
}

console.log(`added ${added}, corrected in place ${updated}, failed ${failed}`);
if (failed) process.exit(1);
