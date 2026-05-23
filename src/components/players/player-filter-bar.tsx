"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { Select } from "@/components/select";
import { confDisplay } from "@/lib/conf-display";
import { POWER_CONFS } from "@/lib/conf-tiers";
import { MultiYearSelect } from "@/components/explorer/multi-year-select";
import { SearchableMultiSelect } from "@/components/explorer/searchable-multi-select";
import { SearchableSelect, type SearchableOption } from "@/components/explorer/searchable-select";
import {
  DEFAULT_PLAYER_SPEC,
  PLAYER_STAT_COLUMNS,
  PLAYER_STAT_GROUP_LABEL,
  parsePlayerSpec,
  playerSpecToParams,
  type PlayerComparator,
  type PlayerListSpec,
  type PlayerStatFilter,
} from "@/lib/players";

const CLASS_OPTIONS: SearchableOption[] = [
  { value: "Fr", label: "Freshman" },
  { value: "So", label: "Sophomore" },
  { value: "Jr", label: "Junior" },
  { value: "Sr", label: "Senior" },
  { value: "Gr", label: "Graduate" },
];

const POSITION_OPTIONS: SearchableOption[] = [
  { value: "G", label: "G (Guard)" },
  { value: "F", label: "F (Forward)" },
  { value: "C", label: "C (Center)" },
];

const CONF_GROUP_LABELS = { power: "Power Conferences", midmajor: "Mid-Majors" } as const;

const OPS: { value: PlayerComparator; label: string }[] = [
  { value: "gt",  label: ">" },
  { value: "gte", label: "≥" },
  { value: "lt",  label: "<" },
  { value: "lte", label: "≤" },
];

// Build the stat-picker option list once. Groups render in the order they
// first appear, so the PLAYER_STAT_COLUMNS source order is what the user
// sees in the dropdown.
const STAT_OPTIONS: SearchableOption[] = PLAYER_STAT_COLUMNS.map((c) => ({
  value: c.key,
  label: c.label,
  group: c.group,
  desc: c.desc,
}));

type Draft = {
  years: number[];
  conf: string[];
  teams: string[];
  cls: string[];
  pos: ("G" | "F" | "C")[];
  filters: PlayerStatFilter[];
};

function sameDraft(a: Draft, b: Draft): boolean {
  if (a.years.length !== b.years.length || a.years.some((y, i) => y !== b.years[i])) return false;
  if (a.conf.length !== b.conf.length  || a.conf.some((c, i) => c !== b.conf[i])) return false;
  if (a.teams.length !== b.teams.length || a.teams.some((t, i) => t !== b.teams[i])) return false;
  if (a.cls.length !== b.cls.length   || a.cls.some((c, i) => c !== b.cls[i])) return false;
  if (a.pos.length !== b.pos.length   || a.pos.some((c, i) => c !== b.pos[i])) return false;
  if (a.filters.length !== b.filters.length) return false;
  for (let i = 0; i < a.filters.length; i++) {
    const fa = a.filters[i]!, fb = b.filters[i]!;
    if (fa.stat !== fb.stat || fa.op !== fb.op || fa.value !== fb.value) return false;
  }
  return true;
}

