import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Kbd } from "~/ui/kbd";
import { normalizeText } from "~/ui/text";

/**
 * Every keyboard shortcut the app has, searchable, on `?`.
 *
 * ONLY WHAT EXISTS. A shortcut listed here that does nothing teaches a reader
 * to stop trusting the list; one that works and is not listed might as well not
 * exist. Keep this in step with the handlers in app.tsx, data-table.tsx,
 * use-peek.ts and command-palette.tsx.
 *
 * Windows labels (Ctrl, Alt): the app is Windows first, and Linear's advice is
 * right that a shortcut should be written the way the reader's keyboard is.
 */

type Shortcut = { label: string; keys: string[][] };

const GROUPS: Array<{ title: string; items: Shortcut[] }> = [
  {
    title: "General",
    items: [
      { label: "Search everything", keys: [["Ctrl", "K"]] },
      { label: "Filter this table", keys: [["Ctrl", "F"], ["/"]] },
      { label: "Keyboard shortcuts", keys: [["?"]] },
      { label: "Show or hide the sidebar", keys: [["Ctrl", "\\"]] },
    ],
  },
  {
    title: "Tabs",
    items: [
      { label: "New tab", keys: [["Ctrl", "T"]] },
      { label: "Close tab", keys: [["Ctrl", "W"]] },
      { label: "Reopen closed tab", keys: [["Ctrl", "Shift", "T"]] },
      { label: "Next tab", keys: [["Ctrl", "Tab"]] },
      { label: "Previous tab", keys: [["Ctrl", "Shift", "Tab"]] },
      { label: "Go to tab 1 to 8", keys: [["Ctrl", "1–8"]] },
      { label: "Go to last tab", keys: [["Ctrl", "9"]] },
      { label: "Back", keys: [["Alt", "←"]] },
      { label: "Forward", keys: [["Alt", "→"]] },
      { label: "Open in a new tab", keys: [["Ctrl", "Click"], ["Middle click"]] },
    ],
  },
  {
    title: "Seasons",
    items: [
      { label: "Older season", keys: [["["]] },
      { label: "Newer season", keys: [["]"]] },
    ],
  },
  {
    title: "Matchup Predictor",
    items: [
      { label: "Change the left team", keys: [["A"]] },
      { label: "Change the right team", keys: [["B"]] },
      { label: "Swap the teams", keys: [["S"]] },
      { label: "Move the game to the next floor", keys: [["F"]] },
      { label: "Draw a new matchup", keys: [["R"]] },
    ],
  },
  {
    title: "Tables",
    items: [
      { label: "Move up and down", keys: [["↑"], ["↓"], ["J"], ["K"]] },
      { label: "Page up and down", keys: [["PgUp"], ["PgDn"]] },
      { label: "First and last row", keys: [["Home"], ["End"]] },
      { label: "Peek at the row (hold to glance, tap to pin)", keys: [["Space"]] },
      { label: "Close Peek", keys: [["Esc"]] },
      { label: "Add the row to the compare tray", keys: [["C"]] },
      { label: "Add a row by dragging it to the tray", keys: [["Drag"]] },
      { label: "Sort by a column", keys: [["Click header"]] },
    ],
  },
  {
    title: "Search",
    items: [
      { label: "Open the highlighted result", keys: [["Enter"]] },
      { label: "Open it in a new tab", keys: [["Ctrl", "Enter"]] },
      { label: "Clear, then close", keys: [["Esc"]] },
    ],
  },
];

export function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const words = normalizeText(query).split(" ").filter(Boolean);
    if (words.length === 0) return GROUPS;
    return GROUPS.map((g) => ({
      ...g,
      items: g.items.filter((s) => {
        const hay = normalizeText(`${g.title} ${s.label} ${s.keys.flat().join(" ")}`);
        return words.every((w) => hay.includes(w));
      }),
    })).filter((g) => g.items.length > 0);
  }, [query]);

  return (
    <div
      className="fixed inset-0 z-50"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          if (query) setQuery("");
          else onClose();
        }
      }}
    >
      <div aria-hidden className="palette-scrim absolute inset-0" onMouseDown={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="palette-in relative mx-auto mt-[9vh] flex max-h-[80vh] w-[min(620px,calc(100vw-48px))] flex-col overflow-hidden rounded-xl border border-hairline bg-card"
        style={{ boxShadow: "var(--overlay-shadow)" }}
      >
        <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-hairline px-4">
          <Search size={16} strokeWidth={2} className="shrink-0 text-ink-muted" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search shortcuts"
            aria-label="Search shortcuts"
            spellCheck={false}
            className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-muted"
          />
          <Kbd>Esc</Kbd>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3 pt-1">
          {groups.length === 0 ? (
            <p className="px-3 py-9 text-center text-[13px] text-ink-muted">No shortcut matches &ldquo;{query.trim()}&rdquo;.</p>
          ) : (
            groups.map((g) => (
              <section key={g.title} className="mt-2">
                <h3 className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium text-ink-muted">{g.title}</h3>
                <ul>
                  {g.items.map((s) => (
                    <li key={s.label} className="flex h-[34px] items-center justify-between gap-4 rounded-md px-2.5 text-[13px] text-ink-soft">
                      <span className="truncate">{s.label}</span>
                      <span className="flex shrink-0 items-center gap-2 text-[11px] text-ink-muted">
                        {s.keys.map((combo, i) => (
                          <span key={combo.join("+")} className="flex items-center gap-1">
                            {i > 0 && <span className="pr-1">or</span>}
                            {combo.map((k) => (
                              <Kbd key={k}>{k}</Kbd>
                            ))}
                          </span>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
