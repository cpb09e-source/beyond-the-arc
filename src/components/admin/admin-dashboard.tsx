"use client";

import { useCallback, useEffect, useState } from "react";
import { readOverview, type Overview } from "@/lib/admin-api";
import { LIVE_SEASON } from "@/lib/seasons";
import { cn } from "@/lib/utils";
import { PROBES, freshUrl, runProbes, type ProbeResult, type ProbeState } from "@/components/admin/probes";
import {
  POLL_MS, RateLimited, readBuildInfo, readDeploy, readRuns, readWorkflow, type Deploy, type Workflow,
} from "@/lib/github-runs";

/**
 * The dashboard's data, tiles and sections. admin-client.tsx owns the gate
 * and the page; admin-shell.tsx owns the frame; this owns everything READ.
 *
 * ── SEVEN SOURCES, LOADED INDEPENDENTLY ───────────────────────────────────
 *
 *   status    /data/live/refresh-status.json    what the last run did
 *   history   /data/live/refresh-history.json   one line per run, ~60 nights
 *   checks    /data/live/checks.json            whether what it wrote adds up
 *   overview  /api/admin-config?what=overview   who is paying, Stripe heartbeat
 *   probes    the site itself, right now         see probes.ts
 *   workflow  api.github.com                     is a run going, is it enabled
 *   deploy    /build-info.json + api.github.com  which commit is live, how far behind
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
 *
 * ── EVERY METER IS MEASURED, NOTHING IS DRAWN FOR TEXTURE ─────────────────
 *
 * Each tile carries a strip under its number, and every one of them is real:
 * the pipeline's is the last forty nights, the checks' is one cell per check,
 * the deploy's is one cell per commit waiting, the subscribers' is the split
 * between monthly and yearly, the webhook's is how far into its quiet window
 * Stripe has gone. A tile with nothing to measure gets no strip rather than a
 * decorative one — a bar that is not a measurement teaches the eye to skip
 * every bar on the page, including the four that mean something.
 */

export type Health = "good" | "warn" | "bad" | "off" | "loading" | "live";

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

export type CheckState = "ok" | "warn" | "fail" | "skip";

/**
 * What scripts/check-live-data.mts wrote after the last publish: the slate
 * against the index, the per-team files against yesterday's, the pages
 * against the team list, R2 against tonight. It is the pipeline's own
 * look-back, and the one source here that says whether the DATA is right
 * rather than whether the job ran.
 */
export type Checks = {
  at: string;
  season: number;
  /** The Eastern date examined. */
  slate: string;
  outcome: "ok" | "warn" | "fail";
  checks: Array<{ id: string; label: string; state: CheckState; detail: string }>;
};

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

