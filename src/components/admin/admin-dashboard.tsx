"use client";

import { useCallback, useEffect, useState } from "react";
import { readOverview, type Overview } from "@/lib/admin-api";
import { LIVE_SEASON } from "@/lib/seasons";
import { cn } from "@/lib/utils";
import { PROBES, freshUrl, runProbes, type ProbeResult, type ProbeState } from "@/components/admin/probes";

/**
 * The dashboard's data, tiles and sections. admin-client.tsx owns the gate
 * and the page; this owns everything that is READ.
 *
 * ── FOUR SOURCES, LOADED INDEPENDENTLY ────────────────────────────────────
 *
 *   status    /data/live/refresh-status.json    what the last run did
 *   history   /data/live/refresh-history.json   one line per run, ~60 nights
 *   overview  /api/admin-config?what=overview   who is paying, Stripe heartbeat
 *   probes    the site itself, right now         see probes.ts
 *
 * Each has its own loading state and its own failure, and a tile reports the
 * one it depends on. The alternative — one big load, one spinner — means an
 * R2 hiccup hides the subscriber count, which is the opposite of what a
 * status page is for: the sources failing independently is the information.
 *
 * ── EVERY READ IS CACHE-BUSTED ────────────────────────────────────────────
 *
 * R2 serves an hour of max-age and a week of stale-while-revalidate, which is
 * the right policy for data that changes once a day and the wrong one for a
 * run record read on the morning a run failed. freshUrl() bypasses both.
 */

export type Health = "good" | "warn" | "bad" | "off" | "loading";

export type StepStatus = "ok" | "failed" | "skipped";

