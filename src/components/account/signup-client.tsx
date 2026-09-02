"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/auth/supabase-browser";
import { useAuth } from "@/lib/auth/auth-provider";
import { destinationFor, takePlan, usePlanIntent } from "@/lib/auth/plan-intent";
import {
  AuthShell,
  AuthLink,
  Field,
  FormError,
  SubmitButton,
  friendlyAuthError,
} from "./auth-shell";

const MIN_PASSWORD = 8;

export function SignupClient() {
  const router = useRouter();
  const { status } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  /** Confirmations are on and the link is in their inbox. */
  const [awaitingEmail, setAwaitingEmail] = useState(false);
  // Captured on arrival, before anything can replace the URL, and falling back
  // to whatever is already parked — so a reload mid-signup does not quietly
  // downgrade someone who picked the Season Pass.
  const plan = usePlanIntent(true);

  // Someone already signed in has no business on this page; send them on to
  // whatever they picked rather than letting them create a second account.
  // THE ONLY REDIRECT. Sign-in flips `status` via onAuthStateChange, so a
  // successful submit lands here rather than navigating itself. Both used to
  // redirect, and because takePlan() consumes the intent, whichever ran second
  // read null and replaced the URL with a plan-less one — the chosen tier was
  // silently dropped between the pricing page and the dashboard. The ref makes
  // the consumption happen exactly once.
  const redirected = useRef(false);
  useEffect(() => {
    if (status !== "signedIn" || redirected.current) return;
    redirected.current = true;
    router.replace(destinationFor(takePlan()));
  }, [status, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);

    if (password.length < MIN_PASSWORD) {
      setError(`Passwords need to be at least ${MIN_PASSWORD} characters.`);
      return;
    }

    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setError("Accounts are unavailable right now. Try again shortly.");
      return;
    }

    setPending(true);
    const { data, error: err } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        // Only used when email confirmation is ON. Harmless when it is off, and
        // it means turning the setting on does not also require a code change.
        // The plan rides in the query because sessionStorage does not survive
        // the trip out to an inbox and back, which is frequently another
        // device entirely.
        emailRedirectTo: `${window.location.origin}/account/confirm/${plan ? `?plan=${plan}` : ""}`,
      },
    });
    setPending(false);

    if (err) {
      setError(friendlyAuthError(err.message));
      return;
    }

    // Email confirmation is OFF on this project today, so signUp returns a live
    // session and the redirect effect above takes it from here. When it is
    // switched on, `session` comes back null instead — which is a SUCCESS, not
    // a failure, and showing it in the red error slot (as this did) reads as
    // "your signup did not work" at the exact moment it did.
    if (!data.session) {
      setAwaitingEmail(true);
      return;
    }
    // Deliberately no navigation here — the effect above owns it.
  }

  if (awaitingEmail) {
    return (
      <AuthShell
        title="Confirm your email"
        intro={`We sent a link to ${email.trim()}. Open it and you are in.`}
        footer={
          <>
            Wrong address?{" "}
            <AuthLink href="/account/signup/">Start again</AuthLink>
          </>
        }
      >
        <p className="text-sm text-ink-soft leading-relaxed">
          The link signs you in on the device you open it on. If it is not there
          in a minute, check spam.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      intro={
        plan === "yearly" || plan === "monthly"
          ? "One step before the Season Pass: the pass attaches to an account, so this comes first. Creating it is free, you are not asked for a card until the next screen, and the first five days are free after that."
          : plan === "program"
            ? "Programs are set up by hand, so start with an account and we will take it from there."
            : "Free, and it stays free. An account saves your teams and players, and it is what a Season Pass attaches to if you ever want one."
      }
      footer={
        <>
          Already have an account?{" "}
          <AuthLink href={plan ? `/account/login/?plan=${plan}` : "/account/login/"}>
            Sign in
          </AuthLink>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field
          id="signup-email"
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
        <Field
          id="signup-password"
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint={`At least ${MIN_PASSWORD} characters.`}
        />
        <FormError message={error} />
        <SubmitButton pending={pending} pendingLabel="Creating your account…">
          Create account
        </SubmitButton>
        <p className="text-xs text-ink-muted leading-relaxed">
          We store your email and nothing else. No card is required and none is asked for.
        </p>
      </form>
    </AuthShell>
  );
}
