import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY in env"
  );
}

// Browser- and server-component safe client. Uses anon key, so RLS applies.
export const supabase = createClient<Database>(url, anonKey, {
  auth: { persistSession: false },
});

// Service-role client. Bypasses RLS — use only in scripts and server actions
// that need to write. Errors loudly if the key is missing.
export function supabaseAdmin() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Add it to .env.local before running sync scripts."
    );
  }
  return createClient<Database>(url!, serviceKey, {
    auth: { persistSession: false },
  });
}
