import { Trophy } from "lucide-react";
import type { ConfRecord } from "@/lib/static-data";
import { cn } from "@/lib/utils";

/**
 * NCAA Tournament timeline. Single horizontal row of years (oldest → newest);
 * each cell shows the seed + round result the team finished that year.
 * Missed-the-dance years stay empty so the run pattern reads at a glance.
 *
 * Colors encode depth — gold for Champion, coral-ish for F4/E8 (close to a
 * title), neutral for S16/R32/R64. Seed sits above the round chip.
 */

type RowEntry = {
  year: number;
  seed: number | null;
  round: string | null;
};

const ROUND_TIERS: Record<string, { label: string; bg: string; fg: string }> = {
  "Champion":   { label: "TITLE",  bg: "bg-amber-500",     fg: "text-white" },
  "Runner-Up":  { label: "FINAL",  bg: "bg-amber-300",     fg: "text-amber-950" },
  "F4":         { label: "F4",     bg: "bg-coral",         fg: "text-white" },
  "E8":         { label: "E8",     bg: "bg-coral/80",      fg: "text-white" },
  "S16":        { label: "S16",    bg: "bg-coral/30",      fg: "text-coral" },
  "R32":        { label: "R32",    bg: "bg-paper-deep",    fg: "text-ink-soft" },
  "R64":        { label: "R64",    bg: "bg-paper-deep/60", fg: "text-ink-muted" },
  "First Four": { label: "FF",     bg: "bg-paper-deep/60", fg: "text-ink-muted" },
};

export function TourneyTimeline({
  history,
  startYear,
  endYear,
}: {
  // Map of year → conf record (incl. tourney round + seed).
  history: Map<number, ConfRecord>;
  // Inclusive year range to render. Each year becomes a cell, including
  // missed years (shown as a faded dot).
  startYear: number;
  endYear: number;
}) {
  const rows: RowEntry[] = [];
  for (let y = startYear; y <= endYear; y++) {
    const h = history.get(y);
    rows.push({
      year: y,
      seed: h?.tourneySeed ?? null,
      round: h?.tourneyRound ?? null,
    });
  }

  // Quick stat: tournament appearances + championships in window.
  const appearances = rows.filter((r) => r.round !== null).length;
  const championships = rows.filter((r) => r.round === "Champion").length;
  const finalFours = rows.filter((r) => r.round === "F4" || r.round === "Runner-Up" || r.round === "Champion").length;

  if (appearances === 0) return null;

  return (
    <div className="bg-paper-deep/25 border border-hairline rounded-xl shadow-sm p-5">
      <div className="flex items-baseline justify-between gap-4 mb-3">
        <div className="flex items-baseline gap-3">
          <span className="text-[0.65rem] uppercase tracking-widest text-coral font-bold inline-flex items-center gap-1.5">
            <Trophy size={11} strokeWidth={2.5} />
            NCAA Tournament
          </span>
          <span className="text-xs text-ink-muted tabular">
            {appearances} {appearances === 1 ? "appearance" : "appearances"}
            {finalFours > 0 && ` · ${finalFours} Final ${finalFours === 1 ? "Four" : "Fours"}`}
            {championships > 0 && ` · ${championships} title${championships === 1 ? "" : "s"}`}
          </span>
        </div>
      </div>
      <div className="overflow-x-auto -mx-2 px-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex items-stretch gap-1.5 min-w-min">
          {rows.map((r) => <YearCell key={r.year} row={r} />)}
        </div>
      </div>
    </div>
  );
}

function YearCell({ row }: { row: RowEntry }) {
  const yearStr = `${(row.year - 1).toString().slice(-2)}-${row.year.toString().slice(-2)}`;
  const tier = row.round ? ROUND_TIERS[row.round] ?? ROUND_TIERS.R64 : null;
  const title = row.round
    ? `${yearStr}: ${row.seed ? `${ordinal(row.seed)} seed, ` : ""}${row.round}`
    : `${yearStr}: did not make the tournament`;

  return (
    <div className="flex flex-col items-center gap-1.5 shrink-0 w-14" title={title}>
      <span className="text-xs uppercase tracking-wide text-ink-soft font-semibold tabular leading-none">
        {yearStr}
      </span>
      {row.seed !== null ? (
        <span className="text-xs text-ink-muted tabular leading-none font-medium">
          #{row.seed}
        </span>
      ) : (
        <span className="text-xs text-ink-muted/40 leading-none">·</span>
      )}
      {tier ? (
        <span
          className={cn(
            "inline-flex items-center justify-center w-12 h-8 rounded-md text-xs font-bold tabular leading-none",
            tier.bg,
            tier.fg,
          )}
        >
          {tier.label}
        </span>
      ) : (
        <span className="inline-flex items-center justify-center w-12 h-8 rounded-md bg-paper-deep/30 text-ink-muted/50 text-xs">
          —
        </span>
      )}
    </div>
  );
}

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}
