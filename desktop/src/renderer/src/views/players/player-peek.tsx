import { PercentileChip } from "@/components/percentile-chip";
import { TopHundredPill } from "@/components/portal/top-hundred-pill";
import type { Player, PlayerSeason } from "~/data/player-model";
import { seasonLabel } from "~/ui/format";
import { TeamLogo } from "~/ui/logo";
import { ClassBadge, PlayerPhoto } from "~/ui/player-photo";
import { OVERVIEW_STATS, playerStat, type PlayerStat } from "./player-columns";

/**
 * What a player Peek says: who, where, their impact, and what they are best
 * and worst at among the stats on the table.
 *
 * STRONGEST AND WEAKEST come from the Overview columns, the stats the site
 * itself chose for the default table, ranked by this player's own percentiles.
 * Usage is on that table but left out of both lists: it says how big a role a
 * player has, not how well he fills it, and "Strongest: USG%" reads as praise.
 */

const IMPACT_KEYS = ["epm", "off_epm", "def_epm", "ewins"] as const;
const ROLE_FIELDS = new Set<string>(["usage_pct", "min_pg"]);

export function PlayerPeekBody({ season, player }: { season: PlayerSeason; player: Player }) {
  const ranked = OVERVIEW_STATS
    .filter((st) => !IMPACT_KEYS.includes(st.key as (typeof IMPACT_KEYS)[number]) && !ROLE_FIELDS.has(st.field as string))
    .map((st) => ({ st, pct: st.pctKey ? player.pct[st.pctKey] : undefined }))
    .filter((r): r is { st: PlayerStat; pct: number } => typeof r.pct === "number")
    .sort((a, b) => b.pct - a.pct);
  const strongest = ranked.slice(0, 4);
  const weakest = ranked.slice(-3).reverse().filter((r) => !strongest.includes(r));

  const detail = [player.position, player.height, player.hometown].filter(Boolean).join(" · ");
  const line = [
    ["PPG", player.s.pts_pg],
    ["RPG", player.s.reb_pg],
    ["APG", player.s.ast_pg],
    ["MPG", player.s.min_pg],
  ] as const;

  return (
    <>
      <header className="flex items-start gap-3 px-4 pb-3 pt-3.5">
        <PlayerPhoto bartId={player.bartId} hasPhoto={player.hasPhoto} name={player.name} size={52} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="truncate text-[16px] font-semibold leading-tight tracking-[-0.01em] text-ink">{player.name}</h2>
            {/* The table's top-100 mark at Peek scale: the same fact, the same tiers. */}
            {player.rank != null && player.rank <= 100 && (
              <TopHundredPill
                rank={player.rank}
                title={`Top 100: #${player.rank} in the country in ${seasonLabel(season.year)}`}
                className="h-[18px] px-1.5 text-[11px]"
              />
            )}
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[12px] text-ink-soft">
            <TeamLogo id={player.teamLogoId} name={player.team} size={14} />
            <span className="truncate">{player.team}</span>
            <ClassBadge cls={player.cls} />
            <span className="shrink-0 text-ink-muted">· {seasonLabel(season.year)}</span>
          </div>
          {detail && <div className="mt-0.5 truncate text-[12px] text-ink-muted">{detail}</div>}
        </div>
      </header>

      <section className="border-t border-hairline px-4 py-2.5">
        <h3 className="mb-2 flex items-baseline justify-between text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
          <span>Impact</span>
          {season.estimated && <span className="normal-case tracking-normal">Estimated from the box score</span>}
        </h3>
        {/* Four tracks even without eWins, so EPM never moves when the season changes. */}
        <div className="grid grid-cols-4 gap-2">
          {IMPACT_KEYS.filter((k) => k !== "ewins" || season.hasEwins).map((k) => {
            const st = playerStat(k);
            if (!st) return <span key={k} />;
            const v = player.s[st.field] as number | null;
            return (
              <div key={k} className="flex flex-col items-start gap-1">
                <span className="text-[10.5px] text-ink-muted">{st.label}</span>
                <span className={`text-[15px] leading-none tabular ${k === "epm" ? "font-semibold text-ink" : "text-ink-soft"}`}>
                  {st.format(v)}
                </span>
                <PercentileChip pct={st.pctKey ? (player.pct[st.pctKey] ?? null) : null} className="min-w-[26px] px-1 py-[2px] text-[10.5px]" />
              </div>
            );
          })}
        </div>
      </section>

      <StatList title="Strongest" rows={strongest} player={player} />
      {weakest.length > 0 && <StatList title="Weakest" rows={weakest} player={player} />}

      <div className="flex items-center gap-4 border-t border-hairline px-4 py-2.5 text-[12px] text-ink-muted">
        {line.map(([label, v]) => (
          <span key={label} className="tabular">
            <span className="text-ink">{v == null ? "–" : v.toFixed(1)}</span> {label}
          </span>
        ))}
        <span className="ml-auto tabular">{player.s.games ?? 0} GP</span>
      </div>
    </>
  );
}

function StatList({ title, rows, player }: { title: string; rows: Array<{ st: PlayerStat; pct: number }>; player: Player }) {
  return (
    <section className="border-t border-hairline px-4 py-2.5">
      <h3 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-muted">{title}</h3>
      <ul className="grid gap-[5px]">
        {rows.map(({ st, pct }) => (
          <li key={st.key} className="grid grid-cols-[minmax(0,1fr)_auto_40px] items-center gap-3 text-[12.5px]">
            <span className="truncate text-ink-soft" title={st.desc}>{st.label}</span>
            <span className="text-ink tabular">{st.format(player.s[st.field] as number | null)}</span>
            <span className="flex justify-end">
              <PercentileChip pct={pct} className="min-w-[34px] text-[11px]" />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
