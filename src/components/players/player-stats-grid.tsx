import type { PlayerRanksSeason } from "@/lib/static-data";
import { STAT_META, fmtValue, type StatFormat } from "./where-they-rank";
import { StatInfo } from "./stat-info";
import type { Shooting } from "./player-shot-impact";
import { pctColor, pctBg } from "@/components/percentile-chip";

// Every percentile-tinted surface on this page — StatTile, ZoneTile, and the
// shot-profile fallback card's ZoneBars — now runs on the site-wide chip ramp
// in percentile-chip.tsx. The three-band olive/amber/tomato ramp that used to
// live here (pctBgStrong/pctBgStrongDark/pctColorLight/pctColorDark, cuts at
// 67/34) was the last holdout and went with the fallback card 2026-07.

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
    keys: ["pts_pg", "reb_pg", "ast_pg", "stl_pg", "blk_pg", "fta_pg", "pir", "epm"],
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
  epm: "Estimated Plus-Minus — points per 100 possessions the player adds over an average D-I player, estimated from the box score and calibrated against RAPM.",
  hkm_pct: "Hakeem Percentage — BLK% + STL%. Named after Hakeem Olajuwon.",
  efg_pct: "Effective Field Goal % — adjusts FG% so a 3-pointer counts 1.5× a 2-pointer.",
  ts_pct: "True Shooting % — points per scoring attempt, weighting 2s, 3s, and free throws together.",
  usage: "Usage Rate — share of team possessions that end with this player's shot, turnover, or trip to the line.",
  ftr: "FT Rate — free throw attempts per field goal attempt; how often the player gets to the line.",
  tpar: "3-Point Attempt Rate — 3PA / FGA. The share of shot attempts that came from beyond the arc.",
};

export function PlayerStatsGrid({
  season,
  shooting,
}: {
  season: PlayerRanksSeason;
  /** Zone splits for the same year, when we have them. Drives Shot Diet. */
  shooting?: Shooting | null;
}) {
  return (
    // Four panels at lg+, two at md. Shot Diet is the narrow one on the end —
    // three zones, not a wall of tiles — so it doesn't need an equal share.
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-x-6 lg:gap-x-8 gap-y-8 px-2 sm:px-5 lg:px-8 pt-1 pb-5 sm:py-6 lg:py-7">
      {PANELS.map((p) => (
        <StatPanel key={p.title} title={p.title} keys={p.keys} season={season} />
      ))}
      {shooting && <ShotDietPanel s={shooting} />}
    </div>
  );
}

/**
 * Shot Diet — the zone splits that used to sit under the shot chart, moved up
 * beside the other stat panels.
 *
 * Three layers per zone instead of the usual two, because a zone's FG% is
 * meaningless without knowing how much the player actually shoots there: a
 * 60% rim rate reads very differently at 15% of attempts than at 40%. So the
 * headline is FG%, the percentile gauge ranks that FG% within the position
 * cohort, and the share of attempts rides underneath as context.
 */
function ShotDietPanel({ s }: { s: Shooting }) {
  const zones = [
    { key: "Rim", pct: s.rim_pct, rate: s.rim_rate, ptile: s.rim_ptile },
    { key: "Mid", pct: s.mid_pct, rate: s.mid_rate, ptile: s.mid_ptile },
    { key: "3PT", pct: s.tp_pct, rate: s.tp_rate, ptile: s.tp_ptile },
  ].filter((z) => z.pct != null || z.rate != null);

  if (zones.length === 0 && s.asst == null) return null;
  return (
    <div>
      <div className="text-[0.6rem] uppercase tracking-[0.18em] text-coral font-bold mb-3 flex items-center gap-2">
        <span className="h-px w-6 bg-coral" />
        Shot Diet
      </div>
      {/* Same track count as every other panel so all four columns render
          identical tile widths. Four entries fill it as a clean 2×2 at md+. */}
      <div className="grid grid-cols-3 md:grid-cols-2 gap-2">
        {zones.map((z) => (
          <ZoneTile key={z.key} label={z.key} pct={z.pct} rate={z.rate} ptile={z.ptile} />
        ))}
        {s.asst != null && (
          // No gauge and no tint on purpose. Assisted rate is a role
          // descriptor, not a graded stat — a centre at 80% assisted is
          // ordinary and a point guard at 80% is not, so ranking it inside one
          // cohort would assert a verdict the number doesn't carry. The
          // sub-line says which direction means what instead.
          <ZoneTile label="Assisted" pct={s.asst} sub="lower = self-created" ptile={null} rate={null} />
        )}
      </div>
    </div>
  );
}

function ZoneTile({
  label, pct, rate, ptile, sub,
}: {
  label: string;
  pct: number | null;
  rate: number | null;
  ptile: number | null;
  /** Replaces the "x% of shots" sub-line (used by the Assisted tile). */
  sub?: string;
}) {
  // Same percentile ramp as StatTile so the panel reads as part of the grid.
  const p = ptile ?? 50;
  const tileStyle: React.CSSProperties = {
    "--tile-bg-light": ptile == null ? "transparent" : pctBg(p),
    "--tile-bg-dark": ptile == null ? "transparent" : pctBg(p),
    "--tile-color-light": pctColor(p),
    "--tile-color-dark": pctColor(p),
  } as React.CSSProperties;
  const f1 = (v: number | null) => (v == null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: 1 }));
  return (
    <div
      className="stat-tile relative rounded-lg border border-hairline/40 px-2.5 py-2 overflow-hidden transition-shadow hover:shadow-sm min-h-[5.25rem] flex flex-col"
      style={tileStyle}
    >
      <div className="text-[0.65rem] uppercase tracking-[0.14em] text-ink font-bold mb-1 truncate">{label}</div>
      {/* Value + gauge on one row, exactly like StatTile, then the third layer
          on its own full-width line underneath. Nesting it beside the value
          left it competing with the gauge for a quarter-column and it clipped
          to "33.5% of sho…". Normal case for the same width reason. */}
      <div className="flex items-end justify-between gap-1 flex-1">
        <span className="font-display text-xl lg:text-2xl text-ink tabular leading-none tracking-[-0.02em]">
          {f1(pct)}%
        </span>
        {ptile != null && <PercentileGauge pct={ptile} />}
      </div>
      <div className="text-[0.6rem] text-ink-muted tabular mt-1.5 truncate">
        {sub ?? `${f1(rate)}% of shots`}
      </div>
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
        <div className="grid grid-cols-3 md:grid-cols-2 gap-2">
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
  // Match the players-table percentile chips: pctBg background + pctColor
  // text/gauge, theme-agnostic like the chip itself.
  const tileStyle: React.CSSProperties = {
    "--tile-bg-light": pctBg(percentile),
    "--tile-bg-dark": pctBg(percentile),
    "--tile-color-light": pctColor(percentile),
    "--tile-color-dark": pctColor(percentile),
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
export function PercentileGauge({ pct }: { pct: number }) {
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
