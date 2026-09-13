import { createHash, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ACTIVE_STATUSES } from "./billing.mts";

/**
 * What the desktop app's sign-in functions share: who may use the app, and the
 * small pieces of PKCE.
 *
 * See supabase/migrations/012_desktop_auth.sql for the whole flow.
 */

/**
 * Who may use the desktop app.
 *
 * ADMINS ONLY DURING EARLY ACCESS. The app is unsigned and unannounced, and the
 * download button is behind the admin gate too. Opening it to Season Pass
 * holders is this one word: "paid". Nothing else changes, because every
 * sign-in and every refresh asks desktopEntitled, so the rule is enforced at
 * the moment of use rather than baked into an installer.
 */
export const DESKTOP_ACCESS: "admin" | "paid" = "admin";

export type DesktopProfile = { role: string | null; subscription_status: string | null };

export function desktopEntitled(p: DesktopProfile | null): boolean {
  if (!p) return false;
  if (p.role === "admin") return true;
  return DESKTOP_ACCESS === "paid" && ACTIVE_STATUSES.has(p.subscription_status ?? "");
}

/** The profile columns the rule reads, or "error" when the read itself failed. */
export async function readDesktopProfile(
  admin: SupabaseClient,
  userId: string,
): Promise<DesktopProfile | null | "error"> {
  const { data, error } = await admin
    .from("profiles")
    .select("role,subscription_status")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.error("[desktop-auth] profile read failed:", error.message);
    return "error";
  }
  return (data as DesktopProfile | null) ?? null;
}

/** Supabase as an anonymous client: what verifies an OTP and refreshes a session. */
export function getSupabaseAnon(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  return createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** How long a code lives between Allow and the app redeeming it. */
export const CODE_TTL_MS = 5 * 60 * 1000;

const B64URL = /^[A-Za-z0-9_-]+$/;
/** RFC 7636: a verifier is 43 to 128 unreserved characters. */
const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;

/** base64url(sha256(x)) is always 43 characters. */
export const isChallenge = (s: unknown): s is string => typeof s === "string" && s.length === 43 && B64URL.test(s);
export const isState = (s: unknown): s is string =>
  typeof s === "string" && s.length >= 16 && s.length <= 128 && B64URL.test(s);
export const isVerifier = (s: unknown): s is string => typeof s === "string" && VERIFIER.test(s);
export const isCode = (s: unknown): s is string => typeof s === "string" && s.length === 43 && B64URL.test(s);

export const s256 = (verifier: string): string => createHash("sha256").update(verifier).digest("base64url");
export const sha256hex = (s: string): string => createHash("sha256").update(s).digest("hex");
/** 256 random bits, 43 base64url characters. */
export const newCode = (): string => randomBytes(32).toString("base64url");

/** The session an app keeps, and nothing else from Supabase's session object. */
export type DesktopSession = { access_token: string; refresh_token: string; expires_at: number };

export type DesktopUser = { id: string; email: string | null; role: string | null };

/** Responses from these functions are never cacheable, anywhere. */
export const NO_STORE = { "cache-control": "no-store" };
