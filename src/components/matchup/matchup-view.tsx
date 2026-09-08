"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, Check, Link2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { TeamLogo } from "@/components/team-logo";
import { TeamName } from "@/components/team-name";
import { teamShortName } from "@/lib/team-names";
import { SearchableSelect, type SearchableOption } from "@/components/explorer/searchable-select";
import { getTeamColors, readableInk, readableOnPaper } from "@/lib/team-colors";
import {
  HCA,
  SIGMA,
  fmt1,
  fmtPct,
  displayScores,
  OUT_SHARE_WARN,
  fmtSigned,
  outShare,
  playerCost,
  project,
  type MatchupPack,
  type MatchupTeam,
  type Projection,
  type Site,
} from "@/lib/matchup";

/**
 * The Matchup Predictor, drawn.
 *
 * Presentational and nothing else: it takes a projection and paints it. The
 * same component is the prerendered fallback (no handlers, controls inert)
 * and the live page (handlers wired), so the HTML a crawler indexes is the
 * HTML a reader sees a second later — there is no "Loading…" state to swap
 * out, and no layout shift when the pack arrives.
 *
 * WHAT IS ON THE PAGE AND WHY, in the order the research ranked it
 * (docs/matchup-predictor.md):
 *
 *   1. The answer — the card cut at the win probability, each team's score
 *      on its own side. Large.
 *   2. The site selector, as a headline control rather than a checkbox. It is
 *      worth up to ~4.9 points, which is more than every style term together.
 *   3. The arithmetic, printed. The one thing the competition does well.
 *   4. Availability toggles — the largest single addition to the model, and
 *      the one input a team rating is structurally blind to. In or out; there
 *      is no minutes editor because the roster's LEVEL adds nothing.
 *
 * The style panel (each team's tendencies against what the other concedes)
 * was here and was cut: it described the game without deciding it, and the
 * four terms that do carry weight are already lines in the ledger.
 */

export type MatchupHandlers = {
  onTeamA: (slug: string) => void;
  onTeamB: (slug: string) => void;
  onSite: (site: Site) => void;
  onSwap: () => void;
  onToggleA: (i: number) => void;
  onToggleB: (i: number) => void;
  onClearOut: () => void;
  /** Back to the default pair, floor and rotations. Absent when already there. */
  onReset?: () => void;
};

