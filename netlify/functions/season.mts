import type { Context } from "@netlify/functions";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getSupabaseAdmin, requireUser } from "../shared/billing.mts";

/**
 * Serve one season's team data to a subscriber.
 *
 * GET /api/season/2019  ->  the same JSON the free seasons serve as a static
 *                           file, but only to someone entitled to it.
 *
 * WHY THIS EXISTS. The site is a static export: every page is prebuilt and
 * handed to a CDN, with nothing between a reader and a file. That is what
 * makes it fast, and it is also why a lock drawn by the browser is a sign
 * rather than a door — the visitor's own machine decides whether to draw it.
 * This function is the only place on the site that can actually refuse.
 *
 * THE FILES ARE NOT ON THE WEBSITE. A gated season is excluded from `out/` at
 * build time and referenced by `[functions] included_files` in netlify.toml,
 * so it lives on this function's filesystem and nowhere a URL can reach. That
 * is the whole mechanism: the check is only meaningful because the thing being
 * checked for cannot be fetched around it.
 *
 * TRUST MODEL, same as billing.mts. Identity comes from a bearer token that
 * Supabase validates — never from the request body. Entitlement is read with
 * the service key from a column the user cannot write. Nothing the browser
 * says about who it is or what it has paid for is believed.
 */

/**
 * Subscription states that count as paid.
 *
 * DELIBERATELY DUPLICATED from src/lib/auth/membership.ts rather than
 * imported. That module is client code shipped to the browser and describes
 * what to *show* someone; this is the server deciding what to *give* them.
 * A shared constant across that boundary invites a future change made for the
 * dashboard's benefit to quietly widen who gets the data.
 *
 * `past_due` counts as paid on purpose, matching the dashboard: the
 * subscription has not been cancelled, a payment failed and Stripe is
 * retrying. Cutting access at the first failed charge locks out anyone whose
 * card simply expired.
 */
const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

/** 2014-2027, and nothing else — the parameter is a filesystem path segment. */
function parseYear(raw: string | undefined): number | null {
  if (!raw || !/^\d{4}$/.test(raw)) return null;
  const y = Number(raw);
  return y >= 2000 && y <= 2100 ? y : null;
}

/**
 * Which staged corpus a request is for, from the path.
 *
 *   /api/season/2019          -> teams   (the original shape, still honoured)
 *   /api/season/players/2019  -> players
 *
 * AN ALLOW-LIST, NOT A PATH JOIN. Both segments end up in a filesystem path,
 * so `kind` is matched against a fixed map rather than interpolated — the
 * year is already constrained to four digits, and this closes the other half.
 * Mirrors GATED_CORPORA in src/lib/access.ts; duplicated for the same reason
 * ACTIVE_STATUSES is, so a client-side edit cannot widen what the server hands
 * out.
 */
const CORPUS_DIR: Record<string, string> = {
  teams: "teams-by-year",
  players: "players-explorer",
};

function parseTarget(pathname: string): { dir: string; year: number } | null {
  const parts = pathname.split("/").filter(Boolean);
  const year = parseYear(parts.pop());
  if (year === null) return null;
  const last = parts.pop() ?? "";
  // The bare /api/season/<year> form has "season" where a kind would be.
  const kind = last === "season" ? "teams" : last;
  const dir = CORPUS_DIR[kind];
  return dir ? { dir, year } : null;
}

/**
 * THE ROUTE, DECLARED ON THE FUNCTION — and why it is also in netlify.toml.
 *
 * Production has always routed this through a netlify.toml redirect
 * (`/api/season/* -> /.netlify/functions/season/:splat`, status 200). That
 * works in production and ONLY in production: `netlify functions:serve`, which
 * is what `npm run dev` runs on :9999, does not read netlify.toml. It reads
 * this. So locally the app fetched /api/season/2021 and got a 404 while the
 * function sat there answering perfectly well on
 * /.netlify/functions/season/2021.
 *
 * The effect was that THE PAYWALL WAS THE ONE FEATURE THAT COULD NOT BE TESTED
 * LOCALLY — an archive season in the explorer always failed, and always with
 * the same message a real entitlement failure produces ("unavailable right
 * now"), so the gap read as a bug in the gate rather than a gap in dev
 * routing. Every other function in this directory declares its own path; this
 * was the only one that did not.
 *
 * BOTH SHAPES, EXPLICITLY, because parseTarget honours both and a splat would
 * not tell you that. The pathname the function receives is identical under
 * either routing mechanism, which is what makes adding this safe: the redirect
 * stays where it is, the two agree, and dev now matches prod.
 */
export const config = {
  path: ["/api/season/:year", "/api/season/:kind/:year"],
};

export default async (req: Request, _context: Context) => {
  if (req.method !== "GET") {
    return Response.json({ error: "GET only" }, { status: 405 });
  }

  const target = parseTarget(new URL(req.url).pathname);
  if (!target) {
    return Response.json(
      { error: "Expected /api/season/<year> or /api/season/<kind>/<year>." },
      { status: 400 },
    );
  }
  const { dir, year } = target;

  const user = await requireUser(req);
  if (!user) {
    return Response.json(
      { error: "Sign in to read this season.", reason: "signed-out" },
      { status: 401 },
    );
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    // A config problem, not the caller's fault. Say so rather than returning
    // 403, which would read to a paying subscriber as "you are not entitled".
    return Response.json(
      { error: "Access checks are not configured on this deploy." },
      { status: 503 },
    );
  }

  const { data, error } = await admin
    .from("profiles")
    .select("role,subscription_status")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[season] profile read failed:", error.message);
    return Response.json({ error: "Could not verify your subscription." }, { status: 503 });
  }

  const profile = data as { role: string | null; subscription_status: string | null } | null;
  const paid =
    profile?.role === "admin" || ACTIVE_STATUSES.has(profile?.subscription_status ?? "");

  if (!paid) {
    return Response.json(
      { error: "This season is part of the Season Pass.", reason: "not-subscribed" },
      { status: 403 },
    );
  }

  // `included_files` lands the gated tree next to the bundled function, so the
  // path is resolved from the process working directory rather than guessed
  // relative to this module — esbuild rewrites the module's own location.
  const file = path.join(process.cwd(), "gated-data", dir, `${year}.json`);
  let body: string;
  try {
    body = await readFile(file, "utf8");
  } catch {
    // Either the year does not exist or it is a FREE season, which is never
    // bundled here. Both are 404 — telling the caller which would let them map
    // the paywall's shape without an account.
    return Response.json({ error: "No such season." }, { status: 404 });
  }

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // PRIVATE, and never at a shared edge. This response is entitlement-
      // specific; a CDN that cached it would hand one subscriber's season to
      // the next signed-out visitor who asked. The browser may keep it for the
      // session, which is enough — flicking between seasons stays instant.
      "cache-control": "private, max-age=300",
    },
  });
};
