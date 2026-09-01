#!/usr/bin/env node
/**
 * seed-manual-transfers.mjs — move the hand-confirmed transfer list out of
 * source and into the table the admin page edits.
 *
 * ALREADY RUN, and kept because it is now a repair tool rather than a one-off.
 * Re-running reconciles the table against the batched list in source: it adds
 * anything missing and corrects the destination and date of anything present.
 * That is what fixed the flattened dates described below.
 *
 * IT CARRIES THE DATA ITSELF, and that is the second version of this file.
 *
 * The first parsed the BATCHES array out of patch-portal-manual.mts. That
 * worked right up until the patchers were switched over to the table, at which
 * point the array was deleted and this could no longer find it — the seed
 * became a bootstrap tool with nothing to bootstrap from. It failed loudly
 * rather than seeding an empty list, which is the only reason it was noticed.
 *
 * So the 53 original moves live here now, with the confirmation dates they
 * were entered under. This file IS the fixture: it is what stands a fresh
 * environment up, and what puts the list back if the table is lost.
 *
 * THE DATES ARE NOT DECORATION. The portal table's default sort is on
 * date_entered, and patch-portal-manual's own note says a move stamped with
 * the wrong day sorts as though it had been known for longer than it was. The
 * very first version of this seed stamped all 53 rows with the day it ran,
 * flattening eleven batches spanning 17-28 August into one, which is what the
 * update path below exists to repair.
 *
 *   node scripts/seed-manual-transfers.mjs [--dry]
 */
import { config as dotenvConfig } from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenvConfig({ path: ".env.local" });

const DRY = process.argv.includes("--dry");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  process.exit(1);
}

/**
 * The original hand-confirmed moves: [confirmed_on, player, destination].
 *
 * Recovered from the BATCHES array in patch-portal-manual.mts as it stood at
 * commit c996a00170^, the last commit before that array was deleted. Frozen —
 * new moves are added through /admin, not here. This exists to recreate the
 * starting state, not to be maintained alongside the table.
 */
const MOVES = [
  ["2026-08-17", "BJ Edwards", "Oklahoma"],
  ["2026-08-17", "Kaleb Banks", "Tulsa"],
  ["2026-08-17", "Skyy Clark", "LSU"],
  ["2026-08-17", "Brody Robinson", "Creighton"],
  ["2026-08-17", "Seth Trimble", "Louisville"],
  ["2026-08-17", "Javon Bennett", "Gonzaga"],
  ["2026-08-17", "Amarri Monroe", "Syracuse"],
  ["2026-08-17", "Chendall Weaver", "Houston"],
  ["2026-08-17", "Cameron Fens", "North Carolina"],
  ["2026-08-17", "Jalen Washington", "Tennessee"],
  ["2026-08-17", "L.J. Cason", "Miami FL"],
  ["2026-08-17", "RJ Godfrey", "Arizona"],
  ["2026-08-17", "MJ Collins Jr.", "Cincinnati"],
  ["2026-08-17", "Jahki Howard", "LIU"],
  ["2026-08-17", "Curtis Williams Jr.", "High Point"],
  ["2026-08-17", "Daquan Davis", "LIU"],
  ["2026-08-17", "Chris Johnson", "Oregon St."],
  ["2026-08-17", "Skylar Wicks", "Gonzaga"],
  ["2026-08-17", "Malique Ewin", "Oregon"],
  ["2026-08-17", "Jamichael Stillwell", "Texas Tech"],
  ["2026-08-17", "Tavari Johnson", "Charleston"],
  ["2026-08-17", "Chauncey Wiggins", "Gonzaga"],
  ["2026-08-18", "AJ Storr", "UNLV"],
  ["2026-08-18", "Stephon Payne", "New Mexico St."],
  ["2026-08-18", "Fredrick King", "Creighton"],
  ["2026-08-19", "Reed Bailey", "St. John's"],
  ["2026-08-19", "Braxton Stacker", "UNC Greensboro"],
  ["2026-08-19", "Jordan Pope", "Texas A&M"],
  ["2026-08-19", "Kenny Noland", "Michigan"],
  ["2026-08-20", "Lamar Washington", "Boise St."],
  ["2026-08-20", "Duke Brennan", "Oklahoma"],
  ["2026-08-20", "Jerald Colonel", "FIU"],
  ["2026-08-21", "Jaxon Kohler", "BYU"],
  ["2026-08-21", "Lance Waddles", "Campbell"],
  ["2026-08-21", "Cooper Noard", "Samford"],
  ["2026-08-21", "Treysen Eaglestaff", "UC San Diego"],
  ["2026-08-21", "Kimani Hamilton", "Mississippi St."],
  ["2026-08-22", "Donovan Dent", "LSU"],
  ["2026-08-24", "Mark Mitchell", "Missouri"],
  ["2026-08-24", "Iaroslav Niagu", "Colorado"],
  ["2026-08-25", "Keyshawn Hall", "St. John's"],
  ["2026-08-25", "Nick Townsend", "Stanford"],
  ["2026-08-25", "Corey Stephenson", "Mississippi"],
  ["2026-08-26", "Langston Reynolds", "Northern Colorado"],
  ["2026-08-26", "Dominick Nelson", "Utah Valley"],
  ["2026-08-26", "KC Ibekwe", "Portland St."],
  ["2026-08-27", "Xaivian Lee", "Gonzaga"],
  ["2026-08-27", "Efrem Johnson", "Virginia Tech"],
  ["2026-08-28", "Micah Handlogten", "Mississippi"],
  ["2026-08-28", "Tre Holloman", "Grand Canyon"],
  ["2026-08-28", "Dan Skillings Jr.", "Grand Canyon"],
  ["2026-08-28", "Noah Bolanga", "Abilene Christian"],
  ["2026-08-28", "Maban Jabriel", "Maryland"],
];

const moves = MOVES.map(([confirmed_on, player_name, destination]) => ({
  player_name, destination, confirmed_on,
}));

if (moves.length === 0) {
  console.error("Parsed zero moves — refusing to report success on an empty seed.");
  process.exit(1);
}

const dates = [...new Set(moves.map((m) => m.confirmed_on))].sort();
console.log(`Parsed ${moves.length} moves in ${dates.length} batches (${dates[0]} to ${dates.at(-1)}) from the built-in fixture\n`);

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