/** "2026-03-07" → "Mar 7". The slate is a date, not a moment; no zone applies. */
function shortDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
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
  const [checks, setChecks] = useState<Loaded<Checks>>({ state: "loading" });
  const [overview, setOverview] = useState<Loaded<Overview>>({ state: "loading" });
  const [probes, setProbes] = useState<Loaded<Map<string, ProbeResult>>>({ state: "loading" });
  const [workflow, setWorkflow] = useState<Loaded<Workflow>>({ state: "loading" });
  const [deploy, setDeploy] = useState<Loaded<Deploy>>({ state: "loading" });
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let live = true;
    const done = <T,>(set: (v: Loaded<T>) => void) => (v: Loaded<T>) => { if (live) set(v); };
    readJson<RefreshStatus>("/data/live/refresh-status.json").then(done(setStatus));
    readJson<RefreshHistory>("/data/live/refresh-history.json").then(done(setHistory));
    readJson<Checks>("/data/live/checks.json").then(done(setChecks));
    readOverview()
      .then((data) => done(setOverview)({ state: "ready", data }))
      .catch((e: unknown) => done(setOverview)({ state: "error", message: e instanceof Error ? e.message : "failed" }));
    runProbes().then((data) => { if (live) { setProbes({ state: "ready", data }); setCheckedAt(Date.now()); } });
    const ghError = (e: unknown): Loaded<never> => ({ state: "error", message: e instanceof Error ? e.message : "GitHub did not answer" });
    readWorkflow()
      .then((data) => done(setWorkflow)({ state: "ready", data }))
      .catch((e: unknown) => done(setWorkflow)(ghError(e)));
    // The deploy is two reads in sequence: the site says which commit it is,
    // then GitHub says how far main has moved. No build-info means an older
    // build, which is "none" and not an error.
    readBuildInfo()
      .then((info) => (info ? readDeploy(info).then((data) => done(setDeploy)({ state: "ready", data })) : done(setDeploy)({ state: "none" })))
      .catch((e: unknown) => done(setDeploy)(ghError(e)));
    return () => { live = false; };
  }, [generation]);

  /**
   * While a run is going, ask GitHub again every POLL_MS — and only then.
   * A completed run is a fact that does not change, and the budget is sixty
   * an hour (see github-runs.ts). `wanted` lets a dispatch start the poll
   * before GitHub lists the run, for the few seconds in between.
   */
  const [wanted, setWanted] = useState(0);
  const running = workflow.state === "ready" && workflow.data.running !== null;
  useEffect(() => {
    if (!running && wanted === 0) return;
    let live = true;
    const tick = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const r = await readRuns();
        if (!live) return;
        setWorkflow((w) => (w.state === "ready" ? { state: "ready", data: { ...w.data, ...r } } : w));
        // A dispatch has appeared, or finished: stop looking for it.
        if (r.running || wanted > 0) setWanted((n) => (r.running ? 0 : Math.max(0, n - 1)));
      } catch (e) {
        if (live && e instanceof RateLimited) setWorkflow({ state: "error", message: e.message });
      }
    };
    // Right after a dispatch, look sooner: the run is listed within seconds.
    const id = setInterval(tick, wanted > 0 ? 8_000 : POLL_MS);
    return () => { live = false; clearInterval(id); };
  }, [running, wanted]);

  /** Called after a dispatch: poll quickly for up to ~a minute until the run shows. */
  const expectRun = useCallback(() => setWanted(8), []);

  const refresh = useCallback(() => {
    setStatus({ state: "loading" });
    setHistory({ state: "loading" });
    setChecks({ state: "loading" });
    setOverview({ state: "loading" });
    setProbes({ state: "loading" });
    setWorkflow({ state: "loading" });
    setDeploy({ state: "loading" });
    setGeneration((g) => g + 1);
  }, []);

  return { status, history, checks, overview, probes, workflow, deploy, checkedAt, refresh, expectRun };
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

// ── Meters ─────────────────────────────────────────────────────────────────

export type MeterTone = "good" | "warn" | "bad" | "off" | "accent" | "live";

/**
 * Two shapes, because there are two kinds of thing worth measuring here.
 *
 *   cells  one mark per event — a night, a check, a commit. Reads as a
 *          countable series: four amber marks in forty is a different fact
 *          from four amber marks in five.
 *   split  proportions of one whole — monthly against yearly, elapsed
 *          against a deadline.
 */
export type Meter =
  | { kind: "cells"; cells: Array<{ tone: MeterTone; title?: string }>; empty?: number }
  | { kind: "split"; parts: Array<{ tone: MeterTone; pct: number; title?: string }> };

const FILL: Record<MeterTone, string> = {
  good: "bg-good/75",
  warn: "bg-gold",
  bad: "bg-bad",
  off: "bg-ink/20",
  accent: "bg-coral",
  live: "bg-coral animate-pulse",
};

const TRACK = "bg-ink/[0.07]";

