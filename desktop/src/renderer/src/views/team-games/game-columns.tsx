import { seasonPercentiles, teamGameStat, type TeamGamePack, type TeamGameStat } from "@/lib/team-game-index";
import type { TeamGame } from "~/data/team-game-model";
import type { Column } from "~/table/data-table";
import { StatCell } from "~/table/stat-cell";
import { signed1 } from "~/ui/format";

/**
 * The stat columns of a Team Game Log view.
 *
 * NOT A LIST WRITTEN HERE. The keys come from the site's TEAM_GAME_VIEWS, and
 * each column's label, description, getter, direction and whether it carries a
 * chip come from TEAM_GAME_STATS. The chip's percentile is the site's
 * seasonPercentiles: every game of the season, never the rows a shortcut left.
 */

/** Margins read with their sign: +18 and −7 are the point of the column. */
const SIGNED = new Set(["net", "margin", "reb_dif", "ast_dif", "stl_dif", "blk_dif", "tov_dif", "fg3m_dif"]);

/**
 * Chips in the ramp's middle band. How fast a game was, or how many
 * possessions it had, is unusual or ordinary, never good or bad.
 */
export const NEUTRAL_PCT = new Set(["pace", "poss"]);

const MINUS = "−";

/** A cell's text. The header carries the %, so a percentage cell does not repeat it. */
export function fmtStat(st: TeamGameStat, v: number | null): string {
  if (v == null) return "–";
  if (st.fmt === "pct1") return (v * 100).toFixed(1);
  if (st.fmt === "num1") return SIGNED.has(st.key) ? signed1(v) : v.toFixed(1);
  const n = Math.round(v);
  if (!SIGNED.has(st.key) || n === 0) return String(n);
  return `${n > 0 ? "+" : MINUS}${Math.abs(n)}`;
}

/**
 * `chips: false` is the plain log a team's page shows: the numbers alone, in
 * narrower columns, with no percentile ranked at all.
 */
export function statColumns(pack: TeamGamePack, keys: string[], { chips = true }: { chips?: boolean } = {}): Column<TeamGame>[] {
  const out: Column<TeamGame>[] = [];
  for (const key of keys) {
    const st = teamGameStat(key);
    if (!st) continue;
    // Ranked once per pack and stat, then cached by the site's function.
    const pct = !chips || st.pct === false ? null : seasonPercentiles(pack, st);
    out.push({
      key: st.key,
      label: st.label,
      title: st.title,
      width: chips ? Math.max(58, Math.round(st.label.length * 7.7) + 34) : Math.max(50, Math.round(st.label.length * 7.7) + 26),
      align: "right",
      first: st.lowerBetter ? 1 : -1,
      sortValue: (g) => st.get(g.row),
      cell: (g) =>
        !chips ? (
          <span className={`whitespace-nowrap tabular ${st.key === "net" ? "font-semibold text-ink" : "text-ink-soft"}`}>{fmtStat(st, st.get(g.row))}</span>
        ) : (
        <StatCell
          value={fmtStat(st, st.get(g.row))}
          pct={pct ? (pct.get(g.idx) ?? null) : null}
          strong={st.key === "net"}
          neutral={NEUTRAL_PCT.has(st.key)}
        />
      ),
    });
  }
  return out;
}
