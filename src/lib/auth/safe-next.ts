/**
 * Where to send someone after they sign in, when a page sent them to sign in
 * first.
 *
 * AN ALLOW-LIST, NOT A PASS-THROUGH. A sign-in page that redirects to whatever
 * `?next=` says is an open redirect: a link to the real login page that lands a
 * freshly signed-in reader on a lookalike. Only same-site paths named here are
 * honored, and anything else falls back to wherever sign-in always went.
 *
 * The one page today is the desktop app's connect page, which needs the reader
 * back with its query string (the app's challenge and state) intact.
 */

const ALLOWED_PATHS = new Set(["/desktop/connect"]);
const ORIGIN = "https://btacbb.xyz";

export function safeNext(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    // Resolved against a fixed origin, so "//elsewhere.com" or "https://…"
    // resolve to another origin and are refused below.
    url = new URL(raw, ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== ORIGIN) return null;
  const path = url.pathname.replace(/\/+$/, "");
  if (!ALLOWED_PATHS.has(path)) return null;
  return `${url.pathname}${url.search}`;
}
