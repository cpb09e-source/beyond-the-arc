"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Star, ChevronDown, SlidersHorizontal } from "lucide-react";
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
  // Baked into portal.json by scripts/rescore-portal.mjs — real play-by-play
  // fit first, box estimate as fallback for EPM.
  epm: number | null;
  /**
   * Whether each end of the move is a D-I team, resolved against our own
   * archive rather than taken from the feed. On3's division fields are wrong
   * whenever it sends a school in registrar form ("Gonzaga University"), which
   * reported Massamba Diop's Arizona State -> Gonzaga move as D-II on both ends
   * and hid him — and 50 others — from this table entirely.
   */
  d1_from?: boolean;
  d1_to?: boolean;
  /**
   * Wins added over an average player across the possessions he actually
   * played. Null for the handful with only a box estimate: eWins comes solely
   * from the play-by-play fit, and inventing one would put a fabricated zero
   * next to a real number.
   */
  ewins: number | null;
  /** eWins plus the measured freshman development bump. */
  ewins_proj?: number | null;
  /** PIR after the conference-tier multiplier, and that term converted to wins. */
  pir_adj?: number | null;
  pir_wins?: number;
  /**
   * THE TRANSFER RATING shown in the table: eWins + freshman development bump
   * + tiered-PIR term. Same units the transfer classes are summed in, so a
   * school's class score is literally these numbers added up (incoming, minus
   * half the outgoing) — the column and the sidebar cannot drift apart.
   */
  value?: number | null;
  /** EPM added by the sophomore leap; 0 for everyone who is not a freshman. */
  dev_bump?: number;
  stars: 0 | 1 | 2 | 3 | 4 | 5;
};

type SortKey =
  | "name" | "stars" | "date" | "committed" | "from" | "to"
  | "mpg" | "ppg" | "rpg" | "apg" | "rating";

