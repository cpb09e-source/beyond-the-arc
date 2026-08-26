import { PercentileChip, pctBg, pctColor } from "@/components/percentile-chip";
import { GameBars } from "@/components/players/game-bars";
import { opponentOf } from "@/lib/game-log";
import { fromStart, fromEnd, type StatRow } from "@/lib/player-stat-line";
import { readPlayerRanks, readPlayerGames, readImpactExtrasForYear } from "@/lib/static-data";
import { cn } from "@/lib/utils";

/**
 * The six stat modules — scoring, the position's counting stat, glass/passing,
 * efficiency, shooting and impact.
 *
 * NOT RENDERED ANYWHERE RIGHT NOW. These lived in the player hero directly
 * beneath the masthead until the hero grew a stat band, at which point five of
 * the band's six figures were also printing one row below: 13.3 in the band and
 * again as SCORING's headline, 4.4 in the band and again as PLAYMAKING's, and
 * FG%/3P%/RPG each twice more. Rather than delete a set of modules that took a
 * lot of tuning, they moved here whole.
 *
 * SELF-CONTAINED ON PURPOSE. It does its own reads, so putting the modules back
 * anywhere — a tab, the overview card, a page of their own — is one import and
 * four props, with no data plumbing to reconstruct in the route. That was the
 * whole point of extracting rather than deleting.
 *
 *     <PlayerModules bartId={bartId} year={year} bucket={bucket} seasons={player.seasons} />
 *
 * It is an async server component, and the three reads it makes are the ones
 * the player route was already making, so re-adding it costs nothing at build
 * time that the page was not already paying.
 */

type ModuleSeason = {
  year: number;
  games: number | null;
  raw_row: StatRow;
};

/** A summary row: per-game rates and shooting percentages over a set of seasons. */
type SeasonSummary = {
  g: number;
  min: number;
  pts: number | null;
  reb: number | null;
  ast: number | null;
  fg: number | null;
  fg3: number | null;
  ft: number | null;
  efg: number | null;
  ts: number | null;
  epm: number | null;
  onOff: number | null;
};

