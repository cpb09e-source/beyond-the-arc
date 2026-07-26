"use client";

import { useEffect, useMemo, useState } from "react";
import { TeamLogo } from "@/components/team-logo";
import { MultiYearSelect } from "@/components/explorer/multi-year-select";
import { SearchableSelect, type SearchableOption } from "@/components/explorer/searchable-select";
import { SearchableMultiSelect } from "@/components/explorer/searchable-multi-select";
import { Select } from "@/components/select";
import { confDisplay } from "@/lib/conf-display";
// Single source of truth for the game-log shape + filter catalog. This file
// used to carry its own copy, which had already drifted from the shared one
// (it listed ft_att_diff, the shared list didn't). Both /calc and the team /
// coach "Find a game" modal now read the same STAT_OPTIONS.
import {
  CALC_STAT_OPTIONS,
  OPS,
  makeFilter,
  matches,
  type GameLog,
  type Filter,
  type Op,
} from "@/lib/game-filters";
import { isExhibitionGame } from "@/lib/seasons";
import { attachGameBox, type GameBoxFile } from "@/lib/game-box";
import {
  quadFor,
  ratingKey,
  normTeamKey,
  gameKey,
  type Quad,
  type TeamRatingsFile,
} from "@/lib/quad";

// Venue buckets. A neutral-site game appears twice in the logs (once per
// team) with is_neutral true on both rows, so neutral must be tested BEFORE
// is_home — otherwise half of every neutral game counts as "home".
type Venue = "all" | "home" | "away" | "neutral";
function venueOf(g: GameLog): Exclude<Venue, "all"> {
  if (g.is_neutral) return "neutral";
  return g.is_home ? "home" : "away";
}
const VENUE_OPTIONS: Array<{ value: Venue; label: string }> = [
  { value: "all",     label: "All venues" },
  { value: "home",    label: "Home" },
  { value: "away",    label: "Away" },
  { value: "neutral", label: "Neutral" },
];

const QUAD_OPTIONS: SearchableOption[] = [
  { value: "1", label: "Quad 1" },
  { value: "2", label: "Quad 2" },
  { value: "3", label: "Quad 3" },
  { value: "4", label: "Quad 4" },
];

/**
 * Attach opponent rank + quadrant to one season's rows.
 *
 * The opponent is found by pairing rows on the shared numeric prefix of
 * cbba_game_id rather than by matching opp_team_market, which is a third name
 * space. A game with no paired row is a non-D1 opponent (~5% of rows) and gets
 * a null rank, which quadFor() maps to Q4 — matching how the committee treats
 * non-D1 games.
 */
function enrichWithQuad(rows: GameLog[], ratings: TeamRatingsFile | null): GameLog[] {
  const rankByTeam = new Map<string, number>();
  if (ratings) for (const t of ratings.teams) rankByTeam.set(normTeamKey(t.team), t.rank_net);

  const byGame = new Map<string, GameLog[]>();
  for (const r of rows) {
    const k = gameKey(r.cbba_game_id);
    const arr = byGame.get(k);
    if (arr) arr.push(r);
    else byGame.set(k, [r]);
  }

  return rows.map((r) => {
    const pair = byGame.get(gameKey(r.cbba_game_id));
    const opp = pair && pair.length > 1 ? pair.find((x) => x !== r) : undefined;
    const oppRank = opp ? rankByTeam.get(ratingKey(opp.team_name)) ?? null : null;
    // No paired row means the opponent isn't a D1 team in our data.
    return { ...r, opp_rank: oppRank, quad: quadFor(oppRank, venueOf(r)), non_d1: !opp };
  });
}

