import Link from "next/link";
import { TeamLogo } from "@/components/team-logo";
import { SeasonSwitcher } from "@/components/teams/season-switcher";
import { NationalRanks } from "@/components/teams/national-ranks";
import { SortableSeasonsTable } from "@/components/teams/sortable-seasons-table";
import { SortableRosterTable } from "@/components/teams/sortable-roster-table";
import { DistributionPanel, type DistributionRank } from "@/components/teams/distribution-panel";
import { ScheduleTicker } from "@/components/teams/schedule-ticker";
import { FindGameTrigger } from "@/components/teams/find-game-trigger";
import { TourneyTimeline } from "@/components/teams/tourney-timeline";
import { PlayerHeadshotStrip } from "@/components/teams/player-headshot-strip";
import type { StaticPlayerRow, StaticTeamSeasonRow, ConfRecord, GameLog } from "@/lib/static-data";
import { confMultiplier, topTeamMultiplier, top5Tier1Multiplier, top3InConfMultiplier } from "@/lib/conf-tiers";
import { confDisplay } from "@/lib/conf-display";
import { getTeamColors } from "@/lib/team-colors";

function fmtNum(x: number | null, digits = 1): string {
  if (x === null || x === undefined) return "—";
  return x.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function seasonLabel(y: number): string {
  return `${(y - 1).toString().slice(-2)}-${y.toString().slice(-2)}`;
}
function coachSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
function fromEnd(row: Array<string | number | null> | null, offset: number): number | null {
  if (!row || row.length <= offset) return null;
  const v = row[row.length - 1 - offset];
  if (typeof v === "number") return v;
  if (typeof v === "string") { const n = Number(v); return Number.isFinite(n) ? n : null; }
  return null;
}
function pctFromIdx(row: Array<string | number | null> | null, idx: number): number | null {
  if (!row || row.length <= idx) return null;
  const v = row[idx];
  if (typeof v === "number") return v;
  if (typeof v === "string") { const n = Number(v); return Number.isFinite(n) ? n : null; }
  return null;
}

type RosterEntry = {
  id: number;
  bart_player_id: number | null;
  name: string;
  class: string | null;
  height: string | null;
  hometown: string | null;
  pts: number | null;
  reb: number | null;
  ast: number | null;
  fg3_pct: number | null;
  ft_pct: number | null;
  pir: number | null;
  bta_portg: number | null;
};

// Cache PIR + BTA PRTG per (year, player.id) across team-page generations.
// Computed once per year from the full D-I cohort the first time any team
// page that year is built; reused for the other ~365 teams that share the
// same cohort.
const yearMetricsCache = new Map<number, Map<number, { pir: number | null; bta_portg: number | null }>>();

function computeYearMetrics(players: StaticPlayerRow[], year: number) {
  const cached = yearMetricsCache.get(year);
  if (cached) return cached;

  type Mid = { id: number; pir: number | null; porpag: number | null; conference: string | null; team_name: string | null; eligible: boolean };
  const mids: Mid[] = players.map((p) => {
    const row = p.player_bart_stats?.raw_row ?? null;
    const games = p.player_bart_stats?.games ?? null;
    const mins = pctFromIdx(row, 54);
    const pts = fromEnd(row, 3);
    const reb = fromEnd(row, 7);
    const ast = fromEnd(row, 6);
    const stl = fromEnd(row, 5);
    const blk = fromEnd(row, 4);
    const missedFg = pctFromIdx(row, 52);
    const missedFt = pctFromIdx(row, 44);
    const porpag = pctFromIdx(row, 28);
    const team = Array.isArray(p.teams) ? p.teams[0] : p.teams;
    const conference = team?.conference ?? null;
    const team_name = team?.name ?? null;
    const eligible = !((games ?? 0) < 8 && (mins ?? 0) < 10 && (pts ?? 0) < 3);
    const pir = (pts !== null && reb !== null && ast !== null && stl !== null && blk !== null)
      ? pts + reb + ast + stl + blk - (missedFg ?? 0) - (missedFt ?? 0)
      : null;
    return { id: p.id, pir, porpag, conference, team_name, eligible };
  });

  const pirVals: number[] = [];
  const porVals: number[] = [];
  for (const m of mids) {
    if (!m.eligible) continue;
    if (typeof m.pir === "number") pirVals.push(m.pir);
    if (typeof m.porpag === "number") porVals.push(m.porpag);
  }
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const sd = (a: number[], mu: number) => Math.sqrt(a.reduce((s, v) => s + (v - mu) ** 2, 0) / a.length);
  const pMu = pirVals.length ? mean(pirVals) : 0;
  const pSd = pirVals.length ? sd(pirVals, pMu) : 0;
  const oMu = porVals.length ? mean(porVals) : 0;
  const oSd = porVals.length ? sd(porVals, oMu) : 0;

  const out = new Map<number, { pir: number | null; bta_portg: number | null }>();
  for (const m of mids) {
    let bta: number | null = null;
    if (m.eligible) {
      const zs: number[] = [];
      if (typeof m.pir === "number" && pSd > 0) zs.push(((m.pir - pMu) / pSd) * 0.69);
      if (typeof m.porpag === "number" && oSd > 0) zs.push((m.porpag - oMu) / oSd);
      if (zs.length > 0) {
        const raw = (zs.reduce((s, v) => s + v, 0) / zs.length) * 20;
        bta =
          raw
          * confMultiplier(m.conference)
          * topTeamMultiplier(m.team_name)
          * top5Tier1Multiplier(m.team_name)
          * top3InConfMultiplier(m.team_name);
      }
    }
    out.set(m.id, { pir: m.pir, bta_portg: bta });
  }
  yearMetricsCache.set(year, out);
  return out;
}


export function buildRoster(players: StaticPlayerRow[], teamId: number, year: number): RosterEntry[] {
  const metrics = computeYearMetrics(players, year);
  return players
    .filter((p) => {
      const team = Array.isArray(p.teams) ? p.teams[0] : p.teams;
      return team?.id === teamId;
    })
    .map((p): RosterEntry => {
      const row = p.player_bart_stats?.raw_row ?? null;
      const m = metrics.get(p.id);
      return {
        id: p.id,
        bart_player_id: p.bart_player_id,
        name: p.name,
        class: p.class,
        height: p.height,
        hometown: p.hometown,
        pts: fromEnd(row, 3),
        reb: fromEnd(row, 7),
        ast: fromEnd(row, 6),
        fg3_pct: pctFromIdx(row, 21),
        ft_pct: pctFromIdx(row, 15),
        pir: m?.pir ?? null,
        bta_portg: m?.bta_portg ?? null,
      };
    })
    .sort((a, b) => (b.bta_portg ?? -Infinity) - (a.bta_portg ?? -Infinity));
}

export function TeamPageView({
  team,
  current,
  roster,
  slug,
  rankedPlayerIds,
  confRecords,
  shootingRanks,
  fourFactorRanks,
  scheduleGames,
}: {
  team: { name: string; seasons: StaticTeamSeasonRow[] };
  current: StaticTeamSeasonRow;
  roster: RosterEntry[];
  slug: string;
  rankedPlayerIds: Set<number>;
  confRecords: Map<number, ConfRecord>;
  shootingRanks: DistributionRank[];
  fourFactorRanks: DistributionRank[];
  scheduleGames: GameLog[];
}) {
  const teamColors = getTeamColors(team.name);
  const accentColor = teamColors?.primary ?? null;
  // CSS vars set on the page wrapper let any descendant theme its hover
  // states without prop-drilling. --accent is the full color (for text +
  // border), --accent-tint is a low-alpha background suitable for row
  // hovers. Always set; fall back to coral for unthemed teams.
  const cssVars: React.CSSProperties = {
    ["--accent" as string]: accentColor ?? "#ed5a4f",
    ["--accent-tint" as string]: accentColor ? `${accentColor}1a` : "rgba(237, 90, 79, 0.08)",
  };

  const currentTrank = current.team_trank_stats;
  const currentCbb = current.team_cbba_stats;
  // Newest season first — team.seasons already comes that way from the export.
  const chronological = [...team.seasons];

  // Average BTA Rank over the last 5 seasons (newest first in team.seasons).
  const last5 = team.seasons.slice(0, 5);
  const last5Ranks = last5.map((s) => s.bta_rank).filter((r): r is number => typeof r === "number");
  const avgRank = last5Ranks.length > 0
    ? Math.round(last5Ranks.reduce((a, b) => a + b, 0) / last5Ranks.length)
    : null;

  return (
    <div style={cssVars}>
      {/* Hero */}
      <section>
        <div className="mx-auto max-w-7xl px-6 lg:px-10 pt-10 pb-8">
          <div className="flex flex-wrap items-center gap-6 lg:gap-10">
            <TeamLogo name={current.name} size={96} className="rounded-md" />
            <div className="flex-1 min-w-0">
              <div
                className="flex items-center gap-3 text-xs uppercase tracking-[0.18em] font-medium mb-3"
                style={accentColor ? { color: accentColor } : undefined}
              >
                <span
                  className={accentColor ? "h-px w-8" : "h-px w-8 bg-coral"}
                  style={accentColor ? { background: accentColor } : undefined}
                />
                <span className={accentColor ? "inline-flex items-center" : "inline-flex items-center text-coral"}>
                  {confDisplay(current.conference)} ·{" "}
                  <SeasonSwitcher
                    slug={slug}
                    currentYear={current.year}
                    years={team.seasons.map((s) => s.year)}
                  />
                </span>
              </div>
              <div className="flex items-baseline gap-3 md:gap-4 flex-wrap">
                <h1 className="font-display text-4xl md:text-6xl tracking-tight text-ink leading-none">
                  {current.name}
                </h1>
                {current.bta_rank !== null && current.bta_rank !== undefined && (
                  <span
                    className="inline-flex items-baseline gap-1 px-3 py-1.5 rounded-md text-white font-display text-xl md:text-2xl tabular leading-none shadow-sm"
                    style={accentColor ? { background: accentColor, color: teamColors?.onPrimary ?? "#fff" } : { background: "var(--color-coral, #ed5a4f)" }}
                    title={`BTA Rank for ${seasonLabel(current.year)}`}
                  >
                    <span className="text-[0.6em] opacity-80 uppercase tracking-widest mr-0.5">BTA</span>
                    #{current.bta_rank}
                  </span>
                )}
              </div>
              <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-2 text-ink-soft">
                <span className="tabular text-2xl text-ink">{currentTrank?.record ?? "—"}</span>
                {avgRank !== null && last5Ranks.length > 1 && (
                  <span className="text-sm text-ink-muted">
                    Avg BTA Rank, last {last5Ranks.length} seasons: #{avgRank}
                  </span>
                )}
                {(() => {
                  // The team-seasons export only fills `coach` for the current
                  // year; historical seasons rely on the coach-history lookup
                  // we already thread through via confRecords. Fall back to
                  // that so /teams/<slug>/<year> pages show the coach too.
                  const coachName = current.coach ?? confRecords.get(current.year)?.coachName ?? null;
                  if (!coachName) return null;
                  return (
                    <span className="text-sm text-ink-muted">
                      Coach:{" "}
                      <Link
                        href={`/coaches/${coachSlug(coachName)}/`}
                        className={
                          accentColor
                            ? "text-[color:var(--accent)] hover:opacity-80 transition-opacity"
                            : "text-ink hover:text-coral transition-colors"
                        }
                      >
                        {coachName}
                      </Link>
                    </span>
                  );
                })()}
                <FindGameTrigger
                  teamId={current.id}
                  teamName={team.name}
                  defaultYear={current.year}
                />
              </div>
            </div>
          </div>

          {scheduleGames.length > 0 && (
            <div className="mt-8">
              <ScheduleTicker games={scheduleGames} teamName={team.name} />
            </div>
          )}

          {/* NCAA Tournament timeline — parked. Component still imported so
              re-enabling is one line change. Keeping the data flow (confRecords
              already carries tourneyRound/tourneySeed) ready. */}
          {false && team.name === "Kansas" && confRecords.size > 0 && (
            <div className="mt-4">
              <TourneyTimeline
                history={confRecords}
                startYear={2013}
                endYear={current.year}
              />
            </div>
          )}

          {current.national_ranks && (current.national_ranks.top.length > 0 || current.national_ranks.bottom.length > 0) ? (
            <div className="mt-8">
              <NationalRanks
                top={current.national_ranks.top}
                bottom={current.national_ranks.bottom}
                total={current.national_ranks.top[0]?.total ?? current.national_ranks.bottom[0]?.total ?? 0}
              />
            </div>
          ) : (
            <div className="mt-8 grid grid-cols-2 md:grid-cols-3 gap-px bg-hairline border border-hairline rounded-lg overflow-hidden">
              <StatTile label="Adj ORtg" value={fmtNum(currentTrank?.adjoe ?? null, 1)} sub="points per 100" />
              <StatTile label="Adj DRtg" value={fmtNum(currentTrank?.adjde ?? null, 1)} sub="points per 100 (allowed)" />
              <StatTile label="Adj Tempo" value={fmtNum(currentTrank?.adjt ?? null, 1)} sub="possessions / 40 min" />
            </div>
          )}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 lg:px-10 mt-6 grid grid-cols-1 lg:grid-cols-2 gap-8">
        <DistributionPanel title="Shooting" ranks={shootingRanks} />
        <DistributionPanel title="Four Factors" ranks={fourFactorRanks}>
          {current.four_factor_record && current.four_factor_record.games > 0 && (
            <>
              <div className="text-xs uppercase tracking-widest text-ink-muted font-medium mb-1">
                Record when all three positive
              </div>
              <div className="flex items-baseline gap-3">
                <span className="font-display text-5xl text-ink tabular leading-none">
                  {current.four_factor_record.wins}-{current.four_factor_record.losses}
                </span>
                <span className="text-xs text-ink-muted">
                  {`across ${current.four_factor_record.games} game${current.four_factor_record.games === 1 ? "" : "s"} where REB Diff > 0, FBP Diff > 0, 3PM Diff > 0`}
                </span>
              </div>
            </>
          )}
        </DistributionPanel>
      </section>

      <section className="mx-auto max-w-7xl px-6 lg:px-10 mt-8">
        <div className="flex items-baseline justify-between mb-6">
          <h2 className="font-display text-3xl text-ink">Roster — {seasonLabel(current.year)}</h2>
          <span className="text-xs uppercase tracking-widest text-ink-muted">
            {roster.length} players · click headers to sort
          </span>
        </div>
        {/* Player headshot strip — faces + names before the spreadsheet. */}
        {roster.length > 0 && (
          <div className="mb-5">
            <PlayerHeadshotStrip players={roster} rankedPlayerIds={rankedPlayerIds} />
          </div>
        )}
        {roster.length === 0 ? (
          <p className="text-ink-muted text-sm">No roster data for this season.</p>
        ) : (
          <SortableRosterTable roster={roster} rankedPlayerIds={rankedPlayerIds} />
        )}
      </section>

      {/* BY SEASON — headline ledger. Mirrors the coach page's "Season by
          season" treatment so cross-page recognition is consistent. */}
      <section className="mx-auto max-w-7xl px-6 lg:px-10 mt-12 mb-20">
        <div className="bg-card border border-ink/10 rounded-xl shadow-md overflow-hidden ring-1 ring-ink/5">
          {/* Top accent rule — coral bar marks this table as the headline. */}
          <div
            className="h-1 w-full"
            style={{
              backgroundImage: accentColor
                ? `linear-gradient(to right, var(--accent), var(--accent), color-mix(in srgb, var(--accent) 60%, transparent))`
                : "linear-gradient(to right, var(--color-coral), var(--color-coral), color-mix(in srgb, var(--color-coral) 60%, transparent))",
            }}
          />
          <div className="px-5 lg:px-7 py-5 lg:py-6 border-b border-hairline bg-paper-deep/30 flex items-end justify-between gap-3">
            <div>
              <div className="text-[0.6rem] uppercase tracking-[0.18em] font-bold mb-1.5 flex items-center gap-2"
                   style={{ color: accentColor ?? undefined }}>
                <span className="h-px w-6" style={{ backgroundColor: accentColor ?? "var(--color-coral)" }} />
                Full record
              </div>
              <h2 className="font-display text-3xl lg:text-4xl text-ink leading-none tracking-tight">By season</h2>
            </div>
            <span className="text-xs tabular text-ink-muted whitespace-nowrap">
              <span className="font-display text-2xl text-ink tabular leading-none">{chronological.length}</span>{" "}
              {chronological.length === 1 ? "season" : "seasons"}
            </span>
          </div>
          <SortableSeasonsTable
            seasons={chronological}
            currentYear={current.year}
            slug={slug}
            confRecords={confRecords}
            accentColor={accentColor}
          />
        </div>
      </section>
    </div>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-paper/70 px-5 py-4">
      <div className="text-xs uppercase tracking-widest text-ink-muted font-medium">{label}</div>
      <div className="font-display text-3xl text-ink tabular mt-1">{value}</div>
      {sub && <div className="text-xs text-ink-muted mt-1">{sub}</div>}
    </div>
  );
}