export function MeterBar({ meter, className }: { meter: Meter; className?: string }) {
  if (meter.kind === "split") {
    const total = meter.parts.reduce((n, p) => n + p.pct, 0);
    return (
      <div className={cn("flex h-1.5 rounded-full overflow-hidden", TRACK, className)}>
        {meter.parts.map((p, i) => (
          <span key={i} title={p.title} style={{ width: `${Math.min(100, p.pct)}%` }} className={cn("h-full", FILL[p.tone])} />
        ))}
        {total < 100 && <span className="flex-1" />}
      </div>
    );
  }
  return (
    <div className={cn("flex items-stretch gap-[2px] h-1.5", className)}>
      {meter.cells.map((c, i) => (
        <span key={i} title={c.title} className={cn("flex-1 min-w-[2px] rounded-[1px]", FILL[c.tone])} />
      ))}
      {Array.from({ length: meter.empty ?? 0 }, (_, i) => (
        <span key={`e${i}`} className={cn("flex-1 min-w-[2px] rounded-[1px]", TRACK)} />
      ))}
    </div>
  );
}

const CHECK_TONE: Record<CheckState, MeterTone> = { ok: "good", warn: "warn", fail: "bad", skip: "off" };

// ── Tile models ────────────────────────────────────────────────────────────

export type TileModel = { health: Health; value: string; sub: string; meter?: Meter };

/** The last forty nights, newest on the right. Cheap to read, honest about gaps. */
function runCells(history: Loaded<RefreshHistory>): Meter | undefined {
  if (history.state !== "ready" || !history.data.runs.length) return undefined;
  const runs = history.data.runs.slice(-40);
  return {
    kind: "cells",
    cells: runs.map((r) => ({
      tone: r.dryRun ? "off" : r.outcome === "ok" ? "good" : "bad",
      title: r.dryRun
        ? `${when(r.startedAt)} · dry run`
        : `${when(r.startedAt)} · ${r.outcome === "ok" ? "succeeded" : `failed at ${shortStep(r.failedAt)}`} · ${dur(r.durationMs)}`,
    })),
    empty: Math.max(0, 40 - runs.length),
  };
}

export function pipelineTile(history: Loaded<RefreshHistory>, status: Loaded<RefreshStatus>, workflow?: Loaded<Workflow>): TileModel {
  const meter = runCells(history);
  // A run in progress outranks everything the record says: the record is
  // about the last run, and the next one is happening.
  if (workflow?.state === "ready" && workflow.data.running) {
    const r = workflow.data.running;
    const since = r.startedAt ?? r.createdAt;
    return { health: "live", value: "Running", sub: `${r.status === "in_progress" ? "started" : "queued"} ${ago(since)}`, meter };
  }
  if (history.state === "loading" || status.state === "loading") return { health: "loading", value: "…", sub: "reading the record" };
  const run = lastReal(history, status);
  if (!run) {
    return LIVE_SEASON === null
      ? { health: "off", value: "Off-season", sub: "no run recorded", meter }
      : { health: "warn", value: "No run yet", sub: "nothing has published", meter };
  }
  const age = Date.now() - Date.parse(run.finishedAt);
  if (run.outcome === "failed") {
    return { health: "bad", value: "Failed", sub: `${shortStep(run.failedAt)} · ${ago(run.finishedAt)}`, meter };
  }
  if (LIVE_SEASON === null) return { health: "off", value: "Off-season", sub: `last run ${ago(run.finishedAt)}`, meter };
  if (age > STALE_AFTER) return { health: "warn", value: "Late", sub: `last run ${ago(run.finishedAt)}`, meter };
  return { health: "good", value: ago(run.finishedAt), sub: `Succeeded · ${dur(run.durationMs)}`, meter };
}

export function probesTile(probes: Loaded<Map<string, ProbeResult>>): TileModel {
  if (probes.state !== "ready") return { health: "loading", value: "…", sub: `running ${PROBES.length} checks` };
  const results = [...probes.data.values()];
  const meter: Meter = {
    kind: "cells",
    cells: PROBES.map((p) => {
      const r = probes.data.get(p.id);
      return { tone: r ? CHECK_TONE[r.state] : "off", title: `${p.label} — ${r?.detail ?? "…"}` };
    }),
  };
  const fails = results.filter((r) => r.state === "fail").length;
  const warns = results.filter((r) => r.state === "warn").length;
  const skips = results.filter((r) => r.state === "skip").length;
  const ran = results.length - skips;
  const ok = results.filter((r) => r.state === "ok").length;
  if (fails) return { health: "bad", value: `${fails} failing`, sub: `${ok} of ${ran} ok`, meter };
  if (warns) return { health: "warn", value: `${ok} of ${ran} ok`, sub: `${warns} slow or missing`, meter };
  return { health: "good", value: `${ok} of ${ran} ok`, sub: skips ? `${skips} skipped locally` : "every check passed", meter };
}

