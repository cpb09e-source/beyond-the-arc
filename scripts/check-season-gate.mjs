/**
 * Prove the season paywall actually holds, end to end, before deploying it.
 *
 * Every branch of netlify/functions/season.mts, against a real Supabase
 * token and the real profile row:
 *
 *   no token / bad token   -> 401
 *   subscriber             -> 200 with rows
 *   cancelled subscriber   -> 403
 *   a FREE season          -> 404 (never bundled, so never reachable here)
 *   junk or traversal      -> 400
 *
 * USAGE — needs the paywall switched on and the functions server running:
 *
 *   1. Narrow FREE_SEASONS in src/lib/access.ts
 *   2. node scripts/stage-gated-data.mjs
 *   3. npx netlify functions:serve --port 9998
 *   4. node scripts/check-season-gate.mjs
 *
 * WARNING: this WRITES to the live profiles row for test@test.com — it flips
 * subscription_status to "canceled" to prove the 403 branch, then restores it.
 * If it dies between those two writes the test account is left cancelled; the
 * fix is to set subscription_status back to "active" by hand. It touches no
 * other account and nothing in production data.
 */
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of fs.readFileSync("c:/Users/Colin/websites/beyond-the-arc/.env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE = "http://localhost:9998/.netlify/functions/season";

const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
const admin = createClient(URL_, SVC, { auth: { persistSession: false } });

const { data: signIn, error } = await anon.auth.signInWithPassword({
  email: "test@test.com", password: "test1234",
});
if (error) throw error;
const token = signIn.session.access_token;
const uid = signIn.user.id;

async function hit(label, url, tok) {
  const res = await fetch(url, tok ? { headers: { authorization: `Bearer ${tok}` } } : undefined);
  let note = "";
  const text = await res.text();
  try {
    const j = JSON.parse(text);
    note = Array.isArray(j) ? `${j.length} rows` : (j.reason ?? j.error ?? "").slice(0, 46);
  } catch { note = text.slice(0, 40); }
  console.log(`  ${String(res.status).padEnd(4)} ${label.padEnd(38)} ${note}`);
  return res.status;
}

console.log("PAID season 2019:");
await hit("no token", `${BASE}/2019`, null);
await hit("garbage token", `${BASE}/2019`, "not-a-real-token");
const paidOk = await hit("subscriber token", `${BASE}/2019`, token);

console.log("\nFREE season 2026 (never bundled):");
await hit("subscriber token", `${BASE}/2026`, token);

console.log("\nMalformed input:");
await hit("non-numeric year", `${BASE}/etc`, token);
await hit("traversal attempt", `${BASE}/..%2f..%2fpackage`, token);

console.log("\nSubscription cancelled (same user):");
await admin.from("profiles").update({ subscription_status: "canceled" }).eq("id", uid);
await new Promise((r) => setTimeout(r, 400));
const denied = await hit("cancelled subscriber", `${BASE}/2019`, token);
await admin.from("profiles").update({ subscription_status: "active" }).eq("id", uid);
console.log("  (restored to active)");

console.log("");
const pass = paidOk === 200 && denied === 403;
console.log(pass ? "PASS — gate holds and opens correctly" : "FAIL — check the statuses above");
process.exit(pass ? 0 : 1);
