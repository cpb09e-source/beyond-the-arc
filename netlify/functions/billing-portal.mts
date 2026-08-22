import type { Context } from "@netlify/functions";
import {
  getStripe,
  getSupabaseAdmin,
  requireUser,
  siteOrigin,
} from "../shared/billing.mts";

/**
 * A link into Stripe's billing portal, so a subscriber can change their card,
 * see invoices or cancel without emailing anyone.
 *
 * The customer id is read from the caller's own profile rather than taken from
 * the request. Accepting one from the body would hand anybody the ability to
 * open — and cancel — another person's subscription, which is the same class
 * of mistake as trusting a user id.
 *
 * Only ever returns a portal for a customer that already exists. Someone who
 * has never paid has nothing to manage, and creating a customer here would
 * leave empty records behind for every curious click.
 */
export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") {
    return Response.json({ error: "POST only" }, { status: 405 });
  }

  const stripe = getStripe();
  const admin = getSupabaseAdmin();
  if (!stripe || !admin) {
    return Response.json(
      { error: "Billing is not configured on this deploy." },
      { status: 503 },
    );
  }

  const user = await requireUser(req);
  if (!user) {
    return Response.json({ error: "Sign in first." }, { status: 401 });
  }

  const { data } = await admin
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle();

  const customer = (data as { stripe_customer_id: string | null } | null)?.stripe_customer_id;
  if (!customer) {
    return Response.json({ error: "No subscription to manage." }, { status: 404 });
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer,
      return_url: `${siteOrigin(req)}/account/`,
    });
    return Response.json({ url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown Stripe error";
    console.error("[billing-portal]", message);
    return Response.json({ error: "Could not open the billing portal." }, { status: 502 });
  }
};

export const config = { path: "/api/billing-portal" };
