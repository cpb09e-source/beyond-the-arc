/**
 * Membership — reading the profile row, and saying what it means in the words
 * the pricing page uses.
 *
 * The `profiles` table predates this code: it was created by hand against the
 * live database and carries its own vocabulary (`role`, `subscription_tier`
 * values like "bta_pro_yearly"). The pricing page sells Free / Season Pass /
 * Program. Rather than rename live columns underneath a paying subscriber, the
 * translation happens here, in one function, so the database keeps its history
 * and the UI stays consistent with what the customer was actually sold.
 *
 * NOTHING HERE IS A SECURITY BOUNDARY. Every field is read from a row the user
 * can see, and the tier it reports is a label for the dashboard, not a
 * permission. The database already refuses to let a user write `role`,
 * `subscription_tier` or `subscription_status` — verified against the live
 * policy — so entitlement is decided there and by the functions that read it
 * with a service key, never by this file.
 */

/** The profile row as the table actually defines it. */
export type Profile = {
  id: string;
  email: string | null;
  role: string | null;
  stripe_customer_id: string | null;
  subscription_status: string | null;
  subscription_tier: string | null;
  subscription_price_id: string | null;
  subscription_renews_at: string | null;
  subscription_cancel_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

/** The columns the dashboard reads. Selected by name so a later column added
 *  to the table for billing does not silently start shipping to the browser. */
export const PROFILE_COLUMNS =
  "id,email,role,subscription_status,subscription_tier,subscription_renews_at,subscription_cancel_at,created_at";

export type Membership = {
  /** What the plan is called on /pricing. */
  plan: string;
  /** One line describing what the plan currently gets them. */
  blurb: string;
  /** True when a paid plan is live right now. */
  paid: boolean;
  /** Set when the subscription is live and will renew. */
  renewsAt: Date | null;
  /** Set when it is live but already scheduled to stop. */
  cancelAt: Date | null;
  /** Raw status, shown as a chip so a lapsed card is visible rather than implied. */
  status: string;
  /** Staff account — worth showing, because it explains paid access with no Stripe record. */
  staff: boolean;
};

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

function parseDate(v: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Turn a profile row into what the dashboard shows.
 *
 * `past_due` deliberately counts as paid. The subscription has not been
 * cancelled — a payment failed and Stripe is retrying — so cutting access at
 * the first failed charge would lock out someone whose card simply expired.
 * The status chip still says past due, which is the honest way to show it.
 */
export function describeMembership(profile: Profile | null): Membership {
  const status = profile?.subscription_status ?? "inactive";
  const staff = profile?.role === "admin";
  const paid = ACTIVE_STATUSES.has(status) || staff;

  if (!profile) {
    return {
      plan: "Free",
      blurb: "Every player, team and coach page, this season and last.",
      paid: false,
      renewsAt: null,
      cancelAt: null,
      status: "inactive",
      staff: false,
    };
  }

  if (staff && !ACTIVE_STATUSES.has(status)) {
    return {
      plan: "Staff",
      blurb: "Full access, granted by role rather than by subscription.",
      paid: true,
      renewsAt: null,
      cancelAt: null,
      status,
      staff: true,
    };
  }

  if (paid) {
    const tier = profile.subscription_tier ?? "";
    // The live vocabulary is "bta_pro_yearly". Matching on the shape rather
    // than the exact string so a monthly or renamed price does not fall
    // through to "Free" and tell a paying subscriber they have no plan.
    const monthly = /month/i.test(tier);
    return {
      plan: "Season Pass",
      blurb: monthly
        ? "All thirteen seasons, real EPM, lineups and the all-years Win Calculator. Billed monthly."
        : "All thirteen seasons, real EPM, lineups and the all-years Win Calculator.",
      paid: true,
      renewsAt: parseDate(profile.subscription_renews_at),
      cancelAt: parseDate(profile.subscription_cancel_at),
      status,
      staff,
    };
  }

  return {
    plan: "Free",
    blurb: "Every player, team and coach page, this season and last.",
    paid: false,
    renewsAt: null,
    cancelAt: parseDate(profile.subscription_cancel_at),
    status,
    staff: false,
  };
}

/** Human wording for the raw Stripe status. */
export const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  trialing: "Trial",
  past_due: "Payment failed",
  canceled: "Cancelled",
  cancelled: "Cancelled",
  incomplete: "Incomplete",
  inactive: "No subscription",
};

/**
 * Format a billing date.
 *
 * Pinned to UTC, which is not the obvious choice and is the correct one. These
 * timestamps are billing instants written by Stripe, and Stripe states the
 * renewal as a calendar date. Rendering the instant in the viewer's zone moves
 * that date: a subscription renewing at 2027-08-21T00:00Z displays as
 * "August 20" for every reader west of UTC, so the dashboard would disagree
 * with the invoice by a day for most of the United States.
 */
export function formatDay(d: Date | null): string | null {
  if (!d) return null;
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
