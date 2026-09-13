import { Info } from "lucide-react";
import { useMemo } from "react";
import type { GameLog } from "@/lib/game-filters";
import { ALL_SEASONS } from "@/lib/seasons";
import { statLabel, type CalcResult } from "@/lib/win-calc";
import { seasonLabel } from "~/ui/format";
import type { CalcSeasons, DataGap } from "./calc-model";
import { withIds, type CalcState } from "./calc-state";

/**
 * The answer, above the games it comes from.
 *
 * THE NUMBER FIRST. Win rate is the question the tool exists to answer, so it
 * is the biggest thing in the view and the only thing in the accent; record,
 * margin and sample size sit beside it at a size that reads without competing.
 * The bar underneath is the same record as a shape, notched at an even split.
 *
 * BY SEASON, when the question spans more than one: a small bar per season,
 * each its own win rate, so "this has been true for a decade" and "this was one
 * freak year" look different at a glance. Pick a bar to see only that season's
 * games in the table.
 *
 * BEFORE A QUESTION, starting points instead of a meaningless 50%: every game
 * is counted from both sides, so the record of all games is always even.
 */

type Starter = { key: string; label: string; apply: (s: CalcState) => CalcState };

export const STARTERS: Starter[] = [
  { key: "turnovers", label: "Won the turnover battle", apply: (s) => ({ ...s, rows: withIds([{ stat: "tov_diff", op: "lt", value: "0" }]) }) },
  { key: "threes", label: "Made 40% of their threes", apply: (s) => ({ ...s, rows: withIds([{ stat: "fg3_pct", op: "gte", value: "40" }]) }) },
  { key: "comeback", label: "Trailed by 15 or more", apply: (s) => ({ ...s, rows: withIds([{ stat: "largest_lead_opp", op: "gte", value: "15" }]) }) },
  { key: "half", label: "Led by 10 at halftime", apply: (s) => ({ ...s, rows: withIds([{ stat: "h1_margin", op: "gte", value: "10" }]) }) },
  { key: "road", label: "Away at a top-25 team", apply: (s) => ({ ...s, venue: "away", rows: withIds([{ stat: "opp_rank", op: "lte", value: "25" }]) }) },
  { key: "glass", label: "Outrebounded by 10 or more", apply: (s) => ({ ...s, rows: withIds([{ stat: "reb_diff", op: "lte", value: "-10" }]) }) },
];

export function CalcSummary({
  state,
  result,
  seasons,
  asking,
  picked,
  onPick,
  onStarter,
  gaps,
}: {
  state: CalcState;
  result: CalcResult | null;
  seasons: CalcSeasons;
  asking: boolean;
  picked: number | null;
  onPick: (year: number | null) => void;
  onStarter: (apply: (s: CalcState) => CalcState) => void;
  /** Conditions on a stat some of the chosen seasons never recorded. */
  gaps: DataGap[];
}) {
  if (seasons.error) return null;
  if (!seasons.complete) return <LoadingBand ready={seasons.ready} total={seasons.total} />;
  if (!result) return null;
  if (!asking) return <StartBand years={state.years} total={result.total} onStarter={onStarter} />;
  return <AnswerBand result={result} years={state.years} picked={picked} onPick={onPick} gaps={gaps} />;
}

function LoadingBand({ ready, total }: { ready: number; total: number }) {
  return (
    <section aria-busy="true" aria-label="Loading" className="flex shrink-0 items-center gap-3 px-5 py-4">
      <span className="ask-orb shrink-0" aria-hidden />
      <span className="text-[12.5px] text-ink">Loading game logs</span>
      <span className="text-[12px] text-ink-muted tabular">
        {ready} of {total} {total === 1 ? "season" : "seasons"}
      </span>
      <span className="relative h-[3px] w-[140px] overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--ink)_9%,transparent)]">
        <span
          className="absolute inset-0 origin-left rounded-full bg-accent transition-transform duration-300 ease-out"
          style={{ transform: `scaleX(${Math.max(ready / total, 0.04)})` }}
        />
      </span>
    </section>
  );
}

function StartBand({ years, total, onStarter }: { years: number[]; total: number; onStarter: (apply: (s: CalcState) => CalcState) => void }) {
  const span = years.length === 1 ? seasonLabel(years[0]!) : `${years.length} seasons`;
  return (
    <section aria-label="Start a question" className="shrink-0 px-5 pb-3.5 pt-3">
      <p className="max-w-[80ch] text-[12.5px] leading-snug text-ink-soft">
        Every game of {span} is below, {total.toLocaleString()} of them, each from one team&rsquo;s side. Ask a question, add a
        filter, or start from one of these.
      </p>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {STARTERS.map((s) => (
          <button
            key={s.key}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onStarter(s.apply)}
            className="h-[26px] rounded-md border border-hairline bg-card px-2.5 text-[12.5px] text-ink-soft transition-colors hover:border-ink-muted hover:text-ink"
          >
            {s.label}
          </button>
        ))}
      </div>
    </section>
  );
}

