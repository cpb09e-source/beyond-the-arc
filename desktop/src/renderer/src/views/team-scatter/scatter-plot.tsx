import { useEffect, useId, useMemo, useRef, useState } from "react";
import { PercentileChip } from "@/components/percentile-chip";
import { confDisplay } from "@/lib/conf-display";
import type { ScatterTeam } from "@/lib/scatter-team";
import { fmtMetric, fmtTick, niceTicks, tickCount, type Metric } from "@/lib/team-scatter-metrics";
import { zonePolygon, type Zone } from "@/lib/trapezoid";
import { TeamLogo } from "~/ui/logo";

/**
 * The team scatter's plot: crests on two metrics, the contender zone beneath.
 *
 * THE SITE'S PLOT, REDRAWN FOR A WINDOW. Every rule on btacbb.xyz/teams/scatter
 * carries over, because each was paid for there: the frame fits the selection
 * (not the country) but widens to the zone's top corners; an axis whose metric
 * is lower-is-better runs backwards so better is always up and right; crests
 * are nudged apart only while there are forty or fewer; the best teams paint
 * last so they sit on top; teams outside the zone step back rather than vanish.
 * What changes is the box: here it is the whole remaining window, measured, so
 * the crests grow with it.
 */

const L = 58;
const R = 22;
const T = 18;
const B = 46;

/** Crest size from the room each mark gets, floored at 16 and capped at 30 (the site's rule). */
function crestSize(n: number, w: number, h: number): number {
  return Math.max(16, Math.min(30, Math.round(Math.sqrt((w * h) / Math.max(1, n)) * 0.4)));
}

const isNum = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

