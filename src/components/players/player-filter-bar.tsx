"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useTransition } from "react";
import { cn } from "@/lib/utils";
import { Select } from "@/components/select";
import {
  DEFAULT_PLAYER_SPEC,
  parsePlayerSpec,
  playerSpecToParams,
  type PlayerListSpec,
} from "@/lib/players";

const YEARS = [
  { value: 2026, label: "2025-26" },
  { value: 2025, label: "2024-25" },
  { value: 2024, label: "2023-24" },
  { value: 2023, label: "2022-23" },
  { value: 2022, label: "2021-22" },
  { value: 2021, label: "2020-21" },
  { value: 2020, label: "2019-20" },
  { value: 2019, label: "2018-19" },
  { value: 2018, label: "2017-18" },
  { value: 2017, label: "2016-17" },
  { value: 2016, label: "2015-16" },
  { value: 2015, label: "2014-15" },
  { value: 2014, label: "2013-14" },
  { value: 2013, label: "2012-13" },
];
const CLASSES = [
  { value: "", label: "All" },
  { value: "Fr", label: "Freshman" },
  { value: "So", label: "Sophomore" },
  { value: "Jr", label: "Junior" },
  { value: "Sr", label: "Senior" },
  { value: "Gr", label: "Graduate" },
];
const SORTS = [
  { value: "bta_ind_ortg", label: "BTA PRTG" },
  { value: "pir", label: "PIR" },
  { value: "pts", label: "PPG" },
  { value: "fg_pct", label: "FG%" },
  { value: "fg3_pct", label: "3P%" },
  { value: "ts_pct", label: "TS%" },
  { value: "reb", label: "RPG" },
  { value: "ast", label: "APG" },
  { value: "games", label: "GP" },
  { value: "name", label: "Name" },
];
const LIMITS = [50, 100, 250, 500];
const MIN_GAMES = [0, 5, 10, 15, 20];

export function PlayerFilterBar({ conferences }: { conferences: string[] }) {
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

  return (
    <div className={cn("bg-card border border-hairline rounded-lg p-4 lg:p-5", pending && "opacity-70")}>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Season">
          <Select value={String(spec.year)} onChange={(v) => update({ ...spec, year: Number(v) })}>
            {YEARS.map((y) => <option key={y.value} value={y.value}>{y.label}</option>)}
          </Select>
        </Field>
        <Field label="Conference">
          <Select value={spec.conference ?? ""} onChange={(v) => update({ ...spec, conference: v || null })}>
            <option value="">All conferences</option>
            {conferences.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="Class">
          <Select value={spec.cls ?? ""} onChange={(v) => update({ ...spec, cls: v || null })}>
            {CLASSES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
        </Field>
        <Field label="Min games">
          <Select value={String(spec.minGames)} onChange={(v) => update({ ...spec, minGames: Number(v) })}>
            {MIN_GAMES.map((n) => <option key={n} value={n}>{n}+</option>)}
          </Select>
        </Field>

        <div className="ml-auto flex items-end gap-3">
          <Field label="Sort by">
            <Select value={spec.sortBy} onChange={(v) => update({ ...spec, sortBy: v as PlayerListSpec["sortBy"] })}>
              {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select>
          </Field>
          <Field label="Order">
            <Select value={spec.sortDir} onChange={(v) => update({ ...spec, sortDir: v as "asc" | "desc" })}>
              <option value="desc">Desc</option>
              <option value="asc">Asc</option>
            </Select>
          </Field>
          <Field label="Show">
            <Select value={String(spec.limit)} onChange={(v) => update({ ...spec, limit: Number(v) })}>
              {LIMITS.map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </Field>
          <button
            type="button"
            onClick={reset}
            className="h-9 text-sm text-ink-muted hover:text-ink px-2"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Default-spec hint */}
      <p className="text-xs text-ink-muted mt-3">
        Showing top {spec.limit} by {SORTS.find((s) => s.value === spec.sortBy)?.label.toLowerCase()},
        minimum {spec.minGames} games played.
      </p>
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
