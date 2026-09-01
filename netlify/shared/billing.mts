/**
 * Shared billing plumbing for the Stripe functions.
 *
 * Lives in netlify/shared rather than netlify/functions because everything in
 * the functions directory is itself deployed as a function; a helper module in
 * there would become a public endpoint.
 *
 * THE TRUST MODEL, stated once so each function does not have to restate it:
 *
 *   1. The browser is never trusted with a price. It sends a plan NAME
 *      ("yearly"), and the price id is looked up here from the environment.
 *      If the client could name a price id it could name a $0 one.
 *   2. The browser is never trusted with an identity. It sends its Supabase
 *      access token, and requireUser() asks Supabase who that actually is.
 *      Taking a user id from the request body would let anyone buy — or
 *      cancel — on someone else's account.
 *   3. Entitlement is only ever written by the webhook, using the service
 *      role, after Stripe has been verified as the sender. The database
 *      already refuses user writes to those columns
 *      (supabase/migrations/010_profiles.sql); this is the other half of that.
 */
import Stripe from "stripe";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** The paid plans, and the env var holding each one's Stripe price id. */
export const PAID_PLANS = {
  monthly: "STRIPE_PRICE_MONTHLY",
  yearly: "STRIPE_PRICE_YEARLY",
} as const;

export type PaidPlan = keyof typeof PAID_PLANS;

export function isPaidPlan(v: unknown): v is PaidPlan {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(PAID_PLANS, v);
}

/** The tier string written to profiles.subscription_tier. Matches the
 *  vocabulary already in the live table ("bta_pro_yearly"). */
export function tierFor(plan: PaidPlan): string {
  return plan === "monthly" ? "bta_pro_monthly" : "bta_pro_yearly";
}

export function priceIdFor(plan: PaidPlan): string | null {
  return process.env[PAID_PLANS[plan]] ?? null;
}

/**
 * The Stripe client, or null when the key is missing or is not an API key.
 *
 * The explicit shape check earns its place: this project's STRIPE_SECRET_KEY
 * has held a `whsec_…` webhook signing secret, which is a plausible-looking
 * string that fails every call with a 401. Catching it here turns a confusing
 * runtime auth error into a clear configuration message.
 */
export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!/^(sk|rk)_/.test(key)) {
    console.error(
      "[billing] STRIPE_SECRET_KEY does not look like an API key" +
        " (expected sk_… or rk_…). A webhook signing secret cannot authenticate API calls.",
    );
    return null;
  }
  return new Stripe(key, { apiVersion: "2026-07-29.dahlia" });
}

/** Service-role Supabase. The only thing permitted to write entitlement. */
export function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export type AuthedUser = { id: string; email: string | null };

/**
 * Establish who is calling, from their bearer token, by asking Supabase.
 *
 * Returns null for anything that does not resolve to a real user. The caller
 * must treat null as 401 and stop — never fall back to a user id from the
 * body.
 */
export async function requireUser(req: Request): Promise<AuthedUser | null> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;

  const client = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

/** Absolute site origin, for Stripe's return URLs. */
export function siteOrigin(req: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  try {
    return new URL(req.url).origin;
  } catch {
    return "https://btacbb.xyz";
  }
}

/**
 * Find this user's Stripe customer, creating one if needed.
 *
 * The id is cached on the profile so a returning subscriber keeps one customer
 * record rather than accumulating a new one per checkout — which would scatter
 * their invoices and break the billing portal.
 */
export async function ensureCustomer(
  stripe: Stripe,
  admin: SupabaseClient,
  user: AuthedUser,
): Promise<string> {
  const { data } = await admin
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle();

  const existing = (data as { stripe_customer_id: string | null } | null)?.stripe_customer_id;
  if (existing) return existing;

  const customer = await stripe.customers.create({
    email: user.email ?? undefined,
    // The Supabase id travels with the customer so the webhook can map an
    // event back to an account even if the profile row is mid-write.
    metadata: { supabase_user_id: user.id },
  });

  await admin
    .from("profiles")
    .update({ stripe_customer_id: customer.id })
    .eq("id", user.id);

  return customer.id;
}

/**
 * Subscription states that count as paid.
 *
 * DELIBERATELY NOT IMPORTED FROM src/lib/auth/membership.ts. That module is
 * client code describing what to SHOW someone; this is the server deciding
 * what to GIVE them. A shared constant across that boundary invites a change
 * made for the dashboard's benefit to quietly widen who gets the data.
 *
 * `past_due` counts as paid on purpose, matching the dashboard: the
 * subscription has not been cancelled, a payment failed and Stripe is
 * retrying. Cutting access at the first failed charge locks out anyone whose
 * card simply expired.
 */
export const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

/**
 * Identity plus entitlement, or the Response to return instead.
 *
 * EXTRACTED SO THERE IS ONE COPY OF THE RULE. season.mts grew this inline, and
 * the moment a second endpoint needed to gate bytes the block was going to be
 * pasted — at which point "who counts as paid" would live in two server files
 * that drift, which is the failure mode nobody notices until someone's card
 * expires and one endpoint keeps working.
 *
 * The distinct statuses matter and are kept distinct: 401 signed-out, 403
 * signed-in-but-unpaid, 503 for a deploy whose service key is missing. A
 * subscriber hitting a misconfigured deploy must not be told they are not
 * entitled — that reads as "you did not pay" to the one person who did.
 */
export async function requirePaid(
  req: Request,
  tag: string,
): Promise<{ user: AuthedUser } | { response: Response }> {
  const user = await requireUser(req);
  if (!user) {
    return {
      response: Response.json(
        { error: "Sign in to read this.", reason: "signed-out" },
        { status: 401 },
      ),
    };
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return {
      response: Response.json(
        { error: "Access checks are not configured on this deploy." },
        { status: 503 },
      ),
    };
  }

  const { data, error } = await admin
    .from("profiles")
    .select("role,subscription_status")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.error(`[${tag}] profile read failed:`, error.message);
    return {
      response: Response.json({ error: "Could not verify your subscription." }, { status: 503 }),
    };
  }

  const profile = data as { role: string | null; subscription_status: string | null } | null;
  const paid =
    profile?.role === "admin" || ACTIVE_STATUSES.has(profile?.subscription_status ?? "");

  if (!paid) {
    return {
      response: Response.json(
        { error: "This is part of the Season Pass.", reason: "not-subscribed" },
        { status: 403 },
      ),
    };
  }

  return { user };
}
