import { PercentileChip, pctBg, pctColor } from "@/components/percentile-chip";
import type { ReactNode } from "react";

/**
 * The anatomy every profile shares, after Attio's record pages: who it is, top
 * left, with the facts that place it; a row of the numbers that matter most;
 * tabs; and the tab's content.
 *
 * THE SAME PARTS FOR A TEAM AND A PLAYER, so a reader who has learned where the
 * rank sits on one knows where it sits on the other.
 */

export function ProfileHeader({
  avatar,
  name,
  badges,
  facts,
  actions,
}: {
  avatar: ReactNode;
  name: string;
  badges?: ReactNode;
  facts: ReactNode[];
  actions?: ReactNode;
}) {
  const shown = facts.filter((f) => f !== null && f !== undefined && f !== false && f !== "");
  return (
    <div className="flex items-start gap-4">
      <div className="shrink-0">{avatar}</div>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">{name}</h1>
          {badges}
        </div>
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-muted">
          {shown.map((f, i) => (
            <span key={i} className="flex min-w-0 items-center gap-2">
              {i > 0 && (
                <span aria-hidden className="text-hairline">
                  ·
                </span>
              )}
              {f}
            </span>
          ))}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export type Highlight = {
  label: string;
  value: string;
  pct: number | null;
  neutral?: boolean;
  title?: string;
};

/** Six numbers, each with its place in the field. */
export function HighlightRow({ items }: { items: Highlight[] }) {
  return (
    <div className="grid grid-cols-3 gap-2 xl:grid-cols-6">
      {items.map((h) => (
        <div key={h.label} title={h.title} className="rounded-lg border border-hairline bg-card px-3 pb-2.5 pt-2">
          <div className="truncate text-[11.5px] text-ink-muted">{h.label}</div>
          <div className="mt-1.5 flex items-end justify-between gap-2">
            <span className="text-[20px] font-semibold leading-none tracking-[-0.01em] text-ink tabular">{h.value}</span>
            <PercentileChip pct={h.pct} neutral={h.neutral} className="min-w-[28px] px-1 py-[3px] text-[11px]" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ProfileTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: Array<{ key: T; label: string; count?: number | null }>;
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <div role="tablist" className="flex items-center gap-1 border-b border-hairline">
      {tabs.map((t) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChange(t.key)}
            className={`relative flex h-[36px] items-center gap-1.5 px-2.5 text-[13px] transition-colors ${
              active ? "font-medium text-ink" : "text-ink-muted hover:text-ink-soft"
            }`}
          >
            {t.label}
            {t.count != null && <span className="text-[11.5px] font-normal text-ink-muted tabular">{t.count.toLocaleString()}</span>}
            {active && <span aria-hidden className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-ink" />}
          </button>
        );
      })}
    </div>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <h2 className="text-[12px] font-medium text-ink-muted">{children}</h2>
      {aside && <span className="text-[11.5px] text-ink-muted">{aside}</span>}
    </div>
  );
}

/**
 * A stat as a bar along the field: how far past everyone else it sits, painted
 * in the percentile ramp, with the number and the chip beside it.
 *
 * The bar is the same band color as the chip, so a row of them reads as a
 * profile at a glance: long and green where a player is strong, short and red
 * where he is not, and the near-neutral middle for average.
 */
export function PercentileBar({
  label,
  value,
  pct,
  neutral = false,
  title,
}: {
  label: string;
  value: string;
  pct: number | null;
  neutral?: boolean;
  title?: string;
}) {
  const fill = pct == null ? null : neutral ? "var(--pct-bg-4)" : pctBg(pct);
  const edge = pct == null ? null : neutral ? "var(--pct-fg-4)" : pctColor(pct);
  return (
    <div title={title} className="grid grid-cols-[108px_minmax(0,1fr)_56px_34px] items-center gap-3 py-[5px] text-[12.5px]">
      <span className="truncate text-ink-soft">{label}</span>
      <span className="relative h-[7px] overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--ink)_7%,transparent)]">
        {pct != null && (
          <span
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              width: `${Math.max(3, pct)}%`,
              background: fill ?? undefined,
              boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${edge} 30%, transparent)`,
            }}
          />
        )}
      </span>
      <span className="text-right text-ink tabular">{value}</span>
      <span className="flex justify-end">
        <PercentileChip pct={pct} neutral={neutral} className="min-w-[30px] text-[11px]" />
      </span>
    </div>
  );
}

/** A quiet button for a profile's header: an icon and a few words. */
export function HeaderButton({
  onClick,
  children,
  title,
}: {
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="inline-flex h-[26px] items-center gap-1.5 rounded-md border border-hairline bg-card px-2.5 text-[12.5px] text-ink-soft transition-colors hover:border-ink-muted hover:text-ink"
    >
      {children}
    </button>
  );
}

/** A profile's empty or missing state, in the content area. */
export function ProfileNote({ children }: { children: ReactNode }) {
  return <p className="px-6 py-10 text-[13px] text-ink-muted">{children}</p>;
}
