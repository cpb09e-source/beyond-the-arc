import type { Context } from "@netlify/functions";
import { requireAdmin } from "../shared/billing.mts";

/**
 * dispatch-run — the admin page's Run buttons, on the server side.
 *
 * POST /api/dispatch-run { phases, season?, dryRun?, noSync? }
 *   → GitHub workflow_dispatch on .github/workflows/nightly-refresh.yml
 *
 * ── WHY A FUNCTION AT ALL ─────────────────────────────────────────────────
 *
 * Starting a workflow needs a token with Actions: write on the repository,
 * and that token cannot go to the browser: the site is a static export and
 * its JavaScript is public. So the page asks here, requireAdmin decides, and
 * the token stays in the function's environment. This is the ONLY thing the
 * function does. Reading what the workflow is doing — is a run in progress,
 * is the workflow enabled — needs no token, because the repository is
 * public, so the page reads that straight from api.github.com (see
 * src/lib/github-runs.ts) and no round trip through here is spent on it.
 *
 * ── WHAT IS AND IS NOT VALIDATED ──────────────────────────────────────────
 *
 * `phases` must be one of the workflow's own choice options, listed here
 * verbatim. The workflow would refuse anything else with a 422, but refusing
 * it here means the error names the actual problem rather than echoing
 * GitHub's. `season` is a four-digit year or absent. The two booleans are
 * sent as the strings GitHub expects for boolean inputs.
 *
 * Rollback is dispatchable from here on purpose — it is what the red button
 * is for — and it is the workflow, not this function, that decides what a
 * rollback restores. Nothing here knows about R2.
 *
 * Environment:
 *   GITHUB_DISPATCH_TOKEN  a fine-grained PAT scoped to this repository with
 *                          Actions: read and write. Nothing else.
 */
export const config = { path: "/api/dispatch-run" };

const TAG = "dispatch-run";

/** owner/repo and the workflow file — the same two the page links to. */
export const REPO = "cpb09e-source/beyond-the-arc";
export const WORKFLOW = "nightly-refresh.yml";

/** The workflow's `phases` choice options, verbatim. */
const PHASES = new Set(["ingest,derive,publish", "publish", "derive,publish", "ingest", "rollback"]);

function bad(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export default async function handler(req: Request, _ctx: Context) {
  if (req.method !== "POST") return bad("Method not allowed.", 405);

  const gate = await requireAdmin(req, TAG);
  if ("response" in gate) return gate.response;

  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) return bad("No GitHub token on this deploy. Set GITHUB_DISPATCH_TOKEN.", 503);

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; }
  catch { return bad("Body must be JSON."); }

  const phases = typeof body.phases === "string" ? body.phases : "";
  if (!PHASES.has(phases)) return bad(`phases must be one of: ${[...PHASES].join(" · ")}`);

  const season = body.season === undefined || body.season === null || body.season === "" ? null : String(body.season);
  if (season !== null && !/^\d{4}$/.test(season)) return bad("season must be a four-digit year, or left blank.");

  const inputs: Record<string, string> = {
    phases,
    dry_run: body.dryRun === true ? "true" : "false",
    no_sync: body.noSync === true ? "true" : "false",
  };
  if (season) inputs.season = season;

  const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "beyond-the-arc-admin",
    },
    body: JSON.stringify({ ref: "main", inputs }),
    signal: AbortSignal.timeout(12_000),
  });

  // 204 is the only success. Everything else carries GitHub's own message,
  // which is specific ("Workflow does not have 'workflow_dispatch' trigger",
  // "Resource not accessible by personal access token") and worth passing
  // through rather than flattening to "failed".
  if (res.status === 204) {
    console.log(`[${TAG}] ${gate.user.email ?? gate.user.id} dispatched ${phases}${season ? ` --season ${season}` : ""}${inputs.dry_run === "true" ? " (dry run)" : ""}${inputs.no_sync === "true" ? " (no sync)" : ""}`);
    return Response.json({ ok: true, phases, inputs });
  }
  let message = `GitHub answered ${res.status}`;
  try {
    const j = (await res.json()) as { message?: string };
    if (j?.message) message = `GitHub: ${j.message}`;
  } catch { /* no body */ }
  console.error(`[${TAG}] dispatch failed:`, res.status, message);
  // 401/403 from GitHub are about OUR token, not the caller's session, so
  // they come back as 502: the request was fine, the upstream refused it.
  return bad(message, res.status === 422 ? 422 : 502);
}
