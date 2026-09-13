import { Check } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";

/**
 * One menu for every dropdown, and later every right-click.
 *
 * THE SAME ROW, THE SAME KEYBOARD, THE SAME WAY OUT everywhere: 32px rows (Linear's),
 * ↑ ↓ to move (skipping headings, separators and disabled rows), Enter or Space
 * to choose, Esc or a click outside to close. A menu that behaves slightly
 * differently in each place is a menu nobody trusts with their keyboard.
 *
 * FOCUS GOES BACK TO WHAT HAD IT, not to the button that opened the menu. After
 * a mouse pick, focus on that button would make the next Space press it again
 * instead of opening Peek on the table.
 */

export type MenuItem = {
  kind: "item";
  id: string;
  label: string;
  icon?: ReactNode;
  hint?: ReactNode;
  /** Draws a check mark column; true for the chosen option. */
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

export type MenuEntry =
  | MenuItem
  | { kind: "separator"; id: string }
  | { kind: "heading"; id: string; label: string }
  | { kind: "custom"; id: string; node: ReactNode };

export function Menu({
  entries,
  label,
  onClose,
  triggerRef,
  className = "",
  style,
}: {
  entries: MenuEntry[];
  label: string;
  onClose: () => void;
  triggerRef?: RefObject<HTMLElement | null>;
  className?: string;
  style?: CSSProperties;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const items = entries.filter((e): e is MenuItem => e.kind === "item" && !e.disabled);
  const [active, setActive] = useState<string | null>(items[0]?.id ?? null);
  const [previous] = useState(() => document.activeElement as HTMLElement | null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    listRef.current?.focus({ preventScroll: true });
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (listRef.current?.contains(target) || triggerRef?.current?.contains(target)) return;
      close.current();
    };
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("mousedown", onDown);
      if (document.activeElement === document.body && previous && previous !== document.body && previous.isConnected) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [triggerRef, previous]);

  const choose = (item: MenuItem) => {
    close.current();
    item.onSelect();
  };

  const hasChecks = entries.some((e) => e.kind === "item" && e.checked !== undefined);

  return (
    <div
      ref={listRef}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={(e) => {
        const i = items.findIndex((it) => it.id === active);
        let handled = true;
        if (e.key === "ArrowDown") setActive(items[(i + 1) % items.length]?.id ?? null);
        else if (e.key === "ArrowUp") setActive(items[(i - 1 + items.length) % items.length]?.id ?? null);
        else if (e.key === "Home") setActive(items[0]?.id ?? null);
        else if (e.key === "End") setActive(items[items.length - 1]?.id ?? null);
        else if (e.key === "Enter" || e.key === " ") {
          const it = items[i];
          if (it) choose(it);
        } else if (e.key === "Escape" || e.key === "Tab") close.current();
        else handled = false;
        if (handled) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      className={`menu-in z-40 min-w-[220px] rounded-lg border border-hairline bg-card p-1 outline-none ${className}`}
      style={{ boxShadow: "var(--overlay-shadow)", ...style }}
    >
      {entries.map((entry) => {
        if (entry.kind === "separator") return <div key={entry.id} role="separator" className="mx-1 my-1 h-px bg-hairline" />;
        if (entry.kind === "heading") {
          return (
            <div key={entry.id} className="px-2 pb-1 pt-1.5 text-[11px] font-medium text-ink-muted">
              {entry.label}
            </div>
          );
        }
        if (entry.kind === "custom") return <div key={entry.id}>{entry.node}</div>;
        const isActive = entry.id === active && !entry.disabled;
        return (
          <div
            key={entry.id}
            role={entry.checked !== undefined ? "menuitemradio" : "menuitem"}
            aria-checked={entry.checked}
            aria-disabled={entry.disabled || undefined}
            onMouseEnter={() => !entry.disabled && setActive(entry.id)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => !entry.disabled && choose(entry)}
            className={`flex h-[32px] cursor-default items-center gap-2.5 rounded-md px-2 text-[13px] ${
              entry.disabled
                ? "text-ink-muted/60"
                : isActive
                  ? `bg-[var(--menu-active)] ${entry.danger ? "text-bad" : "text-ink"}`
                  : entry.danger
                    ? "text-bad"
                    : "text-ink-soft"
            }`}
          >
            {hasChecks && (
              <span className="flex w-3.5 shrink-0 justify-center">
                {entry.checked && <Check size={13} strokeWidth={2.25} className="text-accent" />}
              </span>
            )}
            {entry.icon && <span className="flex w-4 shrink-0 justify-center text-ink-muted">{entry.icon}</span>}
            <span className="min-w-0 flex-1 truncate">{entry.label}</span>
            {entry.hint && <span className="flex shrink-0 items-center gap-1 text-[11.5px] text-ink-muted">{entry.hint}</span>}
          </div>
        );
      })}
    </div>
  );
}
