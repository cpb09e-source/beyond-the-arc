"use client";

import { useState } from "react";
import { getSupabaseBrowser } from "@/lib/auth/supabase-browser";
import { AuthShell, AuthLink, Field, FormError, SubmitButton } from "./auth-shell";

/**
 * Ask for a reset link.
 *
 * THE RESPONSE IS THE SAME WHETHER OR NOT THE ADDRESS HAS AN ACCOUNT, and that
 * is deliberate. A form that says "no account with that email" is an account
 * enumeration oracle: anyone can walk a list of addresses through it and learn
 * which ones are subscribers. Supabase already declines to distinguish the two
 * cases in its own response, and this keeps that property instead of helpfully
 * undoing it.
 *
 * The cost is a worse day for someone who mistypes their address — they wait
 * for an email that is not coming. The copy names that possibility rather than
 * pretending the send definitely happened.
 *
 * WHERE THE LINK LANDS is /account/reset/, passed as `redirectTo`. Supabase
 * only honours a redirect that is on the project's allow-list, so this URL has
 * to be added under Authentication → URL Configuration for both the production
 * origin and localhost, or the link silently returns people to the site root
 * with the recovery token still in the fragment and nothing to consume it.
 */
export function ForgotClient() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

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
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/account/reset/`,
    });
    setPending(false);

    // A rate-limit IS worth showing — it is about the sender, not about whether
    // the account exists, so it leaks nothing and otherwise looks like silence.
    if (err && /rate|too many/i.test(err.message)) {
      setError("Too many requests just now. Wait a minute and try again.");
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <AuthShell
        title="Check your email"
        intro={`If an account exists for ${email.trim()}, a reset link is on its way.`}
        footer={
          <>
            Nothing arriving? Check spam, or{" "}
            <AuthLink href="/account/login/">go back to sign in</AuthLink>.
          </>
        }
      >
        <p className="text-sm text-ink-soft leading-relaxed">
          The link is good for one hour and can be used once. If you do not get
          it, the address may not have an account — try creating one instead.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      intro="We will email you a link to set a new one."
      footer={
        <>
          Remembered it? <AuthLink href="/account/login/">Sign in</AuthLink>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field
          id="forgot-email"
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
        <FormError message={error} />
        <SubmitButton pending={pending} pendingLabel="Sending…">
          Send reset link
        </SubmitButton>
      </form>
    </AuthShell>
  );
}
