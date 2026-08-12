"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { TeamLogo } from "@/components/team-logo";
import { PercentileChip } from "@/components/percentile-chip";
import { PlayerName } from "@/components/player-name";

/**
 * The 2026-27 projection table, and the per-team rotation behind each row.
 *
 * One page, not 365. Every team's projected roster is already in the payload
 * the table is built from, so opening a team is a state change rather than a
 * navigation — no second request, no route per team, and the reader keeps his
 * place in the ranking when he closes it.
 */

export type ProjPlayer = {
  name: string; bart_id: number | null; cls: string | null; ht: string | null;
  status: "returning" | "transfer" | "newcomer" | string;
  from: string | null; rsci: number | null; link: boolean;
  last_epm: number | null; proj_epm: number | null; mpg: number | null;
  min_share: number | null; basis: string | null;
};
export type ProjTeam = {
  rank: number; team: string; conf: string | null;
  bart_rank: number | null; bart_proj_w: number | null; bart_proj_l: number | null;
  proj_net: number; from_returning: number; from_transfer: number; from_freshman: number;
  ret_min_share: number; roster: ProjPlayer[];
};
export type ProjectionFile = {
  season: number; label: string; built_at: string; roster_snapshot: string | null;
  method: Record<string, string>; teams: ProjTeam[];
};

const fmt = (n: number | null | undefined, d = 1) =>
  n == null ? "—" : (n > 0 ? "+" : "") + n.toFixed(d);

const STATUS: Record<string, { label: string; cls: string }> = {
  returning: { label: "Ret", cls: "bg-green-500/15 text-green-600" },
  transfer: { label: "Xfer", cls: "bg-coral/15 text-coral" },
  newcomer: { label: "New", cls: "bg-blue-500/15 text-blue-500" },
};

