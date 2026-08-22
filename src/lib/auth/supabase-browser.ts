import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The BROWSER auth client — deliberately separate from src/lib/supabase.ts.
 *
 * That module sets `persistSession: false`, which is correct for what it does
 * (server-side reads and the sync scripts, where a persisted session would be
 * meaningless or actively wrong). Auth needs the opposite: the session has to
 * survive a reload, refresh itself before the access token expires, and be
 * shared across tabs. Reusing the existing client would mean a login that
 * silently evaporates on the next page load, so the two stay separate rather
 * than one being retuned to serve both.
 *
 * Created LAZILY. The site is a static export, so every page — this provider
 * included — is prerendered at build time in Node, where there is no
 * localStorage for the auth adapter to bind to. Constructing at module scope
 * would run that setup during the build; constructing on first use in the
 * browser does not.
 */
let client: SupabaseClient | null = null;

export function getSupabaseBrowser(): SupabaseClient | null {
  if (typeof window === "undefined") return null;
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    // Returning null rather than throwing: a missing key should degrade to
    // "accounts are unavailable" on one page, not white-screen the whole site.
    console.error("[auth] NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY missing");
    return null;
  }

  client = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Reads the token fragment on redirect back from a recovery or magic
      // link. Nothing uses those yet; having it on means the callback works
      // whenever password reset ships, rather than failing once, mysteriously.
      detectSessionInUrl: true,
      storageKey: "bta-auth",
    },
  });
  return client;
}
