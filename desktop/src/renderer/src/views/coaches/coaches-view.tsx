import { useEffect, useMemo } from "react";
import { PercentileChip } from "@/components/percentile-chip";
import { TOURNEY_ROUND_LABEL } from "@/lib/coach-views";
import type { CoachIndexRow } from "@/lib/coaches-core";
import { confDisplay } from "@/lib/conf-display";
import { SEASON_CEIL } from "@/lib/seasons";
import { useCoachBook, yearsSpan, type CoachBook } from "~/data/coach-model";
import { SOURCE_LABEL } from "~/data/use-corpus";
import { useShell } from "~/shell/shell-context";
import { useSetStatus } from "~/shell/status";
import { useTabTitle } from "~/shell/tab-title";
import { LoadError, NoMatches, TableSkeleton, ViewHeader } from "~/shell/view-parts";
import type { ViewProps } from "~/shell/views";
import { DataTable, type Column } from "~/table/data-table";
import { StatCell } from "~/table/stat-cell";
import { CoachAvatar } from "~/ui/coach-avatar";
import { num1, seasonLabel, signed1 } from "~/ui/format";
import { TeamLogo } from "~/ui/logo";
import { logoIdOf } from "~/ui/logo-id";
import { usePersisted } from "~/ui/persisted";
import { matchesQuery } from "~/ui/text";

/**
 * Every coach since 2012-13, ranked the way the site's /coaches ranks them.
 *
 * THE SITE'S NUMBERS: the composite, the per-season rate, the chips (ranked
 * against every coach, not the filtered few, so narrowing to one league does
 * not inflate them), the bracket-counted tournament record. Active coaches by
 * default, as a reader usually means; one click shows everyone.
 */

const ROW_H = 42;
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const coachKey = (r: CoachIndexRow) => r.slug;
const byName = (a: CoachIndexRow, b: CoachIndexRow) => a.name.localeCompare(b.name);
const lastName = (n: string) => (n.split(" ").pop() ?? n).toLowerCase();
const pctText = (v: number | null | undefined) => (v == null ? "–" : (v * 100).toFixed(1));
const SCOPES: Array<[boolean, string]> = [
  [true, "Active"],
  [false, "All coaches"],
];

function count(n: number) {
  return <span className={n ? "text-ink tabular" : "text-ink-muted tabular"}>{n}</span>;
}

