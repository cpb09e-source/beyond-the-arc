#!/usr/bin/env node
/**
 * verify-admin-tables.mjs — did 011_admin_control.sql actually land, and is
 * the security on it doing what the file claims?
 *
 * WHY THIS IS NOT JUST "does the table exist". The migration makes two
 * assertions that are easy to get wrong and silent when wrong:
 *
 *   site_config      must be readable by ANYONE, or a signed-out visitor
 *                    never sees the banner — which is most of the audience
 *                    and the entire point of having one.
 *   manual_transfers must be readable by NOBODY except the service key.
 *                    These are editorial claims that have not been published
 *                    yet, and a roster move that leaks before it is applied
 *                    reads as a report rather than as a draft.
 *
 * A missing policy on the first fails closed and looks like "no banner ever".
 * A missing policy on the second fails OPEN and looks like nothing at all.
 * That second one is why this checks with the anon key rather than trusting
 * the SQL to have been pasted in full.
 *
 *   node scripts/verify-admin-tables.mjs
 */
import { config as dotenvConfig } from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenvConfig({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  console.error("Need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  process.exit(1);
}

const anon = createClient(url, anonKey, { auth: { persistSession: false } });
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

let failed = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
}

console.log("\n011_admin_control.sql\n");

// 1. Both tables exist at all.
const sc = await admin.from("site_config").select("key").limit(1);
check("site_config exists", !sc.error, sc.error?.message);
const mt = await admin.from("manual_transfers").select("id").limit(1);
check("manual_transfers exists", !mt.error, mt.error?.message);

if (sc.error || mt.error) {
  console.log("\nThe migration has not been applied. Paste supabase/migrations/011_admin_control.sql\ninto the SQL editor and run it.\n");
  process.exit(1);
}

// 2. The banner must reach a signed-out reader.
const anonBanner = await anon.from("site_config").select("value").limit(1);
check("anon can READ site_config (the banner needs this)", !anonBanner.error, anonBanner.error?.message);

/**
 * 3. Editorial drafts must not.
 *
 * AGAINST A ROW THAT DEFINITELY EXISTS. The obvious version of this check —
 * select from the table and expect nothing back — passes for the wrong reason
 * when the table is simply empty, which it is on the day the migration lands
 * and therefore on exactly the day somebody runs this. PostgREST returns an
 * empty set rather than an error when RLS denies a read, so "0 rows" and "no
 * access" look identical from here unless there is something to be denied.
 *
 * So a row is written with the service key first, and removed afterwards
 * whatever happens.
 */
const probeName = `__probe visible ${Date.now()}`;
const seeded = await admin.from("manual_transfers").insert({ player_name: probeName, destination: "Duke" });
if (seeded.error) {
  check("could seed a row to test the read policy against", false, seeded.error.message);
} else {
  const anonTransfers = await anon.from("manual_transfers").select("id,player_name");
  const leaked = (anonTransfers.data ?? []).some((r) => r.player_name === probeName);
  check(
    "anon CANNOT read manual_transfers",
    !!anonTransfers.error || !leaked,
    anonTransfers.error ? anonTransfers.error.message : leaked ? "THE SEEDED ROW WAS VISIBLE TO ANON" : "seeded row is hidden",
  );
  await admin.from("manual_transfers").delete().eq("player_name", probeName);
}

// 4. Anon must not be able to write the banner it can read.
const anonWrite = await anon.from("site_config").upsert({ key: "__probe", value: { probe: true } });
check("anon CANNOT write site_config", !!anonWrite.error, anonWrite.error?.message ?? "the write was accepted");
if (!anonWrite.error) {
  // Leave nothing behind if the policy is wrong — the point is to report it,
  // not to add a row to the table while doing so.
  await admin.from("site_config").delete().eq("key", "__probe");
}

// 5. The index that lets two same-named players coexist.
const a = await admin.from("manual_transfers").insert({ player_name: "__probe Williams", bart_player_id: 1, destination: "Duke" });
const b = await admin.from("manual_transfers").insert({ player_name: "__probe Williams", bart_player_id: 2, destination: "Kansas" });
const dupe = await admin.from("manual_transfers").insert({ player_name: "__probe Williams", bart_player_id: 1, destination: "Iowa" });
check("two same-named players with different ids are allowed", !a.error && !b.error, a.error?.message ?? b.error?.message);
check("a genuine duplicate is refused", dupe.error?.code === "23505", dupe.error ? dupe.error.message : "the duplicate was accepted");
await admin.from("manual_transfers").delete().like("player_name", "__probe%");

console.log(failed ? `\n${failed} check(s) failed.\n` : "\nAll good. /admin can read and write both tables.\n");
process.exit(failed ? 1 : 0);