export type RefreshStatus = {
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

export type RunLine = {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  outcome: "ok" | "failed";
  failedAt: string | null;
  dryRun: boolean;
  season: number;
  phases: string[];
  steps: number;
  ok: number;
};

export type RefreshHistory = { updatedAt: string; runs: RunLine[] };

export type Loaded<T> =
  | { state: "loading" }
  | { state: "ready"; data: T }
  | { state: "none" }
  | { state: "error"; message: string };

// ── Formatting ─────────────────────────────────────────────────────────────

/** "4m 12s" — a nightly step's duration, which is never hours and often under a second. */
export function dur(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/** "3 hours ago" — the only question anyone asks of a nightly job's timestamp. */
export function ago(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  return `${Math.round(hrs / 24)} days ago`;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** "Sep 1, 06:04" in the reader's zone — the history strip's hover. */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** "npx tsx scripts/build-live-team-pages.mts --season 2027" → "build-live-team-pages" */
function shortStep(cmd: string | null): string {
  if (!cmd) return "";
  const m = cmd.match(/scripts\/([\w-]+)\.[a-z]+/);
  return m ? m[1] : cmd;
}

// ── Data ───────────────────────────────────────────────────────────────────

async function readJson<T>(path: string): Promise<Loaded<T>> {
  try {
    const r = await fetch(freshUrl(path), { cache: "no-store" });
    if (r.status === 404) return { state: "none" };
    if (!r.ok) return { state: "error", message: `${r.status} from ${path}` };
    return { state: "ready", data: (await r.json()) as T };
  } catch (e) {
    return { state: "error", message: e instanceof Error ? e.message : "network error" };
  }
}

export function useDashboardData() {
  const [status, setStatus] = useState<Loaded<RefreshStatus>>({ state: "loading" });
  const [history, setHistory] = useState<Loaded<RefreshHistory>>({ state: "loading" });
  const [overview, setOverview] = useState<Loaded<Overview>>({ state: "loading" });
  const [probes, setProbes] = useState<Loaded<Map<string, ProbeResult>>>({ state: "loading" });
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let live = true;
    const done = <T,>(set: (v: Loaded<T>) => void) => (v: Loaded<T>) => { if (live) set(v); };
    readJson<RefreshStatus>("/data/live/refresh-status.json").then(done(setStatus));
    readJson<RefreshHistory>("/data/live/refresh-history.json").then(done(setHistory));
    readOverview()
      .then((data) => done(setOverview)({ state: "ready", data }))
      .catch((e: unknown) => done(setOverview)({ state: "error", message: e instanceof Error ? e.message : "failed" }));
    runProbes().then((data) => { if (live) { setProbes({ state: "ready", data }); setCheckedAt(Date.now()); } });
    return () => { live = false; };
  }, [generation]);

  const refresh = useCallback(() => {
    setStatus({ state: "loading" });
    setHistory({ state: "loading" });
    setOverview({ state: "loading" });
    setProbes({ state: "loading" });
    setGeneration((g) => g + 1);
  }, []);

  return { status, history, overview, probes, checkedAt, refresh };
}

// ── Health, derived ────────────────────────────────────────────────────────

/** Past this without a run, an in-season pipeline is late, not just quiet. */
const STALE_AFTER = 26 * HOUR;

/**
 * The last run that did something. A dry run writes the same record with
 * every step skipped, and "the pipeline rehearsed at 7pm" must not read as
 * "the data is current as of 7pm".
 */
function lastReal(history: Loaded<RefreshHistory>, status: Loaded<RefreshStatus>): RunLine | RefreshStatus | null {
  if (history.state === "ready") {
    const real = history.data.runs.filter((r) => !r.dryRun);
    if (real.length) return real[real.length - 1];
  }
  if (status.state === "ready" && !status.data.dryRun) return status.data;
  return null;
}

export type TileModel = { health: Health; value: string; sub: string };

export function pipelineTile(history: Loaded<RefreshHistory>, status: Loaded<RefreshStatus>): TileModel {
  if (history.state === "loading" || status.state === "loading") return { health: "loading", value: "…", sub: "reading the record" };
  const run = lastReal(history, status);
  if (!run) {
    return LIVE_SEASON === null
      ? { health: "off", value: "Off-season", sub: "no run recorded" }
      : { health: "warn", value: "No run yet", sub: "nothing has published" };
  }
  const age = Date.now() - Date.parse(run.finishedAt);
  if (run.outcome === "failed") {
    return { health: "bad", value: "Failed", sub: `${shortStep(run.failedAt)} · ${ago(run.finishedAt)}` };
  }
  if (LIVE_SEASON === null) return { health: "off", value: "Off-season", sub: `last run ${ago(run.finishedAt)}` };
  if (age > STALE_AFTER) return { health: "warn", value: "Late", sub: `last run ${ago(run.finishedAt)}` };
  return { health: "good", value: ago(run.finishedAt), sub: `Succeeded · ${dur(run.durationMs)}` };
}

export function probesTile(probes: Loaded<Map<string, ProbeResult>>): TileModel {
  if (probes.state !== "ready") return { health: "loading", value: "…", sub: `running ${PROBES.length} checks` };
  const results = [...probes.data.values()];
  const fails = results.filter((r) => r.state === "fail").length;
  const warns = results.filter((r) => r.state === "warn").length;
  const skips = results.filter((r) => r.state === "skip").length;
  const ran = results.length - skips;
  const ok = results.filter((r) => r.state === "ok").length;
  if (fails) return { health: "bad", value: `${fails} failing`, sub: `${ok} of ${ran} ok` };
  if (warns) return { health: "warn", value: `${ok} of ${ran} ok`, sub: `${warns} slow or missing` };
  return { health: "good", value: `${ok} of ${ran} ok`, sub: skips ? `${skips} skipped locally` : "every check passed" };
}

export function subscribersTile(overview: Loaded<Overview>): TileModel {
  if (overview.state === "loading") return { health: "loading", value: "…", sub: "counting" };
  if (overview.state !== "ready") return { health: "bad", value: "Unavailable", sub: overview.state === "error" ? overview.message : "no data" };
  const s = overview.data.subscribers;
  const sub = [
    s.paidNew30d ? `+${s.paidNew30d} paid this month` : `${s.accounts} accounts`,
    s.cancelling ? `${s.cancelling} cancelling` : null,
  ].filter(Boolean).join(" · ");
  if (s.pastDue) return { health: "warn", value: `${s.active} paid`, sub: `${s.pastDue} past due · ${sub}` };
  return { health: s.active ? "good" : "off", value: `${s.active} paid`, sub };
}

/**
 * How long Stripe can plausibly go quiet. A monthly subscriber renews every
 * 30 days and each renewal is an event, so with any monthly subscriber a
 * 35-day silence means the events are not arriving — the secret was rotated,
 * the endpoint was disabled, a deploy lost the env var. With only yearly
 * subscribers the honest answer is "could be months", so nothing is claimed.
 */
const WEBHOOK_QUIET = 35 * DAY;

export function webhookTile(overview: Loaded<Overview>): TileModel {
  if (overview.state === "loading") return { health: "loading", value: "…", sub: "reading" };
  if (overview.state !== "ready") return { health: "off", value: "Unknown", sub: "overview unavailable" };
  const hb = overview.data.webhook;
  if (!hb) return { health: "off", value: "Never", sub: "no event since the heartbeat was added" };
  const monthly = overview.data.subscribers.monthly;
  const age = Date.now() - Date.parse(hb.at);
  if (!hb.ok) return { health: "bad", value: "Failing", sub: `handler failed on ${hb.type}` };
  if (monthly > 0 && age > WEBHOOK_QUIET) return { health: "warn", value: ago(hb.at), sub: `quiet with ${monthly} monthly` };
  return { health: "good", value: ago(hb.at), sub: hb.type };
}

// ── Tiles ──────────────────────────────────────────────────────────────────

const TONE: Record<Health, { stripe: string; value: string }> = {
  good: { stripe: "bg-good", value: "text-ink" },
  warn: { stripe: "bg-gold", value: "text-ink" },
  bad: { stripe: "bg-bad", value: "text-bad" },
  off: { stripe: "bg-ink/20", value: "text-ink-muted" },
  loading: { stripe: "bg-ink/10 animate-pulse", value: "text-ink-muted" },
};

/**
 * One tile. The stripe carries the state and the value carries the number, so
 * a row of six reads at a glance as "green green amber green" before any of
 * the words are read — which is the whole point of a top row.
 *
 * An anchor, not a button: it jumps to the section that explains it.
 */
export function Tile({ label, model, href }: { label: string; model: TileModel; href: string }) {
  const tone = TONE[model.health];
  return (
    <a
      href={href}
      className="relative overflow-hidden rounded-xl border border-ink/10 bg-card shadow-sm px-4 py-3 pl-5 flex flex-col gap-0.5 hover:border-ink/25 transition-colors focus:outline-none focus:ring-2 focus:ring-coral/40"
    >
      <span aria-hidden className={cn("absolute left-0 top-0 bottom-0 w-1.5", tone.stripe)} />
      <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">{label}</span>
      <span className={cn("text-xl font-semibold tabular-nums leading-tight truncate", tone.value)}>{model.value}</span>
      <span className="text-[0.7rem] text-ink-muted truncate" title={model.sub}>{model.sub}</span>
    </a>
  );
}

// ── Shared chrome ──────────────────────────────────────────────────────────

export function Section({
  id, title, right, children,
}: { id: string; title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="rounded-xl border border-ink/10 bg-card shadow-sm overflow-hidden scroll-mt-6">
      <div className="px-4 py-3 border-b border-hairline flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Fact({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div title={hint}>
      <dt className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">{label}</dt>
      <dd className="text-sm text-ink mt-0.5 tabular-nums">{value}</dd>
    </div>
  );
}

export function Badge({ tone, children }: { tone: "good" | "bad" | "muted" | "warn"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "text-[0.6rem] uppercase tracking-widest font-bold px-2 py-0.5 rounded whitespace-nowrap",
        tone === "good" && "bg-good/15 text-good",
        tone === "bad" && "bg-bad/15 text-bad",
        tone === "warn" && "bg-gold/25 text-ink",
        tone === "muted" && "bg-ink/10 text-ink-muted",
      )}
    >
      {children}
    </span>
  );
}

