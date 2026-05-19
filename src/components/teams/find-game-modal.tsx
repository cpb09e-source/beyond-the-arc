"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { TeamLogo } from "@/components/team-logo";
import { Select } from "@/components/select";
import { MultiYearSelect } from "@/components/explorer/multi-year-select";
import { SearchableMultiSelect } from "@/components/explorer/searchable-multi-select";
import type { SearchableOption } from "@/components/explorer/searchable-select";
import { ScheduleGameModal } from "@/components/teams/schedule-game-modal";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import {
  STAT_OPTIONS,
  OPS,
  makeFilter,
  matches,
  loadGamesForYear,
  type Filter,
  type GameLog,
} from "@/lib/game-filters";
import type { GameLog as StaticGameLog } from "@/lib/static-data";

/**
 * "Find a game" modal — per-team variant of the /calc page. User stacks
 * filters (e.g. "TOV Diff < 0 AND 3PM Diff > 3"), selects which season(s)
 * to scan, and hits Submit to surface every game in this team's history
 * that satisfies all conditions. Defaults to the page's current year.
 *
 * Submit is disabled until at least two filters are present — a single
 * filter usually returns hundreds of games and is rarely interesting.
 */
export function FindGameModal({
  matchGame,
  displayName,
  logoName,
  defaultYear,
  teamOptions,
  teamYearPairs,
  onClose,
}: {
  /** Predicate that decides whether a given game belongs to the subject (team or coach). */
  matchGame: (g: GameLog) => boolean;
  /** Used in the modal title and as the fallback "our team" for box-score sort. */
  displayName: string;
  /** Optional team name for the title-bar logo. Omit for coach-scoped use
   *  where there's no single team to represent. */
  logoName?: string;
  defaultYear: number;
  /** When provided, renders a team multi-select before Seasons so the user
   *  can narrow to specific teams (e.g. Pitino's Louisville years). Each
   *  option's `value` should be the Bart team name. */
  teamOptions?: SearchableOption[];
  /** When provided alongside teamOptions, cross-filters: selecting a team
   *  grays out years the team wasn't active, and vice versa. */
  teamYearPairs?: Array<{ teamName: string; year: number }>;
  onClose: () => void;
}) {
  useBodyScrollLock(true);

  // Coach context (teamYearPairs given) starts with ALL career years
  // pre-selected so the Teams dropdown isn't immediately constrained on open.
  // Team context (single team page) starts with just the current year.
  const [years, setYears] = useState<number[]>(() =>
    teamYearPairs && teamYearPairs.length > 0
      ? Array.from(new Set(teamYearPairs.map((p) => p.year))).sort((a, b) => b - a)
      : [defaultYear],
  );
  const [filters, setFilters] = useState<Filter[]>([
    makeFilter("tov_diff"),
    makeFilter("fg3_made_diff"),
  ]);
  const [yearData, setYearData] = useState<Record<number, GameLog[]>>({});
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState<{ filters: Filter[]; years: number[] } | null>(null);
  const [openBoxScore, setOpenBoxScore] = useState<GameLog | null>(null);
  // Optional team-name filter (coach context only). Empty = all teams the
  // coach has coached at.
  const [selectedTeams, setSelectedTeams] = useState<string[]>([]);

  // List of years the coach was active — used to narrow the year picker
  // options for coach-scoped modals (so they don't see all 14 years when
  // most are irrelevant).
  const careerYears = useMemo(
    () => (teamYearPairs ? Array.from(new Set(teamYearPairs.map((p) => p.year))).sort((a, b) => b - a) : undefined),
    [teamYearPairs],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // SSR-safe portal mount — only render after the client picks up.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Lazy-load any year we don't have cached yet. Parallel fetches with a
  // module-level cache shared with /calc.
  useEffect(() => {
    const missing = years.filter((y) => !yearData[y]);
    if (missing.length === 0) return;
    let cancelled = false;
    setLoading(true);
    Promise.all(missing.map((y) => loadGamesForYear(y).then((arr) => ({ y, arr }))))
      .then((results) => {
        if (cancelled) return;
        setYearData((s) => {
          const next = { ...s };
          for (const { y, arr } of results) next[y] = arr;
          return next;
        });
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [years, yearData]);

  // Concat across selected years, filtered via the predicate (team_id match
  // for team pages, team-year pair match for coach pages). Then narrow by
  // the optional team-name filter (coach context).
  const teamGames = useMemo(() => {
    const teamSet = selectedTeams.length === 0 ? null : new Set(selectedTeams);
    const out: GameLog[] = [];
    for (const y of years) {
      const arr = yearData[y];
      if (!arr) continue;
      for (const g of arr) {
        if (!matchGame(g)) continue;
        if (teamSet && (!g.team_name || !teamSet.has(g.team_name))) continue;
        out.push(g);
      }
    }
    return out;
  }, [years, yearData, matchGame, selectedTeams]);

  const results = useMemo(() => {
    if (!submitted) return null;
    const matching = teamGames.filter((g) => submitted.filters.every((f) => matches(g, f)));
    matching.sort((a, b) => (b.game_date ?? "").localeCompare(a.game_date ?? ""));
    const wins = matching.filter((g) => g.won).length;
    return {
      total: matching.length,
      wins,
      losses: matching.length - wins,
      games: matching,
    };
  }, [submitted, teamGames]);

  function addFilter() {
    if (filters.length >= 8) return;
    setFilters((f) => [...f, makeFilter()]);
  }
  function removeFilter(id: string) {
    setFilters((f) => f.filter((x) => x.id !== id));
  }
  function patchFilter(id: string, patch: Partial<Filter>) {
    setFilters((f) => f.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }
  function submit() {
    setSubmitted({ filters: [...filters], years: [...years] });
  }
  function reset() {
    setFilters([makeFilter("tov_diff"), makeFilter("fg3_made_diff")]);
    setYears([defaultYear]);
    setSubmitted(null);
  }

  const canSubmit = filters.length >= 2 && years.length > 0;

  if (!mounted) return null;

  const body = (
    <div
      role="dialog"
      aria-modal
      aria-label={`Find a ${displayName} game`}
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 p-4 pt-[5vh] overflow-y-auto"
      onClick={onClose}
    >
      <div
        // No `overflow-hidden` here — the MultiYearSelect popover needs to
        // escape the card. We round each top/bottom child explicitly so the
        // corners still clip cleanly.
        className="bg-card border border-ink/10 rounded-xl shadow-xl ring-1 ring-ink/5 w-full max-w-4xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-1 w-full bg-gradient-to-r from-coral via-coral to-coral/60 rounded-t-xl" />

        {/* Header */}
        <div className="px-5 lg:px-7 py-4 lg:py-5 border-b border-hairline bg-paper-deep/30 flex items-start justify-between gap-3">
          <div>
            <div className="text-[0.6rem] uppercase tracking-[0.18em] text-coral font-bold mb-1.5 flex items-center gap-2">
              <span className="h-px w-6 bg-coral" />
              Find a game
            </div>
            <h2 className="font-display text-2xl lg:text-3xl text-ink leading-none tracking-tight inline-flex items-center gap-3">
              {logoName && <TeamLogo name={logoName} size={28} />}
              {displayName} games matching…
            </h2>
            <p className="text-xs text-ink-muted mt-2">
              Stack at least two filters, pick the seasons to scan, then submit.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-ink-muted hover:text-ink hover:bg-paper-deep transition-colors text-lg w-8 h-8 inline-flex items-center justify-center rounded shrink-0"
          >
            ×
          </button>
        </div>

        {/* Year picker + filter rows */}
        <div className="px-5 lg:px-7 py-5 space-y-4 border-b border-hairline">
          <div className="flex flex-wrap items-end gap-4">
            {teamOptions && teamOptions.length > 1 && (
              <label className="flex flex-col gap-1.5">
                <span className="text-xs uppercase tracking-widest text-ink-muted font-medium">Teams</span>
                <SearchableMultiSelect
                  value={selectedTeams}
                  options={teamOptions}
                  onChange={setSelectedTeams}
                  placeholder="Type to filter…"
                  emptyLabel="All teams"
                  ariaLabel="Teams"
                />
              </label>
            )}
            <label className="flex flex-col gap-1.5">
              <span className="text-xs uppercase tracking-widest text-ink-muted font-medium">Seasons</span>
              <MultiYearSelect
                years={years}
                onChange={setYears}
                className="self-start"
                availableYears={careerYears}
              />
            </label>
          </div>

          <div className="space-y-2">
            <span className="text-xs uppercase tracking-widest text-ink-muted font-medium">
              Filters · {filters.length}/8
            </span>
            {filters.map((f, i) => (
              <div key={f.id} className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-ink-muted w-10">
                  {i === 0 ? "Where" : "And"}
                </span>
                <Select
                  value={f.stat as string}
                  onChange={(v) => patchFilter(f.id, { stat: v as keyof GameLog })}
                  className="min-w-44"
                >
                  {STAT_OPTIONS.map((s) => (
                    <option key={s.key as string} value={s.key as string}>
                      {s.label}
                    </option>
                  ))}
                </Select>
                <Select
                  value={f.op}
                  onChange={(v) => patchFilter(f.id, { op: v as Filter["op"] })}
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
                  onChange={(e) => patchFilter(f.id, { value: Number(e.target.value) })}
                  className="h-10 w-24 px-3 rounded-md border border-ink/15 bg-white text-ink text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-coral/40 focus:border-coral/40 transition-colors"
                />
                {filters.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeFilter(f.id)}
                    className="text-sm text-ink-muted hover:text-coral px-2 py-1"
                    aria-label="Remove filter"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={addFilter}
                disabled={filters.length >= 8}
                className="text-sm font-medium text-coral hover:text-ink disabled:text-ink-muted/50 disabled:cursor-not-allowed"
              >
                + Add filter
              </button>
              {filters.length < 2 && (
                <span className="text-xs text-ink-muted">
                  Add at least one more — Submit needs 2+ filters.
                </span>
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
                  disabled={!canSubmit}
                  className="text-sm font-medium bg-coral text-white px-5 py-2 rounded hover:bg-coral-soft disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Submit
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Results */}
        <div className="px-5 lg:px-7 py-5 max-h-[55vh] overflow-y-auto rounded-b-xl">
          {!submitted && (
            <p className="text-sm text-ink-muted text-center py-8">
              Set your filters and submit to see matching games.
            </p>
          )}
          {submitted && loading && (
            <p className="text-sm text-ink-muted text-center py-8">Loading game data…</p>
          )}
          {submitted && !loading && results && (
            <ResultsView displayName={displayName} results={results} onOpenBoxScore={setOpenBoxScore} />
          )}
        </div>
      </div>
      {/* Box-score modal stacked above this modal. Reuses the same
          ScheduleGameModal as the team-page schedule ticker so player names
          link and the box-score data loads identically. */}
      {openBoxScore && (
        <ScheduleGameModal
          game={openBoxScore as unknown as StaticGameLog}
          // Prefer each game's own team_name so a coach-scoped modal still
          // sorts the box score with the right "our team" on each game.
          teamName={openBoxScore.team_name ?? displayName}
          onClose={() => setOpenBoxScore(null)}
        />
      )}
    </div>
  );
  return createPortal(body, document.body);
}

function ResultsView({
  displayName,
  results,
  onOpenBoxScore,
}: {
  displayName: string;
  results: { total: number; wins: number; losses: number; games: GameLog[] };
  onOpenBoxScore: (g: GameLog) => void;
}) {
  if (results.total === 0) {
    return (
      <div className="text-center py-8">
        <p className="font-display text-2xl text-ink">No matches</p>
        <p className="text-sm text-ink-muted mt-1">No {displayName} games met every filter. Loosen one.</p>
      </div>
    );
  }
  const winPct = results.wins / results.total;
  return (
    <div className="space-y-4">
      {/* Headline summary */}
      <div className="grid grid-cols-3 gap-px bg-hairline border border-hairline rounded-lg overflow-hidden">
        <div className="bg-paper p-4 text-center">
          <div className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium mb-1">Matches</div>
          <div className="font-display text-3xl text-ink tabular">{results.total}</div>
        </div>
        <div className="bg-paper p-4 text-center">
          <div className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium mb-1">W-L</div>
          <div className="font-display text-3xl text-ink tabular">
            {results.wins}-{results.losses}
          </div>
        </div>
        <div className="bg-paper p-4 text-center">
          <div className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-medium mb-1">Win %</div>
          <div className="font-display text-3xl text-coral tabular">
            {(winPct * 100).toFixed(1)}%
          </div>
        </div>
      </div>

      {/* Game list */}
      <ul className="divide-y divide-hairline/60">
        {results.games.map((g, i) => (
          <li key={`${g.cbba_game_id}-${i}`} className="flex items-center gap-3 py-2.5">
            <span className="text-xs tabular text-ink-muted w-20 shrink-0">
              {fmtDate(g.game_date)}
            </span>
            <span className="text-xs text-ink-muted w-6 shrink-0">
              {g.is_neutral ? "vs" : g.is_home ? "vs" : "@"}
            </span>
            <span className="inline-flex items-center gap-2 flex-1 min-w-0">
              <TeamLogo name={g.opp_team_market ?? "TBD"} size={20} />
              <Link
                href={`/teams/${teamSlug(g.opp_team_market ?? "")}/${g.year}/`}
                className="text-sm text-ink hover:text-coral transition-colors truncate"
              >
                {g.opp_team_market ?? "TBD"}
              </Link>
            </span>
            <span
              className={
                g.won
                  ? "inline-flex items-center justify-center text-[0.55rem] font-bold tabular w-6 h-5 rounded bg-emerald-100 text-emerald-800"
                  : "inline-flex items-center justify-center text-[0.55rem] font-bold tabular w-6 h-5 rounded bg-rose-100 text-rose-800"
              }
            >
              {g.won ? "W" : "L"}
            </span>
            <button
              type="button"
              onClick={() => onOpenBoxScore(g)}
              className="tabular text-sm text-ink-soft w-16 text-right hover:text-coral hover:underline transition-colors cursor-pointer"
              title="Open box score"
            >
              {g.pts_scored}-{g.pts_against}
            </button>
            <span className="text-[0.6rem] uppercase tracking-widest text-ink-muted/70 font-medium tabular w-12 text-right shrink-0">
              {seasonShort(g.year)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function teamSlug(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map((s) => parseInt(s, 10));
  if (!y || !m || !d) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[m - 1]} ${d}, ${y}`;
}
function seasonShort(y: number): string {
  return `${(y - 1).toString().slice(-2)}-${y.toString().slice(-2)}`;
}
