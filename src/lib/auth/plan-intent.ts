/**
 * Remembering which tier someone picked, across the account they have to
 * create before they can buy it.
 *
 * The flow is: header "Sign up" → /pricing → pick a tier → create an account →
 * land wherever that tier leads. The selection has to survive the middle step,
 * and a query parameter alone will not do it — the signup page replaces the
 * URL when it redirects, and anyone who reloads or wanders off mid-signup
 * loses it. So the parameter is read once on arrival and parked in
 * sessionStorage, which lasts exactly as long as the tab and never longer.
 *
 * sessionStorage rather than localStorage on purpose: an intent to buy is a
 * fact about this visit. Remembering it for weeks means someone who browsed
 * the pricing page in March gets pushed toward checkout in November.
 *
 * NOTHING HERE GRANTS ANYTHING. This is a breadcrumb for navigation. What a
 * person is entitled to is decided by their profile row, which they cannot
 * write — see supabase/migrations/010_profiles.sql.
 */

import { useEffect, useState } from "react";

export type PlanIntent = "free" | "monthly" | "yearly" | "program";

const KEY = "bta-plan-intent";

const VALID: readonly PlanIntent[] = ["free", "monthly", "yearly", "program"];

function isPlan(v: string | null): v is PlanIntent {
  return v !== null && (VALID as readonly string[]).includes(v);
}

/** Read `?plan=` off the current URL. Returns null when absent or unrecognised. */
export function planFromUrl(): PlanIntent | null {
  if (typeof window === "undefined") return null;
  // Deliberately reading location rather than useSearchParams: under
  // `output: "export"` that hook forces the page into a Suspense boundary at
  // build time, and this is one string on one page.
  const v = new URLSearchParams(window.location.search).get("plan");
  return isPlan(v) ? v : null;
}

export function rememberPlan(plan: PlanIntent): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(KEY, plan);
  } catch {
    // Private mode, or storage disabled. The flow still works; it just forgets,
    // which is the same as someone arriving at signup directly.
  }
}

/** Read the stored intent without consuming it. */
export function peekPlan(): PlanIntent | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.sessionStorage.getItem(KEY);
    return isPlan(v) ? v : null;
  } catch {
    return null;
  }
}

/** Read the stored intent and clear it — for use once the flow has acted on it. */
export function takePlan(): PlanIntent | null {
  const v = peekPlan();
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage.removeItem(KEY);
    } catch {
      /* nothing to clear */
    }
  }
  return v;
}

/**
 * Where a newly created account should land, given what they picked.
 *
 * Free goes straight to the dashboard. A paid pick goes to the dashboard too —
 * carrying a marker, so the dashboard can say what happens next. It does NOT
 * route to a checkout, because there is no checkout: Stripe is not wired up,
 * and sending someone to /pricing/checkout would hand them a 404 at the exact
 * moment they were trying to pay. When checkout exists, this function is the
 * one place that changes.
 */
export function destinationFor(plan: PlanIntent | null): string {
  if (plan === "monthly" || plan === "yearly") return `/account/?plan=${plan}`;
  if (plan === "program") return "/account/?plan=program";
  return "/account/";
}

/** True for the plans that go through Stripe. */
export function isPaidPlan(plan: PlanIntent | null): plan is "monthly" | "yearly" {
  return plan === "monthly" || plan === "yearly";
}

/**
 * Read the tier this visit is about, and optionally park it.
 *
 * Resolved in an effect rather than during render because `planFromUrl()`
 * touches `window`: every page here is prerendered at build time, where that
 * returns null, so reading it during render would hand hydration a different
 * answer than the server produced. The set is deferred by a tick for the same
 * reason it is in auth-provider — resolving synchronously in the effect body
 * cascades a second render before the first has painted.
 *
 * `capture` is true on the pages that are part of the signup flow, which
 * should remember what they were told; false on the dashboard, which only
 * reports what it was handed and should not resurrect a stale intent.
 */
export function usePlanIntent(capture: boolean): PlanIntent | null {
  const [plan, setPlan] = useState<PlanIntent | null>(null);
  useEffect(() => {
    const id = setTimeout(() => {
      const fromUrl = planFromUrl();
      if (capture && fromUrl) rememberPlan(fromUrl);
      setPlan(fromUrl ?? (capture ? peekPlan() : null));
    }, 0);
    return () => clearTimeout(id);
  }, [capture]);
  return plan;
}
