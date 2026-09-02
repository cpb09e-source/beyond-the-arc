import type { Context } from "@netlify/functions";
import type Stripe from "stripe";
import { getStripe, getSupabaseAdmin, tierFor, isPaidPlan } from "../shared/billing.mts";

/**
 * Stripe's word on what someone has paid for — the only thing that grants
 * access.
 *
 * WHY THIS EXISTS RATHER THAN TRUSTING THE SUCCESS REDIRECT. A browser
 * returning to /account/?checkout=success proves nothing: anyone can type that
 * URL. Access is written here, from an event whose signature proves Stripe
 * sent it, which also means a customer who pays and immediately closes the tab
 * still gets what they paid for.
 *
 * SIGNATURE VERIFICATION IS THE WHOLE SECURITY MODEL. This endpoint is public
 * and writes entitlement with the service role, so without the signature check
 * it would be an open "make me a subscriber" API. The raw body text must be
 * passed to constructEvent unparsed — JSON.parse then re-stringify changes the
 * bytes and the signature will not match.
 *
 * Subscription lifecycle, not just the sale: an expiry, a failed card or a
 * cancellation all arrive here too, so access ends when it should rather than
 * lasting forever after one payment.
 */

/** Statuses Stripe considers live enough to keep access on. */
const LIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") {
    return Response.json({ error: "POST only" }, { status: 405 });
  }

  const stripe = getStripe();
  const admin = getSupabaseAdmin();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripe || !admin || !secret) {
    console.error("[stripe-webhook] not configured", {
      stripe: !!stripe,
      admin: !!admin,
      secret: !!secret,
    });
    return Response.json({ error: "Webhook not configured." }, { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return Response.json({ error: "Missing signature." }, { status: 400 });
  }

  // Raw, unparsed, exactly as sent.
  const raw = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, signature, secret);
  } catch (err) {
    // A bad signature is either a misconfigured secret or someone probing.
    // Either way it is not an event, and nothing is written.
    const message = err instanceof Error ? err.message : "unknown";
    console.error("[stripe-webhook] signature verification failed:", message);
    return Response.json({ error: "Invalid signature." }, { status: 400 });
  }

  let handled = true;
  let failure: string | null = null;
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        // A completed checkout does not carry the subscription's status or
        // period end, so the subscription itself is fetched rather than
        // guessed. The subscription.* events that follow will correct this
        // anyway; doing it here means access starts immediately.
        const subId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id;
        const userId = resolveUserId(session.client_reference_id, session.metadata);
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          await applySubscription(admin, sub, userId);
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await applySubscription(admin, event.data.object, null);
        break;
      }

      default:
        // Everything else is acknowledged and ignored. Returning non-2xx would
        // make Stripe retry events we simply do not act on.
        handled = false;
        break;
    }
  } catch (err) {
    failure = err instanceof Error ? err.message : "unknown";
    console.error(`[stripe-webhook] handling ${event.type} failed:`, failure);
  }

  await recordHeartbeat(admin, event, handled, failure);

  if (failure) {
    // 500 so Stripe retries — a transient database problem should not silently
    // cost someone the access they paid for.
    return Response.json({ error: "Handler failed." }, { status: 500 });
  }
  return Response.json({ received: true });
};

/**
 * Leave a note that Stripe reached us, for the admin page.
 *
 * THE FAILURE THIS CATCHES IS SILENT EVERYWHERE ELSE. If the signing secret is
 * rotated, or the endpoint is disabled in the Stripe dashboard, or a deploy
 * loses the env var, nothing on this site changes: checkouts still complete,
 * Stripe still takes the money, and the profile row is simply never updated.
 * The customer finds out. Stripe's own dashboard shows the failures, but only
 * to someone who goes and looks. This puts "last heard from Stripe: 41 days
 * ago" where it will actually be seen.
 *
 * Written AFTER signature verification and only then, so the note proves the
 * whole chain — endpoint reachable, secret correct, database writable — not
 * merely that something POSTed here. Written on handler failure too, marked,
 * because "Stripe is reaching us and we are failing" is a different problem
 * from "Stripe is not reaching us" and the page should say which.
 *
 * Best-effort: a failed heartbeat is logged and otherwise ignored. It must
 * never turn a successfully applied subscription into a 500 that makes Stripe
 * retry an event we have already acted on.
 *
 * site_config is publicly readable by design (the banner lives there), so this
 * holds nothing worth protecting: a timestamp, an event type and a yes/no.
 */
