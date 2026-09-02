"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { dispatchRun } from "@/lib/admin-api";
import { WORKFLOW_URL, type Deploy, type Workflow } from "@/lib/github-runs";
import { useAuthOptional } from "@/lib/auth/auth-provider";
import { LIVE_SEASON } from "@/lib/seasons";
import { cn } from "@/lib/utils";
import { BannerPanel, TransfersPanel } from "@/components/admin/admin-panels";
import {
  Badge,
  ChecksSection,
  DataChecksSection,
  Fact,
  HistoryStrip,
  Section,
  SubscribersSection,
  Tile,
  WebhookNote,
  ago,
  dataChecksTile,
  deployTile,
  dur,
  pipelineTile,
  probesTile,
  subscribersTile,
  useDashboardData,
  webhookTile,
  type Loaded,
  type RefreshHistory,
  type RefreshStatus,
  type StepStatus,
} from "@/components/admin/admin-dashboard";

/**
 * /admin — is the site working, is the pipeline running, is anyone paying.
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
 * step names and durations, which are not worth protecting. The probes make
 * the same requests any visitor makes. The one thing that is not public — who
 * is paying — comes from a function that does its own server-side admin check
 * on every call (requireAdmin), and a non-admin who reaches this component
 * gets a 403 from it, not a number. Nothing on this page is trusted to decide
 * anything.
 *
 * ── THE ORDER IS THE ORDER OF ALARM ───────────────────────────────────────
 *
 * Tiles first, because on the morning something broke the whole page has to
 * answer "what" before it is scrolled. Then the sections the tiles point at,
 * in the same order. The two editorial panels — banner, transfers — come last:
 * they are the things an administrator comes here to DO, but nobody does them
 * while something is red, and a status page that opens with a form is a form.
 *
 * ── THE RUN BUTTONS START A JOB SOMEWHERE ELSE ────────────────────────────
 *
 * A button posts to /api/dispatch-run, which holds the GitHub token and asks
 * GitHub to start the workflow. Nothing runs here, and nothing here can see
 * the run except by asking GitHub how it is going — which the page does,
 * without a token, because the repository is public (github-runs.ts). So a
 * press is followed by a few seconds in which GitHub has accepted the
 * request and not yet listed the run; the aside says so rather than showing
 * nothing, because nothing looks like the button did not work.
 *
 * The buttons are disabled while a run is going. The workflow's own
 * concurrency group would queue a second one rather than overlap it, but a
 * queued run that starts twenty minutes later is a surprise, and a surprise
 * that re-pulls a night of box scores costs quota.
 */

/**
 * What the buttons dispatch, in the order someone reaches for them.
 *
 * Rollback is last and styled as the exception it is: it discards tonight's
 * publish and puts the previous one back. It is never part of a scheduled run
 * and the pipeline will not include it unless it is named.
 */
const RUNS: Array<{ label: string; phases: string; why: string; primary?: boolean; danger?: boolean }> = [
  { label: "Run everything", phases: "ingest,derive,publish", primary: true,
    why: "Pull the night's games, rebuild, publish." },
  { label: "Re-publish only", phases: "publish",
    why: "Rebuild the published files from what is already on disk. No network." },
  { label: "Derive and publish", phases: "derive,publish",
    why: "Recompute from the archive without re-pulling." },
  { label: "Roll back last publish", phases: "rollback", danger: true,
    why: "Restore the previous run's files. One generation only." },
];

export function AdminClient() {
  const auth = useAuthOptional();
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

  return <Dashboard />;
}

/**
 * Split from the gate so the data hook runs only for an administrator. A
 * non-admin never fires the overview call (which would 403) or the probes
 * (one of which spends a CBBD call).
 */
