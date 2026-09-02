import type { Context } from "@netlify/functions";
import {
  ensureCustomer,
  getStripe,
  getSupabaseAdmin,
  isPaidPlan,
  priceIdFor,
  requireUser,
  siteOrigin,
} from "../shared/billing.mts";

/**
 * Start a Stripe Checkout session for the signed-in user.
 *
 * The browser sends only a plan name and its own access token. The price comes
 * from the environment and the identity comes from Supabase — see the trust
 * model in netlify/shared/billing.mts.
 *
 * Returns a URL for the browser to visit. It grants nothing: paying is what
 * grants, and that arrives separately through the webhook, signed by Stripe.
 * A user who completes checkout and closes the tab still gets their
 * subscription, because the entitlement never depended on them coming back.
 */

/**
 * Free trial length, in days. Five, chosen 2026-09-02.
 *
 * THE TRIAL NEEDED NO ENTITLEMENT WORK. `trialing` was already in
 * ACTIVE_STATUSES in billing.mts and in LIVE_STATUSES in the webhook, so a
 * trialing subscriber has always been granted everything a paying one gets.
 * This constant is the whole feature on the server side.
 *
 * A CARD IS STILL COLLECTED UP FRONT. Stripe Checkout in subscription mode
 * takes the payment method before starting the trial, so the charge on day
 * five needs nothing from the customer and there is no separate conversion
 * step. It also means the trial ends by charging rather than by expiring,
 * which is why /terms says so plainly and /account shows the date.
 */
const TRIAL_DAYS = 5;
export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") {
    return Response.json({ error: "POST only" }, { status: 405 });
  }

  const stripe = getStripe();
  if (!stripe) {
    // Explicit rather than a generic 500: this is a deploy-config problem and
    // the message is what tells the operator which one.
    return Response.json(
      { error: "Payments are not configured on this deploy (STRIPE_SECRET_KEY missing or not an API key)." },
      { status: 503 },
    );
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return Response.json(
      { error: "Payments are not configured on this deploy (Supabase service role missing)." },
      { status: 503 },
    );
  }

  const user = await requireUser(req);
  if (!user) {
    return Response.json({ error: "Sign in first." }, { status: 401 });
  }

  let plan: unknown;
  try {
    ({ plan } = await req.json());
  } catch {
    return Response.json({ error: "Body must be JSON." }, { status: 400 });
  }
  if (!isPaidPlan(plan)) {
    return Response.json({ error: "Unknown plan." }, { status: 400 });
  }

  const price = priceIdFor(plan);
  if (!price) {
    return Response.json(
      { error: `Payments are not configured for the ${plan} plan (price id missing).` },
      { status: 503 },
    );
  }

  try {
    const customer = await ensureCustomer(stripe, admin, user);
    const origin = siteOrigin(req);

    /**
     * ONE TRIAL PER CUSTOMER, EVER.
     *
     * trial_period_days is granted per checkout session, not per customer, so
     * without this someone could cancel on day four and re-subscribe for
     * another free five days indefinitely. Asking Stripe whether this customer
     * has ever had a subscription is the authoritative answer and costs one
     * API call — better than a `has_trialed` column, which would be a second
     * source of truth that drifts the first time a subscription is created or
     * deleted from the Stripe dashboard.
     *
     * `status: "all"` matters. A returning customer's old subscription is
     * `canceled`, and the default listing hides exactly the case being checked
     * for.
     *
     * FAILING OPEN IS THE RIGHT DIRECTION. If the lookup throws we grant the
     * trial rather than refusing checkout: the downside is one person getting a
     * second five-day trial, against blocking a paying customer over a
     * transient Stripe error.
     */
    let trialDays: number | undefined = TRIAL_DAYS;
    try {
      const prior = await stripe.subscriptions.list({ customer, status: "all", limit: 1 });
      if (prior.data.length > 0) trialDays = undefined;
    } catch (err) {
      console.warn(
        "[create-checkout-session] trial-eligibility lookup failed, granting trial:",
        err instanceof Error ? err.message : err,
      );
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer,
      line_items: [{ price, quantity: 1 }],
      // Both ids ride along so the webhook can resolve the account without a
      // lookup, and without trusting anything the browser said.
      client_reference_id: user.id,
      subscription_data: {
        metadata: { supabase_user_id: user.id, plan },
        ...(trialDays ? { trial_period_days: trialDays } : {}),
      },
      metadata: { supabase_user_id: user.id, plan },
      success_url: `${origin}/account/?checkout=success`,
      cancel_url: `${origin}/pricing/?checkout=cancelled`,
      allow_promotion_codes: true,
      billing_address_collection: "auto",
    });

    if (!session.url) {
      return Response.json({ error: "Stripe did not return a checkout URL." }, { status: 502 });
    }
    return Response.json({ url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown Stripe error";
    console.error("[create-checkout-session]", message);
    return Response.json({ error: "Could not start checkout." }, { status: 502 });
  }
};

export const config = { path: "/api/create-checkout-session" };
