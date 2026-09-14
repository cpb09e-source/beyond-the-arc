import type { ReactNode } from "react";
import { CAREER_COLUMNS, careerLine, formatCareer, seasonLine, type CareerSeason, type CareerView } from "@/lib/career-line";
import { useLoaded } from "~/data/use-corpus";
import { Picker } from "~/shell/picker";
import { TableSkeleton } from "~/shell/view-parts";
import { seasonLabel } from "~/ui/format";
import { TeamLogo } from "~/ui/logo";
import { usePersisted } from "~/ui/persisted";
import { ClassBadge } from "~/ui/player-photo";

/**
 * A player's Career tab: the site's career ledger, per game or as totals, with
 * the career line under the seasons.
 *
 * THE SITE'S NUMBERS (src/lib/career-line.ts), from the same per-player file the
 * site's player page reads, so a season here and on btacbb.xyz is the same line.
 * A season opens on the Overview; a team opens that season's team page.
 */

const VIEWS = [
  { key: "per_game", label: "Per game", desc: "Each season's counts per game; rates as they are" },
  { key: "totals", label: "Totals", desc: "Each season's counts, and minutes rather than minutes per game" },
];
const isView = (v: unknown): v is CareerView => v === "per_game" || v === "totals";
/** "15-16", as the site's ledger writes a season: the column stays narrow enough for the line to fit. */
const shortSeason = (y: number) => `${String(y - 1).slice(-2)}-${String(y).slice(-2)}`;

export function PlayerCareer({
  bartId,
  year,
  logoOf,
  onSeason,
  onTeam,
  fallback,
}: {
  bartId: number | null;
  /** The season the page is on, marked in the ledger. */
  year: number;
  /** A team's crest id in a season, from the search index. */
  logoOf: (year: number) => number | null;
  onSeason: (year: number) => void;
  onTeam: (team: string, logoId: number | null, year: number, newTab: boolean) => void;
  /** What shows when the player has no career file: the seasons the index knows. */
  fallback: ReactNode;
}) {
  const [view, setView] = usePersisted<CareerView>("bta.profile.career.view", "per_game", isView);
  const [state] = useLoaded<CareerSeason[] | null>(`player-career|${bartId ?? "none"}`, async () => {
    if (bartId == null) return { value: null, source: "memory" };
    const { json, source } = await window.bta.data("player-career", year, String(bartId));
    const file = JSON.parse(json) as { seasons?: CareerSeason[] } | null;
    return { value: file?.seasons?.length ? [...file.seasons].sort((a, b) => b.year - a.year) : null, source };
  });

  if (state.status === "loading") {
    return (
      <div className="relative min-h-0 flex-1">
        <TableSkeleton rowHeight={40} label="Loading career" />
      </div>
    );
  }
  const seasons = state.status === "ready" ? state.value : null;
  if (!seasons) return <>{fallback}</>;

  const total = seasons.length > 1 ? careerLine(seasons, view) : null;
  const cell = (key: (typeof CAREER_COLUMNS)[number], v: number | null) => formatCareer(v, key.kind, view);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-10 pt-5">
      <section aria-label="Career" className="@container overflow-hidden rounded-lg border border-hairline bg-card">
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-hairline px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <h2 className="text-[18px] font-semibold leading-none tracking-[-0.015em] text-ink">Career</h2>
            <Picker label="Show" value={view} options={VIEWS} onChange={(k) => setView(k === "totals" ? "totals" : "per_game")} />
          </div>
          <span className="whitespace-nowrap text-[12px] text-ink-muted">
            <span className="font-semibold text-ink tabular">{seasons.length}</span> {seasons.length === 1 ? "season" : "seasons"}
          </span>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse whitespace-nowrap text-[12px]">
            <thead>
              <tr className="h-[34px] border-b border-hairline bg-[color-mix(in_oklab,var(--ink)_3%,var(--card))] text-[10.5px] font-semibold uppercase tracking-[0.07em] text-ink-muted">
                <th className="pl-4 pr-2 text-left font-semibold">Season</th>
                <th className="px-2 text-left font-semibold">Team</th>
                <th className="px-2 text-left font-semibold">CL</th>
                {CAREER_COLUMNS.map((c) => (
                  <th key={c.key} className="px-1 text-right font-semibold last:pr-4">
                    {c.label(view)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {seasons.map((s) => {
                const line = seasonLine(s, view);
                const here = s.year === year;
                const logo = logoOf(s.year);
                return (
                  <tr
                    key={s.year}
                    data-career-season={s.year}
                    tabIndex={0}
                    title="Open this season on the Overview"
                    onClick={() => onSeason(s.year)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onSeason(s.year);
                    }}
                    className={`h-[40px] cursor-pointer border-b border-hairline outline-none transition-colors hover:bg-[var(--row-hover)] focus-visible:bg-[var(--row-hover)] ${
                      here ? "bg-[var(--row-focus)]" : ""
                    }`}
                  >
                    <td className={`pl-4 pr-2 tabular ${here ? "font-semibold text-ink shadow-[inset_3px_0_0_var(--accent)]" : "text-ink"}`}>{shortSeason(s.year)}</td>
                    <td className="px-2">
                      <button
                        type="button"
                        title={`${s.team_name} ${seasonLabel(s.year)}  ·  Ctrl-click for a new tab`}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => {
                          e.stopPropagation();
                          onTeam(s.team_name, logo, s.year, e.ctrlKey || e.metaKey);
                        }}
                        className="-mx-1 flex min-w-0 items-center gap-2 rounded px-1 py-0.5 transition-colors hover:bg-[color-mix(in_oklab,var(--ink)_7%,transparent)]"
                      >
                        <TeamLogo id={logo} name={s.team_name} size={18} />
                        {/* The name only when the card has room for it and the whole line; the crest and its title name the team otherwise. */}
                        <span className="hidden max-w-[120px] truncate text-ink-soft @5xl:inline">{s.team_name}</span>
                      </button>
                    </td>
                    <td className="px-2">{s.class ? <ClassBadge cls={s.class} /> : <span className="text-ink-muted">—</span>}</td>
                    {CAREER_COLUMNS.map((c) => (
                      <td key={c.key} className={`px-1 text-right tabular last:pr-4 ${c.key === "pts" ? "font-medium text-ink" : "text-ink-soft"}`}>
                        {cell(c, line[c.key])}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {total && (
                <tr data-career-total="" className="h-[42px] border-t-2 border-[color-mix(in_oklab,var(--ink)_16%,transparent)] bg-[color-mix(in_oklab,var(--ink)_3%,var(--card))] font-medium">
                  <td className="px-4 font-semibold text-ink">Career</td>
                  <td className="px-2 text-ink-muted">—</td>
                  <td className="px-2 text-ink-muted">—</td>
                  {CAREER_COLUMNS.map((c) => (
                    <td key={c.key} className={`px-1 text-right tabular last:pr-4 ${c.key === "pts" ? "font-semibold text-ink" : "text-ink"}`}>
                      {cell(c, total[c.key])}
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <p className="mt-3 text-[12px] text-ink-muted">
        Choose a season to open it on the Overview. The career line&apos;s rates are its makes over its attempts, not an average of seasons.
      </p>
    </div>
  );
}
