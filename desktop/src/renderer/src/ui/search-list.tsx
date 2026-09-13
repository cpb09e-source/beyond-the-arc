import { Check, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { matchesQuery } from "~/ui/text";

export type ListItem = {
  key: string;
  label: string;
  /** Consecutive items with one group share a heading. */
  group?: string;
  leading?: ReactNode;
  /** Quiet text on the right: a conference, a range, a school. */
  meta?: ReactNode;
  /** Extra words that find it: a conference code, a stat's key, a school. */
  keywords?: string;
  title?: string;
};

/**
 * A list to choose from inside a popover: one thing, or several.
 *
 * THE MENU'S KEYBOARD, with typing. ↑ ↓ and Page keys move, Enter chooses,
 * Esc clears what was typed and then closes. A list short enough not to need a
 * search box (seasons, quadrants) takes the keys itself, and Space toggles.
 *
 * SEVERAL STAY OPEN. Picking a team adds it and leaves the list where it was,
 * so the next team is one more keystroke away; one-choice lists hand the pick
 * back and the caller closes them.
 *
 * Every key stops here, so nothing typed into a filter reaches the table or
 * the app's single-key shortcuts underneath.
 */
export function SearchList({
  items,
  label,
  selected,
  multi = false,
  search = true,
  placeholder,
  emptyText = "Nothing matches",
  onPick,
  onClose,
  footer,
}: {
  items: ListItem[];
  label: string;
  selected?: ReadonlySet<string>;
  multi?: boolean;
  search?: boolean;
  placeholder?: string;
  emptyText?: string;
  onPick: (key: string) => void;
  onClose: () => void;
  footer?: ReactNode;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => (query.trim() ? items.filter((it) => matchesQuery(query, it.label, it.keywords ?? "", it.group ?? "")) : items),
    [items, query],
  );
  const [active, setActive] = useState<string | null>(
    () => items.find((it) => selected?.has(it.key))?.key ?? items[0]?.key ?? null,
  );
  // Typing moves the highlight to the first match; arrowing moves it from there.
  const current = filtered.some((it) => it.key === active) ? active : (filtered[0]?.key ?? null);
  const indexOf = new Map(filtered.map((it, i) => [it.key, i]));
  const domId = (key: string) => `${id}-${indexOf.get(key) ?? "x"}`;

  useEffect(() => {
    if (search) inputRef.current?.focus({ preventScroll: true });
    else listRef.current?.focus({ preventScroll: true });
    if (current) document.getElementById(domId(current))?.scrollIntoView({ block: "nearest" });
    // Mount only: the list opens on what is chosen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const move = (to: number) => {
    const it = filtered[Math.max(0, Math.min(filtered.length - 1, to))];
    if (!it) return;
    setActive(it.key);
    document.getElementById(domId(it.key))?.scrollIntoView({ block: "nearest" });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const i = current ? (indexOf.get(current) ?? -1) : -1;
    if (e.key === "ArrowDown") move(i + 1);
    else if (e.key === "ArrowUp") move(i - 1);
    else if (e.key === "PageDown") move(i + 8);
    else if (e.key === "PageUp") move(i - 8);
    else if (e.key === "Home" && !search) move(0);
    else if (e.key === "End" && !search) move(filtered.length - 1);
    else if (e.key === "Enter" || (e.key === " " && !search)) {
      if (current) onPick(current);
    } else if (e.key === "Escape") {
      if (query) setQuery("");
      else onClose();
    } else if (e.key === "Tab") onClose();
    else return;
    e.preventDefault();
  };

  const rows: ReactNode[] = [];
  let group: string | undefined;
  filtered.forEach((it, i) => {
    if (it.group && it.group !== group) {
      group = it.group;
      rows.push(
        <div
          key={`group:${it.group}:${i}`}
          role="presentation"
          className="sticky top-0 z-10 bg-card px-2 pb-1 pt-2 text-[11px] font-medium text-ink-muted"
        >
          {it.group}
        </div>,
      );
    }
    const on = it.key === current;
    const checked = selected?.has(it.key) ?? false;
    rows.push(
      <div
        key={it.key}
        id={domId(it.key)}
        role="option"
        aria-selected={checked}
        title={it.title}
        onMouseMove={() => it.key !== active && setActive(it.key)}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onPick(it.key)}
        className={`flex h-[30px] cursor-default items-center gap-2.5 rounded-md px-2 text-[13px] ${
          on ? "bg-[var(--menu-active)] text-ink" : "text-ink-soft"
        }`}
      >
        {multi && (
          <span
            aria-hidden
            className={`grid size-[14px] shrink-0 place-items-center rounded-[4px] border transition-colors ${
              checked ? "border-accent bg-accent text-white" : "border-[color-mix(in_oklab,var(--ink-muted)_60%,transparent)]"
            }`}
          >
            {checked && <Check size={10} strokeWidth={3} />}
          </span>
        )}
        {it.leading != null && <span className="flex shrink-0 items-center text-ink-muted">{it.leading}</span>}
        <span className="min-w-0 flex-1 truncate">{it.label}</span>
        {it.meta != null && <span className="shrink-0 truncate text-[11.5px] text-ink-muted tabular">{it.meta}</span>}
        {!multi && (
          <span className="flex w-3.5 shrink-0 justify-center">
            {checked && <Check size={13} strokeWidth={2.25} className="text-accent" />}
          </span>
        )}
      </div>,
    );
  });

  return (
    <div onKeyDown={onKeyDown} className="flex min-h-0 flex-1 flex-col">
      {search && (
        <label className="flex h-[38px] shrink-0 items-center gap-2 border-b border-hairline px-3">
          <Search size={14} strokeWidth={2} className="shrink-0 text-ink-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            role="combobox"
            aria-expanded
            aria-controls={`${id}-list`}
            aria-activedescendant={current ? domId(current) : undefined}
            aria-label={placeholder ?? label}
            placeholder={placeholder ?? label}
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-muted"
          />
          {multi && selected && selected.size > 0 && (
            <span className="shrink-0 text-[11px] text-ink-muted tabular">{selected.size} chosen</span>
          )}
        </label>
      )}
      <div
        ref={listRef}
        id={`${id}-list`}
        role="listbox"
        aria-label={label}
        aria-multiselectable={multi || undefined}
        aria-activedescendant={!search && current ? domId(current) : undefined}
        tabIndex={search ? -1 : 0}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1 outline-none"
      >
        {filtered.length > 0 ? (
          rows
        ) : (
          <p className="px-3 py-6 text-center text-[12.5px] text-ink-muted">
            {emptyText} &ldquo;{query.trim()}&rdquo;.
          </p>
        )}
      </div>
      {footer && <div className="flex shrink-0 items-center gap-1 border-t border-hairline p-1">{footer}</div>}
    </div>
  );
}

/** A quiet action along the bottom of a list: All, Latest, Clear. */
export function ListFooterButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="h-[26px] rounded-md px-2 text-[12px] text-ink-soft transition-colors hover:bg-[var(--row-hover)] hover:text-ink"
    >
      {children}
    </button>
  );
}
