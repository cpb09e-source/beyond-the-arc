import Link from "next/link";
import { TeamLogo } from "@/components/team-logo";
import { TourneyBadge } from "@/components/tourney-badge";
import { SeasonSwitcher } from "@/components/teams/season-switcher";
import { NationalRanks } from "@/components/teams/national-ranks";
import type { StaticPlayerRow, StaticTeamSeasonRow } from "@/lib/static-data";

function fmtNum(x: number | null, digits = 1): string {
  if (x === null || x === undefined) return "—";
  return x.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function fmtPct(x: number | null, digits = 1): string {
  if (x === null || x === undefined) return "—";
  return (x * 100).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }) + "%";
}
function seasonLabel(y: number): string {
  return `${(y - 1).toString().slice(-2)}-${y.toString().slice(-2)}`;
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

  type Mid = { id: number; pir: number | null; porpag: number | null; conference: string | null; eligible: boolean };
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
    const eligible = !((games ?? 0) < 8 && (mins ?? 0) < 10 && (pts ?? 0) < 3);
    const pir = (pts !== null && reb !== null && ast !== null && stl !== null && blk !== null)
      ? pts + reb + ast + stl + blk - (missedFg ?? 0) - (missedFt ?? 0)
      : null;
    return { id: p.id, pir, porpag, conference, eligible };
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
      if (typeof m.pir === "number" && pSd > 0) zs.push((m.pir - pMu) / pSd);
      if (typeof m.porpag === "number" && oSd > 0) zs.push((m.porpag - oMu) / oSd);
      if (zs.length > 0) {
        const raw = (zs.reduce((s, v) => s + v, 0) / zs.length) * 20;
        const isPower = m.conference != null && POWER_CONFS.has(m.conference);
        bta = isPower ? raw : raw * 0.85;
      }
    }
    out.set(m.id, { pir: m.pir, bta_portg: bta });
  }
  yearMetricsCache.set(year, out);
  return out;
}