function Dashboard() {
  const { status, history, checks, overview, probes, workflow, deploy, checkedAt, refresh, expectRun } = useDashboardData();
  const loading = status.state === "loading" || overview.state === "loading" || probes.state === "loading";

  return (
    <Shell>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[0.6rem] uppercase tracking-widest text-coral font-bold mb-1">Admin</p>
          <h1 className="text-2xl font-semibold text-ink">Dashboard</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[0.7rem] text-ink-muted">
            Live season{" "}
            <strong className="text-ink">{LIVE_SEASON === null ? "none" : LIVE_SEASON}</strong>
          </span>
          {checkedAt && !loading && (
            <span className="text-[0.7rem] text-ink-muted tabular-nums">
              checked {ago(new Date(checkedAt).toISOString())}
            </span>
          )}
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="h-8 px-3 rounded-md text-xs font-semibold border border-ink/15 text-ink hover:bg-paper-deep transition-colors disabled:opacity-50"
          >
            {loading ? "Checking…" : "Refresh"}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <Tile label="Nightly pipeline" model={pipelineTile(history, status, workflow)} href="#pipeline" />
        <Tile label="Data checks" model={dataChecksTile(checks)} href="#data" />
        <Tile label="Site checks" model={probesTile(probes)} href="#checks" />
        <Tile label="Deploy" model={deployTile(deploy)} href="#run" />
        <Tile label="Subscribers" model={subscribersTile(overview)} href="#subscribers" />
        <Tile label="Stripe webhook" model={webhookTile(overview)} href="#subscribers" />
      </div>

      <div className="grid gap-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem] items-start">
          <PipelineSection status={status} history={history} />
          <RunAside workflow={workflow} deploy={deploy} onDispatched={expectRun} />
        </div>

        <DataChecksSection checks={checks} />

        <ChecksSection probes={probes} checkedAt={checkedAt} onRerun={refresh} />

        <SubscribersSection overview={overview} footer={<WebhookNote overview={overview} />} />

        <h2 className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium mt-2">Actions</h2>
        <BannerPanel />
        <TransfersPanel />
      </div>
    </Shell>
  );
}

// ── Pipeline ───────────────────────────────────────────────────────────────

