"use client";

import { dataUrl } from "@/lib/data-url";
import { paidSeasons, paywallIsOff, publicSeasonFile, FREE_SEASONS } from "@/lib/access";
import { getSupabaseBrowser } from "@/lib/auth/supabase-browser";

/**
 * Live probes — the dashboard asking the site, right now, whether it works.
 *
 * ── WHAT THIS IS FOR ──────────────────────────────────────────────────────
 *
 * The nightly record says what the pipeline did hours ago. These say whether
 * a reader arriving THIS MINUTE gets a page: is R2 answering, is the season
 * function refusing what it should refuse, is the one file that must never be
 * on the CDN actually absent from it. Each is a request a real visitor makes,
 * made from the administrator's own browser, so it measures the path a reader
 * takes and not a health endpoint that could be green while the site is down.
 *
 * ── WHY THEY ARE DECLARATIVE ──────────────────────────────────────────────
 *
 * A probe is a URL and the status it must return. That is deliberately thin:
 * the value is in the LIST, in having "the gated season 404s on the public
 * path" written down where it runs every time the page opens, and a list is
 * easier to keep true than a set of functions. The two that cannot be a URL
 * (Supabase through the anon key) take a `run` instead.
 *
 * ── THE PAYWALL PROBE IS THE ONE THAT MATTERS ─────────────────────────────
 *
 * The archive gate is enforced by where files sit: stage-gated-data.mjs moves
 * a paid season out of `out/` at build time. If a build ever skips that step,
 * every paid season is on the CDN and nothing else on the site would notice —
 * the client asks the function, the function refuses correctly, and the file
 * sits one URL away the whole time. This is the only check that looks.
 *
 * Marked prodOnly: in dev the files are in public/ and the "leak" is real and
 * meaningless. The probe says "skipped locally" rather than crying wolf.
 */

export type ProbeState = "ok" | "warn" | "fail" | "skip";

export type ProbeResult = {
  state: ProbeState;
  /** One line a person reads: "200 in 84ms", "404 — leaked", "skipped locally". */
  detail: string;
  ms: number;
};

export type Probe = {
  id: string;
  label: string;
  /** Why this request, and what a failure means. Shown on hover. */
  why: string;
  /** Skipped outside production — see the header. */
  prodOnly?: boolean;
  /** "one CBBD call" and the like — a cost the reader should know they are paying. */
  cost?: string;
  run: (signal: AbortSignal) => Promise<ProbeResult>;
};

/** Past this, a request that succeeded still gets an amber: the site is up and slow. */
const SLOW_MS = 3000;
const TIMEOUT_MS = 10_000;

/**
 * Cache-busted. R2 serves an hour of max-age and a week of
 * stale-while-revalidate, and the browser applies both; a probe that reads
 * the cache is a probe of the cache. `no-store` bypasses the browser's copy,
 * and the query string bypasses any edge in front of the bucket.
 */
export function freshUrl(path: string): string {
  const u = dataUrl(path);
  return `${u}${u.includes("?") ? "&" : "?"}t=${Date.now()}`;
}

function http(
  url: string,
  expect: number[],
  opts: { method?: "GET" | "HEAD"; fresh?: boolean; onWrong?: (status: number) => ProbeResult | null } = {},
): Probe["run"] {
  return async (signal) => {
    const t0 = performance.now();
    let status: number;
    try {
      const res = await fetch(opts.fresh ? freshUrl(url) : url, {
        method: opts.method ?? "GET",
        cache: "no-store",
        signal,
      });
      status = res.status;
      // Drain a GET so the connection is reused. HEAD has nothing to drain.
      if (opts.method !== "HEAD") await res.arrayBuffer().catch(() => undefined);
    } catch (e) {
      const ms = Math.round(performance.now() - t0);
      const aborted = e instanceof DOMException && e.name === "AbortError";
      return { state: "fail", detail: aborted ? `no answer in ${TIMEOUT_MS / 1000}s` : "network error", ms };
    }
    const ms = Math.round(performance.now() - t0);
    if (!expect.includes(status)) {
      const custom = opts.onWrong?.(status);
      if (custom) return { ...custom, ms };
      return { state: "fail", detail: `${status}, expected ${expect.join(" or ")}`, ms };
    }
    if (ms > SLOW_MS) return { state: "warn", detail: `${status} but ${(ms / 1000).toFixed(1)}s`, ms };
    return { state: "ok", detail: `${status} in ${ms}ms`, ms };
  };
}

const paid = paidSeasons();
const oldestPaid = paid.length ? Math.min(...paid) : null;
const newestFree = FREE_SEASONS.length ? Math.max(...FREE_SEASONS) : null;