const POWER_CONFS = new Set(["ACC", "B10", "B12", "SEC"]);

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
}: {
  team: { name: string; seasons: StaticTeamSeasonRow[] };
  current: StaticTeamSeasonRow;
  roster: RosterEntry[];
  slug: string;
}) {
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

  const cbbExt = (currentCbb as unknown) as Record<string, number | null> | null;
  const rebDiff = cbbExt?.reb_diff ?? null;
  const fbptsDiff = cbbExt?.fbpts_diff ?? null;
  const fg3mDiff = cbbExt?.fg3_made_diff ?? null;

  return (
    <>
      {/* Hero */}
      <section className="border-b border-hairline">
        <div className="mx-auto max-w-7xl px-6 lg:px-10 pt-10 pb-8">
          <div className="flex flex-wrap items-center gap-6 lg:gap-10">
            <TeamLogo name={current.name} size={96} className="rounded-md" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-4 mb-3">
                <div className="flex items-center gap-3 text-xs uppercase tracking-[0.18em] text-coral font-medium">
                  <span className="h-px w-8 bg-coral" />
                  <span>{current.conference ?? "—"} · {seasonLabel(current.year)}</span>
                </div>
                <SeasonSwitcher
                  slug={slug}
                  currentYear={current.year}
                  years={team.seasons.map((s) => s.year)}
                />
              </div>
              <div className="flex items-baseline gap-3 md:gap-4 flex-wrap">
                <h1 className="font-display text-4xl md:text-6xl tracking-tight text-ink leading-none">
                  {current.name}
                </h1>
                {current.bta_rank !== null && current.bta_rank !== undefined && (
                  <span
                    className="inline-flex items-baseline gap-1 px-3 py-1.5 rounded-md bg-coral text-white font-display text-xl md:text-2xl tabular leading-none shadow-sm"
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
                {current.coach && (
                  <span className="text-sm text-ink-muted">
                    Coach: <span className="text-ink">{current.coach}</span>
                  </span>
                )}
              </div>
            </div>
          </div>

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
        <Card title="Shooting">
          <StatRow label="True Shooting %" value={fmtPct(currentCbb?.ts_pct ?? null)} />
          <StatRow label="Effective FG %"  value={fmtPct(currentCbb?.efg_pct ?? null)} />
          <StatRow label="3-Point %"        value={fmtPct(currentCbb?.fg3_pct ?? null)} />
          <StatRow label="3PA Rate"         value={fmtPct(currentCbb?.fg3a_rate ?? null)} sub="3PA / FGA" />
          <StatRow label="FTA Rate"         value={fmtPct(currentCbb?.fta_rate ?? null)} sub="FTA / FGA" />
          <StatRow label="Assist %"         value={fmtPct(currentCbb?.ast_pct ?? null)} sub="% of FGM assisted" />
        </Card>
        <Card title="Four Factors" subtitle="Beyond the Arc · season totals">
          <StatRow label="REB Diff" value={rebDiff !== null ? (rebDiff > 0 ? `+${rebDiff}` : String(rebDiff)) : "—"} sub="total rebounds vs allowed" />
          <StatRow label="OREB %"   value={fmtPct(currentCbb?.orb_pct ?? null)} sub="offensive rebound rate" />
          <StatRow label="FBP Diff" value={fbptsDiff !== null ? (fbptsDiff > 0 ? `+${fbptsDiff}` : String(fbptsDiff)) : "—"} sub="fast-break points vs allowed" />
          <StatRow label="3PM Diff" value={fg3mDiff !== null ? (fg3mDiff > 0 ? `+${fg3mDiff}` : String(fg3mDiff)) : "—"} sub="3-pointers made vs allowed" />

          {current.four_factor_record && current.four_factor_record.games > 0 && (
            <div className="pt-5 mt-3 border-t border-hairline">
              <div className="text-xs uppercase tracking-widest text-ink-muted font-medium mb-1">
                Record when all three positive
              </div>
              <div className="flex items-baseline gap-3">
                <span className="font-display text-5xl text-ink tabular leading-none">
                  {current.four_factor_record.wins}-{current.four_factor_record.losses}
                </span>
                <span className="text-xs text-ink-muted">
                  across {current.four_factor_record.games} game{current.four_factor_record.games === 1 ? "" : "s"} where
                  REB Diff &gt; 0, FBP Diff &gt; 0, 3PM Diff &gt; 0
                </span>
              </div>
            </div>
          )}
        </Card>
      </section>

      <section className="mx-auto max-w-7xl px-6 lg:px-10 mt-8">
        <h2 className="font-display text-3xl text-ink mb-6">By season</h2>
        <div className="bg-card border border-hairline rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-hairline text-left">
              <tr>
                <Th>Season</Th><Th>Conf</Th><Th>Record</Th>
                <Th align="right">BTA Rank</Th>
                <Th align="right">Adj ORtg</Th><Th align="right">Adj DRtg</Th>
                <Th align="right">Tempo</Th>
                <Th align="right">TS%</Th><Th align="right">eFG%</Th>
              </tr>
            </thead>
            <tbody>
              {chronological.map((s) => {
                const t = s.team_trank_stats;
                const c = s.team_cbba_stats;
                const isCurrent = s.year === current.year;
                return (
                  <tr
                    key={s.year}
                    className={`border-b border-hairline/60 hover:bg-paper-deep/50 transition-colors ${isCurrent ? "bg-paper-deep/40" : ""}`}
                  >
                    <Td>
                      <Link
                        href={`/teams/${slug}/${s.year}/`}
                        className="group inline-flex items-center gap-2.5 transition-colors"
                      >
                        <TeamLogo name={s.name} size={20} />
                        <span className="font-medium text-ink group-hover:text-coral transition-colors">{seasonLabel(s.year)}</span>
                        <TourneyBadge teamName={s.name} year={s.year} />
                      </Link>
                    </Td>
                    <Td className="text-ink-muted">{s.conference ?? "—"}</Td>
                    <Td className="tabular text-ink-muted">{t?.record ?? "—"}</Td>
                    <Td align="right" className="tabular text-coral">{s.bta_rank !== null ? `#${s.bta_rank}` : "—"}</Td>
                    <Td align="right" className="tabular">{fmtNum(t?.adjoe ?? null, 1)}</Td>
                    <Td align="right" className="tabular">{fmtNum(t?.adjde ?? null, 1)}</Td>
                    <Td align="right" className="tabular">{fmtNum(t?.adjt ?? null, 1)}</Td>
                    <Td align="right" className="tabular">{fmtPct(c?.ts_pct ?? null)}</Td>
                    <Td align="right" className="tabular">{fmtPct(c?.efg_pct ?? null)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 lg:px-10 mt-8 mb-20">
        <div className="flex items-baseline justify-between mb-6">
          <h2 className="font-display text-3xl text-ink">Roster — {seasonLabel(current.year)}</h2>
          <span className="text-xs uppercase tracking-widest text-ink-muted">
            {roster.length} players, sorted by BTA PRTG
          </span>
        </div>
        {roster.length === 0 ? (
          <p className="text-ink-muted text-sm">No roster data for this season.</p>
        ) : (
          <div className="bg-card border border-hairline rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-hairline text-left">
                <tr>
                  <Th>Player</Th><Th>Cl</Th><Th>Ht</Th>
                  <Th align="right">BTA PRTG</Th><Th align="right">PIR</Th>
                  <Th align="right">PPG</Th><Th align="right">RPG</Th><Th align="right">APG</Th>
                  <Th align="right">3P%</Th><Th align="right">FT%</Th>
                </tr>
              </thead>
              <tbody>
                {roster.map((p) => (
                  <tr key={p.id} className="border-b border-hairline/60 hover:bg-paper-deep/50 transition-colors">
                    <Td>
                      {p.bart_player_id ? (
                        <Link href={`/players/${p.bart_player_id}`} className="font-medium text-ink hover:text-coral transition-colors">
                          {p.name}
                        </Link>
                      ) : (
                        <span className="font-medium text-ink">{p.name}</span>
                      )}
                    </Td>
                    <Td className="text-ink-muted">{p.class ?? "—"}</Td>
                    <Td className="text-ink-muted whitespace-nowrap">{p.height ?? "—"}</Td>
                    <Td align="right" className="tabular font-medium">{fmtNum(p.bta_portg, 1)}</Td>
                    <Td align="right" className="tabular">{fmtNum(p.pir, 1)}</Td>
                    <Td align="right" className="tabular">{fmtNum(p.pts, 1)}</Td>
                    <Td align="right" className="tabular">{fmtNum(p.reb, 1)}</Td>
                    <Td align="right" className="tabular">{fmtNum(p.ast, 1)}</Td>
                    <Td align="right" className="tabular">{fmtPct(p.fg3_pct)}</Td>
                    <Td align="right" className="tabular">{fmtPct(p.ft_pct)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-card px-5 py-4">
      <div className="text-xs uppercase tracking-widest text-ink-muted font-medium">{label}</div>
      <div className="font-display text-3xl text-ink tabular mt-1">{value}</div>
      {sub && <div className="text-xs text-ink-muted mt-1">{sub}</div>}
    </div>
  );
}
function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-hairline rounded-lg p-6">
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="font-display text-xl text-ink">{title}</h3>
        {subtitle && <span className="text-xs text-ink-muted">{subtitle}</span>}
      </div>
      <div className="divide-y divide-hairline/60">{children}</div>
    </div>
  );
}
function StatRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between py-2.5">
      <span className="text-ink-soft text-sm">
        {label}
        {sub && <span className="text-ink-muted text-xs ml-2">{sub}</span>}
      </span>
      <span className="font-medium text-ink tabular">{value}</span>
    </div>
  );
}
function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th className={`px-3 py-2 text-xs uppercase tracking-widest text-ink-muted font-medium ${align === "right" ? "text-right" : ""}`}>{children}</th>;
}
function Td({ children, align = "left", className = "" }: { children: React.ReactNode; align?: "left" | "right"; className?: string }) {
  return <td className={`px-3 py-2.5 ${align === "right" ? "text-right" : ""} ${className}`}>{children}</td>;
}
