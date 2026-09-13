import type { Context } from "@netlify/functions";
import { getSupabaseAdmin, requireUser } from "../shared/billing.mts";
import {
  CODE_TTL_MS,
  NO_STORE,
  desktopEntitled,
  isChallenge,
  isState,
  newCode,
  readDesktopProfile,
  sha256hex,
} from "../shared/desktop-auth.mts";

/**
 * The Allow button on /desktop/connect.
 *
 * POST /api/desktop/authorize   Authorization: Bearer <site session>
 *   { challenge, state }
 *   -> 200 { code, redirect }     redirect is btacbb://auth?code=…&state=…
 *   -> 400 bad-request            the link the app opened was not whole
 *   -> 401 signed-out             no site session came with the request
 *   -> 403 not-entitled           a real account the app is not open to yet
 *   -> 503                        this deploy cannot check or store
 *
 * IT MINTS NOTHING. It records that this user, right now, agreed to hand a
 * session to whoever holds the verifier behind `challenge`. The session itself
 * is made by /api/desktop/token, and only for the app that can prove it.
 *
 * ENTITLEMENT IS CHECKED HERE AS WELL AS AT REDEMPTION, so someone the app is
 * not open to is told so on the page they are looking at, instead of watching
 * the app fail after a round trip.
 */

export const config = { path: "/api/desktop/authorize" };

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") {
    return Response.json({ error: "POST only" }, { status: 405, headers: NO_STORE });
  }

  let body: { challenge?: unknown; state?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Expected JSON.", reason: "bad-request" }, { status: 400, headers: NO_STORE });
  }
  if (!isChallenge(body.challenge) || !isState(body.state)) {
    return Response.json(
      { error: "This sign-in link is incomplete.", reason: "bad-request" },
      { status: 400, headers: NO_STORE },
    );
  }

  const user = await requireUser(req);
  if (!user) {
    return Response.json({ error: "Sign in first.", reason: "signed-out" }, { status: 401, headers: NO_STORE });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return Response.json(
      { error: "Desktop sign-in is not configured on this deploy." },
      { status: 503, headers: NO_STORE },
    );
  }

  const profile = await readDesktopProfile(admin, user.id);
  if (profile === "error") {
    return Response.json({ error: "Could not check your account." }, { status: 503, headers: NO_STORE });
  }
  if (!desktopEntitled(profile)) {
    return Response.json(
      { error: "The desktop app comes with Season Pass. Your account keeps working on btacbb.xyz as it does today.", reason: "not-entitled" },
      { status: 403, headers: NO_STORE },
    );
  }

  const code = newCode();
  const { error } = await admin.from("desktop_auth_codes").insert({
    code_hash: sha256hex(code),
    user_id: user.id,
    challenge: body.challenge,
    state: body.state,
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  });
  if (error) {
    console.error("[desktop-authorize] insert failed:", error.message);
    return Response.json({ error: "Could not start the sign-in." }, { status: 503, headers: NO_STORE });
  }

  const redirect = `btacbb://auth?${new URLSearchParams({ code, state: body.state }).toString()}`;
  return Response.json({ code, redirect }, { status: 200, headers: NO_STORE });
};
