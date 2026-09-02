"use client";

/**
 * What GitHub says about the nightly — read from the browser, with no token.
 *
 * ── WHY NO TOKEN ──────────────────────────────────────────────────────────
 *
 * The repository is public. Its workflow runs, their state, and the commit
 * graph are readable by anyone at api.github.com, with CORS, at sixty
 * requests an hour per address. The admin page needs three: is the workflow
 * enabled, is a run going, how far is the deployed commit behind main. A
 * round trip through a function with a token would spend an invocation to
 * learn a public fact. STARTING a run is the one thing that needs a token,
 * and that is netlify/functions/dispatch-run.mts.
 *
 * ── SIXTY AN HOUR IS THE BUDGET ───────────────────────────────────────────
 *
 * A page open all day polling every thirty seconds would spend it in half an
 * hour and then show nothing. So: two calls on load, one more when a deploy
 * is known, and while a run is in progress one call every POLL_MS — a
 * twenty-five-minute run is about thirty calls. When GitHub says the budget
 * is gone the reader is told when it comes back, rather than shown a stale
 * "running" forever.
 */

export const REPO = "cpb09e-source/beyond-the-arc";
export const WORKFLOW = "nightly-refresh.yml";
export const WORKFLOW_URL = `https://github.com/${REPO}/actions/workflows/${WORKFLOW}`;

const API = `https://api.github.com/repos/${REPO}`;

/** While a run is in progress. Forty-five seconds keeps a long run inside the hourly budget. */
export const POLL_MS = 45_000;

export type RunStatus = "queued" | "waiting" | "pending" | "requested" | "in_progress" | "completed";

export type WorkflowRun = {
  id: number;
  status: RunStatus;
  /** success · failure · cancelled · timed_out · … — null until completed. */
  conclusion: string | null;
  /** "schedule" for the nightly, "workflow_dispatch" for a button. */
  event: string;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  url: string;
};

export type Workflow = {
  /** "active", or "disabled_manually" / "disabled_inactivity" — GitHub's words. */
  state: string;
  url: string;
  /** Newest first. */
  runs: WorkflowRun[];
  /** The one in progress, if any. */
  running: WorkflowRun | null;
};

export class RateLimited extends Error {
  constructor(public readonly resetAt: number) {
    super(`GitHub is rate-limiting this address until ${new Date(resetAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
  }
}

async function gh<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(API + path, {
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    cache: "no-store",
    signal,
  });
  if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(res.headers.get("x-ratelimit-reset") ?? 0) * 1000;
    throw new RateLimited(reset || Date.now() + 60 * 60_000);
  }
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${path}`);
  return (await res.json()) as T;
}

const ACTIVE: ReadonlySet<string> = new Set(["queued", "waiting", "pending", "requested", "in_progress"]);

type RawRun = {
  id: number; status: string; conclusion: string | null; event: string;
  created_at: string; run_started_at?: string | null; updated_at: string; html_url: string;
};

/** Two calls: the workflow itself (for its state) and its last few runs. */
export async function readWorkflow(signal?: AbortSignal): Promise<Workflow> {
  const [wf, runs] = await Promise.all([
    gh<{ state: string; html_url: string }>(`/actions/workflows/${WORKFLOW}`, signal),
    gh<{ workflow_runs: RawRun[] }>(`/actions/workflows/${WORKFLOW}/runs?per_page=6`, signal),
  ]);
  const list: WorkflowRun[] = runs.workflow_runs.map((r) => ({
    id: r.id,
    status: r.status as RunStatus,
    conclusion: r.conclusion,
    event: r.event,
    createdAt: r.created_at,
    startedAt: r.run_started_at ?? null,
    updatedAt: r.updated_at,
    url: r.html_url,
  }));
  return {
    state: wf.state,
    url: wf.html_url,
    runs: list,
    running: list.find((r) => ACTIVE.has(r.status)) ?? null,
  };
}

/** Just the runs — the poll while one is going. One call. */
export async function readRuns(signal?: AbortSignal): Promise<Pick<Workflow, "runs" | "running">> {
  const runs = await gh<{ workflow_runs: RawRun[] }>(`/actions/workflows/${WORKFLOW}/runs?per_page=6`, signal);
  const list: WorkflowRun[] = runs.workflow_runs.map((r) => ({
    id: r.id, status: r.status as RunStatus, conclusion: r.conclusion, event: r.event,
    createdAt: r.created_at, startedAt: r.run_started_at ?? null, updatedAt: r.updated_at, url: r.html_url,
  }));
  return { runs: list, running: list.find((r) => ACTIVE.has(r.status)) ?? null };
}

// ── The deploy ─────────────────────────────────────────────────────────────

/**
 * Written into out/ by scripts/build-with-r2-stash.mjs at the end of every
 * build, so the deployed site can say which commit it is. Absent on a build
 * that predates it.
 */
export type BuildInfo = {
  sha: string;
  branch: string;
  builtAt: string;
  /** Uncommitted changes were present at build time — the sha is not the whole story. */
  dirty: boolean;
};

export type Deploy = BuildInfo & {
  /** Commits on main the deployed sha does not have. Null if GitHub could not say. */
  behind: number | null;
  compareUrl: string;
};

/** The site's own origin, never R2 — this file is part of the deploy. */
export async function readBuildInfo(): Promise<BuildInfo | null> {
  const res = await fetch(`/build-info.json?t=${Date.now()}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${res.status} from /build-info.json`);
  // Next dev serves a directory listing or an HTML 404 page for a missing
  // static file with status 200 on some paths; a non-JSON body is "absent".
  if (!res.headers.get("content-type")?.includes("json")) return null;
  return (await res.json()) as BuildInfo;
}

/** One call: how far main has moved past the deployed commit. */
export async function readDeploy(info: BuildInfo, signal?: AbortSignal): Promise<Deploy> {
  const compareUrl = `https://github.com/${REPO}/compare/${info.sha.slice(0, 12)}...main`;
  try {
    const c = await gh<{ ahead_by: number; status: string }>(`/compare/${info.sha}...main`, signal);
    return { ...info, behind: c.ahead_by, compareUrl };
  } catch (e) {
    if (e instanceof RateLimited) throw e;
    return { ...info, behind: null, compareUrl };
  }
}
