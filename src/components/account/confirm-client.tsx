"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth/auth-provider";
import { destinationFor, isPaidPlan, type PlanIntent } from "@/lib/auth/plan-intent";
import { AuthShell, AuthLink } from "./auth-shell";

/**
 * Where an email-confirmation link lands.
 *
 * DORMANT UNTIL CONFIRMATIONS ARE ON. Supabase is currently set to skip them,
 * so signUp returns a live session and nobody is sent here. The route exists so
 * that turning the setting on is a switch rather than a deploy — a confirmation
 * link with no page behind it drops people on a 404 holding a valid token.
 *
 * THE PLAN RIDES IN THE QUERY, not in sessionStorage. Confirmation happens in
 * whatever client opened the email, which is routinely a different browser or a
 * different device from the one that filled in the form — and sessionStorage
 * does not cross either. Losing it means someone who chose the Season Pass
 * lands on the free dashboard with no idea what happened to their choice.
 *
 * The token itself is in the URL fragment and is consumed by
 * `detectSessionInUrl` on the browser client, exactly as the recovery link is.
 */
export function ConfirmClient() {
  const router = useRouter();
  const search = useSearchParams();
  const { status } = useAuth();
  const [slow, setSlow] = useState(false);
  const moved = useRef(false);

  const raw = search.get("plan");
  const plan: PlanIntent | null =
    raw === "monthly" || raw === "yearly" || raw === "program" || raw === "free" ? raw : null;

  useEffect(() => {
    if (status !== "signedIn" || moved.current) return;
    moved.current = true;
    // Paid intent goes to the dashboard's checkout prompt; everyone else to the
    // account page. destinationFor() already encodes that rule.
    router.replace(destinationFor(plan));
  }, [status, plan, router]);

  // If the fragment never resolves, say so rather than spinning forever.
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(t);
  }, []);

  if (status === "signedIn") {
    return (
      <AuthShell title="You are in" intro="Taking you to your account…">
        <p className="text-sm text-ink-soft">
          {isPaidPlan(plan) ? "Your Season Pass is one step away." : "Welcome aboard."}
        </p>
      </AuthShell>
    );
  }

  if (slow) {
    return (
      <AuthShell
        title="That link did not open a session"
        intro="It may have already been used, or it may have expired."
        footer={
          <>
            <AuthLink href="/account/login/">Sign in</AuthLink> — if the account
            is confirmed, your password works.
          </>
        }
      >
        <p className="text-sm text-ink-soft leading-relaxed">
          Confirmation links can only be used once. If you have already opened
          this one, the account is confirmed and there is nothing left to do.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Confirming…" intro="One moment.">
      <p className="text-sm text-ink-muted">Checking your link.</p>
    </AuthShell>
  );
}
