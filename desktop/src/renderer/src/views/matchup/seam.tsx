import { useId, type ReactNode } from "react";
import {
  SIGMA,
  counterfactuals,
  displayScores,
  fmt1,
  fmtSigned,
  fmtWin,
  type MatchupPack,
  type MatchupTeam,
  type Projection,
  type Site,
} from "@/lib/matchup";
import { teamShortName } from "@/lib/team-names";
import { useTween } from "@/lib/use-tween";
import { TeamLogo } from "~/ui/logo";
import { useMeasuredWidth } from "~/ui/use-measured-width";
import { logoIdOf } from "~/ui/logo-id";
import { TeamPicker } from "./team-picker";

export type Side = "a" | "b";

/**
 * The answer: the card cut in two at the win probability.
 *
 * THE SITE'S SEAM (src/components/matchup/matchup-view.tsx). The favorite's
 * half is as wide as its share of the games, so the odds are felt before they
 * are read, and the cut slides when a player is ruled out or the floor changes,
 * because the widths are the tweened probability. Each half owns its team:
 * crest, name (which is also the control that changes the team), score, odds.
 *
 * Under it, the receipt: the margin's distribution drawn to scale, whose area
 * either side of even IS the split above, and what would change it.
 */
export function SeamCard({
  pack,
  p,
  teams,
  picking,
  setPicking,
  onPick,
  onOpenTeam,
  onSite,
  onToggle,
}: {
  pack: MatchupPack;
  p: Projection;
  teams: MatchupTeam[];
  picking: Side | null;
  setPicking: (side: Side | null) => void;
  onPick: (side: Side, slug: string) => void;
  onOpenTeam: (team: MatchupTeam, newTab: boolean) => void;
  onSite: (site: Site) => void;
  onToggle: (side: Side, i: number) => void;
}) {
  const { a, b } = p;
  const scoreA = useTween(p.scoreA);
  const scoreB = useTween(p.scoreB);
  const winA = useTween(p.winA);
  const marginT = useTween(p.margin);
  const [showA, showB] = displayScores(scoreA, scoreB);
  const favorite = p.margin >= 0 ? a : b;

  // In percent, not as fractions of one: flex factors that sum to less than 1
  // hand out only that fraction of the free space. The floor keeps an underdog's
  // name, record and numbers whole when the model is sure.
  const cols = `minmax(max(220px, 26%), ${Math.max(2, winA * 100)}fr) minmax(max(220px, 26%), ${Math.max(2, (1 - winA) * 100)}fr)`;

  return (
    <section aria-label="Projection" className="overflow-hidden rounded-xl border border-hairline bg-card">
      <div
        className="relative isolate grid"
        // The left team's wash is painted edge to edge here rather than on its
        // half: the cut leans, so along the boundary a sliver of the second
        // track belongs to the first team.
        style={{ gridTemplateColumns: cols, background: "color-mix(in srgb, var(--ma-fill) var(--ma-wash), var(--card))" }}
      >
        <Half
          side="a"
          team={a}
          other={b}
          teams={teams}
          score={showA}
          win={winA}
          hosting={p.site === "home"}
          open={picking === "a"}
          setOpen={(o) => setPicking(o ? "a" : null)}
          onPick={(slug) => onPick("a", slug)}
          onOpenTeam={onOpenTeam}
        />
        <Half
          side="b"
          team={b}
          other={a}
          teams={teams}
          score={showB}
          win={1 - winA}
          hosting={p.site === "away"}
          open={picking === "b"}
          setOpen={(o) => setPicking(o ? "b" : null)}
          onPick={(slug) => onPick("b", slug)}
          onOpenTeam={onOpenTeam}
          seam
        />
      </div>

      <div className="grid grid-cols-1 items-center gap-x-8 gap-y-3 border-t border-hairline px-7 py-4 @3xl:grid-cols-[228px_minmax(0,1fr)]">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
          {/* The name in proportional figures: tabular ones give "St." a digit-wide period. */}
          <Stat
            className="col-span-2"
            label="Margin"
            value={
              <>
                <span className="normal-nums">{favorite.b}</span> by {fmt1(Math.abs(p.margin))}
              </>
            }
          />
          <Stat label="Pace" value={fmt1(p.pace)} title="Projected possessions for each team" />
          {/* THE TOTAL IS THE WEAKEST NUMBER HERE and is drawn to say so, as on
              the site. It is the sum of the two printed scores, so a reader who
              adds them gets the same figure. */}
          <Stat
            label="Total"
            value={`${showA + showB}`}
            muted
            title="The least reliable number here. The margin lands within a third of a point of a closing betting line on average; the total does not, and the model's disagreements with a total line were wrong more often than right."
          />
        </dl>
        <MarginCurve margin={marginT} a={a.b} b={b.b} />
      </div>

      <WhatWouldItTake pack={pack} p={p} onSite={onSite} onToggle={onToggle} />
    </section>
  );
}

