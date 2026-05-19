"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TeamLogo } from "@/components/team-logo";
import { Select } from "@/components/select";
import { SearchableMultiSelect } from "@/components/explorer/searchable-multi-select";
import type { SearchableOption } from "@/components/explorer/searchable-select";
import { cn } from "@/lib/utils";
import { confDisplay } from "@/lib/conf-display";
import { POWER_CONFS } from "@/lib/conf-tiers";
import type { CoachRow } from "@/app/coaches/page";

type SortKey = "name" | "team" | "conference" | "active" | "career_wins" | "career_winpct" | "seasons" | "schools" | "composite";
type StatusFilter = "All" | "Active" | "Inactive";
type TierFilter = "All" | "Power" | "Mid Major";

const STATUS_OPTIONS: StatusFilter[] = ["All", "Active", "Inactive"];
const TIER_OPTIONS: TierFilter[] = ["All", "Power", "Mid Major"];

function teamSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
// Slug helper inlined (mirror of coachSlug in src/lib/coaches.ts). Pulling it
// from coaches.ts breaks the client/server boundary — that file uses node:fs.
const coachSlug = teamSlug;

function fmtPct(pct: number | null): string {
  if (pct === null || pct === undefined) return "—";
  return (pct * 100).toFixed(1) + "%";
}
function fmtRecord(w: number, l: number): string {
  return `${w}-${l}`;
}