// ── Pipeline history ───────────────────────────────────────────────────────

/**
 * Sixty nights as bars. Height is duration, colour is outcome, a dry run is
 * a faint stub. No axis: the question is "did it run, did it fail, is it
 * getting slower", and a run of green bars at the same height answers all
 * three. Hover for the night.
 */
export function HistoryStrip({ runs }: { runs: RunLine[] }) {
  if (!runs.length) return null;
  const max = Math.max(1, ...runs.map((r) => (r.dryRun ? 0 : r.durationMs)));
  return (
    <div className="px-4 py-3 border-b border-hairline">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">
          Last {runs.length} run{runs.length === 1 ? "" : "s"}
        </span>
        <span className="text-[0.65rem] text-ink-muted tabular-nums">
          {runs.filter((r) => r.outcome === "failed").length} failed · median{" "}
          {dur(median(runs.filter((r) => !r.dryRun).map((r) => r.durationMs)))}
        </span>
      </div>
      <div className="flex items-end gap-[3px] h-10">
        {runs.map((r) => {
          const pct = r.dryRun ? 12 : Math.max(8, Math.round((r.durationMs / max) * 100));
          const title = r.dryRun
            ? `${when(r.startedAt)} · dry run`
            : `${when(r.startedAt)} · ${r.outcome === "ok" ? "succeeded" : `failed at ${shortStep(r.failedAt)}`} · ${dur(r.durationMs)}`;
          return (
            <span
              key={r.startedAt}
              title={title}
              className={cn(
                "flex-1 min-w-1 max-w-3.5 rounded-sm",
                r.dryRun ? "bg-ink/15" : r.outcome === "ok" ? "bg-good/70" : "bg-bad",
              )}
              style={{ height: `${pct}%` }}
            />
          );
        })}
      </div>
    </div>
  );
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

// ── Site checks ────────────────────────────────────────────────────────────

const PROBE_GLYPH: Record<ProbeState, { glyph: string; cls: string; word: string }> = {
  ok: { glyph: "✓", cls: "text-good", word: "ok" },
  warn: { glyph: "!", cls: "text-gold", word: "warning" },
  fail: { glyph: "✕", cls: "text-bad", word: "failed" },
  skip: { glyph: "·", cls: "text-ink-muted", word: "skipped" },
};

export function ChecksSection({
  probes, checkedAt, onRerun,
}: { probes: Loaded<Map<string, ProbeResult>>; checkedAt: number | null; onRerun: () => void }) {
  const running = probes.state !== "ready";
  return (
    <Section
      id="checks"
      title="Site checks"
      right={
        <div className="flex items-center gap-2">
          {checkedAt && !running && (
            <span className="text-[0.65rem] text-ink-muted">checked {ago(new Date(checkedAt).toISOString())}</span>
          )}
          <button
            type="button"
            onClick={onRerun}
            disabled={running}
            className="h-7 px-2.5 rounded-md text-[0.7rem] font-semibold border border-ink/15 text-ink hover:bg-paper-deep transition-colors disabled:opacity-50"
          >
            {running ? "Running…" : "Run again"}
          </button>
        </div>
      }
    >
      <p className="px-4 pt-3 text-[0.7rem] text-ink-muted leading-relaxed">
        The requests a reader makes, made from here, now. Green is a status code, not a promise.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm mt-2">
          <tbody>
            {PROBES.map((p) => {
              const r = probes.state === "ready" ? probes.data.get(p.id) : undefined;
              const g = r ? PROBE_GLYPH[r.state] : null;
              return (
                <tr key={p.id} className="border-t border-hairline align-top">
                  <td className="px-4 py-2 w-6">
                    <span aria-label={g?.word ?? "running"} className={cn("inline-block w-4 text-center text-xs font-bold", g ? g.cls : "text-ink-muted animate-pulse")}>
                      {g ? g.glyph : "…"}
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    <span className="text-ink" title={p.why}>{p.label}</span>
                    {p.cost && <span className="ml-2 text-[0.65rem] text-ink-muted">{p.cost}</span>}
                  </td>
                  <td className={cn("px-4 py-2 text-right tabular-nums whitespace-nowrap text-xs", r?.state === "fail" ? "text-bad font-semibold" : "text-ink-muted")}>
                    {r ? r.detail : "…"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ── Subscribers ────────────────────────────────────────────────────────────

function planLabel(tier: string | null, status: string | null, role: string | null): { text: string; tone: "good" | "bad" | "muted" | "warn" } {
  if (role === "admin") return { text: "staff", tone: "muted" };
  const live = status === "active" || status === "trialing" || status === "past_due";
  if (!live) return { text: status && status !== "inactive" ? status : "free", tone: "muted" };
  const plan = tier === "bta_pro_monthly" ? "monthly" : tier === "bta_pro_yearly" ? "yearly" : "paid";
  if (status === "past_due") return { text: `${plan} · past due`, tone: "warn" };
  return { text: plan, tone: "good" };
}

export function SubscribersSection({ overview, footer }: { overview: Loaded<Overview>; footer?: React.ReactNode }) {
  return (
    <Section
      id="subscribers"
      title="Subscribers"
      right={overview.state === "ready" && overview.data.subscribers.truncated
        ? <Badge tone="warn">counts capped</Badge>
        : undefined}
    >
      {overview.state === "loading" && <p className="px-4 py-6 text-sm text-ink-muted">Counting…</p>}
      {overview.state === "error" && (
        <p className="px-4 py-6 text-sm text-bad">{overview.message}</p>
      )}
      {overview.state === "ready" && (() => {
        const s = overview.data.subscribers;
        return (
          <>
            <dl className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 border-b border-hairline">
              <Fact label="Paying now" value={<><strong>{s.active}</strong> <span className="text-ink-muted">· {s.monthly} monthly, {s.yearly} yearly</span></>} />
              <Fact label="New paid, 30 days" value={s.paidNew30d} />
              <Fact label="Cancelling" value={s.cancelling} hint="Still paid today, already told Stripe to stop." />
              <Fact label="Past due" value={s.pastDue} hint="A card failed and Stripe is retrying. Access continues." />
              <Fact label="Accounts" value={s.accounts} />
              <Fact label="New, 7 days" value={s.new7d} />
              <Fact label="New, 30 days" value={s.new30d} />
              <Fact label="Staff" value={s.admins} />
            </dl>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[0.6rem] uppercase tracking-widest text-ink-muted">
                    <th className="px-4 py-2 font-medium">Latest sign-ups</th>
                    <th className="px-4 py-2 font-medium">Plan</th>
                    <th className="px-4 py-2 font-medium text-right">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {s.recent.map((r) => {
                    const p = planLabel(r.tier, r.status, r.role);
                    return (
                      <tr key={`${r.email}-${r.createdAt}`} className="border-t border-hairline">
                        <td className="px-4 py-2 text-ink truncate max-w-64">{r.email ?? <span className="text-ink-muted">no email</span>}</td>
                        <td className="px-4 py-2"><Badge tone={p.tone}>{p.text}</Badge></td>
                        <td className="px-4 py-2 text-right text-ink-muted tabular-nums whitespace-nowrap">{ago(r.createdAt)}</td>
                      </tr>
                    );
                  })}
                  {s.recent.length === 0 && (
                    <tr><td colSpan={3} className="px-4 py-4 text-ink-muted">No accounts yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        );
      })()}
      {footer}
    </Section>
  );
}

// ── Stripe webhook ─────────────────────────────────────────────────────────

export function WebhookNote({ overview }: { overview: Loaded<Overview> }) {
  if (overview.state !== "ready") return null;
  const hb = overview.data.webhook;
  return (
    <div className="px-4 py-3 border-t border-hairline text-[0.7rem] text-ink-muted leading-relaxed">
      <span className="text-[0.6rem] uppercase tracking-widest font-medium mr-2">Stripe webhook</span>
      {hb ? (
        <>
          last verified event <strong className="text-ink">{hb.type}</strong> {ago(hb.at)}
          {hb.handled ? "" : " (acknowledged, not acted on)"}
          {!hb.ok && <span className="text-bad font-semibold"> — the handler failed; Stripe will retry.</span>}
        </>
      ) : (
        <>
          nothing recorded yet. The webhook writes a note on every event it verifies; the first
          renewal, or a test event from the Stripe dashboard, will fill this in.
        </>
      )}
    </div>
  );
}
