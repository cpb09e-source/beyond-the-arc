import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  appendToQuery,
  conditionText,
  parseFilter,
  pinnedStatKeys,
  spliceQuery,
  type FilterHelp,
  type FilterStat,
  type Op,
  type StatClause,
} from "~/ui/filter-query";
import { StatPicker, type PickStat } from "./stat-picker";

/**
 * The site's filter rows, as a second way of writing the filter box.
 *
 *   [ eFG% | ≥ | 55 % | × ]  [ NET | > | 20 | × ]  + Add a filter  + Add columns
 *
 * ONE STATE, TWO EDITORS. Every row is a condition in the box ("efg>=55"), so
 * typing in a row rewrites those words and typing the words redraws the row;
 * favorites, history and Esc keep working on both at once. A row with no
 * number is a column the reader added, kept with the tab's layout rather than
 * in the words, which is how the site's blank row pins a stat.
 *
 * THE SITE'S RULES: a stat filtered on becomes one of "Your columns"; removing
 * its last row takes the column away; two rows on one stat make a range.
 */

const OPS: Op[] = [">=", ">", "<=", "<", "="];
const OP_LABEL: Record<Op, string> = { ">=": "≥", ">": ">", "<=": "≤", "<": "<", "=": "=" };
const MINUS = "−";

type Row = { id: string; key: string; stat: FilterStat<never>; clause: StatClause | null };

/** The row of controls under a table's header: its scope pickers, then its filter rows. */
export function TableBar({ children }: { children: ReactNode }) {
  return (
    <div role="toolbar" aria-label="Table filters" className="flex shrink-0 flex-wrap items-center gap-1.5 px-5 pb-2.5">
      {children}
    </div>
  );
}

/** What a stat's values usually run between this season, as the site's placeholder says it. */
function typicalRange(help: FilterHelp, s: FilterStat<never>): string {
  const v = help.values(s.name);
  if (v.length < 2) return "Value";
  const lo = v[Math.round((v.length - 1) * 0.01)]!;
  const hi = v[Math.round((v.length - 1) * 0.99)]!;
  const f = (x: number) => `${x < 0 ? MINUS : ""}${Math.abs(x).toFixed(s.digits)}`;
  return lo < 0 ? `${f(lo)} to ${f(hi)}` : `${f(lo)}–${f(hi)}`;
}