function Half({
  side,
  team,
  other,
  teams,
  score,
  win,
  hosting,
  open,
  setOpen,
  onPick,
  onOpenTeam,
  seam = false,
}: {
  side: Side;
  team: MatchupTeam;
  other: MatchupTeam;
  teams: MatchupTeam[];
  score: number;
  win: number;
  hosting: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  onPick: (slug: string) => void;
  onOpenTeam: (team: MatchupTeam, newTab: boolean) => void;
  /** Draw the cut on this half's leading edge. */
  seam?: boolean;
}) {
  const right = side === "b";
  const ink = right ? "var(--mb)" : "var(--ma)";
  return (
    <div className={`relative flex min-h-[220px] min-w-0 flex-col justify-between gap-6 px-7 pb-6 pt-5 ${right ? "text-right" : ""}`}>
      {seam && (
        <>
          {/* The wash and the cut are the same skew, so the color boundary and
              the line agree along their whole length. The overspill is
              clipped by the card. */}
          <span
            aria-hidden
            className="matchup-wash absolute inset-0 -z-10"
            style={{ background: "color-mix(in srgb, var(--mb-fill) var(--ma-wash), var(--card))" }}
          />
          <span aria-hidden className="matchup-seam bg-ink" />
        </>
      )}

      <div className={`flex min-w-0 items-center gap-3 ${right ? "flex-row-reverse" : ""}`}>
        <button
          type="button"
          title={`Open ${team.b}  ·  Ctrl-click for a new tab`}
          aria-label={`Open ${team.b}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => onOpenTeam(team, e.ctrlKey || e.metaKey)}
          className="shrink-0 rounded-lg p-0.5 transition-transform duration-150 hover:scale-[1.05]"
        >
          <TeamLogo id={logoIdOf(team.b)} name={team.b} size={46} />
        </button>
        <div className={`flex min-w-0 flex-col ${right ? "items-end" : "items-start"}`}>
          <TeamPicker
            label={right ? "Right team" : "Left team"}
            hotkey={right ? "B" : "A"}
            team={team}
            other={other}
            teams={teams}
            open={open}
            onOpenChange={setOpen}
            onPick={onPick}
            align={right ? "right" : "left"}
          />
          <div className={`mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-[12.5px] text-ink-muted tabular ${right ? "justify-end" : ""}`}>
            <span>{team.c ?? "Independent"}</span>
            <Dot />
            <span>
              {team.w}–{team.l}
            </span>
            {team.br != null && (
              <>
                <Dot />
                <span className="font-medium" style={{ color: ink }} title="BTA rank">
                  #{team.br}
                </span>
              </>
            )}
            {hosting && (
              <>
                <Dot />
                <span className="rounded-[4px] bg-[color-mix(in_oklab,var(--ink)_8%,transparent)] px-1.5 py-px text-[11px] font-medium text-ink-soft">
                  Home
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className={`flex items-end justify-between gap-4 ${right ? "flex-row-reverse" : ""}`}>
        <div>
          <div className="text-[60px] font-semibold leading-[0.78] tracking-[-0.05em] text-ink tabular @4xl:text-[84px]">{score}</div>
          <div className="mt-2.5 text-[12px] text-ink-muted">Projected</div>
        </div>
        <div>
          <div className="text-[22px] font-semibold leading-none tracking-[-0.01em] tabular" style={{ color: ink }}>
            {fmtWin(win)}
          </div>
          <div className="mt-2 text-[12px] text-ink-muted">Win probability</div>
        </div>
      </div>
    </div>
  );
}

const Dot = () => (
  <span aria-hidden className="text-hairline">
    ·
  </span>
);

function Stat({
  label,
  value,
  muted = false,
  title,
  className = "",
}: {
  label: string;
  value: ReactNode;
  /** A step back, for a number the model does not stand behind. */
  muted?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <div title={title} className={`min-w-0 ${title ? "cursor-help" : ""} ${className}`}>
      <dt className="text-[12px] text-ink-muted">
        {label}
        {muted && <span aria-hidden> *</span>}
      </dt>
      <dd className={`mt-0.5 text-balance text-[16px] leading-tight tabular ${muted ? "font-medium text-ink-muted" : "font-semibold text-ink"}`}>
        {value}
      </dd>
    </div>
  );
}

/**
 * The margin's distribution, to scale, in real pixels.
 *
 * ONE BELL, MOVED. σ is a constant in the model, so the shape never changes,
 * only where it sits. A team's share of the area IS its win probability.
 *
 * THE AXIS RUNS THE SAME WAY AS THE CARD, as the site's does: the left team's
 * outcomes are on the left, in the left team's color, so the ticks carry no
 * signs; which side a tick is on says whose points they are. The clip regions
 * stay fixed at even and the bell's position is baked into its path, because a
 * clip under a transform moves with it (the site's curve once always split at
 * the peak for that reason).
 */
function MarginCurve({ margin, a, b }: { margin: number; a: string; b: string }) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  const id = useId().replace(/:/g, "");
  const W = Math.max(320, Math.floor(width));
  const H = 112;
  const PAD = 6;
  const BASE = H - 22;
  const TOP = 22;
  const RANGE = 40;
  const px = (W - 2 * PAD) / (2 * RANGE);
  const zero = PAD + RANGE * px;
  const sig = SIGMA * px;
  const center = zero - Math.max(-RANGE, Math.min(RANGE, margin)) * px;

  const pts: string[] = [];
  for (let x = PAD; x <= W - PAD; x += 3) {
    const z = (x - center) / sig;
    pts.push(`${x},${(BASE - (BASE - TOP) * Math.exp(-0.5 * z * z)).toFixed(1)}`);
  }
  const area = `M${PAD},${BASE} L${pts.join(" L")} L${W - PAD},${BASE} Z`;
  const line = `M${pts.join(" L")}`;
  const label = { fontSize: 11 } as const;

  return (
    <div ref={ref} className="min-w-0">
      {width > 0 && (
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          className="block"
          aria-label={`Projected margin ${fmtSigned(margin)} for ${a}. ${a} wins the games left of even, ${b} the games right of it; each side's share of the area is its win probability.`}
        >
          <defs>
            <clipPath id={`${id}-l`}>
              <rect x="0" y="0" width={zero} height={H} />
            </clipPath>
            <clipPath id={`${id}-r`}>
              <rect x={zero} y="0" width={W - zero} height={H} />
            </clipPath>
          </defs>
          <path d={area} style={{ fill: "var(--ma-fill)", fillOpacity: 0.32 }} clipPath={`url(#${id}-l)`} />
          <path d={area} style={{ fill: "var(--mb-fill)", fillOpacity: 0.32 }} clipPath={`url(#${id}-r)`} />
          <path d={line} style={{ fill: "none", stroke: "var(--ink)", strokeOpacity: 0.5, strokeWidth: 1.25 }} />
          <line x1={PAD} x2={W - PAD} y1={BASE} y2={BASE} style={{ stroke: "var(--hairline)", strokeWidth: 1 }} />
          {/* Even stays put: the game's one fixed point. The dashed line is the projection. */}
          <line x1={zero} x2={zero} y1={BASE} y2={TOP - 8} style={{ stroke: "var(--ink)", strokeOpacity: 0.3, strokeWidth: 1 }} />
          <line
            x1={center}
            x2={center}
            y1={BASE}
            y2={TOP - 2}
            strokeDasharray="2 3"
            style={{ stroke: "var(--ink)", strokeOpacity: 0.85, strokeWidth: 1 }}
          />
          {[-30, -20, -10, 10, 20, 30].map((t) => (
            <g key={t}>
              <line x1={zero + t * px} x2={zero + t * px} y1={BASE} y2={BASE + 3} style={{ stroke: "var(--hairline)" }} />
              <text x={zero + t * px} y={H - 5} textAnchor="middle" className="tabular" style={{ ...label, fill: "var(--ink-muted)" }}>
                {Math.abs(t)}
              </text>
            </g>
          ))}
          <text x={zero} y={H - 5} textAnchor="middle" style={{ ...label, fill: "var(--ink-soft)", fontWeight: 600 }}>
            Even
          </text>
          <text x={PAD} y={12} textAnchor="start" style={{ ...label, fill: "var(--ma)", fontWeight: 600 }}>
            {`← ${teamShortName(a)} wins`}
          </text>
          <text x={W - PAD} y={12} textAnchor="end" style={{ ...label, fill: "var(--mb)", fontWeight: 600 }}>
            {`${teamShortName(b)} wins →`}
          </text>
        </svg>
      )}
    </div>
  );
}