/**
 * A different question from the pipeline tile. That one says the job ran;
 * this says what it produced adds up. A run can succeed and publish six
 * games out of a forty-game slate, and only this tile knows.
 */
export function dataChecksTile(checks: Loaded<Checks>): TileModel {
  if (checks.state === "loading") return { health: "loading", value: "…", sub: "reading the report" };
  if (checks.state === "error") return { health: "warn", value: "Unreadable", sub: checks.message };
  if (checks.state === "none") {
    return LIVE_SEASON === null
      ? { health: "off", value: "Off-season", sub: "no report" }
      : { health: "warn", value: "No report", sub: "the nightly has not checked yet" };
  }
  const { outcome, checks: list, at, slate } = checks.data;
  const meter: Meter = { kind: "cells", cells: list.map((c) => ({ tone: CHECK_TONE[c.state], title: `${c.label} — ${c.detail}` })) };
  const fails = list.filter((c) => c.state === "fail").length;
  const warns = list.filter((c) => c.state === "warn").length;
  const ran = list.filter((c) => c.state !== "skip").length;
  const age = Date.now() - Date.parse(at);
  const sub = `slate ${shortDate(slate)} · ${ago(at)}`;
  if (outcome === "fail") return { health: "bad", value: `${fails} failing`, sub, meter };
  if (outcome === "warn") return { health: "warn", value: `${warns} to look at`, sub, meter };
  if (LIVE_SEASON !== null && age > STALE_AFTER) return { health: "warn", value: "Stale", sub: `last checked ${ago(at)}`, meter };
  return { health: "good", value: `${ran} of ${ran} ok`, sub, meter };
}

export function subscribersTile(overview: Loaded<Overview>): TileModel {
  if (overview.state === "loading") return { health: "loading", value: "…", sub: "counting" };
  if (overview.state !== "ready") return { health: "bad", value: "Unavailable", sub: overview.state === "error" ? overview.message : "no data" };
  const s = overview.data.subscribers;
  const sub = [
    s.paidNew30d ? `+${s.paidNew30d} paid this month` : `${s.accounts} accounts`,
    s.cancelling ? `${s.cancelling} cancelling` : null,
  ].filter(Boolean).join(" · ");
  // The split is the plan mix, not a target: monthly and yearly are the whole
  // of `active`, so the bar is full whenever anyone is paying at all.
  const meter: Meter | undefined = s.active > 0
    ? {
      kind: "split",
      parts: [
        { tone: "accent" as MeterTone, pct: (s.monthly / s.active) * 100, title: `${s.monthly} monthly` },
        { tone: "good" as MeterTone, pct: (s.yearly / s.active) * 100, title: `${s.yearly} yearly` },
      ].filter((p) => p.pct > 0),
    }
    : undefined;
  if (s.pastDue) return { health: "warn", value: `${s.active} paid`, sub: `${s.pastDue} past due · ${sub}`, meter };
  return { health: s.active ? "good" : "off", value: `${s.active} paid`, sub, meter };
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
  // How far into the quiet window this silence has gone. Only drawn when the
  // window means something — with no monthly subscriber there is no deadline.
  const meter: Meter | undefined = monthly > 0
    ? {
      kind: "split",
      parts: [{
        tone: age > WEBHOOK_QUIET ? "warn" : "good",
        pct: Math.min(100, (age / WEBHOOK_QUIET) * 100),
        title: `${ago(hb.at)} of a ${Math.round(WEBHOOK_QUIET / DAY)}-day window`,
      }],
    }
    : undefined;
  if (!hb.ok) return { health: "bad", value: "Failing", sub: `handler failed on ${hb.type}`, meter };
  if (monthly > 0 && age > WEBHOOK_QUIET) return { health: "warn", value: ago(hb.at), sub: `quiet with ${monthly} monthly`, meter };
  return { health: "good", value: ago(hb.at), sub: hb.type, meter };
}

