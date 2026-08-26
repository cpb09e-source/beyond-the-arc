/**
 * Turn a baked team-seasons file into the rows the By season grid renders.
 *
 * TWO JOBS, and the second one is the reason this is not inline in the page.
 *
 * 1. Join. The stat columns come from the bake; conference record, tournament
 *    finish, seed and coach come from readConfRecordsByTeam(), which the page
 *    already has open for other sections. Neither source has the other's
 *    fields.
 *
 * 2. Slim. The baked file carries every stat column and all 34 percentiles —
 *    ~21 KB for a team — because re-baking to add a column should never be
 *    necessary. But everything handed to a client component is serialised into
 *    the page's RSC payload, and this page is one of 5,009. So only the fields
 *    the grid actually renders cross that boundary: the totals and per-game
 *    figures named by the column model, and only the percentiles those columns
 *    key their chips to. Adding a column to team-grid-columns widens this
 *    automatically — there is no second list to keep in step.
 *
 *    Note team-grid-columns serves THIS grid only. The explorer keeps its own
 *    column definitions; changing one must not change the other.
 */
import { DEFAULT_COLS } from "@/lib/team-grid-columns";
import type { ConfRecord, TeamGridSeason } from "@/lib/static-data";
import type { SeasonGridRow } from "@/components/teams/season-grid";

/** Value keys the grid reads: each column's total, plus its per-game figure. */
const VAL_KEYS: string[] = [
  ...new Set(DEFAULT_COLS.flatMap((c) => [c.total as string, ...(c.perGame ? [c.perGame as string] : [])])),
];
/** Percentile keys the chips read. */
const PCT_KEYS: string[] = [...new Set(DEFAULT_COLS.map((c) => c.pct))];

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function toSeasonGridRows(
  baked: TeamGridSeason[],
  confRecords: Map<number, ConfRecord>,
  /** year -> this team's aNET rank that season, from netRanksForTeam(). */
  netRanks: Record<number, number> = {},
): SeasonGridRow[] {
  return baked.map((b) => {
    const cr = confRecords.get(b.team_year);
    const vals: Record<string, number | null> = {};
    for (const k of VAL_KEYS) vals[k] = num((b as Record<string, unknown>)[k]);
    const pct: Record<string, number | null> = {};
    for (const k of PCT_KEYS) pct[k] = num(b.pct?.[k]);
    return {
      year: b.team_year,
      teamName: b.team_name,
      conference: b.team_conference,
      record: b.record,
      // Rendered as "12-4". Both halves have to be present — a conference with
      // a win count but no loss count is not a record, it is a broken row.
      confRecord:
        cr && cr.wins !== null && cr.losses !== null ? `${cr.wins}-${cr.losses}` : null,
      tourneySeed: cr?.tourneySeed ?? null,
      coach: cr?.coachName ?? null,
      netRank: netRanks[b.team_year] ?? null,
      vals,
      pct,
    };
  });
}