function AnswerBand({
  result,
  years,
  picked,
  onPick,
  gaps,
}: {
  result: CalcResult<GameLog>;
  years: number[];
  picked: number | null;
  onPick: (year: number | null) => void;
  gaps: DataGap[];
}) {
  const bars = useMemo(() => {
    const m = new Map<number, { w: number; l: number }>();
    for (const y of years) m.set(y, { w: 0, l: 0 });
    for (const g of result.matching) {
      const b = m.get(g.year);
      if (!b) continue;
      if (g.won) b.w++;
      else b.l++;
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [result, years]);

  const none = result.total === 0;
  const margin =
    result.avgMargin == null ? "—" : `${result.avgMargin > 0 ? "+" : result.avgMargin < 0 ? "−" : ""}${Math.abs(result.avgMargin).toFixed(1)}`;

  return (
    <section aria-label="Answer" className="shrink-0 px-5 pb-3.5 pt-3">
      <div className="flex flex-wrap items-end gap-x-9 gap-y-3">
        <Figure label="Win rate" value={none ? "—" : `${(result.winPct * 100).toFixed(1)}%`} big />
        <Figure label="Record" value={`${result.wins.toLocaleString()}–${result.losses.toLocaleString()}`} />
        <Figure label="Avg margin" value={margin} />
        <Figure label="Games" value={result.total.toLocaleString()} />
        {bars.length > 1 && <SeasonBars bars={bars} picked={picked} onPick={onPick} />}
      </div>
      {none ? (
        <p className="mt-2.5 text-[12.5px] text-ink-muted">No game matches every filter. Take one away to widen the question.</p>
      ) : (
        <div className="mt-3">
          <div
            className="relative h-[6px] overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--ink)_9%,transparent)]"
            role="img"
            aria-label={`${result.wins} wins and ${result.losses} losses`}
          >
            <div
              className="h-full origin-left rounded-full bg-accent transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
              style={{ transform: `scaleX(${result.winPct})` }}
            />
            <span aria-hidden title="An even split" className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-[var(--paper)]" />
          </div>
          <div className="mt-1.5 flex justify-between text-[11.5px] tabular">
            <span className="text-accent">
              {result.wins.toLocaleString()} {result.wins === 1 ? "win" : "wins"}
            </span>
            <span className="text-ink-muted">
              {result.losses.toLocaleString()} {result.losses === 1 ? "loss" : "losses"}
            </span>
          </div>
        </div>
      )}
      {gaps.length > 0 && (
        <ul className="mt-2.5 grid gap-1">
          {gaps.map((g) => (
            <li key={g.key} className="flex items-start gap-1.5 text-[12px] leading-snug text-ink-muted">
              <Info size={13} strokeWidth={2} className="mt-[2px] shrink-0" aria-hidden />
              {gapText(g)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * "41 of the 104 games in scope have no FB Pts Diff, so they cannot match. Most
 * are from 2013-14 through 2021-22."
 */
function gapText(g: DataGap): string {
  const lead = `${g.missing.toLocaleString()} of the ${g.total.toLocaleString()} games in scope have no ${statLabel(g.key)}, so they cannot match.`;
  const ys = g.years;
  if (ys.length === 0) return lead;
  const asc = [...ALL_SEASONS].sort((a, b) => a - b);
  const contiguous = ys.every((y, i) => i === 0 || asc.indexOf(y) === asc.indexOf(ys[i - 1]!) + 1);
  const span =
    ys.length === 1
      ? seasonLabel(ys[0]!)
      : contiguous
        ? `${seasonLabel(ys[0]!)} through ${seasonLabel(ys[ys.length - 1]!)}`
        : `${ys.length} seasons`;
  return `${lead} Most are from ${span}.`;
}

function Figure({ label, value, big = false }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[11.5px] text-ink-muted">{label}</div>
      <div
        className={`mt-1 font-semibold leading-none tracking-[-0.025em] tabular ${
          big ? "text-[34px] text-accent" : "text-[22px] text-ink"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function SeasonBars({
  bars,
  picked,
  onPick,
}: {
  bars: Array<[number, { w: number; l: number }]>;
  picked: number | null;
  onPick: (year: number | null) => void;
}) {
  return (
    <div className="ml-auto min-w-0">
      <div className="flex h-[15px] items-baseline justify-between gap-4 text-[11.5px] text-ink-muted">
        <span>{picked == null ? "By season" : seasonLabel(picked)}</span>
        {picked != null && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(null)}
            className="text-accent hover:underline"
          >
            Every season
          </button>
        )}
      </div>
      <div role="group" aria-label="Win rate by season" className="relative mt-1 flex h-[36px] items-end gap-[3px]">
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-hairline" />
        {bars.map(([y, b]) => {
          const n = b.w + b.l;
          const p = n ? b.w / n : 0;
          const on = picked === y;
          return (
            <button
              key={y}
              type="button"
              aria-pressed={on}
              aria-label={`${seasonLabel(y)}: ${n ? `${b.w}–${b.l}` : "no games"}`}
              title={`${seasonLabel(y)}: ${n ? `${b.w}–${b.l}, ${(p * 100).toFixed(1)}%` : "no games"}`}
              disabled={n === 0}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(on ? null : y)}
              className="group relative h-full w-[12px] rounded-[2px] transition-colors enabled:hover:bg-[color-mix(in_oklab,var(--ink)_7%,transparent)]"
            >
              {n > 0 ? (
                <span
                  className={`absolute inset-x-0 bottom-0 rounded-[2px] transition-opacity ${
                    on ? "bg-accent" : "bg-[color-mix(in_oklab,var(--accent)_52%,var(--card))] group-hover:bg-[color-mix(in_oklab,var(--accent)_75%,var(--card))]"
                  } ${picked != null && !on ? "opacity-45" : ""}`}
                  style={{ height: `${Math.max(p * 100, 5)}%` }}
                />
              ) : (
                <span className="absolute inset-x-[3px] bottom-0 h-px bg-hairline" />
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between gap-4 text-[10.5px] text-ink-muted tabular">
        <span>{seasonLabel(bars[0]![0])}</span>
        <span>{seasonLabel(bars[bars.length - 1]![0])}</span>
      </div>
    </div>
  );
}
