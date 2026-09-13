import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export type PickerOption = { key: string; label: string; desc?: string };

/**
 * A view's own mode, in a compact menu beside the season: which set of columns
 * a game log shows, for one.
 *
 * The season switcher's keyboard model and look, for the same reason it is not
 * a native <select>: ↑ ↓ move, Enter picks, Esc closes, and its keys stop at
 * the list so the table underneath never moves. Each option can say what it is
 * for in a second line, because "Situational" alone does not.
 */
export function Picker({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: PickerOption[];
  onChange: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(value);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const id = useId();
  const current = options.find((o) => o.key === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    setActive(value);
    requestAnimationFrame(() => listRef.current?.focus());
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open, value]);

  const choose = (key: string) => {
    onChange(key);
    setOpen(false);
  };

  const keys = options.map((o) => o.key);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}, ${current?.label ?? ""}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-[26px] items-center gap-1.5 rounded-md border border-hairline bg-card px-2 text-[12.5px] font-medium text-ink transition-colors hover:border-ink-muted"
      >
        <span className="font-normal text-ink-muted">{label}</span>
        {current?.label}
        <ChevronDown size={14} className={`text-ink-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <ul
          ref={listRef}
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          aria-activedescendant={`${id}-${active}`}
          onKeyDown={(e) => {
            const i = keys.indexOf(active);
            let handled = true;
            if (e.key === "ArrowDown") setActive(keys[Math.min(keys.length - 1, i + 1)] ?? active);
            else if (e.key === "ArrowUp") setActive(keys[Math.max(0, i - 1)] ?? active);
            else if (e.key === "Enter" || e.key === " ") choose(active);
            else if (e.key === "Escape") setOpen(false);
            else handled = false;
            if (handled) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          className="menu-in absolute left-0 top-[calc(100%+6px)] z-30 w-[288px] rounded-lg border border-hairline bg-card p-1 outline-none"
          style={{ boxShadow: "var(--overlay-shadow)" }}
        >
          {options.map((o) => (
            <li
              key={o.key}
              id={`${id}-${o.key}`}
              role="option"
              aria-selected={o.key === value}
              onMouseEnter={() => setActive(o.key)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(o.key)}
              className={`flex cursor-default items-start gap-2 rounded-md px-2 py-1.5 ${
                o.key === active ? "bg-[var(--menu-active)]" : ""
              }`}
            >
              <Check size={13} className={`mt-[3px] shrink-0 ${o.key === value ? "text-accent" : "invisible"}`} />
              <span className="min-w-0">
                <span className={`block text-[12.5px] ${o.key === active ? "text-ink" : "text-ink-soft"}`}>{o.label}</span>
                {o.desc && <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-muted">{o.desc}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