export function CoachesClient({ rows }: { rows: CoachRow[] }) {
  // Filter state is mirrored to the URL so pressing back from a coach
  // profile restores the prior filter view. Initial state hydrates from
  // ?q=&conf=&team=&tier=&status=&size=&page=&sort= params; subsequent
  // changes router.replace() back into the URL.
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const [query, setQuery] = useState(() => search.get("q") ?? "");
  const [confFilter, setConfFilter] = useState<string[]>(() => {
    const s = search.get("conf");
    return s ? s.split(",").filter(Boolean) : [];
  });
  const [teamFilter, setTeamFilter] = useState<string[]>(() => {
    const s = search.get("team");
    return s ? s.split(",").filter(Boolean) : [];
  });
  const [tier, setTier] = useState<TierFilter>(() => {
    const v = search.get("tier") as TierFilter | null;
    return v && (v === "All" || v === "Power" || v === "Mid Major") ? v : "All";
  });
  const [status, setStatus] = useState<StatusFilter>(() => {
    const v = search.get("status") as StatusFilter | null;
    return v && (v === "All" || v === "Active" || v === "Inactive") ? v : "All";
  });
  const [pageSize, setPageSize] = useState<number>(() => {
    const n = Number(search.get("size"));
    return Number.isFinite(n) && (n === 50 || n === 100 || n === 250) ? n : 100;
  });
  const [page, setPage] = useState<number>(() => {
    const n = Number(search.get("page"));
    return Number.isFinite(n) && n > 0 ? n : 1;
  });
  const [sortBy, setSortBy] = useState<SortKey>(() => {
    const s = search.get("sort");
    if (!s) return "composite";
    const [key] = s.split("-");
    return (key as SortKey) ?? "composite";
  });
  const [sortDir, setSortDir] = useState<"asc" | "desc">(() => {
    const s = search.get("sort");
    if (!s) return "desc";
    const parts = s.split("-");
    const dir = parts[parts.length - 1];
    return dir === "asc" ? "asc" : "desc";
  });

  // Sync filter state → URL on every change. router.replace keeps the
  // browser history clean (no entry per keystroke); navigation away to a
  // coach profile is the only history entry, so pressing back restores
  // the previously filtered view naturally.
  useEffect(() => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (confFilter.length) params.set("conf", confFilter.join(","));
    if (teamFilter.length) params.set("team", teamFilter.join(","));
    if (tier !== "All") params.set("tier", tier);
    if (status !== "All") params.set("status", status);
    if (pageSize !== 100) params.set("size", String(pageSize));
    if (page > 1) params.set("page", String(page));
    if (sortBy !== "composite" || sortDir !== "desc") {
      params.set("sort", `${sortBy}-${sortDir}`);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [query, confFilter, teamFilter, tier, status, pageSize, page, sortBy, sortDir, pathname, router]);

  const confs = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) if (r.current_conference) s.add(r.current_conference);
    return Array.from(s).sort();
  }, [rows]);
  const confOptions = useMemo<SearchableOption[]>(
    () => confs.map((c) => ({ value: c, label: confDisplay(c) })),
    [confs],
  );
  // Team picker options — every distinct team any coach has been at in our
  // window. Searchable in the dropdown.
  const teamOptions = useMemo<SearchableOption[]>(() => {
    const s = new Set<string>();
    for (const r of rows) for (const t of r.all_teams ?? []) s.add(t);
    return Array.from(s).sort().map((t) => ({ value: t, label: t }));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const confSet = confFilter.length === 0 ? null : new Set(confFilter);
    const teamSet = teamFilter.length === 0 ? null : new Set(teamFilter);
    return rows.filter((r) => {
      if (status === "Active" && !r.is_active) return false;
      if (status === "Inactive" && r.is_active) return false;
      // Match against any team the coach has been at in our window, not
       // just their current team. So picking "Abilene Christian" shows every
       // coach who's coached there since 2013.
      if (teamSet) {
        let hit = false;
        for (const t of r.all_teams ?? []) if (teamSet.has(t)) { hit = true; break; }
        if (!hit) return false;
      }
      if (confSet && (!r.current_conference || !confSet.has(r.current_conference))) return false;
      if (tier !== "All") {
        const isPower = r.current_conference ? POWER_CONFS.has(r.current_conference) : false;
        if (tier === "Power" && !isPower) return false;
        if (tier === "Mid Major" && isPower) return false;
      }
      if (q && !r.name.toLowerCase().includes(q) && !(r.current_team ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, query, confFilter, teamFilter, tier, status]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    function key(r: CoachRow): string | number | boolean | null {
      switch (sortBy) {
        case "name":           return (r.name.split(" ").pop() ?? r.name).toLowerCase();
        case "team":           return (r.current_team ?? "zzz").toLowerCase();
        case "conference":     return r.current_conference ? confDisplay(r.current_conference).toLowerCase() : "zzz";
        case "active":         return r.is_active ? 1 : 0;
        case "career_wins":    return r.career_wins;
        case "career_winpct":  return r.career_win_pct;
        case "seasons":        return r.seasons_count;
        case "schools":        return r.schools_count;
        case "composite":      return r.composite_score ?? null;
      }
    }
    return [...filtered].sort((a, b) => {
      const av = key(a), bv = key(b);
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      // Stable secondary sort by last name
      const al = (a.name.split(" ").pop() ?? a.name).toLowerCase();
      const bl = (b.name.split(" ").pop() ?? b.name).toLowerCase();
      return al.localeCompare(bl);
    });
  }, [filtered, sortBy, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);
  const firstShown = sorted.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const lastShown = Math.min(safePage * pageSize, sorted.length);

  function toggle(k: SortKey, defaultDir: "asc" | "desc") {
    if (sortBy === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(k); setSortDir(defaultDir); }
  }
  function reset() { setQuery(""); setConfFilter([]); setTeamFilter([]); setTier("All"); setStatus("All"); setPage(1); setPageSize(100); }

  const activeCount = rows.filter((r) => r.is_active).length;

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <div className="bg-paper-deep/25 border border-hairline rounded-xl shadow-sm p-4 lg:p-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-widest text-ink-muted font-medium">Status</span>
            <Select value={status} onChange={(v) => { setStatus(v as StatusFilter); setPage(1); }}>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}{s === "Active" && ` (${activeCount})`}</option>)}
            </Select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-widest text-ink-muted font-medium">Team</span>
            <SearchableMultiSelect
              value={teamFilter}
              options={teamOptions}
              onChange={(v) => { setTeamFilter(v); setPage(1); }}
              placeholder="Type to filter…"
              emptyLabel="All teams"
              ariaLabel="Teams"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-widest text-ink-muted font-medium">Conference</span>
            <SearchableMultiSelect
              value={confFilter}
              options={confOptions}
              onChange={(v) => { setConfFilter(v); setPage(1); }}
              placeholder="Type to filter…"
              emptyLabel="All conferences"
              ariaLabel="Conferences"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-widest text-ink-muted font-medium">Tier</span>
            <Select value={tier} onChange={(v) => { setTier(v as TierFilter); setPage(1); }}>
              {TIER_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t === "Power" ? "Power Conferences" : t === "Mid Major" ? "Mid Majors" : t}
                </option>
              ))}
            </Select>
          </label>
          <div className="relative flex-1 min-w-[14rem] max-w-md">
            {/* Search-glass icon on the left — pure SVG so we don't pull in a
                lucide import just for one input. */}
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted pointer-events-none"
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
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(1); }}
              placeholder="Search coach or team"
              aria-label="Search coach or team"
              className="h-10 w-full pl-9 pr-9 rounded-md border border-ink/15 bg-white text-ink text-sm placeholder:text-ink-muted shadow-sm hover:border-ink/25 focus:outline-none focus:ring-2 focus:ring-coral/40 focus:border-coral/40 transition-colors"
            />
            {query && (
              <button onClick={() => { setQuery(""); setPage(1); }} aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted hover:text-coral text-base leading-none w-5 h-5 inline-flex items-center justify-center rounded hover:bg-paper-deep">×</button>
            )}
          </div>
          <button type="button" onClick={reset}
            className="ml-auto text-sm text-ink-muted hover:text-ink px-3 py-2">
            Reset
          </button>
        </div>
      </div>

      {/* Table — headline ledger treatment matches /coaches/<slug> and team pages. */}
      <div className="bg-card border border-ink/10 rounded-xl shadow-md overflow-hidden ring-1 ring-ink/5">
        {/* Top accent rule. */}
        <div className="h-1 w-full bg-gradient-to-r from-coral via-coral to-coral/60" />
        <div className="px-5 lg:px-7 py-5 lg:py-6 border-b border-hairline bg-paper-deep/30 flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-display text-3xl lg:text-4xl text-ink leading-none tracking-tight">
              Head coaches
            </h2>
            <div className="mt-2 text-sm text-ink-muted">
              <span className="font-display text-xl text-ink tabular leading-none">{sorted.length.toLocaleString()}</span>
              {sorted.length !== rows.length && (
                <span className="text-ink-muted"> of {rows.length.toLocaleString()}</span>
              )}{" "}
              {sorted.length === 1 ? "coach" : "coaches"}
              {status !== "All" && <> · {status.toLowerCase()}</>}
              {confFilter.length > 0 && (
                <> · {confFilter.map((c) => confDisplay(c)).join(", ")}</>
              )}
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs uppercase tracking-widest text-ink-muted font-medium">
            <span>Show</span>
            <Select value={String(pageSize)} onChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="250">250</option>
            </Select>
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-paper-deep/70">
              <tr className="border-b border-hairline text-left">
                <Th className="w-10 text-center">#</Th>
                <ThSort label="Coach" active={sortBy==="name"} dir={sortDir} onClick={() => toggle("name","asc")} align="left" />
                <Th className="w-9 hidden sm:table-cell">{""}</Th>
                <ThSort label="Current team" active={sortBy==="team"} dir={sortDir} onClick={() => toggle("team","asc")} align="left" />
                <ThSort label="Conf" active={sortBy==="conference"} dir={sortDir} onClick={() => toggle("conference","asc")} align="left" className="hidden sm:table-cell" />
                <ThSort label="Seasons" active={sortBy==="seasons"} dir={sortDir} onClick={() => toggle("seasons","desc")} className="hidden sm:table-cell" />
                <ThSort label="Record" active={sortBy==="career_wins"} dir={sortDir} onClick={() => toggle("career_wins","desc")} className="hidden sm:table-cell" />
                <ThSort label="Win" active={sortBy==="career_winpct"} dir={sortDir} onClick={() => toggle("career_winpct","desc")} />
                <ThSort label="Composite" active={sortBy==="composite"} dir={sortDir} onClick={() => toggle("composite","desc")} />
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-ink-muted">No coaches match these filters.</td></tr>
              ) : (
                pageRows.map((r, i) => (
                  <tr key={`${r.slug}-${i}`} className={cn("transition-colors hover:bg-coral/5", i % 2 === 0 ? "bg-paper/70" : "bg-transparent")}>
                    <Td className={cn("text-center tabular", r.is_active ? "text-coral" : "text-ink-muted")}>
                      {(safePage - 1) * pageSize + i + 1}
                    </Td>
                    <Td>
                      <Link href={`/coaches/${coachSlug(r.name)}/`} className="text-ink hover:text-coral transition-colors">
                        {r.name}
                      </Link>
                    </Td>
                    <Td className="text-center hidden sm:table-cell">
                      {r.current_team && (
                        <span className="inline-flex items-center" title={r.current_team}>
                          <TeamLogo name={r.current_team} size={28} />
                        </span>
                      )}
                    </Td>
                    <Td>
                      {r.current_team ? (
                        <Link href={`/teams/${teamSlug(r.current_team)}/`} className="font-medium text-ink hover:text-coral transition-colors">
                          {r.current_team}
                        </Link>
                      ) : <span className="text-ink-muted">—</span>}
                    </Td>
                    <Td className="text-ink-soft hidden sm:table-cell">
                      {r.current_conference ? confDisplay(r.current_conference) : <span className="text-ink-muted">—</span>}
                    </Td>
                    <Td className="text-right tabular text-ink-soft hidden sm:table-cell">{r.seasons_count}</Td>
                    <Td className="text-right tabular text-ink hidden sm:table-cell">{fmtRecord(r.career_wins, r.career_losses)}</Td>
                    <Td className="text-right tabular font-medium text-ink">{fmtPct(r.career_win_pct)}</Td>
                    <Td className="text-right tabular font-medium text-ink">
                      {r.composite_score != null ? r.composite_score.toFixed(1) : <span className="text-ink-muted/50">—</span>}
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {sorted.length > 0 && (
          <Pagination
            firstShown={firstShown}
            lastShown={lastShown}
            total={sorted.length}
            page={safePage}
            totalPages={totalPages}
            onPage={setPage}
          />
        )}
      </div>
    </div>
  );
}

function Pagination({
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
      {totalPages > 1 && (
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
              <span key={`gap-${i}`} className="px-2 text-ink-muted">…</span>
            ) : (
              <button
                key={it}
                type="button"
                onClick={() => onPage(it)}
                aria-current={it === page ? "page" : undefined}
                className={cn(
                  "min-w-8 px-2 py-1 rounded tabular transition-colors",
                  it === page ? "bg-coral text-white font-medium" : "hover:bg-paper-deep/60",
                )}
              >{it}</button>
            ),
          )}
          <button
            type="button"
            onClick={() => onPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className="px-2 py-1 rounded hover:bg-paper-deep/60 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
            aria-label="Next page"
          >Next ›</button>
        </div>
      )}
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

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-2 sm:px-3 py-2 text-xs uppercase tracking-widest text-ink-muted font-medium ${className}`}>{children}</th>;
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-2 sm:px-3 py-2.5 ${className}`}>{children}</td>;
}
function ThSort({
  label, active, dir, onClick, align = "right", className = "",
}: {
  label: string; active: boolean; dir: "asc" | "desc"; onClick: () => void; align?: "left" | "right"; className?: string;
}) {
  return (
    <th className={cn(
      "px-2 sm:px-3 py-2 text-xs uppercase tracking-widest font-medium whitespace-nowrap select-none cursor-pointer hover:bg-paper-deep/60 transition-colors",
      align === "right" && "text-right",
      active ? "text-ink" : "text-ink-muted",
      className,
    )}>
      <button type="button" onClick={onClick} className={cn("inline-flex items-center gap-1", align === "right" && "justify-end w-full")}>
        <span>{label}</span>
        {active && <span className="text-coral text-[0.65rem] leading-none">{dir === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}
