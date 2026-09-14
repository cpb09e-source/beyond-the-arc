import { POWER_CONFS } from "@/lib/conf-tiers";
import { ChevronDown } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { scopeValues, withScope } from "~/ui/filter-query";
import { Popover } from "~/ui/popover";
import type { Scope } from "~/ui/scoped-query";
import { SearchList, type ListItem } from "~/ui/search-list";
import { normalizeText } from "~/ui/text";

export type ScopeOption = { name: string; group?: string; meta?: string; keywords?: string };

/** Every conference in these rows, power conferences first, sectioned as the site's pickers are. */
export function conferenceOptions(rows: Iterable<{ conf: string; confLabel: string }>): ScopeOption[] {
  const seen = new Map<string, ScopeOption>();
  for (const r of rows) {
    if (!r.confLabel || seen.has(r.confLabel)) continue;
    seen.set(r.confLabel, { name: r.confLabel, group: POWER_CONFS.has(r.conf) ? "Power conferences" : "Mid-majors", keywords: r.conf });
  }
  return [...seen.values()].sort((a, b) => (a.group === b.group ? a.name.localeCompare(b.name) : a.group === "Power conferences" ? -1 : 1));
}

/** Names as picker options, each once, alphabetically. */
export const nameOptions = (names: Iterable<string>): ScopeOption[] =>
  [...new Set(names)].filter(Boolean).sort((a, b) => a.localeCompare(b)).map((name) => ({ name }));

/**
 * The site's Team, Conference, Class and Position pickers, written as words.
 *
 * Picking Duke and Houston writes "teams: Duke, Houston" into the filter box;
 * typing that into the box ticks them here. Several names at once, as the
 * site's multi-selects take them, and "All" when none are picked.
 */
export function ScopeSelect({
  label,
  scopes,
  options,
  query,
  setQuery,
  write,
  width = 300,
}: {
  label: string;
  /** Every scope this picker owns: a team picker owns both team: and teams:. */
  scopes: readonly Scope[];
  options: ScopeOption[];
  query: string;
  setQuery: (q: string) => void;
  /** The clause for the names picked: one team as "team: Duke", several as "teams: Duke, Houston". */
  write: (names: string[]) => string;
  width?: number;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const chosen = useMemo(() => {
    const canonical = new Map(options.map((o) => [normalizeText(o.name), o.name]));
    return scopeValues(query, scopes).map((v) => canonical.get(normalizeText(v)) ?? v);
  }, [query, scopes, options]);
  const items: ListItem[] = useMemo(
    () => options.map((o) => ({ key: o.name, label: o.name, group: o.group, meta: o.meta, keywords: o.keywords })),
    [options],
  );
  const set = (names: string[]) => setQuery(withScope(query, scopes, names.length > 0 ? write(names) : null));
  const shown = chosen.length === 0 ? "All" : chosen.length === 1 ? chosen[0] : `${chosen.length} selected`;

  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-expanded={open}
        aria-label={`${label}: ${shown}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex h-[24px] max-w-[230px] items-center gap-1 rounded-md border px-2 text-[12px] transition-colors ${
          chosen.length > 0
            ? "border-[color-mix(in_oklab,var(--accent)_45%,var(--hairline))] bg-[var(--accent-wash)] text-ink"
            : "border-hairline bg-card text-ink-soft hover:border-ink-muted hover:text-ink"
        }`}
      >
        <span className="shrink-0 text-ink-muted">{label}</span>
        <span className="truncate font-medium">{shown}</span>
        <ChevronDown size={12} strokeWidth={2} className="shrink-0 text-ink-muted" />
      </button>
      {open && (
        <Popover anchor={anchor} onClose={() => setOpen(false)} width={width} label={label}>
          <SearchList
            items={items}
            label={label}
            placeholder={`Search ${label.toLowerCase()}`}
            multi
            selected={new Set(chosen)}
            onPick={(name) => set(chosen.includes(name) ? chosen.filter((n) => n !== name) : [...chosen, name])}
            onClose={() => setOpen(false)}
            footer={
              chosen.length > 0 ? (
                <div className="flex shrink-0 items-center justify-between border-t border-hairline px-3 py-2 text-[12px] text-ink-muted">
                  <span className="tabular">{chosen.length} picked</span>
                  <button type="button" onClick={() => set([])} className="transition-colors hover:text-ink">
                    Clear
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