export function ScatterPlot({
  teams,
  shown,
  xM,
  yM,
  zone,
  inZone,
  hover,
  setHover,
  onOpen,
  pct,
}: {
  teams: ScatterTeam[];
  shown: ScatterTeam[];
  xM: Metric;
  yM: Metric;
  zone: Zone | null;
  inZone: Set<string>;
  hover: string | null;
  setHover: (name: string | null) => void;
  onOpen: (team: ScatterTeam, newTab: boolean) => void;
  pct: (key: string, name: string) => number | null;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ W: 900, H: 640 });
  const clipId = useId();

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setBox({ W: Math.max(320, Math.round(entry.contentRect.width)), H: Math.max(260, Math.round(entry.contentRect.height)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const { W, H } = box;

  const geo = useMemo(() => {
    const pick = (src: ScatterTeam[], k: string) => src.map((t) => t.m[k]).filter(isNum);
    const base = shown.length ? shown : teams;
    const xs = pick(base, xM.key);
    const ys = pick(base, yM.key);
    const pad = (a: number[]): [number, number] => {
      if (a.length === 0) return [0, 1];
      const lo = Math.min(...a);
      const hi = Math.max(...a);
      const m = (hi - lo) * 0.07 || 1;
      return [lo - m, hi + m];
    };
    const [y0, y1] = pad(ys);
    let [x0, x1] = pad(xs);
    // Widened to the zone's top corners so both slants stay slants (the site's rule).
    if (zone) {
      const h = zone.halfAt(y1) + 0.25;
      x0 = Math.min(x0, zone.centre - h);
      x1 = Math.max(x1, zone.centre + h);
    }
    const X = (v: number) => {
      const t = (v - x0) / (x1 - x0);
      return L + (xM.lowerBetter ? 1 - t : t) * (W - L - R);
    };
    const Y = (v: number) => {
      const t = (v - y0) / (y1 - y0);
      return T + (yM.lowerBetter ? t : 1 - t) * (H - T - B);
    };
    return { X, Y, x0, x1, y0, y1 };
  }, [teams, shown, xM, yM, W, H, zone]);
  const { X, Y } = geo;

  /** Division I's median on each axis: the one landmark that does not move with the selection. */
  const median = useMemo(() => {
    const med = (k: string) => {
      const v = teams.map((t) => t.m[k]).filter(isNum).sort((a, b) => a - b);
      return v.length ? v[Math.floor(v.length / 2)]! : null;
    };
    return { x: med(xM.key), y: med(yM.key) };
  }, [teams, xM, yM]);

  const size = crestSize(shown.length, W - L - R, H - T - B);

  const placed = useMemo(() => {
    const dodge = shown.length <= 40;
    const taken: Array<{ x: number; y: number }> = [];
    return shown
      .filter((p) => isNum(p.m[xM.key]) && isNum(p.m[yM.key]))
      .map((p) => {
        const bx = X(p.m[xM.key]!);
        const base = Y(p.m[yM.key]!);
        let by = base;
        if (dodge) {
          let step = 0;
          while (step < 14 && taken.some((q) => Math.abs(q.x - bx) < size * 0.8 && Math.abs(q.y - by) < size * 0.8)) {
            step++;
            by = base + (step % 2 ? 1 : -1) * Math.ceil(step / 2) * size * 0.85;
          }
          by = Math.max(T + size / 2, Math.min(H - B - size / 2, by));
          taken.push({ x: bx, y: by });
        }
        return { p, x: bx, y: by, base };
      });
  }, [shown, X, Y, size, xM, yM, H]);

  const zonePath = useMemo(() => {
    if (!zone) return null;
    const pts = zonePolygon(zone, geo.y1);
    return pts ? pts.map(([vx, vy]) => `${X(vx).toFixed(1)},${Y(vy).toFixed(1)}`).join(" ") : null;
  }, [zone, geo, X, Y]);

  const hovered = hover ? (placed.find((m) => m.p.name === hover) ?? null) : null;
  const directed = (m: Metric) => !m.neutral;

  return (
    <div ref={boxRef} className="relative h-full w-full select-none" onPointerLeave={() => setHover(null)}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="absolute inset-0" role="img" aria-label={`Teams by ${xM.label} against ${yM.label}`}>
        <defs>
          <clipPath id={clipId}>
            <rect x={L} y={T} width={Math.max(0, W - L - R)} height={Math.max(0, H - T - B)} />
          </clipPath>
        </defs>

        {/* Under the gridlines, so the ticks inside the shape read as the same scale. */}
        {zonePath && (
          <polygon
            points={zonePath}
            clipPath={`url(#${clipId})`}
            fill="color-mix(in oklab, var(--good) 9%, transparent)"
            stroke="var(--good)"
            strokeWidth={1.75}
            strokeLinejoin="round"
            opacity={0.9}
          />
        )}

        {niceTicks(geo.x0, geo.x1, tickCount(W - L - R, "x")).map((v) => (
          <g key={`x${v}`}>
            <line x1={X(v)} y1={T} x2={X(v)} y2={H - B} stroke="var(--hairline)" />
            <text x={X(v)} y={H - B + 14} textAnchor="middle" fontSize={11} fill="var(--ink-muted)" className="tabular">
              {fmtTick(xM, v)}
            </text>
          </g>
        ))}
        {niceTicks(geo.y0, geo.y1, tickCount(H - T - B, "y")).map((v) => (
          <g key={`y${v}`}>
            <line x1={L} y1={Y(v)} x2={W - R} y2={Y(v)} stroke="var(--hairline)" />
            <text x={L - 8} y={Y(v) + 3.5} textAnchor="end" fontSize={11} fill="var(--ink-muted)" className="tabular">
              {fmtTick(yM, v)}
            </text>
          </g>
        ))}

        {/* The D-I median on both axes, dashed: context that stays put when the selection changes. */}
        <g clipPath={`url(#${clipId})`} stroke="var(--ink-muted)" strokeWidth={1} strokeDasharray="3 4" opacity={0.55}>
          {median.x != null && <line x1={X(median.x)} y1={T} x2={X(median.x)} y2={H - B} />}
          {median.y != null && <line x1={L} y1={Y(median.y)} x2={W - R} y2={Y(median.y)} />}
        </g>
        {median.x != null && median.y != null && (
          <text x={Math.min(W - R - 4, X(median.x) + 6)} y={T + 12} fontSize={10.5} fill="var(--ink-muted)">
            D-I median
          </text>
        )}

        {placed.map(({ p, x, y, base }) =>
          Math.abs(y - base) > 1 ? (
            <line key={`lead-${p.name}`} x1={x} y1={base} x2={x} y2={y} stroke="var(--ink-muted)" strokeWidth={0.7} opacity={0.55} />
          ) : null,
        )}

        <text x={(L + W - R) / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--ink-soft)" letterSpacing="0.07em">
          {directed(xM) && <tspan fill="var(--bad)">← WORSE</tspan>}
          <tspan dx={directed(xM) ? 12 : 0} fontWeight={650}>
            {xM.label.toUpperCase()}
          </tspan>
          {directed(xM) && (
            <tspan dx={12} fill="var(--good)">
              BETTER →
            </tspan>
          )}
        </text>
        <text
          x={13}
          y={(T + H - B) / 2}
          fontSize={11}
          fill="var(--ink-soft)"
          letterSpacing="0.07em"
          textAnchor="middle"
          transform={`rotate(-90 13 ${(T + H - B) / 2})`}
        >
          {directed(yM) && <tspan fill="var(--bad)">← WORSE</tspan>}
          <tspan dx={directed(yM) ? 12 : 0} fontWeight={650}>
            {yM.label.toUpperCase()}
          </tspan>
          {directed(yM) && (
            <tspan dx={12} fill="var(--good)">
              BETTER →
            </tspan>
          )}
        </text>
      </svg>

      {/* Painted worst first, so the best teams sit on top of a crowd. */}
      {[...placed].reverse().map(({ p, x, y }) => {
        const lit = hover === p.name;
        const pad = size <= 16 ? 3 : 2;
        const dim = zone != null && !lit && !inZone.has(p.name);
        return (
          <div
            key={p.name}
            role="button"
            aria-label={`${p.name}, ${fmtMetric(xM, p.m[xM.key] ?? null)} ${xM.short}, ${fmtMetric(yM, p.m[yM.key] ?? null)} ${yM.short}`}
            onPointerEnter={() => setHover(p.name)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => onOpen(p, e.ctrlKey || e.metaKey)}
            className="absolute grid cursor-pointer place-items-center rounded-full motion-safe:transition-[opacity,filter,transform] motion-safe:duration-150"
            style={{
              left: x,
              top: y,
              width: size + pad * 2,
              height: size + pad * 2,
              transform: `translate(-50%, -50%) scale(${lit ? 1.45 : 1})`,
              zIndex: lit ? 50 : dim ? 1 : 2,
              opacity: dim ? 0.6 : 1,
              filter: dim ? "grayscale(0.35)" : undefined,
              background: "color-mix(in oklab, var(--paper) 88%, transparent)",
              boxShadow: lit
                ? "0 0 0 1.5px var(--accent)"
                : zone != null && !dim
                  ? "0 0 0 1px color-mix(in oklab, var(--good) 55%, transparent)"
                  : "0 0 0 0.5px var(--hairline)",
            }}
          >
            <TeamLogo id={p.id} name={p.name} size={size} />
          </div>
        );
      })}

      {hovered && <Card mark={hovered} W={W} H={H} xM={xM} yM={yM} inZone={inZone.has(hovered.p.name)} pct={pct} />}
    </div>
  );
}

/** The hovered team's numbers, anchored to its crest and flipped away from the edges. */
function Card({
  mark,
  W,
  H,
  xM,
  yM,
  inZone,
  pct,
}: {
  mark: { p: ScatterTeam; x: number; y: number };
  W: number;
  H: number;
  xM: Metric;
  yM: Metric;
  inZone: boolean;
  pct: (key: string, name: string) => number | null;
}) {
  const { p, x, y } = mark;
  const flipX = x / W > 0.58;
  const flipY = y / H < 0.26;
  const row = (m: Metric) => (
    <>
      <span className="text-ink-muted">{m.label}</span>
      <span className="text-right text-ink tabular">{fmtMetric(m, p.m[m.key] ?? null)}</span>
      <PercentileChip pct={pct(m.key, p.name)} neutral={m.neutral} className="min-w-[28px] px-1 py-[2px] text-[10.5px]" />
    </>
  );
  return (
    <div className="pointer-events-none absolute z-[60]" style={{ left: x, top: y }}>
      <div
        className="absolute w-max rounded-lg border border-hairline bg-card px-3 py-2"
        style={{
          [flipX ? "right" : "left"]: 18,
          [flipY ? "top" : "bottom"]: 14,
          boxShadow: "var(--overlay-shadow)",
        }}
      >
        <div className="flex items-center gap-2">
          <TeamLogo id={p.id} name={p.name} size={18} />
          <span className="text-[13.5px] font-semibold text-ink">{p.name}</span>
          <span className="text-[12px] text-ink-muted tabular">
            {p.record} · {confDisplay(p.conf)}
          </span>
        </div>
        <div className="mt-1.5 grid grid-cols-[auto_auto_auto] items-center gap-x-2.5 gap-y-1 text-[12px]">
          {row(xM)}
          {row(yM)}
        </div>
        {inZone && <div className="mt-1.5 text-[11.5px] font-medium text-good">Inside the contender zone</div>}
        <div className="mt-1 text-[11px] text-ink-muted">Click to open the team</div>
      </div>
    </div>
  );
}
