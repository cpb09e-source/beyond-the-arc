import type { ClockSplits } from "@/lib/static-data";

/**
 * When this team shoots, and how well — measured against the shot clock rather
 * than the game clock.
 *
 * THE NUMBER THAT MAKES THE PANEL WORTH READING is the eFG gap between the
 * bands. League-wide in 2026 it runs .547 early, .519 middle, .483 late: an
 * early look is worth about six and a half points of eFG over a late one. So a
 * team's band SHARES are not a stylistic curiosity, they are a large part of
 * why its offense rates where it does — and the defensive side is a scheme
 * signature, since forcing opponents into the last third of the clock is
 * something a defense does on purpose.
 *
 * DRAWN AS ONE BAR PER SIDE, NOT THREE COLUMNS. The shot clock is a single
 * 30-second axis, so the three bands are one distribution along it. Segment
 * width is how often the shot came from that stretch and the fill is how well
 * it went, which puts volume and quality in one object, read left to right in
 * the order the possession actually happens. The earlier version drew three
 * separate height-scaled bars, which made the reader assemble the distribution
 * themselves and left the eFG floating beside it as an unrelated number.
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
 * Re-measure these when the season is live — the means move as the sample
 * fills in, and a stale reference line silently biases every team's verdict.
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
const pct0 = (v: number) => `${Math.round(v * 100)}`;
const efg = (v: number | null) => (v == null ? "—" : v.toFixed(3).replace(/^0/, ""));
const signed = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)}`;

/**
 * Strength-scaled tint against the league line for that band and that side.
 *
 * THE VERDICT FLIPS ON DEFENSE and the panel used to not flip it: both sides
 * were colored `delta >= 0 ? good : bad`, so a defense holding opponents BELOW
 * the league eFG — the entire point of a defense — was painted red. Houston
 * allows .428 late against a .477 league and read as trouble.
 *
 * The dead zone is the other half of the fix. Half a point of eFG is noise,
 * and coloring it makes a dead-average band shout as loudly as a real edge.
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
      <p className="text-xs text-ink-muted mb-5 max-w-[52ch]">
        Where shots come from on the clock, and what they return against the D-I
        average for that stretch. An offensive rebound restarts the count, the
        way the shot clock does.
      </p>

      <div className="space-y-6">
        <Side title="Offense" rows={rowsFor(false)} def={false} />
        <Side title="Defense" rows={rowsFor(true)} def sub="what opponents were made to do" />
      </div>
    </div>
  );
}

function Side({
  title,
  sub,
  rows,
  def,
}: {
  title: string;
  sub?: string;
  rows: Row[];
  def: boolean;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-2">
        <h4 className="text-[0.62rem] uppercase tracking-[0.18em] font-semibold text-ink-soft">
          {title}
        </h4>
        {sub && <span className="text-[0.62rem] text-ink-muted">{sub}</span>}
      </div>

      <div className="flex rounded-lg overflow-hidden border border-hairline">
        {rows.map((r) => {
          const d = r.efg == null ? 0 : r.efg - r.lgEfg;
          const t = tint(d, def);
          return (
            <div
              key={r.key}
              // px-2 below sm: the Late band can be a quarter of a phone-width
              // column, and 2.5 of padding either side eats the eFG line.
              className="min-w-0 px-2 sm:px-2.5 py-2.5 border-r border-hairline last:border-r-0"
              style={{ width: `${(r.rate ?? 0) * 100}%`, background: t.bg }}
              title={`${r.label} (${r.window}): ${pct1(r.rate)} of shots at ${efg(r.efg)} eFG, against a D-I ${efg(r.lgEfg)}`}
            >
              <div className="text-[0.55rem] uppercase tracking-[0.14em] text-ink-muted leading-none truncate">
                {r.label}
              </div>
              <div className="text-[0.95rem] tabular font-semibold text-ink leading-none mt-1.5">
                {pct1(r.rate)}
              </div>
              <div className="text-[0.6rem] tabular leading-none mt-1.5 text-ink-soft truncate">
                {efg(r.efg)} eFG
              </div>
              <div
                className="text-[0.6rem] tabular leading-none mt-1 font-semibold truncate"
                style={{ color: t.fg }}
              >
                {r.efg == null ? "—" : signed(d)}
              </div>
            </div>
          );
        })}
      </div>

      {/* THE LEAGUE'S OWN SPLIT, at the same scale and directly underneath. It
          turns "this team is three points later than D-I" into a visible offset
          between two boundaries instead of a subtraction the reader performs. */}
      <div className="flex h-2 mt-1 gap-px" aria-hidden>
        {rows.map((r) => (
          <div
            key={r.key}
            className="bg-ink-muted/35 first:rounded-l-full last:rounded-r-full"
            style={{ width: `${r.lgRate * 100}%` }}
          />
        ))}
      </div>
      <div className="text-[0.55rem] uppercase tracking-[0.12em] text-ink-muted mt-1">
        D-I {rows.map((r) => pct0(r.lgRate)).join(" · ")}
      </div>
    </div>
  );
}
