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

export function LoginClient() {
  const router = useRouter();
  const { status } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Someone can reach sign-in from the pricing page too — they picked a tier
  // and already had an account. The choice has to survive this route as well,
  // or coming in through the wrong door quietly loses it.
  const plan = usePlanIntent(true);

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

    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setError("Accounts are unavailable right now. Try again shortly.");
      return;
    }

    setPending(true);
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setPending(false);

    if (err) {
      setError(friendlyAuthError(err.message));
      return;
    }
    // Deliberately no navigation here — the effect above owns it.
  }

  return (
    <AuthShell
      title="Sign in"
      intro="Welcome back."
      footer={
        <>
          No account yet?{" "}
          <AuthLink href={plan ? `/account/signup/?plan=${plan}` : "/account/signup/"}>
            Create one
          </AuthLink>{" "}
          — it is free.
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field
          id="login-email"
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
        <Field
          id="login-password"
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {/* Under the password, where someone who has just failed to remember
            it is already looking. A reset link in the footer is a reset link
            nobody finds. */}
        <div className="-mt-1 text-right">
          <AuthLink href="/account/forgot/">Forgot your password?</AuthLink>
        </div>
        <FormError message={error} />
        <SubmitButton pending={pending} pendingLabel="Signing you in…">
          Sign in
        </SubmitButton>
      </form>
    </AuthShell>
  );
}
