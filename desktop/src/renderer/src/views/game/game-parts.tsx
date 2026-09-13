import type { How } from "./game-model";

/** The modifier keys of a click, as a way to open something. */
export const howOf = (e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): How => ({
  newTab: e.ctrlKey || e.metaKey,
  side: e.shiftKey,
});

/**
 * A team color as text. Brand colors run from near-white to near-black, and
 * either end vanishes as type on one theme or the other: Gonzaga's navy on the
 * dark ground, a pale gold on paper. The hue and chroma stay the team's; the
 * lightness is held inside a band each theme sets (--team-l-min, --team-l-max
 * in styles.css), dark enough to read on paper and light enough on the dark.
 */
export const teamInk = (hex: string): string => `oklch(from ${hex} clamp(var(--team-l-min), l, var(--team-l-max)) c h)`;

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
