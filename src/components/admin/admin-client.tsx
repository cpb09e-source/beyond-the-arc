"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Activity, ArrowLeftRight, CreditCard, ExternalLink, Globe, LayoutGrid, Megaphone,
  Play, RefreshCw, Rocket, ShieldCheck, Undo2, Users, Zap,
} from "lucide-react";
import { dispatchRun } from "@/lib/admin-api";
import { WORKFLOW_URL, type Deploy, type Workflow } from "@/lib/github-runs";
import { useAuthOptional } from "@/lib/auth/auth-provider";
import { LIVE_SEASON } from "@/lib/seasons";
import { cn } from "@/lib/utils";
import { BannerPanel, TransfersPanel } from "@/components/admin/admin-panels";
import { AdminShell, useView, type NavGroup, type ViewId } from "@/components/admin/admin-shell";
import {
  Badge,
  ChecksSection,
  DataChecksSection,
  Fact,
  HistoryStrip,
  Section,
  StateMark,
  SubscribersSection,
  Tile,
  WebhookNote,
  ago,
  dataChecksTile,
  deployTile,
  dur,
  pipelineTile,
  probesTile,
  quotaTile,
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
 * gets a 404 from it, not a number. Nothing on this page is trusted to decide
 * anything.
 *
 * ── THE OVERVIEW IS THE ALARM, THE PANES ARE THE WORK ─────────────────────
 *
 * Overview answers "what is wrong" in one screen — six tiles, the last run,
 * both check panels — and nothing on it is a form. Everything an
 * administrator DOES lives one click away in its own pane, because nobody
 * edits a banner while something is red, and a status page that opens with a
 * text field is a form with some numbers above it.
 *
 * ── THE RUN BUTTONS START A JOB SOMEWHERE ELSE ────────────────────────────
 *
 * A button posts to /api/dispatch-run, which holds the GitHub token and asks
 * GitHub to start the workflow. Nothing runs here, and nothing here can see
 * the run except by asking GitHub how it is going — which the page does,
 * without a token, because the repository is public (github-runs.ts). So a
 * press is followed by a few seconds in which GitHub has accepted the
 * request and not yet listed the run; the panel says so rather than showing
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

const VIEWS: readonly ViewId[] = ["overview", "pipeline", "data", "checks", "subscribers", "banner", "transfers"];

const ICON = { size: 14, strokeWidth: 2 } as const;

export function AdminClient() {
  const auth = useAuthOptional();
  const isAdmin = auth?.profile?.role === "admin";
  const settling = !auth || auth.status === "loading" || auth.profileLoading;

  if (settling) {
    return <Gate><p className="text-ink-muted text-sm">Checking your account…</p></Gate>;
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
      <Gate>
        <h1 className="text-xl font-semibold text-ink mb-2">Nothing here</h1>
        <p className="text-ink-muted text-sm">
          This page is for site administration.{" "}
          <Link href="/" className="text-coral hover:underline">Back to Beyond the Arc</Link>.
        </p>
      </Gate>
    );
  }

  return <Dashboard />;
}

