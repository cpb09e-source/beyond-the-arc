import { PCT_KEYS, type PctKey } from "@/lib/player-cohort";
import { playerStatColumn, type PlayerSummary } from "@/lib/players";
import { playerViewByKey, playerViewKeys } from "@/lib/player-views";
import type { Player } from "~/data/player-model";
import type { Column } from "~/table/data-table";
import { StatCell } from "~/table/stat-cell";
import { signed1 } from "~/ui/format";

/**
 * The site's Overview view, column for column.
 *
 * NOT A LIST WRITTEN HERE. The keys, labels, descriptions and formats come from
 * src/lib/player-views.ts and src/lib/players.ts, the same definitions the
 * site's Player Explorer renders, so a column renamed there is renamed here.
 */
export const OVERVIEW_KEYS: string[] = playerViewKeys(playerViewByKey("overview"));

/** Fewer turnovers is better; the site's percentile pass inverts these two. */
const LOWER_BETTER = new Set<string>(["tov_pct", "tov_pg"]);
/** Impact is centered on zero, so its sign carries meaning. */
const SIGNED = new Set<string>(["epm", "off_epm", "def_epm", "on_off", "box_epm"]);

export type PlayerStat = {
  key: string;
  label: string;
  desc: string;
  field: keyof PlayerSummary;
  pctKey: PctKey | null;
  format: (v: number | null) => string;
  lowerBetter: boolean;
};

export function playerStat(key: string): PlayerStat | null {
  const def = playerStatColumn(key);
  if (!def) return null;
  const field = def.field;
  const pctKey = (PCT_KEYS as readonly string[]).includes(field as string) ? (field as PctKey) : null;
  const format = (v: number | null): string => {
    if (v == null) return "–";
    if (def.format === "pct1") return (v * 100).toFixed(1);
    if (def.format === "num2") return v.toFixed(2);
    return SIGNED.has(key) ? signed1(v) : v.toFixed(1);
  };
  return { key, label: def.label, desc: def.desc, field, pctKey, format, lowerBetter: LOWER_BETTER.has(field as string) };
}

export const OVERVIEW_STATS: PlayerStat[] = OVERVIEW_KEYS.map(playerStat).filter((s): s is PlayerStat => s !== null);

export function statColumns(): Column<Player>[] {
  return OVERVIEW_STATS.map((st) => ({
    key: st.key,
    label: st.label,
    title: st.desc,
    // Wide enough for the uppercase label and the sort arrow together, so no
    // header ever truncates to "OFF E…" the moment it becomes the sort.
    width: Math.max(58, Math.round(st.label.length * 7.7) + 34),
    align: "right",
    first: st.lowerBetter ? 1 : -1,
    sortValue: (p) => p.s[st.field] as number | null,
    cell: (p) => (
      <StatCell
        value={st.format(p.s[st.field] as number | null)}
        pct={st.pctKey ? p.pct[st.pctKey] : null}
        strong={st.key === "epm"}
      />
    ),
  }));
}
