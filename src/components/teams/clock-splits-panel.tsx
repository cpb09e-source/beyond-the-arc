import type { ClockSplits } from "@/lib/static-data";

/**
 * When this team shoots, and what it gets — measured against the shot clock
 * rather than the game clock.
 *
 * THE NUMBER THAT MAKES THE PANEL WORTH READING is the gap between the bands.
 * League-wide in 2026 a shot is worth 1.09 points early and 0.97 late: an early
 * look returns about an eighth of a point more than a late one, every time. So
 * a team's band SHARES are not a stylistic curiosity, they are a large part of
 * why its offense rates where it does — and the defensive side is a scheme
 * signature, since forcing opponents into the last third of the clock is
 * something a defense does on purpose.
 *
 * DRAWN AS THE OBJECT IT MEASURES. The angle is the clock: a full turn is
 * thirty seconds, each band its own 120° third, read clockwise from the top the
 * way the possession runs. What varies is the RADIUS — how far a band bulges is
 * how many of the team's shots came from that stretch — and the fill is how
 * well they went.
 *
 * THE RADIAL SCALE IS FIXED, NOT PER-TEAM. A dial normalised to its own maximum
 * makes every team the same shape, which is the one thing this drawing exists
 * to prevent: a fast team bulges at the top, a grind-it-out team at the bottom
 * left, and neither needs a number read to be recognised. 45% is comfortably
 * above any real band share.
 *
 * Clock position is reconstructed, not reported — see build-clock-splits.mjs.
 * The reset rule is the load-bearing part: an offensive rebound restarts the
 * count, because NCAA men's puts the shot clock back to 20 on one.
 */

const BANDS = [
  { key: "early", label: "Early", window: "0–10s" },
  { key: "mid", label: "Middle", window: "11–20s" },
  { key: "late", label: "Late", window: "21s+" },
] as const;

/**
 * The D-I mean by band, 2026, over all 365 teams — and computed for each SIDE
 * separately.
 *
 * THE TWO SIDES ARE NOT THE SAME LINE. This panel used to compare a defense
 * against the offensive league average; they differ by about a point of eFG,
 * which is the same order as the differences being read off the panel. Every
 * team's defensive numbers were shifted by that much in one direction.
 *
 * Re-measure these when the season is live — the means move as the sample fills
 * in, and a stale reference line silently biases every team's verdict.
 */
const LEAGUE = {
  off: {
    rate: { early: 0.359, mid: 0.358, late: 0.283 },
    efg: { early: 0.547, mid: 0.519, late: 0.483 },
  },
  def: {
    rate: { early: 0.351, mid: 0.362, late: 0.288 },
    efg: { early: 0.536, mid: 0.512, late: 0.477 },
  },
} as const;

type Row = {
  key: "early" | "mid" | "late";
  label: string;
  window: string;
  rate: number | null;
  efg: number | null;
  lgRate: number;
  lgEfg: number;
};

const pct1 = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);

/**
 * Points per shot, which is exactly twice eFG — eFG is (FGM + 0.5·FG3M)/FGA and
 * the points those makes are worth is 2·FGM + FG3M, so the conversion is not an
 * approximation.
 *
 * IT IS PER SHOT, NOT PER POSSESSION. Free throws are outside this panel
 * entirely (the feed cannot tell an and-one from the last of two, so
 * build-clock-splits.mjs skips them on both sides), and there is no possession
 * denominator per band — a trip that ends in a turnover never produced a shot
 * and so has no clock bucket. True points per possession would need that script
 * rebuilt around possessions rather than shots.
 */
const pps = (efg: number | null) => (efg == null ? "—" : (efg * 2).toFixed(2));

/**
 * Strength-scaled tint against the league line for that band and that side.
 *
 * THE VERDICT FLIPS ON DEFENSE and the panel used to not flip it: both sides
 * were colored `delta >= 0 ? good : bad`, so a defense holding opponents BELOW
 * the league eFG — the entire point of a defense — was painted red. Houston
 * allows .428 late against a .477 league and read as trouble.
 *
 * The dead zone is the other half of the fix. Half a point of eFG is noise, and
 * coloring it makes a dead-average band shout as loudly as a real edge.
 */
function tint(delta: number, def: boolean) {
  if (Math.abs(delta) < 0.005) {
    return { fg: "var(--ink-muted)", bg: "color-mix(in oklab, var(--ink-muted) 8%, transparent)" };
  }
  const good = def ? delta < 0 : delta > 0;
  const c = good ? "var(--good)" : "var(--bad)";
  const mag = Math.min(1, Math.abs(delta) / 0.05);
  return { fg: c, bg: `color-mix(in oklab, ${c} ${(7 + mag * 26).toFixed(0)}%, transparent)` };
}