/**
 * The deploy is a fact about the SITE, not the data: a static export goes
 * live only when someone runs `netlify deploy`, and nothing on this page can
 * tell otherwise which commit a reader is seeing. "Behind" is not an alarm —
 * the nightly publishes data without a deploy — it is a count of what a
 * reader is not getting yet, and the meter counts it one commit at a time.
 */
export function deployTile(deploy: Loaded<Deploy>): TileModel {
  if (deploy.state === "loading") return { health: "loading", value: "…", sub: "asking the site" };
  if (deploy.state === "error") return { health: "warn", value: "Unknown", sub: deploy.message };
  if (deploy.state === "none") return { health: "off", value: "Unknown", sub: "built before build-info.json" };
  const d = deploy.data;
  const short = d.sha.slice(0, 7);
  const built = `built ${ago(d.builtAt)}`;
  const behindMeter: Meter | undefined = d.behind === null ? undefined
    : d.behind === 0
      ? { kind: "split", parts: [{ tone: "good", pct: 100, title: "the deployed commit is main" }] }
      : { kind: "cells", cells: Array.from({ length: Math.min(d.behind, 24) }, () => ({ tone: "warn" as MeterTone })), empty: Math.max(0, 24 - d.behind) };
  if (d.branch !== "main") return { health: "warn", value: `On ${d.branch}`, sub: `${short} · ${built}`, meter: behindMeter };
  if (d.behind === null) return { health: "good", value: short, sub: built };
  if (d.behind > 0) return { health: "warn", value: `${d.behind} behind`, sub: `${short} · ${built}`, meter: behindMeter };
  return { health: "good", value: "Current", sub: `${short}${d.dirty ? " +local" : ""} · ${built}`, meter: behindMeter };
}

// ── Tiles ──────────────────────────────────────────────────────────────────

const TONE: Record<Health, { dot: string; value: string; word: string }> = {
  good: { dot: "bg-good", value: "text-ink", word: "healthy" },
  warn: { dot: "bg-gold", value: "text-ink", word: "needs a look" },
  bad: { dot: "bg-bad", value: "text-bad", word: "failing" },
  off: { dot: "bg-ink/25", value: "text-ink-muted", word: "idle" },
  loading: { dot: "bg-ink/20 animate-pulse", value: "text-ink-muted", word: "loading" },
  live: { dot: "bg-coral animate-pulse", value: "text-ink", word: "running" },
};

/**
 * One tile: icon, label, number, meter, one line of why.
 *
 * The health lives in a dot beside the label rather than a stripe down the
 * side — six stripes in a row is a bar chart of nothing, and the dot leaves
 * the card's edge to the border, which is what separates the six of them.
 *
 * A button, not an anchor: it opens the pane that explains it, and the pane
 * is a view rather than a place further down the page.
 */
export function Tile({
  label, icon, model, onClick,
}: { label: string; icon?: React.ReactNode; model: TileModel; onClick?: () => void }) {
  const tone = TONE[model.health];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group text-left rounded-xl border border-hairline bg-card px-3.5 py-3 flex flex-col gap-2.5",
        "shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-all",
        "hover:border-ink/20 hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)] hover:-translate-y-px",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-coral/40",
      )}
    >
      <span className="flex items-center gap-2 min-w-0">
        {icon && (
          <span className="grid place-items-center w-5 h-5 rounded-[5px] bg-ink/[0.06] text-ink-muted shrink-0 group-hover:text-ink-soft transition-colors">
            {icon}
          </span>
        )}
        <span className="text-[0.63rem] uppercase tracking-[0.12em] text-ink-muted font-semibold truncate">{label}</span>
        <span aria-label={tone.word} className={cn("ml-auto shrink-0 w-1.5 h-1.5 rounded-full", tone.dot)} />
      </span>

      {/* Sized by what it is: "2 paid" is a figure and gets figure size,
          "built before build-info.json" is a sentence and gets sentence size.
          One size for both makes every long state shout. */}
      <span className={cn(
        "leading-none font-semibold tabular-nums truncate",
        model.value.length > 12 ? "text-[1.05rem]" : "text-[1.4rem]",
        tone.value,
      )}>
        {model.value}
      </span>

      {model.meter && <MeterBar meter={model.meter} />}

      <span className="text-[0.7rem] text-ink-muted truncate" title={model.sub}>{model.sub}</span>
    </button>
  );
}