function PipelineSection({ status, history }: { status: Loaded<RefreshStatus>; history: Loaded<RefreshHistory> }) {
  const s = status.state === "ready" ? status.data : null;
  return (
    <Section
      id="pipeline"
      title="Last run"
      right={
        <div className="flex items-center gap-2">
          {/* A DRY RUN IS NOT A RUN, and the record could not say so.
              --dry-run writes the same status file with every step marked
              skipped, so a rehearsal showed here as "Succeeded" with the
              time it was rehearsed — which reads as "the pipeline ran and
              the data is current". It is the one thing this panel exists
              to answer. */}
          {s?.dryRun && <Badge tone="muted">Dry run</Badge>}
          {s && <Badge tone={s.outcome === "ok" ? "good" : "bad"}>{s.outcome === "ok" ? "Succeeded" : "Failed"}</Badge>}
        </div>
      }
    >
      {history.state === "ready" && <HistoryStrip runs={history.data.runs} />}

      {status.state === "loading" && (
        <p className="px-4 py-6 text-sm text-ink-muted">Reading the run record…</p>
      )}

      {status.state === "error" && (
        <p className="px-4 py-6 text-sm text-bad">Could not read the run record: {status.message}</p>
      )}

      {status.state === "none" && (
        <div className="px-4 py-6">
          <p className="text-sm text-ink">No run recorded yet.</p>
          <p className="text-sm text-ink-muted mt-1">
            The pipeline writes its record on every run, including a failed one. Nothing
            has run since it was built.
          </p>
        </div>
      )}

      {s && (
        <>
          <dl className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 border-b border-hairline">
            <Fact label="Season" value={String(s.season)} />
            <Fact label="Finished" value={ago(s.finishedAt)} />
            <Fact label="Took" value={dur(s.durationMs)} />
            <Fact label="Phases" value={s.phases.join(", ")} />
          </dl>

          {s.failedAt && (
            <p className="px-4 py-3 text-sm text-bad border-b border-hairline">
              Stopped at <code className="font-mono text-xs">{s.failedAt}</code>. Nothing
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
                {s.steps.map((step, i) => (
                  <tr key={i} className="border-t border-hairline align-top">
                    <td className="px-4 py-2">
                      <span className="flex items-start gap-2">
                        <StepDot status={step.status} />
                        <span className="min-w-0">
                          <code className="font-mono text-xs text-ink break-all">{step.step}</code>
                          {step.note && (
                            <span className="block text-[0.7rem] text-ink-muted mt-0.5">{step.note}</span>
                          )}
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-muted whitespace-nowrap">
                      {step.status === "skipped" ? "—" : dur(step.ms)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Section>
  );
}

type Dispatch =
  | { state: "idle" }
  | { state: "sending"; phases: string }
  | { state: "sent"; phases: string }
  | { state: "error"; message: string };

function RunAside({
  workflow, deploy, onDispatched,
}: { workflow: Loaded<Workflow>; deploy: Loaded<Deploy>; onDispatched: () => void }) {
  const [dispatch, setDispatch] = useState<Dispatch>({ state: "idle" });
  const [dryRun, setDryRun] = useState(false);

  const wf = workflow.state === "ready" ? workflow.data : null;
  const running = wf?.running ?? null;
  const disabled = wf?.state !== undefined && wf.state !== "active";
  const last = wf?.runs.find((r) => r.status === "completed") ?? null;
  // Sent and not yet listed: keep the buttons down for the seconds in between.
  const pending = dispatch.state === "sending" || (dispatch.state === "sent" && !running);
  const canRun = wf !== null && !disabled && !running && !pending;

  /**
   * "Sent" stops meaning anything once the run appears — `pending` already
   * ignores it then — but it must also expire on its own, or a dispatch
   * GitHub accepted and never listed would hold the buttons down forever.
   */
  useEffect(() => {
    if (dispatch.state !== "sent") return;
    const id = setTimeout(() => setDispatch({ state: "idle" }), 90_000);
    return () => clearTimeout(id);
  }, [dispatch.state]);

  async function run(phases: string, label: string) {
    if (phases === "rollback" && !window.confirm("Roll back the last publish? Tonight's files on R2 are replaced with the previous run's. One generation only.")) return;
    setDispatch({ state: "sending", phases });
    try {
      await dispatchRun({ phases, dryRun });
      setDispatch({ state: "sent", phases: label });
      onDispatched();
    } catch (e) {
      setDispatch({ state: "error", message: e instanceof Error ? e.message : "The request failed." });
    }
  }

  return (
    <aside id="run" className="rounded-xl border border-ink/10 bg-card shadow-sm p-4 scroll-mt-24">
      <h2 className="text-sm font-semibold text-ink mb-3">Run it</h2>

      {/* THE PHASES ARE SEPARATE BECAUSE THEY FAIL SEPARATELY. Re-publishing
          after a fixed builder should not re-pull a night of box scores,
          and an upstream outage should not cost the derivations that
          already succeeded. Same reasoning as the script's own phases. */}
      <div className="flex flex-col gap-1.5">
        {RUNS.map((r) => (
          <button
            key={r.phases}
            type="button"
            disabled={!canRun}
            onClick={() => run(r.phases, r.label)}
            title={r.why}
            className={cn(
              "w-full h-9 rounded-md text-sm font-semibold border transition-colors",
              "disabled:opacity-40 disabled:cursor-not-allowed",
              r.danger
                ? "border-bad/40 bg-bad/10 text-bad hover:bg-bad/20"
                : r.primary
                  ? "border-coral/40 bg-coral/10 text-ink hover:bg-coral/20"
                  : "border-ink/15 text-ink hover:bg-paper-deep",
            )}
          >
            {dispatch.state === "sending" && dispatch.phases === r.phases ? "Asking GitHub…" : r.label}
          </button>
        ))}
      </div>

      <label className="mt-2 flex items-center gap-2 text-[0.7rem] text-ink-muted cursor-pointer select-none">
        <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} className="accent-coral" />
        Dry run — print the chain on GitHub without running it
      </label>

      {/* What is happening, in one line. Order of precedence: a run going
          beats a dispatch waiting to be listed beats the last result. */}
      <div className="mt-3 text-[0.7rem] leading-relaxed">
        {workflow.state === "loading" && <p className="text-ink-muted">Asking GitHub…</p>}
        {workflow.state === "error" && <p className="text-bad">{workflow.message}</p>}
        {running && (
          <p className="text-ink">
            <span className="inline-block w-2 h-2 rounded-full bg-coral animate-pulse mr-1.5 align-middle" />
            <strong>{running.status === "in_progress" ? "Running" : "Queued"}</strong>
            {" · "}{running.event === "schedule" ? "the nightly" : "a button"}, {ago(running.startedAt ?? running.createdAt)}
            {" · "}<a href={running.url} target="_blank" rel="noreferrer" className="text-coral hover:underline">watch</a>
          </p>
        )}
        {pending && dispatch.state === "sent" && (
          <p className="text-ink-muted">
            <strong className="text-ink">{dispatch.phases}</strong> sent. GitHub lists a run a few seconds after accepting it…
          </p>
        )}
        {dispatch.state === "error" && <p className="text-bad">{dispatch.message}</p>}
        {disabled && wf && (
          <p className="text-bad">
            The workflow is <strong>{wf.state.replace("_", " ")}</strong> on GitHub. Nothing will run until it is enabled there.
          </p>
        )}
        {!running && !pending && last && (
          <p className="text-ink-muted">
            Last on GitHub:{" "}
            <span className={cn("font-semibold", last.conclusion === "success" ? "text-good" : "text-bad")}>{last.conclusion ?? "unknown"}</span>
            {" · "}{last.event === "schedule" ? "nightly" : "manual"} · {ago(last.updatedAt)}
            {" · "}<a href={last.url} target="_blank" rel="noreferrer" className="text-coral hover:underline">log</a>
          </p>
        )}
        {wf && wf.runs.length === 0 && <p className="text-ink-muted">No runs on GitHub yet.</p>}
      </div>

      <hr className="my-4 border-hairline" />

      <h3 className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium mb-2">
        Deploy
      </h3>
      <DeployNote deploy={deploy} />

      <hr className="my-4 border-hairline" />

      <ul className="text-[0.7rem] text-ink-muted space-y-2 leading-relaxed">
        <li>
          <a href={WORKFLOW_URL} target="_blank" rel="noreferrer" className="text-coral hover:underline">
            The workflow on GitHub
          </a>{" "}
          — the same job, with the same inputs, and every log.
        </li>
        <li>
          Live season:{" "}
          <strong className="text-ink">{LIVE_SEASON === null ? "none" : LIVE_SEASON}</strong>
          {LIVE_SEASON === null && " — nothing is being played, so a run has nothing to publish and will say so."}
        </li>
      </ul>
    </aside>
  );
}

/**
 * Which commit a reader is looking at. A deploy is a manual `netlify deploy`
 * and the nightly never does one, so "behind" is normal between deploys —
 * the number is here so the decision to deploy is made with it, not guessed.
 */
function DeployNote({ deploy }: { deploy: Loaded<Deploy> }) {
  if (deploy.state === "loading") return <p className="text-[0.7rem] text-ink-muted">Asking the site…</p>;
  if (deploy.state === "error") return <p className="text-[0.7rem] text-bad">{deploy.message}</p>;
  if (deploy.state === "none") {
    return (
      <p className="text-[0.7rem] text-ink-muted leading-relaxed">
        This build predates <code className="text-ink">build-info.json</code>. The next build writes one and this will say which commit is live.
      </p>
    );
  }
  const d = deploy.data;
  return (
    <p className="text-[0.7rem] text-ink-muted leading-relaxed">
      <a href={`https://github.com/cpb09e-source/beyond-the-arc/commit/${d.sha}`} target="_blank" rel="noreferrer" className="font-mono text-ink hover:underline">{d.sha.slice(0, 7)}</a>
      {" on "}<span className={cn(d.branch === "main" ? "text-ink" : "text-bad font-semibold")}>{d.branch}</span>
      {d.dirty && <span title="Uncommitted changes were present at build time"> +local</span>}
      {" · built "}{ago(d.builtAt)}
      {d.behind !== null && (
        <>
          {" · "}
          {d.behind === 0
            ? <span className="text-good font-semibold">current</span>
            : <a href={d.compareUrl} target="_blank" rel="noreferrer" className="text-gold-ink font-semibold hover:underline">{d.behind} commit{d.behind === 1 ? "" : "s"} behind main</a>}
        </>
      )}
    </p>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-6xl px-6 lg:px-10 py-10">{children}</main>;
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
