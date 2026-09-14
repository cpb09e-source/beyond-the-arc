import { Plus } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Popover } from "~/ui/popover";
import { SearchList, type ListItem } from "~/ui/search-list";

export type PickStat = { key: string; label: string; desc?: string; group?: string };

/**
 * The site's two stat pickers over one grouped, searchable list.
 *
 *   Add a filter   one stat, and the caret lands in its value
 *   Add columns    any number, ticked in the order they will stand
 *
 * COMMITTED AS THE SITE COMMITS THEM. Clicking away keeps the ticks, Done keeps
 * them, Esc throws them away. Unticking a stat takes its column out, and the
 * caller takes out every condition on it too.
 */
export function StatPicker({
  mode,
  stats,
  pinned,
  onAdd,
  onColumns,
}: {
  mode: "filter" | "columns";
  stats: PickStat[];
  /** The stats already standing as the reader's columns, ticked when the list opens. */
  pinned: readonly string[];
  onAdd?: (key: string) => void;
  onColumns?: (keys: string[]) => void;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [ticked, setTicked] = useState<string[]>([]);
  const items: ListItem[] = useMemo(
    () => stats.map((s) => ({ key: s.key, label: s.label, group: s.group, keywords: `${s.key} ${s.desc ?? ""}`, title: s.desc })),
    [stats],
  );
  const columns = mode === "columns";

  const commit = () => {
    if (columns) onColumns?.(ticked);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (open) return commit();
          setTicked([...pinned]);
          setOpen(true);
        }}
        className="inline-flex h-[24px] items-center gap-1 rounded-md border border-dashed border-hairline px-2 text-[12px] text-ink-soft transition-colors hover:border-ink-muted hover:text-ink"
      >
        <Plus size={12} strokeWidth={2.25} />
        {columns ? "Add columns" : "Add a filter"}
      </button>
      {open && (
        <Popover anchor={anchor} onClose={commit} width={340} label={columns ? "Add columns" : "Add a filter"}>
          <SearchList
            items={items}
            label={columns ? "Columns" : "Stats"}
            placeholder={columns ? "Search columns" : "Search stats"}
            multi={columns}
            selected={columns ? new Set(ticked) : undefined}
            onPick={(key) => {
              if (!columns) {
                setOpen(false);
                onAdd?.(key);
                return;
              }
              setTicked((t) => (t.includes(key) ? t.filter((k) => k !== key) : [...t, key]));
            }}
            // Esc: the ticks are thrown away.
            onClose={() => setOpen(false)}
            footer={
              columns ? (
                <div className="flex shrink-0 items-center justify-between gap-2 border-t border-hairline px-3 py-2 text-[12px] text-ink-muted">
                  <span className="tabular">
                    {ticked.length} {ticked.length === 1 ? "column" : "columns"}
                  </span>
                  <button
                    type="button"
                    onClick={commit}
                    className="h-[26px] rounded-md bg-accent px-2.5 text-[12px] font-medium text-white transition-[filter] hover:brightness-110"
                  >
                    Done
                  </button>
                </div>
              ) : undefined
            }
          />
        </Popover>
      )}
    </>
  );
}
