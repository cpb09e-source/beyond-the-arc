"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { TeamLogo } from "@/components/team-logo";
import { TourneyBadge } from "@/components/tourney-badge";
import { SeedChip } from "@/components/coaches/seed-chip";
import { PercentileChip } from "@/components/percentile-chip";
import { StatLabel } from "@/components/explorer/sortable-th";
import { confDisplay } from "@/lib/conf-display";
import { cn } from "@/lib/utils";
import {
  RATING_COLS,
  FOUR_FACTOR_COLS,
  SHOOTING_COLS,
  DEFAULT_COLS,
  fmtColValue,
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

/**
 * "year" is the order the table opens in. Season, Record and Conf Rec sort by
 * their own keys; every stat column sorts by its TeamCol.sortKey. Conf and
 * Coach do not sort at all — see the header row.
 */
type SortKey = "year" | "record" | "confRecord" | string;

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
        case "record":      return winsOf(r.record);
        case "confRecord":  return winsOf(r.confRecord);
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
    // Frames itself, the way SortableRosterTable does, and with the same
    // border: a hairline that goes full-bleed below lg and rounds off above
    // it. The card treatment this replaced — accent bar, header block, ring
    // and drop shadow — made By season look like the page's headline, which it
    // was when it lived at the foot of Overview. On its own tab it is simply
    // the content, and it should read like the roster does.
    <div className="border-y border-x-0 lg:border-x border-hairline rounded-none lg:rounded-xl shadow-sm overflow-hidden bg-paper-deep/25 -mx-4 lg:mx-0">
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
            <th className="bg-paper-deep h-6 p-0" />
            <th className="bg-paper-deep h-6 p-0 hidden md:table-cell" />
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
            {/* Conf and Coach do not sort. For a single team both are very
                nearly constant — twelve rows of "America East" and twelve of
                "John Becker" — so the control would reorder nothing a reader
                could see. Season does sort, and is also how you get back to
                the order the table opened in after sorting by a stat. */}
            <HeadCell label="Season" sort={{ active: sortBy==="year", dir: sortDir, onClick: () => toggle("year","desc") }} className="sticky left-0 z-30 border-r border-hairline" />
            <HeadCell label="Record"   sort={{ active: sortBy==="record",     dir: sortDir, onClick: () => toggle("record","desc") }} />
            <HeadCell label="Conf Rec" sort={{ active: sortBy==="confRecord", dir: sortDir, onClick: () => toggle("confRecord","desc") }} className="hidden md:table-cell" />
            {/* Conf drops at the SAME breakpoint as Conf Rec, not a smaller
                one. It sits to their right now, and a column that survives to
                a narrower screen than the column on its left would appear to
                jump left as the viewport shrinks. */}
            <HeadCell label="Conf" className="hidden md:table-cell" />
            <HeadCell label="Coach" className="hidden lg:table-cell" />
            {DEFAULT_COLS.map((c, i) => (
              <HeadCell
                key={c.sortKey}
                label={c.label}
                title={c.title}
                align="right"
                sort={{ active: sortBy === c.sortKey, dir: sortDir, onClick: () => toggle(c.sortKey, c.lowerBetter ? "asc" : "desc") }}
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
            const rowBg = isCurrent ? "" : zebra;
            // OPAQUE, mixed against the card surface rather than laid over it at 8%
            // alpha. This cell is sticky: a translucent fill lets the stat columns scroll
            // visibly through it, so POSS and MINS smeared across the lineup name as soon
            // as the table was scrolled right. Same trap the explorer's honour cells hit
            // — see the note in explorer-client.tsx.
            const rowStyle = isCurrent
              ? { backgroundColor: `color-mix(in oklab, ${accentColor ?? "var(--color-coral)"} 12%, var(--card))` }
              : undefined;
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
                <td className={cn("px-1.5 sm:px-3 py-1 tabular font-semibold text-ink whitespace-nowrap transition-colors", ROW_HOVER)}>
                  {r.record ?? "—"}
                </td>
                <td className={cn("px-3 py-1 tabular text-ink-soft whitespace-nowrap transition-colors hidden md:table-cell", ROW_HOVER)}>
                  {r.confRecord ?? "—"}
                </td>
                {/* Bart's raw code ("AE", "BW", "B10") rather than the display
                    name. On a single team's page this is twelve rows of the
                    same value, so the full name was spending width to say one
                    thing twelve times. The display name is the title, for
                    anyone who does not know the code. */}
                <td
                  title={confDisplay(r.conference)}
                  className={cn("px-3 py-1 text-ink-muted whitespace-nowrap transition-colors hidden md:table-cell", ROW_HOVER)}
                >
                  {r.conference ?? "—"}
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
    </div>
  );
}

/**
 * A header cell, sortable or not.
 *
 * Visually this is the explorer's SortableTh — same typography, same coral
 * arrow when active, same faint idle "↑↓" affordance — but it drives local
 * state instead of the URL, so it cannot simply be that component. Keep the
 * two in step by eye; they sit above the same grid and a reader moves between
 * them.
 *
 * PADDING LIVES ON THE BUTTON, NOT THE CELL. On the <th> the button's
 * `w-full h-full` fills only the content box, leaving the tappable area at the
 * 16px-tall text with the surrounding padding inert — a third of the 44px
 * touch-target guideline. Inside, the whole cell is tappable, and the extra
 * vertical padding below `sm` takes a phone tap from 16px to 40px. This is the
 * same bug and the same fix as the note in sortable-th.tsx.
 */
function HeadCell({
  label, title, align = "left", sort, className = "",
}: {
  label: string;
  title?: string;
  align?: "left" | "right";
  /** Omit to render a static, non-sortable header. */
  sort?: { active: boolean; dir: "asc" | "desc"; onClick: () => void };
  className?: string;
}) {
  const base = "bg-paper-deep border-b border-hairline p-0 text-xs uppercase tracking-wide sm:tracking-widest font-medium select-none align-middle whitespace-nowrap transition-colors";
  const alignClass = align === "right" ? "text-right" : "text-left";
  const tone = sort?.active ? "text-ink" : "text-ink-muted";
  const pad = "px-1.5 sm:px-3 py-3 sm:py-2";

  const inner = (
    <span className={cn("inline-flex items-center gap-1", align === "right" ? "justify-end" : "justify-start")}>
      {/* StatLabel, not the raw string. The `uppercase` on this cell would
          otherwise flatten "eFG%" to "EFG%" — StatLabel detects a
          lowercase-initial label, opts it out of the CSS transform and
          uppercases the tail by hand. Same component the explorer's headers
          use, so the two rows capitalise identically. */}
      <span><StatLabel label={label} /></span>
      {sort && (
        sort.active ? (
          <span className="text-coral text-[0.65rem] leading-none">{sort.dir === "asc" ? "↑" : "↓"}</span>
        ) : (
          <span className="text-ink-muted/50 text-[0.6rem] leading-none tracking-tighter" aria-hidden>↑↓</span>
        )
      )}
    </span>
  );

  if (!sort) {
    return (
      <th title={title ?? label} className={cn(base, alignClass, tone, pad, className)}>
        {inner}
      </th>
    );
  }
  return (
    <th
      title={title ?? label}
      className={cn(base, alignClass, tone, "cursor-pointer hover:bg-paper-deep/60", className)}
      aria-sort={sort.active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      {/* `uppercase` is repeated here on purpose. Preflight resets
          `text-transform: none` on button (normalize's fix for Firefox and
          Edge not inheriting it), which silently undid the cell's uppercase
          and left the sortable headers in mixed case beside the static ones —
          "Record" against "SEASON". The explorer's version is an anchor and
          never hit this. */}
      <button type="button" onClick={sort.onClick} className={cn("block w-full h-full uppercase", pad, alignClass)}>
        {inner}
      </button>
    </th>
  );
}
