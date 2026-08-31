"use client";

/**
 * Selected players, as removable chips under their picker.
 *
 * The picker's own trigger becomes the search field once it is open, so while
 * you are typing it cannot also show what you have already chosen. The chips
 * are where the current selection lives: readable at a glance, one click to
 * drop any of it.
 *
 * Shared by the Lineups and On/Off tabs. They ask different questions of the
 * same roster, and a selection that looked one way on one tab and another way
 * on the next would read as two unrelated controls.
 */
export function PlayerChips({
  ids,
  nameOf,
  onRemove,
}: {
  ids: string[];
  nameOf: Map<number, string>;
  onRemove: (v: string) => void;
}) {
  if (ids.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {ids.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onRemove(v)}
          className="group inline-flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded text-xs font-medium bg-card border border-ink/15 text-ink hover:border-ink/30 transition-colors"
        >
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: "var(--accent)" }}
          />
          {nameOf.get(Number(v)) ?? v}
          <span aria-hidden className="text-ink-muted group-hover:text-ink transition-colors">×</span>
          <span className="sr-only">Remove</span>
        </button>
      ))}
    </div>
  );
}