function Gate({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-6xl px-6 lg:px-10 py-10">{children}</main>;
}

/**
 * Split from the gate so the data hook runs only for an administrator. A
 * non-admin never fires the overview call (which would 404) or the probes
 * (one of which spends a CBBD call).
 */
function Dashboard() {
  const { status, history, checks, overview, probes, workflow, deploy, checkedAt, refresh, expectRun } = useDashboardData();
  const [view, go] = useView(VIEWS);

  const loading = status.state === "loading" || overview.state === "loading" || probes.state === "loading";

  const pipeline = pipelineTile(history, status, workflow);
  const data = dataChecksTile(checks);
  const site = probesTile(probes);
  const dep = deployTile(deploy);
  const subs = subscribersTile(overview);
  const hook = webhookTile(overview);
  const quota = quotaTile(checks);

  /**
   * The rail carries each pane's health, so a pane you are not looking at can
   * still raise its hand. Overview's own dot is the worst of them: it is the
   * pane that would have told you.
   */
  const groups: NavGroup[] = [
    {
      title: "Operations",
      items: [
        { id: "overview", label: "Overview", icon: <LayoutGrid {...ICON} />, health: worst([pipeline.health, data.health, site.health, dep.health]) },
        { id: "pipeline", label: "Pipeline", icon: <Activity {...ICON} />, health: worst([pipeline.health, dep.health]) },
        { id: "data", label: "Data checks", icon: <ShieldCheck {...ICON} />, health: worst([data.health, quota.health]) },
        { id: "checks", label: "Site checks", icon: <Globe {...ICON} />, health: site.health },
      ],
    },
    {
      title: "Revenue",
      items: [
        {
          id: "subscribers",
          label: "Subscribers",
          icon: <Users {...ICON} />,
          health: worst([subs.health, hook.health]),
          badge: overview.state === "ready" ? String(overview.data.subscribers.active) : null,
        },
      ],
    },
    {
      title: "Editorial",
      items: [
        { id: "banner", label: "Site banner", icon: <Megaphone {...ICON} /> },
        { id: "transfers", label: "Transfers", icon: <ArrowLeftRight {...ICON} /> },
      ],
    },
  ];

  return (
    <AdminShell
      groups={groups}
      view={view}
      onNavigate={go}
      bar={
        <>
          {checkedAt && !loading && (
            <span className="hidden sm:inline text-[0.68rem] text-ink-muted tabular-nums">
              checked {ago(new Date(checkedAt).toISOString())}
            </span>
          )}
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="h-8 px-2.5 rounded-lg text-[0.72rem] font-semibold border border-hairline text-ink-soft hover:text-ink hover:bg-ink/[0.04] transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            <RefreshCw size={13} className={cn(loading && "animate-spin")} />
            <span className="hidden sm:inline">{loading ? "Checking…" : "Refresh"}</span>
          </button>
          <button
            type="button"
            onClick={() => go("pipeline")}
            className="h-8 px-3 rounded-lg text-[0.72rem] font-semibold bg-ink text-paper hover:opacity-90 transition-opacity inline-flex items-center gap-1.5"
          >
            <Play size={12} fill="currentColor" />
            Run
          </button>
        </>
      }
      footer={
        <div className="px-2 flex flex-col gap-2 text-[0.68rem] text-ink-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className={cn("w-1.5 h-1.5 rounded-full", LIVE_SEASON === null ? "bg-ink/25" : "bg-good")} />
            {LIVE_SEASON === null ? "Off-season" : `Live season ${LIVE_SEASON}`}
          </span>
          <a href={WORKFLOW_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-ink transition-colors">
            Workflow on GitHub <ExternalLink size={11} />
          </a>
        </div>
      }
    >
      {view === "overview" && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
            <Tile label="Pipeline" icon={<Activity {...ICON} />} model={pipeline} onClick={() => go("pipeline")} />
            <Tile label="Data checks" icon={<ShieldCheck {...ICON} />} model={data} onClick={() => go("data")} />
            <Tile label="Site checks" icon={<Globe {...ICON} />} model={site} onClick={() => go("checks")} />
            <Tile label="Deploy" icon={<Rocket {...ICON} />} model={dep} onClick={() => go("pipeline")} />
            <Tile label="Subscribers" icon={<Users {...ICON} />} model={subs} onClick={() => go("subscribers")} />
            <Tile label="Stripe" icon={<CreditCard {...ICON} />} model={hook} onClick={() => go("subscribers")} />
            <Tile label="CBBD quota" icon={<Zap {...ICON} />} model={quota} onClick={() => go("data")} />
          </div>

          {/* The run panel is tall and the status cards are short, so they
              share a row rather than sit beside one tall column of air. */}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem] items-start">
            <div className="flex flex-col gap-4 min-w-0">
              <PipelineSection status={status} history={history} onSeeSteps={() => go("pipeline")} compact />
              <DataChecksSection checks={checks} />
              <ChecksSection probes={probes} checkedAt={checkedAt} onRerun={refresh} />
            </div>
            <RunPanel workflow={workflow} deploy={deploy} onDispatched={expectRun} />
          </div>
        </div>
      )}

      {view === "pipeline" && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem] items-start">
          <PipelineSection status={status} history={history} />
          <RunPanel workflow={workflow} deploy={deploy} onDispatched={expectRun} />
        </div>
      )}

      {view === "data" && <DataChecksSection checks={checks} />}

      {view === "checks" && <ChecksSection probes={probes} checkedAt={checkedAt} onRerun={refresh} />}

      {view === "subscribers" && (
        <SubscribersSection overview={overview} footer={<WebhookNote overview={overview} />} />
      )}

      {view === "banner" && <BannerPanel />}

      {view === "transfers" && <TransfersPanel />}
    </AdminShell>
  );
}