export function MatchupView({
  pack,
  projection: p,
  options,
  groupLabels,
  handlers,
  loading = false,
  error = false,
}: {
  pack: MatchupPack;
  projection: Projection;
  /** Every team, for the pickers. Absent while the full pack has not arrived. */
  options?: SearchableOption[];
  groupLabels?: Record<string, string>;
  /** Absent in the prerendered fallback — controls draw but do nothing. */
  handlers?: MatchupHandlers;
  loading?: boolean;
  /** Set when the full pack could not be fetched. */
  error?: boolean;
}) {
  const { a, b } = p;
  /**
   * Each team's color as TEXT, in both themes. Michigan's navy is a 1.4:1
   * against the dark ground and Iowa's gold is 1.4:1 against the cream one,
   * so one color cannot serve both. The pair is set here as variables and
   * the stylesheet picks — see .matchup-root in globals.css — which keeps the
   * chosen value out of inline styles, where a theme rule could not reach it.
   */
  const inkA = teamInk(a.b), inkB = teamInk(b.b);
  // Ink for anything read; fill for anything only seen. See .matchup-root.
  const colorA = "var(--ma)", colorB = "var(--mb)";
  const fillA = "var(--ma-fill)", fillB = "var(--mb-fill)";
  const inert = !handlers;
  const outCount = p.outA.length + p.outB.length;
  const scoreA = useTween(p.scoreA), scoreB = useTween(p.scoreB), winA = useTween(p.winA);
  const [showA, showB] = displayScores(scoreA, scoreB);
  const favorite = p.margin >= 0 ? a : b;

  return (
    <div
      className="matchup-root mx-auto max-w-5xl"
      style={{
        ["--ma-light" as string]: inkA.light, ["--ma-dark" as string]: inkA.dark, ["--ma-brand" as string]: inkA.brand,
        ["--mb-light" as string]: inkB.light, ["--mb-dark" as string]: inkB.dark, ["--mb-brand" as string]: inkB.brand,
      }}
    >
      {error && (
        <p role="status" className="mb-3 rounded-lg border border-hairline bg-paper-deep/40 px-3 py-2 text-xs text-ink-soft">
          Could not load the full team list — showing the default matchup only.{" "}
          <button type="button" onClick={() => window.location.reload()} className="font-semibold text-coral hover:underline">Retry</button>
        </p>
      )}

      {/* ── Controls ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 md:gap-4 items-end">
        <Picker label="Team" team={a} options={options} groupLabels={groupLabels}
          onChange={handlers?.onTeamA} disabled={inert || loading} />

        <div className="flex flex-col items-center gap-2 order-first md:order-0">
          <SiteControl site={p.site} a={a} onSite={handlers?.onSite} disabled={inert} />
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={handlers?.onSwap}
              disabled={inert}
              className="inline-flex items-center gap-1.5 text-[0.6rem] uppercase tracking-[0.15em] font-semibold text-ink-muted hover:text-ink transition-colors disabled:opacity-60"
              title="Swap the two teams"
            >
              <ArrowLeftRight className="h-3 w-3" aria-hidden />
              Swap
            </button>
            <ShareButton disabled={inert} />
            {handlers?.onReset && (
              <button
                type="button"
                onClick={handlers.onReset}
                className="inline-flex items-center gap-1.5 text-[0.6rem] uppercase tracking-[0.15em] font-semibold text-ink-muted hover:text-ink transition-colors"
                title="Back to the default matchup"
              >
                <RotateCcw className="h-3 w-3" aria-hidden />
                Reset
              </button>
            )}
          </div>
        </div>

        <Picker label="Opponent" team={b} options={options} groupLabels={groupLabels}
          onChange={handlers?.onTeamB} disabled={inert || loading} align="right" />
      </div>

      {/* ── The answer ──────────────────────────────────────────────────── */}
      <section className="mt-5 border border-hairline rounded-xl shadow-sm bg-paper-deep/25 overflow-hidden">
        {/* THE SEAM. The card is cut in two at the win probability: the
            favorite's half is as wide as its share of the games, so the odds
            are felt before they are read, and the cut moves when a player is
            ruled out or the floor changes. Each side owns its half, score and
            all. The fr values are the tweened probability, which is what makes
            the seam slide rather than jump. The floor keeps the underdog's
            name and record on one line each when the model is sure — 26% is
            what "Michigan St." beside its logo needs at 2xl — so a 90%
            favorite gets 74% of the width, and the exact number is printed
            on the card either way. The ratings themselves are not repeated
            here; the ledger below shows them in the arithmetic. */}
        <div
          className="relative grid isolate"
          // In percent, not as a fraction of one: flex factors that sum to
          // less than 1 hand out only that fraction of the free space, and
          // 0.84fr + 0.16fr left a sixth of the card empty.
          //
          // The LEFT team's wash is painted here, edge to edge, rather than
          // on its half: the cut leans, so at the top a sliver of the right
          // column belongs to the left team, and a half ends at the grid
          // line. The right team's wash is a skewed layer inside its half.
          style={{
            gridTemplateColumns: `minmax(max(150px, 26%), ${Math.max(2, winA * 100)}fr) minmax(max(150px, 26%), ${Math.max(2, (1 - winA) * 100)}fr)`,
            background: `color-mix(in srgb, ${fillA} var(--ma-wash), transparent)`,
          }}
        >
          <Half team={a} color={colorA} fill={fillA} season={pack.season} side="left" score={showA} win={winA} hosting={p.site === "home"} />
          <Half team={b} color={colorB} fill={fillB} season={pack.season} side="right" score={showB} win={1 - winA} hosting={p.site === "away"} seam />
        </div>

        <div className="px-4 sm:px-6 pt-4 pb-5">
          <dl className="grid grid-cols-3 gap-2 sm:flex sm:gap-8">
            <Stat label="Margin" value={`${favorite.b} by ${fmt1(Math.abs(p.margin))}`} />
            <Stat label="Pace" value={fmt1(p.pace)} />
            <Stat label="Total" value={`${Math.round(p.total)}`} />
          </dl>

          {/* The receipt. The split above is not a number someone typed: it
              is the area under this curve on each side of zero, drawn to
              scale — σ is 11 points of margin, so even a clear favorite leaves
              a lot of the other color showing. Fast games are wider, not more
              upset-prone; the total's range says so while the curve keeps its
              shape. */}
          <div className="mt-3">
            <MarginCurve margin={p.margin} colorA={fillA} colorB={fillB} a={a.b} b={b.b} />
          </div>

          <Counterfactuals pack={pack} p={p} handlers={handlers} colorA={colorA} colorB={colorB} />
        </div>
      </section>

      <div className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        {/* ── The arithmetic ──────────────────────────────────────────── */}
        <Card
          title="How the number is made"
          note="Every step, so the projection can be argued with."
          aside={
            <Link
              href="/matchup/method/"
              className="shrink-0 whitespace-nowrap text-[0.6rem] uppercase tracking-[0.15em] font-semibold text-coral hover:underline"
            >
              How this works
            </Link>
          }
        >
          <Ledger p={p} pack={pack} />
        </Card>

        {/* ── Availability ────────────────────────────────────────────── */}
        <Card
          title="Who's playing"
          note="Click a name to rule a player out."
          aside={
            outCount > 0 ? (
              <button type="button" onClick={handlers?.onClearOut} disabled={inert}
                className="shrink-0 whitespace-nowrap text-[0.6rem] uppercase tracking-[0.15em] font-semibold text-coral hover:underline">
                Reset ({outCount})
              </button>
            ) : null
          }
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
            <Roster team={a} out={p.outA} color={fillA} onToggle={handlers?.onToggleA} disabled={inert} />
            <Roster team={b} out={p.outB} color={fillB} onToggle={handlers?.onToggleB} disabled={inert} />
          </div>
          {p.parts.availability !== 0 && (
            <div className="mt-4 pt-3 border-t border-hairline">
              <p className="text-xs text-ink-soft tabular">
                Absences move the line <strong className="text-ink">{fmtSigned(p.parts.availability, 2)} pts</strong> toward {p.parts.availability > 0 ? a.b : b.b}.
              </p>
              {/* Past about a quarter of a rotation the model is extrapolating:
                  fewer than 1% of the games it was fitted on were missing that
                  much, and the coefficient's own error bar is wide enough that
                  the true effect could be half this or double it. Saying so is
                  better than a number that looks as confident as the rest. */}
              {(outShare(a, p.outA) > OUT_SHARE_WARN || outShare(b, p.outB) > OUT_SHARE_WARN) && (
                <p className="mt-2 text-[0.7rem] leading-relaxed text-ink-muted">
                  That much of a rotation missing is beyond what the model was fitted on — fewer than 1% of games in the
                  sample lost this many minutes. Treat the size of the swing as a rough guide, not a measurement.
                </p>
              )}
            </div>
          )}
        </Card>
      </div>

    </div>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────

/**
 * Ease a number toward its target over a few frames, so a toggled player
 * moves the score rather than replacing it. The eye reads the DIRECTION of a
 * change far more easily than it reads two numbers, and direction is the
 * whole point of a control that says "what if he's out".
 *
 * Off under prefers-reduced-motion, and it always lands exactly on target.
 */
function useTween(target: number, ms = 320): number {
  const [v, setV] = useState(target);
  // Where the value actually is, frame by frame — so a change that lands
  // mid-tween continues from the current position rather than jumping back.
  const at = useRef(target);
  useEffect(() => {
    let raf = 0;
    const start = performance.now(), from = at.current, d = target - from;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    // Every state update happens inside the frame callback, never in the
    // effect body itself: the first frame does the reduced-motion snap too.
    const tick = (now: number) => {
      const t = reduce || Math.abs(d) < 1e-6 ? 1 : Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - t, 3);
      const cur = t >= 1 ? target : from + d * e;
      at.current = cur;
      setV(cur);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/**
 * The margin's distribution, to scale.
 *
 * ONE BELL, MOVED. σ is a constant in the model, so the shape never changes —
 * only where it sits. That makes the drawing a single path translated by the
 * margin, with the two fills coming from clip regions fixed at zero. A team's
 * share of the area IS its win probability; nothing here is a second number.
 */
function MarginCurve({ margin, colorA, colorB, a, b }: { margin: number; colorA: string; colorB: string; a: string; b: string }) {
  const W = 600, H = 84, PAD = 8, RANGE = 40;          // ±40 points of margin
  const px = (W - 2 * PAD) / (2 * RANGE);              // pixels per point
  const zero = PAD + RANGE * px;
  const sig = SIGMA * px;
  // The bell, centered at x = zero, sampled every 4px.
  const pts: string[] = [];
  for (let x = PAD; x <= W - PAD; x += 4) {
    const z = (x - zero) / sig;
    const y = H - 6 - (H - 14) * Math.exp(-0.5 * z * z);
    pts.push(`${x},${y.toFixed(1)}`);
  }
  const path = `M${PAD},${H - 6} L${pts.join(" L")} L${W - PAD},${H - 6} Z`;
  const dx = Math.max(-RANGE, Math.min(RANGE, margin)) * px;
  // Stable and unique per instance. Deriving it from the margin meant two
  // curves showing the same number shared a clip region.
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full h-auto" role="img"
      aria-label={`Projected margin ${fmtSigned(margin)} for ${a}; ${b} wins when the game lands left of zero.`}>
      <defs>
        <clipPath id={`${id}-l`}><rect x="0" y="0" width={zero} height={H} /></clipPath>
        <clipPath id={`${id}-r`}><rect x={zero} y="0" width={W - zero} height={H} /></clipPath>
      </defs>
      {/* Colors go through `style`, not presentation attributes: a var() in
          an attribute is not guaranteed to resolve, and these are variables. */}
      <g style={{ transform: `translateX(${dx}px)`, transition: "transform 320ms cubic-bezier(.2,.7,.2,1)" }}>
        <path d={path} style={{ fill: colorB, fillOpacity: 0.3 }} clipPath={`url(#${id}-l)`} />
        <path d={path} style={{ fill: colorA, fillOpacity: 0.3 }} clipPath={`url(#${id}-r)`} />
        <path d={path.replace(/ L\S+,\S+ Z$/, "")} style={{ fill: "none", stroke: "var(--ink)", strokeOpacity: 0.55, strokeWidth: 1.25 }} />
        <line x1={zero} x2={zero} y1={H - 6} y2={12} style={{ stroke: "var(--ink)", strokeOpacity: 0.9, strokeWidth: 1 }} strokeDasharray="2 3" />
      </g>
      {/* Zero stays put: the game's one fixed point. */}
      <line x1={zero} x2={zero} y1={H - 6} y2={4} style={{ stroke: "var(--ink)", strokeOpacity: 0.35, strokeWidth: 1 }} />
      <line x1={PAD} x2={W - PAD} y1={H - 6} y2={H - 6} style={{ stroke: "var(--hairline)", strokeWidth: 1 }} />
      {[-30, -20, -10, 10, 20, 30].map((t) => (
        <text key={t} x={zero + t * px} y={H} textAnchor="middle" fontSize="8" style={{ fill: "var(--ink-muted)" }} className="tabular">{t > 0 ? `+${t}` : t}</text>
      ))}
      <text x={zero} y={H} textAnchor="middle" fontSize="8" fontWeight={700} style={{ fill: "var(--ink-soft)" }}>even</text>
    </svg>
  );
}

/**
 * What would it take? Each chip is a full projection with one thing changed,
 * and clicking it makes that the page. Cheap because the model is closed
 * form, and useful because the answer to "how much does the floor matter"
 * is a number, not an adjective.
 */
function Counterfactuals({ pack, p, handlers, colorA, colorB }: {
  pack: MatchupPack; p: Projection; handlers?: MatchupHandlers; colorA: string; colorB: string;
}) {
  const { a, b, site, outA, outB } = p;
  const chips: Array<{ key: string; label: string; win: number; color: string; apply?: () => void }> = [];
  const base = { pack, a, b, outA, outB };
  const short = (t: MatchupTeam) => teamShortName(t.b);

  for (const s of ["home", "neutral", "away"] as const) {
    if (s === site) continue;
    const win = project({ ...base, site: s }).winA;
    chips.push({
      key: `site-${s}`,
      label: s === "neutral" ? "On a neutral floor" : s === "home" ? `At ${short(a)}` : `At ${short(b)}`,
      win, color: colorA, apply: handlers && (() => handlers.onSite(s)),
    });
  }
  const bestA = a.best >= 0 && !outA.includes(a.best) ? a.r[a.best] : null;
  const bestB = b.best >= 0 && !outB.includes(b.best) ? b.r[b.best] : null;
  if (bestA) chips.push({
    key: "outA", label: `${short(a)} without ${bestA[0].split(" ").pop()}`,
    win: project({ ...base, site, outA: [...outA, a.best] }).winA, color: colorA,
    apply: handlers && (() => handlers.onToggleA(a.best)),
  });
  if (bestB) chips.push({
    key: "outB", label: `${short(b)} without ${bestB[0].split(" ").pop()}`,
    win: project({ ...base, site, outB: [...outB, b.best] }).winA, color: colorA,
    apply: handlers && (() => handlers.onToggleB(b.best)),
  });

  return (
    <div className="mt-4 pt-3 border-t border-hairline/80">
      <div className="text-[0.6rem] uppercase tracking-[0.15em] font-semibold text-ink-muted mb-1.5">What would it take</div>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((c) => {
          const delta = c.win - p.winA;
          return (
            <button
              key={c.key}
              type="button"
              onClick={c.apply}
              disabled={!c.apply}
              className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-paper px-2.5 py-1 text-[0.7rem] text-ink-soft hover:border-ink/30 hover:text-ink transition-colors disabled:opacity-80 tabular max-w-full"
            >
              <span className="truncate">{c.label}</span>
              <span className="font-semibold" style={{ color: colorA }}>{fmtPct(c.win)}</span>
              <span className={cn("text-[0.6rem]", delta > 0 ? "text-ink-muted" : "text-ink-muted")} style={{ color: delta > 0 ? colorA : colorB }}>
                {delta > 0 ? "▲" : delta < 0 ? "▼" : "•"}{Math.abs(Math.round(delta * 100))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The URL is the matchup, so sharing is copying it. */
function ShareButton({ disabled }: { disabled?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        navigator.clipboard?.writeText(window.location.href).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        }).catch(() => {});
      }}
      className="inline-flex items-center gap-1.5 text-[0.6rem] uppercase tracking-[0.15em] font-semibold text-ink-muted hover:text-ink transition-colors disabled:opacity-60"
      title="Copy a link to this matchup"
    >
      {done ? <Check className="h-3 w-3 text-coral" aria-hidden /> : <Link2 className="h-3 w-3" aria-hidden />}
      {done ? "Copied" : "Share"}
    </button>
  );
}

function teamInk(bart: string): { light: string; dark: string; brand: string } {
  const c = getTeamColors(bart)?.primary;
  if (!c) return { light: "var(--coral)", dark: "var(--coral)", brand: "var(--coral)" };
  // Light: the site's contrast-targeted clamp against the cream paper. Dark:
  // the same hue lifted into a lightness band that clears 4.5:1 on #1C1C1C.
  // Brand: the color as printed, for fills that nobody has to read.
  return { light: readableOnPaper(c), dark: readableInk(c, { min: 0.6, max: 0.78 }), brand: c };
}

function Picker({
  label, team, options, groupLabels, onChange, disabled, align = "left",
}: {
  label: string;
  team: MatchupTeam;
  options?: SearchableOption[];
  groupLabels?: Record<string, string>;
  onChange?: (slug: string) => void;
  disabled?: boolean;
  align?: "left" | "right";
}) {
  // Until the pack arrives there is one option — the team already shown — so
  // the control paints identically before and after hydration.
  const opts = options ?? [{ value: team.s, label: team.b, group: team.c ?? "Other" }];
  return (
    <div className={cn("min-w-0", align === "right" && "md:text-right")}>
      <div className="text-[0.6rem] uppercase tracking-[0.15em] font-semibold text-ink-muted mb-1">{label}</div>
      <div className={cn(disabled && "pointer-events-none opacity-90")}>
        <SearchableSelect
          value={team.s}
          options={opts}
          groupLabels={groupLabels}
          onChange={(v) => onChange?.(v)}
          placeholder="Find a team…"
          ariaLabel={label}
          className="w-full"
        />
      </div>
    </div>
  );
}

/**
 * Where A plays. Three states, one control, and the words say what each
 * means for the team on the left — "at home" is A's building, "away" is B's.
 */
function SiteControl({ site, a, onSite, disabled }: { site: Site; a: MatchupTeam; onSite?: (s: Site) => void; disabled?: boolean }) {
  // The site's own short form, then CSS truncation — chopping to the first
  // word turned "Northern Iowa" into "Northern", which is a different school.
  const short = teamShortName(a.b);
  const opts: Array<[Site, string]> = [["home", `${short} home`], ["neutral", "Neutral"], ["away", `${short} away`]];
  return (
    <div role="group" aria-label="Site" className="inline-flex items-center gap-0.5 rounded-lg bg-ink/6 p-1">
      {opts.map(([s, label]) => {
        const active = site === s;
        return (
          <button
            key={s}
            type="button"
            aria-pressed={active}
            onClick={() => onSite?.(s)}
            disabled={disabled}
            className={cn(
              "max-w-36 truncate rounded-md px-2.5 py-1.5 text-[0.65rem] uppercase font-semibold tracking-[0.12em] transition-colors",
              active ? "bg-paper text-ink shadow-sm" : "text-ink-soft hover:text-ink",
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * One side of the seam: the team's identity at the top, its score and its
 * share of the games at the bottom, on a wash of its own color. Both sides
 * keep the same reading order — logo, name, numbers — and the right side is
 * mirrored by alignment only, because reversing the order made the numbers
 * read backwards.
 */
function Half({ team, color, fill, season, side, score, win, hosting, seam }: {
  team: MatchupTeam;
  /** The team's color as text: rank and win probability. */
  color: string;
  /** The team's color as paint: the wash behind the half. */
  fill: string;
  season: number; side: "left" | "right";
  score: React.ReactNode; win: number; hosting: boolean;
  /** Draw the cut on this side's leading edge. */
  seam?: boolean;
}) {
  const right = side === "right";
  // The wash is the container's job on the left; see the grid above.
  const wash = `color-mix(in srgb, ${fill} var(--ma-wash), transparent)`;
  return (
    // Rows stretch (no items-end): shrink-wrapped rows let a long name spill
    // left past the padding and under the seam instead of wrapping.
    <div className={cn("relative min-w-0 flex flex-col justify-between gap-4 px-4 py-4 sm:px-6 sm:py-5", right && "text-right")}>
      {/* THE WASH AND THE CUT AGREE. This half's color is a layer skewed
          from its bottom-left corner, so its leading edge leans exactly the
          way the seam does, and the seam is the same skew three pixels wide.
          Skewed about the center, as before, the line crossed a vertical
          color boundary and left a sliver of each color on the wrong side.
          The lean is slight because a skew displaces by height: at 9° the top
          of the line was 16px into the underdog's name. The layer's overspill
          at the top right is clipped by the card. */}
      {seam && (
        <>
          <span aria-hidden className="absolute inset-0 -z-10 origin-bottom-left" style={{ background: wash, transform: "skewX(-5deg)" }} />
          <span aria-hidden className="absolute top-0 bottom-0 left-0 w-0.75 bg-ink origin-bottom-left" style={{ transform: "skewX(-5deg)" }} />
        </>
      )}
      <div className={cn("flex items-center gap-2.5 min-w-0", right && "flex-row-reverse")}>
        {/* Wider than tall: a wordmark fills width where a crest fills height,
            and in a square box the wordmark draws a third smaller. */}
        <TeamLogo name={team.b} size={40} width={56} className="shrink-0" />
        <div className="min-w-0">
          {/* Wraps rather than truncates: a name longer than the underdog's
              floor allows ("Northern Iowa" at 2xl) goes to two lines, and
              "Northern…" is a worse answer than that. */}
          <Link href={`/teams/${team.s}/${season}/`} className="block font-display font-bold text-lg sm:text-2xl leading-tight text-ink hover:underline text-balance">
            <TeamName name={team.b} />
          </Link>
          <div className="text-[0.7rem] text-ink-muted tabular">
            {team.c ?? "Ind."} · {team.w}–{team.l}
            {team.br != null && <> · <span className="font-semibold" style={{ color }} title="BTA rank">#{team.br}</span></>}
            {hosting && <> · <span className="text-[0.6rem] uppercase tracking-[0.12em] font-semibold text-ink-soft">home</span></>}
          </div>
        </div>
      </div>
      <div className={cn("flex items-end justify-between gap-x-4 gap-y-1 flex-wrap", right && "flex-row-reverse")}>
        <div>
          <div className="font-display tabular text-5xl sm:text-7xl font-bold leading-[0.9] tracking-tight text-ink">{score}</div>
          <div className="mt-1.5 text-[0.55rem] uppercase tracking-[0.15em] font-semibold text-ink-muted">Projected</div>
        </div>
        <div className="tabular">
          <div className="text-base sm:text-lg font-bold leading-none" style={{ color }}>{fmtPct(win)}</div>
          <div className="mt-1.5 text-[0.55rem] uppercase tracking-[0.15em] font-semibold text-ink-muted">Win probability</div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <dt className="text-[0.6rem] uppercase tracking-[0.15em] font-semibold text-ink-muted">{label}</dt>
      <dd className="mt-0.5 font-display tabular text-base sm:text-lg font-bold text-ink leading-tight">{value}</dd>
      {note && <dd className="text-[0.65rem] text-ink-muted">{note}</dd>}
    </div>
  );
}

function Card({ title, note, aside, children }: { title: string; note?: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border border-hairline rounded-xl shadow-sm bg-paper-deep/25 p-4 sm:p-5">
      <header className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="text-[0.7rem] uppercase tracking-[0.15em] font-bold leading-none" style={{ color: "var(--court-ink)" }}>{title}</h2>
          {note && <p className="mt-1.5 text-[0.7rem] leading-relaxed text-ink-muted max-w-[62ch]">{note}</p>}
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}

/** The projection, one line per step, so the number can be argued with. */
function Ledger({ p, pack }: { p: Projection; pack: MatchupPack }) {
  const M = pack.league.eff, L = pack.league.tempo;
  const loc = p.site === "neutral" ? 0 : p.site === "home" ? 1 : -1;
  const a = p.a, b = p.b;
  const hcaA = loc * HCA, hcaB = -loc * HCA;
  const rows: Array<[string, number, string?]> = [
    [p.site === "neutral" ? "Home floor (neutral)" : p.sameConf ? "Home floor — conference game" : "Home floor — non-conference", p.parts.homeFloor],
    ...(p.parts.powerHost !== 0 ? [["Power conference hosting a non-power team", p.parts.powerHost] as [string, number]] : []),
    ["Offensive rebounding edge", p.parts.orb],
    ["Turnover edge", p.parts.tov],
    ["3PA share edge", p.parts.t3r],
    ["3P% edge (fade the hot shooters)", p.parts.t3p],
    ["Both teams strong", p.parts.qual],
    ["Availability", p.parts.availability],
    ["Roster continuity", p.parts.continuity],
  ];
  return (
    <div className="text-xs tabular">
      <Step n="1" label="Efficiency, against this opponent">
        <Line k={a.b} v={`${fmt1(a.o)} + (${fmt1(b.d)} − ${fmt1(M)})${hcaA ? ` ${hcaA > 0 ? "+" : "−"} ${fmt1(Math.abs(hcaA))}` : ""} = ${fmt1(p.effA)}`} />
        <Line k={b.b} v={`${fmt1(b.o)} + (${fmt1(a.d)} − ${fmt1(M)})${hcaB ? ` ${hcaB > 0 ? "+" : "−"} ${fmt1(Math.abs(hcaB))}` : ""} = ${fmt1(p.effB)}`} />
        <Hint>Own offense, plus how far the other defense sits from the league&rsquo;s {fmt1(M)}{loc ? `, ± ${HCA} for the floor` : ""}.</Hint>
      </Step>
      <Step n="2" label="Pace">
        <Line k="Projected" v={`${fmt1(L)} − 0.75 + 0.83 × (${fmt1(a.t)} + ${fmt1(b.t)} − 2 × ${fmt1(L)}) = ${fmt1(p.pace)}`} />
      </Step>
      <Step n="3" label="Base projection">
        <Line k={a.b} v={`${fmt1(p.effA)} × ${fmt1(p.pace)} / 100 = ${fmt1(p.baseA)}`} />
        <Line k={b.b} v={`${fmt1(p.effB)} × ${fmt1(p.pace)} / 100 = ${fmt1(p.baseB)}`} />
        <Line k="Margin" v={fmtSigned(p.baseMargin)} strong />
      </Step>
      <Step n="4" label="Matchup corrections" last>
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 py-0.5">
            <span className={cn("text-ink-soft", k.startsWith("3P%") && "text-coral")}>{k}</span>
            <span className={cn("font-medium", Math.abs(v) < 0.005 ? "text-ink-muted" : "text-ink")}>{fmtSigned(v, 2)}</span>
          </div>
        ))}
        <div className="flex justify-between gap-3 mt-1.5 pt-1.5 border-t border-hairline font-semibold text-ink">
          <span>Projected margin</span>
          <span>{fmtSigned(p.baseMargin)} {p.correction >= 0 ? "+" : "−"} {fmt1(Math.abs(p.correction))} = {fmtSigned(p.margin)}</span>
        </div>
      </Step>
    </div>
  );
}

function Step({ n, label, children, last }: { n: string; label: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={cn("py-2.5", !last && "border-b border-hairline")}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-ink/8 text-[0.6rem] font-bold text-ink-soft">{n}</span>
        <span className="text-[0.6rem] uppercase tracking-[0.15em] font-semibold text-ink-muted">{label}</span>
      </div>
      {children}
    </div>
  );
}
function Line({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3 py-0.5">
      <span className="text-ink-soft shrink-0">{k}</span>
      <span className={cn("text-right", strong ? "font-semibold text-ink" : "text-ink")}>{v}</span>
    </div>
  );
}
function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-[0.65rem] leading-relaxed text-ink-muted">{children}</p>;
}

function Roster({ team, out, color, onToggle, disabled }: {
  team: MatchupTeam; out: number[]; color: string; onToggle?: (i: number) => void; disabled?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="h-2 w-2 rounded-full" style={{ background: color }} aria-hidden />
        <span className="text-[0.65rem] uppercase tracking-[0.12em] font-semibold text-ink-soft truncate"><TeamName name={team.b} /></span>
        <span className="ml-auto text-[0.6rem] uppercase tracking-[0.12em] text-ink-muted">mpg</span>
      </div>
      {team.r.length === 0 ? (
        <p className="text-xs text-ink-muted">No rotation on record.</p>
      ) : (
        <ul className="divide-y divide-hairline/70">
          {team.r.map(([name, mpg], i) => {
            const isOut = out.includes(i);
            const best = i === team.best;
            return (
              <li key={`${name}-${i}`}>
                <button
                  type="button"
                  aria-pressed={isOut}
                  onClick={() => onToggle?.(i)}
                  disabled={disabled}
                  title={isOut ? "Ruled out — click to restore" : `Rule out — worth about ${fmt1(playerCost(team, i, out))} pts`}
                  className={cn(
                    "w-full flex items-center gap-2.5 py-1.5 text-left text-xs transition-colors group",
                    isOut ? "text-ink-muted" : "text-ink hover:text-coral",
                  )}
                >
                  <span aria-hidden className={cn(
                    "h-3.5 w-3.5 rounded-[3px] border shrink-0 flex items-center justify-center transition-colors",
                    isOut ? "border-hairline bg-transparent" : "border-transparent",
                  )} style={isOut ? undefined : { background: color }}>
                    {!isOut && <span className="block h-1.5 w-1.5 rounded-[1px] bg-paper" />}
                  </span>
                  <span className={cn("truncate", isOut && "line-through decoration-ink-muted/60")}>{name}</span>
                  {best && (
                    <span className="shrink-0 text-[0.55rem] uppercase tracking-[0.12em] font-bold px-1 py-px rounded-sm"
                      style={{ color: "var(--court-ink)", background: "color-mix(in srgb, var(--court) 22%, transparent)" }}>
                      best
                    </span>
                  )}
                  <span className="ml-auto tabular text-ink-muted group-hover:text-inherit shrink-0">{fmt1(mpg)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