/**
 * Each chip is a full projection with one thing changed (lib/matchup.ts
 * counterfactuals), and clicking it makes that the page.
 */
function WhatWouldItTake({
  pack,
  p,
  onSite,
  onToggle,
}: {
  pack: MatchupPack;
  p: Projection;
  onSite: (site: Site) => void;
  onToggle: (side: Side, i: number) => void;
}) {
  const chips = counterfactuals(pack, p);
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-hairline px-7 py-3">
      <span className="mr-1 text-[12px] text-ink-muted">What would it take</span>
      {chips.map((c) => {
        const d = c.win - p.winA;
        const pts = Math.abs(Math.round(d * 100));
        return (
          <button
            key={c.key}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if ("site" in c.change) onSite(c.change.site);
              else if ("outA" in c.change) onToggle("a", c.change.outA);
              else onToggle("b", c.change.outB);
            }}
            title={`${p.a.b} ${fmtWin(c.win)}, ${d >= 0 ? "up" : "down"} ${pts} from ${fmtWin(p.winA)}`}
            className="inline-flex h-[26px] items-center gap-2 rounded-md border border-hairline bg-paper px-2.5 text-[12px] text-ink-soft transition-colors hover:border-ink-muted hover:text-ink"
          >
            <span>{c.label}</span>
            <span className="inline-flex items-center gap-1 font-semibold tabular" style={{ color: "var(--ma)" }}>
              <TeamLogo id={logoIdOf(p.a.b)} name={p.a.b} size={13} />
              {fmtWin(c.win)}
            </span>
            <span
              className="text-[11px] tabular"
              style={{ color: d > 0 ? "var(--ma)" : d < 0 ? "var(--mb)" : "var(--ink-muted)" }}
            >
              {d > 0 ? "▲" : d < 0 ? "▼" : "•"}
              {pts}
            </span>
          </button>
        );
      })}
    </div>
  );
}
