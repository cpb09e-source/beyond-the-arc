import type { How } from "./game-model";

/** The modifier keys of a click, as a way to open something. */
export const howOf = (e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): How => ({
  newTab: e.ctrlKey || e.metaKey,
  side: e.shiftKey,
});

/** A name that goes somewhere when it can, and is plain text when it cannot. */
export function NameLink({
  text,
  open,
  className = "",
}: {
  text: string;
  open?: ((how: How) => void) | null;
  className?: string;
}) {
  if (!open) return <span className={className}>{text}</span>;
  return (
    <button
      type="button"
      title={`Open ${text}  ·  Ctrl-click for a new tab, Shift-click beside`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => open(howOf(e))}
      className={`${className} min-w-0 text-left decoration-[color-mix(in_oklab,var(--ink-muted)_55%,transparent)] underline-offset-[3px] hover:underline`}
    >
      {text}
    </button>
  );
}

/** An AP poll rank beside a name. */
export function RankChip({ n }: { n: number }) {
  return (
    <span
      title={`No. ${n} in the AP poll`}
      className="shrink-0 rounded-[4px] bg-[var(--accent-wash)] px-1 py-px font-mono text-[11px] font-semibold text-accent tabular"
    >
      {n}
    </span>
  );
}