function columns(book: CoachBook): Column<CoachIndexRow>[] {
  const { pct, compositeRank } = book;
  return [
    {
      key: "rank", label: "#", title: "Composite rank among every coach", width: 48, align: "right", first: 1, pin: true,
      sortValue: (r) => compositeRank.get(r.slug) ?? null,
      cell: (r) => <span className="text-ink-muted tabular">{compositeRank.get(r.slug) ?? "–"}</span>,
    },
    {
      key: "name", label: "Coach", width: 224, align: "left", first: 1, pin: true,
      sortValue: (r) => lastName(r.name),
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-2">
          <CoachAvatar name={r.name} team={r.current_team} size={22} />
          <span className="truncate font-medium text-ink">{r.name}</span>
          {!r.is_active && <span className="shrink-0 text-[11px] text-ink-muted">Former</span>}
        </span>
      ),
    },
    {
      key: "team", label: "School", width: 176, align: "left", first: 1,
      sortValue: (r) => r.current_team,
      cell: (r) =>
        r.current_team ? (
          <span className="flex min-w-0 items-center gap-2">
            <TeamLogo id={logoIdOf(r.current_team)} name={r.current_team} size={18} />
            <span className="truncate text-ink-soft">{r.current_team}</span>
          </span>
        ) : null,
    },
    {
      key: "conf", label: "Conf", width: 108, align: "left", first: 1,
      sortValue: (r) => (r.current_conference ? confDisplay(r.current_conference) : null),
      cell: (r) => <span className="block truncate text-ink-soft">{r.current_conference ? confDisplay(r.current_conference) : "–"}</span>,
    },
    {
      key: "seasons", label: "Yrs", title: "Seasons coached since 2012-13", width: 48, align: "right", first: -1,
      sortValue: (r) => r.seasons_count,
      cell: (r) => count(r.seasons_count),
    },
    {
      key: "record", label: "W-L", title: "Career record since 2012-13", width: 84, align: "right", first: -1,
      sortValue: (r) => r.career_wins,
      cell: (r) => <span className="whitespace-nowrap text-ink-soft tabular">{`${r.career_wins}-${r.career_losses}`}</span>,
    },
    {
      key: "winPct", label: "Win%", width: 60, align: "right", first: -1,
      sortValue: (r) => r.career_win_pct,
      cell: (r) => <span className="text-ink-soft tabular">{pctText(r.career_win_pct)}</span>,
    },
    {
      key: "composite", label: "Score", title: "Composite résumé score", width: 64, align: "right", first: -1,
      sortValue: (r) => r.composite_score ?? null,
      cell: (r) => <StatCell value={num1(r.composite_score ?? null)} pct={pct.composite.get(r.slug)} strong />,
    },
    {
      key: "perSeason", label: "Per yr", title: "Composite per season coached", width: 64, align: "right", first: -1,
      sortValue: (r) => r.composite_per_season ?? null,
      cell: (r) => <StatCell value={num1(r.composite_per_season ?? null)} pct={pct.perSeason.get(r.slug)} />,
    },
    {
      key: "adjNet", label: "Net", title: "Mean adjusted net rating across the seasons coached", width: 64, align: "right", first: -1,
      sortValue: (r) => r.adj_net_avg ?? null,
      cell: (r) => <StatCell value={signed1(r.adj_net_avg ?? null)} pct={pct.adjNet.get(r.slug)} />,
    },
    {
      key: "confPct", label: "Conf%", title: "Conference win %", width: 64, align: "right", first: -1,
      sortValue: (r) => r.conf_win_pct ?? null,
      cell: (r) => <StatCell value={pctText(r.conf_win_pct)} pct={pct.conf.get(r.slug)} />,
    },
    {
      key: "ncaa", label: "NCAA", title: "NCAA tournament appearances", width: 56, align: "right", first: -1,
      sortValue: (r) => r.ncaa_appearances,
      cell: (r) => count(r.ncaa_appearances),
    },
    {
      key: "tourney", label: "Tourney", title: "NCAA tournament games won and lost, counted off the bracket", width: 84, align: "right", first: -1,
      sortValue: (r) => (r.ncaa_appearances > 0 ? r.tourney_wins : null),
      cell: (r) =>
        r.ncaa_appearances > 0 ? (
          <StatCell value={`${r.tourney_wins}-${r.tourney_losses}`} pct={pct.tourneyWins.get(r.slug)} />
        ) : (
          <span className="text-ink-muted">–</span>
        ),
    },
    { key: "s16", label: "S16", title: "Sweet 16s", width: 48, align: "right", first: -1, sortValue: (r) => r.sweet_sixteens, cell: (r) => count(r.sweet_sixteens) },
    { key: "f4", label: "F4", title: "Final Fours", width: 44, align: "right", first: -1, sortValue: (r) => r.final_fours, cell: (r) => count(r.final_fours) },
    { key: "titles", label: "Titles", title: "National championships", width: 64, align: "right", first: -1, sortValue: (r) => r.ncaa_titles, cell: (r) => count(r.ncaa_titles) },
    {
      key: "best", label: "Best finish", title: "Furthest NCAA round reached", width: 124, align: "left", first: -1,
      sortValue: (r) => r.tourney_rank_key ?? 0,
      cell: (r) =>
        r.best_finish ? (
          <span className="block truncate text-ink-soft">{TOURNEY_ROUND_LABEL[r.best_finish]}</span>
        ) : (
          <span className="text-ink-muted">–</span>
        ),
    },
  ];
}

