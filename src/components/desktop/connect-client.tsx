"use client";

import { useState, useSyncExternalStore } from "react";
import { AuthLink, AuthShell, FormError } from "@/components/account/auth-shell";
import { useAuth } from "@/lib/auth/auth-provider";
import { cn } from "@/lib/utils";

/**
 * The browser half of the desktop app's sign-in.
 *
 * The app opened this page with a PKCE challenge and its own state. A reader
 * already signed in on the site presses Allow; the authorize function records a
 * five-minute code bound to that challenge; this page hands the code back to the
 * app through btacbb://. See supabase/migrations/012_desktop_auth.sql.
 *
 * THE QUERY IS READ FROM window.location, NOT useSearchParams. This page is a
 * static export, and useSearchParams on a statically rendered page forces a
 * Suspense boundary for no benefit here: nothing on it can be known at build
 * time anyway.
 *
 * NOTHING IS AUTOMATIC. Allow is a button. A page that forwarded a session to
 * whichever program opened it, without a person agreeing on screen, would turn
 * any link into a way to sign someone's account into an app they never saw.
 */

type Request = { challenge: string; state: string };
type Phase =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "done"; redirect: string }
  | { kind: "refused" }
  | { kind: "error"; message: string };

const B64URL = /^[A-Za-z0-9_-]+$/;

function readRequest(search: string): Request | null {
  const q = new URLSearchParams(search);
  const challenge = q.get("challenge") ?? "";
  const state = q.get("state") ?? "";
  if (challenge.length !== 43 || !B64URL.test(challenge)) return null;
  if (state.length < 16 || state.length > 128 || !B64URL.test(state)) return null;
  return { challenge, state };
}

const buttonClass = cn(
  "h-11 w-full rounded font-semibold text-sm transition-colors",
  "bg-coral text-white hover:bg-coral-soft disabled:opacity-50",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-offset-2",
);

const noSubscribe = () => () => {};

export function ConnectClient() {
  const { status, session, profile } = useAuth();
  // The query, read without an effect: null while prerendering, where there is
  // no location, and the real string once in the browser.
  const search = useSyncExternalStore(noSubscribe, () => window.location.search, () => null);
  const request: Request | null | undefined = search === null ? undefined : readRequest(search);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  if (request === undefined || status === "loading") {
    return <AuthShell title="Connect the desktop app" intro="Checking your account…">{null}</AuthShell>;
  }

  if (request === null) {
    return (
      <AuthShell
        title="This link is incomplete"
        intro="Open Beyond the Arc on your computer and choose Sign in again. It brings you back here with a fresh link."
      >
        {null}
      </AuthShell>
    );
  }

  if (status === "signedOut" || !session) {
    const here = `${window.location.pathname}${window.location.search}`;
    return (
      <AuthShell
        title="Sign in to connect the app"
        intro="Beyond the Arc for Windows uses your site account. Sign in and you will come straight back here to finish."
      >
        <a href={`/account/login/?next=${encodeURIComponent(here)}`} className={cn(buttonClass, "flex items-center justify-center")}>
          Sign in
        </a>
      </AuthShell>
    );
  }

  const email = session.user.email ?? profile?.email ?? "your account";

  if (phase.kind === "done") {
    return (
      <AuthShell
        title="You are connected"
        intro="Beyond the Arc is opening on your computer. You can close this tab."
        footer={
          <>
            Nothing happened?{" "}
            <button
              type="button"
              onClick={() => (window.location.href = phase.redirect)}
              className="text-coral underline-offset-2 hover:underline"
            >
              Open the app
            </button>
          </>
        }
      >
        {null}
      </AuthShell>
    );
  }

  if (phase.kind === "refused") {
    return (
      <AuthShell
        title="The app is not open to this account yet"
        intro="Beyond the Arc for Windows is in early access. Everything on btacbb.xyz keeps working for your account as it does today."
        footer={<AuthLink href="/">Back to Beyond the Arc</AuthLink>}
      >
        {null}
      </AuthShell>
    );
  }

  async function allow() {
    if (!request || !session) return;
    setPhase({ kind: "sending" });
    try {
      const res = await fetch("/api/desktop/authorize", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(request),
      });
      const body = (await res.json().catch(() => ({}))) as { redirect?: string; error?: string; reason?: string };
      if (res.status === 403 && body.reason === "not-entitled") {
        setPhase({ kind: "refused" });
        return;
      }
      if (!res.ok || !body.redirect) {
        setPhase({ kind: "error", message: body.error ?? "Something went wrong. Try again from the app." });
        return;
      }
      setPhase({ kind: "done", redirect: body.redirect });
      window.location.href = body.redirect;
    } catch {
      setPhase({ kind: "error", message: "Could not reach Beyond the Arc. Check your connection and try again." });
    }
  }

  return (
    <AuthShell
      title="Connect Beyond the Arc for Windows"
      intro={`The app on your computer is asking to use ${email}.`}
      footer={<>Did not open the app yourself? Close this tab and nothing is shared.</>}
    >
      <ul className="mb-6 flex flex-col gap-2 text-sm text-ink-soft">
        <li>It opens every season your account can open.</li>
        <li>It stays signed in until you sign out in the app.</li>
        <li>It never sees your password.</li>
      </ul>
      <FormError message={phase.kind === "error" ? phase.message : null} />
      <button type="button" onClick={allow} disabled={phase.kind === "sending"} className={cn(buttonClass, "mt-1")}>
        {phase.kind === "sending" ? "Connecting…" : "Allow"}
      </button>
    </AuthShell>
  );
}
