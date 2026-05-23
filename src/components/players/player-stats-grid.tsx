import type { PlayerRanksSeason } from "@/lib/static-data";
import { STAT_META, fmtValue, type StatFormat } from "./where-they-rank";
import { StatInfo } from "./stat-info";
// (Local pctColor variants below — we don't use the chip's helper here so
// the player-overview heatmap can swap palettes per theme.)

/**
 * Editorial heatmap palette — DataGolf-inspired but with a middle yellow
 * band so mid-cohort stats register visually as "average" rather than
 * disappearing. Three tiers, each encoded as alpha against the page bg:
 *
 *   pct ≥ 67  → olive (forest-toned green, datagolf #3D9970)
 *   pct 34–66 → amber (warm yellow, datagolf #FFC107)
 *   pct ≤ 33  → tomato (warm red, datagolf #FF4136)
 *
 * Alpha grows with magnitude inside each band so the wash gets bolder
 * as you move toward an extreme. Light and dark themes use the same
 * colors but the dark variant pushes alpha higher so the tint registers
 * on the navy page bg.
 */
const OLIVE_RGB = "61, 153, 112";
const AMBER_RGB = "255, 193, 7";
const TOMATO_RGB = "255, 65, 54";

function pctBgStrong(pct: number | null): string {
  if (pct === null) return "transparent";
  if (pct >= 67) {
    // 67th → low alpha, 100th → max bold olive
    const alpha = 0.18 + ((pct - 67) / 33) * 0.47;
    return `rgba(${OLIVE_RGB}, ${alpha.toFixed(3)})`;
  }
  if (pct >= 34) {
    // Middle band: warm amber. Peaks at the band's center (50th pct)
    // and softens toward each edge so neighboring tiles don't compete.
    const dist = Math.abs(pct - 50) / 16;
    const alpha = 0.32 - dist * 0.12;
    return `rgba(${AMBER_RGB}, ${alpha.toFixed(3)})`;
  }
  // 33rd → low alpha, 0th → max bold tomato
  const alpha = 0.18 + ((33 - pct) / 33) * 0.32;
  return `rgba(${TOMATO_RGB}, ${alpha.toFixed(3)})`;
}

function pctBgStrongDark(pct: number | null): string {
  if (pct === null) return "transparent";
  // Same color regions, alpha bumped so the wash reads against navy.
  if (pct >= 67) {
    const alpha = 0.28 + ((pct - 67) / 33) * 0.5;
    return `rgba(${OLIVE_RGB}, ${alpha.toFixed(3)})`;
  }
  if (pct >= 34) {
    const dist = Math.abs(pct - 50) / 16;
    const alpha = 0.4 - dist * 0.14;
    return `rgba(${AMBER_RGB}, ${alpha.toFixed(3)})`;
  }
  const alpha = 0.28 + ((33 - pct) / 33) * 0.4;
  return `rgba(${TOMATO_RGB}, ${alpha.toFixed(3)})`;
}

function pctColorLight(pct: number): string {
  // Solid versions for the gauge arc + percentile number text. The
  // amber band gets a darker mustard so the chip reads on a yellow tile.
  if (pct >= 67) return `rgb(${OLIVE_RGB})`;
  if (pct >= 34) return "rgb(180, 130, 5)"; // dark mustard, reads on amber
  return `rgb(${TOMATO_RGB})`;
}
function pctColorDark(pct: number): string {
  // Lighter variants for visibility on dark navy tinted tiles.
  if (pct >= 67) return "rgb(120, 200, 160)";
  if (pct >= 34) return "rgb(255, 210, 100)"; // brighter amber
  return "rgb(255, 140, 130)";
}

/**
 * Player Overview — bento-card stat grid.
 *
 * Each stat is a self-contained card: subtle percentile-tinted background,
 * label up top, display-font value as the hero, percentile number as the
 * footing. The tint is intentionally quiet so a wall of cards still reads
 * editorial (not casino), but you can scan the whole grid at a glance and
 * see the red/green map of where the player wins and loses.
 *
 * Three logical sections (Box / Shooting / Advanced) stack vertically with
 * coral kickers — no card chrome around the sections themselves; the
 * individual stat tiles do the visual lifting.
 */

// `cols` controls the per-section grid track count at lg+ so each
// section fits into exactly one row (Box Score 7 cards, Shooting 6,
// Advanced 10). Below lg the grid wraps to a more compact column count
// so individual tiles don't go sub-readable on narrow viewports.
// Tailwind needs literal class strings here — don't interpolate.
const PANELS: Array<{ title: string; keys: string[] }> = [
  {
    title: "Box Score",
    keys: ["pts_pg", "reb_pg", "ast_pg", "stl_pg", "blk_pg", "fta_pg", "pir", "bta_portg"],
  },
  {
    title: "Shooting",
    keys: ["efg_pct", "ts_pct", "fg2_pct", "fg3_pct", "tpar", "ft_pct", "ftr"],
  },
  {
    title: "Advanced",
    keys: ["usage", "ast_pct", "tov_pct", "orb_pct", "hkm_pct"],
  },
];

