import type { Context } from "@netlify/functions";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ACTIVE_STATUSES, getSupabaseAdmin, requireAdmin } from "../shared/billing.mts";

/**
 * admin-config — the write side of /admin.
 *
 * Two things an administrator can change without a production deploy: the site
 * banner, and the hand-confirmed transfer list. Both live in Supabase (see
 * supabase/migrations/011_admin_control.sql), both are written only from here,
 * and requireAdmin is what decides whether a write happens. The page's own
 * role check is presentation; this is the boundary.
 *
 * WHY ONE ENDPOINT FOR TWO TABLES. They are the same operation — an
 * administrator editing a small amount of editorial state — and they share
 * every line of the auth, error and CORS handling. Two functions would be two
 * copies of the part that matters and one copy each of the part that does not.
 *
 * READS ARE NOT HERE. The banner is read straight from Supabase by the browser
 * with the anon key, because site_config has a public select policy and a
 * round trip through a function would add latency to every page load for a row
 * that is usually empty. The transfer list IS read here, because
 * manual_transfers has no policies at all and only the service key can see it.
 *
 * GET  ?what=transfers          list the transfers, newest first
 * GET  ?what=banner             read the banner (admins; the site reads direct)
 * GET  ?what=overview           subscriber counts + the Stripe webhook heartbeat
 * POST {what:"banner", value}   set the banner
 * POST {what:"transfer", ...}   add one
 * POST {what:"transfer", id, active}  withdraw or restore one
 */
export const config = { path: "/api/admin-config" };

const TAG = "admin-config";

function bad(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

/** The banner's shape. Anything else in the body is dropped rather than stored. */
type Banner = {
  enabled: boolean;
  message: string;
  /** Drives the colour. Not free text — an unknown tone would render untyped. */
  tone: "info" | "warn";
  href?: string;
  label?: string;
};

function parseBanner(v: unknown): Banner | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const message = typeof o.message === "string" ? o.message.trim() : "";
  // A banner turned on with nothing to say is a strip of colour with no
  // meaning, so it is refused rather than stored and rendered empty.
  if (o.enabled === true && !message) return null;
  if (message.length > 280) return null;
  const tone = o.tone === "warn" ? "warn" : "info";
  const href = typeof o.href === "string" && o.href.trim() ? o.href.trim() : undefined;
  const label = typeof o.label === "string" && o.label.trim() ? o.label.trim() : undefined;
  // A link with no words is not clickable in any useful sense, and words with
  // no link are a promise the banner cannot keep.
  if ((href && !label) || (label && !href)) return null;
  // Relative paths and https only. A banner is the one place on the site whose
  // text an administrator types and every reader sees, so it does not get to
  // point at javascript: or data:.
  if (href && !/^\/(?!\/)/.test(href) && !/^https:\/\//i.test(href)) return null;
  return { enabled: o.enabled === true, message, tone, href, label };
}

export default async function handler(req: Request, _ctx: Context) {
  const gate = await requireAdmin(req, TAG);
  if ("response" in gate) return gate.response;
  const { user } = gate;

  const db = getSupabaseAdmin();
  if (!db) return bad("Not configured on this deploy.", 503);

  if (req.method === "GET") {
    const what = new URL(req.url).searchParams.get("what");
    if (what === "transfers") {
      const { data, error } = await db
        .from("manual_transfers")
        .select("id,player_name,bart_player_id,destination,confirmed_on,note,active,created_at")
        .order("active", { ascending: false })
        .order("confirmed_on", { ascending: false })
        .limit(500);
      if (error) { console.error(`[${TAG}] transfers read:`, error.message); return bad("Could not read the list.", 503); }
      return Response.json({ transfers: data ?? [] });
    }
    if (what === "banner") {
      const { data, error } = await db.from("site_config").select("value").eq("key", "banner").maybeSingle();
      if (error) { console.error(`[${TAG}] banner read:`, error.message); return bad("Could not read the banner.", 503); }
      return Response.json({ banner: (data as { value: unknown } | null)?.value ?? null });
    }
    if (what === "overview") return overview(db);
    return bad("Unknown ?what.");
  }

  if (req.method !== "POST") return bad("Method not allowed.", 405);

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return bad("Body must be JSON."); }

  if (body.what === "banner") {
    const banner = parseBanner(body.value);
    if (!banner) return bad("A banner needs a message under 280 characters, and a link needs both a URL and a label.");
    const { error } = await db
      .from("site_config")
      .upsert({ key: "banner", value: banner, updated_at: new Date().toISOString(), updated_by: user.id });
    if (error) { console.error(`[${TAG}] banner write:`, error.message); return bad("Could not save the banner.", 503); }
    return Response.json({ ok: true, banner });
  }

  if (body.what === "transfer") {
    // Flipping an existing row: withdraw a claim, or put it back.
    if (typeof body.id === "string") {
      if (typeof body.active !== "boolean") return bad("active must be true or false.");
      const { error } = await db.from("manual_transfers").update({ active: body.active }).eq("id", body.id);
      if (error) { console.error(`[${TAG}] transfer flip:`, error.message); return bad("Could not update it.", 503); }
      return Response.json({ ok: true });
    }

    const player_name = typeof body.player_name === "string" ? body.player_name.trim() : "";
    const destination = typeof body.destination === "string" ? body.destination.trim() : "";
    if (!player_name || !destination) return bad("A transfer needs a player and a destination.");
    if (player_name.length > 120 || destination.length > 120) return bad("Too long.");

    /**
     * The id is optional and is NEVER inferred. Two players can share a name —
     * see the index note in the migration — and a guessed id grafts one man's
     * career onto another's row, which is a worse outcome than no id at all.
     * If it is not supplied here it stays null and the pipeline matches by
     * name, exactly as the script this replaces already does.
     */
    const rawId = body.bart_player_id;
    const bart_player_id =
      rawId === undefined || rawId === null || rawId === "" ? null : Number(rawId);
    if (bart_player_id !== null && (!Number.isInteger(bart_player_id) || bart_player_id <= 0)) {
      return bad("Player id must be a positive whole number, or left blank.");
    }

    const row = {
      player_name,
      bart_player_id,
      destination,
      confirmed_on: typeof body.confirmed_on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.confirmed_on)
        ? body.confirmed_on
        : new Date().toISOString().slice(0, 10),
      note: typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null,
      created_by: user.id,
    };
    const { error } = await db.from("manual_transfers").insert(row);
    if (error) {
      // The partial unique index is the likely cause, and "already has a live
      // claim" is a fact about the data rather than a failure of the request.
      if (error.code === "23505") return bad(`${player_name}${bart_player_id ? ` (${bart_player_id})` : ""} already has an active move. Withdraw it first.`, 409);
      console.error(`[${TAG}] transfer insert:`, error.message);
      return bad("Could not add it.", 503);
    }
    return Response.json({ ok: true });
  }

  return bad("Unknown what.");
}

