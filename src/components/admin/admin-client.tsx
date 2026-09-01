"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuthOptional } from "@/lib/auth/auth-provider";
import { dataUrl } from "@/lib/data-url";
import { LIVE_SEASON } from "@/lib/seasons";
import { cn } from "@/lib/utils";

/**
 * /admin — what the nightly pipeline did, and the button that will run it.
 *
 * ── WHAT THIS GATE IS AND IS NOT ──────────────────────────────────────────
 *
 * `role === "admin"` here is PRESENTATION, exactly like every other gate that
 * reads the profile in the browser (see the header of src/lib/access.ts). The
 * site is a static export: this page's JavaScript ships to everyone and anyone
 * can read it. Hiding the panel is a courtesy to the 99.9% of readers for whom
 * it is noise, not a security boundary.
 *
 * That is acceptable here only because THE PAGE HOLDS NOTHING SECRET. The run
 * record it shows is a public R2 object, and it is public because it contains
 * step names and durations, which are not worth protecting. The one thing that
 * would need protecting — the token that triggers a run — never comes near the
 * browser: the Run button will call a Netlify function that holds it, and that
 * function will do its own server-side check. Nothing on this page is trusted
 * to decide anything.
 *
 * ── THE BUTTON IS DELIBERATELY INERT ──────────────────────────────────────
 *
 * There is no dispatch endpoint yet and the workflow is disabled, so a button
 * that appeared to work would be lying twice over. It renders disabled with
 * the reason attached, which is more useful than hiding it: the point of the
 * shell is to see the shape of the finished thing.
 */

type StepStatus = "ok" | "failed" | "skipped";

type RefreshStatus = {
  season: number;
  phases: string[];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  outcome: "ok" | "failed";
  failedAt: string | null;
  dryRun: boolean;
  steps: Array<{ step: string; note?: string; ms: number; status: StepStatus }>;
};

