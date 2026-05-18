"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Star } from "lucide-react";
import { TeamLogo } from "@/components/team-logo";
import { PlayerPhoto } from "@/components/player-photo";
import { Select } from "@/components/select";
import { cn } from "@/lib/utils";
import {
  TransferClassesPanel,
  TransferClassModal,
  type TransferClassRow,
} from "@/components/portal/transfer-classes";

export type PortalEntry = {
  cbba_player_id: number;
  bart_player_id: number | null;
  name: string;
  eligibility: string;
  status: string;
  division: number | null;
  division_from: number | null;
  division_to: number | null;
  date_entered: string | null;
  date_updated: string | null;
  team_from: string | null;
  conf_from: string | null;
  team_to: string | null;
  conf_to: string | null;
  last_year: number | null;
  last_team: string | null;
  last_conf: string | null;
  gp: number | null;
  mpg: number | null;
  ppg: number | null;
  rpg: number | null;
  apg: number | null;
  spg: number | null;
  bpg: number | null;
  pir: number | null;
  bta_portg: number | null;
  stars: 0 | 1 | 2 | 3 | 4 | 5;
};

type SortKey =
  | "name" | "stars" | "date" | "committed" | "from" | "to"
  | "mpg" | "ppg" | "rpg" | "apg" | "bta_portg";

const STATUS_OPTIONS = ["All", "Active", "Transferred", "Withdrew"];

