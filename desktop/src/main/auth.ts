import { app, net, safeStorage, shell } from "electron";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AuthState, AuthUser } from "../preload";

/**
 * Signing in to Beyond the Arc from the desktop.
 *
 * THE APP NEVER SEES A PASSWORD. It opens the site in the reader's own browser,
 * where they are usually signed in already, and the site hands back a
 * single-use code through btacbb://. PKCE binds that code to a verifier that
 * never leaves this process, so a copy of the link is useless to anyone else.
 * The whole flow is written down in supabase/migrations/012_desktop_auth.sql.
 *
 * WHAT IS KEPT: the Supabase session and the user it belongs to, encrypted with
 * Electron's safeStorage (DPAPI on Windows) under userData. Where the operating
 * system offers no encryption, the session lives in memory only and the reader
 * signs in each launch: a refresh token in plain text on disk is not a trade
 * worth making.
 *
 * ENTITLEMENT IS ASKED, NEVER ASSUMED. Every refresh goes through the site,
 * which reads the account again; an account the app is no longer open to is
 * signed out on its next refresh, and index.ts purges its paid seasons.
 */

type Session = { access_token: string; refresh_token: string; expires_at: number };
type Saved = { session: Session; user: AuthUser };
type TokenReply = {
  status: number;
  body: { session?: Session; user?: AuthUser; error?: string; reason?: string };
};

/** The site. Development can point at a local `netlify dev` to try the flow end to end. */
export const SITE = (!app.isPackaged && process.env.BTA_SITE_ORIGIN) || "https://btacbb.xyz";
export const SCHEME = "btacbb";

/** A callback later than this is not for the sign-in that is waiting. The code itself lives 5 minutes. */
const PENDING_TTL_MS = 10 * 60_000;

let current: AuthState = { status: "signedOut" };
let saved: Saved | null = null;
let pending: { verifier: string; state: string; startedAt: number } | null = null;
let refreshTimer: NodeJS.Timeout | null = null;
const listeners = new Set<(s: AuthState) => void>();

const sessionFile = () => join(app.getPath("userData"), "auth", "session.bin");

function publish(next: AuthState): void {
  current = next;
  for (const fn of listeners) fn(next);
}

export const authState = (): AuthState => current;

export function onAuthChange(fn: (s: AuthState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function persist(value: Saved | null): Promise<void> {
  const path = sessionFile();
  if (!value) {
    await rm(path, { force: true });
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) return;
  await mkdir(dirname(path), { recursive: true });
  // Write, then rename: a crash mid-write must not leave half a session.
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, safeStorage.encryptString(JSON.stringify(value)));
  await rename(tmp, path);
}

async function load(): Promise<Saved | null> {
  const path = sessionFile();
  if (!existsSync(path) || !safeStorage.isEncryptionAvailable()) return null;
  try {
    return JSON.parse(safeStorage.decryptString(await readFile(path))) as Saved;
  } catch {
    // Unreadable (a different Windows user, a damaged file): start clean.
    await rm(path, { force: true });
    return null;
  }
}

async function tokenRequest(payload: object): Promise<TokenReply> {
  try {
    const res = await net.fetch(`${SITE}/api/desktop/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as TokenReply["body"] };
  } catch {
    return { status: 0, body: {} };
  }
}

async function forget(): Promise<void> {
  saved = null;
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
  await persist(null);
}

function schedule(inMs?: number): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  if (!saved) return;
  // Five minutes before the access token lapses, never sooner than 30 seconds.
  const due = inMs ?? Math.max(30_000, saved.session.expires_at * 1000 - Date.now() - 5 * 60_000);
  refreshTimer = setTimeout(() => void refresh(), due);
  refreshTimer.unref();
}

async function apply(reply: TokenReply, context: "sign-in" | "refresh"): Promise<void> {
  const { status, body } = reply;
  if (status === 200 && body.session && body.user) {
    saved = { session: body.session, user: body.user };
    await persist(saved);
    publish({ status: "signedIn", user: body.user });
    schedule();
    return;
  }
  if (status === 403) {
    await forget();
    publish({ status: "refused", message: body.error ?? "The desktop app is not open to this account yet." });
    return;
  }
  if (status === 400 || status === 401) {
    await forget();
    publish(
      context === "sign-in"
        ? { status: "error", message: body.error ?? "That sign-in did not go through. Try again." }
        : { status: "signedOut" },
    );
    return;
  }
  // Offline, or the site is having a moment. A session already held stays held
  // and is tried again in a minute; seasons on disk keep opening meanwhile.
  if (saved) {
    publish({ status: "signedIn", user: saved.user });
    schedule(60_000);
    return;
  }
  publish({ status: "error", message: "Could not reach Beyond the Arc. Check your connection and try again." });
}

async function refresh(): Promise<void> {
  if (!saved) return;
  await apply(await tokenRequest({ grant: "refresh", refresh_token: saved.session.refresh_token }), "refresh");
}

/** At launch: the stored session, shown at once, then confirmed with the site. */
export async function restoreSession(): Promise<void> {
  saved = await load();
  if (!saved) return;
  publish({ status: "signedIn", user: saved.user });
  await refresh();
}

/** Opens the connect page in the reader's browser and waits for btacbb://auth. */
export async function signIn(): Promise<void> {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(24).toString("base64url");
  pending = { verifier, state, startedAt: Date.now() };
  publish({ status: "waiting" });
  await shell.openExternal(`${SITE}/desktop/connect?${new URLSearchParams({ challenge, state }).toString()}`);
}

export function cancelSignIn(): void {
  pending = null;
  if (current.status === "waiting") publish(saved ? { status: "signedIn", user: saved.user } : { status: "signedOut" });
}

export async function signOut(): Promise<void> {
  pending = null;
  await forget();
  publish({ status: "signedOut" });
}

/**
 * A btacbb:// URL from the operating system: a second launch's argv on
 * Windows, open-url on macOS.
 *
 * ONLY A CALLBACK FOR THE SIGN-IN THIS PROCESS STARTED is redeemed: the state
 * must match, and the verifier only exists in memory here. A link that arrives
 * after a restart, or one someone else crafted, is refused before any request.
 */
export async function handleDeepLink(raw: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return;
  }
  if (url.protocol !== `${SCHEME}:` || url.hostname !== "auth") return;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const started = pending;
  if (!started || !code || state !== started.state || Date.now() - started.startedAt > PENDING_TTL_MS) {
    publish({
      status: "error",
      message: "That sign-in was not started from this window, or it has expired. Choose Sign in again.",
    });
    return;
  }
  pending = null;
  await apply(await tokenRequest({ grant: "code", code, verifier: started.verifier }), "sign-in");
}

/** A current access token for a gated request, refreshed first if it is about to lapse. */
export async function accessToken(): Promise<string | null> {
  if (!saved) return null;
  if (saved.session.expires_at * 1000 - Date.now() < 60_000) await refresh();
  return saved?.session.access_token ?? null;
}
