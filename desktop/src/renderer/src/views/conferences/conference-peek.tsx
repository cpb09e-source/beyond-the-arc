import { PercentileChip } from "@/components/percentile-chip";
import { confDisplay } from "@/lib/conf-display";
import { POWER_CONFS } from "@/lib/conf-tiers";
import type { ConfRow } from "@/lib/conference-rankings";
import type { StaticTeamSeasonRow } from "@/lib/static-data";
import { shapeSeason, type Season } from "~/data/team-model";
import { useCorpus } from "~/data/use-corpus";
import { ConfLogo } from "~/ui/conf-logo";
import { seasonLabel, signed1 } from "~/ui/format";
import { TeamLogo } from "~/ui/logo";

export type ConfHighlight = { label: string; value: string; pct: number | null; title?: string };

const shapeTeams = (json: string, year: number): Season => shapeSeason(year, JSON.parse(json) as StaticTeamSeasonRow[]);

/**
 * What a conference Peek says: the league's ratings with their place among
 * that season's conferences, and the teams behind the row.
 *
 * THE TEAMS ARE THE POINT. A power ranking that drops two teams is only
 * trustworthy if the reader can see which two, and whether the league is one
 * great team and eleven others or twelve good ones. The list is the season's
 * team file, the same one the Team Explorer reads, ordered by adjusted net,
 * with the dropped pair marked where the build dropped them.
 */
export function ConferencePeekBody({ row, highlights }: { row: ConfRow; highlights: ConfHighlight[] }) {
  const [state] = useCorpus("teams", row.year, shapeTeams);
  const season = state.status === "ready" ? state.value : null;
  const dropped = new Set(row.dropped);
  const teams = season
    ? season.teams.filter((t) => t.conf === row.conf).sort((a, b) => (b.adjNet ?? -1e9) - (a.adjNet ?? -1e9))
    : [];

  return (
    <>
      <header className="flex items-start gap-3 px-4 pb-3 pt-3.5">
        <ConfLogo conf={row.conf} size={34} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="truncate text-[16px] font-semibold leading-tight tracking-[-0.01em] text-ink">
              {confDisplay(row.conf) || row.conf}
            </h2>
            <span className="shrink-0 text-[11.5px] text-ink-muted">{POWER_CONFS.has(row.conf) ? "Power" : "Mid-major"}</span>
          </div>
          <div className="mt-0.5 text-[12px] text-ink-muted tabular">
            {seasonLabel(row.year)} · {row.kept} of {row.teams} teams counted
          </div>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-px border-t border-hairline bg-hairline">
        {highlights.map((h) => (
          <div key={h.label} title={h.title} className="bg-card px-3 py-2">
            <div className="truncate text-[11px] text-ink-muted">{h.label}</div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="text-[15px] font-semibold leading-none text-ink tabular">{h.value}</span>
              <PercentileChip pct={h.pct} className="min-w-[26px] px-1 py-[2px] text-[10.5px]" />
            </div>
          </div>
        ))}
      </div>

      <section className="border-t border-hairline px-4 pb-3 pt-2.5">
        <h3 className="mb-1.5 grid grid-cols-[18px_minmax(0,1fr)_44px_44px_30px] gap-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          <span className="col-span-2">Teams by adjusted net</span>
          <span className="text-right">W-L</span>
          <span className="text-right">Net</span>
          <span className="text-right" title="BTA rank">BTA</span>
        </h3>
        {!season ? (
          <p className="py-2 text-[12px] text-ink-muted">{state.status === "error" ? "The teams for this season did not load." : "Loading teams…"}</p>
        ) : (
          <ul className="grid gap-[3px]">
            {teams.map((t) => {
              const out = dropped.has(t.name);
              return (
                <li
                  key={t.id}
                  className="grid grid-cols-[18px_minmax(0,1fr)_44px_44px_30px] items-center gap-2 text-[12.5px]"
                  title={out ? `${t.name} is one of the two teams this row drops` : undefined}
                >
                  <span className={out ? "opacity-50" : ""}>
                    <TeamLogo id={t.logoId} name={t.name} size={16} />
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className={`truncate ${out ? "text-ink-muted" : "text-ink"}`}>{t.name}</span>
                    {out && (
                      <span className="shrink-0 rounded-[4px] bg-paper-deep px-1 py-px text-[10px] font-medium text-ink-muted">Dropped</span>
                    )}
                  </span>
                  <span className="text-right text-ink-muted tabular">
                    {t.wins}–{t.losses}
                  </span>
                  <span className={`text-right tabular ${out ? "text-ink-muted" : "text-ink"}`}>{signed1(t.adjNet)}</span>
                  <span className="text-right text-ink-muted tabular">{t.btaRank ?? "–"}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