export function CalcClient({
  coachByTeamYear,
  allCoaches,
}: {
  /** (team_name → year → coach name) lookup, pre-derived server-side from
   *  src/data/coach-history.json. Lets the Coach picker resolve which games
   *  belong to a coach without a per-game coach field on the log itself. */
  coachByTeamYear: Record<string, Record<number, string>>;
  /** Sorted (last name, first name) list of every coach name in the data
   *  window. Drives the Coach dropdown options. */
  allCoaches: string[];
}) {
  const [years, setYears] = useState<number[]>([2026]);
  // Multi-select conference. Empty = "all conferences". Stores Bart codes
  // (ACC/B10/BE/etc.); we display via confDisplay() so labels read nicely.
  const [conferences, setConferences] = useState<string[]>([]);
  // Multi-select team. Empty = "all teams". Stores team_name strings as they
  // appear in the game logs; team names are stable enough across seasons to
  // use directly as keys.
  const [teams, setTeams] = useState<string[]>([]);
  // Multi-select coach. Empty = "all coaches". Stores raw coach names. A
  // game qualifies if coachByTeamYear[team_name][year] is in this set.
  const [coaches, setCoaches] = useState<string[]>([]);
  // Venue bucket — "all" | "home" | "away" | "neutral". Single-select; the
  // three real buckets are mutually exclusive so a multi-select would only
  // ever mean "all".
  const [venue, setVenue] = useState<Venue>("all");
  // Multi-select opponent. Empty = "all opponents". NOTE this is a different
  // name space from `teams`: opp_team_market includes non-D1 opponents, so the
  // 2026 logs carry ~781 distinct opponents against only ~365 team_names.
  // Hence its own option list rather than reusing teamOptions.
  const [opponents, setOpponents] = useState<string[]>([]);
  // Multi-select quadrant. Empty = all quads. Values are "1".."4" strings so
  // they fit SearchableMultiSelect's string API.
  const [quads, setQuads] = useState<string[]>([]);
  // Games against non-D1 opponents count toward a team's official NCAA record
  // but are excluded by every serious rating system (NET, KenPom, Torvik),
  // because a 40-point win over a D3 school tells you nothing. Default to
  // excluding them here; the toggle keeps the official-record view available.
  const [d1Only, setD1Only] = useState(true);
  const [yearData, setYearData] = useState<Record<number, GameLog[]>>({});
  const [filters, setFilters] = useState<Filter[]>([makeFilter("tov_diff"), makeFilter("fg3_made_diff"), makeFilter("fbpts_diff")]);
  const [submitted, setSubmitted] = useState<{ filters: Filter[]; conferences: string[]; teams: string[]; coaches: string[]; venue: Venue; opponents: string[]; quads: string[]; d1Only: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  // Two independent post-result filters. Persist across re-calcs so power
  // users can lock in a team and watch the record shift as they iterate on
  // conditions. dateFilter holds a 4-digit calendar year string (empty = all
  // years). teamFilter is a free-text substring against team_name.
  const [dateFilter, setDateFilter] = useState<string>("");
  const [teamFilter, setTeamFilter] = useState<string>("");

  // Stat options as SearchableOption[] for the typeable picker.
  const statOptions = useMemo<SearchableOption[]>(
    () => CALC_STAT_OPTIONS.map((o) => ({ value: o.key as string, label: o.label, group: o.group })),
    [],
  );
  const statGroupLabels = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const o of CALC_STAT_OPTIONS) out[o.group] = o.group;
    return out;
  }, []);

  // Fetch every selected year that isn't already cached. Parallel fetches.
  useEffect(() => {
    const missing = years.filter((y) => !yearData[y]);
    if (missing.length === 0) return;
    let cancelled = false;
    setLoading(true);
    setLoadErr(null);
    Promise.all(
      missing.map((y) =>
        // Ratings ride along so opponent rank / quadrant can be attached once,
        // here, rather than recomputed on every Calculate. The ratings file is
        // ~80 KB against a ~7.5 MB game-log file, so it's effectively free.
        Promise.all([
          fetch(`/data/game-logs-by-year/${y}.json`).then((r) => {
            if (!r.ok) throw new Error(`${y}: HTTP ${r.status}`);
            return r.json() as Promise<GameLog[]>;
          }),
          fetch(`/data/team-ratings-${y}.json`)
            .then((r) => (r.ok ? (r.json() as Promise<TeamRatingsFile>) : null))
            .catch(() => null),
          // Per-game team box from CBBD (four factors, ratings, halftime
          // margin, fouls...). ~1.5 MB/season columnar. Optional: a missing
          // file just leaves those fields null.
          fetch(`/data/game-box-by-year/${y}.json`)
            .then((r) => (r.ok ? (r.json() as Promise<GameBoxFile>) : null))
            .catch(() => null),
        ]).then(([arr, ratings, box]) => ({
          y,
          // Preseason exhibitions are not real results — drop before enrichment so
          // they can't reach the record, win%, or quadrant maths.
          arr: attachGameBox(
            enrichWithQuad(arr.filter((g) => !isExhibitionGame(g.game_date, y)), ratings),
            box,
          ),
        }))
      )
    )
      .then((results) => {
        if (cancelled) return;
        setYearData((s) => {
          const next = { ...s };
          for (const { y, arr } of results) next[y] = arr;
          return next;
        });
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadErr(e.message);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [years, yearData]);

  // Concat across selected years
  const games = useMemo(() => {
    const out: GameLog[] = [];
    for (const y of years) {
      const arr = yearData[y];
      if (arr) out.push(...arr);
    }
    return out;
  }, [years, yearData]);

  // Conference list derived from loaded games — stays in sync with years.
  const allConferences = useMemo(() => {
    const s = new Set<string>();
    for (const g of games) if (g.team_conference) s.add(g.team_conference);
    return [...s].sort();
  }, [games]);
  const conferenceOptions = useMemo<SearchableOption[]>(
    () => allConferences.map((c) => ({ value: c, label: confDisplay(c) })),
    [allConferences],
  );

  // Team list derived from loaded games — same shape as conferences.
  // Filtered by the conference picker so the team list narrows as the user
  // commits to a conference (typical "Big 12 teams only" flow).
  const allTeams = useMemo(() => {
    const confSet = conferences.length === 0 ? null : new Set(conferences);
    const s = new Set<string>();
    for (const g of games) {
      if (confSet && (!g.team_conference || !confSet.has(g.team_conference))) continue;
      s.add(g.team_name);
    }
    return [...s].sort();
  }, [games, conferences]);
  const teamOptions = useMemo<SearchableOption[]>(
    () => allTeams.map((t) => ({ value: t, label: t })),
    [allTeams],
  );

  // Opponent list — derived from opp_team_market, which is its own name space
  // (includes non-D1 opponents that never appear as team_name).
  const opponentOptions = useMemo<SearchableOption[]>(() => {
    const s = new Set<string>();
    for (const g of games) if (g.opp_team_market) s.add(g.opp_team_market);
    return [...s].sort().map((t) => ({ value: t, label: t }));
  }, [games]);

  // Coach options — list every coach (alphabetical last name) regardless of
  // current filter selection. Narrowing this by year would hide active
  // coaches when the user hasn't picked their year yet; keeping it broad
  // matches the Conference picker's behavior.
  const coachOptions = useMemo<SearchableOption[]>(
    () => allCoaches.map((c) => ({ value: c, label: c })),
    [allCoaches],
  );

  const results = useMemo(() => {
    if (!submitted || games.length === 0) return null;
    const confSet = submitted.conferences.length === 0 ? null : new Set(submitted.conferences);
    const teamSet = submitted.teams.length === 0 ? null : new Set(submitted.teams);
    const coachSet = submitted.coaches.length === 0 ? null : new Set(submitted.coaches);
    const oppSet = submitted.opponents.length === 0 ? null : new Set(submitted.opponents);
    const quadSet = submitted.quads.length === 0 ? null : new Set(submitted.quads);
    const matching = games.filter((g) => {
      if (confSet && (g.team_conference == null || !confSet.has(g.team_conference))) return false;
      if (teamSet && !teamSet.has(g.team_name)) return false;
      if (oppSet && (g.opp_team_market == null || !oppSet.has(g.opp_team_market))) return false;
      if (submitted.venue !== "all" && venueOf(g) !== submitted.venue) return false;
      if (quadSet && !quadSet.has(String(g.quad ?? 4))) return false;
      if (submitted.d1Only && g.non_d1) return false;
      if (coachSet) {
        const coach = coachByTeamYear[g.team_name]?.[g.year];
        if (!coach || !coachSet.has(coach)) return false;
      }
      return submitted.filters.every((f) => matches(g, f));
    });
    const wins = matching.filter((g) => g.won).length;
    const losses = matching.length - wins;
    // Average margin (signed). Positive => team typically won by X; negative
    // => team typically lost by X. Skips rows with null pts_diff so missing
    // data doesn't drag the mean toward zero.
    let marginSum = 0;
    let marginCount = 0;
    for (const g of matching) {
      if (typeof g.pts_diff === "number") {
        marginSum += g.pts_diff;
        marginCount++;
      }
    }
    const avgMargin = marginCount > 0 ? marginSum / marginCount : null;
    return {
      total: matching.length,
      wins,
      losses,
      winPct: matching.length === 0 ? 0 : wins / matching.length,
      avgMargin,
      matching,
    };
  }, [submitted, games, coachByTeamYear]);

  // Year options derived from matching results — only show years that
  // actually have games in the current result set, sorted newest first.
  const yearOptions = useMemo<SearchableOption[]>(() => {
    if (!results) return [];
    const years = new Set<string>();
    for (const g of results.matching) {
      if (g.game_date && g.game_date.length >= 4) years.add(g.game_date.slice(0, 4));
    }
    const sorted = [...years].sort((a, b) => b.localeCompare(a));
    return [{ value: "", label: "All years" }, ...sorted.map((y) => ({ value: y, label: y }))];
  }, [results]);

  // Visible-rows derivation — applies both filters, caps at MAX_VISIBLE so
  // the DOM stays small even when 50k games match.
  const MAX_VISIBLE = 25;
  const visibleSample = useMemo(() => {
    if (!results) return { rows: [] as GameLog[], filteredTotal: 0 };
    const teamQ = teamFilter.trim().toLowerCase();
    const filtered = results.matching.filter((g) => {
      if (dateFilter) {
        if (!g.game_date || g.game_date.slice(0, 4) !== dateFilter) return false;
      }
      if (teamQ && !g.team_name.toLowerCase().includes(teamQ)) return false;
      return true;
    });
    return { rows: filtered.slice(0, MAX_VISIBLE), filteredTotal: filtered.length };
  }, [results, dateFilter, teamFilter]);
  const hasResultFilter = dateFilter !== "" || teamFilter.trim() !== "";

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

  return (
    <div className="space-y-6">
      {/* Year + filters */}
      <div className="bg-paper-deep/25 border border-hairline rounded-xl shadow-sm">
        <div className="grid grid-cols-2 gap-3 p-4 sm:flex sm:flex-wrap sm:items-end lg:p-5 border-b border-hairline">
          <Field label="Seasons">
            <MultiYearSelect years={years} onChange={setYears} />
          </Field>
          <Field label="Conference">
            <SearchableMultiSelect
              value={conferences}
              options={conferenceOptions}
              onChange={(next) => {
                setConferences(next);
                // Drop any selected team that's no longer in the narrowed
                // conference set. Keeps state consistent so a hidden team
                // can't silently constrain the calc. Skipped when the user
                // selects "all conferences" because nothing narrows.
                const narrowed = next.length > 0 && next.length < conferenceOptions.length;
                if (narrowed) {
                  const confSet = new Set(next);
                  setTeams((prev) =>
                    prev.filter((t) => {
                      const g = games.find((x) => x.team_name === t);
                      return g?.team_conference != null && confSet.has(g.team_conference);
                    }),
                  );
                }
              }}
              placeholder="Type to filter…"
              emptyLabel="All conferences"
              className="w-full sm:w-auto sm:min-w-44"
              ariaLabel="Conferences"
              align="right"
            />
          </Field>
          <Field label="Team">
            <SearchableMultiSelect
              value={teams}
              options={teamOptions}
              onChange={setTeams}
              placeholder="Type to filter…"
              emptyLabel="All teams"
              className="w-full sm:w-auto sm:min-w-44"
              ariaLabel="Teams"
            />
          </Field>
          <Field label="Coach">
            <SearchableMultiSelect
              value={coaches}
              options={coachOptions}
              onChange={setCoaches}
              placeholder="Type to filter…"
              emptyLabel="All coaches"
              className="w-full sm:w-auto sm:min-w-44"
              ariaLabel="Coaches"
              align="right"
            />
          </Field>
          <Field label="Opponent">
            <SearchableMultiSelect
              value={opponents}
              options={opponentOptions}
              onChange={setOpponents}
              placeholder="Type to filter…"
              emptyLabel="All opponents"
              className="w-full sm:w-auto sm:min-w-44"
              ariaLabel="Opponents"
              align="right"
            />
          </Field>
          <Field label="Venue">
            <Select
              value={venue}
              onChange={(v) => setVenue(v as Venue)}
              className="w-full sm:w-auto sm:min-w-32"
              aria-label="Venue"
            >
              {VENUE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </Field>
          <Field label="Quad">
            <SearchableMultiSelect
              value={quads}
              options={QUAD_OPTIONS}
              onChange={setQuads}
              placeholder="Type to filter…"
              emptyLabel="All quads"
              className="w-full sm:w-auto sm:min-w-36"
              ariaLabel="Quadrants"
              align="right"
            />
          </Field>
          <Field label="Opponents">
            <label className="flex h-9 items-center gap-2 text-sm text-ink cursor-pointer select-none whitespace-nowrap">
              <input
                type="checkbox"
                checked={d1Only}
                onChange={(e) => setD1Only(e.target.checked)}
                className="accent-coral"
              />
              <span title="Games against non-D1 teams count toward a team's official record but are excluded from NET, KenPom and Torvik. Off = include them.">
                D-I only
              </span>
            </label>
          </Field>
          <div className="col-span-2 text-xs text-ink-muted sm:col-span-1 sm:ml-auto">
            {loading
              ? `Loading game logs…`
              : games.length > 0
              ? `${games.length.toLocaleString()} game records loaded`
              : loadErr
              ? `Game-log data not exported yet — run sync + re-export`
              : ""}
          </div>
        </div>

        <div className="p-4 lg:p-5 space-y-2">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs uppercase tracking-widest text-ink-muted font-medium">Conditions</span>
            <span className="hidden sm:inline text-xs text-ink-muted">(all must be true; perspective = the team in the row)</span>
          </div>

          {filters.map((f, i) => (
            <div key={f.id} className="flex items-center gap-3 flex-nowrap">
              <span className="text-sm text-ink-muted w-10 shrink-0">{i === 0 ? "Where" : "And"}</span>
              <SearchableSelect
                value={f.stat as string}
                options={statOptions}
                groupLabels={statGroupLabels}
                onChange={(v) => patchFilter(f.id, { stat: v as keyof GameLog })}
                placeholder="Type a stat…"
                className="flex-1 min-w-0 sm:flex-initial sm:min-w-44"
                ariaLabel="Filter stat"
              />
              <Select value={f.op} onChange={(v) => patchFilter(f.id, { op: v as Op })} className="w-16 shrink-0 ml-1 sm:ml-0">
                {OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
              <input
                type="number"
                step="any"
                value={f.value}
                onChange={(e) => patchFilter(f.id, { value: Number(e.target.value) })}
                className="h-9 w-14 sm:w-28 px-2 rounded border border-hairline bg-card text-ink text-sm focus:outline-none focus:ring-2 focus:ring-coral/40 shrink-0"
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

          <div className="flex items-center gap-3 pt-3 border-t border-hairline mt-3">
            <button
              type="button"
              onClick={addFilter}
              disabled={filters.length >= 8}
              className="text-sm font-medium text-coral hover:text-ink disabled:opacity-40"
            >
              + Add condition
            </button>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => { setFilters([makeFilter("tov_diff")]); setConferences([]); setTeams([]); setCoaches([]); setOpponents([]); setVenue("all"); setQuads([]); setD1Only(true); setSubmitted(null); }}
                className="text-sm text-ink-muted hover:text-ink px-3 py-2"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => setSubmitted({ filters: [...filters], conferences: [...conferences], teams: [...teams], coaches: [...coaches], venue, opponents: [...opponents], quads: [...quads], d1Only })}
                disabled={loading || games.length === 0}
                className="text-sm font-medium bg-coral text-white px-5 py-2 rounded hover:bg-coral-soft disabled:opacity-40 transition-colors"
              >
                Calculate
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Results */}
      {submitted && results && (
        <div className="bg-paper-deep/25 border border-hairline rounded-xl shadow-sm overflow-hidden">
          <div className="p-4 sm:p-6 lg:p-8 grid grid-cols-3 md:grid-cols-3 gap-3 sm:gap-6 border-b border-hairline">
            <div>
              <div className="text-[0.6rem] sm:text-xs uppercase tracking-widest text-ink-muted font-medium mb-1 sm:mb-2">Win %</div>
              <div className="font-display text-2xl sm:text-5xl lg:text-7xl whitespace-nowrap text-coral tabular leading-none">
                {(results.winPct * 100).toFixed(1)}<span className="text-sm sm:text-2xl lg:text-3xl text-coral/80">%</span>
              </div>
              <div className="hidden sm:block mt-3 text-sm text-ink-muted">
                across {results.total.toLocaleString()} games
              </div>
            </div>
            <div>
              <div className="text-[0.6rem] sm:text-xs uppercase tracking-widest text-ink-muted font-medium mb-1 sm:mb-2">Record</div>
              <div className="font-display text-2xl sm:text-5xl lg:text-7xl whitespace-nowrap text-ink tabular leading-none">
                {results.wins}-{results.losses}
              </div>
              {results.total === 0 && (
                <div className="mt-3 text-sm text-ink-muted">
                  No games matched these conditions.
                </div>
              )}
            </div>
            <div>
              <div className="text-[0.6rem] sm:text-xs uppercase tracking-widest text-ink-muted font-medium mb-1 sm:mb-2">Avg margin</div>
              <div
                className={
                  "font-display text-2xl sm:text-5xl lg:text-7xl whitespace-nowrap tabular leading-none " +
                  (results.avgMargin === null
                    ? "text-ink-muted"
                    : results.avgMargin > 0
                    ? "text-coral"
                    : "text-ink")
                }
              >
                {results.avgMargin === null
                  ? "—"
                  : (results.avgMargin > 0 ? "+" : "") + results.avgMargin.toFixed(1)}
              </div>
              {results.avgMargin === null && (
                <div className="mt-3 text-sm text-ink-muted">
                  no margin data
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="px-4 lg:px-5 py-3 border-b border-hairline flex items-center flex-wrap gap-2">
              <span className="text-xs uppercase tracking-widest text-ink-muted font-medium mr-1">
                Conditions
              </span>
              {/* Conference chip — hidden when "all" (length 0 OR every
                  option selected) because both states mean "no filter". */}
              {submitted.conferences.length > 0 && submitted.conferences.length < conferenceOptions.length && (
                <ConditionChip>
                  Conference in [{submitted.conferences.map((c) => confDisplay(c)).join(", ")}]
                </ConditionChip>
              )}
              {/* Same all-vs-some treatment for Team. */}
              {submitted.teams.length > 0 && submitted.teams.length < teamOptions.length && (
                <ConditionChip>
                  Team in [{submitted.teams.join(", ")}]
                </ConditionChip>
              )}
              {/* Same all-vs-some treatment for Coach. */}
              {submitted.coaches.length > 0 && submitted.coaches.length < coachOptions.length && (
                <ConditionChip>
                  Coach in [{submitted.coaches.join(", ")}]
                </ConditionChip>
              )}
              {submitted.filters.map((f) => (
                <ConditionChip key={f.id}>{labelFor(f)}</ConditionChip>
              ))}
            </div>

            {results.matching.length > 0 && (
              <>
                <div className="px-4 lg:px-5 py-3 border-b border-hairline flex items-center gap-3 flex-wrap">
                  <div className="flex items-baseline gap-3 flex-wrap">
                    <span className="text-xs uppercase tracking-widest text-ink-muted font-medium">
                      Matching games
                    </span>
                    <span className="text-xs text-ink-muted tabular">
                      {hasResultFilter
                        ? visibleSample.filteredTotal === 0
                          ? "No matches"
                          : `Showing ${Math.min(visibleSample.filteredTotal, MAX_VISIBLE).toLocaleString()} of ${visibleSample.filteredTotal.toLocaleString()} filtered`
                        : `Showing ${Math.min(results.matching.length, MAX_VISIBLE).toLocaleString()} of ${results.matching.length.toLocaleString()}`}
                    </span>
                  </div>
                  <div className="w-full grid grid-cols-2 gap-3 sm:w-auto sm:ml-auto sm:flex sm:items-center sm:gap-6 sm:flex-wrap">
                    {/* Year picker — typeable single-select, dropdown lists every
                        year present in the matching set newest-first plus an
                        "All years" reset row at the top. */}
                    <SearchableSelect
                      value={dateFilter}
                      options={yearOptions}
                      onChange={setDateFilter}
                      placeholder="All years"
                      className="w-full sm:w-24"
                      ariaLabel="Year filter"
                    />
                    {/* Team search */}
                    <div className="relative w-full sm:w-auto">
                      <svg
                        aria-hidden
                        viewBox="0 0 24 24"
                        className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted pointer-events-none"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <circle cx={11} cy={11} r={7} />
                        <line x1={20} y1={20} x2={16.65} y2={16.65} />
                      </svg>
                      <input
                        type="search"
                        value={teamFilter}
                        onChange={(e) => setTeamFilter(e.target.value)}
                        placeholder="Search team…"
                        aria-label="Search matching games by team"
                        className="h-9 w-full sm:w-60 pl-9 pr-8 rounded-md border border-ink/15 bg-card text-ink text-sm placeholder:text-ink-muted shadow-sm hover:border-ink/25 focus:outline-none focus:ring-2 focus:ring-coral/40 focus:border-coral/40 transition-colors"
                      />
                      {teamFilter && (
                        <button
                          type="button"
                          onClick={() => setTeamFilter("")}
                          aria-label="Clear team search"
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-muted hover:text-coral text-base leading-none w-5 h-5 inline-flex items-center justify-center rounded hover:bg-paper-deep"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                {visibleSample.rows.length === 0 ? (
                  <div className="px-4 lg:px-5 py-10 text-center text-sm text-ink-muted">
                    No games match the current filters.
                    {hasResultFilter && (
                      <>
                        {" "}
                        <button
                          type="button"
                          onClick={() => { setDateFilter(""); setTeamFilter(""); }}
                          className="text-coral hover:text-ink underline decoration-dotted underline-offset-4"
                        >
                          Clear filters
                        </button>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-hairline text-left">
                        <tr>
                          <Th>Date</Th><Th>Team</Th><Th>Opp</Th><Th>Result</Th>
                          {submitted.filters.map((f) => (
                            <Th key={f.id} align="right">{CALC_STAT_OPTIONS.find((s) => s.key === f.stat)?.label ?? String(f.stat)}</Th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {visibleSample.rows.map((g) => (
                          <tr key={g.cbba_game_id + "-" + g.team_id} className="border-b border-hairline/60">
                            <Td className="text-ink-muted tabular whitespace-nowrap">{fmtGameDate(g.game_date)}</Td>
                            <Td>
                              <span className="inline-flex items-center gap-2">
                                <TeamLogo name={g.team_name} size={20} />
                                <span className="hidden sm:inline font-medium text-ink">{g.team_name}</span>
                              </span>
                            </Td>
                            <Td className="text-ink-soft">
                              {g.opp_team_market ? (
                                <span className="inline-flex items-center gap-2">
                                  <span className="hidden sm:inline text-ink-muted">vs</span>
                                  <TeamLogo name={g.opp_team_market} size={20} />
                                  <span className="hidden sm:inline">{g.opp_team_market}</span>
                                </span>
                              ) : (
                                "—"
                              )}
                            </Td>
                            <Td className={g.won ? "text-coral font-medium" : "text-ink-muted"}>
                              {g.won ? "W" : "L"} {g.pts_scored ?? "—"}-{g.pts_against ?? "—"}
                            </Td>
                            {submitted.filters.map((f) => (
                              <Td key={f.id} align="right" className="tabular">
                                {formatStat(g[f.stat] ?? null, f.stat as string)}
                              </Td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {!submitted && games.length === 0 && !loading && (
        <div className="bg-paper-deep/25 border border-hairline rounded-xl shadow-sm p-10 text-center text-ink-muted">
          <p>Game-log data isn&apos;t exported yet for the selected season(s).</p>
          <p className="mt-2 text-xs">
            Run migrations 003 + 004, <code className="bg-paper-deep px-1 rounded">npm run sync:cbb-game-logs</code>,
            then <code className="bg-paper-deep px-1 rounded">npm run export:data &amp;&amp; npm run build</code>.
          </p>
        </div>
      )}
    </div>
  );
}

// ISO "YYYY-MM-DD" → "MM/DD/YY". String-based to avoid timezone shifts.
function fmtGameDate(iso: string | null): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[2]}/${m[3]}/${m[1]!.slice(2)}`;
}

// Format a game-log stat value for display. Percentages → "55.5%", diff stats
// → signed integers ("+8" / "-5"), pace/poss → 1 decimal, anything else → 1 decimal.
function formatStat(v: number | string | boolean | null, key: string): string {
  if (typeof v !== "number") return "—";
  if (key.endsWith("_pct")) return (v * 100).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "%";
  if (key.endsWith("_diff")) return v > 0 ? `+${v}` : String(v);
  if (key === "poss" || key === "pace") return v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return v.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function labelFor(f: Filter): string {
  const stat = CALC_STAT_OPTIONS.find((s) => s.key === f.stat)?.label ?? String(f.stat);
  const op = OPS.find((o) => o.value === f.op)?.label ?? f.op;
  return `${stat} ${op} ${f.value}`;
}

function ConditionChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded border border-hairline bg-paper-deep/60 text-xs text-ink-soft tabular">
      {children}
    </span>
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
function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th className={`px-3 py-2 text-xs uppercase tracking-widest text-ink-muted font-medium ${align === "right" ? "text-right" : ""}`}>{children}</th>;
}
function Td({ children, align = "left", className = "" }: { children: React.ReactNode; align?: "left" | "right"; className?: string }) {
  return <td className={`px-3 py-2.5 ${align === "right" ? "text-right" : ""} ${className}`}>{children}</td>;
}
