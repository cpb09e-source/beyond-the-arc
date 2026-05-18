"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  parseSpec,
  processTeams,
  type RawTeamSeason,
} from "@/lib/team-filters";
import { FilterBar } from "@/components/explorer/filter-bar";
import { SortControls } from "@/components/explorer/sort-controls";
import { SortableTh } from "@/components/explorer/sortable-th";
import { TeamLogo } from "@/components/team-logo";
import { TourneyBadge } from "@/components/tourney-badge";
import { confDisplay } from "@/lib/conf-display";

function fmtNum(x: number | null, digits = 1): string {
  if (x === null || x === undefined) return "—";
  return x.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function fmtPct(x: number | null): string {
  if (x === null || x === undefined) return "—";
  return (x * 100).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "%";
}
function teamSlug(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function seasonLabel(y: number): string {
  return `${(y - 1).toString().slice(-2)}-${y.toString().slice(-2)}`;
}

function btaColor(v: number | null): string {
  if (v === null) return "text-ink-muted";
  if (v >= 75) return "text-coral font-medium";
  if (v >= 40) return "text-coral/80";
  if (v >= 10) return "text-ink";
  if (v <= -75) return "text-ink/40";
  if (v <= -40) return "text-ink-muted";
  return "text-ink-soft";
}
function pctColor(pct: number | null): string {
  if (pct === null) return "transparent";
  const hue = (pct / 100) * 120;
  return `hsl(${hue}, 38%, 38%)`;
}
function pctBg(pct: number | null): string {
  if (pct === null) return "transparent";
  const hue = (pct / 100) * 120;
  return `hsl(${hue}, 38%, 92%)`;
}

function ValueWithPct({ value, pct, format }: { value: number | null; pct: number | null; format: "num1" | "pct1" }) {
  let display = "—";
  if (value !== null && value !== undefined) {
    if (format === "pct1") display = (value * 100).toFixed(1) + "%";
    else display = value.toFixed(1);
  }
  return (
    <span className="inline-flex items-baseline justify-end gap-1.5">
      <span>{display}</span>
      {pct !== null && (
        <span
          className="text-[0.6rem] font-medium tabular w-7 text-center py-px rounded leading-none"
          style={{ color: pctColor(pct), background: pctBg(pct) }}
          aria-label={`${pct}th percentile`}
        >
          {pct}
        </span>
      )}
    </span>
  );
}

export function ExplorerClient({
  allTeams,
  confsByYear,
}: {
  allTeams: RawTeamSeason[];
  confsByYear: Record<string, string[]>;
}) {
  const search = useSearchParams();
  const params = useMemo(() => {
    const obj: Record<string, string> = {};
    for (const [k, v] of search.entries()) obj[k] = v;
    return obj;
  }, [search]);
  const spec = parseSpec(params);
  const newest = spec.years[0] ?? 2026;
  const conferences = confsByYear[String(newest)] ?? [];

  // Pure-JS filter + sort + derive every time the spec changes.
  // 2200 rows → ~5-15ms on modern hardware; sort is the cost.
  const { rows, count } = useMemo(() => processTeams(allTeams, spec), [allTeams, spec]);
  const multiYear = spec.years.length > 1;

  // Conference rankings — locked to the most-recent season available, regardless
  // of the explorer's current year selection. Drops the worst 2 teams in each
  // conference before averaging BTA RTG (filters out cellar dwellers so the
  // ranking reflects the conference's competitive core).
  const latestYear = useMemo(() => Math.max(...allTeams.map((t) => t.year)), [allTeams]);
  const conferenceRankings = useMemo(() => {
    // limit: -1 disables the explorer's default top-50 cap. Without this, we'd
    // only see teams that crack the national top-50 BTA RTG, hiding most of
    // each mid-major conference and inflating the averages.
    const scopedSpec = { ...parseSpec({}), years: [latestYear], limit: -1 };
    const { rows: scoped } = processTeams(allTeams, scopedSpec);
    const byConf = new Map<string, number[]>();
    for (const r of scoped) {
      if (!r.team_conference || r.bta_rtg === null) continue;
      const arr = byConf.get(r.team_conference) ?? [];
      arr.push(r.bta_rtg);
      byConf.set(r.team_conference, arr);
    }
    return Array.from(byConf.entries())
      .map(([conference, values]) => {
        const sorted = [...values].sort((a, b) => b - a);
        const kept = sorted.slice(0, Math.max(0, sorted.length - 2));
        const avg = kept.length > 0 ? kept.reduce((s, v) => s + v, 0) / kept.length : null;
        return { conference, avg_bta_rtg: avg, teams: values.length, contributing: kept.length };
      })
      .filter((r): r is { conference: string; avg_bta_rtg: number; teams: number; contributing: number } => r.avg_bta_rtg !== null)
      .sort((a, b) => b.avg_bta_rtg - a.avg_bta_rtg);
  }, [allTeams, latestYear]);

  return (
    <>
      <FilterBar conferences={conferences} conferenceRankings={conferenceRankings} years={[latestYear]} />

      <div className="bg-card border border-hairline rounded-lg overflow-hidden mt-6">
        <div className="flex flex-wrap items-end justify-between gap-4 px-4 lg:px-5 py-3 border-b border-hairline">
          <div className="flex items-baseline gap-3 pb-1">
            <span className="font-display text-xl text-ink tabular">
              {rows.length}
              {count > rows.length ? ` of ${count.toLocaleString()}` : ""}
            </span>
            <span className="text-sm text-ink-muted">
              {rows.length === 1 ? "team-season" : "team-seasons"} match
            </span>
            {count > rows.length && (
              <span className="text-xs text-ink-muted hidden md:inline">
                · showing first {rows.length}
              </span>
            )}
          </div>
          <SortControls />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline text-left">
                <Th className="w-12 text-center">#</Th>
                <Th>Team</Th>
                <Th className="w-16">Conf</Th>
                {multiYear && <Th className="w-16">Season</Th>}
                <Th className="w-20">Record</Th>
                <SortableTh statKey="bta_rtg"   label="BTA RTG"  title="Weighted z-score composite ×40" defaultDir="desc" />
                <SortableTh statKey="bta_net"   label="Adj Net"  title="Adj ORtg − Adj DRtg. Points per 100 possessions vs an average D-I opponent" defaultDir="desc" />
                <SortableTh statKey="bta_ortg"  label="Adj ORtg" title="Average of Bart adj ORtg and CBB adj ORtg" defaultDir="desc" />
                <SortableTh statKey="bta_drtg"  label="Adj DRtg" title="Average of Bart adj DRtg and CBB adj DRtg (lower = better)" defaultDir="asc" />
                <SortableThCbb statKey="cbb_ts"      label="TS%"      title="CBB true shooting %" />
                <SortableThCbb statKey="cbb_efg"     label="eFG%"     title="CBB effective FG%" />
                <SortableThCbb statKey="cbb_fg3"     label="3P%"      title="CBB 3-point %" />
                <SortableThCbb statKey="cbb_efg_def" label="Opp eFG%" title="CBB opponent eFG% (lower = better)" defaultDir="asc" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={multiYear ? 13 : 12} className="px-4 py-12 text-center text-ink-muted">
                    No teams match these filters.
                  </td>
                </tr>
              ) : (
                rows.map((r, i) => (
                  <tr
                    key={`${r.team_id}-${r.team_year}`}
                    className="border-b border-hairline/60 hover:bg-paper-deep/50 transition-colors"
                  >
                    <Td className="text-center text-ink-muted tabular">
                      {i + 1}
                    </Td>
                    <Td>
                      <Link href={`/teams/${teamSlug(r.team_name)}`} className="inline-flex items-center gap-2.5 group">
                        <TeamLogo name={r.team_name} size={24} />
                        <span className="font-medium text-ink group-hover:text-coral transition-colors">{r.team_name}</span>
                        <TourneyBadge teamName={r.team_name} year={r.team_year} />
                      </Link>
                    </Td>
                    <Td className="text-ink-muted">{confDisplay(r.team_conference)}</Td>
                    {multiYear && <Td className="text-ink-muted tabular">{seasonLabel(r.team_year)}</Td>}
                    <Td className="tabular text-ink-muted">{r.record ?? "—"}</Td>
                    <Td className={`text-right tabular ${btaColor(r.bta_rtg)}`}>
                      <ValueWithPct value={r.bta_rtg} pct={r.pct.bta_rtg ?? null} format="num1" />
                    </Td>
                    <Td className="text-right tabular"><ValueWithPct value={r.bta_net}  pct={r.pct.bta_net ?? null}  format="num1" /></Td>
                    <Td className="text-right tabular"><ValueWithPct value={r.bta_ortg} pct={r.pct.bta_ortg ?? null} format="num1" /></Td>
                    <Td className="text-right tabular"><ValueWithPct value={r.bta_drtg} pct={r.pct.bta_drtg ?? null} format="num1" /></Td>
                    <CbbTd><ValueWithPct value={r.cbb_ts}      pct={r.pct.cbb_ts ?? null}      format="pct1" /></CbbTd>
                    <CbbTd><ValueWithPct value={r.cbb_efg}     pct={r.pct.cbb_efg ?? null}     format="pct1" /></CbbTd>
                    <CbbTd><ValueWithPct value={r.cbb_fg3}     pct={r.pct.cbb_fg3 ?? null}     format="pct1" /></CbbTd>
                    <CbbTd><ValueWithPct value={r.cbb_efg_def} pct={r.pct.cbb_efg_def ?? null} format="pct1" /></CbbTd>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-xs uppercase tracking-widest text-ink-muted font-medium ${className}`}>{children}</th>;
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2.5 ${className}`}>{children}</td>;
}
function CbbTd({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2.5 text-right tabular border-l border-coral/15">{children}</td>;
}
function SortableThCbb(props: React.ComponentProps<typeof SortableTh>) {
  return <SortableTh {...props} variant="cbb" defaultDir={props.defaultDir ?? "desc"} />;
}
