import type { Context } from "@netlify/functions";
import { requireAdmin } from "../shared/billing.mts";

/**
 * Where the site's download button gets the Windows installer.
 *
 * GET /api/desktop/download   Authorization: Bearer <site session>
 *   -> 200 { url, version }   the current installer
 *   -> 401 / 404              signed out, or not an administrator
 *
 * ADMIN ONLY, because the app is in early access and unsigned. The rule lives
 * here, on the server, so widening it is a deploy of this file and nothing in
 * the browser decides it.
 *
 * THE INSTALLER ITSELF IS AN ORDINARY PUBLIC OBJECT, next to the update feed
 * the app polls (desktop/latest.yml on the public bucket). That is deliberate
 * and safe: the app opens nothing until an entitled account signs in through
 * /desktop/connect, and every refresh re-checks the account, so a forwarded
 * link hands someone a program that asks them to sign in and then declines.
 * Keeping the bytes public is also what lets electron-updater fetch updates
 * without an Authorization header, which it would otherwise forward to storage
 * that refuses a request carrying two kinds of credential.
 */

export const config = { path: "/api/desktop/download" };

const PUBLIC_BASE = process.env.DESKTOP_RELEASE_BASE ?? "https://pub-86f242cc47a6490a8a66813d2650b86d.r2.dev/desktop";

export default async (req: Request, _context: Context) => {
  if (req.method !== "GET") {
    return Response.json({ error: "GET only" }, { status: 405 });
  }

  const gate = await requireAdmin(req, "desktop-download");
  if ("response" in gate) return gate.response;

  // latest.yml is the feed electron-updater reads; its `path` is the installer.
  const feed = await fetch(`${PUBLIC_BASE}/latest.yml`, { headers: { "cache-control": "no-cache" } });
  if (!feed.ok) {
    return Response.json({ error: "No release has been published yet." }, { status: 404 });
  }
  const text = await feed.text();
  const version = /^version:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? null;
  const file = /^path:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? null;
  if (!version || !file || !/^[\w.-]+\.exe$/.test(file)) {
    return Response.json({ error: "The published release is malformed." }, { status: 502 });
  }

  return Response.json(
    { url: `${PUBLIC_BASE}/${encodeURIComponent(file)}`, version },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
};
