import type { Dispatch, SetStateAction } from "react";

export type Shortcut = { key: string; label: string; desc: string };

/**
 * A table's named questions, as toggles that compose.
 *
 * Each shortcut is one of the site's presets: a filter or two with a name on
 * it. Two on means both, as on the site, so "40-point games" and "20 & 10"
 * together are the 40-and-10 nights.
 *
 * NO BUTTON HERE TAKES FOCUS on a click. If it did, the next Space would press
 * it again instead of opening Peek on the table underneath.
 */
export function ShortcutBar({
  presets,
  on,
  onChange,
}: {
  presets: Shortcut[];
  on: string[];
  onChange: Dispatch<SetStateAction<string[]>>;
}) {
  return (
    <div role="group" aria-label="Shortcuts" className="flex shrink-0 flex-wrap items-center gap-1.5 px-5 pb-2.5">
      {presets.map((p) => {
        const active = on.includes(p.key);
        return (
          <button
            key={p.key}
            type="button"
            title={p.desc}
            aria-pressed={active}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChange((s) => (active ? s.filter((k) => k !== p.key) : [...s, p.key]))}
            className={`h-[24px] rounded-md border px-2 text-[12px] transition-colors ${
              active
                ? "border-accent bg-[var(--accent-wash)] text-ink"
                : "border-hairline text-ink-soft hover:border-ink-muted hover:text-ink"
            }`}
          >
            {p.label}
          </button>
        );
      })}
      {on.length > 0 && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange([])}
          className="ml-1 h-[24px] px-1.5 text-[12px] text-ink-muted transition-colors hover:text-ink"
        >
          Clear
        </button>
      )}
    </div>
  );
}