export function PlayerFilterBar({
  conferences,
  teams,
}: {
  conferences: string[];
  teams: string[];
}) {
  const router = useRouter();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();

  const params = useMemo(() => {
    const obj: Record<string, string> = {};
    for (const [k, v] of search.entries()) obj[k] = v;
    return obj;
  }, [search]);
  const urlSpec: PlayerListSpec = parsePlayerSpec(params);

  // Working draft — edits happen here without re-running the leaderboard.
  // Only Submit pushes to the URL (mirrors /teams explorer pattern).
  const [draft, setDraft] = useState<Draft>({
    years: urlSpec.years,
    conf: urlSpec.conf,
    teams: urlSpec.teams,
    cls: urlSpec.cls,
    pos: urlSpec.pos,
    filters: urlSpec.filters,
  });

  // Re-sync draft when the URL changes from outside (browser nav, etc.).
  useEffect(() => {
    setDraft({
      years: urlSpec.years,
      conf: urlSpec.conf,
      teams: urlSpec.teams,
      cls: urlSpec.cls,
      pos: urlSpec.pos,
      filters: urlSpec.filters,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function patch(next: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...next }));
  }
  function patchFilter(i: number, p: Partial<PlayerStatFilter>) {
    setDraft((d) => ({
      ...d,
      filters: d.filters.map((f, j) => (j === i ? { ...f, ...p } : f)),
    }));
  }
  function addFilter() {
    setDraft((d) => ({
      ...d,
      // Default new filter targets BTA PRTG since it's the headline stat.
      filters: [...d.filters, { stat: "bta_prtg", op: "gt", value: 0 }],
    }));
  }
  function removeFilter(i: number) {
    setDraft((d) => ({ ...d, filters: d.filters.filter((_, j) => j !== i) }));
  }

  function submit() {
    // Preserve sort/limit/minGames from the URL; only overwrite the
    // draft-controlled fields.
    const next: PlayerListSpec = {
      ...urlSpec,
      years: draft.years,
      conf: draft.conf,
      teams: draft.teams,
      cls: draft.cls,
      pos: draft.pos,
      filters: draft.filters,
    };
    const p = playerSpecToParams(next).toString();
    startTransition(() =>
      router.replace(p ? `/players?${p}` : "/players", { scroll: false }),
    );
    // On mobile, jump to the leaderboard so the filtered rows are visible
    // without scrolling past the filter card.
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      requestAnimationFrame(() => {
        document.getElementById("players-leaderboard")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }
  function reset() {
    setDraft({
      years: DEFAULT_PLAYER_SPEC.years,
      conf: [],
      teams: [],
      cls: [],
      pos: [],
      filters: [],
    });
    startTransition(() => router.replace("/players", { scroll: false }));
  }

  const dirty = !sameDraft(draft, {
    years: urlSpec.years,
    conf: urlSpec.conf,
    teams: urlSpec.teams,
    cls: urlSpec.cls,
    pos: urlSpec.pos,
    filters: urlSpec.filters,
  });

  const teamOptions = useMemo<SearchableOption[]>(
    () => teams.map((t) => ({ value: t, label: t })),
    [teams],
  );
  const confOptions = useMemo<SearchableOption[]>(() => {
    const opts = conferences.map((c) => ({
      value: c,
      label: confDisplay(c),
      group: POWER_CONFS.has(c) ? "power" : "midmajor",
    }));
    return opts.sort((a, b) => {
      if (a.group !== b.group) return a.group === "power" ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
  }, [conferences]);

  return (
    <div className={cn("bg-paper-deep/25 border border-hairline rounded-xl shadow-sm", pending && "opacity-70")}>
      {/* Top row — primary scope. No Min Games dropdown (per request); use
          the GP filter in the Filters section below if you need that. */}
      <div className="flex flex-wrap items-end gap-3 p-4 lg:p-5 border-b border-hairline">
        <Field label="Seasons">
          <MultiYearSelect
            years={draft.years}
            onChange={(years) => patch({ years })}
          />
        </Field>
        <Field label="Team">
          <SearchableMultiSelect
            value={draft.teams}
            options={teamOptions}
            onChange={(t) => patch({ teams: t })}
            placeholder="Type to filter…"
            emptyLabel="All teams"
            ariaLabel="Teams"
          />
        </Field>
        <Field label="Conference">
          <SearchableMultiSelect
            value={draft.conf}
            options={confOptions}
            onChange={(c) => patch({ conf: c })}
            placeholder="Type to filter…"
            emptyLabel="All conferences"
            ariaLabel="Conferences"
            groupLabels={CONF_GROUP_LABELS}
          />
        </Field>
        <Field label="Class">
          <SearchableMultiSelect
            value={draft.cls}
            options={CLASS_OPTIONS}
            onChange={(c) => patch({ cls: c })}
            placeholder="Type to filter…"
            emptyLabel="All classes"
            ariaLabel="Classes"
          />
        </Field>
        <Field label="Position">
          <SearchableMultiSelect
            value={draft.pos}
            options={POSITION_OPTIONS}
            onChange={(p) => patch({ pos: p as ("G" | "F" | "C")[] })}
            placeholder="Type to filter…"
            emptyLabel="All positions"
            ariaLabel="Positions"
          />
        </Field>
      </div>

      {/* Stat filter rows */}
      <div className="p-4 lg:p-5 space-y-2">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs uppercase tracking-widest text-ink-muted font-medium">
            Filters
          </span>
          <span className="text-xs text-ink-muted">
            (nothing applies until you press Submit)
          </span>
        </div>

        {draft.filters.map((f, i) => (
          <div key={i} className="flex items-center gap-2 sm:gap-4 flex-nowrap">
            <span className="hidden sm:inline text-sm text-ink-muted w-10 shrink-0">
              {i === 0 ? "Where" : "And"}
            </span>
            <SearchableSelect
              value={f.stat}
              options={STAT_OPTIONS}
              groupLabels={PLAYER_STAT_GROUP_LABEL}
              onChange={(v) => patchFilter(i, { stat: v })}
              ariaLabel="Filter stat"
              className="flex-1 min-w-0 sm:flex-initial sm:min-w-44"
            />
            <Select
              value={f.op}
              onChange={(v) => patchFilter(i, { op: v as PlayerComparator })}
              className="w-14 sm:w-16 shrink-0"
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
              className="h-10 w-16 sm:w-28 px-2 rounded-md border border-ink/15 bg-card text-ink text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-coral/40 focus:border-coral/40 shrink-0"
            />
            <button
              type="button"
              onClick={() => removeFilter(i)}
              className="text-base text-ink-muted hover:text-coral px-1.5 shrink-0"
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
            disabled={draft.filters.length >= 8}
            className="text-sm font-medium text-coral hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed"
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-widest text-ink-muted font-medium">{label}</span>
      {children}
    </label>
  );
}
