import { confDisplay } from "@/lib/conf-display";
import { nationalRanksForTeam } from "@/lib/national-ranks";
import { logoIdMap, toScatterTeams, type ScatterSourceRow } from "@/lib/scatter-team";
import type { RankedStat, StaticTeamSeasonRow } from "@/lib/static-data";
import { buildZone, type Zone } from "@/lib/trapezoid";
import cbbTeams from "@/data/cbb-team-ids.json";

/**
 * A team-season as the app handles it: the numbers a table cell or a Peek needs,
 * read once, plus the raw row for anything computed on demand.
 *
 * EVERY DERIVED VALUE COMES FROM THE SITE'S OWN MODULES. National ranks are the
 * site's nationalRanksForTeam, the contender zone is the site's trapezoid, and
 * the net rating it tests has already been through the rating-trust gate inside
 * toScatterTeams. Nothing here re-derives a number the site already defines.
 */

export type Team = {
  id: number;
  name: string;
  conf: string;
  confLabel: string;
  wins: number;
  losses: number;
  btaRank: number | null;
  logoId: number | null;
  /** BTA's own opponent-adjusted ratings: the same columns the site's team pages rank. */
  adjO: number | null;
  adjD: number | null;
  adjNet: number | null;
  tempo: number | null;
  efg: number | null;
  efgDef: number | null;
  tov: number | null;
  orb: number | null;
  fg3: number | null;
  sos: number | null;
  /** null when the season cannot draw the zone at all (net rating withheld). */
  inZone: boolean | null;
  row: StaticTeamSeasonRow;
};

export type Season = {
  year: number;
  teams: Team[];
  zone: Zone | null;
  cohort: StaticTeamSeasonRow[];
};

const LOGOS = logoIdMap(cbbTeams as Record<string, { id: number }>);

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function shapeSeason(year: number, rows: StaticTeamSeasonRow[]): Season {
  const scatter = toScatterTeams(rows as unknown as ScatterSourceRow[], LOGOS);
  const zone = buildZone(scatter);
  const byName = new Map(scatter.map((t) => [t.name, t]));

  const teams: Team[] = [];
  for (const row of rows) {
    const r = row as unknown as Record<string, unknown>;
    const tr = (r.team_trank_stats ?? {}) as Record<string, unknown>;
    const ss = (r.team_season_stats ?? {}) as Record<string, unknown>;
    // Same admission rule as the scatter: a row without an adjusted offense
    // exists in the corpus without having played a Division I season.
    if (typeof tr.adjoe !== "number") continue;
    const s = byName.get(String(r.name));
    const conf = typeof r.conference === "string" ? r.conference : "";

    teams.push({
      id: Number(r.id),
      name: String(r.name),
      conf,
      confLabel: confDisplay(conf),
      wins: num(tr.wins) ?? 0,
      losses: num(tr.losses) ?? 0,
      btaRank: num(r.bta_rank),
      logoId: s?.id ?? null,
      adjO: num(ss.a_ortg),
      adjD: num(ss.a_drtg),
      adjNet: num(ss.a_net),
      tempo: num(tr.adjt),
      efg: num(ss.efg_pct),
      efgDef: num(ss.efg_pct_def),
      tov: num(ss.tov_pct),
      orb: num(ss.orb_pct),
      fg3: num(ss.fg3_pct),
      sos: num(ss.sos),
      inZone: zone && s ? zone.contains(s.m.adjt, s.m.net_rtg_adj) : null,
      row,
    });
  }

  return { year, teams, zone, cohort: rows };
}

type Ranks = { top: RankedStat[]; bottom: RankedStat[] } | null;
const rankMemo = new WeakMap<StaticTeamSeasonRow, Ranks>();

/**
 * National ranks for one team, computed the first time it is peeked.
 *
 * On demand rather than up front: a season opens instantly, and the cost is
 * paid only for the teams someone actually looks at.
 */
export function ranksFor(season: Season, team: Team): Ranks {
  if (!rankMemo.has(team.row)) {
    rankMemo.set(team.row, nationalRanksForTeam(season.cohort, team.row, 5));
  }
  return rankMemo.get(team.row) ?? null;
}