function fmt(x: number | null, digits = 1): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  return x.toFixed(digits);
}
function fmtPct(x: number | null): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(1)}%`;
}
function fmtSigned(x: number | null, digits = 1): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "—";
  return `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(digits)}`;
}

/**
 * Season-over-season change, as a chip.
 *
 * Rendered only when a prior season exists AND both values are present — a
 * chip reading "+19.5" against a missing baseline would claim a jump that is
 * really a gap in the record. `pctPoints` switches the unit: a shooting rate
 * moves in percentage POINTS, and printing "+0.069" for a seven-point jump in
 * true shooting is unreadable.
 */
function Delta({
  now,
  was,
  pctPoints = false,
  digits = 1,
}: {
  now: number | null;
  was: number | null | undefined;
  pctPoints?: boolean;
  digits?: number;
}) {
  if (now === null || was === null || was === undefined) return null;
  if (!Number.isFinite(now) || !Number.isFinite(was)) return null;
  const raw = pctPoints ? (now - was) * 100 : now - was;
  if (Math.abs(raw) < (pctPoints ? 0.05 : 0.05)) return null;
  const up = raw > 0;
  const tone = up ? "var(--good)" : "var(--bad)";
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full pl-1 pr-1.5 py-0.5 tabular text-[0.625rem] font-semibold whitespace-nowrap leading-none"
      style={{ color: tone, background: `color-mix(in oklab, ${tone} 14%, transparent)` }}
      title="Change from the previous season"
    >
      {/* A stroked arrow rather than the ▲/▼ glyphs: those are filled triangles
          at whatever weight the system font happens to draw them, which sat
          heavier than the figure beside them and differed per platform. */}
      <svg viewBox="0 0 10 10" className="w-2.5 h-2.5 shrink-0" aria-hidden="true">
        <path
          d={up ? "M5 8.5V2M5 2L2 5M5 2l3 3" : "M5 1.5V8M5 8l-3-3M5 8l3-3"}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {Math.abs(raw).toFixed(digits)}
    </span>
  );
}

/** Module shell — eyebrow, optional right-hand note, body. */
function Module({
  title,
  note,
  children,
}: {
  title: string;
  note?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-hairline rounded-lg bg-paper-deep/45 px-4 py-3.5 flex flex-col gap-3 min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="label" style={{ color: "var(--court-ink)" }}>
          {title}
        </span>
        {note && (
          <span className="tabular text-[0.625rem] text-ink-muted truncate min-w-0">{note}</span>
        )}
      </div>
      {children}
    </div>
  );
}

/** Headline figure for a module: value, unit, season delta, percentile chip. */
function BigStat({
  value,
  unit,
  delta,
  pct,
  accent = false,
}: {
  value: string;
  unit: string;
  delta?: React.ReactNode;
  pct?: number | null;
  accent?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2 min-w-0">
      <span
        className={cn(
          "font-display tabular text-[1.75rem] sm:text-[2rem] leading-none",
          accent ? "text-coral" : "text-ink",
        )}
      >
        {value}
      </span>
      <span className="text-[0.6875rem] text-ink-muted">{unit}</span>
      {delta}
      {pct != null && <PercentileChip pct={pct} className="ml-auto shrink-0" />}
    </div>
  );
}

/**
 * One rate on the percentile ramp.
 *
 * `fill` is the bar's own length (a shooting percentage fills by its value, so
 * 85% FT reads as a long bar) while the COLOR comes from the percentile, which
 * is the part that says whether the number is any good. Rows with no percentile
 * — a stat the cohort file doesn't rank — keep the bar in hairline and show a
 * dash, rather than borrowing a colour they haven't earned.
 */
function RateRow({
  label,
  value,
  fill,
  pct,
}: {
  label: string;
  value: string;
  fill: number | null;
  pct: number | null;
}) {
  const width = fill === null ? 0 : Math.max(0, Math.min(100, fill * 100));
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <span className="text-[0.6875rem] font-semibold text-ink-muted w-11 shrink-0">{label}</span>
      <span className="tabular text-[0.8125rem] text-ink w-12 text-right shrink-0">{value}</span>
      <span className="flex-1 h-2 bg-paper-deep rounded-[2px] overflow-hidden min-w-0">
        <span
          className="block h-full rounded-[2px]"
          style={{
            width: `${width}%`,
            // An unranked row still draws its bar — FG% has no cohort file of
            // its own — but in neutral ink rather than a ramp colour it hasn't
            // earned. Hairline was invisible against the module ground and read
            // as a missing value rather than a missing rank.
            background: pct === null ? "color-mix(in oklab, var(--ink-muted) 30%, transparent)" : pctBg(pct),
            // The ramp's middle bands are near-paper ON PURPOSE — as a chip
            // background with dark text on top, "average" is supposed to recede.
            // With nothing written on it, a 70th-percentile bar was a pale
            // yellow-green shape on a pale ground and a 50th was invisible. A
            // hairline in the band's own text colour gives every band an edge
            // without touching the fill the chips use.
            boxShadow:
              pct === null
                ? undefined
                : `inset 0 0 0 1px color-mix(in oklab, ${pctColor(pct)} 42%, transparent)`,
          }}
        />
      </span>
      {/* The figure takes the band's text colour too — it is the one part of
          the row that reads at any band, so it carries the ranking when the
          fill is too pale to. */}
      <span
        className="tabular text-[0.6875rem] w-5 text-right shrink-0 font-semibold"
        style={{ color: pct === null ? "var(--ink-muted)" : pctColor(pct) }}
      >
        {pct === null ? "—" : pct}
      </span>
    </div>
  );
}

/** A split of EPM (or on/off) drawn against the total, so the halves compare. */
function ImpactBar({ label, value, scale, tone }: { label: string; value: number | null; scale: number; tone: string }) {
  const width = value === null ? 0 : Math.max(0, Math.min(100, (Math.abs(value) / scale) * 100));
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <span className="text-[0.6875rem] text-ink-muted w-14 shrink-0">{label}</span>
      <span className="flex-1 h-2.5 bg-paper-deep rounded-[2px] overflow-hidden min-w-0">
        <span className="block h-full rounded-[2px]" style={{ width: `${width}%`, background: tone }} />
      </span>
      <span className="tabular text-[0.6875rem] text-ink w-10 text-right shrink-0">
        {fmtSigned(value, 2)}
      </span>
    </div>
  );
}

/**
 * A summary row over a set of seasons.
 *
 * Every rate is totals over totals. The average of four seasons' percentages is
 * not the career percentage unless every season had identical attempts, which
 * is never true.
 */
function summarize(rows: Array<SeasonSummary & { year: number; ftm: number; fta: number; fgm: number; fga: number; fg3m: number; fg3a: number }>): SeasonSummary {
  const g = rows.reduce((n, r) => n + r.g, 0);
  const min = rows.reduce((n, r) => n + r.min, 0);
  const sum = (k: "ftm" | "fta" | "fgm" | "fga" | "fg3m" | "fg3a") =>
    rows.reduce((n, r) => n + r[k], 0);
  const sumCount = (k: "pts" | "reb" | "ast") =>
    rows.reduce((n, r) => n + (r[k] ?? 0), 0);
  const fgm = sum("fgm"), fga = sum("fga"), fg3m = sum("fg3m");
  /**
   * EPM and on/off are per-100 RATES, so a career figure is the
   * minutes-weighted mean of the seasons that HAVE one — not a plain average,
   * which would let a 6-minute freshman year pull as hard as a 34-minute
   * senior year. Seasons without the stat are excluded from both the numerator
   * and the weight rather than counted as zero.
   */
  const weighted = (k: "epm" | "onOff") => {
    const have = rows.filter((r) => r[k] !== null && r.min > 0);
    if (!have.length) return null;
    const w = have.reduce((n, r) => n + r.min, 0);
    return w > 0 ? have.reduce((n, r) => n + (r[k] as number) * r.min, 0) / w : null;
  };
  return {
    g,
    pts: g ? sumCount("pts") / g : null,
    reb: g ? sumCount("reb") / g : null,
    ast: g ? sumCount("ast") / g : null,
    fg: fga ? fgm / fga : null,
    fg3: sum("fg3a") ? fg3m / sum("fg3a") : null,
    ft: sum("fta") ? sum("ftm") / sum("fta") : null,
    efg: fga ? (fgm + 0.5 * fg3m) / fga : null,
    // True shooting over the same totals, so a career TS is the real thing
    // rather than the mean of the seasons' percentages.
    //
    // 0.475, not the textbook 0.44: Bart's own ts_pct column uses 0.475, and
    // that column is what player-ranks percentiles this against and what the
    // Overview panel prints. A hero reading 62.0% beside an Overview reading
    // 61.2% for the same season would look like one of them was broken.
    ts: fga + 0.475 * sum("fta") ? sumCount("pts") / (2 * (fga + 0.475 * sum("fta"))) : null,
    epm: weighted("epm"),
    onOff: weighted("onOff"),
    min,
  };
}

export async function PlayerModules({
  bartId,
  year,
  bucket,
  seasons,
}: {
  bartId: number;
  /** The season the modules describe. */
  year: number;
  /** Position cohort the season was ranked in. Decides which counting stat
   *  leads the second module. */
  bucket: "G" | "F" | "C";
  seasons: ModuleSeason[];
}) {
  const ranks = await readPlayerRanks(bartId);
  const heroRanks = ranks?.seasonRanks.find((r) => r.year === year) ?? null;

  const epmByYear = new Map<number, number>();
  for (const r of ranks?.seasonRanks ?? []) {
    const v = r.stats?.epm?.value;
    if (typeof v === "number") epmByYear.set(r.year, v);
  }
  // on/off is a lineup quantity, so it lives only in epm-<year>.json. One read
  // per season, memoized across the pages this route generates.
  const onOffByYear = new Map<number, number>();
  for (const season of seasons) {
    const extras = await readImpactExtrasForYear(season.year);
    const v = extras.get(bartId)?.on_off;
    if (typeof v === "number") onOffByYear.set(season.year, v);
  }

  const lines = seasons.map((season) => {
    const r = season.raw_row;
    const g = season.games ?? 0;
    const ftm = fromStart(r, 13), fta = fromStart(r, 14);
    const fg2m = fromStart(r, 16), fg2a = fromStart(r, 17);
    const fg3m = fromStart(r, 19), fg3a = fromStart(r, 20);
    const mpg = fromStart(r, 54);
    return {
      year: season.year,
      g,
      min: mpg !== null ? mpg * g : 0,
      // Bart's per-game rates × games recovers the season total, which is what
      // a career line has to sum. He carries no season point total.
      pts: (fromEnd(r, 3) ?? 0) * g,
      reb: (fromEnd(r, 7) ?? 0) * g,
      ast: (fromEnd(r, 6) ?? 0) * g,
      ftm: ftm ?? 0, fta: fta ?? 0,
      fgm: (fg2m ?? 0) + (fg3m ?? 0),
      fga: (fg2a ?? 0) + (fg3a ?? 0),
      fg3m: fg3m ?? 0, fg3a: fg3a ?? 0,
      epm: epmByYear.get(season.year) ?? null,
      onOff: onOffByYear.get(season.year) ?? null,
      fg: null, fg3: null, ft: null, efg: null, ts: null,
    };
  });

  const current = summarize(lines.filter((l) => l.year === year));

  /**
   * The season before the one on screen — the baseline the delta chips measure
   * against. Found by year rather than by array position: the file is written
   * newest-first today, but a comparison against the wrong year would be
   * indistinguishable from a correct one.
   */
  const prevYear = seasons
    .map((s) => s.year)
    .filter((y) => y < year)
    .sort((a, b) => b - a)[0];
  const prev = prevYear !== undefined ? summarize(lines.filter((l) => l.year === prevYear)) : null;

  const heroExtras = (await readImpactExtrasForYear(year)).get(bartId) ?? null;
  const impact = heroExtras
    ? { off: heroExtras.off, def: heroExtras.def, onOff: current.onOff }
    : null;

  /**
   * The season's game log, oldest first — the three charts are read left to
   * right as the season. Read at build time; the directory is served from R2 at
   * runtime but is on disk while these pages generate.
   */
  const games = (await readPlayerGames(bartId))
    .filter((g) => g.year === year)
    .sort((a, b) => (a.game_date ?? "").localeCompare(b.game_date ?? ""));

  const pct = (k: string) => heroRanks?.stats?.[k]?.percentile ?? null;
  const val = (k: string) => heroRanks?.stats?.[k]?.value ?? null;

  const pts = games.map((g) => g.pts_scored ?? 0);
  // Null preserved rather than zeroed: ~12% of logged games have no true
  // shooting because the player attempted no shot, which is a different
  // statement from shooting 0%.
  const ts = games.map((g) => (g.ts_pct === null || g.ts_pct === undefined ? null : g.ts_pct * 100));
  const hasLog = games.length >= 2;

  /**
   * The second module follows the position bucket. A guard's signature counting
   * stat is assists and a big's is rebounds, and drawing the same one for both
   * wasted the slot on whoever it didn't fit — a centre's 0.9 assists per game
   * is 36 one-unit stubs. The stat this module takes is swapped OUT of the
   * defensive module below, so nothing is shown twice and nothing is dropped.
   */
  const big = bucket === "F" || bucket === "C";
  const second = big
    ? {
        title: "Rebounding",
        unit: "REB",
        rankKey: "reb_pg",
        value: current.reb,
        prev: prev?.reb,
        series: games.map((g) => g.reb ?? 0),
        fallbackKey: "drb_pct",
        fallbackLabel: "DRB%",
      }
    : {
        title: "Playmaking",
        unit: "AST",
        rankKey: "ast_pg",
        value: current.ast,
        prev: prev?.ast,
        series: games.map((g) => g.ast ?? 0),
        fallbackKey: "ast_pct",
        fallbackLabel: "AST%",
      };

  /** "high 35 vs Indiana St." — the question a per-game average cannot answer. */
  function highNote(series: number[]): string | null {
    if (!series.length) return hasLog ? `${games.length} games` : null;
    const i = series.indexOf(Math.max(...series));
    const g = games[i];
    return g?.opp_team_market ? `high ${series[i]} ${opponentOf(g)}` : `${games.length} games`;
  }
  const bestNote = highNote(pts);
  const secondNote = second.series.length ? highNote(second.series) : null;
  // The efficiency chart's high is a rate, so it wants the decimal the counting
  // charts don't. Stated as a count of nights instead — "how often was he better
  // than himself" is the reading the colours give.
  const tsAbove = current.ts === null ? null : ts.filter((v) => v !== null && v >= current.ts! * 100).length;
  const tsNote =
    tsAbove === null ? "true shooting" : `${tsAbove} of ${ts.filter((v) => v !== null).length} above`;

  const hasSplit =
    (impact?.off ?? null) !== null || (impact?.def ?? null) !== null || current.onOff !== null;

  /**
   * The two halves share one scale so they are comparable to each other and to
   * the EPM they sum to. On/off is deliberately NOT on it: it is a raw point
   * differential per 100 possessions, so a +10.8 on/off against a +2.8 EPM
   * pinned the bar at full width and squashed the halves it was meant to sit
   * beside. It reads as a figure below the bars instead.
   */
  const impactScale = Math.max(
    1,
    Math.abs(current.epm ?? 0),
    Math.abs(impact?.off ?? 0),
    Math.abs(impact?.def ?? 0),
  );

  return (
    // Six modules. Two columns on tablet, three on desktop — a chart narrower
    // than about 220px stops resolving individual games.
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
      <Module title="Scoring" note={bestNote}>
        <BigStat
          value={fmt(current.pts, 1)}
          unit="PTS"
          pct={pct("pts_pg")}
          delta={<Delta now={current.pts} was={prev?.pts} />}
        />
        {hasLog ? (
          <GameBars games={games} values={pts} unit="PTS" avg={current.pts} />
        ) : (
          <RateRow label="Rank" value={fmt(current.pts, 1)} fill={(pct("pts_pg") ?? 0) / 100} pct={pct("pts_pg")} />
        )}
      </Module>

      <Module title={second.title} note={secondNote}>
        <BigStat
          value={fmt(second.value, 1)}
          unit={second.unit}
          pct={pct(second.rankKey)}
          delta={<Delta now={second.value} was={second.prev} />}
        />
        {hasLog ? (
          <GameBars games={games} values={second.series} unit={second.unit} avg={second.value} />
        ) : (
          <RateRow
            label={second.fallbackLabel}
            value={fmt(val(second.fallbackKey), 1)}
            fill={(pct(second.fallbackKey) ?? 0) / 100}
            pct={pct(second.fallbackKey)}
          />
        )}
      </Module>

      {/* The counting stats the module above didn't take. No chart: these are
          the ones a per-game column renders as a row of one- and two-unit
          stubs, so the percentile is the whole reading and the ramp carries
          it. Title names what's actually in it — a big's version leads with
          passing, not glass. */}
      <Module title={big ? "Passing & defense" : "Glass & defense"} note="percentile in cohort">
        <div className="flex flex-col gap-2 pt-0.5">
          {big ? (
            <RateRow label="AST" value={fmt(current.ast, 1)} fill={(pct("ast_pg") ?? 0) / 100} pct={pct("ast_pg")} />
          ) : (
            <RateRow label="REB" value={fmt(current.reb, 1)} fill={(pct("reb_pg") ?? 0) / 100} pct={pct("reb_pg")} />
          )}
          <RateRow label="STL" value={fmt(val("stl_pg"), 1)} fill={(pct("stl_pg") ?? 0) / 100} pct={pct("stl_pg")} />
          <RateRow label="BLK" value={fmt(val("blk_pg"), 1)} fill={(pct("blk_pg") ?? 0) / 100} pct={pct("blk_pg")} />
          <RateRow label="TOV%" value={fmt(val("tov_pct"), 1)} fill={(pct("tov_pct") ?? 0) / 100} pct={pct("tov_pct")} />
        </div>
      </Module>

      <Module title="Efficiency" note={hasLog ? tsNote : "true shooting"}>
        <BigStat
          value={fmtPct(current.ts)}
          unit="TS"
          pct={pct("ts_pct")}
          delta={<Delta now={current.ts} was={prev?.ts} pctPoints />}
        />
        {hasLog ? (
          <GameBars
            games={games}
            values={ts}
            unit="TS%"
            decimals={1}
            avg={current.ts === null ? null : current.ts * 100}
          />
        ) : (
          <div className="flex flex-col gap-2">
            <RateRow label="USG" value={fmt(val("usage"), 1)} fill={(pct("usage") ?? 0) / 100} pct={pct("usage")} />
            <RateRow label="ORtg" value={fmt(val("ortg"), 1)} fill={(pct("ortg") ?? 0) / 100} pct={pct("ortg")} />
          </div>
        )}
      </Module>

      <Module title="Shooting" note="value · percentile">
        <div className="flex flex-col gap-2 pt-0.5">
          <RateRow label="FG%" value={fmtPct(current.fg)} fill={current.fg} pct={null} />
          <RateRow label="3P%" value={fmtPct(current.fg3)} fill={current.fg3} pct={pct("fg3_pct")} />
          <RateRow label="FT%" value={fmtPct(current.ft)} fill={current.ft} pct={pct("ft_pct")} />
          <RateRow label="eFG%" value={fmtPct(current.efg)} fill={current.efg} pct={pct("efg_pct")} />
        </div>
      </Module>

      <Module title="Impact" note={hasSplit ? "EPM, split off / def" : "efficiency & load"}>
        <BigStat
          value={fmtSigned(current.epm, 2)}
          unit="EPM"
          accent
          pct={pct("epm")}
          delta={<Delta now={current.epm} was={prev?.epm} digits={2} />}
        />
        {/* The off/def split and on/off are lineup quantities, so they exist
            only for seasons the ridge fit covers. Older seasons carry the
            box-score estimate, which has no lineup information at all —
            three empty bars would read as a rendering fault rather than as
            a season we never had the data for, so those seasons get the
            rate stats the cohort file does rank. */}
        {hasSplit ? (
          <div className="flex flex-col gap-2">
            <ImpactBar label="Offense" value={impact?.off ?? null} scale={impactScale} tone="var(--coral)" />
            <ImpactBar label="Defense" value={impact?.def ?? null} scale={impactScale} tone="var(--coral-soft)" />
            {current.onOff !== null && (
              <div className="flex items-baseline gap-2.5 pt-0.5">
                <span className="text-[0.6875rem] text-ink-muted w-14 shrink-0">On/Off</span>
                <span className="tabular text-[0.8125rem] text-ink">{fmtSigned(current.onOff, 1)}</span>
                <span className="text-[0.625rem] text-ink-muted">team net per 100 with him on</span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <RateRow label="ORtg" value={fmt(val("ortg"), 1)} fill={(pct("ortg") ?? 0) / 100} pct={pct("ortg")} />
            <RateRow label="USG" value={fmt(val("usage"), 1)} fill={(pct("usage") ?? 0) / 100} pct={pct("usage")} />
            <RateRow label="PORP" value={fmt(val("porpag"), 1)} fill={(pct("porpag") ?? 0) / 100} pct={pct("porpag")} />
          </div>
        )}
      </Module>
    </div>
  );
}