// ── Shared chrome ──────────────────────────────────────────────────────────

/** The card every panel is built in. One border, one hairline, no nesting. */
export function Section({
  id, title, icon, description, right, children,
}: {
  id?: string;
  title: string;
  icon?: React.ReactNode;
  description?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="rounded-xl border border-hairline bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04)] overflow-hidden"
    >
      <div className="px-4 py-3 border-b border-hairline flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[0.85rem] font-semibold text-ink flex items-center gap-2">
            {icon && <span className="text-ink-muted">{icon}</span>}
            {title}
          </h2>
          {description && (
            <p className="text-[0.7rem] text-ink-muted leading-relaxed mt-1 max-w-[68ch]">{description}</p>
          )}
        </div>
        {right && <div className="shrink-0 flex items-center gap-2">{right}</div>}
      </div>
      {children}
    </section>
  );
}

/** A labelled figure. Used in fours and eights, so it sets its own baseline. */
export function Fact({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div title={hint} className="min-w-0">
      <dt className="text-[0.6rem] uppercase tracking-[0.12em] text-ink-muted font-semibold">{label}</dt>
      <dd className="text-[0.95rem] text-ink mt-1 tabular-nums font-medium truncate">{value}</dd>
    </div>
  );
}

export function Badge({ tone, children }: { tone: "good" | "bad" | "muted" | "warn" | "accent"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[0.65rem] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap border",
        tone === "good" && "bg-good/10 text-good border-good/25",
        tone === "bad" && "bg-bad/10 text-bad border-bad/25",
        tone === "warn" && "bg-gold text-gold-ink border-gold",
        tone === "accent" && "bg-coral/10 text-coral border-coral/25",
        tone === "muted" && "bg-ink/[0.05] text-ink-muted border-hairline",
      )}
    >
      {children}
    </span>
  );
}

/**
 * The state of one row, as shape AND colour. Red and green are the one pair a
 * large share of readers cannot separate, so the glyph carries it too, and the
 * label is on the element for a screen reader.
 */
