import { getSupabaseBrowser } from "./supabase-browser";

/**
 * Handing off to Stripe.
 *
 * Both calls send the user's access token and nothing else that matters: the
 * price and the identity are both resolved on the server (see
 * netlify/shared/billing.mts). Nothing here decides what anyone is entitled
 * to — it opens a payment page and returns.
 */

async function authedPost(path: string, body: unknown): Promise<{ url: string }> {
  const supabase = getSupabaseBrowser();
  if (!supabase) throw new Error("Accounts are unavailable right now.");

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in first.");

  const res = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  // A 404 here means the function is not being served — in practice, the page
  // was opened on Next's own port. `npm run dev` runs Next on 3000 and a proxy
  // on 8899, and only the proxy serves netlify/functions, so :3000 looks like
  // a working site where payment is mysteriously broken.
  if (res.status === 404) {
    throw new Error(
      "Payments are not served on this port. Open http://localhost:8899 — port 3000 is Next on its own, with no functions.",
    );
  }

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.error || `Checkout failed (${res.status}).`);
  if (!payload?.url) throw new Error("No checkout URL was returned.");
  return payload as { url: string };
}

/** Send the user to Stripe Checkout for the given plan. */
export async function startCheckout(plan: "monthly" | "yearly"): Promise<void> {
  const { url } = await authedPost("/api/create-checkout-session", { plan });
  window.location.assign(url);
}

/** Send the user to Stripe's billing portal to manage or cancel. */
export async function openBillingPortal(): Promise<void> {
  const { url } = await authedPost("/api/billing-portal", {});
  window.location.assign(url);
}
