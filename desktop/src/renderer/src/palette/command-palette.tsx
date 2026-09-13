import { Command } from "cmdk";
import { Search } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Kbd } from "~/ui/kbd";
import { normalizeText } from "~/ui/text";
import { prepare, score, type Prepared } from "./rank";

/**
 * Ctrl K: one box that reaches everything in the app.
 *
 * THE ORDER IS OURS, NOT CMDK'S. cmdk supplies the keyboard model and the
 * accessibility wiring; its built-in filter re-sorts DOM nodes on every
 * keystroke and knows nothing about where a word matched, so it is switched off
 * and rank.ts decides. Groups follow their best match while typing, so "duke"
 * leads with a team and "dark" leads with the theme.
 *
 * ITS KEYS STOP HERE. The table moves on ↑ ↓ from any input, Peek listens for
 * Space and Esc, and [ ] step seasons; none of that may happen underneath an
 * open palette, so every key event ends at its root.
 */

export type PaletteItem = {
  /** Unique and stable: the palette tracks the highlighted row by it. */
  id: string;
  group: string;
  title: string;
  subtitle?: string;
  /** Matched but never shown: "appearance" finds the theme rows. */
  keywords?: string[];
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Breaks ties between equally good matches; higher first. */
  weight?: number;
  /**
   * Rows sharing this key are one thing across seasons: a team, a player.
   * Unless the query names a season, only the best of them is listed.
   */
  collapse?: string;
  /** Folded ahead of time by lists too long to fold on every open. */
  prepared?: Prepared;
  run: () => void;
};

export type PaletteGroup = {
  id: string;
  heading: string;
  /** Rows shown while typing. */
  limit: number;
  /** Whether the group appears before anything is typed. */
  showWhenEmpty: boolean;
};

export function CommandPalette({
  groups,
  items,
  placeholder,
  onClose,
}: {
  groups: PaletteGroup[];
  items: PaletteItem[];
  placeholder: string;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState("");
  // Whatever had focus before the palette opened, captured before its input takes it.
  const [previous] = useState(() => document.activeElement as HTMLElement | null);

  useEffect(
    () => () => {
      // Hand focus back, unless the command just run put it somewhere on purpose
      // (the filter box, say).
      const now = document.activeElement;
      if ((now == null || now === document.body) && previous && previous !== document.body && previous.isConnected) {
        previous.focus({ preventScroll: true });
      }
    },
    [previous],
  );

  // Bucketed by group once per list, so a keystroke walks only rows it can show.
  const byGroup = useMemo(() => {
    const m = new Map<string, Array<{ item: PaletteItem; p: Prepared }>>();
    for (const item of items) {
      let bucket = m.get(item.group);
      if (!bucket) m.set(item.group, (bucket = []));
      bucket.push({ item, p: item.prepared ?? prepare(item) });
    }
    return m;
  }, [items]);

  const results = useMemo(() => {
    const q = normalizeText(query);
    const words = q ? q.split(" ") : [];
    // A number in the query names a season, so every matching season of a team
    // or player is listed instead of only its best one.
    const namesSeason = words.some((w) => /^\d{2,4}$/.test(w));
    const out: Array<{ group: PaletteGroup; rows: PaletteItem[]; best: number; order: number }> = [];
    groups.forEach((group, order) => {
      if (words.length === 0 && !group.showWhenEmpty) return;
      const scored: Array<{ s: number; item: PaletteItem }> = [];
      for (const { item, p } of byGroup.get(group.id) ?? []) {
        const s = score(words, p, item.weight);
        if (s >= 0) scored.push({ s, item });
      }
      if (scored.length === 0) return;
      // With nothing typed, a group keeps the order it was built in.
      if (words.length > 0) scored.sort((a, b) => b.s - a.s);
      const rows: PaletteItem[] = [];
      const seen = new Set<string>();
      for (const { item } of scored) {
        if (item.collapse && !namesSeason) {
          if (seen.has(item.collapse)) continue;
          seen.add(item.collapse);
        }
        rows.push(item);
        if (words.length > 0 && rows.length === group.limit) break;
      }
      out.push({ group, rows, best: scored[0]!.s, order });
    });
    if (words.length > 0) out.sort((a, b) => b.best - a.best || a.order - b.order);
    return out;
  }, [byGroup, groups, query]);

  // The highlight stays on the row it was on while that row is still listed,
  // and falls to the first row otherwise.
  const flat = results.flatMap((r) => r.rows);
  const current = flat.some((r) => r.id === active) ? active : (flat[0]?.id ?? "");

  const pick = (item: PaletteItem) => {
    onClose();
    item.run();
  };

  return (
    <div
      className="fixed inset-0 z-50"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          // Esc clears first, then closes, as the filter box does.
          if (query) {
            setQuery("");
            setActive("");
          } else onClose();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div aria-hidden className="palette-scrim absolute inset-0" onMouseDown={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="palette-in relative mx-auto mt-[11vh] w-[min(640px,calc(100vw-48px))] overflow-hidden rounded-xl border border-hairline bg-card"
        style={{ boxShadow: "var(--overlay-shadow)" }}
      >
        <Command label="Search" shouldFilter={false} loop value={current} onValueChange={setActive}>
          <div className="flex h-[52px] items-center gap-3 border-b border-hairline px-4">
            <Search size={17} strokeWidth={2} className="shrink-0 text-ink-muted" />
            <Command.Input
              autoFocus
              value={query}
              onValueChange={(v) => {
                setQuery(v);
                // A new query highlights its best match, not the row the old one had.
                setActive("");
              }}
              placeholder={placeholder}
              spellCheck={false}
              className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-muted"
            />
            <Kbd>Esc</Kbd>
          </div>

          <Command.List className="max-h-[min(440px,calc(100vh-260px))] scroll-py-2 overflow-y-auto overscroll-contain p-1.5">
            {results.length === 0 ? (
              <p className="px-3 py-9 text-center text-[13px] text-ink-muted">
                Nothing matches &ldquo;{query.trim()}&rdquo;.
              </p>
            ) : (
              results.map(({ group, rows }) => (
                <Command.Group
                  key={group.id}
                  heading={group.heading}
                  className="mb-1 last:mb-0 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.1em] [&_[cmdk-group-heading]]:text-ink-muted"
                >
                  {rows.map((item) => (
                    <Command.Item
                      key={item.id}
                      value={item.id}
                      onSelect={() => pick(item)}
                      className="flex h-[36px] cursor-default items-center gap-3 rounded-md px-2.5 text-[13px] text-ink-soft data-[selected=true]:bg-[var(--menu-active)] data-[selected=true]:text-ink"
                    >
                      <span className="flex w-5 shrink-0 items-center justify-center text-ink-muted">{item.leading}</span>
                      <span className="min-w-0 flex-1 truncate">
                        <span className="text-ink">{item.title}</span>
                        {item.subtitle && <span className="ml-2 text-ink-muted">{item.subtitle}</span>}
                      </span>
                      {item.trailing != null && (
                        <span className="flex shrink-0 items-center gap-1 text-[12px] text-ink-muted">{item.trailing}</span>
                      )}
                    </Command.Item>
                  ))}
                </Command.Group>
              ))
            )}
          </Command.List>

          <footer className="flex items-center gap-4 border-t border-hairline bg-paper-deep/40 px-4 py-2 text-[11px] text-ink-muted">
            <span className="flex items-center gap-1.5">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              move
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>Enter</Kbd>
              open
            </span>
            <span className="ml-auto flex items-center gap-1.5">
              <Kbd>Ctrl K</Kbd>
              close
            </span>
          </footer>
        </Command>
      </div>
    </div>
  );
}
