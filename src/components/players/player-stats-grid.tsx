import type { PlayerRanksSeason } from "@/lib/static-data";
import { STAT_META, fmtValue, type StatFormat } from "./where-they-rank";
import { StatInfo } from "./stat-info";
import type { Shooting } from "./player-shot-impact";
import { PercentileChip } from "@/components/percentile-chip";

/**
 * Player Overview — the same card treatment the team dossier uses.
 *
 * This was a bento wall of percentile-tinted tiles: every stat its own box,
 * display-font value, a small circular gauge. It scanned as a heatmap, which
 * was the point, but it also meant the two most important pages on the site
 * presented the same KIND of information in two unrelated visual languages — a
 * team's Net Rating as a bordered list row, a player's PPG as a tinted tile.
 * Nothing about a player makes his numbers want a different shape.
 *
 * So: bordered cards, a coral section label, one line per stat reading
 * `label … value [percentile]`, exactly as TeamStatsPanel does it. The colour
 * moves out of the tile background and into the chip, where it says the same
 * thing in less ink, and a reader who has learned to scan one page can scan the
 * other without relearning anything.
 */

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
    // Four cards across at xl so each section owns one column, dropping to two
    // then one as the viewport narrows. Same gaps as the team panel.
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5 lg:gap-6">
      {PANELS.map((p) => (
        <StatPanel key={p.title} title={p.title} keys={p.keys} season={season} />
      ))}
      {shooting && <ShotDietPanel s={shooting} />}
    </div>
  );
}

/** The card shell, in one place, so the treatment changes everywhere at once. */
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-paper-deep/25 -mx-6 md:mx-0 rounded-none md:rounded-xl border-y border-x-0 md:border-x border-hairline shadow-sm px-5 lg:px-6 py-4">
      <h3 className="text-xs uppercase tracking-widest text-coral font-medium mb-3">{title}</h3>
      <ul className="divide-y divide-hairline/40">{children}</ul>
    </section>
  );
}

/**
 * One stat line. `sub` rides under the label for the shot-diet rows, which
 * carry a third layer: a zone's FG% means little without how often he shoots
 * there, since 60% at the rim reads differently on 15% of attempts than on 40%.
 */
function Row({
  label, definition, value, pct, sub,
}: {
  label: string;
  definition?: string;
  value: string;
  pct: number | null;
  sub?: string;
}) {
  return (
    <li className="flex items-center gap-3 py-2 px-1 -mx-1 rounded transition-colors hover:bg-[var(--accent-tint)]">
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1 text-ink-soft text-sm">
          <span className="truncate">{label}</span>
          {definition && <StatInfo definition={definition} />}
        </span>
        {sub && <span className="block text-[0.65rem] text-ink-muted tabular truncate">{sub}</span>}
      </span>
      <span className="flex-none font-medium text-ink tabular text-sm w-16 text-right">{value}</span>
      {pct !== null ? (
        <PercentileChip pct={pct} className="flex-none w-9 justify-center">{pct}</PercentileChip>
      ) : (
        <span className="flex-none w-9 text-center text-[0.65rem] text-ink-muted">—</span>
      )}
    </li>
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
      return {
        key: k,
        label: meta.label,
        format: meta.format as StatFormat,
        value: cell.value,
        percentile: cell.percentile,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) {
    return (
      <Card title={title}>
        <li className="py-2 text-sm text-ink-muted">No data.</li>
      </Card>
    );
  }

  return (
    <Card title={title}>
      {rows.map((r) => (
        <Row
          key={r.key}
          label={r.label}
          definition={STAT_DEFS[r.key]}
          value={fmtValue(r.value, r.format)}
          pct={r.percentile}
        />
      ))}
    </Card>
  );
}

function ShotDietPanel({ s }: { s: Shooting }) {
  const f1 = (v: number | null) => (v == null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: 1 }));
  const zones = [
    { key: "Rim", pct: s.rim_pct, rate: s.rim_rate, ptile: s.rim_ptile },
    { key: "Mid", pct: s.mid_pct, rate: s.mid_rate, ptile: s.mid_ptile },
    { key: "3PT", pct: s.tp_pct, rate: s.tp_rate, ptile: s.tp_ptile },
  ].filter((z) => z.pct != null || z.rate != null);

  if (zones.length === 0 && s.asst == null) return null;
  return (
    <Card title="Shot Diet">
      {zones.map((z) => (
        <Row
          key={z.key}
          label={z.key}
          value={z.pct == null ? "—" : `${f1(z.pct)}%`}
          pct={z.ptile ?? null}
          sub={z.rate == null ? undefined : `${f1(z.rate)}% of shots`}
        />
      ))}
      {s.asst != null && (
        // No percentile on purpose. Assisted rate is a role descriptor, not a
        // graded stat — a centre at 80% assisted is ordinary and a point guard
        // at 80% is not, so ranking it inside one cohort would assert a verdict
        // the number does not carry. The sub-line says which way is which.
        <Row label="Assisted" value={`${f1(s.asst)}%`} pct={null} sub="lower = self-created" />
      )}
    </Card>
  );
}

/**
 * Mini circular percentile gauge — track ring + coloured arc filling clockwise.
 *
 * The chip replaced it on this page, but player-shot-impact.tsx still renders
 * it, so it stays exported here rather than moving and breaking that import.
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
