"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  FILTER_COLUMNS,
  GROUP_LABEL,
  type Comparator,
  type StatFilter,
  type TeamFilterSpec,
  type TeamStatKey,
  parseSpec,
  specToParams,
} from "@/lib/team-filters";
import { cn } from "@/lib/utils";
import { SearchableSelect, type SearchableOption } from "./searchable-select";
import { MultiYearSelect } from "./multi-year-select";
import { Select } from "@/components/select";

const OPS: { value: Comparator; label: string }[] = [
  { value: "gt", label: ">" },
  { value: "gte", label: "≥" },
  { value: "lt", label: "<" },
  { value: "lte", label: "≤" },
];

// Build the option list for the stat picker once. Order matters — groups
// render in the order they first appear.
const STAT_OPTIONS: SearchableOption[] = FILTER_COLUMNS.map((c) => ({
  value: c.key,
  label: c.label,
  group: c.group,
  desc: c.desc,
}));

// Defaults applied by the Reset button (matches the empty-URL spec).
const DEFAULT_DRAFT: Pick<TeamFilterSpec, "years" | "conf" | "filters"> = {
  years: parseSpec({}).years,
  conf: null,
  filters: [],
};

export function FilterBar({ conferences }: { conferences: string[] }) {
  const router = useRouter();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();

  const params = useMemo(() => {
    const obj: Record<string, string> = {};
    for (const [k, v] of search.entries()) obj[k] = v;
    return obj;
  }, [search]);
  const urlSpec: TeamFilterSpec = parseSpec(params);

  // Working draft — edits happen here without re-running the explorer query.
  // We only push to the URL (and trigger a re-process) when Submit is clicked.
  const [draft, setDraft] = useState({
    years: urlSpec.years,
    conf: urlSpec.conf,
    filters: urlSpec.filters,
  });

  // Re-sync draft when the URL changes from outside (browser nav, sort click
  // doesn't affect these fields but the dep is safe). Cheap because state
  // updates are reference-compared at the consumer level.
  useEffect(() => {
    setDraft({ years: urlSpec.years, conf: urlSpec.conf, filters: urlSpec.filters });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function patch(next: Partial<typeof draft>) {
    setDraft((d) => ({ ...d, ...next }));
  }
  function patchFilter(i: number, p: Partial<StatFilter>) {
    setDraft((d) => ({
      ...d,
      filters: d.filters.map((f, j) => (j === i ? { ...f, ...p } : f)),
    }));
  }
  function addFilter() {
    setDraft((d) => ({
      ...d,
      filters: [...d.filters, { stat: "bta_rtg", op: "gt", value: 0 }],
    }));
  }
  function removeFilter(i: number) {
    setDraft((d) => ({ ...d, filters: d.filters.filter((_, j) => j !== i) }));
  }

  function submit() {
    // Preserve sort/limit from the URL; only overwrite the draft-controlled fields.
    const next: TeamFilterSpec = { ...urlSpec, years: draft.years, conf: draft.conf, filters: draft.filters };
    const p = specToParams(next).toString();
    startTransition(() => router.replace(p ? `/?${p}` : "/", { scroll: false }));
  }
  function reset() {
    setDraft(DEFAULT_DRAFT);
    startTransition(() => router.replace("/", { scroll: false }));
  }

  const dirty = !sameDraft(draft, { years: urlSpec.years, conf: urlSpec.conf, filters: urlSpec.filters });

  return (
    <div className={cn("bg-card border border-hairline rounded-lg", pending && "opacity-70")}>
      {/* Top row — primary scope */}
      <div className="flex flex-wrap items-end gap-3 p-4 lg:p-5 border-b border-hairline">
        <Field label="Seasons">
          <MultiYearSelect
            years={draft.years}
            onChange={(years) => patch({ years })}
          />
        </Field>

        <Field label="Conference">
          <Select
            value={draft.conf ?? ""}
            onChange={(v) => patch({ conf: v || null })}
          >
            <option value="">All conferences</option>
            {conferences.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </Field>
      </div>

      {/* Stat filter rows */}
      <div className="p-4 lg:p-5 space-y-2">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs uppercase tracking-widest text-ink-muted font-medium">
            Filters
          </span>
          <span className="text-xs text-ink-muted">
            (all conditions must be true; nothing applies until you press Submit)
          </span>
        </div>

        {draft.filters.map((f, i) => (
          <div key={i} className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-ink-muted w-10">
              {i === 0 ? "Where" : "And"}
            </span>
            <SearchableSelect
              value={f.stat}
              options={STAT_OPTIONS}
              groupLabels={GROUP_LABEL}
              onChange={(v) => patchFilter(i, { stat: v as TeamStatKey })}
              ariaLabel="Filter stat"
              className="min-w-44"
            />
            <Select
              value={f.op}
              onChange={(v) => patchFilter(i, { op: v as Comparator })}
              className="w-20"
            >
              {OPS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
            <input
              type="number"
              step="any"
              value={f.value}
              onChange={(e) => patchFilter(i, { value: Number(e.target.value) })}
              className="h-9 w-28 px-2 rounded border border-hairline bg-white text-ink text-sm focus:outline-none focus:ring-2 focus:ring-coral/40"
            />
            <button
              type="button"
              onClick={() => removeFilter(i)}
              className="text-sm text-ink-muted hover:text-coral px-2 py-1"
              aria-label="Remove filter"
            >
              ×
            </button>
          </div>
        ))}

        <div className="flex items-center gap-3 pt-3 border-t border-hairline mt-3">
          <button
            type="button"
            onClick={addFilter}
            className="text-sm font-medium text-coral hover:text-ink"
          >
            + Add filter
          </button>
          {dirty && (
            <span className="text-xs text-ink-muted">unsaved changes</span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={reset}
              className="text-sm text-ink-muted hover:text-ink px-3 py-2"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!dirty}
              className="text-sm font-medium bg-coral text-white px-5 py-2 rounded hover:bg-coral-soft disabled:opacity-40 transition-colors"
            >
              Submit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function sameDraft(
  a: { years: number[]; conf: string | null; filters: StatFilter[] },
  b: { years: number[]; conf: string | null; filters: StatFilter[] },
): boolean {
  if (a.conf !== b.conf) return false;
  if (a.years.length !== b.years.length) return false;
  for (let i = 0; i < a.years.length; i++) if (a.years[i] !== b.years[i]) return false;
  if (a.filters.length !== b.filters.length) return false;
  for (let i = 0; i < a.filters.length; i++) {
    const x = a.filters[i]!, y = b.filters[i]!;
    if (x.stat !== y.stat || x.op !== y.op || x.value !== y.value) return false;
  }
  return true;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-widest text-ink-muted font-medium">
        {label}
      </span>
      {children}
    </label>
  );
}
