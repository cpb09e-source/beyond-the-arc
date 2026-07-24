"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  parseSpec,
  processTeams,
  type RawTeamSeason,
} from "@/lib/team-filters";
import { FilterBar } from "@/components/explorer/filter-bar";
import { SortControls } from "@/components/explorer/sort-controls";
import { SortableTh } from "@/components/explorer/sortable-th";
import { CompareTeamsModal } from "@/components/explorer/compare-teams-modal";
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
  coachByTeamYear,
  tourneyFinishByTeamYear,
}: {
  allTeams: RawTeamSeason[];
  confsByYear: Record<string, string[]>;
  coachByTeamYear: Record<string, string | null>;
  tourneyFinishByTeamYear: Record<string, string>;
}) {
  const [compareOpen, setCompareOpen] = useState(false);
  const search = useSearchParams();
  const params = useMemo(() => {
    const obj: Record<string, string> = {};
    for (const [k, v] of search.entries()) obj[k] = v;
    return obj;
  }, [search]);
  // Memoize so `spec`'s reference is stable across renders — the page-reset
  // effect keys on it, and a fresh object every render would snap the table back
  // to page 1 on any interaction (breaks pagination).
  const spec = useMemo(() => parseSpec(params), [params]);

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
  const [page, setPage] = useState(1);
  // Mobile: the table search collapses to an icon that slides open on tap.
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchPanelRef = useRef<HTMLDivElement>(null);
  // Focus the input on open WITHOUT letting the browser scroll it into view
  // (that scroll-jump is what reads as a "flash" of the table on mobile).
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus({ preventScroll: true });
  }, [searchOpen]);
  // Tap anywhere outside the open search to collapse it.
  useEffect(() => {
    if (!searchOpen) return;
    function onDown(e: PointerEvent) {
      if (searchPanelRef.current && !searchPanelRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
        setTableSearch("");
      }
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [searchOpen]);

  const { rows, count, totalPages, pageSafe } = useMemo(() => {
    const { rows: all } = processTeams(allTeams, { ...spec, limit: -1 });
    const q = tableSearch.trim().toLowerCase();
    const matched = q ? all.filter((r) => r.team_name.toLowerCase().includes(q)) : all;
    const total = matched.length;
    if (spec.limit === -1) {
      return { rows: matched, count: total, totalPages: 1, pageSafe: 1 };
    }
    const totalPages = Math.max(1, Math.ceil(total / spec.limit));
    const pageSafe = Math.min(Math.max(1, page), totalPages);
    const start = (pageSafe - 1) * spec.limit;
    return {
      rows: matched.slice(start, start + spec.limit),
      count: total,
      totalPages,
      pageSafe,
    };
  }, [allTeams, spec, tableSearch, page]);
  // Reset to page 1 when the result set changes (filters, sort, search, limit).
  useEffect(() => { setPage(1); }, [spec, tableSearch]);
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
      <div id="teams-table" className="bg-card border border-ink/10 border-x-0 lg:border-x rounded-none lg:rounded-xl shadow-md overflow-hidden ring-0 lg:ring-1 ring-ink/5 mt-6 scroll-mt-4 -mx-6 lg:mx-0">
        {/* Top accent rule. */}
        <div className="h-1 w-full bg-gradient-to-r from-coral via-coral to-coral/60" />
        <div className="px-4 lg:px-7 pt-5 pb-1 lg:pt-6 lg:pb-4 bg-paper-deep/30 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-baseline gap-4 flex-wrap">
              <h2 className="font-display text-3xl lg:text-4xl text-ink leading-none tracking-tight">
                Teams
              </h2>
              <button
                type="button"
                onClick={() => setCompareOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-coral/40 bg-coral/[0.06] text-coral text-[0.65rem] uppercase tracking-widest font-bold hover:bg-coral/10 hover:border-coral/60 transition-colors"
              >
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M16 3h5v5" />
                  <path d="M8 21H3v-5" />
                  <path d="M21 3l-7 7" />
                  <path d="M3 21l7-7" />
                </svg>
                Compare Teams
              </button>
            </div>
            <div className="mt-2 text-sm text-ink-muted">
              <span className="font-display text-xl text-ink tabular leading-none">{rows.length.toLocaleString()}</span>
              {count > rows.length && (
                <span className="text-ink-muted"> of {count.toLocaleString()}</span>
              )}{" "}
              teams
              {count > rows.length && (
                <span className="text-ink-muted hidden md:inline"> · showing first {rows.length}</span>
              )}
            </div>
          </div>
          <div className="relative flex items-end gap-2 lg:gap-3 w-full lg:w-auto">
            {/* Desktop search — full input with label (hidden on mobile) */}
            <label className="hidden lg:flex flex-col gap-1">
              <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">Search</span>
              <div className="relative">
                <SearchGlass className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted pointer-events-none" />
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

            {/* Sort by / Order / Show — shares the mobile line with the search icon */}
            <div className="flex-1 lg:flex-initial min-w-0">
              <SortControls />
            </div>

            {/* Mobile search icon */}
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-label="Search teams"
              className="lg:hidden shrink-0 h-9 w-9 inline-flex items-center justify-center rounded-md border border-ink/15 bg-card text-ink-muted hover:text-ink hover:border-ink/25 shadow-sm transition-colors"
            >
              <SearchGlass className="w-4 h-4" />
            </button>

            {/* Mobile sliding search — slides over the row from the right on tap.
                text-base (16px) keeps iOS from zooming the page on focus. */}
            <div
              ref={searchPanelRef}
              className={cn(
                "lg:hidden absolute inset-y-0 right-0 w-full flex items-center gap-2 bg-card transform-gpu transition-transform duration-200 ease-out",
                searchOpen ? "translate-x-0" : "translate-x-[105%] pointer-events-none",
              )}
            >
              <div className="relative flex-1">
                <SearchGlass className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="search"
                  inputMode="search"
                  value={tableSearch}
                  onChange={(e) => setTableSearch(e.target.value)}
                  placeholder="Search team…"
                  aria-label="Search teams in table"
                  className="h-9 w-full pl-8 pr-3 rounded-md border border-ink/15 bg-card text-ink text-base placeholder:text-ink-muted shadow-sm focus:outline-none focus:ring-2 focus:ring-coral/40 focus:border-coral/40"
                />
              </div>
              <button
                type="button"
                onClick={() => { setSearchOpen(false); setTableSearch(""); }}
                aria-label="Close search"
                className="shrink-0 h-9 px-2.5 text-sm font-medium text-coral hover:text-ink"
              >
                Done
              </button>
            </div>
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
                <th colSpan={multiYear ? 9 : 8} className="px-3 py-1" />
                <th colSpan={4} className="px-3 py-1 text-[0.65rem] uppercase tracking-[0.18em] text-coral font-bold text-center">
                  Four Factors
                </th>
              </tr>
              <tr className="border-y border-hairline text-left bg-paper-deep/70">
                <Th className="w-12 text-center">#</Th>
                <Th>Team</Th>
                <Th className="w-16 hidden sm:table-cell">Conf</Th>
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
                      {(spec.limit === -1 ? 0 : (pageSafe - 1) * spec.limit) + i + 1}
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
                    <Td className="text-ink-muted hidden sm:table-cell">{confDisplay(r.team_conference)}</Td>
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
        {spec.limit !== -1 && totalPages > 1 && (
          <TeamPagination
            firstShown={(pageSafe - 1) * spec.limit + 1}
            lastShown={Math.min(pageSafe * spec.limit, count)}
            total={count}
            page={pageSafe}
            totalPages={totalPages}
            onPage={(p) => {
              setPage(p);
              document.getElementById("teams-table")?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          />
        )}
      </div>

      {/* Head-to-head compare modal — triggered from the "Click to compare
          teams" link in the Teams card header. Renders via a portal so it
          can sit on top of the page regardless of where the trigger lives. */}
      <CompareTeamsModal
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        allTeams={allTeams}
        coachByTeamYear={coachByTeamYear}
        tourneyFinishByTeamYear={tourneyFinishByTeamYear}
      />
    </>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-xs uppercase tracking-widest text-ink-muted font-medium ${className}`}>{children}</th>;
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2.5 ${className}`}>{children}</td>;
}
function SearchGlass({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx={11} cy={11} r={7} />
      <line x1={20} y1={20} x2={16.65} y2={16.65} />
    </svg>
  );
}

function TeamPagination({
  firstShown, lastShown, total, page, totalPages, onPage,
}: {
  firstShown: number; lastShown: number; total: number; page: number; totalPages: number; onPage: (p: number) => void;
}) {
  const items = paginationItems(page, totalPages);
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 border-t border-hairline text-xs text-ink-muted">
      <span>
        Showing <span className="text-ink tabular">{firstShown.toLocaleString()}</span>–
        <span className="text-ink tabular">{lastShown.toLocaleString()}</span> of{" "}
        <span className="text-ink tabular">{total.toLocaleString()}</span>
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPage(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="px-2 py-1 rounded hover:bg-paper-deep/60 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
          aria-label="Previous page"
        >‹ Prev</button>
        {items.map((it, i) =>
          it === "…" ? (
            <span key={`gap-${i}`} className="px-2 text-ink-muted hidden sm:inline">…</span>
          ) : (
            <button
              key={it}
              type="button"
              onClick={() => onPage(it)}
              aria-current={it === page ? "page" : undefined}
              className={cn(
                "min-w-8 px-2 py-1 rounded tabular transition-colors hidden sm:inline-block",
                it === page ? "bg-coral text-white font-medium" : "hover:bg-paper-deep/60",
              )}
            >{it}</button>
          ),
        )}
        <span className="sm:hidden tabular px-1">{page} / {totalPages}</span>
        <button
          type="button"
          onClick={() => onPage(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className="px-2 py-1 rounded hover:bg-paper-deep/60 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
          aria-label="Next page"
        >Next ›</button>
      </div>
    </div>
  );
}

function paginationItems(page: number, totalPages: number): Array<number | "…"> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const want = new Set<number>([1, totalPages, page, page - 1, page + 1, page - 2, page + 2]);
  const visible = [...want].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b);
  const out: Array<number | "…"> = [];
  let prev = 0;
  for (const n of visible) {
    if (n - prev > 1) out.push("…");
    out.push(n);
    prev = n;
  }
  return out;
}
function CbbTd({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2.5 text-right tabular border-l border-coral/15">{children}</td>;
}
function SortableThCbb(props: React.ComponentProps<typeof SortableTh>) {
  return <SortableTh {...props} variant="cbb" defaultDir={props.defaultDir ?? "desc"} />;
}