/**
 * The dashboard's numbers — who is paying, and whether Stripe is still talking
 * to us.
 *
 * ONE READ OF THE WHOLE PROFILES TABLE, counted here. Six count queries would
 * be six round trips for a table that fits in memory many times over, and the
 * definitions below (what "cancelling" means, that past_due is still paid)
 * are easier to keep straight in one place than spread across six filters.
 * If the table ever outgrows this, the cap keeps the response bounded and the
 * `truncated` flag says so rather than quietly undercounting.
 *
 * Emails are returned. This is behind requireAdmin, the administrator owns the
 * database, and "who signed up this week" is unanswerable without them.
 */
async function overview(db: SupabaseClient) {
  const CAP = 5000;
  const { data, error } = await db
    .from("profiles")
    .select("email,role,subscription_status,subscription_tier,subscription_cancel_at,created_at")
    .order("created_at", { ascending: false })
    .limit(CAP);
  if (error) { console.error(`[${TAG}] overview read:`, error.message); return bad("Could not read the accounts.", 503); }

  type Row = {
    email: string | null; role: string | null; subscription_status: string | null;
    subscription_tier: string | null; subscription_cancel_at: string | null; created_at: string;
  };
  const rows = (data ?? []) as Row[];
  const now = Date.now();
  const DAY = 86_400_000;
  const since = (days: number) => (r: Row) => now - Date.parse(r.created_at) <= days * DAY;
  const paid = (r: Row) => ACTIVE_STATUSES.has(r.subscription_status ?? "");
  const active = rows.filter(paid);

  const subscribers = {
    accounts: rows.length,
    truncated: rows.length === CAP,
    active: active.length,
    monthly: active.filter((r) => r.subscription_tier === "bta_pro_monthly").length,
    yearly: active.filter((r) => r.subscription_tier === "bta_pro_yearly").length,
    pastDue: active.filter((r) => r.subscription_status === "past_due").length,
    // Still paid today, already told Stripe to stop. The churn you can see coming.
    cancelling: active.filter((r) => r.subscription_cancel_at !== null).length,
    admins: rows.filter((r) => r.role === "admin").length,
    new7d: rows.filter(since(7)).length,
    new30d: rows.filter(since(30)).length,
    paidNew30d: active.filter(since(30)).length,
    recent: rows.slice(0, 10).map((r) => ({
      email: r.email,
      createdAt: r.created_at,
      status: r.subscription_status,
      tier: r.subscription_tier,
      role: r.role,
    })),
  };

  const { data: hb, error: hbErr } = await db
    .from("site_config").select("value").eq("key", "stripe_webhook").maybeSingle();
  if (hbErr) console.error(`[${TAG}] heartbeat read:`, hbErr.message);

  return Response.json({
    at: new Date(now).toISOString(),
    subscribers,
    webhook: (hb as { value: unknown } | null)?.value ?? null,
  });
}