export function PortalClient({
  entries, generatedAt, transferClasses,
}: {
  entries: PortalEntry[];
  generatedAt: string;
  transferClasses?: { top_overall: TransferClassRow[]; worst_power: TransferClassRow[] };
}) {
  const [status, setStatus] = useState("All");
  const [confTo, setConfTo] = useState("All");
  const [limit, setLimit] = useState<number>(100);
  const [query, setQuery] = useState("");
  const [schoolQuery, setSchoolQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("bta_portg");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [openClass, setOpenClass] = useState<TransferClassRow | null>(null);

  const confsTo = useMemo(() => {
    const s = new Set<string>();
    for (const e of entries) if (e.conf_to) s.add(e.conf_to);
    return ["All", "Uncommitted", ...Array.from(s).sort()];
  }, [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sq = schoolQuery.trim().toLowerCase();
    return entries.filter((e) => {
      // Display baseline: hide bench-level production. Players need to have
      // GP ≥ 10, MPG ≥ 12, AND PPG ≥ 4 to be worth showing in the portal table.
      if ((e.gp ?? 0) < 10) return false;
      if ((e.mpg ?? 0) < 12) return false;
      if ((e.ppg ?? 0) < 4) return false;
      // D-I only — kept as a hard-coded baseline since we dropped the dropdown.
      const fromD1 = e.division_from === 1;
      const toD1 = e.division_to === 1;
      if (!fromD1 && !toD1) return false;
      if (status !== "All") {
        if (e.status?.toLowerCase() !== status.toLowerCase()) return false;
      }
      if (confTo !== "All") {
        if (confTo === "Uncommitted" && e.team_to !== null) return false;
        if (confTo !== "Uncommitted" && e.conf_to !== confTo) return false;
      }
      if (q && !e.name.toLowerCase().includes(q)) return false;
      if (sq) {
        const from = e.team_from?.toLowerCase() ?? "";
        const to = e.team_to?.toLowerCase() ?? "";
        if (!from.includes(sq) && !to.includes(sq)) return false;
      }
      return true;
    });
  }, [entries, status, confTo, query, schoolQuery]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const get = (e: PortalEntry): number | string | null => {
      switch (sortBy) {
        case "name":         return e.name;
        case "stars":        return e.stars;
        case "date":         return e.date_entered ?? "";
        case "committed":    return e.team_to ? (e.date_updated ?? "") : "";
        case "from":         return e.team_from ?? "";
        case "to":           return e.team_to ?? "zzz_uncommitted";
        case "mpg":          return e.mpg;
        case "ppg":          return e.ppg;
        case "rpg":          return e.rpg;
        case "apg":          return e.apg;
        case "bta_portg":    return e.bta_portg;
      }
    };
    return [...filtered].sort((a, b) => {
      const av = get(a), bv = get(b);
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [filtered, sortBy, sortDir]);

  // Aggregates for hero strip
  const counts = useMemo(() => {
    const visible = filtered;
    const active = visible.filter((e) => e.status === "Active").length;
    const committed = visible.filter((e) => e.status === "Transferred").length;
    const withdrawn = visible.filter((e) => e.status === "Withdrew").length;
    return { total: visible.length, active, committed, withdrawn };
  }, [filtered]);

  const generated = new Date(generatedAt);

  function toggleSort(k: SortKey, defaultDir: "asc" | "desc") {
    if (sortBy === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(k); setSortDir(defaultDir); }
  }
  function reset() {
    setStatus("All"); setConfTo("All"); setQuery(""); setSchoolQuery(""); setLimit(100);
  }

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <div className="bg-card border border-hairline rounded-lg p-4 lg:p-5">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Status">
            <Select value={status} onChange={setStatus}>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="Show">
            <Select value={String(limit)} onChange={(v) => setLimit(v === "all" ? Number.MAX_SAFE_INTEGER : Number(v))}>
              <option value="100">100</option>
              <option value="250">250</option>
              <option value="500">500</option>
              <option value="all">All</option>
            </Select>
          </Field>
          <Field label="Destination">
            <Select value={confTo} onChange={setConfTo} className="min-w-40">
              {confsTo.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <div className="relative flex-1 min-w-[12rem] max-w-xs">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for a player"
              aria-label="Search players by name"
              className="h-9 w-full pl-3 pr-8 rounded border border-hairline bg-white text-ink text-sm placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-coral/40"
            />
            {query && (
              <button onClick={() => setQuery("")} aria-label="Clear player search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-muted hover:text-coral text-sm">×</button>
            )}
          </div>
          <div className="relative flex-1 min-w-[12rem] max-w-xs">
            <input
              type="search"
              value={schoolQuery}
              onChange={(e) => setSchoolQuery(e.target.value)}
              placeholder="Search for a school"
              aria-label="Search by school (from or to)"
              className="h-9 w-full pl-3 pr-8 rounded border border-hairline bg-white text-ink text-sm placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-coral/40"
            />
            {schoolQuery && (
              <button onClick={() => setSchoolQuery("")} aria-label="Clear school search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-muted hover:text-coral text-sm">×</button>
            )}
          </div>
          <button type="button" onClick={reset}
            className="ml-auto text-sm text-ink-muted hover:text-ink px-3 py-2">
            Reset
          </button>
        </div>
        <p className="text-xs text-ink-muted mt-3">
          {counts.total.toLocaleString()} entries match · {counts.active.toLocaleString()} active ·
          {" "}{counts.committed.toLocaleString()} transferred · {counts.withdrawn.toLocaleString()} withdrew ·
          {" "}feed last refreshed {generated.toLocaleString()}
        </p>
      </div>

      {/* Three-column layout: Top transfer classes (sticky) · transfers table · Worst (sticky) */}
      <div className="grid grid-cols-1 xl:grid-cols-[16rem_minmax(0,1fr)_16rem] gap-4 items-start">
        {transferClasses ? (
          <aside className="xl:sticky xl:top-20 xl:self-start xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto">
            <TransferClassesPanel
              title="Top transfer classes"
              subtitle="Net BTA PRTG · all D-I"
              rows={transferClasses.top_overall}
              onOpen={setOpenClass}
            />
          </aside>
        ) : <div />}

        {/* Entries table */}
        <div className="bg-card border border-hairline rounded-lg overflow-hidden min-w-0">
          <div className="flex items-baseline justify-between px-4 lg:px-5 py-3 border-b border-hairline">
            <div className="flex items-baseline gap-3">
              <span className="font-display text-xl text-ink tabular">{sorted.length.toLocaleString()}</span>
              <span className="text-sm text-ink-muted">{sorted.length === 1 ? "transfer" : "transfers"}</span>
            </div>
          </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline text-left">
                <Th className="w-10 text-center">#</Th>
                <Th className="w-12">{""}</Th>
                <ThSort label="Player" active={sortBy==="name"} dir={sortDir} onClick={() => toggleSort("name","asc")} align="left" className="pr-1" />
                <ThSort label="Tier"  active={sortBy==="stars"} dir={sortDir} onClick={() => toggleSort("stars","desc")} align="left" className="pl-1" />
                <ThSort label="From"   active={sortBy==="from"} dir={sortDir} onClick={() => toggleSort("from","asc")} align="left" />
                <ThSort label="To"     active={sortBy==="to"}   dir={sortDir} onClick={() => toggleSort("to","asc")}   align="left" />
                <ThSort label="ENT" active={sortBy==="date"} dir={sortDir} onClick={() => toggleSort("date","desc")} align="left" />
                <ThSort label="COM" active={sortBy==="committed"} dir={sortDir} onClick={() => toggleSort("committed","desc")} align="left" />
                <ThSort label="BTA PRTG" active={sortBy==="bta_portg"} dir={sortDir} onClick={() => toggleSort("bta_portg","desc")} />
                <ThSort label="MPG" active={sortBy==="mpg"} dir={sortDir} onClick={() => toggleSort("mpg","desc")} />
                <ThSort label="PPG" active={sortBy==="ppg"} dir={sortDir} onClick={() => toggleSort("ppg","desc")} />
                <ThSort label="RPG" active={sortBy==="rpg"} dir={sortDir} onClick={() => toggleSort("rpg","desc")} />
                <ThSort label="APG" active={sortBy==="apg"} dir={sortDir} onClick={() => toggleSort("apg","desc")} />
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr><td colSpan={13} className="px-4 py-12 text-center text-ink-muted">No transfers match these filters.</td></tr>
              ) : (
                sorted.slice(0, limit).map((e, i) => (
                  <tr key={e.cbba_player_id + "-" + (e.date_entered ?? "")} className="border-b border-hairline/60 hover:bg-paper-deep/50 transition-colors">
                    <Td className="text-center text-ink-muted tabular">{i + 1}</Td>
                    <Td className="text-center">
                      <PlayerPhoto bartPlayerId={e.bart_player_id} name={e.name} size={38} />
                    </Td>
                    <Td className="pr-1">
                      {e.bart_player_id ? (
                        <Link href={`/players/${e.bart_player_id}`} className="font-medium text-ink hover:text-coral transition-colors">{e.name}</Link>
                      ) : (
                        <span className="font-medium text-ink">{e.name}</span>
                      )}
                    </Td>
                    <Td className="pl-1"><StarRow stars={e.stars} /></Td>
                    <Td>
                      {e.team_from ? (
                        <span className="inline-flex items-center" title={e.team_from}>
                          <TeamLogo name={e.team_from} size={28} />
                        </span>
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </Td>
                    <Td>
                      {e.team_to ? (
                        <span className="inline-flex items-center" title={e.team_to}>
                          <TeamLogo name={e.team_to} size={28} />
                        </span>
                      ) : (
                        <span className={cn("text-xs uppercase tracking-wide", e.status === "Withdrew" ? "text-ink-muted" : "text-coral font-medium")}>
                          {e.status === "Withdrew" ? "Withdrew" : "Uncommitted"}
                        </span>
                      )}
                    </Td>
                    <Td className="text-ink-muted tabular text-xs whitespace-nowrap">{fmtDate(e.date_entered)}</Td>
                    <Td className="text-ink-muted tabular text-xs whitespace-nowrap">{e.team_to ? fmtDate(e.date_updated) : "—"}</Td>
                    <Td className="text-right tabular font-medium">{fmt1(e.bta_portg)}</Td>
                    <Td className="text-right tabular">{fmt1(e.mpg)}</Td>
                    <Td className="text-right tabular">{fmt1(e.ppg)}</Td>
                    <Td className="text-right tabular">{fmt1(e.rpg)}</Td>
                    <Td className="text-right tabular">{fmt1(e.apg)}</Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {sorted.length > limit && (
            <p className="px-4 py-3 text-xs text-ink-muted border-t border-hairline">
              Showing first {limit.toLocaleString()} of {sorted.length.toLocaleString()}. Pick a larger &ldquo;Show&rdquo; value or narrow the filters to see more.
            </p>
          )}
          </div>
        </div>

        {transferClasses ? (
          <aside className="xl:sticky xl:top-20 xl:self-start xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto">
            <TransferClassesPanel
              title="Worst transfer classes"
              subtitle="ACC · B10 · B12 · SEC only"
              rows={transferClasses.worst_power}
              onOpen={setOpenClass}
            />
          </aside>
        ) : <div />}
      </div>

      {openClass && (
        <TransferClassModal row={openClass} onClose={() => setOpenClass(null)} />
      )}
    </div>
  );
}

function nz(v: number | null): string { return v === null || v === undefined ? "—" : String(v); }
function fmt1(v: number | null): string {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
function fmtDate(s: string | null): string {
  if (!s) return "—";
  // Accept "2026-03-25 01:27:44+00:00" or "2026-03-25T..."
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[2]}/${m[3]}` : s.slice(0, 10);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-widest text-ink-muted font-medium">{label}</span>
      {children}
    </label>
  );
}
function StarRow({ stars }: { stars: 0 | 1 | 2 | 3 | 4 | 5 }) {
  if (stars === 0) return <span className="text-ink-muted text-xs">—</span>;
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${stars} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={12}
          strokeWidth={2}
          className={n <= stars ? "text-coral fill-coral" : "text-ink-muted/40"}
          fill={n <= stars ? "currentColor" : "none"}
        />
      ))}
    </span>
  );
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
    <th className={`px-3 py-2 text-xs uppercase tracking-widest font-medium select-none cursor-pointer hover:bg-paper-deep/60 transition-colors ${align === "right" ? "text-right" : ""} ${active ? "text-ink" : "text-ink-muted"} ${className}`}>
      <button type="button" onClick={onClick} className={`inline-flex items-center gap-1 ${align === "right" ? "justify-end w-full" : ""}`}>
        <span>{label}</span>
        {active && <span className="text-coral text-[0.65rem] leading-none">{dir === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}
