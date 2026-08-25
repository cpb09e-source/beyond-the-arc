"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { TeamLogo } from "@/components/team-logo";
import { TourneyBadge } from "@/components/tourney-badge";
import { SeedChip } from "@/components/coaches/seed-chip";
import { PercentileChip } from "@/components/percentile-chip";
import { confDisplay } from "@/lib/conf-display";
import { cn } from "@/lib/utils";
import {
  RATING_COLS,
  FOUR_FACTOR_COLS,
  SHOOTING_COLS,
  DEFAULT_COLS,
  fmtColValue,
  type TeamCol,
} from "@/lib/team-grid-columns";

/**
 * "By season" — every season we hold for one team, in the same grid the
 * explorer uses on `/`.
 *
 * WHAT IT SHARES AND WHAT IT DOES NOT. The columns from NET rightward come from
 * the shared model in team-grid-columns, so the two surfaces can never drift
 * apart on which stats exist or how a value is formatted. The table itself is
 * NOT shared: the explorer's is welded to URL-driven sorting, pagination, a
 * drag-pan handler and a filter drawer, none of which belong on a team page
 * showing twelve rows. Sorting here is local state, the way the table this
 * replaces did it.
 *
 * The identity columns are the ones the old By season table had, in its order —
 * Season, Conf, Record, Conf Rec, Coach — because those are what a reader on a
 * team page came for. The explorer leads with rank and team name instead; both
 * are meaningless here, where every row is the same team.
 *
 * NO TOURNAMENT COLUMN. It was dropped on request, and nothing was lost with
 * it: the seed chip and the Final Four / Champion badge already ride on the
 * Season cell, so a tournament season is still marked as one — the column was
 * spending its width restating what the badge beside it already said.
 *
 * ONLY SEASON IS PINNED. Five frozen identity columns would leave a phone
 * nothing to scroll the stats into. The explorer pins two of its five for the
 * same reason. Season is the one that has to stay visible: it is the only thing
 * that tells you which row you are reading.
 */

export type SeasonGridRow = {
  year: number;
  teamName: string;
  conference: string | null;
  record: string | null;
  confRecord: string | null;
  /** Drives the seed chip on the Season cell. There is no Tournament column. */
  tourneySeed: number | null;
  coach: string | null;
  /** Stat values, keyed by TeamCol.total. */
  vals: Record<string, number | null>;
  /** Percentiles, keyed by TeamCol.pct. Baked — see build-team-seasons.mts. */
  pct: Record<string, number | null>;
};

/** Identity columns are sorted by their own keys; stats sort by TeamCol.sortKey. */
type SortKey = "year" | "conference" | "record" | "confRecord" | "coach" | string;

function seasonLabel(y: number): string {
  return `${(y - 1).toString().slice(-2)}-${y.toString().slice(-2)}`;
}

/** Wins from a "28-6" record string, for sorting. */
function winsOf(record: string | null): number {
  if (!record) return -1;
  const n = Number.parseInt(record.split("-")[0] ?? "", 10);
  return Number.isFinite(n) ? n : -1;
}

/** One opaque hover fill so the frozen and scrolling halves read as one row. */
const ROW_HOVER = "group-hover:bg-[color-mix(in_oklab,var(--coral)_8%,var(--card))]";
/** Resting tint marking the Four Factors band, mirroring the explorer and /players. */
const FF_BAND_TINT = "bg-[color-mix(in_oklab,var(--coral)_3%,transparent)]";

const FF_START = RATING_COLS.length;
const FF_END = FF_START + FOUR_FACTOR_COLS.length;
// Indices where a new band begins — these get the vertical hairline that
// separates one band from the next.
const GROUP_STARTS = new Set([0, FF_START, FF_END]);