export function ProjectionsClient({ data }: { data: ProjectionFile }) {
  const [q, setQ] = useState("");
  const [conf, setConf] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const confs = useMemo(
    () => [...new Set(data.teams.map((t) => t.conf).filter(Boolean))].sort() as string[],
    [data.teams],
  );

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.teams.filter(
      (t) => (!needle || t.team.toLowerCase().includes(needle)) && (!conf || t.conf === conf),
    );
  }, [data.teams, q, conf]);

  // Colour the rating column against the field rather than a fixed scale, so
  // the ramp means the same thing here as everywhere else on the site.
  const pctOf = useMemo(() => {
    const sorted = [...data.teams].map((t) => t.proj_net).sort((a, b) => a - b);
    return (v: number) => {
      let lo = 0, hi = sorted.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid]! < v) lo = mid + 1; else hi = mid; }
      return Math.round((lo / (sorted.length - 1)) * 100);
    };
  }, [data.teams]);

  return (
    <div className="mx-auto max-w-[88rem] px-5 sm:px-6 lg:px-10 py-8 lg:py-12">
      <header className="mb-6">
        <span className="text-xs uppercase tracking-widest text-coral font-medium">
          {data.label} · Projections
        </span>
        <h1 className="font-display text-3xl sm:text-4xl text-ink mt-2">Projected team ratings</h1>
        <p className="mt-3 text-sm text-ink-soft max-w-3xl leading-relaxed">
          Every rotation player&rsquo;s EPM projected forward, then weighted by the minutes we expect him
          to play. A team&rsquo;s rating is five times its minutes-weighted average, because five men are on
          the floor at once — the same identity that reproduces a team&rsquo;s actual net rating to within
          0.2 points per 100 when you run it on players who have already played.
        </p>
      </header>

      {/* What the reader needs to know before trusting a number. Stated up front
          rather than buried: the roster snapshot is the weakest input and the
          missing program term has a visible, nameable failure mode. */}
      <details className="mb-6 rounded-lg border border-hairline bg-paper-deep/25 text-sm">
        <summary className="cursor-pointer px-4 py-3 font-medium text-ink select-none">
          How this is built, and where it is weakest
        </summary>
        <div className="px-4 pb-4 space-y-3 text-ink-soft leading-relaxed">
          <p>
            <b className="text-ink">Returning players</b> keep 0.715 of last season&rsquo;s EPM plus 0.23;
            <b className="text-ink"> transfers</b> keep 0.503 plus 0.27. Both were measured over 17,455
            returning player-seasons — a transfer holds barely half his number, which is the single
            largest correction in the model. There are no class bumps: the raw data supports them, but
            once you condition on where a player started, below-average players improve at every class
            (mean reversion, not development) while good juniors and seniors decline.
          </p>
          <p>
            <b className="text-ink">Freshmen</b> enter at a prior set by RSCI rank, adjusted for position.
            Measured over 1,297 ranked recruits: the top five average +2.25 EPM as freshmen and the taper
            is steep, with 61–100 indistinguishable from unranked. Bigs are markedly more freshman-ready
            than guards at every tier — rim protection translates from high school immediately, shot
            creation does not.
          </p>
          <p>
            <b className="text-ink">Minutes</b> follow the real rotation shape, measured across 1,812
            team-seasons: 32.7 mpg for the top man down to 9.6 for the tenth.
          </p>
          <p>
            <b className="text-ink">Where it is weakest.</b> There is no program-strength anchor, which
            Bart Torvik&rsquo;s preseason model has and which exists precisely to stop this failure: a
            mid-major returning good players projects like a high-major. Utah St. at {" "}
            {data.teams.find((t) => t.team === "Utah St.")?.rank ?? "—"} against Bart&rsquo;s 60 is that
            effect, not a discovery. There is also no coaching, momentum or schedule term, and the
            rating scale is compressed by shrinkage — treat the order as the output, not the gap between
            two teams.
          </p>
          <p>
            <b className="text-ink">The rosters are the weakest input, not the model.</b> They are a
            snapshot from {data.roster_snapshot ? new Date(data.roster_snapshot).toLocaleDateString("en-US", { month: "long", day: "numeric" }) : "late July"},
            and the eligibility rulings now working through the courts could return a fifth year to a
            large group of players none of these rosters contain.
          </p>
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-2.5 mb-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search team"
          aria-label="Search teams"
          className="h-9 w-full sm:w-56 px-3 rounded-md border border-ink/15 bg-card text-ink text-sm placeholder:text-ink-muted shadow-sm focus:outline-none focus:ring-2 focus:ring-coral/40"
        />
        <select
          value={conf}
          onChange={(e) => setConf(e.target.value)}
          aria-label="Conference"
          className="h-9 px-2 rounded-md border border-ink/15 bg-card text-ink text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-coral/40"
        >
          <option value="">All conferences</option>
          {confs.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="text-xs text-ink-muted tabular">{rows.length} of {data.teams.length} teams</span>
      </div>

      <div className="border-y border-x-0 lg:border-x border-hairline rounded-none lg:rounded-xl overflow-hidden bg-paper-deep/25 -mx-5 sm:-mx-6 lg:mx-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-paper-deep/70">
              <tr className="text-xs uppercase tracking-wide text-ink-muted">
                <th className="px-2 sm:px-3 py-2.5 text-left font-medium">Rk</th>
                <th className="px-2 sm:px-3 py-2.5 text-left font-medium">Team</th>
                <th className="px-2 sm:px-3 py-2.5 text-left font-medium hidden sm:table-cell">Conf</th>
                <th className="px-2 sm:px-3 py-2.5 text-right font-medium">Proj</th>
                <th className="px-2 sm:px-3 py-2.5 text-right font-medium hidden md:table-cell">Ret</th>
                <th className="px-2 sm:px-3 py-2.5 text-right font-medium hidden md:table-cell">Xfer</th>
                <th className="px-2 sm:px-3 py-2.5 text-right font-medium hidden md:table-cell">Fr</th>
                <th className="px-2 sm:px-3 py-2.5 text-right font-medium hidden lg:table-cell">Ret min</th>
                <th className="px-2 sm:px-3 py-2.5 text-right font-medium hidden sm:table-cell">T-Rank</th>
                <th className="px-2 sm:px-3 py-2.5 text-right font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((t, i) => {
                const isOpen = open === t.team;
                return (
                  <Fragment key={t.team}>
                    <tr
                      onClick={() => setOpen(isOpen ? null : t.team)}
                      className={cn(
                        "cursor-pointer transition-colors hover:bg-[var(--accent-tint)]",
                        isOpen ? "bg-coral/5" : i % 2 === 0 ? "bg-paper/70" : "bg-transparent",
                      )}
                    >
                      <td className="px-2 sm:px-3 py-2 tabular text-ink-muted">{t.rank}</td>
                      <td className="px-2 sm:px-3 py-2">
                        <span className="inline-flex items-center gap-2 min-w-0">
                          <TeamLogo name={t.team} size={20} className="shrink-0 rounded-[3px]" />
                          <span className="font-medium text-ink truncate">{t.team}</span>
                        </span>
                      </td>
                      <td className="px-2 sm:px-3 py-2 text-ink-muted text-xs hidden sm:table-cell">{t.conf}</td>
                      <td className="px-2 sm:px-3 py-2 text-right tabular">
                        <span className="inline-flex flex-col items-end gap-0.5 leading-tight">
                          <span className="font-semibold text-ink">{fmt(t.proj_net)}</span>
                          <PercentileChip pct={pctOf(t.proj_net)} />
                        </span>
                      </td>
                      <td className="px-2 sm:px-3 py-2 text-right tabular text-ink-soft hidden md:table-cell">{fmt(t.from_returning)}</td>
                      <td className="px-2 sm:px-3 py-2 text-right tabular text-ink-soft hidden md:table-cell">{fmt(t.from_transfer)}</td>
                      <td className="px-2 sm:px-3 py-2 text-right tabular text-ink-soft hidden md:table-cell">{fmt(t.from_freshman)}</td>
                      <td className="px-2 sm:px-3 py-2 text-right tabular text-ink-muted hidden lg:table-cell">{Math.round(t.ret_min_share * 100)}%</td>
                      <td className="px-2 sm:px-3 py-2 text-right tabular text-ink-muted hidden sm:table-cell">{t.bart_rank ?? "—"}</td>
                      <td className="px-2 sm:px-3 py-2 text-right text-ink-muted text-xs">{isOpen ? "▾" : "▸"}</td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={10} className="px-0 py-0 bg-paper-deep/40 border-y border-hairline">
                          <TeamDetail t={t} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-4 text-xs text-ink-muted">
        Rosters from the {data.label} preview snapshot. Recruit rankings: RSCI (Recruiting Services
        Consensus Index), rscihoops.com. Preseason T-Rank column is Bart Torvik&rsquo;s, shown for
        comparison.
      </p>
    </div>
  );
}

function TeamDetail({ t }: { t: ProjTeam }) {
  const rotation = t.roster.filter((p) => (p.mpg ?? 0) > 0);
  const rest = t.roster.filter((p) => !((p.mpg ?? 0) > 0));
  return (
    <div className="px-4 sm:px-6 py-5">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 mb-4">
        <h3 className="font-display text-2xl text-ink">{t.team} — projected rotation</h3>
        <span className="text-xs text-ink-muted">
          {t.bart_proj_w != null && <>Bart projects {t.bart_proj_w}-{t.bart_proj_l} · </>}
          {Math.round(t.ret_min_share * 100)}% of projected minutes are returning players
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-ink-muted border-b border-hairline">
              <th className="px-2 py-2 text-left font-medium">Player</th>
              <th className="px-2 py-2 text-left font-medium">Cl</th>
              <th className="px-2 py-2 text-left font-medium hidden sm:table-cell">Ht</th>
              <th className="px-2 py-2 text-right font-medium">MPG</th>
              <th className="px-2 py-2 text-right font-medium">Proj EPM</th>
              <th className="px-2 py-2 text-right font-medium hidden sm:table-cell">25-26</th>
              <th className="px-2 py-2 text-left font-medium hidden md:table-cell">Basis</th>
            </tr>
          </thead>
          <tbody>
            {rotation.map((p, i) => (
              <tr key={`${p.name}-${i}`} className={i % 2 === 0 ? "bg-paper/50" : undefined}>
                <td className="px-2 py-1.5 whitespace-nowrap">
                  {p.link && p.bart_id ? (
                    <Link href={`/players/${p.bart_id}/`} title={p.name} prefetch={false}
                      className="font-medium text-ink hover:text-coral transition-colors">
                      <PlayerName name={p.name} />
                    </Link>
                  ) : (
                    <span className="font-medium text-ink" title={p.name}><PlayerName name={p.name} /></span>
                  )}
                  {STATUS[p.status] && (
                    <span className={cn("ml-2 inline-block align-middle text-[0.6rem] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded", STATUS[p.status]!.cls)}>
                      {STATUS[p.status]!.label}
                    </span>
                  )}
                  {p.from && <TeamLogo name={p.from} size={16} className="ml-1.5 inline-block align-middle rounded-[2px]" />}
                  {p.rsci != null && (
                    <span title={`RSCI national recruit rank #${p.rsci}`}
                      className="ml-1.5 inline-block align-middle text-[0.6rem] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600">
                      #{p.rsci}
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-ink-muted">{p.cls ?? "—"}</td>
                <td className="px-2 py-1.5 text-ink-muted whitespace-nowrap hidden sm:table-cell">{p.ht ?? "—"}</td>
                <td className="px-2 py-1.5 text-right tabular text-ink">{p.mpg?.toFixed(1) ?? "—"}</td>
                <td className="px-2 py-1.5 text-right tabular font-semibold text-ink">{fmt(p.proj_epm, 2)}</td>
                <td className="px-2 py-1.5 text-right tabular text-ink-soft hidden sm:table-cell">{p.last_epm == null ? "—" : fmt(p.last_epm, 1)}</td>
                <td className="px-2 py-1.5 text-ink-muted text-xs hidden md:table-cell">{p.basis}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rest.length > 0 && (
        <p className="mt-3 text-xs text-ink-muted">
          Outside the projected rotation: {rest.map((p) => p.name).join(", ")}
        </p>
      )}
    </div>
  );
}
