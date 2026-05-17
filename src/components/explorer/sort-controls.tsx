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
    <div className={cn("flex items-end gap-3", pending && "opacity-70")}>
      <Field label="Sort by">
        <SearchableSelect
          value={spec.sortBy}
          options={STAT_OPTIONS}
          groupLabels={GROUP_LABEL}
          onChange={(v) => update({ ...spec, sortBy: v as TeamStatKey })}
          ariaLabel="Sort by"
          className="min-w-36"
        />
      </Field>
      <Field label="Order">
        <Select value={spec.sortDir} onChange={(v) => update({ ...spec, sortDir: v as "asc" | "desc" })}>
          <option value="desc">Desc</option>
          <option value="asc">Asc</option>
        </Select>
      </Field>
      <Field label="Show">
        <Select value={String(spec.limit)} onChange={(v) => update({ ...spec, limit: Number(v) })}>
          {LIMIT_OPTIONS.map((n) => (
            <option key={n} value={n}>{limitLabel(n)}</option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">{label}</span>
      {children}
    </label>
  );
}