/** "4m 12s" — a nightly step's duration, which is never hours and often under a second. */
function dur(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/** "3 hours ago" — the only question anyone asks of a nightly job's timestamp. */
function ago(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  return `${Math.round(hrs / 24)} days ago`;
}

export function AdminClient() {
  const auth = useAuthOptional();
  const [status, setStatus] = useState<RefreshStatus | null>(null);
  const [statusState, setStatusState] = useState<"loading" | "none" | "ready">("loading");

  useEffect(() => {
    let live = true;
    fetch(dataUrl("/data/live/refresh-status.json"))
      .then((r) => (r.ok ? (r.json() as Promise<RefreshStatus>) : null))
      .then((j) => {
        if (!live) return;
        if (j) { setStatus(j); setStatusState("ready"); } else setStatusState("none");
      })
      .catch(() => { if (live) setStatusState("none"); });
    return () => { live = false; };
  }, []);

  const isAdmin = auth?.profile?.role === "admin";
  const settling = !auth || auth.status === "loading" || auth.profileLoading;

  if (settling) {
    return <Shell><p className="text-ink-muted text-sm">Checking your account…</p></Shell>;
  }

  /**
   * One message for "not signed in" and "signed in, not staff".
   *
   * Not to be coy — the route is in the bundle and anyone determined already
   * knows it exists. It is that the distinction is useless to both readers:
   * neither has anything to do here, and "you are not an administrator" reads
   * as an accusation to someone who arrived by mistyping a URL.
   */
  if (!isAdmin) {
    return (
      <Shell>
        <h1 className="text-xl font-semibold text-ink mb-2">Nothing here</h1>
        <p className="text-ink-muted text-sm">
          This page is for site administration.{" "}
          <Link href="/" className="text-coral hover:underline">Back to Beyond the Arc</Link>.
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <header className="mb-6">
        <p className="text-[0.6rem] uppercase tracking-widest text-coral font-bold mb-1">Admin</p>
        <h1 className="text-2xl font-semibold text-ink">Nightly refresh</h1>
        <p className="text-ink-muted text-sm mt-1">
          The in-season pipeline: pull the night&rsquo;s games, rebuild the derived numbers,
          publish the live season&rsquo;s files. The site is never rebuilt.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem] items-start">
        <section className="rounded-xl border border-ink/10 bg-card shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-hairline flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-ink">Last run</h2>
            {status && (
              <span
                className={cn(
                  "text-[0.6rem] uppercase tracking-widest font-bold px-2 py-0.5 rounded",
                  status.outcome === "ok" ? "bg-good/15 text-good" : "bg-bad/15 text-bad",
                )}
              >
                {status.outcome === "ok" ? "Succeeded" : "Failed"}
              </span>
            )}
          </div>

          {statusState === "loading" && (
            <p className="px-4 py-6 text-sm text-ink-muted">Reading the run record…</p>
          )}

          {statusState === "none" && (
            <div className="px-4 py-6">
              <p className="text-sm text-ink">No run recorded yet.</p>
              <p className="text-sm text-ink-muted mt-1">
                The pipeline writes its record on every run, including a failed one. Nothing
                has run since it was built.
              </p>
            </div>
          )}

          {statusState === "ready" && status && (
            <>
              <dl className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 border-b border-hairline">
                <Fact label="Season" value={String(status.season)} />
                <Fact label="Finished" value={ago(status.finishedAt)} />
                <Fact label="Took" value={dur(status.durationMs)} />
                <Fact label="Phases" value={status.phases.join(", ")} />
              </dl>

              {status.failedAt && (
                <p className="px-4 py-3 text-sm text-bad border-b border-hairline">
                  Stopped at <code className="font-mono text-xs">{status.failedAt}</code>. Nothing
                  after it ran.
                </p>
              )}

              {/* Wide content scrolls inside its own box — a step is a full command line
                  and the page must not scroll sideways because of one. */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[0.6rem] uppercase tracking-widest text-ink-muted">
                      <th className="px-4 py-2 font-medium">Step</th>
                      <th className="px-4 py-2 font-medium text-right tabular-nums">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.steps.map((s, i) => (
                      <tr key={i} className="border-t border-hairline align-top">
                        <td className="px-4 py-2">
                          <span className="flex items-start gap-2">
                            <StepDot status={s.status} />
                            <span className="min-w-0">
                              <code className="font-mono text-xs text-ink break-all">{s.step}</code>
                              {s.note && (
                                <span className="block text-[0.7rem] text-ink-muted mt-0.5">{s.note}</span>
                              )}
                            </span>
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-ink-muted whitespace-nowrap">
                          {s.status === "skipped" ? "—" : dur(s.ms)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        <aside className="rounded-xl border border-ink/10 bg-card shadow-sm p-4">
          <h2 className="text-sm font-semibold text-ink mb-3">Run it</h2>

          <button
            type="button"
            disabled
            className="w-full h-10 rounded-md bg-coral/90 text-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Run now
          </button>

          <p className="text-[0.7rem] text-ink-muted mt-2 leading-relaxed">
            Not wired yet. It needs the repository secrets loaded and the workflow
            re-enabled — until then this would fail rather than do nothing, which is worse.
          </p>

          <hr className="my-4 border-hairline" />

          <h3 className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium mb-2">
            Meanwhile
          </h3>
          <ul className="text-[0.7rem] text-ink-muted space-y-2 leading-relaxed">
            <li>
              <a
                href="https://github.com/cpb09e-source/beyond-the-arc/actions/workflows/nightly-refresh.yml"
                target="_blank"
                rel="noreferrer"
                className="text-coral hover:underline"
              >
                Run it on GitHub
              </a>{" "}
              — the same job, with the same inputs.
            </li>
            <li>
              Live season:{" "}
              <strong className="text-ink">
                {LIVE_SEASON === null ? "none" : LIVE_SEASON}
              </strong>
              {LIVE_SEASON === null && " — nothing is being played, so a run has nothing to publish."}
            </li>
          </ul>
        </aside>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-5xl px-6 lg:px-10 py-10">{children}</main>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">{label}</dt>
      <dd className="text-sm text-ink mt-0.5">{value}</dd>
    </div>
  );
}

/**
 * Status as shape AND colour, not colour alone — the three states have to be
 * distinguishable without relying on red/green, which is the one pair a large
 * share of readers cannot separate.
 */
function StepDot({ status }: { status: StepStatus }) {
  const glyph = status === "ok" ? "✓" : status === "failed" ? "✕" : "·";
  return (
    <span
      aria-label={status}
      className={cn(
        "shrink-0 mt-0.5 w-4 text-center text-xs font-bold",
        status === "ok" && "text-good",
        status === "failed" && "text-bad",
        status === "skipped" && "text-ink-muted",
      )}
    >
      {glyph}
    </span>
  );
}