async function recordHeartbeat(
  admin: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  event: Stripe.Event,
  handled: boolean,
  failure: string | null,
): Promise<void> {
  const value = {
    at: new Date().toISOString(),
    type: event.type,
    handled,
    ok: failure === null,
  };
  const { error } = await admin
    .from("site_config")
    .upsert({ key: "stripe_webhook", value, updated_at: value.at });
  if (error) console.error("[stripe-webhook] heartbeat write failed:", error.message);
}

function resolveUserId(
  clientRef: string | null | undefined,
  metadata: Stripe.Metadata | null | undefined,
): string | null {
  return clientRef || metadata?.supabase_user_id || null;
}

/**
 * Write a subscription's current state onto the matching profile.
 *
 * The account is found by the Supabase id carried in metadata, falling back to
 * the Stripe customer id already stored on the profile. Two routes because the
 * first is exact and the second survives a subscription created outside this
 * flow — from the Stripe dashboard, say.
 */
async function applySubscription(
  admin: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  sub: Stripe.Subscription,
  fallbackUserId: string | null,
): Promise<void> {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const userId = sub.metadata?.supabase_user_id || fallbackUserId || null;

  const live = LIVE_STATUSES.has(sub.status);
  const priceId = sub.items.data[0]?.price?.id ?? null;
  const planMeta = sub.metadata?.plan;
  const interval = sub.items.data[0]?.price?.recurring?.interval;

  // Prefer what checkout recorded; fall back to the price's own interval so a
  // subscription created outside this flow still lands on a sensible tier.
  const plan = isPaidPlan(planMeta)
    ? planMeta
    : interval === "month"
      ? "monthly"
      : "yearly";

  const periodEnd = currentPeriodEnd(sub);

  const patch = {
    subscription_status: sub.status,
    subscription_tier: live ? tierFor(plan) : null,
    subscription_price_id: priceId,
    subscription_renews_at: live && !sub.cancel_at_period_end ? periodEnd : null,
    subscription_cancel_at: sub.cancel_at
      ? new Date(sub.cancel_at * 1000).toISOString()
      : sub.cancel_at_period_end
        ? periodEnd
        : null,
    stripe_customer_id: customerId,
    updated_at: new Date().toISOString(),
  };

  // count belongs to update(), not select() — on a mutation the select() only
  // chooses which columns come back.
  const query = admin.from("profiles").update(patch, { count: "exact" });
  const { error, count } = userId
    ? await query.eq("id", userId).select("id")
    : await query.eq("stripe_customer_id", customerId).select("id");

  if (error) throw new Error(error.message);
  if (!count) {
    // Loud, because this is money that has been taken with no account updated.
    console.error(
      "[stripe-webhook] no profile matched",
      JSON.stringify({ userId, customerId, status: sub.status }),
    );
  }
}

/** Period end moved onto the item in recent API versions; read both. */
function currentPeriodEnd(sub: Stripe.Subscription): string | null {
  const fromItem = sub.items.data[0] as { current_period_end?: number } | undefined;
  const seconds =
    fromItem?.current_period_end ??
    (sub as unknown as { current_period_end?: number }).current_period_end;
  return typeof seconds === "number" ? new Date(seconds * 1000).toISOString() : null;
}

export const config = { path: "/api/stripe-webhook" };