const STAT_DEFS: Record<string, string> = {
  pir: "Performance Index Rating — EuroLeague's per-game shorthand: PTS + REB + AST + STL + BLK − missed FG − missed FT.",
  bta_portg: "Beyond the Arc Production Rating. Blends PIR, ORTG into a single z-score, then adjusts for conference tier and team strength.",
  hkm_pct: "Hakeem Percentage — BLK% + STL%. Named after Hakeem Olajuwon.",
  efg_pct: "Effective Field Goal % — adjusts FG% so a 3-pointer counts 1.5× a 2-pointer.",
  ts_pct: "True Shooting % — points per scoring attempt, weighting 2s, 3s, and free throws together.",
  usage: "Usage Rate — share of team possessions that end with this player's shot, turnover, or trip to the line.",
  ftr: "FT Rate — free throw attempts per field goal attempt; how often the player gets to the line.",
  tpar: "3-Point Attempt Rate — 3PA / FGA. The share of shot attempts that came from beyond the arc.",
};

export function PlayerStatsGrid({ season }: { season: PlayerRanksSeason }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 lg:gap-x-8 gap-y-8 px-5 sm:px-6 lg:px-8 py-5 sm:py-6 lg:py-7">
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
    <div>
      <div className="text-[0.6rem] uppercase tracking-[0.18em] text-coral font-bold mb-3 flex items-center gap-2">
        <span className="h-px w-6 bg-coral" />
        {title}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">No data.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {rows.map((r) => (
            <StatTile
              key={r.key}
              statKey={r.key}
              label={r.label}
              value={r.value}
              format={r.format}
              percentile={r.percentile}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Compact stat tile — label at the top, display-font value as the lede,
 * percentile rendered as a small circular gauge in the bottom-right.
 * Background tint matches the percentile color so a wall of tiles still
 * reads as a heatmap; the gauge adds a second visual data layer that's
 * richer than a flat chip but quieter than a full-width bar.
 */
function StatTile({
  statKey, label, value, format, percentile,
}: {
  statKey: string;
  label: string;
  value: number | null;
  format: StatFormat;
  percentile: number;
}) {
  // Inline both light + dark variants as CSS custom properties; CSS in
  // globals.css picks the right one based on [data-theme="dark"]. This
  // keeps the tile a server-renderable component (no client theme hook)
  // and avoids any flash during hydration.
  const tileStyle: React.CSSProperties = {
    "--tile-bg-light": pctBgStrong(percentile),
    "--tile-bg-dark": pctBgStrongDark(percentile),
    "--tile-color-light": pctColorLight(percentile),
    "--tile-color-dark": pctColorDark(percentile),
  } as React.CSSProperties;
  return (
    <div
      className="stat-tile relative rounded-lg border border-hairline/40 px-2.5 py-2 overflow-hidden transition-shadow hover:shadow-sm min-h-[5.25rem] flex flex-col"
      style={tileStyle}
    >
      <div className="text-[0.65rem] uppercase tracking-[0.14em] text-ink font-bold inline-flex items-center gap-1 mb-1">
        <span className="truncate">{label}</span>
        {STAT_DEFS[statKey] && <StatInfo definition={STAT_DEFS[statKey]!} />}
      </div>
      <div className="flex items-end justify-between gap-1 flex-1">
        <span className="font-display text-xl lg:text-2xl text-ink tabular leading-none tracking-[-0.02em]">
          {fmtValue(value, format)}
        </span>
        <PercentileGauge pct={percentile} />
      </div>
    </div>
  );
}

/**
 * Mini circular percentile gauge — track ring + colored arc that fills
 * clockwise based on the percentile. Both the arc and inner number pull
 * their color from the parent tile's `--tile-color-*` variables, so the
 * dial automatically retints when the theme flips without a JS hook.
 */
function PercentileGauge({ pct }: { pct: number }) {
  const size = 30;
  const stroke = 2.5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const fill = Math.max(0, Math.min(100, pct));
  const offset = circumference * (1 - fill / 100);
  return (
    <span className="stat-tile-color relative inline-flex items-center justify-center shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-ink/10"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <span
        className="absolute inset-0 flex items-center justify-center text-[0.55rem] font-bold tabular tabular-nums"
        aria-label={`${pct}th percentile`}
      >
        {pct}
      </span>
    </span>
  );
}
