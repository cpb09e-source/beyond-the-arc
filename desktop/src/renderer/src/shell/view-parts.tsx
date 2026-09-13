import type { ReactNode } from "react";
import { seasonLabel } from "~/ui/format";
import { SeasonSwitcher } from "./season-switcher";

/**
 * The top of every view: what it is, which season, and how much is in it. One
 * shape for all of them, so the eye finds the same things in the same place.
 */
export function ViewHeader({
  kicker,
  title,
  year,
  setYear,
  meta,
}: {
  kicker: string;
  title: string;
  year: number;
  setYear: (y: number) => void;
  meta?: ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-end justify-between gap-4 px-5 pb-3 pt-4">
      <div className="min-w-0">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-accent">{kicker}</div>
        <div className="mt-1.5 flex items-center gap-3">
          <h1 className="truncate text-[21px] font-semibold leading-none tracking-[-0.015em] text-ink">{title}</h1>
          <SeasonSwitcher year={year} onChange={setYear} />
        </div>
      </div>
      {meta != null && <div className="shrink-0 pb-0.5 text-[12px] text-ink-muted tabular">{meta}</div>}
    </div>
  );
}

/** Rows shaped like the table's, so the switch from loading to loaded does not jump. */
export function TableSkeleton({ rowHeight, label }: { rowHeight: number; label: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="absolute inset-0 overflow-hidden">
      <div className="h-8 border-b border-hairline" />
      {Array.from({ length: 22 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-hairline/50 px-3" style={{ height: rowHeight }}>
          <span className="skeleton h-[8px] w-[22px] rounded" />
          <span className="skeleton h-[18px] w-[18px] rounded" />
          <span className="skeleton h-[8px] rounded" style={{ width: 90 + ((i * 37) % 70) }} />
          <span className="skeleton ml-auto h-[8px] w-[46%] rounded" />
        </div>
      ))}
    </div>
  );
}

export function LoadError({
  year,
  reason,
  message,
  what,
  onRetry,
}: {
  year: number;
  reason: "gated" | "failed";
  message: string;
  what: string;
  onRetry: () => void;
}) {
  return (
    <div className="grid h-full place-content-center gap-2.5 px-6 text-center">
      {reason === "gated" ? (
        <>
          <p className="text-[14px] font-medium text-ink">
            {what} for {seasonLabel(year)} are part of the Season Pass.
          </p>
          <p className="mx-auto max-w-[46ch] text-[12.5px] text-ink-muted">
            Signing in to the desktop app is not available yet, so this season only opens when running from the repo.
          </p>
        </>
      ) : (
        <>
          <p className="text-[14px] font-medium text-ink">
            {what} for {seasonLabel(year)} did not load.
          </p>
          <p className="mx-auto max-w-[46ch] text-[12.5px] text-ink-muted">{message}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mx-auto mt-1 h-7 rounded-md border border-hairline px-3 text-[12px] text-ink transition-colors hover:border-ink-muted"
          >
            Try again
          </button>
        </>
      )}
    </div>
  );
}

/** What an empty filter result says, and how to get out of it. */
export function NoMatches({ query, noun }: { query: string; noun: string }) {
  return (
    <p className="px-5 py-10 text-[13px] text-ink-muted">
      No {noun} matches &ldquo;{query.trim()}&rdquo;. <span className="text-ink-soft">Esc</span> clears the filter.
    </p>
  );
}
