import type { PlayerRanksSeason } from "@/lib/static-data";
import { STAT_META, fmtValue } from "./where-they-rank";
import { StatInfo } from "./stat-info";
import { PercentileChip } from "@/components/percentile-chip";

/**
 * Categorized stats grid for a player-season. Each row shows the stat label,
 * the player's raw value, and a percentile chip colored along a red→neutral
 * →emerald gradient. Mirrors the style of CBB Analytics' "Player Statistics"
 * panel, but cohorted by year × G/F/C bucket per our ranks pipeline.
 *
 * Stats are pulled from PlayerRanksSeason — rows with no ranked value are
 * skipped (cohort too small for that stat, value missing, etc).
 */

const PANELS: Array<{ title: string; keys: string[] }> = [
  {
    title: "Box Score",
    keys: ["pts_pg", "reb_pg", "ast_pg", "stl_pg", "blk_pg", "pir", "bta_portg"],
  },
  {
    title: "Shooting",
    keys: ["efg_pct", "ts_pct", "fg2_pct", "fg3_pct", "ft_pct", "ftr"],
  },
  {
    title: "Advanced",
    keys: ["usage", "ortg", "ast_pct", "tov_pct", "orb_pct", "drb_pct", "blk_pct", "stl_pct", "hkm_pct", "porpag"],
  },
];

// Definitions for the obscure-ish stats. Only stats with an entry here render
// an info popover; the common per-game counters (PTS/G, REB/G, etc.) don't.
const STAT_DEFS: Record<string, string> = {
  pir: "Performance Index Rating — EuroLeague's per-game shorthand: PTS + REB + AST + STL + BLK − missed FG − missed FT.",
  bta_portg: "Beyond the Arc Production Rating. Blends PIR and PORPAG into a single z-score, then adjusts for conference tier and team strength.",
  hkm_pct: "Hakeem Percentage — BLK% + STL%. Named for Hakeem Olajuwon, who excelled at both ends.",
  porpag: "Points Over Replacement Per Adjusted Game (Bart Torvik). Per-game value above a replacement-level player at the same position.",
  efg_pct: "Effective Field Goal % — adjusts FG% so a 3-pointer counts 1.5× a 2-pointer.",
  ts_pct: "True Shooting % — points per scoring attempt, weighting 2s, 3s, and free throws together.",
  usage: "Usage Rate — share of team possessions that end with this player's shot, turnover, or trip to the line.",
  ortg: "Offensive Rating — points produced per 100 individual possessions.",
  orb_pct: "Offensive Rebound % — share of available offensive rebounds the player grabs while on the floor.",
  drb_pct: "Defensive Rebound % — share of available defensive rebounds the player grabs while on the floor.",
  ast_pct: "Assist Rate — share of teammates' field goals the player assisted on while on the floor.",
  tov_pct: "Turnover Rate — share of possessions ending in this player's turnover. Lower is better.",
  blk_pct: "Block % — share of opponent 2-point attempts blocked while on the floor.",
  stl_pct: "Steal % — share of opponent possessions ending in this player's steal.",
  ftr: "FT Rate — free throw attempts per field goal attempt; how often the player gets to the line.",
};

export function PlayerStatsGrid({ season }: { season: PlayerRanksSeason }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-hairline border border-hairline rounded-lg overflow-hidden">
      {PANELS.map((p) => (
        <StatPanel key={p.title} title={p.title} keys={p.keys} season={season} />
      ))}
    </div>
  );
}

function StatPanel({
  title, keys, season,
}: {
  title: string;
  keys: string[];
  season: PlayerRanksSeason;
}) {
  const rows = keys
    .map((k) => {
      const cell = season.stats[k];
      const meta = STAT_META[k];
      if (!cell || !meta) return null;
      return { key: k, label: meta.label, format: meta.format, value: cell.value, percentile: cell.percentile };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  return (
    <div className="bg-card p-5 lg:p-6">
      <h3 className="text-xs uppercase tracking-widest text-coral font-bold mb-4">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">No data.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.key} className="flex items-center gap-3">
              <span className="flex-1 text-sm text-ink-soft inline-flex items-center gap-1.5">
                {r.label}
                {STAT_DEFS[r.key] && <StatInfo definition={STAT_DEFS[r.key]!} />}
              </span>
              <span className="text-sm tabular text-ink font-medium w-14 text-right">{fmtValue(r.value, r.format)}</span>
              <PercentileChip pct={r.percentile} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

