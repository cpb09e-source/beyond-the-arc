"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "./supabase-browser";
import { PROFILE_COLUMNS, type Profile } from "./membership";

/**
 * Session state for the whole site.
 *
 * Mounted once in app/layout.tsx so the header can show who is signed in on
 * every page. The site is a static export — there is no middleware and no
 * server session — so this context IS the source of truth in the browser, and
 * everything it exposes came from a token the browser already holds.
 *
 * `status` is a three-state rather than a boolean on purpose. "Signed out" and
 * "we do not know yet" look identical to a boolean, and conflating them makes
 * every consumer flash a signed-out UI for a moment on first paint before the
 * stored session is read back. Components branch on "loading" and render
 * nothing decisive until it resolves.
 */
export type AuthStatus = "loading" | "signedOut" | "signedIn";

type AuthValue = {
  status: AuthStatus;
  session: Session | null;
  profile: Profile | null;
  /** True while the profile row is being fetched for an already-known session. */
  profileLoading: boolean;
  signOut: () => Promise<void>;
  /** Re-read the profile — used after anything that could change membership. */
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  const loadProfile = useCallback(async (userId: string) => {
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    setProfileLoading(true);
    const { data, error } = await supabase
      .from("profiles")
      .select(PROFILE_COLUMNS)
      .eq("id", userId)
      .maybeSingle();
    // maybeSingle rather than single: a signed-in user with no profile row is
    // a real state (the row is created by a database trigger, and a trigger
    // that failed should surface as "Free" rather than as a thrown error on
    // the dashboard). RLS means this can only ever return the caller's row.
    if (error) console.error("[auth] profile load failed:", error.message);

    // NO ROW MEANS THE SESSION MAY BE DEAD.
    //
    // getSession() reads the stored token without asking the server whether it
    // is still good, so a deleted or revoked account keeps rendering as signed
    // in — with its old email — until the access token expires and the refresh
    // finally fails, up to an hour later. A signed-in user always has a
    // profile row (a database trigger guarantees it), so its absence is the
    // first evidence that the token outlived the account.
    //
    // getUser() validates against the server. If it refuses, the session is
    // genuinely gone and we clear it rather than show a stale identity. This
    // costs one request in a case that should never happen, and none in the
    // normal path.
    if (!data) {
      const { error: userErr } = await supabase.auth.getUser();
      if (userErr) {
        await supabase.auth.signOut();
        setSession(null);
        setProfile(null);
        setStatus("signedOut");
        setProfileLoading(false);
        return;
      }
    }

    setProfile((data as Profile | null) ?? null);
    setProfileLoading(false);
  }, []);

  useEffect(() => {
    const supabase = getSupabaseBrowser();
    if (!supabase) {
      // Deferred rather than set inline: resolving the status synchronously in
      // the effect body cascades a second render before the first has painted.
      // Behaviour is identical, one tick later.
      const t = setTimeout(() => setStatus("signedOut"), 0);
      return () => clearTimeout(t);
    }

    let cancelled = false;

    // getSession reads the persisted token before any network call, so the
    // header settles without waiting on Supabase.
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      const s = data.session ?? null;
      setSession(s);
      setStatus(s ? "signedIn" : "signedOut");
      if (s?.user) void loadProfile(s.user.id);
    });

    // Covers sign-in, sign-out, token refresh, and the same account being
    // signed out in another tab.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      if (cancelled) return;
      setSession(s);
      setStatus(s ? "signedIn" : "signedOut");
      if (s?.user) void loadProfile(s.user.id);
      else setProfile(null);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    setStatus("signedOut");
  }, []);

  const refresh = useCallback(async () => {
    if (session?.user) await loadProfile(session.user.id);
  }, [session, loadProfile]);

  const value = useMemo<AuthValue>(
    () => ({ status, session, profile, profileLoading, signOut, refresh }),
    [status, session, profile, profileLoading, signOut, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/**
 * The same value, or null where there is no provider — for consumers that have
 * something sensible to do without one.
 *
 * THROWING IS RIGHT FOR useAuth and wrong here. A component that shows who is
 * signed in cannot proceed without the session, so failing loudly is the only
 * honest thing. But a component that merely dresses itself differently for a
 * subscriber has a correct answer available — "not known yet" — and taking the
 * whole page down instead is a much worse trade: React responds to a throw
 * during server rendering by discarding the server HTML for the entire route
 * and re-rendering it on the client, which costs every reader the prerender
 * whether or not they were ever going to see the difference.
 */
export function useAuthOptional(): AuthValue | null {
  return useContext(AuthContext);
}