export function StateMark({ state }: { state: CheckState }) {
  const g = PROBE_GLYPH[state];
  return (
    <span
      aria-label={g.word}
      className={cn(
        "inline-grid place-items-center w-4.5 h-4.5 rounded-full text-[0.6rem] font-bold shrink-0",
        state === "ok" && "bg-good/12 text-good",
        // Filled, not washed: --gold-ink only has contrast against gold
        // itself, and a 20% wash of it on a dark card is not gold.
        state === "warn" && "bg-gold text-gold-ink",
        state === "fail" && "bg-bad/12 text-bad",
        state === "skip" && "bg-ink/[0.06] text-ink-muted",
      )}
    >
      {g.glyph}
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
  const real = runs.filter((r) => !r.dryRun);
  const max = Math.max(1, ...runs.map((r) => (r.dryRun ? 0 : r.durationMs)));
  const failed = runs.filter((r) => r.outcome === "failed").length;
  return (
    <div className="px-4 py-3.5 border-b border-hairline">
      <div className="flex items-center justify-between gap-3 mb-2.5">
        <span className="text-[0.6rem] uppercase tracking-[0.12em] text-ink-muted font-semibold">
          Last {runs.length} run{runs.length === 1 ? "" : "s"}
        </span>
        <span className="flex items-center gap-3 text-[0.68rem] text-ink-muted tabular-nums">
          <span>median <strong className="text-ink font-semibold">{dur(median(real.map((r) => r.durationMs)))}</strong></span>
          <span className={failed ? "text-bad font-semibold" : ""}>{failed} failed</span>
        </span>
      </div>
      <div className="flex items-end gap-[3px] h-12">
        {runs.map((r) => {
          const pct = r.dryRun ? 10 : Math.max(8, Math.round((r.durationMs / max) * 100));
          const title = r.dryRun
            ? `${when(r.startedAt)} · dry run`
            : `${when(r.startedAt)} · ${r.outcome === "ok" ? "succeeded" : `failed at ${shortStep(r.failedAt)}`} · ${dur(r.durationMs)}`;
          return (
            <span
              key={r.startedAt}
              title={title}
              className={cn(
                "flex-1 min-w-1 max-w-3.5 rounded-sm transition-opacity hover:opacity-100",
                r.dryRun ? "bg-ink/15" : r.outcome === "ok" ? "bg-good/60 hover:bg-good" : "bg-bad",
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

/** Shape and screen-reader word per state; StateMark owns the colour. */
const PROBE_GLYPH: Record<ProbeState, { glyph: string; word: string }> = {
  ok: { glyph: "✓", word: "ok" },
  warn: { glyph: "!", word: "warning" },
  fail: { glyph: "✕", word: "failed" },
  skip: { glyph: "·", word: "skipped" },
};

export function ChecksSection({
  probes, checkedAt, onRerun,
}: { probes: Loaded<Map<string, ProbeResult>>; checkedAt: number | null; onRerun: () => void }) {
  const running = probes.state !== "ready";
  return (
    <Section
      id="panel-checks"
      title="Site checks"
      description="The requests a reader makes, made from here, now. Green is a status code, not a promise."
      right={
        <>
          {checkedAt && !running && (
            <span className="text-[0.65rem] text-ink-muted tabular-nums">checked {ago(new Date(checkedAt).toISOString())}</span>
          )}
          <button
            type="button"
            onClick={onRerun}
            disabled={running}
            className="h-7 px-2.5 rounded-lg text-[0.7rem] font-semibold border border-hairline text-ink hover:bg-ink/[0.04] transition-colors disabled:opacity-50"
          >
            {running ? "Running…" : "Run again"}
          </button>
        </>
      }
    >
      <div className="divide-y divide-hairline">
        {PROBES.map((p) => {
          const r = probes.state === "ready" ? probes.data.get(p.id) : undefined;
          return (
            <div key={p.id} className="px-4 py-2.5 flex items-center gap-3 hover:bg-ink/[0.02] transition-colors">
              {r ? <StateMark state={r.state} /> : <span className="w-4.5 h-4.5 rounded-full bg-ink/[0.06] animate-pulse shrink-0" />}
              <span className="text-[0.82rem] text-ink min-w-0 truncate" title={p.why}>{p.label}</span>
              {p.cost && <span className="text-[0.62rem] text-ink-muted border border-hairline rounded px-1.5 py-px shrink-0">{p.cost}</span>}
              <span className={cn(
                "ml-auto text-[0.72rem] tabular-nums whitespace-nowrap shrink-0",
                r?.state === "fail" ? "text-bad font-semibold" : "text-ink-muted",
              )}>
                {r ? r.detail : "…"}
              </span>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// ── Data checks ────────────────────────────────────────────────────────────

export function DataChecksSection({ checks }: { checks: Loaded<Checks> }) {
  const ready = checks.state === "ready" ? checks.data : null;
  return (
    <Section
      id="panel-data"
      title="Data checks"
      description="What the last run wrote, looked at as a whole: the slate against the index, each team against yesterday, R2 against tonight. A finding marks the run; it does not undo it."
      right={
        ready && (
          <span className="text-[0.65rem] text-ink-muted tabular-nums">
            slate {shortDate(ready.slate)} · checked {ago(ready.at)}
          </span>
        )
      }
    >
      {checks.state === "loading" && <p className="px-4 py-4 text-sm text-ink-muted">Reading the report…</p>}
      {checks.state === "error" && <p className="px-4 py-4 text-sm text-bad">{checks.message}</p>}
      {checks.state === "none" && (
        <p className="px-4 py-4 text-sm text-ink-muted">
          No report yet. The nightly writes one after every publish, from the same run that did the publishing.
        </p>
      )}
      {ready && (
        <div className="divide-y divide-hairline">
          {ready.checks.map((c) => (
            <div key={c.id} className="px-4 py-2.5 flex items-start gap-3 hover:bg-ink/[0.02] transition-colors">
              <span className="mt-px"><StateMark state={c.state} /></span>
              <span className="text-[0.82rem] text-ink shrink-0 w-40 truncate" title={c.label}>{c.label}</span>
              <span className={cn(
                "text-[0.72rem] leading-relaxed min-w-0",
                c.state === "fail" ? "text-bad font-semibold" : c.state === "warn" ? "text-ink" : "text-ink-muted",
              )}>
                {c.detail}
              </span>
            </div>
          ))}
        </div>
      )}
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
      id="panel-subscribers"
      title="Subscribers"
      description="Counted server-side on every load — this panel is the only thing here that reads the accounts table."
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
            <dl className="px-4 py-4 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-4 border-b border-hairline">
              <Fact label="Paying now" value={<><span className="text-ink">{s.active}</span> <span className="text-ink-muted font-normal text-[0.78rem] ml-1">{s.monthly} monthly · {s.yearly} yearly</span></>} />
              <Fact label="New paid, 30d" value={s.paidNew30d} />
              <Fact label="Cancelling" value={s.cancelling} hint="Still paid today, already told Stripe to stop." />
              <Fact label="Past due" value={s.pastDue} hint="A card failed and Stripe is retrying. Access continues." />
              <Fact label="Accounts" value={s.accounts} />
              <Fact label="New, 7 days" value={s.new7d} />
              <Fact label="New, 30 days" value={s.new30d} />
              <Fact label="Staff" value={s.admins} />
            </dl>
            <div className="px-4 pt-3 pb-1 text-[0.6rem] uppercase tracking-[0.12em] text-ink-muted font-semibold">
              Latest sign-ups
            </div>
            <div className="divide-y divide-hairline">
              {s.recent.map((r) => {
                const p = planLabel(r.tier, r.status, r.role);
                return (
                  <div key={`${r.email}-${r.createdAt}`} className="px-4 py-2.5 flex items-center gap-3 hover:bg-ink/[0.02] transition-colors">
                    <span className="text-[0.82rem] text-ink truncate min-w-0 flex-1">
                      {r.email ?? <span className="text-ink-muted">no email</span>}
                    </span>
                    <Badge tone={p.tone}>{p.text}</Badge>
                    <span className="text-[0.7rem] text-ink-muted tabular-nums whitespace-nowrap shrink-0 w-24 text-right">{ago(r.createdAt)}</span>
                  </div>
                );
              })}
              {s.recent.length === 0 && <p className="px-4 py-4 text-sm text-ink-muted">No accounts yet.</p>}
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
    <div className="px-4 py-3 border-t border-hairline text-[0.72rem] text-ink-muted leading-relaxed flex items-start gap-2">
      <span className="text-[0.6rem] uppercase tracking-[0.12em] font-semibold shrink-0 pt-px">Stripe webhook</span>
      <span className="min-w-0">
        {hb ? (
          <>
            last verified event <strong className="text-ink font-semibold">{hb.type}</strong> {ago(hb.at)}
            {hb.handled ? "" : " (acknowledged, not acted on)"}
            {!hb.ok && <span className="text-bad font-semibold"> — the handler failed; Stripe will retry.</span>}
          </>
        ) : (
          <>
            nothing recorded yet. The webhook writes a note on every event it verifies; the first
            renewal, or a test event from the Stripe dashboard, will fill this in.
          </>
        )}
      </span>
    </div>
  );
}
