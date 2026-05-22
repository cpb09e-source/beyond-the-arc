"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useTransition } from "react";
import { cn } from "@/lib/utils";
import { Select } from "@/components/select";
import { confDisplay } from "@/lib/conf-display";
import { POWER_CONFS } from "@/lib/conf-tiers";
import { MultiYearSelect } from "@/components/explorer/multi-year-select";
import { SearchableMultiSelect } from "@/components/explorer/searchable-multi-select";
import type { SearchableOption } from "@/components/explorer/searchable-select";
import {
  DEFAULT_PLAYER_SPEC,
  parsePlayerSpec,
  playerSpecToParams,
  type PlayerListSpec,
} from "@/lib/players";

// Class options. Empty checkbox set = "all classes" (matches Team Explorer's
// "all selected ⇒ All …" trigger convention).
const CLASS_OPTIONS: SearchableOption[] = [
  { value: "Fr", label: "Freshman" },
  { value: "So", label: "Sophomore" },
  { value: "Jr", label: "Junior" },
  { value: "Sr", label: "Senior" },
  { value: "Gr", label: "Graduate" },
];

const MIN_GAMES = [0, 5, 10, 15, 20];

const CONF_GROUP_LABELS = { power: "Power Conferences", midmajor: "Mid-Majors" } as const;

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
  const spec: PlayerListSpec = parsePlayerSpec(params);

  function update(next: PlayerListSpec) {
    const p = playerSpecToParams(next).toString();
    startTransition(() => {
      router.replace(p ? `/players?${p}` : "/players", { scroll: false });
    });
  }
  function reset() {
    startTransition(() => router.replace("/players", { scroll: false }));
  }

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

  const isDefault =
    spec.years.length === DEFAULT_PLAYER_SPEC.years.length &&
    spec.years.every((y, i) => y === DEFAULT_PLAYER_SPEC.years[i]) &&
    spec.conf.length === 0 &&
    spec.teams.length === 0 &&
    spec.cls.length === 0 &&
    spec.minGames === DEFAULT_PLAYER_SPEC.minGames &&
    spec.sortBy === DEFAULT_PLAYER_SPEC.sortBy &&
    spec.sortDir === DEFAULT_PLAYER_SPEC.sortDir &&
    spec.limit === DEFAULT_PLAYER_SPEC.limit;

  return (
    <div className={cn("bg-paper-deep/25 border border-hairline rounded-xl shadow-sm p-4 lg:p-5", pending && "opacity-70")}>
      {/* Single-row filter bar — primary scope only. Sort / Order / Show /
          Search now live in the Leaderboard header (mirrors /teams). Reset
          sits at the far right of this row, only enabled when filters are
          non-default. */}
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Seasons">
          <MultiYearSelect
            years={spec.years}
            onChange={(years) => update({ ...spec, years })}
          />
        </Field>
        <Field label="Team">
          <SearchableMultiSelect
            value={spec.teams}
            options={teamOptions}
            onChange={(t) => update({ ...spec, teams: t })}
            placeholder="Type to filter…"
            emptyLabel="All teams"
            ariaLabel="Teams"
          />
        </Field>
        <Field label="Conference">
          <SearchableMultiSelect
            value={spec.conf}
            options={confOptions}
            onChange={(c) => update({ ...spec, conf: c })}
            placeholder="Type to filter…"
            emptyLabel="All conferences"
            ariaLabel="Conferences"
            groupLabels={CONF_GROUP_LABELS}
          />
        </Field>
        <Field label="Class">
          <SearchableMultiSelect
            value={spec.cls}
            options={CLASS_OPTIONS}
            onChange={(c) => update({ ...spec, cls: c })}
            placeholder="Type to filter…"
            emptyLabel="All classes"
            ariaLabel="Classes"
          />
        </Field>
        <Field label="Min games">
          <Select value={String(spec.minGames)} onChange={(v) => update({ ...spec, minGames: Number(v) })}>
            {MIN_GAMES.map((n) => <option key={n} value={n}>{n}+</option>)}
          </Select>
        </Field>
        <div className="ml-auto">
          <button
            type="button"
            onClick={reset}
            disabled={isDefault}
            className="h-9 text-sm text-ink-muted hover:text-ink px-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Reset
          </button>
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
