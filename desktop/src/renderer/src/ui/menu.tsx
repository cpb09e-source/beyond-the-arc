import { Check, ChevronRight } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";

/**
 * One menu for every dropdown and every right-click.
 *
 * THE SAME ROW, THE SAME KEYBOARD, THE SAME WAY OUT everywhere: 32px rows (Linear's),
 * ↑ ↓ to move (skipping headings, separators and disabled rows), Enter or Space
 * to choose, Esc or a click outside to close. A menu that behaves slightly
 * differently in each place is a menu nobody trusts with their keyboard.
 *
 * A SECOND LEVEL OPENS TO THE SIDE, as Linear's "Go to ›" does: → or hover opens
 * it, ← or Esc comes back. It waits a moment before giving way to another row,
 * so a pointer crossing a neighbor on the way into it does not close it.
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
  onSelect?: () => void;
  /** Entries opened to the side instead of an action of its own. */
  submenu?: MenuEntry[];
};

export type MenuEntry =
  | MenuItem
  | { kind: "separator"; id: string }
  | { kind: "heading"; id: string; label: string }
  | { kind: "custom"; id: string; node: ReactNode };

/** How long a pointer may cross other rows on its way into an open submenu. */
const SUBMENU_GRACE_MS = 160;

export function Menu({
  entries,
  label,
  onClose,
  triggerRef,
  className = "",
  style,
  nested = false,
  onBack,
}: {
  entries: MenuEntry[];
  label: string;
  /** Closes the whole menu, every level. */
  onClose: () => void;
  triggerRef?: RefObject<HTMLElement | null>;
  className?: string;
  style?: CSSProperties;
  /** A submenu: its parent owns outside clicks and where focus returns. */
  nested?: boolean;
  /** A submenu's way back to its parent: ← and Esc. */
  onBack?: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const items = entries.filter((e): e is MenuItem => e.kind === "item" && !e.disabled);
  const [active, setActive] = useState<string | null>(items[0]?.id ?? null);
  const [sub, setSub] = useState<string | null>(null);
  const [previous] = useState(() => document.activeElement as HTMLElement | null);
  const close = useRef(onClose);
  const grace = useRef(0);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    listRef.current?.focus({ preventScroll: true });
    if (nested) return;
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
  }, [triggerRef, previous, nested]);

  useEffect(() => () => window.clearTimeout(grace.current), []);

  const choose = (item: MenuItem) => {
    if (item.submenu) {
      setActive(item.id);
      setSub(item.id);
      return;
    }
    close.current();
    item.onSelect?.();
  };

  const back = () => {
    setSub(null);
    listRef.current?.focus({ preventScroll: true });
  };

  const hover = (entry: MenuItem) => {
    if (entry.disabled) return;
    setActive(entry.id);
    window.clearTimeout(grace.current);
    const next = entry.submenu ? entry.id : null;
    if (sub === null || next === sub) {
      setSub(next);
      return;
    }
    grace.current = window.setTimeout(() => setSub(next), SUBMENU_GRACE_MS);
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
        const current = items[i];
        let handled = true;
        if (e.key === "ArrowDown") setActive(items[(i + 1) % items.length]?.id ?? null);
        else if (e.key === "ArrowUp") setActive(items[(i - 1 + items.length) % items.length]?.id ?? null);
        else if (e.key === "Home") setActive(items[0]?.id ?? null);
        else if (e.key === "End") setActive(items[items.length - 1]?.id ?? null);
        else if (e.key === "ArrowRight" && current?.submenu) setSub(current.id);
        else if (e.key === "ArrowLeft" && nested) onBack?.();
        else if (e.key === "Enter" || e.key === " ") {
          if (current) choose(current);
        } else if (e.key === "Escape") (nested && onBack ? onBack : close.current)();
        else if (e.key === "Tab") close.current();
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
        const open = sub === entry.id && !!entry.submenu;
        return (
          <div key={entry.id} className="relative">
            <div
              role={entry.checked !== undefined ? "menuitemradio" : "menuitem"}
              aria-checked={entry.checked}
              aria-disabled={entry.disabled || undefined}
              aria-haspopup={entry.submenu ? "menu" : undefined}
              aria-expanded={entry.submenu ? open : undefined}
              onMouseEnter={() => hover(entry)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => !entry.disabled && choose(entry)}
              className={`flex h-[32px] cursor-default items-center gap-2.5 rounded-md px-2 text-[13px] ${
                entry.disabled
                  ? "text-ink-muted/60"
                  : isActive || open
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
              {entry.submenu && <ChevronRight size={13} strokeWidth={2} className="-mr-0.5 shrink-0 text-ink-muted" />}
            </div>
            {open && (
              <Submenu
                label={entry.label}
                entries={entry.submenu!}
                onClose={() => close.current()}
                onBack={back}
                onEnter={() => window.clearTimeout(grace.current)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** A second level beside its row, turned to the left where the right edge of the window is too close. */
function Submenu({
  label,
  entries,
  onClose,
  onBack,
  onEnter,
}: {
  label: string;
  entries: MenuEntry[];
  onClose: () => void;
  onBack: () => void;
  onEnter: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ flip: boolean; dy: number }>({ flip: false, dy: 0 });
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setPlace({
      flip: r.right > window.innerWidth - 8,
      dy: r.bottom > window.innerHeight - 8 ? Math.max(8 - r.top, window.innerHeight - 8 - r.bottom) : 0,
    });
  }, []);
  return (
    <div
      ref={ref}
      onMouseEnter={onEnter}
      className={`absolute z-10 ${place.flip ? "right-full pr-1" : "left-full pl-1"}`}
      style={{ top: -5 + place.dy }}
    >
      <Menu nested label={label} entries={entries} onClose={onClose} onBack={onBack} />
    </div>
  );
}