export function SeasonGrid({
  rows,
  currentYear,
  slug,
  accentColor,
}: {
  rows: SeasonGridRow[];
  currentYear: number;
  slug: string;
  /** Optional team color for the current-season row tint. */
  accentColor?: string | null;
}) {
  const [sortBy, setSortBy] = useState<SortKey>("year");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const key = (r: SeasonGridRow): number | string | null => {
      switch (sortBy) {
        case "year":        return r.year;
        case "conference":  return (r.conference ?? "").toLowerCase();
        case "record":      return winsOf(r.record);
        case "confRecord":  return winsOf(r.confRecord);
        // "zzz" rather than null so teams with no coach on file sort to the
        // bottom of an A-Z rather than jumping to the top of a Z-A.
        case "coach":       return r.coach?.toLowerCase() ?? "zzz";
        default:            return r.vals[sortBy] ?? null;
      }
    };
    return [...rows].sort((a, b) => {
      const av = key(a), bv = key(b);
      // Nulls sink in both directions — a season with no value for the sorted
      // stat is not the best or the worst at it, it is absent.
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [rows, sortBy, sortDir]);

  function toggle(k: SortKey, defaultDir: "asc" | "desc") {
    if (sortBy === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(k); setSortDir(defaultDir); }
  }

  return (
    // overscroll-x-contain ONLY. `none` would also suppress the vertical
    // rubber-band, and `overflow-x: auto` silently makes this a scroll
    // container in BOTH axes — so `none` here stops the page scrolling from
    // any finger that lands on the table. Do not add touch-action: pan-x
    // either; it restricts rather than delegates. Both are documented at the
    // explorer's copy of this container.
    <div className="overflow-x-auto overscroll-x-contain">
      <table className="w-full text-sm border-separate border-spacing-0">
        <thead>
          {/* Band row — group captions only. Spacers MIRROR the header row
              below one cell at a time rather than collapsing into a single
              colSpan, because the identity columns drop out at different
              breakpoints: a static colSpan keeps claiming a column that is no
              longer rendering, and every caption after it sits one column
              right of the data it labels. colSpan is an attribute, so CSS
              cannot fix it — the structures have to match. */}
          <tr>
            <th className="sticky left-0 z-30 bg-paper-deep h-6 p-0 border-r border-hairline" />
            <th className="bg-paper-deep h-6 p-0 hidden sm:table-cell" />
            <th className="bg-paper-deep h-6 p-0" />
            <th className="bg-paper-deep h-6 p-0 hidden md:table-cell" />
            <th className="bg-paper-deep h-6 p-0 hidden lg:table-cell" />
            <th colSpan={RATING_COLS.length} className="bg-paper-deep h-6 p-0 px-2 text-[0.58rem] uppercase tracking-[0.15em] font-semibold text-ink-muted text-center border-l border-hairline align-middle">
              Ratings <span className="text-ink-muted/70">(ADJUSTED)</span>
            </th>
            <th colSpan={FOUR_FACTOR_COLS.length} className="bg-paper-deep h-6 p-0 px-2 text-[0.58rem] uppercase tracking-[0.15em] font-semibold text-coral text-center border-l border-hairline align-middle">
              Four Factors
            </th>
            <th colSpan={SHOOTING_COLS.length} className="bg-paper-deep h-6 p-0 px-2 text-[0.58rem] uppercase tracking-[0.15em] font-semibold text-ink-muted text-center border-l border-hairline align-middle">
              Shooting
            </th>
          </tr>
          <tr>
            <IdTh label="Season"  active={sortBy==="year"}       dir={sortDir} onClick={() => toggle("year","desc")} className="sticky left-0 z-30 border-r border-hairline" />
            <IdTh label="Conf"    active={sortBy==="conference"} dir={sortDir} onClick={() => toggle("conference","asc")} className="hidden sm:table-cell" />
            <IdTh label="Record"  active={sortBy==="record"}     dir={sortDir} onClick={() => toggle("record","desc")} />
            <IdTh label="Conf Rec" active={sortBy==="confRecord"} dir={sortDir} onClick={() => toggle("confRecord","desc")} className="hidden md:table-cell" />
            <IdTh label="Coach"   active={sortBy==="coach"}      dir={sortDir} onClick={() => toggle("coach","asc")} className="hidden lg:table-cell" />
            {DEFAULT_COLS.map((c, i) => (
              <StatTh
                key={c.sortKey}
                col={c}
                active={sortBy === c.sortKey}
                dir={sortDir}
                onClick={() => toggle(c.sortKey, c.lowerBetter ? "asc" : "desc")}
                className={cn(GROUP_STARTS.has(i) && "border-l border-hairline")}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => {
            // Opaque zebra so the frozen Season column can share it and still
            // hide the scrolled content passing behind it.
            const isCurrent = r.year === currentYear;
            const zebra = i % 2 === 0 ? "bg-paper" : "bg-card";
            // The current season's tint replaces the zebra rather than layering
            // over it — a translucent fill on a sticky cell lets the stat
            // columns show through as they scroll underneath.
            const rowBg = isCurrent ? (accentColor ? "" : "bg-coral/10") : zebra;
            const rowStyle = isCurrent && accentColor ? { backgroundColor: `${accentColor}1a` } : undefined;
            return (
              <tr key={r.year} className={cn("group", rowBg)} style={rowStyle}>
                <td style={rowStyle} className={cn("sticky left-0 z-20 px-2 sm:px-3 py-1 border-r border-hairline transition-colors", rowBg, ROW_HOVER)}>
                  <Link
                    href={`/teams/${slug}/${r.year}/`}
                    className="group/link inline-flex items-center gap-2.5 transition-colors"
                    prefetch={false}
                  >
                    <TeamLogo name={r.teamName} size={20} />
                    <span className="font-medium text-ink group-hover/link:text-coral transition-colors whitespace-nowrap shrink-0">
                      {seasonLabel(r.year)}
                    </span>
                    {r.tourneySeed != null && <SeedChip seed={r.tourneySeed} size="sm" />}
                    <TourneyBadge teamName={r.teamName} year={r.year} />
                  </Link>
                </td>
                <td className={cn("px-3 py-1 text-ink-muted whitespace-nowrap transition-colors hidden sm:table-cell", ROW_HOVER)}>
                  {confDisplay(r.conference)}
                </td>
                <td className={cn("px-1.5 sm:px-3 py-1 tabular font-semibold text-ink whitespace-nowrap transition-colors", ROW_HOVER)}>
                  {r.record ?? "—"}
                </td>
                <td className={cn("px-3 py-1 tabular text-ink-soft whitespace-nowrap transition-colors hidden md:table-cell", ROW_HOVER)}>
                  {r.confRecord ?? "—"}
                </td>
                <td className={cn("px-3 py-1 text-ink-muted whitespace-nowrap transition-colors hidden lg:table-cell", ROW_HOVER)}>
                  {r.coach ?? "—"}
                </td>
                {DEFAULT_COLS.map((c, ci) => {
                  const total = r.vals[c.total as string] ?? null;
                  const perGame = c.perGame ? r.vals[c.perGame as string] ?? null : null;
                  const isFF = ci >= FF_START && ci < FF_END;
                  return (
                    <td
                      key={c.sortKey}
                      className={cn(
                        "px-1 sm:px-2 py-1 text-right tabular whitespace-nowrap transition-colors",
                        isFF && FF_BAND_TINT,
                        GROUP_STARTS.has(ci) && "border-l border-hairline",
                        ROW_HOVER,
                      )}
                    >
                      <span className="inline-flex flex-col items-end gap-0.5 leading-tight">
                        {/* Season total is the value. When it is unavailable —
                            fast break before 2023, where too few games tracked
                            the split to total honestly — fall back to the
                            per-game figure rather than an empty dash. It keeps
                            its "/g" so the two are never confused: a bare
                            number in a totals column that silently switched
                            units would be worse than the dash it replaced. */}
                        {total !== null ? (
                          <span className={cn(c.label === "NET" && "font-semibold text-ink")}>
                            {fmtColValue(total, c.fmt)}
                          </span>
                        ) : c.perGame && perGame !== null ? (
                          <span
                            className="text-ink-soft"
                            title="Season total unavailable — too few games tracked this split. Showing the per-game average over the games that did."
                          >
                            {(perGame > 0 ? "+" : "") + perGame.toFixed(1)}
                            <span className="text-[0.6rem] text-ink-muted">/g</span>
                          </span>
                        ) : (
                          <span className="text-ink-muted">—</span>
                        )}
                        <PercentileChip pct={r.pct[c.pct] ?? null} />
                      </span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Identity-column header. Left-aligned, plain label. */
function IdTh({
  label, active, dir, onClick, className = "",
}: {
  label: string; active: boolean; dir: "asc" | "desc"; onClick: () => void; className?: string;
}) {
  return (
    <th
      className={cn(
        "bg-paper-deep border-b border-hairline px-2 sm:px-3 py-3 sm:py-2 text-xs uppercase tracking-widest font-medium text-left align-middle whitespace-nowrap",
        active ? "text-ink" : "text-ink-muted",
        className,
      )}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button type="button" onClick={onClick} className="inline-flex items-center gap-1 hover:text-coral transition-colors">
        {label}
        <SortArrow active={active} dir={dir} />
      </button>
    </th>
  );
}

/** Stat-column header. Right-aligned to sit over the tabular values. */
function StatTh({
  col, active, dir, onClick, className = "",
}: {
  col: TeamCol; active: boolean; dir: "asc" | "desc"; onClick: () => void; className?: string;
}) {
  return (
    <th
      title={col.title}
      className={cn(
        "bg-paper-deep border-b border-hairline px-1 sm:px-2 py-3 sm:py-2 text-xs uppercase tracking-widest font-medium text-right align-middle whitespace-nowrap",
        active ? "text-ink" : "text-ink-muted",
        className,
      )}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button type="button" onClick={onClick} className="inline-flex items-center gap-1 hover:text-coral transition-colors">
        {col.label}
        <SortArrow active={active} dir={dir} />
      </button>
    </th>
  );
}

function SortArrow({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) return <span aria-hidden className="text-ink-muted/40">↕</span>;
  return <span aria-hidden>{dir === "asc" ? "↑" : "↓"}</span>;
}
