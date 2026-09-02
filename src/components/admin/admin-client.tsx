"use client";

import Link from "next/link";
import { useAuthOptional } from "@/lib/auth/auth-provider";
import { LIVE_SEASON } from "@/lib/seasons";
import { cn } from "@/lib/utils";
import { BannerPanel, TransfersPanel } from "@/components/admin/admin-panels";
import {
  Badge,
  ChecksSection,
  Fact,
  HistoryStrip,
  Section,
  SubscribersSection,
  Tile,
  WebhookNote,
  ago,
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
 * ── THE RUN BUTTONS ARE DELIBERATELY INERT ────────────────────────────────
 *
 * There is no dispatch endpoint yet and the workflow is disabled, so a button
 * that appeared to work would be lying twice over. It renders disabled with
 * the reason attached, which is more useful than hiding it: the point of the
 * shell is to see the shape of the finished thing.
 */

/**
 * What the buttons will dispatch, in the order someone reaches for them.
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

const WORKFLOW_URL = "https://github.com/cpb09e-source/beyond-the-arc/actions/workflows/nightly-refresh.yml";

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
  const { status, history, overview, probes, checkedAt, refresh } = useDashboardData();
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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Tile label="Nightly pipeline" model={pipelineTile(history, status)} href="#pipeline" />
        <Tile label="Site checks" model={probesTile(probes)} href="#checks" />
        <Tile label="Subscribers" model={subscribersTile(overview)} href="#subscribers" />
        <Tile label="Stripe webhook" model={webhookTile(overview)} href="#subscribers" />
      </div>

      <div className="grid gap-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem] items-start">
          <PipelineSection status={status} history={history} />
          <RunAside />
        </div>

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

function RunAside() {
  return (
    <aside className="rounded-xl border border-ink/10 bg-card shadow-sm p-4">
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
            disabled
            title={r.why}
            className={cn(
              "w-full h-9 rounded-md text-sm font-semibold border transition-colors",
              "disabled:opacity-40 disabled:cursor-not-allowed",
              r.danger
                ? "border-bad/40 bg-bad/10 text-bad"
                : r.primary
                  ? "border-coral/40 bg-coral/10 text-ink"
                  : "border-ink/15 text-ink",
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      <p className="text-[0.7rem] text-ink-muted mt-2 leading-relaxed">
        Not wired yet. These need the repository secrets loaded and the workflow
        re-enabled — until then they would fail rather than do nothing, which is worse.
        Every one of them runs on GitHub, not here.
      </p>

      <hr className="my-4 border-hairline" />

      <h3 className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium mb-2">
        Meanwhile
      </h3>
      <ul className="text-[0.7rem] text-ink-muted space-y-2 leading-relaxed">
        <li>
          <a href={WORKFLOW_URL} target="_blank" rel="noreferrer" className="text-coral hover:underline">
            Run it on GitHub
          </a>{" "}
          — the same job, with the same inputs.
        </li>
        <li>
          Live season:{" "}
          <strong className="text-ink">{LIVE_SEASON === null ? "none" : LIVE_SEASON}</strong>
          {LIVE_SEASON === null && " — nothing is being played, so a run has nothing to publish."}
        </li>
      </ul>
    </aside>
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