export function CoachesView({ query, setQuery }: ViewProps) {
  const [state, retry] = useCoachBook();
  const setStatus = useSetStatus();
  const { openRecord } = useShell();
  const [activeOnly, setActiveOnly] = usePersisted("bta.coaches.active", true, isBool);
  useTabTitle(query.trim() ? `Coaches: ${query.trim()}` : null);

  const book = state.status === "ready" ? state.value : null;
  const cols = useMemo(() => (book ? columns(book) : []), [book]);
  const pool = useMemo(() => (book ? book.rows.filter((r) => !activeOnly || r.is_active) : []), [book, activeOnly]);
  const rows = useMemo(
    () =>
      pool.filter((r) =>
        matchesQuery(query, r.name, r.current_team ?? "", r.current_conference ? confDisplay(r.current_conference) : "", r.all_teams.join(" ")),
      ),
    [pool, query],
  );

  useEffect(() => {
    if (state.status === "ready") setStatus(`${SOURCE_LABEL[state.source]} in ${state.ms} ms`);
    else if (state.status === "loading") setStatus("Building coaches…");
    else setStatus("Not loaded");
  }, [state, setStatus]);

  const meta = book
    ? [
        `${rows.length !== pool.length ? `${rows.length} of ${pool.length}` : pool.length} ${activeOnly ? "active " : ""}coaches`,
        "since 2012-13",
        book.missing.length > 0 ? `${book.missing.length} seasons not readable` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : undefined;

  return (
    <>
      <ViewHeader
        kicker="Teams"
        title="Coaches"
        year={SEASON_CEIL}
        season={false}
        meta={meta}
        controls={
          <div role="radiogroup" aria-label="Which coaches" className="flex h-[26px] items-center rounded-md border border-hairline bg-card p-0.5 text-[12px]">
            {SCOPES.map(([value, label]) => (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={activeOnly === value}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setActiveOnly(value)}
                className={`h-full rounded-[4px] px-2 transition-colors ${
                  activeOnly === value ? "bg-[var(--nav-active)] font-medium text-ink" : "text-ink-muted hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        }
        filter={{ value: query, onChange: setQuery, placeholder: "Filter coaches" }}
      />
      <div className="relative min-h-0 flex-1 border-t border-hairline">
        {book ? (
          <DataTable
            rows={rows}
            columns={cols}
            rowKey={coachKey}
            rowHeight={ROW_H}
            defaultSort={{ key: "rank", dir: 1 }}
            tieBreak={byName}
            ariaLabel="Coaches"
            empty={<NoMatches query={query} noun="coach, school or conference" />}
            peek={{ label: (r) => r.name, body: (r) => <CoachPeekBody book={book} row={r} /> }}
            onOpen={(r, how) =>
              openRecord({ kind: "coach", slug: r.slug, name: r.name, team: r.current_team }, { newTab: how.newTab, side: how.side })
            }
          />
        ) : state.status === "error" ? (
          <LoadError year={SEASON_CEIL} reason={state.reason} message={state.message} what="Coaches" onRetry={retry} />
        ) : (
          <TableSkeleton rowHeight={ROW_H} label="Building coaches" />
        )}
      </div>
    </>
  );
}

function CoachPeekBody({ book, row }: { book: CoachBook; row: CoachIndexRow }) {
  const profile = book.bySlug.get(row.slug);
  const rank = book.compositeRank.get(row.slug);
  const facts: Array<[string, string, number | null]> = [
    ["Record", `${row.career_wins}–${row.career_losses}`, null],
    ["Win %", pctText(row.career_win_pct), null],
    ["Score", num1(row.composite_score ?? null), book.pct.composite.get(row.slug) ?? null],
    ["Net", signed1(row.adj_net_avg ?? null), book.pct.adjNet.get(row.slug) ?? null],
    ["NCAA", String(row.ncaa_appearances), null],
    ["Tourney", `${row.tourney_wins}–${row.tourney_losses}`, row.ncaa_appearances > 0 ? (book.pct.tourneyWins.get(row.slug) ?? null) : null],
  ];
  return (
    <>
      <header className="flex items-center gap-3 px-4 pb-3 pt-3.5">
        <CoachAvatar name={row.name} team={row.current_team} size={34} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[16px] font-semibold leading-tight tracking-[-0.01em] text-ink">{row.name}</h2>
          <p className="mt-0.5 truncate text-[12px] text-ink-muted">
            {[row.current_team, row.is_active ? "Active" : row.current_year ? `Last coached ${seasonLabel(row.current_year)}` : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {rank != null && <span title="Composite rank" className="shrink-0 text-[12px] text-ink-muted tabular">#{rank}</span>}
      </header>
      <div className="grid grid-cols-3 gap-px border-y border-hairline bg-hairline">
        {facts.map(([label, value, p]) => (
          <div key={label} className="bg-card px-3 py-2">
            <div className="text-[11px] text-ink-muted">{label}</div>
            <div className="mt-1 flex items-center justify-between gap-1.5">
              <span className="text-[14px] font-semibold text-ink tabular">{value}</span>
              <PercentileChip pct={p} className="min-w-[24px] px-1 py-[2px] text-[10.5px]" />
            </div>
          </div>
        ))}
      </div>
      {profile && profile.schools.length > 0 && (
        <div className="px-4 py-3">
          <h3 className="mb-1.5 text-[11px] font-medium text-ink-muted">Schools</h3>
          <ul className="flex flex-col gap-1.5">
            {profile.schools.slice(0, 6).map((s) => (
              <li key={`${s.team}|${s.first_year}`} className="flex items-center gap-2 text-[12.5px]">
                <TeamLogo id={logoIdOf(s.team)} name={s.team} size={16} />
                <span className="min-w-0 flex-1 truncate text-ink-soft">{s.team}</span>
                <span className="text-ink-muted">{yearsSpan(s.first_year, s.last_year)}</span>
                <span className="w-[52px] text-right text-ink tabular">
                  {s.wins}–{s.losses}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
