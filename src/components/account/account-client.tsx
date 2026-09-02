"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/lib/auth/auth-provider";
import { describeMembership, formatDay, STATUS_LABEL } from "@/lib/auth/membership";
import { isPaidPlan, usePlanIntent } from "@/lib/auth/plan-intent";
import { openBillingPortal, startCheckout } from "@/lib/auth/checkout";
import { cn } from "@/lib/utils";

/**
 * The account dashboard.
 *
 * Everything here is read from the profile row the signed-in user is allowed
 * to see. It reports membership; it does not grant it — the database refuses
 * user writes to role, tier and status, so nothing shown here can be talked
 * into being true by editing the page.
 *
 * There is deliberately no usage meter for Ask the Calculator. The quota is
 * real and sold on the pricing page, but nothing counts calls yet, and a
 * dashboard that displayed "0 of 300 used" would be inventing a number that
 * happens to look right on a new account and would be wrong for everyone else.
 * The entitlement is shown; the counter arrives when there is something behind
 * it.
 */
export function AccountClient() {
  const { status, session, profile, profileLoading, signOut } = useAuth();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingErr, setBillingErr] = useState<string | null>(null);
  // Set when they arrived here straight from picking a tier on /pricing.
  const chosen = usePlanIntent(false);

  if (status === "loading") {
    return (
      <Wrap>
        <div className="h-7 w-40 rounded bg-paper-deep animate-pulse" />
        <div className="mt-6 h-40 rounded-xl border border-hairline bg-paper-deep/40 animate-pulse" />
      </Wrap>
    );
  }

  if (status === "signedOut") {
    return (
      <Wrap>
        <h1 className="font-display text-2xl sm:text-3xl tracking-tight text-ink">Your account</h1>
        <p className="mt-2 text-sm text-ink-soft leading-relaxed">
          Sign in to see your membership.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/account/login/"
            className="h-11 inline-flex items-center rounded px-5 text-sm font-semibold bg-coral text-accent-foreground hover:bg-coral-soft transition-colors"
          >
            Sign in
          </Link>
          <Link
            href="/account/signup/"
            className="h-11 inline-flex items-center rounded px-5 text-sm font-semibold border border-ink/15 text-ink hover:bg-paper-deep transition-colors"
          >
            Create a free account
          </Link>
        </div>
      </Wrap>
    );
  }

  const m = describeMembership(profile);
  const email = profile?.email ?? session?.user?.email ?? "—";
  const memberSince = formatDay(profile?.created_at ? new Date(profile.created_at) : null);
  const renews = formatDay(m.renewsAt);
  const cancels = formatDay(m.cancelAt);

  async function onSignOut() {
    setSigningOut(true);
    await signOut();
    router.push("/");
  }

  return (
    <Wrap>
      <header>
        <span className="label" style={{ color: "var(--coral)" }}>Account</span>
        <h1 className="mt-2 font-display text-2xl sm:text-3xl tracking-tight text-ink">
          {email}
        </h1>
        {memberSince && (
          <p className="mt-1.5 text-sm text-ink-muted">Member since {memberSince}</p>
        )}
      </header>

      {/* Carrying the choice through to payment.
          They picked a paid tier and created an account; this is the step that
          takes them to Stripe. It is a button on a page they own rather than
          an automatic redirect off-site, because being thrown straight at a
          card form by a page you have never seen is how people bounce.

          Only shown when what they chose is not what they already have — a
          subscriber returning to this URL should not be invited to buy twice. */}
      {isPaidPlan(chosen) && !m.paid && (
        <section className="mt-8 rounded-xl border border-coral/35 ring-1 ring-coral/15 bg-card p-6">
          <span className="label" style={{ color: "var(--coral)" }}>
            Season Pass — {chosen === "monthly" ? "$8 a month" : "$50 a year"}
          </span>
          <p className="mt-2 text-sm text-ink-soft leading-relaxed max-w-[36rem]">
            Your account is ready. Payment is handled by Stripe — we never see your card.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={billingBusy}
              onClick={async () => {
                setBillingErr(null);
                setBillingBusy(true);
                try {
                  await startCheckout(chosen);
                } catch (e) {
                  setBillingErr(e instanceof Error ? e.message : "Could not start checkout.");
                  setBillingBusy(false);
                }
                // No success branch: startCheckout navigates away, so clearing
                // the busy flag here would only flicker the button on a page
                // that is already leaving.
              }}
              className="h-10 inline-flex items-center rounded px-4 text-sm font-semibold bg-coral text-accent-foreground hover:bg-coral-soft transition-colors disabled:opacity-50"
            >
              {billingBusy ? "Opening Stripe…" : "Continue to payment"}
            </button>
            <Link href="/pricing/" className="text-sm text-ink-muted hover:text-ink">
              Change plan
            </Link>
          </div>
          {billingErr && (
            <p role="alert" className="mt-3 text-sm text-coral">{billingErr}</p>
          )}
        </section>
      )}

      {/* Membership */}
      <section className="mt-8 rounded-xl border border-hairline bg-card p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <span className="label text-ink-muted">Membership</span>
            <div className="mt-1.5 flex items-center gap-2.5 flex-wrap">
              <span className="font-display text-2xl tracking-tight text-ink">{m.plan}</span>
              <StatusChip status={m.status} paid={m.paid} />
            </div>
            <p className="mt-2 text-sm text-ink-soft leading-relaxed max-w-[34rem]">{m.blurb}</p>
          </div>
          {profileLoading && (
            <span className="text-xs text-ink-muted">Refreshing…</span>
          )}
        </div>

        {(renews || cancels) && (
          <dl className="mt-5 pt-4 border-t border-hairline grid grid-cols-1 sm:grid-cols-2 gap-4">
            {cancels ? (
              <div>
                <dt className="label text-ink-muted">Access ends</dt>
                <dd className="mt-1 text-sm text-ink tabular">{cancels}</dd>
              </div>
            ) : renews ? (
              <div>
                {/* During a trial this date is the FIRST charge, not a renewal.
                    Stripe collects the card before the trial starts, so the
                    money moves on this day whether or not anyone comes back to
                    the site — calling it "Renews" would be the one piece of
                    wording on this page capable of causing a chargeback. */}
                <dt className="label text-ink-muted">
                  {m.status === "trialing" ? "First charge" : "Renews"}
                </dt>
                <dd className="mt-1 text-sm text-ink tabular">{renews}</dd>
              </div>
            ) : null}
          </dl>
        )}

        {!m.paid && (
          <div className="mt-5 pt-4 border-t border-hairline flex flex-wrap items-center gap-3">
            <Link
              href="/pricing/"
              className="h-10 inline-flex items-center rounded px-4 text-sm font-semibold bg-coral text-accent-foreground hover:bg-coral-soft transition-colors"
            >
              See what a Season Pass adds
            </Link>
            <span className="text-xs text-ink-muted">
              Thirteen seasons, real EPM, lineups, and the all-years Win Calculator.
            </span>
          </div>
        )}
      </section>

      {/* What the plan includes */}
      <section className="mt-6 rounded-xl border border-hairline bg-paper-deep/25 p-6">
        <span className="label text-ink-muted">What you have access to</span>
        <ul className="mt-3 flex flex-col gap-2">
          {(m.paid ? PAID_LINES : FREE_LINES).map((line) => (
            <li key={line} className="flex gap-2.5 text-sm text-ink-soft leading-snug">
              <Tick />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* STAFF ONLY, AND THE ONLY WAY IN.
          /admin is not in the nav and never will be — the header's width
          budget is already argued over in account-nav.tsx, and an eighth
          entry that 99.9% of readers must ignore is the wrong thing to spend
          it on. The account page is where someone signed in as staff already
          is, so the door belongs here.

          m.staff rather than a second role check: describeMembership already
          owns "what is this account", and reading profile.role again here
          would be a second opinion on a question that has an answer. */}
      {m.staff && (
        <section className="mt-6 rounded-xl border border-hairline bg-card p-6">
          <span className="label text-ink-muted">Staff</span>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-ink-soft leading-snug max-w-[28rem]">
              The nightly refresh — what it did last night, which step failed,
              and the button to run it again.
            </p>
            <Link
              href="/admin/"
              className="h-10 shrink-0 inline-flex items-center rounded px-4 text-sm font-semibold border border-ink/15 text-ink hover:bg-paper-deep transition-colors"
            >
              Open admin
            </Link>
          </div>
        </section>
      )}

      {/* Session */}
      <section className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <div className="max-w-[30rem]">
          {m.paid && !m.staff ? (
            <>
              <button
                type="button"
                disabled={billingBusy}
                onClick={async () => {
                  setBillingErr(null);
                  setBillingBusy(true);
                  try {
                    await openBillingPortal();
                  } catch (e) {
                    setBillingErr(e instanceof Error ? e.message : "Could not open billing.");
                    setBillingBusy(false);
                  }
                }}
                className="h-10 inline-flex items-center rounded px-4 text-sm font-semibold border border-ink/15 text-ink hover:bg-paper-deep transition-colors disabled:opacity-50"
              >
                {billingBusy ? "Opening…" : "Manage billing"}
              </button>
              <p className="mt-2 text-xs text-ink-muted leading-relaxed">
                Change your card, see invoices or cancel — handled by Stripe.
              </p>
              {billingErr && <p role="alert" className="mt-2 text-sm text-coral">{billingErr}</p>}
            </>
          ) : (
            <p className="text-xs text-ink-muted leading-relaxed">
              Questions about billing? Email{" "}
              <a href="mailto:hello@btacbb.xyz" className="text-coral hover:text-coral-soft">
                hello@btacbb.xyz
              </a>
              .
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onSignOut}
          disabled={signingOut}
          className="h-10 shrink-0 inline-flex items-center rounded px-4 text-sm font-semibold border border-ink/15 text-ink hover:bg-paper-deep transition-colors disabled:opacity-50"
        >
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </section>
    </Wrap>
  );
}

const FREE_LINES = [
  "Every player, team and coach page",
  "This season and last, in full",
  "Box-EPM, the impact number built from the box score",
  "Win Calculator on the current season",
  "Transfer portal and the 26-27 preview",
];

const PAID_LINES = [
  "All thirteen seasons, back to 2013-14",
  "Ask the Calculator — 300 plain-English questions a month",
  "Real EPM, the plus-minus fit from play-by-play",
  "Lineups, on/off and eWins",
  "Win Calculator across all years, filtered by coach",
  "CSV export",
];

function Wrap({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-[46rem] px-6 py-12 sm:py-16">{children}</div>;
}

function StatusChip({ status, paid }: { status: string; paid: boolean }) {
  const label = STATUS_LABEL[status] ?? status;
  // past_due is the one status that is neither good nor final — it reads as a
  // warning rather than as either.
  const tone =
    status === "past_due" ? "warn" : paid ? "good" : "muted";
  return (
    <span
      className={cn(
        "label rounded-full px-2.5 py-1 shrink-0",
        tone === "good" && "text-[var(--good)]",
        tone === "warn" && "text-[var(--bad)]",
        tone === "muted" && "text-ink-muted",
      )}
      style={{
        background:
          tone === "good"
            ? "color-mix(in oklab, var(--good) 12%, transparent)"
            : tone === "warn"
              ? "color-mix(in oklab, var(--bad) 12%, transparent)"
              : "color-mix(in oklab, var(--ink-muted) 12%, transparent)",
      }}
    >
      {label}
    </span>
  );
}

function Tick() {
  return (
    <svg viewBox="0 0 14 14" className="w-3.5 h-3.5 shrink-0 mt-0.5 text-coral" aria-hidden="true">
      <path
        d="M2.5 7.5l3 3 6-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
