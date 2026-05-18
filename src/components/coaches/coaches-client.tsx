"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { TeamLogo } from "@/components/team-logo";
import { Select } from "@/components/select";
import { cn } from "@/lib/utils";
import { confDisplay } from "@/lib/conf-display";
import type { CoachRow } from "@/app/coaches/page";

type SortKey = "name" | "team" | "conference" | "active" | "career_wins" | "career_winpct" | "seasons" | "schools";
type StatusFilter = "All" | "Active" | "Inactive";

const STATUS_OPTIONS: StatusFilter[] = ["All", "Active", "Inactive"];

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
  const [query, setQuery] = useState("");
  const [confFilter, setConfFilter] = useState<string>("All");
  const [status, setStatus] = useState<StatusFilter>("All");
  const [pageSize, setPageSize] = useState<number>(100);
  const [page, setPage] = useState<number>(1);
  const [sortBy, setSortBy] = useState<SortKey>("active");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const confs = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) if (r.current_conference) s.add(r.current_conference);
    return ["All", ...Array.from(s).sort()];
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (status === "Active" && !r.is_active) return false;
      if (status === "Inactive" && r.is_active) return false;
      if (confFilter !== "All" && r.current_conference !== confFilter) return false;
      if (q && !r.name.toLowerCase().includes(q) && !(r.current_team ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, query, confFilter, status]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    function key(r: CoachRow): string | number | boolean | null {
      switch (sortBy) {
        case "name":           return (r.name.split(" ").pop() ?? r.name).toLowerCase();
        case "team":           return (r.current_team ?? "zzz").toLowerCase();
        case "conference":     return r.current_conference ?? "zzz";
        case "active":         return r.is_active ? 1 : 0;
        case "career_wins":    return r.career_wins;
        case "career_winpct":  return r.career_win_pct;
        case "seasons":        return r.seasons_count;
        case "schools":        return r.schools_count;
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
  function reset() { setQuery(""); setConfFilter("All"); setStatus("All"); setPage(1); setPageSize(100); }

  const activeCount = rows.filter((r) => r.is_active).length;

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <div className="bg-card border border-hairline rounded-lg p-4 lg:p-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-widest text-ink-muted font-medium">Status</span>
            <Select value={status} onChange={(v) => { setStatus(v as StatusFilter); setPage(1); }}>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}{s === "Active" && ` (${activeCount})`}</option>)}
            </Select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-widest text-ink-muted font-medium">Conference</span>
            <Select value={confFilter} onChange={(v) => { setConfFilter(v); setPage(1); }}>
              {confs.map((c) => <option key={c} value={c}>{c === "All" ? c : confDisplay(c)}</option>)}
            </Select>
          </label>
          <div className="relative flex-1 min-w-[14rem] max-w-md">
            <input
              type="search"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(1); }}
              placeholder="Search coach or team"
              aria-label="Search coach or team"
              className="h-9 w-full pl-3 pr-8 rounded border border-hairline bg-white text-ink text-sm placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-coral/40"
            />
            {query && (
              <button onClick={() => { setQuery(""); setPage(1); }} aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-muted hover:text-coral text-sm">×</button>
            )}
          </div>
          <button type="button" onClick={reset}
            className="ml-auto text-sm text-ink-muted hover:text-ink px-3 py-2">
            Reset
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-card border border-hairline rounded-lg overflow-hidden">
        <div className="flex items-end justify-between gap-4 px-4 lg:px-5 py-3 border-b border-hairline">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-xl text-ink tabular">
              {sorted.length.toLocaleString()}
              {sorted.length !== rows.length && <span className="text-ink-muted"> of {rows.length.toLocaleString()}</span>}
            </span>
            <span className="text-sm text-ink-muted">
              {sorted.length === 1 ? "coach" : "coaches"}
              {status !== "All" && <> · {status.toLowerCase()}</>}
              {confFilter !== "All" && <> · {confFilter}</>}
            </span>
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
            <thead>
              <tr className="border-b border-hairline text-left">
                <Th className="w-10 text-center">#</Th>
                <ThSort label="Coach" active={sortBy==="name"} dir={sortDir} onClick={() => toggle("name","asc")} align="left" />
                <Th className="w-12">{""}</Th>
                <ThSort label="Current team" active={sortBy==="team"} dir={sortDir} onClick={() => toggle("team","asc")} align="left" />
                <ThSort label="Conf" active={sortBy==="conference"} dir={sortDir} onClick={() => toggle("conference","asc")} align="left" />
                <ThSort label="Status" active={sortBy==="active"} dir={sortDir} onClick={() => toggle("active","desc")} align="left" />
                <ThSort label="Seasons" active={sortBy==="seasons"} dir={sortDir} onClick={() => toggle("seasons","desc")} />
                <ThSort label="All-time" active={sortBy==="career_wins"} dir={sortDir} onClick={() => toggle("career_wins","desc")} />
                <ThSort label="Win %" active={sortBy==="career_winpct"} dir={sortDir} onClick={() => toggle("career_winpct","desc")} />
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-ink-muted">No coaches match these filters.</td></tr>
              ) : (
                pageRows.map((r, i) => (
                  <tr key={`${r.slug}-${i}`} className="border-b border-hairline/60 hover:bg-paper-deep/50 transition-colors">
                    <Td className="text-center text-ink-muted tabular">{(safePage - 1) * pageSize + i + 1}</Td>
                    <Td>
                      <Link href={`/coaches/${coachSlug(r.name)}/`} className="text-ink hover:text-coral transition-colors">
                        {r.name}
                      </Link>
                    </Td>
                    <Td className="text-center">
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
                    <Td className="text-ink-soft">{r.current_conference ?? "—"}</Td>
                    <Td>
                      {r.is_active ? (
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <span className="h-1.5 w-1.5 rounded-full bg-coral" />
                          <span className="text-ink">Active</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <span className="h-1.5 w-1.5 rounded-full bg-ink-muted/40" />
                          <span className="text-ink-muted">Inactive</span>
                        </span>
                      )}
                    </Td>
                    <Td className="text-right tabular text-ink-soft">{r.seasons_count}</Td>
                    <Td className="text-right tabular text-ink">{fmtRecord(r.career_wins, r.career_losses)}</Td>
                    <Td className="text-right tabular font-medium text-ink">{fmtPct(r.career_win_pct)}</Td>
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
            className="px-2 py-1 rounded hover:bg-paper-deep/60 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
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
            className="px-2 py-1 rounded hover:bg-paper-deep/60 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
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
  return <th className={`px-3 py-2 text-xs uppercase tracking-widest text-ink-muted font-medium ${className}`}>{children}</th>;
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2.5 ${className}`}>{children}</td>;
}
function ThSort({
  label, active, dir, onClick, align = "right", className = "",
}: {
  label: string; active: boolean; dir: "asc" | "desc"; onClick: () => void; align?: "left" | "right"; className?: string;
}) {
  return (
    <th className={cn(
      "px-3 py-2 text-xs uppercase tracking-widest font-medium whitespace-nowrap select-none cursor-pointer hover:bg-paper-deep/60 transition-colors",
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
