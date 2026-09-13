import { PercentileChip } from "@/components/percentile-chip";

/** One number as a Peek shows it: its label, its text, and its chip if it has one. */
export type Read = { label: string; text: string; pct: number | null; neutral: boolean };

/**
 * A Peek section of numbers over chips, four to a row.
 *
 * ONE SHAPE IN EVERY PEEK, so the chip sits in the same place under every
 * number whether the Peek is a team, a player or a game.
 */
export function Cells({ title, cells }: { title: string; cells: Read[] }) {
  return (
    <section className="border-t border-hairline px-4 py-2.5">
      <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-muted">{title}</h3>
      <div className="grid grid-cols-4 gap-x-2 gap-y-3">
        {cells.map((c) => (
          <div key={c.label} className="flex flex-col items-start gap-1">
            <span className="text-[10.5px] text-ink-muted">{c.label}</span>
            <span className="text-[15px] leading-none text-ink tabular">{c.text}</span>
            <PercentileChip pct={c.pct} neutral={c.neutral} className="min-w-[26px] px-1 py-[2px] text-[10.5px]" />
          </div>
        ))}
      </div>
    </section>
  );
}
