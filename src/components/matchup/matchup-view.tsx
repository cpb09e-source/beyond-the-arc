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
  STYLE_HIGHER_BETTER,
  STYLE_IN_MODEL,
  STYLE_LABEL,
  fmt1,
  fmtPct,
  displayScores,
  OUT_SHARE_WARN,
  fmtSigned,
  outShare,
  playerCost,
  project,
  scoreBand,
  type MatchupPack,
  type MatchupTeam,
  type Projection,
  type Site,
  type StyleKey,
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
 *   1. The answer — score, margin, win probability. Large.
 *   2. The site selector, as a headline control rather than a checkbox. It is
 *      worth up to ~4.9 points, which is more than every style term together.
 *   3. The arithmetic, printed. The one thing the competition does well.
 *   4. Availability toggles — the largest single addition to the model, and
 *      the one input a team rating is structurally blind to. In or out; there
 *      is no minutes editor because the roster's LEVEL adds nothing.
 *   5. Style, labeled honestly: it says how the game gets played, and the
 *      page does not pretend it decides who wins.
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
  const colorA = "var(--ma)", colorB = "var(--mb)";
  const band = scoreBand(p, pack.league.tempo);
  const inert = !handlers;
  const outCount = p.outA.length + p.outB.length;
  const scoreA = useTween(p.scoreA), scoreB = useTween(p.scoreB), winA = useTween(p.winA);
  const [showA, showB] = displayScores(scoreA, scoreB);
  const favorite = p.margin >= 0 ? a : b;

  return (
    <div
      className="matchup-root mx-auto max-w-5xl"
      style={{
        ["--ma-light" as string]: inkA.light, ["--ma-dark" as string]: inkA.dark,
        ["--mb-light" as string]: inkB.light, ["--mb-dark" as string]: inkB.dark,
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
      <section
        className="mt-5 border border-hairline rounded-xl shadow-sm bg-paper-deep/25 overflow-hidden"
        // A wash of each team's color behind its own side — the tale of the
        // tape, at an opacity that tints the paper without fighting the ink.
        style={{ backgroundImage: `linear-gradient(90deg, color-mix(in srgb, ${colorA} 9%, transparent), transparent 38%, transparent 62%, color-mix(in srgb, ${colorB} 9%, transparent))` }}
      >
        {/* Three columns from sm up. On a phone the middle column has no room
            between two team names, so the score takes its own row first and
            the teams sit beneath it, one per column. */}
        <div className="grid grid-cols-2 sm:grid-cols-[1fr_auto_1fr] items-center gap-x-3 gap-y-4 sm:gap-6 px-4 sm:px-8 pt-6 pb-4">
          <TeamSide team={a} color={colorA} season={pack.season} side="left" />

          <div className="text-center col-span-2 sm:col-span-1 order-first sm:order-0">
            <div className="font-display tabular text-5xl sm:text-7xl font-bold leading-none tracking-tight text-ink whitespace-nowrap">
              {showA}
              <span className="text-ink-muted/60 font-medium mx-2 sm:mx-3">–</span>
              {showB}
            </div>
            <div className="mt-2.5 text-[0.6rem] uppercase tracking-[0.15em] font-semibold text-ink-muted">
              Projected score
            </div>
          </div>

          <TeamSide team={b} color={colorB} season={pack.season} side="right" />
        </div>

        {/* The probability is not a number someone typed. It is the area under
            this curve on each side of zero, and the curve is drawn to scale:
            σ is 11 points of margin, so even a clear favorite leaves a lot of
            the other color showing. */}
        <div className="px-4 sm:px-8 pb-5">
          <div className="flex items-baseline justify-between text-sm font-semibold tabular">
            <span style={{ color: colorA }}>{fmtPct(winA)}</span>
            <span className="text-[0.6rem] uppercase tracking-[0.15em] text-ink-muted font-semibold">Win probability</span>
            <span style={{ color: colorB }}>{fmtPct(1 - winA)}</span>
          </div>
          <MarginCurve margin={p.margin} colorA={colorA} colorB={colorB} a={a.b} b={b.b} />

          <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Stat label="Margin" value={`${favorite.b} by ${fmt1(Math.abs(p.margin))}`} note={`give or take ${Math.round(SIGMA)}`} />
            <Stat label="Pace" value={fmt1(p.pace)} note="possessions" />
            <Stat label="Total" value={`${Math.round(p.total)}`} note={`${Math.round(band.total[0])}–${Math.round(band.total[1])}`} />
          </dl>

          {/* Fast games are wider, not more upset-prone — the range says so
              while the curve above keeps its shape. */}
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
            <Roster team={a} out={p.outA} color={colorA} onToggle={handlers?.onToggleA} disabled={inert} />
            <Roster team={b} out={p.outB} color={colorB} onToggle={handlers?.onToggleB} disabled={inert} />
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

      {/* ── Style ───────────────────────────────────────────────────────── */}
      <div className="mt-5">
        <Card
          title="How the game gets played"
          note="Each team's adjusted tendency against what the other concedes. These describe the game far better than they decide it — the four that carry weight in the model are marked, and together they are worth about a point."
        >
          <StylePanel p={p} pack={pack} colorA={colorA} colorB={colorB} />
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

function teamInk(bart: string): { light: string; dark: string } {
  const c = getTeamColors(bart)?.primary;
  if (!c) return { light: "var(--coral)", dark: "var(--coral)" };
  // Light: the site's contrast-targeted clamp against the cream paper. Dark:
  // the same hue lifted into a lightness band that clears 4.5:1 on #1C1C1C.
  return { light: readableOnPaper(c), dark: readableInk(c, { min: 0.6, max: 0.78 }) };
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

function TeamSide({ team, color, season, side }: { team: MatchupTeam; color: string; season: number; side: "left" | "right" }) {
  const right = side === "right";
  return (
    <div className={cn("min-w-0 flex flex-col gap-1.5", right ? "items-end text-right" : "items-start text-left")}>
      <div className={cn("flex items-center gap-2.5 min-w-0", right && "flex-row-reverse")}>
        {/* Wider than tall: a wordmark fills width where a crest fills height,
            and in a square box the wordmark draws a third smaller. */}
        <TeamLogo name={team.b} size={40} width={56} className="shrink-0" />
        <div className="min-w-0">
          <Link href={`/teams/${team.s}/${season}/`} className="block font-display font-bold text-lg sm:text-2xl leading-tight text-ink hover:underline truncate">
            <TeamName name={team.b} />
          </Link>
          <div className="text-[0.7rem] text-ink-muted tabular">
            {team.c ?? "Ind."} · {team.w}–{team.l}
            {team.br != null && <> · <span className="font-semibold" style={{ color }} title="BTA rank">#{team.br}</span></>}
          </div>
        </div>
      </div>
      {/* Same order on both sides — reversing it made the right-hand team's
          numbers read backwards. Right-aligned is what "mirrored" should mean. */}
      <dl className={cn("flex flex-wrap gap-x-3 gap-y-0.5 text-[0.7rem] tabular text-ink-soft", right && "justify-end")}>
        <div><dt className="inline text-ink-muted">AdjO </dt><dd className="inline font-semibold text-ink">{fmt1(team.o)}</dd></div>
        <div><dt className="inline text-ink-muted">AdjD </dt><dd className="inline font-semibold text-ink">{fmt1(team.d)}</dd></div>
        <div><dt className="inline text-ink-muted">Tempo </dt><dd className="inline font-semibold text-ink">{fmt1(team.t)}</dd></div>
      </dl>
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
        <Hint>Own offence, plus how far the other defence sits from the league&rsquo;s {fmt1(M)}{loc ? `, ± ${HCA} for the floor` : ""}.</Hint>
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

function StylePanel({ p, pack, colorA, colorB }: { p: Projection; pack: MatchupPack; colorA: string; colorB: string }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
      {pack.dims.map((k: StyleKey, i) => {
        const ea = p.expA[k], eb = p.expB[k], L = pack.league.style[i]!;
        const higherBetter = STYLE_HIGHER_BETTER[k];
        // Who the collision favors, in that dimension's own terms.
        const diff = (ea - eb) * (higherBetter ? 1 : -1);
        const inModel = STYLE_IN_MODEL.has(k);
        const scale = Math.max(6, Math.abs(ea - L), Math.abs(eb - L)) * 1.4;
        const pos = (v: number) => 50 + ((v - L) / scale) * 50;
        return (
          <div key={k}>
            <div className="flex items-baseline justify-between text-xs">
              <span className={cn("text-ink-soft", k === "t3p" && inModel && "text-coral")}>
                {STYLE_LABEL[k]}
                {inModel && <span className="ml-1.5 text-[0.55rem] uppercase tracking-[0.12em] font-bold text-ink-muted/80">in model</span>}
              </span>
              <span className="tabular text-ink-muted text-[0.7rem]">
                {Math.abs(diff) < 0.5 ? "even" : `${diff > 0 ? p.a.b : p.b.b} ${fmtSigned(Math.abs(diff)).replace("+", "+")}`}
              </span>
            </div>
            {/* League average at the center; each team's expected value as a
                marker; the two are joined so the gap reads as a length. */}
            <div className="relative mt-1.5 h-4">
              <div className="absolute inset-y-0 left-0 right-0 top-1/2 h-px bg-hairline" />
              <div className="absolute top-0 bottom-0 left-1/2 w-px bg-ink/20" />
              <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-ink/10"
                style={{ left: `${Math.min(pos(ea), pos(eb))}%`, width: `${Math.abs(pos(ea) - pos(eb))}%` }} />
              <Marker at={pos(ea)} color={colorA} label={fmt1(ea)} />
              <Marker at={pos(eb)} color={colorB} label={fmt1(eb)} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
function Marker({ at, color, label }: { at: number; color: string; label: string }) {
  return (
    <span className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex flex-col items-center" style={{ left: `${Math.max(2, Math.min(98, at))}%` }}>
      <span className="h-2.5 w-2.5 rounded-full ring-2 ring-paper" style={{ background: color }} />
      <span className="sr-only">{label}</span>
    </span>
  );
}