export function ClockSplitsPanel({ splits }: { splits: ClockSplits }) {
  const rowsFor = (def: boolean): Row[] => {
    const lg = def ? LEAGUE.def : LEAGUE.off;
    return BANDS.map((b) => ({
      key: b.key,
      label: b.label,
      window: b.window,
      rate: splits[`${b.key}_rate${def ? "_def" : ""}` as keyof ClockSplits] as number | null,
      efg: splits[`${b.key}_efg${def ? "_def" : ""}` as keyof ClockSplits] as number | null,
      lgRate: lg.rate[b.key],
      lgEfg: lg.efg[b.key],
    }));
  };

  return (
    <div className="bg-paper-deep/25 -mx-6 lg:mx-0 rounded-none lg:rounded-xl border-y border-x-0 lg:border-x border-hairline shadow-sm p-6">
      <div className="flex items-baseline justify-between mb-1 gap-3">
        <h3 className="font-display text-xl text-ink">Shot clock</h3>
        <span className="text-[0.65rem] uppercase tracking-widest text-ink-muted whitespace-nowrap">
          {splits.clock_games} games
        </span>
      </div>
      <p className="text-xs text-ink-muted mb-4 max-w-[52ch]">
        A full turn is the thirty-second clock. How far a band reaches is how
        often the shot came from that stretch; the number under it is what those
        shots returned per attempt.
      </p>

      {/* Stacked on a phone, side by side from sm. Two dials in a phone-width
          column are 180px each, and at that size the numbers inside the ring
          are unreadable — the whole point of printing them rather than leaving
          the reader to estimate an arc. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Dial title="Offense" rows={rowsFor(false)} def={false} />
        <Dial title="Defense" rows={rowsFor(true)} def />
      </div>

      <p className="text-[0.6rem] text-ink-muted mt-3 leading-snug">
        Fill is this team&apos;s shooting against the D-I average for that stretch of the
        clock — on the defensive dial, green means opponents shot worse. The dashed arc is
        where D-I&apos;s own share of shots sits on the same scale. Points per shot excludes
        free throws.
      </p>
    </div>
  );
}

function Dial({ title, rows, def }: { title: string; rows: Row[]; def: boolean }) {
  const S = 200, cx = S / 2, cy = S / 2, R0 = 26, R1 = 74;
  const SCALE = 0.45;
  const rad = (d: number) => (d * Math.PI) / 180;
  // 0° is twelve o'clock and the angle grows clockwise, like the clock it draws.
  const pt = (a: number, r: number) => [cx + r * Math.sin(rad(a)), cy - r * Math.cos(rad(a))] as const;
  const wedge = (a0: number, a1: number, r: number) => {
    const [x0, y0] = pt(a0, r), [x1, y1] = pt(a1, r);
    const [x2, y2] = pt(a1, R0), [x3, y3] = pt(a0, R0);
    const big = a1 - a0 > 180 ? 1 : 0;
    return `M ${x0} ${y0} A ${r} ${r} 0 ${big} 1 ${x1} ${y1} L ${x2} ${y2} A ${R0} ${R0} 0 ${big} 0 ${x3} ${y3} Z`;
  };

  return (
    <div>
      <div className="text-[0.58rem] uppercase tracking-[0.16em] font-semibold text-ink-soft mb-1 text-center">
        {title}
      </div>
      <svg
        viewBox={`0 0 ${S} ${S}`}
        className="w-full h-auto max-w-[17rem] mx-auto"
        role="img"
        aria-label={`${title}: share of shots and points per shot by position on the shot clock`}
      >
        {/* Second ticks, so the ring reads as a clock and not as a pie. */}
        {Array.from({ length: 30 }, (_, i) => {
          const a = i * 12, major = i % 5 === 0;
          const [x0, y0] = pt(a, R1 + 3), [x1, y1] = pt(a, R1 + (major ? 8 : 5));
          return (
            <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke="var(--ink-muted)"
              strokeWidth={major ? 1.1 : 0.6} opacity={major ? 0.7 : 0.35} />
          );
        })}
        {[0, 10, 20].map((sec) => {
          const [x, y] = pt(sec * 12, R1 + 15);
          return (
            <text key={sec} x={x} y={y + 2.5} textAnchor="middle" fontSize={7}
              fill="var(--ink-muted)" className="tabular">{sec}s</text>
          );
        })}

        {rows.map((r, i) => {
          // A degree and a half of air at each end, so neighbouring bands read
          // as three readings rather than one continuous ring.
          const a0 = i * 120 + 1.5, a1 = (i + 1) * 120 - 1.5;
          const d = r.efg == null ? 0 : r.efg - r.lgEfg;
          const t = tint(d, def);
          const rr = R0 + Math.min(1, (r.rate ?? 0) / SCALE) * (R1 - R0);
          const lgR = R0 + Math.min(1, r.lgRate / SCALE) * (R1 - R0);
          const [lx, ly] = pt((a0 + a1) / 2, R1 * 0.62);
          const [ax0, ay0] = pt(a0, lgR), [ax1, ay1] = pt(a1, lgR);
          return (
            <g key={r.key}>
              <path d={wedge(a0, a1, rr)} fill={t.bg} stroke={t.fg} strokeWidth={1.1} strokeOpacity={0.55}>
                <title>
                  {`${r.label} (${r.window}): ${pct1(r.rate)} of shots at ${pps(r.efg)} points per shot`
                    + `, against a D-I ${pps(r.lgEfg)}`}
                </title>
              </path>
              {/* Where D-I's share sits on the same radial scale. */}
              <path d={`M ${ax0} ${ay0} A ${lgR} ${lgR} 0 0 1 ${ax1} ${ay1}`} fill="none"
                stroke="var(--ink-soft)" strokeWidth={1} strokeDasharray="2 2" opacity={0.65} />
              <text x={lx} y={ly - 3} textAnchor="middle" fontSize={8} fill="var(--ink)" className="tabular">
                {pct1(r.rate)}
              </text>
              <text x={lx} y={ly + 6} textAnchor="middle" fontSize={7.5} fill={t.fg} className="tabular">
                {pps(r.efg)}
              </text>
            </g>
          );
        })}

        <circle cx={cx} cy={cy} r={R0 - 2} fill="var(--paper)" stroke="var(--hairline)" />
        <text x={cx} y={cy - 2} textAnchor="middle" fontSize={6} fill="var(--ink-muted)" letterSpacing="0.1em">
          SHARE
        </text>
        <text x={cx} y={cy + 6} textAnchor="middle" fontSize={6} fill="var(--ink-muted)" letterSpacing="0.1em">
          PTS/SHOT
        </text>
      </svg>
    </div>
  );
}