/** The loudest of a set of healths — what a group's dot should say. */
function worst(hs: Array<TileHealth>): TileHealth {
  const rank: Record<TileHealth, number> = { bad: 5, warn: 4, live: 3, loading: 2, off: 1, good: 0 };
  return hs.reduce((a, b) => (rank[b] > rank[a] ? b : a), "good" as TileHealth);
}
type TileHealth = ReturnType<typeof pipelineTile>["health"];

// ── Pipeline ───────────────────────────────────────────────────────────────

function PipelineSection({
  status, history, compact, onSeeSteps,
}: {
  status: Loaded<RefreshStatus>;
  history: Loaded<RefreshHistory>;
  /** Overview shows the shape of the run; the pipeline pane shows every step. */
  compact?: boolean;
  onSeeSteps?: () => void;
}) {
  const s = status.state === "ready" ? status.data : null;
  return (
    <Section
      id="panel-pipeline"
      title="Last run"
      description={compact ? undefined : "Every step the nightly ran, in order, with what each one cost."}
      right={
        <>
          {/* A DRY RUN IS NOT A RUN, and the record could not say so.
              --dry-run writes the same status file with every step marked
              skipped, so a rehearsal showed here as "Succeeded" with the
              time it was rehearsed — which reads as "the pipeline ran and
              the data is current". It is the one thing this panel exists
              to answer. */}
          {s?.dryRun && <Badge tone="muted">Dry run</Badge>}
          {s && <Badge tone={s.outcome === "ok" ? "good" : "bad"}>{s.outcome === "ok" ? "Succeeded" : "Failed"}</Badge>}
        </>
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
          <dl className="px-4 py-4 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-4 border-b border-hairline">
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

          {compact ? (
            <div className="px-4 py-3 flex items-center gap-3 text-[0.72rem] text-ink-muted">
              <span className="flex items-center gap-1.5">
                {s.steps.map((step, i) => (
                  <span
                    key={i}
                    title={`${step.step} · ${step.status === "skipped" ? "skipped" : dur(step.ms)}`}
                    className={cn(
                      "w-1.5 h-1.5 rounded-full",
                      step.status === "ok" ? "bg-good/70" : step.status === "failed" ? "bg-bad" : "bg-ink/20",
                    )}
                  />
                ))}
              </span>
              <span className="tabular-nums">
                {s.steps.filter((x) => x.status === "ok").length} of {s.steps.length} steps ran
              </span>
              <button
                type="button"
                onClick={onSeeSteps}
                className="ml-auto text-coral font-semibold hover:underline"
              >
                See every step
              </button>
            </div>
          ) : (
            /* Wide content scrolls inside its own box — a step is a full command
               line and the page must not scroll sideways because of one. */
            <div className="overflow-x-auto">
              <div className="divide-y divide-hairline min-w-[26rem]">
                {s.steps.map((step, i) => (
                  <div key={i} className="px-4 py-2.5 flex items-start gap-3 hover:bg-ink/[0.02] transition-colors">
                    <StepDot status={step.status} />
                    <div className="min-w-0 flex-1">
                      <code className="font-mono text-[0.72rem] text-ink break-all">{step.step}</code>
                      {step.note && <span className="block text-[0.7rem] text-ink-muted mt-0.5">{step.note}</span>}
                    </div>
                    <span className="text-[0.72rem] tabular-nums text-ink-muted whitespace-nowrap shrink-0">
                      {step.status === "skipped" ? "—" : dur(step.ms)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
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

function RunPanel({
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
    <aside className="rounded-xl border border-hairline bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04)] overflow-hidden">
      <div className="px-4 py-3 border-b border-hairline flex items-center justify-between">
        <h2 className="text-[0.85rem] font-semibold text-ink">Run it</h2>
        {running && <Badge tone="accent"><span className="w-1.5 h-1.5 rounded-full bg-coral animate-pulse" />live</Badge>}
      </div>

      <div className="p-4">
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
                "w-full h-9 px-3 rounded-lg text-[0.78rem] font-semibold transition-all inline-flex items-center gap-2",
                "disabled:opacity-40 disabled:cursor-not-allowed",
                r.danger
                  ? "text-bad border border-bad/30 hover:bg-bad/10"
                  : r.primary
                    ? "bg-coral text-accent-foreground border border-coral hover:opacity-90 shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                    : "text-ink border border-hairline hover:bg-ink/[0.04]",
              )}
            >
              {r.danger ? <Undo2 size={13} /> : <Play size={11} fill="currentColor" />}
              {dispatch.state === "sending" && dispatch.phases === r.phases ? "Asking GitHub…" : r.label}
            </button>
          ))}
        </div>

        <label className="mt-2.5 flex items-center gap-2 text-[0.7rem] text-ink-muted cursor-pointer select-none">
          <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} className="accent-coral" />
          Dry run — print the chain without running it
        </label>

        {/* What is happening, in one line. Order of precedence: a run going
            beats a dispatch waiting to be listed beats the last result. */}
        <div className="mt-3 rounded-lg bg-ink/[0.03] border border-hairline px-2.5 py-2 text-[0.7rem] leading-relaxed">
          {workflow.state === "loading" && <p className="text-ink-muted">Asking GitHub…</p>}
          {workflow.state === "error" && <p className="text-bad">{workflow.message}</p>}
          {running && (
            <p className="text-ink">
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
      </div>

      <div className="px-4 py-3 border-t border-hairline">
        <h3 className="text-[0.6rem] uppercase tracking-[0.12em] text-ink-muted font-semibold mb-1.5 flex items-center gap-1.5">
          <Rocket size={11} /> Deploy
        </h3>
        <DeployNote deploy={deploy} />
      </div>

      <div className="px-4 py-3 border-t border-hairline text-[0.7rem] text-ink-muted leading-relaxed">
        <a href={WORKFLOW_URL} target="_blank" rel="noreferrer" className="text-coral hover:underline inline-flex items-center gap-1">
          The workflow on GitHub <ExternalLink size={10} />
        </a>{" "}
        — the same job, with the same inputs, and every log.
        {LIVE_SEASON === null && (
          <span className="block mt-1.5">
            Nothing is being played, so a run has nothing to publish and will say so.
          </span>
        )}
      </div>
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
        This build predates <code className="font-mono text-ink">build-info.json</code>. The next build writes one and this will say which commit is live.
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
            /* The accent, not gold: this is a link to a diff, and the tile
               above already carries the amber. --gold-ink on a card is a
               brown smudge in light and invisible in dark. */
            : <a href={d.compareUrl} target="_blank" rel="noreferrer" className="text-coral font-semibold hover:underline">{d.behind} commit{d.behind === 1 ? "" : "s"} behind main</a>}
        </>
      )}
    </p>
  );
}

/**
 * Status as shape AND colour, not colour alone — the three states have to be
 * distinguishable without relying on red/green, which is the one pair a large
 * share of readers cannot separate.
 */
function StepDot({ status }: { status: StepStatus }) {
  return <span className="mt-px"><StateMark state={status === "ok" ? "ok" : status === "failed" ? "fail" : "skip"} /></span>;
}
