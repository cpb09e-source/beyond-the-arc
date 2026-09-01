"use client";

import { getSupabaseBrowser } from "@/lib/auth/supabase-browser";

/**
 * The admin page's calls to its endpoint.
 *
 * Same bearer-token shape as checkout.ts, kept separate rather than shared:
 * that helper's error strings talk about payments, and "Payments are not
 * served on this port" is the wrong sentence to show someone who was editing
 * a banner. The mechanism is four lines; the wording is the part that matters.
 *
 * EVERY CALL IS RE-AUTHORISED SERVER-SIDE. This file holds no privilege — it
 * attaches the caller's own token and the function decides. See requireAdmin.
 */

const ENDPOINT = "/api/admin-config";

async function token(): Promise<string> {
  const supabase = getSupabaseBrowser();
  if (!supabase) throw new Error("Accounts are unavailable right now.");
  const { data } = await supabase.auth.getSession();
  const t = data.session?.access_token;
  if (!t) throw new Error("Sign in first.");
  return t;
}

async function call(init: RequestInit & { query?: string }): Promise<Record<string, unknown>> {
  const t = await token();
  const res = await fetch(ENDPOINT + (init.query ?? ""), {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${t}` },
  });
  // The same port trap checkout.ts documents: `npm run dev` puts Next on 3000
  // and the proxy on 8899, and only the proxy serves netlify/functions. On
  // :3000 this page looks fine and every save fails.
  if (res.status === 404 && !res.headers.get("content-type")?.includes("json")) {
    throw new Error("Admin functions are not served on this port. Open http://localhost:8899.");
  }
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error((payload.error as string) || `Request failed (${res.status}).`);
  return payload;
}

export type Banner = {
  enabled: boolean;
  message: string;
  tone: "info" | "warn";
  href?: string;
  label?: string;
};

export type ManualTransfer = {
  id: string;
  player_name: string;
  bart_player_id: number | null;
  destination: string;
  confirmed_on: string;
  note: string | null;
  active: boolean;
  created_at: string;
};

export async function readBanner(): Promise<Banner | null> {
  const r = await call({ method: "GET", query: "?what=banner" });
  return (r.banner as Banner | null) ?? null;
}

export async function saveBanner(value: Banner): Promise<void> {
  await call({ method: "POST", body: JSON.stringify({ what: "banner", value }) });
}

export async function readTransfers(): Promise<ManualTransfer[]> {
  const r = await call({ method: "GET", query: "?what=transfers" });
  return (r.transfers as ManualTransfer[]) ?? [];
}

export async function addTransfer(t: {
  player_name: string;
  destination: string;
  /** Optional, and never guessed on the caller's behalf — see the migration. */
  bart_player_id?: number | null;
  confirmed_on?: string;
  note?: string;
}): Promise<void> {
  await call({ method: "POST", body: JSON.stringify({ what: "transfer", ...t }) });
}

/** Withdraw a claim, or put a withdrawn one back. Never deletes — see the migration. */
export async function setTransferActive(id: string, active: boolean): Promise<void> {
  await call({ method: "POST", body: JSON.stringify({ what: "transfer", id, active }) });
}