export function FilterRows({
  help,
  stats,
  query,
  setQuery,
  cols,
  setCols,
}: {
  help: FilterHelp;
  /** Every stat the pickers offer, with its section. */
  stats: PickStat[];
  query: string;
  setQuery: (q: string) => void;
  cols: readonly string[];
  setCols: (cols: string[]) => void;
}) {
  // What a box holds while it is being typed in: "-" and "55." are on the way to a number, not yet one.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // The comparison chosen on a row that has no number yet.
  const [ops, setOps] = useState<Record<string, Op>>({});
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const pendingFocus = useRef<string | null>(null);

  const pinned = useMemo(() => pinnedStatKeys(query, cols, help), [query, cols, help]);
  const rows = useMemo(() => {
    const byKey = new Map<string, StatClause[]>();
    for (const c of parseFilter(query).clauses) {
      if (c.kind !== "stat") continue;
      const key = help.find(c.name)?.key;
      if (key) byKey.set(key, [...(byKey.get(key) ?? []), c]);
    }
    const out: Row[] = [];
    for (const key of pinned) {
      const stat = help.byKey(key);
      if (!stat) continue;
      const list = byKey.get(key) ?? [];
      if (list.length === 0) out.push({ id: `${key}:0`, key, stat, clause: null });
      else list.forEach((clause, n) => out.push({ id: `${key}:${n}`, key, stat, clause }));
    }
    return out;
  }, [query, pinned, help]);

  // A row just added takes the caret once it exists.
  useEffect(() => {
    const id = pendingFocus.current;
    const el = id ? inputs.current.get(id) : undefined;
    if (!el) return;
    pendingFocus.current = null;
    el.focus();
  }, [rows]);

  const opOf = (row: Row): Op => row.clause?.op ?? ops[row.key] ?? ">=";
  const valueOf = (row: Row): string => drafts[row.id] ?? (row.clause?.value == null ? "" : String(row.clause.value));

  const write = (row: Row, op: Op, value: string) => {
    if (row.clause) setQuery(spliceQuery(query, row.clause.start, row.clause.end, conditionText(row.stat.name, op, value)));
    else if (value.trim()) setQuery(appendToQuery(query, conditionText(row.stat.name, op, value)));
  };

  const remove = (row: Row) => {
    const others = rows.some((r) => r.key === row.key && r.id !== row.id && r.clause);
    if (row.clause) setQuery(spliceQuery(query, row.clause.start, row.clause.end, ""));
    if (!others && cols.includes(row.key)) setCols(cols.filter((k) => k !== row.key));
  };

  const addFilter = (key: string) => {
    const stat = help.byKey(key);
    if (!stat) return;
    const have = rows.filter((r) => r.key === key);
    if (have.length === 0) {
      pendingFocus.current = `${key}:0`;
      setCols([...cols, key]);
    } else if (have.length === 1 && !have[0]!.clause) {
      inputs.current.get(have[0]!.id)?.focus();
    } else {
      // A second row on the same stat: a range, as two rows are on the site.
      pendingFocus.current = `${key}:${have.length}`;
      setQuery(appendToQuery(query, conditionText(stat.name, ">=", "")));
      if (!cols.includes(key)) setCols([...cols, key]);
    }
  };

  const setColumns = (next: string[]) => {
    const dropped = new Set(pinned.filter((k) => !next.includes(k)));
    let q = query;
    const { clauses } = parseFilter(query);
    for (let i = clauses.length - 1; i >= 0; i--) {
      const c = clauses[i]!;
      if (c.kind !== "stat") continue;
      const key = help.find(c.name)?.key;
      if (key && dropped.has(key)) q = spliceQuery(q, c.start, c.end, "");
    }
    setCols(next);
    if (q !== query) setQuery(q);
  };

  const clearAll = () => {
    let q = query;
    const { clauses } = parseFilter(query);
    for (let i = clauses.length - 1; i >= 0; i--) {
      const c = clauses[i]!;
      if (c.kind === "stat" && help.find(c.name)) q = spliceQuery(q, c.start, c.end, "");
    }
    setCols([]);
    if (q !== query) setQuery(q);
  };

  return (
    <>
      {rows.map((row) => (
        <div
          key={row.id}
          className="flex h-[24px] items-stretch overflow-hidden rounded-md border border-hairline bg-card text-[12px] transition-colors focus-within:border-accent"
        >
          <span title={row.stat.desc} className="flex max-w-[150px] items-center border-r border-hairline bg-paper-deep/40 px-2 font-medium text-ink">
            <span className="truncate">{row.stat.label}</span>
          </span>
          <button
            type="button"
            title="Change the comparison"
            aria-label={`${row.stat.label}: ${OP_LABEL[opOf(row)]}. Change the comparison`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const next = OPS[(OPS.indexOf(opOf(row)) + 1) % OPS.length]!;
              if (row.clause) write(row, next, valueOf(row));
              else setOps((o) => ({ ...o, [row.key]: next }));
            }}
            className="w-[22px] border-r border-hairline text-ink-soft transition-colors hover:bg-[var(--menu-active)] hover:text-ink"
          >
            {OP_LABEL[opOf(row)]}
          </button>
          <input
            ref={(el) => {
              if (el) inputs.current.set(row.id, el);
              else inputs.current.delete(row.id);
            }}
            value={valueOf(row)}
            onChange={(e) => {
              const v = e.target.value.replace(/[^\d.+\-−]/g, "");
              setDrafts((d) => ({ ...d, [row.id]: v }));
              write(row, opOf(row), v);
            }}
            onBlur={() => {
              setDrafts(({ [row.id]: _gone, ...rest }) => rest);
              // A condition left without a number becomes the column it names, as a blank row is on the site.
              if (row.clause && row.clause.value == null) {
                setQuery(spliceQuery(query, row.clause.start, row.clause.end, ""));
                if (!cols.includes(row.key)) setCols([...cols, row.key]);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                e.currentTarget.blur();
              }
            }}
            placeholder={typicalRange(help, row.stat)}
            title={`Typical range: ${typicalRange(help, row.stat)}${row.stat.pct ? "%" : ""}`}
            aria-label={`${row.stat.label} value`}
            inputMode="decimal"
            spellCheck={false}
            className="w-[84px] min-w-0 bg-transparent px-1.5 text-ink tabular outline-none placeholder:text-ink-muted"
          />
          {row.stat.pct && <span className="flex items-center pr-1.5 text-ink-muted">%</span>}
          <button
            type="button"
            aria-label={`Remove ${row.stat.label}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => remove(row)}
            className="grid w-[22px] place-items-center border-l border-hairline text-ink-muted transition-colors hover:text-ink"
          >
            <X size={12} strokeWidth={2.25} />
          </button>
        </div>
      ))}
      <StatPicker mode="filter" stats={stats} pinned={pinned} onAdd={addFilter} />
      <StatPicker mode="columns" stats={stats} pinned={pinned} onColumns={setColumns} />
      {rows.length > 1 && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={clearAll}
          className="h-[24px] px-1.5 text-[12px] text-ink-muted transition-colors hover:text-ink"
        >
          Clear
        </button>
      )}
    </>
  );
}
