"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useTransition } from "react";
import {
  FILTER_COLUMNS,
  GROUP_LABEL,
  LIMIT_OPTIONS,
  type TeamFilterSpec,
  type TeamStatKey,
  limitLabel,
  parseSpec,
  specToParams,
} from "@/lib/team-filters";
import { cn } from "@/lib/utils";
import { SearchableSelect, type SearchableOption } from "./searchable-select";
import { Select } from "@/components/select";

const STAT_OPTIONS: SearchableOption[] = FILTER_COLUMNS.map((c) => ({
  value: c.key,
  label: c.label,
  group: c.group,
  desc: c.desc,
}));

/**
 * The Sort by / Order / Show triplet that sits above the results table.
 * URL-state driven — picks up the same spec the FilterBar writes to.
 */
export function SortControls() {
  const router = useRouter();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();

  const params = useMemo(() => {
    const obj: Record<string, string> = {};
    for (const [k, v] of search.entries()) obj[k] = v;
    return obj;
  }, [search]);
  const spec: TeamFilterSpec = parseSpec(params);

  function update(next: TeamFilterSpec) {
    const p = specToParams(next).toString();
    startTransition(() => {
      router.replace(p ? `/?${p}` : "/", { scroll: false });
    });
  }

  return (
    <div
      className={cn(
        // Mobile: Sort By takes the remaining width; Order + Show are
        // tight because "Desc" / "500" are short and don't need a wide
        // box. Desktop (sm+): natural flex layout with custom widths.
        "flex items-end gap-3 w-full sm:w-auto",
        pending && "opacity-70",
      )}
    >
      <Field label="Sort by" className="flex-1 min-w-0 sm:flex-initial">
        <SearchableSelect
          value={spec.sortBy}
          options={STAT_OPTIONS}
          groupLabels={GROUP_LABEL}
          onChange={(v) => update({ ...spec, sortBy: v as TeamStatKey })}
          ariaLabel="Sort by"
          className="w-full sm:w-auto sm:min-w-24"
        />
      </Field>
      <Field label="Order" className="shrink-0">
        <Select
          value={spec.sortDir}
          onChange={(v) => update({ ...spec, sortDir: v as "asc" | "desc" })}
          className="w-20"
        >
          <option value="desc">Desc</option>
          <option value="asc">Asc</option>
        </Select>
      </Field>
      <Field label="Show" className="shrink-0">
        <Select
          value={String(spec.limit)}
          onChange={(v) => update({ ...spec, limit: Number(v) })}
          className="w-16 sm:w-20"
        >
          {LIMIT_OPTIONS.map((n) => (
            <option key={n} value={n}>{limitLabel(n)}</option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1", className)}>
      <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">{label}</span>
      {children}
    </label>
  );
}
