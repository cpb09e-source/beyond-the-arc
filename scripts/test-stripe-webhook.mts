#!/usr/bin/env tsx
/**
 * scripts/test-stripe-webhook.mts — verify the Stripe webhook offline.
 *
 *   npx tsx scripts/test-stripe-webhook.mts
 *
 * NEEDS NO STRIPE ACCOUNT AND NO LIVE KEY. The SDK can generate a valid
 * signature header from any known secret, which is precisely what the endpoint
 * checks, so the security boundary is testable with a made-up secret. That
 * boundary is the whole point: /api/stripe-webhook is public and writes
 * entitlement with the service role, so without signature verification it
 * would be an open "make me a subscriber" endpoint.
 *
 * It DOES talk to the real Supabase project: it creates a throwaway user,
 * drives events at it, and deletes it at the end. Requires
 * NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.
 *
 * Covers: unsigned rejected, forged signature rejected, body-tampered-after-
 * signing rejected, signed event grants access, monthly vs yearly tier,
 * cancel-at-period-end, and outright cancellation removing access.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const WHSEC = "whsec_test_secret_for_local_verification";
process.env.STRIPE_SECRET_KEY = "sk_test_fake_key_never_used_for_api_calls";
process.env.STRIPE_WEBHOOK_SECRET = WHSEC;

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2026-07-29.dahlia" });
const handler = (await import("../netlify/functions/stripe-webhook.mts")).default;

function subscriptionEvent(userId: string, opts: {
  status: string;
  cancelAtPeriodEnd?: boolean;
  interval?: "month" | "year";
}) {
  const periodEnd = Math.floor(Date.parse("2027-03-01T00:00:00Z") / 1000);
  return {
    id: "evt_test_" + Math.random().toString(36).slice(2),
    object: "event",
    type: "customer.subscription.updated",
    api_version: "2026-07-29.dahlia",
    created: Math.floor(Date.parse("2026-08-21T00:00:00Z") / 1000),
    data: {
      object: {
        id: "sub_test_123",
        object: "subscription",
        customer: "cus_test_123",
        status: opts.status,
        cancel_at: null,
        cancel_at_period_end: opts.cancelAtPeriodEnd ?? false,
        metadata: { supabase_user_id: userId, plan: opts.interval === "month" ? "monthly" : "yearly" },
        items: {
          object: "list",
          data: [{
            id: "si_test",
            object: "subscription_item",
            current_period_end: periodEnd,
            price: {
              id: "price_test",
              object: "price",
              recurring: { interval: opts.interval ?? "year" },
            },
          }],
        },
      },
    },
  };
}

function signed(body: string) {
  return stripe.webhooks.generateTestHeaderString({ payload: body, secret: WHSEC });
}

async function call(body: string, sig: string | null) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (sig) headers["stripe-signature"] = sig;
  const res = await handler(
    new Request("https://btacbb.xyz/api/stripe-webhook", { method: "POST", body, headers }),
    {} as never,
  );
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function profileOf(id: string) {
  const { data } = await admin
    .from("profiles")
    .select("subscription_status,subscription_tier,subscription_renews_at,subscription_cancel_at,stripe_customer_id")
    .eq("id", id)
    .maybeSingle();
  return data;
}

const email = `bta-webhook-${Date.now()}@example.com`;
const { data: created, error: cErr } = await admin.auth.admin.createUser({
  email,
  password: "WebhookTest!" + Math.random().toString(36).slice(2),
  email_confirm: true,
});
if (cErr || !created.user) throw new Error("could not create test user: " + cErr?.message);
const uid = created.user.id;
console.log("test user:", email);

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  ok ? pass++ : fail++;
};

// 1. No signature at all.
{
  const body = JSON.stringify(subscriptionEvent(uid, { status: "active" }));
  const r = await call(body, null);
  const p = await profileOf(uid);
  check("unsigned request rejected", r.status === 400, `status ${r.status}`);
  check("unsigned request wrote nothing", p?.subscription_status === "inactive", `status=${p?.subscription_status}`);
}

// 2. A forged signature.
{
  const body = JSON.stringify(subscriptionEvent(uid, { status: "active" }));
  const r = await call(body, "t=1,v1=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef");
  const p = await profileOf(uid);
  check("forged signature rejected", r.status === 400, `status ${r.status}`);
  check("forged signature wrote nothing", p?.subscription_status === "inactive", `status=${p?.subscription_status}`);
}

// 3. A body altered after signing — the classic replay/tamper case.
{
  const original = JSON.stringify(subscriptionEvent(uid, { status: "active" }));
  const sig = signed(original);
  const tampered = original.replace('"status":"active"', '"status":"trialing"');
  const r = await call(tampered, sig);
  check("tampered body rejected", r.status === 400, `status ${r.status}`);
}

// 4. Genuinely signed: access is granted.
{
  const body = JSON.stringify(subscriptionEvent(uid, { status: "active" }));
  const r = await call(body, signed(body));
  const p = await profileOf(uid);
  check("signed event accepted", r.status === 200, `status ${r.status}`);
  check("tier written", p?.subscription_tier === "bta_pro_yearly", `tier=${p?.subscription_tier}`);
  check("status written", p?.subscription_status === "active", `status=${p?.subscription_status}`);
  check("renewal date written", (p?.subscription_renews_at ?? "").startsWith("2027-03-01"), `renews=${p?.subscription_renews_at}`);
  check("customer id linked", p?.stripe_customer_id === "cus_test_123", `cus=${p?.stripe_customer_id}`);
}

// 5. Monthly lands on the monthly tier.
{
  const body = JSON.stringify(subscriptionEvent(uid, { status: "active", interval: "month" }));
  await call(body, signed(body));
  const p = await profileOf(uid);
  check("monthly tier written", p?.subscription_tier === "bta_pro_monthly", `tier=${p?.subscription_tier}`);
}

// 6. Cancel-at-period-end: still active, but shows an end date not a renewal.
{
  const body = JSON.stringify(subscriptionEvent(uid, { status: "active", cancelAtPeriodEnd: true }));
  await call(body, signed(body));
  const p = await profileOf(uid);
  check("cancelling shows an end date", (p?.subscription_cancel_at ?? "").startsWith("2027-03-01"), `cancel_at=${p?.subscription_cancel_at}`);
  check("cancelling clears the renewal", p?.subscription_renews_at === null, `renews=${p?.subscription_renews_at}`);
}

// 7. Cancelled outright: access ends.
{
  const body = JSON.stringify(subscriptionEvent(uid, { status: "canceled" }));
  await call(body, signed(body));
  const p = await profileOf(uid);
  check("cancelled clears the tier", p?.subscription_tier === null, `tier=${p?.subscription_tier}`);
  check("cancelled status recorded", p?.subscription_status === "canceled", `status=${p?.subscription_status}`);
}

await admin.auth.admin.deleteUser(uid);
console.log("cleanup: test user deleted");
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