export const PROBES: Probe[] = [
  {
    id: "cdn",
    label: "Site is up",
    why: "The home page, from the CDN. Everything else assumes this.",
    run: http("/", [200], { method: "HEAD" }),
  },
  {
    id: "r2-team",
    label: "R2 serves team files",
    why: "One team's own JSON from the bucket — the request every team page makes.",
    run: http("/data/team/duke.json", [200], { fresh: true }),
  },
  {
    id: "r2-team-season",
    label: "R2 serves game logs",
    why: "One team-season game file — the request a team page's Game Log makes.",
    run: http(`/data/team-season-games/${newestFree ?? 2026}/duke.json`, [200], { fresh: true }),
  },
  {
    id: "run-record",
    label: "Run record is published",
    why: "The nightly's own receipt, on R2. Absent until the pipeline has run once.",
    run: http("/data/live/refresh-status.json", [200], {
      fresh: true,
      onWrong: (s) => (s === 404 ? { state: "warn", detail: "404 — no run has published yet", ms: 0 } : null),
    }),
  },
  ...(newestFree !== null
    ? [{
        id: "free-season",
        label: "Free season is public",
        why: `The ${newestFree} team corpus as a plain static file — what a signed-out reader loads.`,
        run: http(publicSeasonFile("teams", newestFree), [200], { method: "HEAD" }),
      }]
    : []),
  ...(!paywallIsOff() && oldestPaid !== null
    ? [
        {
          id: "paid-season-sealed",
          label: "Paid season is off the CDN",
          why: `${oldestPaid} teams must 404 on the public path. A 200 here means the archive paywall is open to everyone.`,
          prodOnly: true,
          run: http(publicSeasonFile("teams", oldestPaid), [404], {
            method: "HEAD",
            onWrong: (s) => (s === 200 ? { state: "fail", detail: "200 — LEAKED, the gated file is on the CDN", ms: 0 } : null),
          }),
        },
        {
          id: "paid-players-sealed",
          label: "Paid players are off the CDN",
          why: `${oldestPaid} players must 404 on the public path — the second door of the same wall.`,
          prodOnly: true,
          run: http(publicSeasonFile("players", oldestPaid), [404], {
            method: "HEAD",
            onWrong: (s) => (s === 200 ? { state: "fail", detail: "200 — LEAKED, the gated file is on the CDN", ms: 0 } : null),
          }),
        },
        {
          id: "season-fn",
          label: "Season function refuses",
          why: `/api/season/${oldestPaid} with no token must answer 401. Proves the function is deployed and gating.`,
          run: http(`/api/season/${oldestPaid}`, [401], {
            onWrong: (s) =>
              s === 200
                ? { state: "fail", detail: "200 with no token — the function is handing out paid data", ms: 0 }
                : s === 404
                  ? { state: "fail", detail: "404 — function not served here (dev: use :8899)", ms: 0 }
                  : null,
          }),
        },
      ]
    : []),
  {
    id: "scoreboard-fn",
    label: "Scoreboard function answers",
    why: "The live-data path: function up, CBBD key valid, feed reachable.",
    cost: "one CBBD call",
    run: http("/api/scoreboard", [200]),
  },
  {
    id: "supabase-anon",
    label: "Supabase answers the site",
    why: "site_config through the anon key — the read every page makes for the banner. Fails if the project is paused or the policy is gone.",
    run: async () => {
      const t0 = performance.now();
      const sb = getSupabaseBrowser();
      if (!sb) return { state: "fail", detail: "no Supabase client — env missing", ms: 0 };
      const { error } = await sb.from("site_config").select("key").limit(1);
      const ms = Math.round(performance.now() - t0);
      if (error) return { state: "fail", detail: error.message, ms };
      if (ms > SLOW_MS) return { state: "warn", detail: `ok but ${(ms / 1000).toFixed(1)}s`, ms };
      return { state: "ok", detail: `ok in ${ms}ms`, ms };
    },
  },
];

/**
 * Run every probe at once, with one timeout each. All at once because they
 * are independent and a reader does not want to wait for ten in a row; one
 * timeout each because the failure mode being looked for is "hangs".
 */
export async function runProbes(probes: Probe[] = PROBES): Promise<Map<string, ProbeResult>> {
  const isProd = process.env.NODE_ENV === "production";
  const out = new Map<string, ProbeResult>();
  await Promise.all(
    probes.map(async (p) => {
      if (p.prodOnly && !isProd) {
        out.set(p.id, { state: "skip", detail: "skipped locally — only meaningful on the deployed site", ms: 0 });
        return;
      }
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      try {
        out.set(p.id, await p.run(ctl.signal));
      } catch (e) {
        out.set(p.id, { state: "fail", detail: e instanceof Error ? e.message : "threw", ms: 0 });
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  return out;
}
