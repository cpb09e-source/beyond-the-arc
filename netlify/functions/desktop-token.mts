import type { Context } from "@netlify/functions";
import { getSupabaseAdmin } from "../shared/billing.mts";
import {
  NO_STORE,
  desktopEntitled,
  getSupabaseAnon,
  isCode,
  isVerifier,
  readDesktopProfile,
  s256,
  sha256hex,
  type DesktopSession,
  type DesktopUser,
} from "../shared/desktop-auth.mts";

/**
 * Where the desktop app turns a code into a session, and keeps it fresh.
 *
 * POST /api/desktop/token
 *   { grant: "code", code, verifier }   -> 200 { session, user }
 *   { grant: "refresh", refresh_token } -> 200 { session, user }
 *   -> 400 invalid-code | bad-request
 *   -> 401 signed-out                    the refresh token is no longer good
 *   -> 403 not-entitled                  a real account the app is not open to
 *   -> 503                               this deploy cannot check or mint
 *
 * THE CODE IS CLAIMED BEFORE IT IS CHECKED. One UPDATE flips used_at from null
 * where the code is unexpired; whoever gets the row back owns the attempt, and
 * the code is spent whether the verifier then matches or not. Two racing
 * redemptions cannot both succeed, and a wrong guess costs the guesser the code.
 *
 * THE SESSION IS A REAL SUPABASE SESSION, minted the one way Supabase lets a
 * server do it for an existing user without their password: an admin magic
 * link, verified immediately with its hashed token. Nothing is emailed. The
 * app then holds exactly what a browser signed in to the site holds, so every
 * existing gate (requireUser, requirePaid, /api/season, /api/data-url) accepts
 * it with no change.
 *
 * REFRESH RE-CHECKS ENTITLEMENT. A lapsed or downgraded account stops getting
 * fresh sessions the next time the app asks, within the hour an access token
 * lives, instead of whenever someone remembers to sign it out.
 */

export const config = { path: "/api/desktop/token" };

const json = (body: unknown, status: number) => Response.json(body, { status, headers: NO_STORE });

async function entitledUser(userId: string, email: string | null): Promise<DesktopUser | Response> {
  const admin = getSupabaseAdmin();
  if (!admin) return json({ error: "Desktop sign-in is not configured on this deploy." }, 503);
  const profile = await readDesktopProfile(admin, userId);
  if (profile === "error") return json({ error: "Could not check your account." }, 503);
  if (!desktopEntitled(profile)) {
    return json({ error: "The desktop app is not open to this account yet.", reason: "not-entitled" }, 403);
  }
  return { id: userId, email, role: profile?.role ?? null };
}

function toSession(s: { access_token: string; refresh_token: string; expires_at?: number; expires_in: number }): DesktopSession {
  return {
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expires_at: s.expires_at ?? Math.floor(Date.now() / 1000) + s.expires_in,
  };
}

async function redeemCode(code: string, verifier: string): Promise<Response> {
  const admin = getSupabaseAdmin();
  const anon = getSupabaseAnon();
  if (!admin || !anon) return json({ error: "Desktop sign-in is not configured on this deploy." }, 503);

  const now = new Date();
  // Sweep codes that expired more than an hour ago. Best effort; never blocks.
  void admin
    .from("desktop_auth_codes")
    .delete()
    .lt("expires_at", new Date(now.getTime() - 3_600_000).toISOString())
    .then(({ error }) => error && console.warn("[desktop-token] sweep failed:", error.message));

  const { data: claimed, error: claimError } = await admin
    .from("desktop_auth_codes")
    .update({ used_at: now.toISOString() })
    .eq("code_hash", sha256hex(code))
    .is("used_at", null)
    .gt("expires_at", now.toISOString())
    .select("user_id,challenge")
    .maybeSingle();
  if (claimError) {
    console.error("[desktop-token] claim failed:", claimError.message);
    return json({ error: "Could not finish the sign-in." }, 503);
  }
  const row = claimed as { user_id: string; challenge: string } | null;
  // One answer for unknown, expired, spent and wrong-verifier codes: which it
  // was is of use only to someone trying codes.
  if (!row || s256(verifier) !== row.challenge) {
    return json({ error: "That sign-in has expired. Start again from the app.", reason: "invalid-code" }, 400);
  }

  const { data: found, error: userError } = await admin.auth.admin.getUserById(row.user_id);
  const email = found?.user?.email ?? null;
  if (userError || !email) {
    return json({ error: "That account could not be found.", reason: "invalid-code" }, 400);
  }

  const user = await entitledUser(row.user_id, email);
  if (user instanceof Response) return user;

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) {
    console.error("[desktop-token] generateLink failed:", linkError?.message);
    return json({ error: "Could not finish the sign-in." }, 503);
  }
  const { data: verified, error: verifyError } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
  if (verifyError || !verified.session) {
    console.error("[desktop-token] verifyOtp failed:", verifyError?.message);
    return json({ error: "Could not finish the sign-in." }, 503);
  }

  return json({ session: toSession(verified.session), user }, 200);
}

async function refresh(refreshToken: string): Promise<Response> {
  const anon = getSupabaseAnon();
  if (!anon) return json({ error: "Desktop sign-in is not configured on this deploy." }, 503);
  const { data, error } = await anon.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session || !data.user) {
    return json({ error: "Sign in again.", reason: "signed-out" }, 401);
  }
  const user = await entitledUser(data.user.id, data.user.email ?? null);
  if (user instanceof Response) return user;
  return json({ session: toSession(data.session), user }, 200);
}

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: { grant?: unknown; code?: unknown; verifier?: unknown; refresh_token?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "Expected JSON.", reason: "bad-request" }, 400);
  }

  if (body.grant === "code" && isCode(body.code) && isVerifier(body.verifier)) {
    return redeemCode(body.code, body.verifier);
  }
  if (body.grant === "refresh" && typeof body.refresh_token === "string" && body.refresh_token.length > 0) {
    return refresh(body.refresh_token);
  }
  return json({ error: "Expected a code grant or a refresh grant.", reason: "bad-request" }, 400);
};