export function PortalClient({
  entries, transferClasses,
}: {
  entries: PortalEntry[];
  generatedAt?: string;
  transferClasses?: {
    top_overall: TransferClassRow[];
    worst_power: TransferClassRow[];
    by_school?: Record<string, TransferClassRow>;
  };
}) {
  const [confTo, setConfTo] = useState("All");
  const [filterOpen, setFilterOpen] = useState(false);
  const [pageSize, setPageSize] = useState<number>(50);
  const [page, setPage] = useState<number>(1);
  const [query, setQuery] = useState("");
  const [schoolQuery, setSchoolQuery] = useState("");
  // Commit date by default, newest first: the portal is a feed before it is a
  // leaderboard, and the first question on opening it is who just landed
  // somewhere. eWins is one click away in the header.
  const [sortBy, setSortBy] = useState<SortKey>("committed");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [openClass, setOpenClass] = useState<TransferClassRow | null>(null);

  const confsTo = useMemo(() => {
    const s = new Set<string>();
    for (const e of entries) if (e.conf_to) s.add(e.conf_to);
    return ["All", ...Array.from(s).sort()];
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
      // Prefers the flags rescore-portal.mjs derives from our own team archive;
      // falls back to the feed's division fields when they are absent.
      const fromD1 = e.d1_from ?? (e.division_from === 1);
      const toD1 = e.d1_to ?? (e.division_to === 1);
      if (!fromD1 && !toD1) return false;
      if (confTo !== "All" && e.conf_to !== confTo) return false;
      if (q && !e.name.toLowerCase().includes(q)) return false;
      if (sq) {
        const from = e.team_from?.toLowerCase() ?? "";
        const to = e.team_to?.toLowerCase() ?? "";
        if (!from.includes(sq) && !to.includes(sq)) return false;
      }
      return true;
    });
  }, [entries, confTo, query, schoolQuery]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const get = (e: PortalEntry): number | string | null => {
      switch (sortBy) {
        case "name":         return e.name;
        case "stars":        return e.stars;
        case "date":         return e.date_entered ?? "";
        // Uncommitted players have no commit date — return null so the
        // comparator's nulls-last rule parks them at the bottom in BOTH
        // directions (instead of a wall of "—" floating to the top in asc).
        case "committed":    return e.team_to ? (e.date_updated ?? null) : null;
        case "from":         return e.team_from ?? "";
        case "to":           return e.team_to ?? "zzz_uncommitted";
        case "mpg":          return e.mpg;
        case "ppg":          return e.ppg;
        case "rpg":          return e.rpg;
        case "apg":          return e.apg;
        case "rating":       return e.value ?? null;
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

  function toggleSort(k: SortKey, defaultDir: "asc" | "desc") {
    if (sortBy === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(k); setSortDir(defaultDir); }
  }
  function reset() {
    setConfTo("All"); setQuery(""); setSchoolQuery(""); setPageSize(50); setPage(1);
  }

  // Derive paging from current state. Clamp page so a stale value (after a
  // filter shrinks the result) doesn't render an empty body.
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);
  const firstShown = sorted.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const lastShown = Math.min(safePage * pageSize, sorted.length);

  return (
    <div className="space-y-6">
      {/* Filter bar — collapsed by default on mobile, always open on lg+. */}
      <div className="bg-paper-deep/25 border-y border-x-0 lg:border-x border-hairline rounded-none lg:rounded-xl shadow-sm p-4 lg:p-5 -mx-6 lg:mx-0">
        <button
          type="button"
          onClick={() => setFilterOpen((o) => !o)}
          aria-expanded={filterOpen}
          className="w-full flex items-center justify-between gap-2 min-h-11 lg:hidden"
        >
          <span className="inline-flex items-center gap-2 text-sm font-medium text-ink">
            <SlidersHorizontal className="w-4 h-4 text-ink-muted" /> Filters
          </span>
          <ChevronDown className={cn("w-4 h-4 text-ink-muted transition-transform", filterOpen && "rotate-180")} aria-hidden />
        </button>
        <div className={cn(filterOpen ? "block" : "hidden", "lg:block mt-3 lg:mt-0")}>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Destination">
            <Select value={confTo} onChange={(v) => { setConfTo(v); setPage(1); }} className="min-w-40">
              {confsTo.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <div className="relative flex-1 min-w-[12rem] max-w-xs">
            <input
              type="search"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(1); }}
              placeholder="Search for a player"
              aria-label="Search players by name"
              className="h-9 w-full pl-3 pr-8 rounded border border-hairline bg-card text-ink text-sm placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-coral/40"
            />
            {query && (
              <button onClick={() => { setQuery(""); setPage(1); }} aria-label="Clear player search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-muted hover:text-coral text-sm">×</button>
            )}
          </div>
          <div className="relative flex-1 min-w-[12rem] max-w-xs">
            <input
              type="search"
              value={schoolQuery}
              onChange={(e) => { setSchoolQuery(e.target.value); setPage(1); }}
              placeholder="Search for a school"
              aria-label="Search by school (from or to)"
              className="h-9 w-full pl-3 pr-8 rounded border border-hairline bg-card text-ink text-sm placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-coral/40"
            />
            {schoolQuery && (
              <button onClick={() => { setSchoolQuery(""); setPage(1); }} aria-label="Clear school search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-muted hover:text-coral text-sm">×</button>
            )}
          </div>
          <button type="button" onClick={reset}
            className="ml-auto text-sm text-ink-muted hover:text-ink px-3 py-2">
            Reset
          </button>
        </div>
        </div>
      </div>

      {/* Three-column layout: Top transfer classes (sticky) · transfers table · Worst (sticky) */}
      <div className="grid grid-cols-1 xl:grid-cols-[16rem_minmax(0,1fr)_16rem] gap-4 items-start">
        {transferClasses ? (
          <aside className="order-1 xl:order-0 xl:sticky xl:top-20 xl:self-start xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto xl:[scrollbar-width:none] xl:[&::-webkit-scrollbar]:hidden">
            <TransferClassesPanel
              title="Top transfer classes"
              subtitle="eWins + tiered PIR, half-weight out · all D-I"
              rows={transferClasses.top_overall}
              onOpen={setOpenClass}
            />
          </aside>
        ) : <div />}

        {/* Entries table — last on mobile (after both class panels), center column on xl. */}
        <div className="order-3 xl:order-0 bg-paper-deep/25 border-y border-x-0 lg:border-x border-hairline rounded-none lg:rounded-xl shadow-sm overflow-hidden min-w-0 -mx-6 lg:mx-0">
          <div className="flex items-end justify-between gap-4 px-4 lg:px-5 py-3 border-b border-hairline bg-paper-deep/70">
            <div className="flex items-baseline gap-3">
              <span className="font-display text-xl text-ink tabular">{sorted.length.toLocaleString()}</span>
              <span className="text-sm text-ink-muted">{sorted.length === 1 ? "transfer" : "transfers"}</span>
            </div>
            <label className="flex items-center gap-2 text-xs uppercase tracking-widest text-ink-muted font-medium">
              <span>Show</span>
              <Select
                value={String(pageSize)}
                onChange={(v) => { setPageSize(Number(v)); setPage(1); }}
              >
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="250">250</option>
              </Select>
            </label>
          </div>
        <div className="overflow-x-auto overscroll-x-contain">
          <table className="w-full text-sm">
            <thead className="bg-paper-deep/70">
              <tr className="border-b border-hairline text-left">
                <Th className="w-10 text-center">#</Th>
                <Th className="w-12">{""}</Th>
                <ThSort label="Player" active={sortBy==="name"} dir={sortDir} onClick={() => toggleSort("name","asc")} align="left" className="pr-1" />
                <ThSort label="Tier"  active={sortBy==="stars"} dir={sortDir} onClick={() => toggleSort("stars","desc")} align="left" className="pl-1" />
                <ThSort label="From"   active={sortBy==="from"} dir={sortDir} onClick={() => toggleSort("from","asc")} align="left" />
                <ThSort label="To"     active={sortBy==="to"}   dir={sortDir} onClick={() => toggleSort("to","asc")}   align="left" />
                <ThSort label="ENT" active={sortBy==="date"} dir={sortDir} onClick={() => toggleSort("date","desc")} align="left" />
                <ThSort label="COM" active={sortBy==="committed"} dir={sortDir} onClick={() => toggleSort("committed","desc")} align="left" />
                <ThSort label="Rating" active={sortBy==="rating"} dir={sortDir} onClick={() => toggleSort("rating","desc")} />
                <ThSort label="MPG" active={sortBy==="mpg"} dir={sortDir} onClick={() => toggleSort("mpg","desc")} />
                <ThSort label="PPG" active={sortBy==="ppg"} dir={sortDir} onClick={() => toggleSort("ppg","desc")} />
                <ThSort label="RPG" active={sortBy==="rpg"} dir={sortDir} onClick={() => toggleSort("rpg","desc")} />
                <ThSort label="APG" active={sortBy==="apg"} dir={sortDir} onClick={() => toggleSort("apg","desc")} />
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr><td colSpan={13} className="px-4 py-12 text-center text-ink-muted">No transfers match these filters.</td></tr>
              ) : (
                pageRows.map((e, i) => (
                  <tr key={e.cbba_player_id + "-" + (e.date_entered ?? "")} className={cn("transition-colors hover:bg-[var(--accent-tint,rgba(237,90,79,0.08))]", i % 2 === 0 ? "bg-paper/70" : "bg-transparent")}>
                    <Td className="text-center text-ink-muted tabular">{(safePage - 1) * pageSize + i + 1}</Td>
                    <Td className="text-center">
                      <PlayerPhoto bartPlayerId={e.bart_player_id} name={e.name} size={38} />
                    </Td>
                    <Td className="pr-1">
                      {e.bart_player_id ? (
                        <Link href={`/players/${e.bart_player_id}`} className="font-medium text-ink hover:text-coral transition-colors" prefetch={false}>{e.name}</Link>
                      ) : (
                        <span className="font-medium text-ink">{e.name}</span>
                      )}
                    </Td>
                    <Td className="pl-1"><StarRow stars={e.stars} /></Td>
                    <Td>
                      <SchoolLogoCell school={e.team_from} bySchool={transferClasses?.by_school} onOpen={setOpenClass} />
                    </Td>
                    <Td>
                      {e.team_to ? (
                        <SchoolLogoCell school={e.team_to} bySchool={transferClasses?.by_school} onOpen={setOpenClass} />
                      ) : (
                        <span className={cn("text-xs uppercase tracking-wide", e.status === "Withdrew" ? "text-ink-muted" : "text-coral font-medium")}>
                          {e.status === "Withdrew" ? "Withdrew" : "N/A"}
                        </span>
                      )}
                    </Td>
                    <Td className="text-ink-muted tabular text-xs whitespace-nowrap">{fmtDate(e.date_entered)}</Td>
                    <Td className="text-ink-muted tabular text-xs whitespace-nowrap">{e.team_to ? fmtDate(e.date_updated) : "—"}</Td>
                    <Td
                      className="text-right tabular font-medium"
                      title={e.value == null ? undefined
                        : `${e.ewins_proj?.toFixed(2) ?? "—"} eWins${(e.dev_bump ?? 0) > 0 ? " (incl. sophomore leap)" : ""}` +
                          `  ·  ${(e.pir_wins ?? 0) >= 0 ? "+" : ""}${(e.pir_wins ?? 0).toFixed(2)} from conference-tiered PIR` +
                          `${e.pir_adj != null ? ` (PIR ${e.pir_adj.toFixed(1)} after tier)` : ""}` +
                          `${e.epm != null ? `  ·  EPM ${e.epm > 0 ? "+" : ""}${e.epm.toFixed(1)}` : ""}`}
                    >
                      {e.value == null ? "—" : `${e.value > 0 ? "+" : ""}${e.value.toFixed(2)}`}
                    </Td>
                    <Td className="text-right tabular">{fmt1(e.mpg)}</Td>
                    <Td className="text-right tabular">{fmt1(e.ppg)}</Td>
                    <Td className="text-right tabular">{fmt1(e.rpg)}</Td>
                    <Td className="text-right tabular">{fmt1(e.apg)}</Td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
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

        {transferClasses ? (
          <aside className="order-2 xl:order-0 xl:sticky xl:top-20 xl:self-start xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto xl:[scrollbar-width:none] xl:[&::-webkit-scrollbar]:hidden">
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

// Renders a school logo in the From/To columns. Clicking opens the same
// transfer-class modal used by the top/worst sidebars (when the school has
// aggregated portal data). Falls back to a plain logo otherwise.
function SchoolLogoCell({
  school, bySchool, onOpen,
}: {
  school: string | null;
  bySchool: Record<string, TransferClassRow> | undefined;
  onOpen: (r: TransferClassRow) => void;
}) {
  if (!school) return <span className="text-ink-muted">—</span>;
  const row = bySchool?.[school];
  if (!row) {
    return (
      <span className="inline-flex items-center" title={school}>
        <TeamLogo name={school} size={28} />
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(row)}
      title={`${school} — transfer class`}
      className="inline-flex items-center rounded hover:bg-paper-deep/60 transition-colors p-0.5 -m-0.5 cursor-pointer"
    >
      <TeamLogo name={school} size={28} />
    </button>
  );
}

// Footer pagination strip: page summary + ‹ Prev | numbered buttons (with
// ellipsis for long runs) | Next ›. Numbered buttons show first, last, current,
// and 2 on either side of current; gaps render as a "…" placeholder.
function Pagination({
  firstShown, lastShown, total, page, totalPages, onPage,
}: {
  firstShown: number;
  lastShown: number;
  total: number;
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
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
          >
            ‹ Prev
          </button>
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
                  it === page
                    ? "bg-coral text-white font-medium"
                    : "hover:bg-paper-deep/60",
                )}
              >
                {it}
              </button>
            ),
          )}
          <button
            type="button"
            onClick={() => onPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className="px-2 py-1 rounded hover:bg-paper-deep/60 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
            aria-label="Next page"
          >
            Next ›
          </button>
        </div>
      )}
    </div>
  );
}

// Returns the page buttons to render. Always includes 1 and totalPages; shows
// current ± 2; inserts "…" placeholders where there's a gap.
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
function Td({ children, className = "", title }: { children: React.ReactNode; className?: string; title?: string }) {
  return <td className={`px-3 py-2.5 ${className}`} title={title}>{children}</td>;
}
function ThSort({
  label, active, dir, onClick, align = "right", className = "",
}: {
  label: string; active: boolean; dir: "asc" | "desc"; onClick: () => void; align?: "left" | "right"; className?: string;
}) {
  return (
    <th className={`p-0 text-xs uppercase tracking-widest font-medium whitespace-nowrap select-none cursor-pointer hover:bg-paper-deep/60 transition-colors ${align === "right" ? "text-right" : ""} ${active ? "text-ink" : "text-ink-muted"} ${className}`}>
      <button type="button" onClick={onClick} className={`inline-flex items-center gap-1 w-full px-3 py-3 sm:py-2 ${align === "right" ? "justify-end" : ""}`}>
        <span>{label}</span>
        {active && <span className="text-coral text-[0.65rem] leading-none">{dir === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}
