import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { PercentileChip } from "@/components/percentile-chip";

/**
 * The site's stat cards as the app draws them: a titled card of rows, each a
 * label, a value and its percentile chip. The Player and Team Overviews both
 * use them, sliced by the site's own splits.
 *
 * COLUMNS FROM THE GRID'S OWN WIDTH, not the pane's: with the details rail open
 * a pane can be wide while its content is not, and three 270px cards cut
 * "Points Allowed / Game" to "Points Allowed …". A label that still runs long
 * wraps rather than truncating.
 */

export function StatCardsHeader({ title, meta, children }: { title: string; meta?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
      <h2 className="mr-1 text-[12px] font-medium text-ink-muted">{title}</h2>
      {/* Left-aligned: a picker's menu opens to its right, and at the pane's
          right edge it would run out of room. */}
      {children}
      {meta && <span className="ml-auto text-[12px] text-ink-muted tabular">{meta}</span>}
    </div>
  );
}

export function StatCardGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">{children}</div>;
}

export function StatCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-lg border border-hairline bg-card px-4 pb-2 pt-3.5">
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-accent">{title}</h3>
      <ul className="divide-y divide-[color-mix(in_oklab,var(--hairline)_75%,transparent)]">{children}</ul>
    </section>
  );
}

export function StatCardRow({
  label,
  value,
  pct,
  neutral = false,
  info,
  sub,
  caps = false,
}: {
  label: string;
  value: string;
  pct: number | null;
  neutral?: boolean;
  /** What the stat is, shown on hover. */
  info?: string;
  /** A second line under the label: "full season", "40.1% of shots". */
  sub?: string;
  /** Small capitals, the player cards' labels; team labels are already written out. */
  caps?: boolean;
}) {
  return (
    <li title={info} className="-mx-1.5 flex min-h-[38px] items-center gap-3 rounded-[5px] px-1.5 py-1.5 transition-colors hover:bg-[var(--row-hover)]">
      <span className="min-w-0 flex-1">
        <span className={`block leading-snug text-ink-soft ${caps ? "text-[12px] uppercase tracking-[0.04em]" : "text-[13px]"}`}>
          {caps ? <CapsLabel text={label} /> : label}
          {info && <Info size={12} strokeWidth={2} aria-hidden className="ml-1 inline-block align-[-1px] text-ink-muted" />}
        </span>
        {sub && <span className="block text-[11px] text-ink-muted tabular">{sub}</span>}
      </span>
      <span className="min-w-[60px] shrink-0 whitespace-nowrap text-right text-[13.5px] font-medium text-ink tabular">{value}</span>
      <span className="flex w-9 shrink-0 justify-end">
        {pct != null ? (
          <PercentileChip pct={pct} neutral={neutral} className="w-9 justify-center text-[11px]">
            {pct}
          </PercentileChip>
        ) : (
          <span className="w-9 text-center text-[11px] text-ink-muted">–</span>
        )}
      </span>
    </li>
  );
}

export function StatCardsNote({ children }: { children: ReactNode }) {
  return <p className="mt-3 max-w-[90ch] text-[11.5px] leading-relaxed text-ink-muted">{children}</p>;
}

/** eWins and eFG% keep their lower-case e under the capitals, as the site's StatLabel does. */
function CapsLabel({ text }: { text: string }) {
  if (!/^[a-z][A-Z]/.test(text)) return <>{text}</>;
  return <span className="normal-case">{text[0] + text.slice(1).toUpperCase()}</span>;
}
