"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { SlidersHorizontal } from "lucide-react";
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
  // Stat-filter popover (the "rest" of the categories) anchored to the Filters
  // button. Quick selects live inline in the bar.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!filtersOpen) return;
    function onDown(e: PointerEvent) {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setFiltersOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [filtersOpen]);

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
      // Default new filter targets EPM (the headline impact metric).
      filters: [...d.filters, { stat: "epm", op: "gt", value: 0 }],
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

  const statFilterCount = draft.filters.length;

  return (
    // Slim quick-filter bar — no card container. Filters button (stat builder
    // popover) + quick scope selects on the left, Reset/Submit on the right.
    <div className={cn("relative flex flex-wrap items-end gap-2 mb-3", pending && "opacity-70")}>
      {/* Filters button → stat-builder popover */}
      <div className="relative self-end" ref={popRef}>
        <button
          type="button"
          onClick={() => setFiltersOpen((o) => !o)}
          aria-expanded={filtersOpen}
          className={cn(
            "inline-flex items-center gap-1.5 h-9 px-3 rounded-md border text-sm font-medium shadow-sm transition-colors",
            filtersOpen || statFilterCount > 0
              ? "border-coral/50 bg-coral/6 text-coral"
              : "border-ink/15 bg-card text-ink hover:border-ink/25",
          )}
        >
          <SlidersHorizontal size={15} />
          Filters
          {statFilterCount > 0 && (
            <span className="ml-0.5 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-coral text-white text-[0.6rem] font-bold tabular">
              {statFilterCount}
            </span>
          )}
        </button>

        {filtersOpen && (
          <div className="absolute left-0 top-11 z-50 w-[min(92vw,34rem)] rounded-xl border border-hairline bg-card shadow-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs uppercase tracking-widest text-ink-muted font-semibold">Stat filters</span>
              <span className="text-xs text-ink-muted">(apply on Submit)</span>
            </div>
            <div className="space-y-2">
              {draft.filters.length === 0 && (
                <p className="text-sm text-ink-muted">No stat filters yet — add one below.</p>
              )}
              {draft.filters.map((f, i) => (
                <div key={i} className="flex items-center gap-2 flex-nowrap">
                  <span className="text-xs text-ink-muted w-9 shrink-0">{i === 0 ? "Where" : "And"}</span>
                  <SearchableSelect
                    value={f.stat}
                    options={STAT_OPTIONS}
                    groupLabels={PLAYER_STAT_GROUP_LABEL}
                    onChange={(v) => patchFilter(i, { stat: v })}
                    ariaLabel="Filter stat"
                    className="flex-1 min-w-0"
                  />
                  <Select
                    value={f.op}
                    onChange={(v) => patchFilter(i, { op: v as PlayerComparator })}
                    className="w-14 shrink-0"
                  >
                    {OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </Select>
                  <input
                    type="number"
                    step="any"
                    value={f.value}
                    onChange={(e) => patchFilter(i, { value: Number(e.target.value) })}
                    className="h-9 w-20 px-2 rounded-md border border-ink/15 bg-card text-ink text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-coral/40 focus:border-coral/40 shrink-0"
                  />
                  <button
                    type="button"
                    onClick={() => removeFilter(i)}
                    className="text-base text-ink-muted hover:text-coral px-1 shrink-0"
                    aria-label="Remove filter"
                  >×</button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3 pt-3 mt-3 border-t border-hairline">
              <button
                type="button"
                onClick={addFilter}
                disabled={draft.filters.length >= 8}
                className="text-sm font-medium text-coral hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed"
              >
                + Add filter
              </button>
              <button
                type="button"
                onClick={() => { submit(); setFiltersOpen(false); }}
                disabled={!dirty}
                className="ml-auto text-sm font-medium bg-coral text-white px-4 py-1.5 rounded hover:bg-coral-soft disabled:opacity-40 transition-colors"
              >
                Apply
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Quick scope selects — each labeled so a "3 selected" pill reads clearly */}
      <QuickField label="Seasons">
        <MultiYearSelect years={draft.years} onChange={(years) => patch({ years })} />
      </QuickField>
      <QuickField label="Team">
        <SearchableMultiSelect
          value={draft.teams} options={teamOptions} onChange={(t) => patch({ teams: t })}
          placeholder="Type to filter…" emptyLabel="All teams" ariaLabel="Teams"
        />
      </QuickField>
      <QuickField label="Conference">
        <SearchableMultiSelect
          value={draft.conf} options={confOptions} onChange={(c) => patch({ conf: c })}
          placeholder="Type to filter…" emptyLabel="All confs" ariaLabel="Conferences" groupLabels={CONF_GROUP_LABELS}
        />
      </QuickField>
      <QuickField label="Class">
        <SearchableMultiSelect
          value={draft.cls} options={CLASS_OPTIONS} onChange={(c) => patch({ cls: c })}
          placeholder="Type to filter…" emptyLabel="All classes" ariaLabel="Classes"
        />
      </QuickField>
      <QuickField label="Position">
        <SearchableMultiSelect
          value={draft.pos} options={POSITION_OPTIONS} onChange={(p) => patch({ pos: p as ("G" | "F" | "C")[] })}
          placeholder="Type to filter…" emptyLabel="All positions" ariaLabel="Positions"
        />
      </QuickField>

      {/* Reset / Submit */}
      <div className="ml-auto flex items-center gap-2">
        {dirty && <span className="hidden sm:inline text-xs text-ink-muted">unsaved</span>}
        <button type="button" onClick={reset} className="h-9 px-3 text-sm text-ink-muted hover:text-ink">Reset</button>
        <button
          type="button"
          onClick={submit}
          disabled={!dirty}
          className="h-9 text-sm font-medium bg-coral text-white px-5 rounded-md hover:bg-coral-soft disabled:opacity-40 transition-colors"
        >
          Submit
        </button>
      </div>
    </div>
  );
}

function QuickField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium pl-0.5">{label}</span>
      {children}
    </label>
  );
}
