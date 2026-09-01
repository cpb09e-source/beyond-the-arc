/**
 * manual-transfers.mjs — the hand-confirmed portal moves, from the one place
 * they live.
 *
 * WHAT THIS REPLACES. The same list was hardcoded in TWO scripts:
 * patch-preview-manual-transfers.mjs and patch-portal-manual.mts. Each carried
 * a comment telling whoever edited it to keep the other in step, which is a
 * contract enforced by nothing — a move added to one and not the other leaves
 * the portal table and the team pages disagreeing about where a player is, and
 * neither file is wrong on its own terms. Both now read this.
 *
 * IT THROWS RATHER THAN RETURNING NOTHING. A reachability problem that came
 * back as an empty list would be the worst possible failure here: both callers
 * would run to completion, report success, and publish 53 players at schools
 * they left. There is no sensible default for "the overrides are unavailable",
 * so this refuses instead of guessing, and the caller stops.
 *
 * ONLY ACTIVE ROWS. A withdrawn move is kept in the table on purpose — it
 * records a claim that was believed and then retracted — but it must not be
 * applied. See the migration.
 */
import { config as dotenvConfig } from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenvConfig({ path: ".env.local" });

/**
 * @returns {Promise<Array<{ name: string, bartPlayerId: number|null, destination: string, confirmed: string }>>}
 *   ordered oldest confirmation first, which is the order the portal script's
 *   batching expects and the order a reader scanning the list would assume.
 */
export async function readManualTransfers() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "manual-transfers: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are missing from .env.local.\n" +
      "The hand-confirmed transfer list lives in Supabase now; without it this run would\n" +
      "publish players at the schools they left. Refusing rather than continuing.",
    );
  }

  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await sb
    .from("manual_transfers")
    .select("player_name,bart_player_id,destination,confirmed_on")
    .eq("active", true)
    .order("confirmed_on", { ascending: true })
    .order("player_name", { ascending: true });

  if (error) {
    // 42P01 is the one worth naming: the table is not there at all, which
    // means the migration has not been applied on this machine.
    const hint = error.code === "42P01"
      ? "\nmanual_transfers does not exist — apply supabase/migrations/011_admin_control.sql."
      : "";
    throw new Error(`manual-transfers: could not read the list — ${error.message}${hint}`);
  }

  return (data ?? []).map((r) => ({
    name: r.player_name,
    bartPlayerId: r.bart_player_id ?? null,
    destination: r.destination,
    // The table stores a date; both callers want a timestamp, and midnight is
    // what the hardcoded batches used.
    confirmed: `${r.confirmed_on}T00:00:00`,
  }));
}

/**
 * The same moves grouped the way patch-portal-manual.mts batches them.
 *
 * BATCHED BY DATE, NOT POOLED, and that is load-bearing rather than tidy: the
 * portal table's default sort is on date_entered, so a move confirmed today
 * but stamped with an older batch's date sorts as though it had been known for
 * days — which is the one thing that field is read for.
 */
export async function readManualTransferBatches() {
  const rows = await readManualTransfers();
  const byDate = new Map();
  for (const r of rows) {
    if (!byDate.has(r.confirmed)) byDate.set(r.confirmed, []);
    byDate.get(r.confirmed).push(r);
  }
  return [...byDate.entries()].map(([confirmed, moves]) => ({ confirmed, moves }));
}
