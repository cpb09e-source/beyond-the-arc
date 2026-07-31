import { STYLE_DIMENSIONS, type CoachStyle } from "@/lib/coaches";
import { PercentileChip, pctColor, pctBg } from "@/components/percentile-chip";
import { cn } from "@/lib/utils";

/**
 * Style fingerprint — what kind of basketball a coach's teams played, against
 * every other coach in the window.
 *
 * The rest of the profile answers "how good?". Nothing on it answered "what
 * kind?", even though the nine rates behind that question were already joined
 * per season to power the explorer's filters.
 *
 * THE ENCODING IS THE DESIGN DECISION. Raw values cannot carry this: the middle
 * 90% of coaches sit inside about seven possessions of pace, so 68.4 means
 * nothing to a reader. Only the rank against the field does. Bars therefore run
 * from the centre — left of the median or right of it, by percentile — which
 * makes "extreme in both directions" (Bennett: slowest tempo, best defence)
 * read instantly, and makes the majority look boringly central, which is true.
 *
 * A RADAR, deliberately, having previously argued against one here. The old
 * objection stands on its own terms — polygon AREA scales with the square of
 * the values, so it overstates every difference, and the shape depends on an
 * axis order that carries no meaning. Two things answer it. The fill is held
 * faint and the reading is carried by the vertices and the dashed median ring,
 * so the eye compares distances along spokes rather than areas. And the axis
 * order is fixed and grouped — the six offensive dimensions, then the three
 * defensive ones — so the silhouette means the same thing on every coach's
 * page, which is the entire point of a fingerprint: Bennett and Huggins should
 * be different SHAPES, not different bar lengths.
 *
 * COLOURED BY THE SITE PERCENTILE RAMP, also a reversal. The caution behind the
 * old choice was real and has not gone away: playing fast is not an
 * achievement, and a red chip on Tempo does not mean a coach is bad at tempo.
 * What the ramp buys is that a reader already knows what it means everywhere
 * else on the site, and the footnote says out loud that here it marks WHERE in
 * the field a coach sits rather than whether that is good.
 */

