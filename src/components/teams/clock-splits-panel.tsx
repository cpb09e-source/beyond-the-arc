import type { ClockSplits } from "@/lib/static-data";
import { cn } from "@/lib/utils";

/**
 * When this team shoots, and how well — measured against the shot clock rather
 * than the game clock.
 *
 * THE NUMBER THAT MAKES THE PANEL WORTH READING is the eFG gap between the
 * bands. League-wide in 2026 it runs .547 early, .520 middle, .483 late: an
 * early look is worth about six and a half points of eFG over a late one. So a
 * team's band SHARES are not a stylistic curiosity, they are a large part of
 * why its offense rates where it does — and the defensive side is a scheme
 * signature, since forcing opponents into the last third of the clock is
 * something a defense does on purpose.
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

/** League eFG by band, 2026, for the reference line under each column. */
const LEAGUE_EFG = { early: 0.547, mid: 0.52, late: 0.483 } as const;

const pct1 = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const efg = (v: number | null) => (v == null ? "—" : v.toFixed(3).replace(/^0/, ""));

export function ClockSplitsPanel({ splits }: { splits: ClockSplits }) {
  const side = (def: boolean) =>
    BANDS.map((b) => ({
      ...b,
      rate: splits[`${b.key}_rate${def ? "_def" : ""}` as keyof ClockSplits] as number | null,
      efg: splits[`${b.key}_efg${def ? "_def" : ""}` as keyof ClockSplits] as number | null,
    }));

  return (
    <div className="bg-paper-deep/25 -mx-6 lg:mx-0 rounded-none lg:rounded-xl border-y border-x-0 lg:border-x border-hairline shadow-sm p-6">
      <div className="flex items-baseline justify-between mb-1 gap-3">
        <h3 className="font-display text-xl text-ink">Shot clock</h3>
        <span className="text-[0.65rem] uppercase tracking-widest text-ink-muted whitespace-nowrap">
          {splits.clock_games} games
        </span>
      </div>
      <p className="text-xs text-ink-muted mb-5 max-w-[52ch]">
        Where shots come from on the clock, and what they return. An offensive
        rebound restarts the count, the way the shot clock does.
      </p>

      <div className="space-y-5">
        <Side title="Offense" rows={side(false)} />
        <Side title="Defense" rows={side(true)} sub="What opponents were made to do" />
      </div>
    </div>
  );
}

function Side({
  title,
  sub,
  rows,
}: {
  title: string;
  sub?: string;
  rows: { key: string; label: string; window: string; rate: number | null; efg: number | null }[];
}) {
  const max = Math.max(...rows.map((r) => r.rate ?? 0), 0.01);

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-2.5">
        <h4 className="text-[0.62rem] uppercase tracking-[0.18em] font-semibold text-ink-soft">
          {title}
        </h4>
        {sub && <span className="text-[0.62rem] text-ink-muted">{sub}</span>}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {rows.map((r) => {
          const league = LEAGUE_EFG[r.key as keyof typeof LEAGUE_EFG];
          const delta = r.efg == null ? null : r.efg - league;
          return (
            <div key={r.key} className="min-w-0">
              {/* The bar is the SHARE. Height rather than width, so the three
                  bands read as a distribution across the clock left to right. */}
              <div className="h-14 flex items-end mb-1.5" aria-hidden>
                <div
                  className="w-full rounded-t bg-coral/25 border-t-2 border-coral"
                  style={{ height: `${Math.max(6, ((r.rate ?? 0) / max) * 100)}%` }}
                />
              </div>
              <div className="text-[0.58rem] uppercase tracking-[0.14em] text-ink-muted leading-none">
                {r.label}
              </div>
              <div className="text-[0.56rem] text-ink-muted/70 tabular leading-none mt-0.5">
                {r.window}
              </div>
              <div className="text-base tabular font-semibold text-ink leading-none mt-1.5">
                {pct1(r.rate)}
              </div>
              <div
                className={cn(
                  "text-[0.62rem] tabular leading-none mt-1",
                  delta == null ? "text-ink-muted" : delta >= 0 ? "text-good" : "text-bad",
                )}
                title={`eFG ${efg(r.efg)} against a league ${efg(league)}`}
              >
                {efg(r.efg)} eFG
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
