"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/auth/supabase-browser";
import { AuthShell, AuthLink, Field, FormError, SubmitButton, friendlyAuthError } from "./auth-shell";

/**
 * Where a reset link lands: set the new password.
 *
 * HOW THE LINK BECOMES A SESSION. Supabase puts the recovery token in the URL
 * FRAGMENT, and `detectSessionInUrl` on the browser client consumes it on load
 * and fires `PASSWORD_RECOVERY`. That is asynchronous and can land either side
 * of this component mounting, so both paths are handled: the listener catches
 * it if it has not happened yet, and getSession() catches it if it already has.
 * Waiting only on the event is the classic way this page hangs forever on a
 * fast connection.
 *
 * A fragment never reaches a server, which is what makes this work at all on a
 * static export — there is no route handler to exchange a code, and none is
 * needed.
 *
 * THE ARMED WINDOW IS NARROW ON PURPOSE. A recovery session can update the
 * password and nothing else here; once it succeeds the reader is sent to sign
 * in rather than deeper into the site, so the new password is exercised
 * immediately instead of a half-authenticated session being carried around.
 */
type Phase = "checking" | "ready" | "invalid" | "done";

export function ResetClient() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const settled = useRef(false);

  useEffect(() => {
    const supabase = getSupabaseBrowser();

    const arm = () => {
      if (settled.current) return;
      settled.current = true;
      setPhase("ready");
    };
    const fail = () => {
      if (settled.current) return;
      settled.current = true;
      setPhase("invalid");
    };

    // Deferred rather than set inline: a synchronous setState in an effect body
    // is a cascading render, and this path is the same "we never got a session"
    // conclusion the timeout below reaches — so it takes the same exit.
    if (!supabase) {
      const t = setTimeout(fail, 0);
      return () => clearTimeout(t);
    }

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) arm();
    });

    // The fragment may already have been consumed before this mounted.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) arm();
      else if (!settled.current) {
        // Give the in-flight fragment exchange a moment before calling it dead.
        setTimeout(fail, 1500);
      }
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);

    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Those two do not match.");
      return;
    }

    const supabase = getSupabaseBrowser();
    if (!supabase) {
      setError("Accounts are unavailable right now. Try again shortly.");
      return;
    }

    setPending(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    if (err) {
      setPending(false);
      setError(friendlyAuthError(err.message));
      return;
    }
    // Sign out so the next step is a real sign-in with the new password. A
    // recovery session left alive is a session nobody deliberately started.
    await supabase.auth.signOut();
    setPending(false);
    setPhase("done");
    setTimeout(() => router.replace("/account/login/"), 1600);
  }

  if (phase === "checking") {
    return (
      <AuthShell title="Reset your password" intro="Checking your link…">
        <p className="text-sm text-ink-muted">One moment.</p>
      </AuthShell>
    );
  }

  if (phase === "invalid") {
    return (
      <AuthShell
        title="That link has expired"
        intro="Reset links are good for one hour and can only be used once."
        footer={
          <>
            <AuthLink href="/account/forgot/">Send a new one</AuthLink> — it takes a moment.
          </>
        }
      >
        <p className="text-sm text-ink-soft leading-relaxed">
          If you opened the link on a different device or browser from the one
          you requested it on, that will do it too. Request another from the
          same browser you are reading this in.
        </p>
      </AuthShell>
    );
  }

  if (phase === "done") {
    return (
      <AuthShell
        title="Password changed"
        intro="Taking you to sign in…"
        footer={<AuthLink href="/account/login/">Go there now</AuthLink>}
      >
        <p className="text-sm text-ink-soft">
          Use the new one from here on. <AuthLink href="/account/login/">Sign in</AuthLink>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Set a new password" intro="Pick something you have not used here before.">
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field
          id="reset-password"
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Field
          id="reset-confirm"
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <FormError message={error} />
        <SubmitButton pending={pending} pendingLabel="Saving…">
          Save new password
        </SubmitButton>
      </form>
    </AuthShell>
  );
}