export function CoachStylePanel({
  styleAvg,
  stylePct,
}: {
  styleAvg: CoachStyle | null | undefined;
  stylePct: CoachStyle | null | undefined;
}) {
  // 30 of 804 coaches have no style at all — too few joined team-seasons.
  // They get nothing rather than a panel of dashes.
  if (!styleAvg || !stylePct || typeof styleAvg.pace !== "number") return null;


  return (
    /* Sized to its content and dropped straight into the coach header, so it
       carries no heading of its own — the header already names the coach, and
       this is the shape of how his teams played, read alongside it. */
    <div className="flex flex-col sm:flex-row sm:items-center gap-x-8 gap-y-6">
      <StyleRadar stylePct={stylePct} />
      <div className="grid grid-cols-2 gap-x-8 gap-y-5">
        {(["Offense", "Defense"] as const).map((group) => (
          <div key={group} className="w-[15rem]">
            <div className="text-[0.55rem] uppercase tracking-[0.18em] text-coral font-bold mb-2 flex items-center gap-1.5">
              <span className="h-px w-4 bg-coral" />
              {group}
            </div>
            <ul className="space-y-1.5">
              {STYLE_DIMENSIONS.filter((d) => d.group === group).map((d) => (
                <StyleRow
                  key={d.key}
                  label={d.label}
                  unit={d.unit}
                  value={styleAvg[d.key]}
                  pct={stylePct[d.key]}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The fingerprint itself.
 *
 * Nine spokes in a FIXED order — the six offensive dimensions clockwise from
 * the top, then the three defensive ones — so the same silhouette means the
 * same thing on every coach's page. That fixed order is what makes the shape
 * comparable; a radar whose axes are sorted per subject is decoration.
 *
 * The fill is deliberately faint. Polygon area grows with the square of the
 * radius, so a filled radar overstates every difference; the reading is meant
 * to come from where the vertices sit against the dashed median ring, not from
 * how much ink is inside them.
 *
 * A vertex is drawn at its percentile from the centre, with a floor so that a
 * 0th-percentile dimension is still a visible point rather than collapsing
 * into the middle and taking two neighbouring edges with it. Bennett's tempo
 * is exactly that case.
 */
function StyleRadar({ stylePct }: { stylePct: CoachStyle }) {
  const dims = STYLE_DIMENSIONS.map((d) => ({ d, p: stylePct[d.key] }))
    .filter((e): e is { d: (typeof STYLE_DIMENSIONS)[number]; p: number } => typeof e.p === "number");
  if (dims.length < 3) return null;

  const S = 320, C = S / 2, R = 112, FLOOR = 11;
  const n = dims.length;
  const at = (i: number, r: number): [number, number] => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [C + Math.cos(a) * r, C + Math.sin(a) * r];
  };
  const radius = (p: number) => FLOOR + (Math.max(0, Math.min(100, p)) / 100) * (R - FLOOR);
  const poly = dims.map((e, i) => at(i, radius(e.p)).join(",")).join(" ");

  return (
    <div className="w-full max-w-[21rem] shrink-0 mx-auto sm:mx-0">
      <svg
        viewBox={`0 0 ${S} ${S}`}
        className="w-full h-auto overflow-visible"
        role="img"
        aria-label={`Style fingerprint: ${dims.map((e) => `${e.d.label} ${Math.round(e.p)}th percentile`).join(", ")}`}
      >
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <circle key={f} cx={C} cy={C} r={FLOOR + f * (R - FLOOR)}
                  fill="none" stroke="currentColor" className="text-ink/[0.07]" />
        ))}
        {/* the median coach */}
        <circle cx={C} cy={C} r={radius(50)} fill="none" stroke="currentColor"
                strokeDasharray="3 4" className="text-ink/25" />
        {dims.map((e, i) => {
          const [x, y] = at(i, R);
          return <line key={e.d.key} x1={C} y1={C} x2={x} y2={y}
                       stroke="currentColor" className="text-ink/[0.06]" />;
        })}
        <polygon points={poly} className="fill-coral/15 stroke-coral" strokeWidth={1.75} strokeLinejoin="round" />
        {dims.map((e, i) => {
          const [x, y] = at(i, radius(e.p));
          return (
            <circle key={e.d.key} cx={x} cy={y} r={4.5}
                    fill={pctBg(e.p)} stroke={pctColor(e.p)} strokeWidth={1.5} />
          );
        })}
        {dims.map((e, i) => {
          const [x, y] = at(i, R + 22);
          const anchor = Math.abs(x - C) < 10 ? "middle" : x > C ? "start" : "end";
          return (
            <text key={e.d.key} x={x} y={y} textAnchor={anchor} dominantBaseline="middle"
                  className="fill-ink-muted text-[11px]">
              {e.d.label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function StyleRow({
  label, unit, value, pct,
}: {
  label: string;
  unit: "" | "%";
  value: number | null;
  pct: number | null;
}) {
  if (typeof value !== "number" || typeof pct !== "number") {
    return (
      <li className="flex items-center gap-2 text-sm">
        <span className="flex-1 text-ink-soft">{label}</span>
        <span className="text-ink-muted/60 text-xs">no data</span>
      </li>
    );
  }
  // No deviation bar here any more — the radar states the position, and
  // repeating it as a bar said the same thing twice in the same panel.
  return (
    <li className="flex items-center gap-2">
      <span className="flex-1 min-w-0 truncate text-[0.9rem] text-ink-soft">{label}</span>
      <span className="w-16 shrink-0 text-right text-[0.9rem] font-semibold text-ink tabular">
        {value.toFixed(1)}{unit}
      </span>
      <PercentileChip pct={Math.round(pct)} className="shrink-0" />
    </li>
  );
}
