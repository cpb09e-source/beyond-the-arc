"use client";

import { useMemo, useState } from "react";
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
import { PercentileChip } from "@/components/percentile-chip";
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
function ValueWithPct({ value, pct, format }: { value: number | null; pct: number | null; format: "num1" | "pct1" | "num1signed" | "num0signed" }) {
  let display = "—";
  if (value !== null && value !== undefined) {
    if (format === "pct1") display = (value * 100).toFixed(1) + "%";
    else if (format === "num1signed") display = (value > 0 ? "+" : "") + value.toFixed(1);
    else if (format === "num0signed") display = (value > 0 ? "+" : "") + value.toFixed(0);
    else display = value.toFixed(1);
  }
  return (
    <span className="inline-flex items-baseline justify-end gap-1.5">
      <span>{display}</span>
      <PercentileChip pct={pct} />
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

  // Union conferences across every year we have data for, so users can pick
  // a historical conference even when the visible-year selection wouldn't
  // include it on its own. Same idea for team names — one flat picker list.
  const conferences = useMemo(() => {
    const s = new Set<string>();
    for (const list of Object.values(confsByYear)) for (const c of list) s.add(c);
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [confsByYear]);
  const teamNames = useMemo(() => {
    const s = new Set<string>();
    for (const t of allTeams) s.add(t.name);
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [allTeams]);

  // Inline quick-filter on the table — by team name only, separate from the
  // URL-persisted Team picker in the FilterBar above. We run processTeams with
  // limit=-1 so the search matches across the full result set rather than just
  // the top-N visible window, then re-apply the limit after filtering.
  const [tableSearch, setTableSearch] = useState("");

  const { rows, count } = useMemo(() => {
    const { rows: all } = processTeams(allTeams, { ...spec, limit: -1 });
    const q = tableSearch.trim().toLowerCase();
    const matched = q ? all.filter((r) => r.team_name.toLowerCase().includes(q)) : all;
    return {
      rows: spec.limit === -1 ? matched : matched.slice(0, spec.limit),
      count: matched.length,
    };
  }, [allTeams, spec, tableSearch]);
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
      <FilterBar conferences={conferences} teams={teamNames} conferenceRankings={conferenceRankings} years={[latestYear]} />

      {/* Headline-ledger treatment matches /coaches and /players. */}
      <div id="teams-table" className="bg-card border border-ink/10 rounded-xl shadow-md overflow-hidden ring-1 ring-ink/5 mt-6 scroll-mt-4">
        {/* Top accent rule. */}
        <div className="h-1 w-full bg-gradient-to-r from-coral via-coral to-coral/60" />
        <div className="px-5 lg:px-7 pt-5 pb-3 lg:pt-6 lg:pb-4 bg-paper-deep/30 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-display text-3xl lg:text-4xl text-ink leading-none tracking-tight">
              Teams
            </h2>
            <div className="mt-2 text-sm text-ink-muted">
              <span className="font-display text-xl text-ink tabular leading-none">{rows.length.toLocaleString()}</span>
              {count > rows.length && (
                <span className="text-ink-muted"> of {count.toLocaleString()}</span>
              )}{" "}
              {rows.length === 1 ? "team-season" : "team-seasons"} match
              {count > rows.length && (
                <span className="text-ink-muted hidden md:inline"> · showing first {rows.length}</span>
              )}
            </div>
          </div>
          <div className="flex items-end gap-3 flex-wrap">
            <label className="flex flex-col gap-1">
              <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">Search</span>
              <div className="relative">
                {/* Search-glass icon — inline SVG matches the /coaches search input. */}
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted pointer-events-none"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx={11} cy={11} r={7} />
                  <line x1={20} y1={20} x2={16.65} y2={16.65} />
                </svg>
                <input
                  type="search"
                  value={tableSearch}
                  onChange={(e) => setTableSearch(e.target.value)}
                  placeholder="Search team…"
                  aria-label="Search teams in table"
                  className="h-9 w-52 pl-8 pr-8 rounded-md border border-ink/15 bg-card text-ink text-sm placeholder:text-ink-muted shadow-sm hover:border-ink/25 focus:outline-none focus:ring-2 focus:ring-coral/40 focus:border-coral/40 transition-colors"
                />
                {tableSearch && (
                  <button
                    type="button"
                    onClick={() => setTableSearch("")}
                    aria-label="Clear search"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-muted hover:text-coral text-base leading-none w-5 h-5 inline-flex items-center justify-center rounded hover:bg-paper-deep"
                  >
                    ×
                  </button>
                )}
              </div>
            </label>
            <SortControls />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              {/* Group-label band — sits ABOVE the column-header row in its own
                  lighter strip so the "Four Factors" caption reads as a section
                  label, not another header. Stays inside <thead> so it stays
                  aligned with the four columns it labels. */}
              <tr className="bg-paper-deep/30">
                <th colSpan={multiYear ? 9 : 8} className="px-3 py-2" />
                <th colSpan={4} className="px-3 py-2 text-[0.65rem] uppercase tracking-[0.18em] text-coral font-bold text-center">
                  Four Factors
                </th>
              </tr>
              <tr className="border-y border-hairline text-left bg-paper-deep/70">
                <Th className="w-12 text-center">#</Th>
                <Th>Team</Th>
                <Th className="w-16">Conf</Th>
                {multiYear && <Th className="w-16">Season</Th>}
                <Th className="w-20">Record</Th>
                <SortableTh statKey="bta_rtg"   label="BTA RTG"  title="Weighted z-score composite ×40" defaultDir="desc" />
                <SortableTh statKey="bta_net"   label="Adj Net"  title="Adj ORtg − Adj DRtg. Points per 100 possessions vs an average D-I opponent" defaultDir="desc" />
                <SortableTh statKey="bta_ortg"  label="Adj ORtg" title="Average of Bart adj ORtg and CBB adj ORtg" defaultDir="desc" />
                <SortableTh statKey="bta_drtg"  label="Adj DRtg" title="Average of Bart adj DRtg and CBB adj DRtg (lower = better)" defaultDir="asc" />
                <SortableThCbb statKey="reb_diff_ct"  label="REB Diff" title="Total rebounds − opponent rebounds (season total)" defaultDir="desc" />
                <SortableThCbb statKey="fg3m_diff_ct" label="3PM Diff" title="3-pointers made − allowed (season total)" defaultDir="desc" />
                <SortableThCbb statKey="fbpts_diff"   label="FBP Diff" title="Fast-break points − allowed (season total)" defaultDir="desc" />
                <SortableThCbb statKey="tov_diff_ct"  label="TOV Diff" title="Turnovers committed − opponent turnovers (negative = good)" defaultDir="asc" />
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
                    className={`transition-colors hover:bg-coral/5 ${i % 2 === 0 ? "bg-paper/70" : "bg-transparent"}`}
                  >
                    <Td className="text-center text-ink-muted tabular">
                      {i + 1}
                    </Td>
                    <Td>
                      <Link
                        href={`/teams/${teamSlug(r.team_name)}/${r.team_year}`}
                        className="inline-flex items-center gap-2.5 group"
                        aria-label={r.team_name}
                      >
                        <TeamLogo name={r.team_name} size={24} />
                        <span className="hidden sm:inline font-medium text-ink group-hover:text-coral transition-colors">
                          {r.team_name}
                        </span>
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
                    <CbbTd><ValueWithPct value={r.reb_diff_ct}  pct={r.pct.reb_diff_ct ?? null}  format="num0signed" /></CbbTd>
                    <CbbTd><ValueWithPct value={r.fg3m_diff_ct} pct={r.pct.fg3m_diff_ct ?? null} format="num0signed" /></CbbTd>
                    <CbbTd><ValueWithPct value={r.fbpts_diff}   pct={r.pct.fbpts_diff ?? null}   format="num0signed" /></CbbTd>
                    <CbbTd><ValueWithPct value={r.tov_diff_ct}  pct={r.pct.tov_diff_ct ?? null}  format="num0signed" /></CbbTd>
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
