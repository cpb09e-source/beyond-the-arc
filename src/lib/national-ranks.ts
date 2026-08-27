/**
 * A team-season's national ranks, computed at build time.
 *
 * WHY NOT READ THE BAKED ONES. teams-all.json carries a `national_ranks` field
 * with the top five and bottom five already chosen, written by
 * attachNationalRanksToExport in scripts/export-static-data.mts. Changing that
 * five to eight means re-running the export, which reads from Supabase and is
 * therefore blocked by the data freeze — for a display detail.
 *
 * This is the same argument netRanksForTeam makes one file over: the ranks are
 * a pure function of teams-all.json, which every caller already has open, so
 * storing them means a data re-export to change how many are shown. Computed
 * here, the count is an argument.
 *
 * THE STAT LIST IS A COPY, deliberately. The export's RANKABLE cannot be
 * imported: that file pulls in the Supabase client at module scope. The two
 * must agree, and the labels here are the ones that render — which is also why
 * the "FTA Rate" alias the panel used to carry is gone, since this list says
 * FTAR directly.
 */
import type { StaticTeamSeasonRow, RankedStat } from "@/lib/static-data";

type RankableDef = {
  key: string;
  source: "trank" | "cbb";
  label: string;
  format: RankedStat["format"];
  higherBetter: boolean;
};

const RANKABLE: RankableDef[] = [
  // OURS, not Bart's. a_ortg / a_drtg come from build-adjusted-ratings.mjs and
  // validate against his T-Rank at r = 0.986 on net rating; `sos` is the same
  // file's net schedule strength, which replaced his win-probability figure so
  // the site carries one SOS rather than two in different units.
  { key: "a_ortg",        source: "cbb",   label: "Adj ORtg",     format: "num1",    higherBetter: true  },
  { key: "a_drtg",        source: "cbb",   label: "Adj DRtg",     format: "num1",    higherBetter: false },
  { key: "sos",           source: "cbb",   label: "SOS",          format: "num1",    higherBetter: true  },
  { key: "ts_pct",        source: "cbb",   label: "TS%",          format: "pct1",    higherBetter: true  },
  { key: "efg_pct",       source: "cbb",   label: "eFG%",         format: "pct1",    higherBetter: true  },
  { key: "fg3_pct",       source: "cbb",   label: "3P%",          format: "pct1",    higherBetter: true  },
  { key: "tov_pct",       source: "cbb",   label: "TOV%",         format: "pct1",    higherBetter: false },
  { key: "orb_pct",       source: "cbb",   label: "OREB%",        format: "pct1",    higherBetter: true  },
  { key: "fta_rate",      source: "cbb",   label: "FTAR",         format: "pct1",    higherBetter: true  },
  { key: "ast_pct",       source: "cbb",   label: "AST%",         format: "pct1",    higherBetter: true  },
  { key: "fbpts_pct",     source: "cbb",   label: "FB Pts %",     format: "pct1",    higherBetter: true  },
  { key: "pitp_pct",      source: "cbb",   label: "Paint Pts %",  format: "pct1",    higherBetter: true  },
  { key: "efg_pct_def",   source: "cbb",   label: "Opp eFG%",     format: "pct1",    higherBetter: false },
  { key: "tov_pct_def",   source: "cbb",   label: "Opp TOV%",     format: "pct1",    higherBetter: true  },
  { key: "orb_pct_def",   source: "cbb",   label: "Opp OREB%",    format: "pct1",    higherBetter: false },
  { key: "fg3_pct_def",   source: "cbb",   label: "Opp 3P%",      format: "pct1",    higherBetter: false },
  { key: "reb_diff",      source: "cbb",   label: "REB Diff",     format: "intDiff", higherBetter: true  },
  { key: "fbpts_diff",    source: "cbb",   label: "FB Pts Diff",  format: "intDiff", higherBetter: true  },
  { key: "fg3_made_diff", source: "cbb",   label: "3PM Diff",     format: "intDiff", higherBetter: true  },
  { key: "potov_diff",    source: "cbb",   label: "PO TOV Diff",  format: "intDiff", higherBetter: true  },
  { key: "pts_diff",      source: "cbb",   label: "Pts Diff",     format: "intDiff", higherBetter: true  },
];

function statValue(r: StaticTeamSeasonRow, def: RankableDef): number | null {
  const blob = def.source === "trank"
    ? (r.team_trank_stats as Record<string, number | null> | null)
    : (r.team_season_stats as Record<string, number | null> | null);
  const v = blob?.[def.key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Ranks for one season's cohort: stat key -> (team id -> rank), plus how many
 * teams had the stat at all.
 *
 * Cached per year. Every team page for a season asks the same question of the
 * same ~365 rows, and the cohort array is rebuilt per page, so keying on its
 * identity would never hit.
 */
const _cache = new Map<number, { ranks: Map<string, Map<number, number>>; totals: Map<string, number> }>();

function ranksForYear(cohort: StaticTeamSeasonRow[], year: number) {
  const hit = _cache.get(year);
  if (hit) return hit;
  const ranks = new Map<string, Map<number, number>>();
  const totals = new Map<string, number>();
  for (const def of RANKABLE) {
    const indexed: Array<{ id: number; v: number }> = [];
    for (const r of cohort) {
      const v = statValue(r, def);
      if (v !== null) indexed.push({ id: r.id, v });
    }
    if (indexed.length < 2) continue;
    indexed.sort((a, b) => (def.higherBetter ? b.v - a.v : a.v - b.v));
    const m = new Map<number, number>();
    indexed.forEach((x, i) => m.set(x.id, i + 1));
    ranks.set(def.key, m);
    totals.set(def.key, indexed.length);
  }
  const out = { ranks, totals };
  _cache.set(year, out);
  return out;
}

/**
 * The `n` stats this team ranks best at and the `n` it ranks worst at.
 *
 * Returns null when the cohort is too thin to rank anything, so the caller can
 * fall back rather than render two empty columns.
 */
export function nationalRanksForTeam(
  cohort: StaticTeamSeasonRow[],
  row: StaticTeamSeasonRow,
  n: number,
): { top: RankedStat[]; bottom: RankedStat[] } | null {
  const { ranks, totals } = ranksForYear(cohort, row.year);
  const collected: RankedStat[] = [];
  for (const def of RANKABLE) {
    const v = statValue(row, def);
    if (v === null) continue;
    const rank = ranks.get(def.key)?.get(row.id);
    const total = totals.get(def.key);
    if (!rank || !total) continue;
    collected.push({ key: def.key, label: def.label, format: def.format, value: v, rank, total });
  }
  if (collected.length === 0) return null;
  const asc = [...collected].sort((a, b) => a.rank - b.rank);
  return { top: asc.slice(0, n), bottom: [...asc].reverse().slice(0, n) };
}
