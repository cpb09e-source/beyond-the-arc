"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Lock } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import {
  type StatFilter,
  type TeamFilterSpec,
  parseSpec,
  specToParams,
} from "@/lib/team-filters";
import { type SearchableOption } from "./searchable-select";
import { SearchableMultiSelect } from "./searchable-multi-select";
import { MultiYearSelect } from "./multi-year-select";
import { confDisplay } from "@/lib/conf-display";
import { POWER_CONFS } from "@/lib/conf-tiers";
import { ScopeCollapse, scopeSummary } from "@/components/filters/scope-collapse";
import { FREE_LIMITS } from "@/lib/access";
import { useEntitlement } from "@/lib/use-entitlement";
import { useMounted } from "@/lib/use-mounted";

const CONF_GROUP_LABELS = { power: "Power Conferences", midmajor: "Mid-Majors" } as const;

// Defaults applied by the Reset button (matches the empty-URL spec).
const DEFAULT_DRAFT: Pick<TeamFilterSpec, "years" | "conf" | "teams" | "filters"> = {
  years: parseSpec({}).years,
  conf: [],
  teams: [],
  filters: [],
};

export type ConferenceRanking = { conference: string; avg_a_net: number; teams: number; contributing: number };

export function FilterBar({
  conferences,
  teams,
}: {
  conferences: string[];
  teams: string[];
}) {
  const router = useRouter();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();
  const { paid } = useEntitlement();

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
    teams: urlSpec.teams,
    filters: urlSpec.filters,
  });

  /**
   * Re-sync the draft when the URL changes from outside — browser back, a
   * shared link, a saved filter applied elsewhere.
   *
   * ADJUSTED DURING RENDER rather than in an effect. As an effect this painted
   * the panel once with the previous URL's values still in the fields, then
   * again with the new ones; here the correction happens before anything is
   * shown. `search` is the whole query string, so a sort click re-runs it
   * harmlessly — the values it writes are the ones already there.
   */
  const [syncedSearch, setSyncedSearch] = useState(search);
  if (syncedSearch !== search) {
    setSyncedSearch(search);
    setDraft({ years: urlSpec.years, conf: urlSpec.conf, teams: urlSpec.teams, filters: urlSpec.filters });
  }

  function patch(next: Partial<typeof draft>) {
    setDraft((d) => ({ ...d, ...next }));
  }

  /**
   * The season picker becomes a RADIO on the free plan, not a broken checkbox.
   *
   * The naive cap — take the first N of whatever comes back — is the version
   * that feels broken: the picker sorts newest-first, so a reader on 2025-26
   * who clicks 2018-19 would get their click silently thrown away and no idea
   * why. Swapping to the season they just asked for is the behaviour a control
   * with a limit of one should have, and it means every season stays reachable
   * with one click.
   *
   * Newest-first among the additions so "Select all" and a dragged range land
   * on the most recent season rather than on 2013-14, which is what sorting
   * the raw array would have given.
   */
  function patchYears(next: number[]) {
    const cap = FREE_LIMITS.seasonsAtOnce;
    if (paid || next.length <= cap) { patch({ years: next }); return; }
    const added = next.filter((y) => !draft.years.includes(y)).sort((a, b) => b - a);
    const kept = next.filter((y) => !added.includes(y)).sort((a, b) => b - a);
    patch({ years: [...added, ...kept].slice(0, cap) });
  }
  // NOTE: this bar no longer edits stat filters — TeamStatFilters owns them
  // now — but it still carries `draft.filters` through untouched so pressing
  // Submit here can't wipe filters the drawer set.

  function submit() {
    // Preserve sort/limit from the URL; only overwrite the draft-controlled fields.
    const next: TeamFilterSpec = { ...urlSpec, years: draft.years, conf: draft.conf, teams: draft.teams, filters: draft.filters };
    const p = specToParams(next).toString();
    startTransition(() => router.replace(p ? `/?${p}` : "/", { scroll: false }));

    // On mobile (<md), jump down to the results card so the user lands on
    // the freshly-filtered rows instead of scrolling past the filter bar.
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      requestAnimationFrame(() => {
        document.getElementById("teams-table")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }
  function reset() {
    setDraft(DEFAULT_DRAFT);
    startTransition(() => router.replace("/", { scroll: false }));
  }

  const dirty = !sameDraft(draft, { years: urlSpec.years, conf: urlSpec.conf, teams: urlSpec.teams, filters: urlSpec.filters });

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
    // Power section first, then mid-majors; alpha within each. The picker
    // renders groups in the order they first appear in `options`.
    return opts.sort((a, b) => {
      if (a.group !== b.group) return a.group === "power" ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
  }, [conferences]);

  // Collapsed-state read of the current scope. Seasons always shows; team and
  // conference only when they're actually narrowing something.
  const summary = scopeSummary([
    { label: "seasons", values: draft.years.map(seasonLabel) },
    { label: "teams", values: draft.teams },
    { label: "conferences", values: draft.conf.map(confDisplay) },
  ]);

  return (
    // Slim scope bar, no card — same shape as PlayerFilterBar. Collapsed behind
    // a toggle below `md` (see ScopeCollapse); identical to before above it.
    <ScopeCollapse summary={summary} pending={pending}>
      <div className="flex flex-wrap items-end gap-2">
        {/* Widths are pinned to the same values PlayerFilterBar uses (w-32 /
            w-52 / w-44). Left unset these selects sized themselves to their
            content, so the two pages' scope rows never lined up. */}
        <Field label="Seasons">
          <MultiYearSelect
            years={draft.years}
            onChange={patchYears}
            className="w-32"
            lockedNotice={
              paid ? null : (
                <>
                  <Lock size={11} className="inline-block mr-1 -mt-0.5 text-coral" aria-hidden />
                  One season at a time on the free plan — picking another swaps to it.{" "}
                  <Link href="/pricing" className="font-medium text-coral hover:underline">
                    Compare seasons
                  </Link>
                </>
              )
            }
          />
          {/* NO STANDING LABEL UNDER THIS CONTROL. There was one, and it was
              wrong twice over: it advertised a limit to a reader who had not
              tried to exceed it, and it sat outside the popover, where it is
              read after the picker closes rather than at the moment the swap
              happens. `lockedNotice` above says the same thing inside the
              dropdown, once per opening, immediately after the click that
              needs explaining. */}
        </Field>

        <Field label="Team">
          <SearchableMultiSelect
            value={draft.teams}
            options={teamOptions}
            onChange={(teams) => patch({ teams })}
            placeholder="Type to filter…"
            emptyLabel="All"
            ariaLabel="Teams"
            className="w-52"
          />
        </Field>

        <Field label="Conference">
          {/* The Conference Rankings link used to sit here. It reads as a
              property of the result set, not of the scope controls, so it
              moved next to the row count in the table toolbar. */}
          <SearchableMultiSelect
            value={draft.conf}
            options={confOptions}
            onChange={(conf) => patch({ conf })}
            placeholder="Type to filter…"
            emptyLabel="All"
            ariaLabel="Conferences"
            groupLabels={CONF_GROUP_LABELS}
            className="w-44"
          />
        </Field>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={!dirty}
          className="h-9 text-sm font-medium bg-coral text-white px-5 rounded-md hover:bg-coral-soft disabled:opacity-40 transition-colors"
        >
          Submit
        </button>
        <button type="button" onClick={reset} className="h-9 px-3 text-sm text-ink-muted hover:text-ink">Reset</button>
      </div>
    </ScopeCollapse>
  );
}

function sameDraft(
  a: { years: number[]; conf: string[]; teams: string[]; filters: StatFilter[] },
  b: { years: number[]; conf: string[]; teams: string[]; filters: StatFilter[] },
): boolean {
  if (!sameStringArr(a.conf, b.conf)) return false;
  if (!sameStringArr(a.teams, b.teams)) return false;
  if (a.years.length !== b.years.length) return false;
  for (let i = 0; i < a.years.length; i++) if (a.years[i] !== b.years[i]) return false;
  if (a.filters.length !== b.filters.length) return false;
  for (let i = 0; i < a.filters.length; i++) {
    const x = a.filters[i]!, y = b.filters[i]!;
    if (x.stat !== y.stat || x.op !== y.op || x.value !== y.value) return false;
  }
  return true;
}

function sameStringArr(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  // Order-insensitive: the user can pick checkboxes in any order, but two
  // drafts with the same set of selections should not show "unsaved changes".
  const sa = [...a].sort();
  const sb = [...b].sort();
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false;
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

function seasonLabel(y: number): string {
  return `${(y - 1).toString().slice(-2)}-${y.toString().slice(-2)}`;
}

export function ConferenceRankingsModal({
  rankings, years, onClose,
}: {
  rankings: ConferenceRanking[];
  years: number[];
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // SSR safety: only mount the portal after the client picks it up.
  const mounted = useMounted();
  if (!mounted) return null;

  const body = (
    <div
      role="dialog"
      aria-modal
      aria-label="Conference rankings"
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 p-4 pt-[6vh]"
      onClick={onClose}
    >
      <div
        className="bg-card border border-hairline rounded-lg w-full max-w-4xl max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-hairline">
          <div>
            <div className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium">Conference rankings</div>
            <div className="font-display text-2xl text-ink leading-tight">Average aNET by Conference</div>
            <div className="text-xs text-ink-muted mt-1">
              {years[0] ? `${seasonLabel(years[0])} season` : ""} · mean aNET of each league&rsquo;s teams, excluding its two worst
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-ink-muted hover:text-coral text-xl leading-none px-2"
          >
            ×
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-2">
          {rankings.length === 0 ? (
            <p className="p-6 text-sm text-ink-muted text-center">No conferences to rank.</p>
          ) : (
            // Split into two columns: first half by rank goes left, second
            // half goes right. Both reset to rank 1 on the left side so the
            // ranking reads top-down within each column.
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
              {(() => {
                const half = Math.ceil(rankings.length / 2);
                return [rankings.slice(0, half), rankings.slice(half)].map((col, ci) => (
                  <ul key={ci} className="divide-y divide-hairline/60">
                    {col.map((r, i) => {
                      const rank = ci === 0 ? i + 1 : half + i + 1;
                      return (
                        <li key={r.conference} className="flex items-center gap-3 py-2.5 hover:bg-paper-deep/40 transition-colors -mx-2 px-2 rounded">
                          <span className="font-display text-base text-ink-muted tabular w-6 text-center">{rank}</span>
                          {/* The contributing/total count ("10/12") used to sit
                              beside the name to make the two-worst exclusion
                              visible. It read as a record on a table of
                              conferences and earned its space back as a
                              tooltip — the subhead already states the rule. */}
                          <span className="flex-1 min-w-0">
                            <span
                              className="font-medium text-ink text-sm"
                              title={`${r.contributing} of ${r.teams} teams counted`}
                            >
                              {confDisplay(r.conference)}
                            </span>
                          </span>
                          <span className={`font-display text-lg tabular ${r.avg_a_net >= 0 ? "text-coral" : "text-ink-muted"}`}>
                            {r.avg_a_net > 0 ? "+" : ""}{r.avg_a_net.toFixed(1)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ));
              })()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
  return createPortal(body, document.body);
}
