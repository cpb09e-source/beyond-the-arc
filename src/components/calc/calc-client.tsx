"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { TeamLogo } from "@/components/team-logo";
import {
  GameBoxModal,
  fmtGameDate,
  RankBadge,
  SeedBadge,
  Th,
  Td,
} from "@/components/box/game-box-modal";
import { AskStatus } from "@/components/calc/ask-status";
import { useEntitlement } from "@/lib/use-entitlement";
import { type SearchableOption } from "@/components/explorer/searchable-select";
import { Select } from "@/components/select";
import {
  ConditionSheet,
  FLAG_KEYS,
  isPctKey,
  defaultValueFor,
  cleanLabel,
} from "@/components/filters/condition-sheet";
import { confDisplay, CONF_DISPLAY } from "@/lib/conf-display";
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
import { isExhibitionGame, ALL_SEASONS, SEASON_CEIL } from "@/lib/seasons";
import { resolveQuery, searchKeysFor, normName, type ParsedQuery, type ResolvedQuery } from "@/lib/query-parse";
import { attachGameBox, type GameBoxFile } from "@/lib/game-box";
import {
  quadFor,
  ratingKey,
  normTeamKey,
  gameKey,
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
 * Static conference list. This used to derive from loaded games, which made
 * the pill grid visibly reflow as season files streamed in ("All seasons"
 * finished loading and the Pac-12 shoved everything sideways). CONF_DISPLAY
 * is the app's master code list; GWC is dropped because it folded before our
 * 2014 data floor, so it could only ever be a dead option.
 *
 * Power conferences lead, in their own order — they're what most questions
 * are about — and get a subtly heavier pill.
 */
const POWER_CONFS = ["ACC", "B10", "B12", "BE", "SEC", "P12"];
const CONFERENCE_OPTIONS: SearchableOption[] = (() => {
  const rest = Object.keys(CONF_DISPLAY)
    .filter((c) => c !== "GWC" && !POWER_CONFS.includes(c))
    .sort((a, b) => a.localeCompare(b));
  return [...POWER_CONFS, ...rest].map((c) => ({ value: c, label: confDisplay(c) }));
})();

/* ------------------------------------------------------------------
 * Stat-sheet metadata. The conditions builder lays every stat out on a
 * grouped sheet of compact tile rows — engage a tile and it becomes a
 * condition — so every stat needs a display range and every group a hue.
 * ---------------------------------------------------------------- */

/** Format a value the way the stat reads: 40% / +5 / 72.5. */
function fmtCondValue(key: string, v: number): string {
  if (isPctKey(key)) return `${Math.round(v * 1000) / 10}%`;
  if (key.endsWith("_diff") || key.endsWith("_margin")) return v > 0 ? `+${v}` : String(v);
  return String(Math.round(v * 10) / 10);
}

/** "2014-15 → 2025-26 (12)" style summary for the collapsed bar. */
function seasonSummary(years: number[]): string {
  if (years.length === 0) return "No seasons";
  if (years.length === ALL_SEASONS.length) return "All seasons";
  const s = [...years].sort((a, b) => a - b);
  const name = (y: number) => `${y - 1}-${String(y).slice(2)}`;
  if (s.length <= 3) return s.map(name).join(", ");
  return `${name(s[0]!)} → ${name(s[s.length - 1]!)} (${s.length})`;
}

/**
 * Attach opponent rank + quadrant to one season's rows.
 *
 * The opponent is found by pairing rows on the shared numeric prefix of
 * game_id rather than by matching opp_team_market, which is a third name
 * space. A game with no paired row is a non-D1 opponent (~5% of rows) and gets
 * a null rank, which quadFor() maps to Q4 — matching how the committee treats
 * non-D1 games.
 */
function enrichWithQuad(rows: GameLog[], ratings: TeamRatingsFile | null): GameLog[] {
  const rankByTeam = new Map<string, number>();
  if (ratings) for (const t of ratings.teams) rankByTeam.set(normTeamKey(t.team), t.rank_net);

  const byGame = new Map<string, GameLog[]>();
  for (const r of rows) {
    const k = gameKey(r.game_id);
    const arr = byGame.get(k);
    if (arr) arr.push(r);
    else byGame.set(k, [r]);
  }

  return rows.map((r) => {
    const pair = byGame.get(gameKey(r.game_id));
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
  const { paid, signedIn } = useEntitlement();

  /**
   * THE FREE CALCULATOR RUNS ON THIS SEASON. Everything else about it works.
   *
   * Which is the point: the tool is the filter builder, and a reader who can
   * only run it on 2025-26 has still used the actual product on 5,000 real
   * games. What they cannot do is the thing the archive exists for — ask the
   * same question of eleven other seasons at once.
   *
   * CLAMPED AT THE SETTER, not just in the pills. Ask the Calculator writes
   * years directly (a question naming a 2019 coach resolves to 2019), and the
   * All button writes the lot, so gating the pills alone would leave two doors
   * open into a selection the reader is not entitled to.
   */
  const [years, setYearsRaw] = useState<number[]>([2026]);
  const setYears = useCallback<typeof setYearsRaw>((next) => {
    setYearsRaw((prev) => {
      const value = typeof next === "function" ? (next as (p: number[]) => number[])(prev) : next;
      if (paid) return value;
      // Newest first, so "the one season you get" is the most recent one asked
      // for rather than whichever happened to be first in the array.
      const kept = [...value].sort((a, b) => b - a).slice(0, 1);
      return kept.length ? kept : [SEASON_CEIL];
    });
  }, [paid]);
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
  // Natural-language box. `ask` is the textarea, `asking` the in-flight flag,
  // `askResult` the last parse (kept so its analysis / caveats stay on
  // screen while the user reviews the filled-in form before calculating).
  const [ask, setAsk] = useState("");
  const [asking, setAsking] = useState(false);
  const [askErr, setAskErr] = useState<string | null>(null);
  const [askResult, setAskResult] = useState<ResolvedQuery | null>(null);
  // Games against non-D1 opponents count toward a team's official NCAA record
  // but are excluded by every serious rating system (NET, KenPom, Torvik),
  // because a 40-point win over a D3 school tells you nothing. Default to
  // excluding them here; the toggle keeps the official-record view available.
  const [d1Only, setD1Only] = useState(true);
  const [yearData, setYearData] = useState<Record<number, GameLog[]>>({});
  // Active conditions. Starts empty — every stat is visible on the sheet
  // below, so the starting state is "nothing constrained" rather than a demo.
  // At most one condition per stat (the tile IS the condition).
  const [filters, setFilters] = useState<Filter[]>([]);
  const [submitted, setSubmitted] = useState<{ filters: Filter[]; conferences: string[]; teams: string[]; coaches: string[]; venue: Venue; opponents: string[]; quads: string[]; d1Only: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  // Two independent post-result filters. Persist across re-calcs so power
  // users can lock in a team and watch the record shift as they iterate on
  // conditions. dateFilter holds a 4-digit calendar year string (empty = all
  // years). teamFilter is a free-text substring against team_name.
  const [dateFilter, setDateFilter] = useState<string>("");
  const [teamFilter, setTeamFilter] = useState<string>("");
  // Result-table paging. `page` is 0-based and clamped at render (see
  // visibleSample) so a narrowing filter can't strand it past the end.
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  // Builder chrome. `panelOpen` is the scope+conditions panel — Calculate
  // collapses it to a chip summary so the numbers get the screen; "Edit
  // filters" reopens it. `collapsedGroups` folds individual stat-sheet
  // sections (all open by default).
  const [panelOpen, setPanelOpen] = useState(true);
  // Game whose box score is open in the modal (double-click a row / click a
  // score). The opponent's row is looked up at render via the game-id pair.
  const [boxGame, setBoxGame] = useState<GameLog | null>(null);

  // Fetch every selected year that isn't already cached. Parallel fetches.
  useEffect(() => {
    const missing = years.filter((y) => !yearData[y]);
    if (missing.length === 0) return;
    let cancelled = false;
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- the effect IS
       the external system here: it starts a fetch, and this flag is how the
       render learns one is in flight. There is nothing to derive during render
       because the answer does not exist yet. */
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
          // Per-game team box from CBBD (rate stats, ratings, halftime
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

  // Conference options are the static module-level CONFERENCE_OPTIONS — see
  // its comment for why they must not derive from loaded games.
  const conferenceOptions = CONFERENCE_OPTIONS;

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

  // Opponent list — derived from opp_team_market, which is its own name space.
  // Non-D1 opponents are excluded from the PICKER (rows where the game has no
  // paired D1 row, ~400 names of noise); the games themselves stay in results
  // whenever the D-I only toggle is off.
  const opponentOptions = useMemo<SearchableOption[]>(() => {
    const s = new Set<string>();
    for (const g of games) if (g.opp_team_market && !g.non_d1) s.add(g.opp_team_market);
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

  /**
   * Ask the parser to turn a plain-English question into filters, resolve the
   * names it returns against the real option lists, and POPULATE THE FORM.
   *
   * Deliberately does not run the query. A wrong parse that silently returned
   * a win percentage is worse than no feature — the user reviews the filled-in
   * controls (and the "here's what I understood" line) and presses Calculate.
   */
  async function runAsk() {
    const q = ask.trim();
    if (q.length < 3 || asking) return;
    setAsking(true);
    setAskErr(null);
    setAskResult(null);
    try {
      const res = await fetch("/api/parse-query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      const body = await res.json().catch(() => ({}));
      // A 404 here means the route isn't being served at all, which in practice
      // means the page was opened on Next's own port. `netlify dev` runs Next on
      // 3000 AND a proxy on 8899, and only the proxy serves netlify/functions —
      // so :3000 looks like a working site where Ask is mysteriously broken.
      // Name the port; "use dev:netlify" isn't enough when both are listening.
      if (res.status === 404) {
        throw new Error(
          "Ask isn't served on this port. Open http://localhost:8899/calc (npm run dev:netlify) — port 3000 is Next on its own, with no functions. The filters below work either way.",
        );
      }
      if (!res.ok) throw new Error(body?.error || `Parser error (${res.status})`);

      const resolved = resolveQuery(body as ParsedQuery, {
        coaches: allCoaches,
        teams: allTeams,
        opponents: opponentOptions.map((o) => o.value),
        conferences: conferenceOptions.map((o) => ({ value: o.value, label: o.label })),
        validStats: new Set(CALC_STAT_OPTIONS.map((o) => o.key as string)),
        validSeasons: [...ALL_SEASONS],
      });

      // Seasons are the one dimension we must NOT leave alone when the question
      // didn't name one. The parser documents an empty list as "all seasons",
      // but the form defaults to the current season, so "what's Roy Williams'
      // record on the road" silently answered "...in 2025-26" — and he retired
      // in 2021. That renders as a confident 0-0, which reads as "never
      // happened" rather than "wrong years selected".
      //
      // So an unspecified season means every season, matching what the parser
      // already promises. This is deliberately universal rather than a
      // coach-shaped special case: a coach, a team, a conference or no subject
      // at all each get the full history unless the question names a year, and
      // a named year always wins.
      // Every dimension is resolved to its NEXT value first, then used for both
      // the form state and the auto-submit below. Reading the state variables
      // back after setX() would submit the PREVIOUS question's values — React
      // hasn't applied them yet at this point in the handler.
      const nextYears = resolved.seasons.length
        ? [...resolved.seasons].sort((a, b) => b - a)
        : [...ALL_SEASONS].sort((a, b) => b - a);
      // A QUESTION THAT NAMES A SUBJECT STARTS OVER. Anything it doesn't
      // mention is cleared rather than inherited.
      //
      // Dimensions the question didn't speak to used to keep their current
      // value unconditionally, so a follow-up ("...and only at home") could
      // refine instead of resetting. That is right for a follow-up and wrong
      // for a new question, and nothing told the two apart: asking about Bill
      // Self and then asking about Purdue kept Bill Self, so the second answer
      // was Purdue games coached by Bill Self — a coach who has never coached
      // there. Nought games, 0.0%, no error. The venue rode along the same way.
      //
      // Naming a team, coach, conference or opponent is the signal that the
      // subject has changed and the previous question is over. Ask something
      // with no subject at all ("...and only in Quad 1") and every carry-over
      // still applies, so refining a question keeps working.
      //
      // Same disease the seasons rule above already treats, and the same cure:
      // trust what the parser resolved rather than quietly widening it. The
      // cost is that "what about Purdue" drops the conditions from the previous
      // question — visible in the chips, and recoverable, where inheriting a
      // stale coach was neither.
      const namesSubject =
        resolved.resolved.teams.length > 0 ||
        resolved.resolved.coaches.length > 0 ||
        resolved.resolved.conferences.length > 0 ||
        resolved.resolved.opponents.length > 0;
      /** The parser's value, else the current one — unless the subject changed. */
      const keep = <T,>(next: T[], current: T[]): T[] =>
        next.length ? next : namesSubject ? [] : current;

      const nextConferences = keep(resolved.resolved.conferences, conferences);
      const nextTeams = keep(resolved.resolved.teams, teams);
      const nextCoaches = keep(resolved.resolved.coaches, coaches);
      const nextOpponents = keep(resolved.resolved.opponents, opponents);
      const nextQuads = keep(resolved.quads.map(String), quads);
      const nextVenue = resolved.venue !== "all" ? resolved.venue : namesSubject ? "all" : venue;
      const nextFilters = resolved.conditions.length
        ? resolved.conditions.slice(0, 8).map((c) => ({
            ...makeFilter(c.stat as keyof GameLog),
            op: c.op,
            value: c.value,
          }))
        : namesSubject
        ? []
        : filters;

      setYears(nextYears);
      setConferences(nextConferences);
      setTeams(nextTeams);
      setCoaches(nextCoaches);
      setOpponents(nextOpponents);
      setQuads(nextQuads);
      setVenue(nextVenue);
      setFilters(nextFilters);
      setAskResult(resolved);

      // Auto-calculate. Asking a question and then having to press a second
      // button read as an unfinished thought. Safe to submit before the season
      // files finish downloading: the results memo returns null until the games
      // for the selected years are in, so this renders the loading state and
      // then the answer, rather than a wrong answer computed against half the
      // data. The filled-in filters stay editable, and any caveat from the
      // parse (unmatched name, no condition found) sits directly above.
      setSubmitted({
        filters: nextFilters,
        conferences: nextConferences,
        teams: nextTeams,
        coaches: nextCoaches,
        venue: nextVenue,
        opponents: nextOpponents,
        quads: nextQuads,
        d1Only,
      });
      // Same fold as pressing Calculate — the answer takes the screen, the
      // parse summary above explains what was understood, Edit reopens.
      setPanelOpen(false);
    } catch (e) {
      setAskErr(e instanceof Error ? e.message : "Could not parse that question.");
    } finally {
      setAsking(false);
    }
  }

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

  // Visible-rows derivation — applies both filters, then pages. Only one page
  // of rows ever reaches the DOM, so a 50k-game result set stays cheap.
  const visibleSample = useMemo(() => {
    if (!results) return { rows: [] as GameLog[], filteredTotal: 0, pageCount: 1, safePage: 0 };
    const teamQ = teamFilter.trim().toLowerCase();
    const filtered = results.matching.filter((g) => {
      if (dateFilter) {
        if (!g.game_date || g.game_date.slice(0, 4) !== dateFilter) return false;
      }
      if (teamQ && !g.team_name.toLowerCase().includes(teamQ)) return false;
      return true;
    });
    // Clamp BEFORE slicing. Tightening a filter while deep in the results
    // otherwise leaves `page` past the end and renders a blank table, which
    // reads as "no matches" rather than "you're past the last page".
    const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
    const safePage = Math.min(page, pageCount - 1);
    const start = safePage * pageSize;
    return {
      rows: filtered.slice(start, start + pageSize),
      filteredTotal: filtered.length,
      pageCount,
      safePage,
    };
  }, [results, dateFilter, teamFilter, page, pageSize]);
  const hasResultFilter = dateFilter !== "" || teamFilter.trim() !== "";
  const { pageCount, safePage } = visibleSample;
  const rangeStart = visibleSample.filteredTotal === 0 ? 0 : safePage * pageSize + 1;
  const rangeEnd = Math.min(visibleSample.filteredTotal, (safePage + 1) * pageSize);

  // Active-filter tally for the panel header badge. A section counts when it
  // actually narrows: a full or empty multi-select filters nothing.
  const activeFilterCount =
    (years.length < ALL_SEASONS.length ? 1 : 0) +
    (conferences.length > 0 ? 1 : 0) +
    (teams.length > 0 ? 1 : 0) +
    (coaches.length > 0 ? 1 : 0) +
    (opponents.length > 0 ? 1 : 0) +
    (venue !== "all" ? 1 : 0) +
    (quads.length > 0 && quads.length < 4 ? 1 : 0) +
    (d1Only ? 1 : 0) + // counted when lit, matching the section badge
    
    filters.length;

  /** Snapshot the current form and run it. Shared by the top and bottom
   *  Calculate buttons so they can never drift apart. */
  function calculate() {
    setSubmitted({ filters: [...filters], conferences: [...conferences], teams: [...teams], coaches: [...coaches], venue, opponents: [...opponents], quads: [...quads], d1Only });
    setPanelOpen(false);
    setPage(0); // a new question starts at the first page of its answer
  }

  /** "Clear All": no scope filters, no conditions, no stale results. */
  function clearAll() {
    setYears([...ALL_SEASONS]);
    setConferences([]);
    setTeams([]);
    setCoaches([]);
    setOpponents([]);
    setVenue("all");
    setQuads([]);
    setD1Only(true);
    setFilters([]);
    setSubmitted(null);
  }

  /**
   * Engage a stat tile — patch its condition if live, otherwise bring it to
   * life with sensible defaults merged with whatever the interaction set.
   * Comparator direction comes from CALC_STAT_OPTIONS (not makeFilter, whose
   * lookup misses the calc-only stats like opp_rank); flags are forced to
   * their only sensible shape, "= Yes".
   */
  function tilePatch(stat: keyof GameLog, patch: Partial<Filter>) {
    setFilters((fs) => {
      const existing = fs.find((f) => f.stat === stat);
      if (existing) return fs.map((f) => (f.stat === stat ? { ...f, ...patch } : f));
      const key = stat as string;
      const def = CALC_STAT_OPTIONS.find((s) => s.key === stat);
      return [
        ...fs,
        {
          ...makeFilter(stat),
          op: FLAG_KEYS.has(key) ? ("eq" as Op) : def?.defaultDir === "lt" ? ("lt" as Op) : ("gt" as Op),
          value: defaultValueFor(key),
          ...patch,
        },
      ];
    });
  }
  function tileClear(stat: keyof GameLog) {
    setFilters((fs) => fs.filter((f) => f.stat !== stat));
  }

  return (
    <div className="space-y-6">
      {/* Natural-language entry. Fills the form below; never runs the query
          itself — the user reviews and presses Calculate. */}
      <div className="bg-paper-deep/25 border border-hairline rounded-xl shadow-sm p-4 lg:p-5">
        {/* Named, because the pricing page sells it by name. A reader who buys
            "Ask the Calculator" and lands on a box labelled something else has
            to work out for themselves that they are the same feature. */}
        <label htmlFor="calc-ask" className="block mb-2">
          <span className="text-xs uppercase tracking-widest text-ink font-semibold">
            Ask the Calculator
          </span>
          <span className="text-xs text-ink-muted"> — in plain English</span>
        </label>
        {!paid ? (
          /* The EXAMPLE QUESTION is the pitch, so it stays on screen rather
             than being replaced by the word "locked". A reader who has never
             seen this feature has no idea what it does; the placeholder is
             the clearest single sentence explaining it, so it becomes the
             body copy instead of being thrown away with the input. */
          <div className="rounded border border-dashed border-hairline bg-card/60 p-3">
            <p className="text-sm text-ink-soft leading-snug">
              <span className="text-ink-muted">Ask things like </span>
              “Roy Williams games where UNC had more fast break points and shot
              more 3s than their opponent” — and the filters below fill
              themselves in.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Link
                href="/pricing"
                className="inline-flex items-center gap-1.5 rounded-md bg-coral px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-coral-soft"
              >
                <Lock size={12} strokeWidth={2.5} aria-hidden />
                See plans
              </Link>
              {!signedIn && (
                <Link
                  href="/account/login"
                  className="text-xs text-ink-muted transition-colors hover:text-coral"
                >
                  Already a member? Sign in
                </Link>
              )}
            </div>
          </div>
        ) : (
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            id="calc-ask"
            type="text"
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); runAsk(); } }}
            /* The INPUT stays at text-base on phones on purpose: iOS Safari
               zooms the whole page when a focused field is under 16px. Only the
               placeholder shrinks, which iOS does not measure — so more of the
               example fits without the page jumping on tap. */
            placeholder="Roy Williams games where UNC had more fast break points and shot more 3s than their opponent"
            className="flex-1 min-w-0 h-10 px-3 rounded border border-hairline bg-card text-ink text-base sm:text-sm placeholder:text-ink-muted/70 placeholder:text-xs sm:placeholder:text-sm focus:outline-none focus:ring-2 focus:ring-coral/40"
          />
          <button
            type="button"
            onClick={runAsk}
            disabled={asking || ask.trim().length < 3}
            className="h-10 shrink-0 text-sm font-medium bg-ink text-paper px-5 rounded hover:bg-ink/85 disabled:opacity-40 transition-colors inline-flex items-center justify-center gap-2"
          >
            {/* No spinner in here any more. The status orb below is the one
                moving thing while a parse runs, and two indicators for one wait
                read as two waits. */}
            {asking ? "Reading…" : "Fill filters"}
          </button>
        </div>
        )}

        {/* Sits in the slot the result line will occupy, so the panel does not
            jump when the parse lands. */}
        {asking && <AskStatus />}

        {askErr && <p className="mt-2 text-sm text-coral">{askErr}</p>}

        {askResult && (
          <div className="mt-3 text-sm space-y-1">
            <p className="text-ink">
              <span className="text-ink-muted">Understood:</span> {askResult.analysis}
            </p>
            {askResult.notes.length > 0 && (
              <p className="text-ink-muted">
                Judgement call{askResult.notes.length > 1 ? "s" : ""}: {askResult.notes.join(" · ")}
              </p>
            )}
            {askResult.unresolved.length > 0 && (
              <p className="text-coral">
                Couldn&apos;t match: {askResult.unresolved.join(", ")} — set {askResult.unresolved.length > 1 ? "those" : "that"} manually.
              </p>
            )}
            {/* A parse with no conditions is the quietest way this can be
                wrong: the form still fills in the team and seasons, Calculate
                still returns a number, and that number is the team's overall
                record rather than the answer to what was asked. Rare, but it
                reads as a confident answer, so say so outright. */}
            {askResult.conditions.length === 0 && (
              <p className="text-coral">
                No statistical condition was picked up, so this would return the overall record. Add one below, or rephrase as e.g. &ldquo;games where they shot over 40% from three&rdquo;.
              </p>
            )}
            <p className="text-ink-muted">Calculated below — adjust any filter and re-run to refine.</p>
          </div>
        )}
      </div>

      {/* Scope + conditions. After Calculate the whole panel folds into the
          chip summary below — the answer is the point, the machinery isn't —
          and "Edit filters" unfolds it. The fold is a grid-rows transition
          (1fr → 0fr), which animates height without measuring anything. */}
      <div className="bg-paper-deep/25 border border-hairline rounded-xl shadow-sm overflow-hidden">
        {!panelOpen && (
          <div className="bta-pop-in flex flex-wrap items-center gap-2 p-4 lg:px-5">
            <span className="text-xs uppercase tracking-widest text-ink font-bold mr-1">
              Filters
            </span>
            <ConditionChip>{seasonSummary(years)}</ConditionChip>
            {submitted && submitted.conferences.length > 0 && submitted.conferences.length < conferenceOptions.length && (
              <ConditionChip>{submitted.conferences.map((c) => confDisplay(c)).join(", ")}</ConditionChip>
            )}
            {submitted && submitted.teams.length > 0 && submitted.teams.length < teamOptions.length && (
              <ConditionChip>{submitted.teams.join(", ")}</ConditionChip>
            )}
            {submitted && submitted.coaches.length > 0 && (
              <ConditionChip>{submitted.coaches.join(", ")}</ConditionChip>
            )}
            {submitted && submitted.opponents.length > 0 && (
              <ConditionChip>vs {submitted.opponents.join(", ")}</ConditionChip>
            )}
            {submitted && submitted.venue !== "all" && (
              <ConditionChip>{VENUE_OPTIONS.find((v) => v.value === submitted.venue)?.label}</ConditionChip>
            )}
            {submitted && submitted.quads.length > 0 && submitted.quads.length < 4 && (
              <ConditionChip>Quad {submitted.quads.join("/")}</ConditionChip>
            )}
            {submitted?.filters.map((f) => (
              <ConditionChip key={f.id}>{labelFor(f)}</ConditionChip>
            ))}
            {loading && <span className="text-xs text-ink-muted">Loading game logs…</span>}
            <button
              type="button"
              onClick={() => setPanelOpen(true)}
              className="ml-auto shrink-0 text-sm font-medium text-coral border border-coral/40 rounded px-4 py-1.5 hover:bg-coral hover:text-white transition-colors"
            >
              Edit filters
            </button>
          </div>
        )}
        <div
          className={`grid transition-[grid-template-rows] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
            panelOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          }`}
        >
        <div className="min-h-0 overflow-hidden">
        <div className="p-4 lg:p-5 border-b border-hairline space-y-5">
          {/* Panel header — mirrors the D&3 filter drawer: name, live count of
              active filters, one Clear all. The records-loaded note earns the
              right edge so data problems stay visible. */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="font-medium text-ink">Filter games</span>
            {activeFilterCount > 0 && <CountBadge n={activeFilterCount} />}
            <MiniButton onClick={clearAll}>Clear All</MiniButton>
            <span className="ml-auto text-xs text-ink-muted">
              {loading
                ? `Loading game logs…`
                : games.length > 0
                ? `${games.length.toLocaleString()} game records loaded`
                : loadErr
                ? `Game-log data not exported yet — run sync + re-export`
                : ""}
            </span>
            {/* Calculate lives at both ends of the panel — the header copy is
                for people who came back to tweak one pill and shouldn't have
                to scroll past the conditions to re-run. */}
            <button
              type="button"
              onClick={calculate}
              disabled={loading || games.length === 0}
              className="text-sm font-medium bg-coral text-white px-5 py-2 rounded-lg shadow-sm hover:bg-coral-soft hover:shadow-md active:scale-[0.98] disabled:opacity-40 transition-all"
            >
              Calculate
            </button>
          </div>

          <div>
            <SectionLabel
              count={years.length < ALL_SEASONS.length ? years.length : 0}
              action={
                paid ? (
                  <>
                    <MiniButton onClick={() => setYears([...ALL_SEASONS])}>All</MiniButton>
                    {/* Seasons can't be empty (no seasons = no games to load),
                        so Clear returns to the default: the current season. */}
                    <MiniButton onClick={() => setYears([SEASON_CEIL])}>Clear</MiniButton>
                  </>
                ) : (
                  <Link
                    href="/pricing"
                    className="inline-flex items-center gap-1 text-[0.65rem] font-bold uppercase tracking-widest text-coral hover:underline"
                  >
                    <Lock size={10} strokeWidth={3} aria-hidden />
                    All seasons
                  </Link>
                )
              }
            >
              Seasons
            </SectionLabel>
            <div className="flex flex-wrap gap-1.5">
              {ALL_SEASONS.map((y) => {
                // Older seasons stay VISIBLE and dead rather than being removed
                // from the grid. A reader has to be able to see that eleven
                // more seasons exist — a pill list that silently contained one
                // entry would read as a site with one season of data.
                const locked = !paid && y !== SEASON_CEIL;
                if (locked) {
                  return (
                    <span
                      key={y}
                      title={`${String(y - 1).slice(2)}-${String(y).slice(2)} is part of the Season Pass`}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-dashed border-hairline text-xs text-ink-muted/60 cursor-default select-none tabular"
                    >
                      {`${String(y - 1).slice(2)}-${String(y).slice(2)}`}
                      <Lock size={9} strokeWidth={3} className="text-coral/60" aria-hidden />
                    </span>
                  );
                }
                return (
                  <TogglePill
                    key={y}
                    active={years.includes(y)}
                    onClick={() =>
                      setYears((prev) =>
                        prev.includes(y)
                          // Never allow an empty selection — deselecting the last
                          // season means "stop filtering", i.e. all of them.
                          ? prev.length === 1 ? [...ALL_SEASONS] : prev.filter((x) => x !== y)
                          : [...prev, y],
                      )
                    }
                  >
                    {`${String(y - 1).slice(2)}-${String(y).slice(2)}`}
                  </TogglePill>
                );
              })}
            </div>
            {!paid && (
              <p className="mt-2 text-xs text-ink-muted leading-snug">
                The calculator runs on this season for free.{" "}
                <Link href="/pricing" className="text-coral hover:underline font-medium">
                  A Season Pass
                </Link>{" "}
                asks the same question of all thirteen at once.
              </p>
            )}
          </div>

          <div>
            <SectionLabel
              count={conferences.length}
              action={
                <>
                  <MiniButton onClick={() => setConferences(conferenceOptions.map((c) => c.value))}>All</MiniButton>
                  <MiniButton onClick={() => setConferences([])}>Clear</MiniButton>
                </>
              }
            >
              Conferences
            </SectionLabel>
            {(() => {
              // One handler for both grids so the power/rest split stays
              // purely presentational.
              const toggleConf = (code: string) => {
                const next = conferences.includes(code)
                  ? conferences.filter((x) => x !== code)
                  : [...conferences, code];
                setConferences(next);
                // Drop any selected team that's no longer in the narrowed
                // conference set, so a hidden chip can't silently constrain
                // the calc. Skipped when nothing narrows.
                if (next.length > 0 && next.length < conferenceOptions.length) {
                  const confSet = new Set(next);
                  setTeams((prev) =>
                    prev.filter((t) => {
                      const g = games.find((x) => x.team_name === t);
                      return g?.team_conference != null && confSet.has(g.team_conference);
                    }),
                  );
                }
              };
              const power = conferenceOptions.filter((c) => POWER_CONFS.includes(c.value));
              const rest = conferenceOptions.filter((c) => !POWER_CONFS.includes(c.value));
              const pill = (c: SearchableOption) => (
                <TogglePill
                  key={c.value}
                  active={conferences.includes(c.value)}
                  title={c.label}
                  className="w-full px-1 text-center"
                  emphasis={POWER_CONFS.includes(c.value)}
                  onClick={() => toggleConf(c.value)}
                >
                  {c.value}
                </TogglePill>
              );
              return (
                <div className="space-y-2">
                  {/* Power conferences get their own bordered plate — they
                      answer most questions, so they're worth finding without
                      reading all 31 codes. */}
                  <div className="inline-block rounded-lg border border-ink/15 bg-paper-deep/30 p-2 pt-1.5">
                    <div className="text-[0.6rem] uppercase tracking-widest text-ink-muted font-semibold mb-1.5">
                      Power Conferences
                    </div>
                    <div className="grid gap-1.5 grid-cols-3 sm:grid-cols-6">{power.map(pill)}</div>
                  </div>
                  {/* Column count derived from the list length so the rows stay
                      near-even and never leave a one-pill orphan row. */}
                  <div
                    className="grid gap-1.5 grid-cols-5 sm:grid-cols-6 lg:grid-cols-[repeat(var(--cc3),minmax(0,1fr))] xl:grid-cols-[repeat(var(--cc2),minmax(0,1fr))]"
                    style={{
                      "--cc2": Math.ceil(rest.length / 2),
                      "--cc3": Math.ceil(rest.length / 3),
                    } as React.CSSProperties}
                  >
                    {rest.map(pill)}
                  </div>
                </div>
              );
            })()}
          </div>

          <div className="flex flex-wrap gap-x-10 gap-y-5">
            <div>
              <SectionLabel count={venue !== "all" ? 1 : 0}>Venue</SectionLabel>
              <div className="flex flex-wrap gap-1.5">
                {VENUE_OPTIONS.filter((o) => o.value !== "all").map((o) => (
                  <TogglePill
                    key={o.value}
                    active={venue === o.value}
                    // Single-select with an off state: tapping the lit pill
                    // returns to "all venues".
                    onClick={() => setVenue(venue === o.value ? "all" : o.value)}
                  >
                    {o.label}
                  </TogglePill>
                ))}
              </div>
            </div>
            <div>
              <SectionLabel count={quads.length > 0 && quads.length < 4 ? quads.length : 0}>Quad</SectionLabel>
              <div className="flex flex-wrap gap-1.5">
                {QUAD_OPTIONS.map((o) => (
                  <TogglePill
                    key={o.value}
                    active={quads.includes(o.value)}
                    onClick={() =>
                      setQuads((prev) => (prev.includes(o.value) ? prev.filter((x) => x !== o.value) : [...prev, o.value]))
                    }
                  >
                    {o.label.replace("Quad ", "Q")}
                  </TogglePill>
                ))}
              </div>
            </div>
            <div>
              {/* Badge tracks the lit pill, not "deviates from default" — the
                  user reads the marble as "this section has a selection". */}
              <SectionLabel count={d1Only ? 1 : 0}>Opponents</SectionLabel>
              <TogglePill
                active={d1Only}
                title="Games against non-D1 teams count toward a team's official record but are excluded from NET, KenPom and Torvik. Off = include them."
                onClick={() => setD1Only(!d1Only)}
              >
                D-I only
              </TogglePill>
            </div>
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <ChipSearchMulti
              label="Teams"
              values={teams}
              options={allTeams}
              onChange={setTeams}
              placeholder="Type a team, press Enter…"
              allLabel="All Teams"
              icon={(n) => <TeamLogo name={n} size={16} />}
            />
            {/* The coach filter is the one control here with no free
                equivalent anywhere: it resolves a name to the exact seasons
                that coach was at that school, out of coach-history.json. */}
            {paid ? (
              <ChipSearchMulti
                label="Coaches"
                values={coaches}
                options={allCoaches}
                onChange={setCoaches}
                placeholder="Type a coach, press Enter…"
                allLabel="All Coaches"
              />
            ) : (
              <div>
                <div className="text-xs uppercase tracking-widest text-ink-muted font-medium mb-1.5">
                  Coaches
                </div>
                <Link
                  href="/pricing"
                  className="flex items-center gap-2 h-10 px-3 rounded border border-dashed border-hairline bg-paper-deep/25 text-sm text-ink-muted transition-colors hover:border-coral/40 hover:text-ink"
                >
                  <Lock size={13} className="shrink-0 text-coral" aria-hidden />
                  <span className="truncate">
                    Filter by coach — part of the Season Pass
                  </span>
                </Link>
              </div>
            )}
            <ChipSearchMulti
              label="Opponents"
              values={opponents}
              options={opponentOptions.map((o) => o.value)}
              onChange={setOpponents}
              placeholder="Type an opponent, press Enter…"
              allLabel="All Opponents"
              icon={(n) => <TeamLogo name={n} size={16} />}
            />
          </div>
        </div>

        <div className="p-4 lg:p-5">
          <div className="mb-4">
            <SectionLabel
              count={filters.length}
              action={filters.length > 0 ? <MiniButton onClick={() => setFilters([])}>Clear</MiniButton> : null}
            >
              Conditions
            </SectionLabel>
            <span className="hidden sm:block -mt-1 text-xs text-ink-muted">
              Every stat is listed — set the ones that matter. All must be true; perspective = the team in the row.
            </span>
          </div>

          {/* The stat sheet, shared with the team and coach "Find a game"
              modals so the same question is built the same way wherever it
              is asked. See components/filters/condition-sheet.tsx — search,
              grouping, collapse and the tiles themselves all live there. */}
          <ConditionSheet
            options={CALC_STAT_OPTIONS}
            filters={filters}
            onPatch={(key, patch) => tilePatch(key as Filter["stat"], patch)}
            onClear={(key) => tileClear(key as Filter["stat"])}
          />

          <div className="flex items-center gap-3 pt-4 border-t border-hairline mt-5">
            <button
              type="button"
              onClick={calculate}
              disabled={loading || games.length === 0}
              className="ml-auto text-sm font-medium bg-coral text-white px-6 py-2.5 rounded-lg shadow-sm hover:bg-coral-soft hover:shadow-md active:scale-[0.98] disabled:opacity-40 transition-all"
            >
              Calculate
            </button>
          </div>
        </div>
        </div>
        </div>
      </div>

      {/* Results */}
      {submitted && results && (
        <div className="bg-paper-deep/25 border border-hairline rounded-xl shadow-sm overflow-hidden">
          <div className="border-b border-hairline">
            <div className="p-4 sm:p-6 lg:p-8 lg:pb-6 grid grid-cols-3 gap-3 sm:gap-6">
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
                {/* Wins wear the accent; the dash and losses recede. The number
                    reads before the label does. */}
                <div className="font-display text-2xl sm:text-5xl lg:text-7xl whitespace-nowrap tabular leading-none">
                  <span className="text-coral">{results.wins}</span>
                  <span className="text-ink-muted/60">–</span>
                  <span className="text-ink">{results.losses}</span>
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
                <div className="hidden sm:block mt-3 text-sm text-ink-muted">
                  {results.avgMargin === null ? "no margin data" : "per game"}
                </div>
              </div>
            </div>
            {/* The record as a bar — wins vs losses at a glance, and the one
                place the whole result set is visible in a single glyph. */}
            {results.total > 0 && (
              <div className="px-4 sm:px-6 lg:px-8 pb-4 sm:pb-5">
                <div className="h-1.5 rounded-full bg-ink/10 overflow-hidden">
                  <div
                    className="h-full bg-coral rounded-full transition-[width] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
                    style={{ width: `${results.winPct * 100}%` }}
                  />
                </div>
                <div className="mt-1.5 flex justify-between text-[0.65rem] uppercase tracking-widest font-medium">
                  <span className="text-coral">{results.wins.toLocaleString()} {results.wins === 1 ? "win" : "wins"}</span>
                  <span className="text-ink-muted">{results.losses.toLocaleString()} {results.losses === 1 ? "loss" : "losses"}</span>
                </div>
              </div>
            )}
          </div>

          <div>
            <div className="px-4 lg:px-5 py-3 border-b border-hairline flex items-center flex-wrap gap-2">
              <span className="text-xs uppercase tracking-widest text-ink font-bold mr-1">
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
                    <span className="text-xs uppercase tracking-widest text-ink font-bold">
                      Matching games
                    </span>
                    <span className="text-xs text-ink-muted tabular">
                      {visibleSample.filteredTotal === 0
                        ? "No matches"
                        : `${rangeStart.toLocaleString()}–${rangeEnd.toLocaleString()} of ${visibleSample.filteredTotal.toLocaleString()}${hasResultFilter ? " filtered" : ""}`}
                    </span>
                  </div>
                  <div className="w-full grid grid-cols-2 gap-3 sm:w-auto sm:ml-auto sm:flex sm:items-center sm:gap-6 sm:flex-wrap">
                    {/* Year picker — a NATIVE select on purpose. The searchable
                        popover variant opened a wide panel with its own inner
                        search box under this narrow trigger, which read as two
                        scrambled inputs. Thirteen years don't need search. */}
                    <Select
                      value={dateFilter}
                      // Changing what's being filtered starts the paging over —
                      // staying on page 7 of a different result set is noise.
                      onChange={(v) => { setDateFilter(v); setPage(0); }}
                      className="w-full sm:w-28"
                      aria-label="Year filter"
                    >
                      {yearOptions.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </Select>
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
                        onChange={(e) => { setTeamFilter(e.target.value); setPage(0); }}
                        placeholder="Search team…"
                        aria-label="Search matching games by team"
                        className="h-9 w-full sm:w-60 pl-9 pr-8 rounded-md border border-ink/15 bg-card text-ink text-base sm:text-sm placeholder:text-ink-muted shadow-sm hover:border-ink/25 focus:outline-none focus:ring-2 focus:ring-coral/40 focus:border-coral/40 transition-colors placeholder:text-xs sm:placeholder:text-sm"
                      />
                      {teamFilter && (
                        <button
                          type="button"
                          onClick={() => { setTeamFilter(""); setPage(0); }}
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
                          onClick={() => { setDateFilter(""); setTeamFilter(""); setPage(0); }}
                          className="text-coral hover:text-ink underline decoration-dotted underline-offset-4"
                        >
                          Clear filters
                        </button>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="overflow-x-auto overscroll-x-contain">
                    <table className="w-full text-sm">
                      <thead className="border-b border-hairline text-left">
                        <tr>
                          <Th>Date</Th><Th>Team</Th><Th>Opp</Th><Th>Result</Th>
                          {submitted.filters.map((f) => (
                            <Th key={f.id} align="right">{cleanLabel(CALC_STAT_OPTIONS.find((s) => s.key === f.stat)?.label ?? String(f.stat))}</Th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {visibleSample.rows.map((g) => (
                          <tr
                            key={g.game_id + "-" + g.team_id}
                            onDoubleClick={() => setBoxGame(g)}
                            title="Double-click for the box score"
                            className="border-b border-hairline/60 hover:bg-paper-deep/40 transition-colors cursor-pointer select-none"
                          >
                            <Td className="text-ink-muted tabular whitespace-nowrap">{fmtGameDate(g.game_date)}</Td>
                            <Td>
                              <span className="inline-flex items-center gap-2">
                                <TeamLogo name={g.team_name} size={20} />
                                {typeof g.ap_rank === "number" && <RankBadge rank={g.ap_rank} />}
                                {typeof g.seed === "number" && <SeedBadge seed={g.seed} />}
                                <span className="hidden sm:inline font-medium text-ink">{g.team_name}</span>
                              </span>
                            </Td>
                            <Td className="text-ink-soft">
                              {g.opp_team_market ? (
                                <span className="inline-flex items-center gap-2">
                                  {/* Box-score notation as a badge: vs = home,
                                      @ = away, N = neutral. */}
                                  <span
                                    className="hidden sm:inline-flex items-center justify-center w-7 h-5 rounded bg-paper-deep border border-hairline text-[10px] font-semibold uppercase text-ink-soft"
                                    title={g.is_neutral ? "Neutral site" : g.is_home ? "Home" : "Away"}
                                  >
                                    {g.is_neutral ? "N" : g.is_home ? "vs" : "@"}
                                  </span>
                                  <TeamLogo name={g.opp_team_market} size={20} />
                                  {typeof g.opp_ap_rank === "number" && <RankBadge rank={g.opp_ap_rank} />}
                                  {typeof g.opp_seed === "number" && <SeedBadge seed={g.opp_seed} />}
                                  <span className="hidden sm:inline">{g.opp_team_market}</span>
                                  {typeof g.round === "string" && g.round && (
                                    <span className="hidden lg:inline px-1.5 py-0.5 rounded bg-coral/10 border border-coral/25 text-[10px] font-semibold text-coral whitespace-nowrap">
                                      {g.round}
                                    </span>
                                  )}
                                </span>
                              ) : (
                                "—"
                              )}
                            </Td>
                            <Td>
                              <button
                                type="button"
                                onClick={() => setBoxGame(g)}
                                title="Open box score"
                                className="inline-flex items-center gap-2 whitespace-nowrap group/score"
                              >
                                <span
                                  className={`inline-flex items-center justify-center w-5 h-5 rounded text-[11px] font-bold ${
                                    g.won ? "bg-coral text-white" : "bg-ink/10 text-ink-soft"
                                  }`}
                                >
                                  {g.won ? "W" : "L"}
                                </span>
                                <span className="tabular text-ink group-hover/score:text-coral underline decoration-dotted decoration-hairline underline-offset-4 group-hover/score:decoration-coral/60 transition-colors">
                                  {g.pts_scored ?? "—"}-{g.pts_against ?? "—"}
                                </span>
                              </button>
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

                {visibleSample.filteredTotal > 0 && (
                  <div className="px-4 lg:px-5 py-3 border-t border-hairline flex items-center gap-3 flex-wrap">
                    <label className="flex items-center gap-2 text-xs text-ink-muted">
                      <span className="uppercase tracking-widest font-medium">Rows</span>
                      <Select
                        value={String(pageSize)}
                        // Keep the first visible row visible across a size
                        // change: jumping from "row 51" to page 1 loses the
                        // reader's place for no reason.
                        onChange={(v) => {
                          const next = Number(v);
                          const firstRow = safePage * pageSize;
                          setPageSize(next);
                          setPage(Math.floor(firstRow / next));
                        }}
                        className="w-20"
                        aria-label="Rows per page"
                      >
                        {[25, 50, 100].map((n) => (
                          <option key={n} value={String(n)}>{n}</option>
                        ))}
                      </Select>
                    </label>

                    {pageCount > 1 && (
                      <div className="ml-auto flex items-center gap-1">
                        <PagerButton onClick={() => setPage(0)} disabled={safePage === 0} label="First page">«</PagerButton>
                        <PagerButton onClick={() => setPage(safePage - 1)} disabled={safePage === 0} label="Previous page">‹</PagerButton>
                        <span className="px-2 text-xs text-ink-muted tabular whitespace-nowrap">
                          Page {(safePage + 1).toLocaleString()} of {pageCount.toLocaleString()}
                        </span>
                        <PagerButton onClick={() => setPage(safePage + 1)} disabled={safePage >= pageCount - 1} label="Next page">›</PagerButton>
                        <PagerButton onClick={() => setPage(pageCount - 1)} disabled={safePage >= pageCount - 1} label="Last page">»</PagerButton>
                      </div>
                    )}
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

      {boxGame && (
        <GameBoxModal
          game={boxGame}
          opp={
            games.find(
              (x) => x !== boxGame && gameKey(x.game_id) === gameKey(boxGame.game_id),
            ) ?? null
          }
          onClose={() => setBoxGame(null)}
        />
      )}
    </div>
  );
}

/** One player's line as shipped by scripts/export-game-players-json.mjs. */

// Format a game-log stat value for display. Flags → Yes/No, percentages →
// "55.5%", diff stats → signed integers ("+8" / "-5"), everything else → 1 dp.
function formatStat(v: number | string | boolean | null, key: string): string {
  if (typeof v !== "number") return "—";
  if (FLAG_KEYS.has(key)) return v === 1 ? "Yes" : v === 0 ? "No" : "—";
  if (isPctKey(key)) return (v * 100).toLocaleString("en-US", { maximumFractionDigits: 1 }) + "%";
  if (key.endsWith("_diff")) return v > 0 ? `+${v}` : String(v);
  if (key === "poss" || key === "pace") return v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return v.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function labelFor(f: Filter): string {
  const key = String(f.stat);
  const stat = cleanLabel(CALC_STAT_OPTIONS.find((s) => s.key === f.stat)?.label ?? key);
  if (FLAG_KEYS.has(key)) return `${stat}: ${f.value === 1 ? "Yes" : "No"}`;
  const op = OPS.find((o) => o.value === f.op)?.label ?? f.op;
  return `${stat} ${op} ${fmtCondValue(key, f.value)}`;
}

function ConditionChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded border border-hairline bg-paper-deep/60 text-xs text-ink-soft tabular">
      {children}
    </span>
  );
}

/**
 * One stat as a compact sheet row: name, comparator glyph (tap to cycle),
 * exact-value input, thin slider. Dormant until touched — any interaction
 * turns the row into a live condition (bold name, hue-filled slider, ×);
 * × puts it back to sleep. Flags trade the whole apparatus for Any/Yes/No.
 *
 * The slider is the thumb-only .bta-range the Players drawer uses: track and
 * fill are plain divs behind a transparent input, which is what lets the fill
 * take the group hue with no per-hue CSS.
 */
function PagerButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="w-7 h-7 inline-flex items-center justify-center rounded-md border border-hairline bg-card text-sm text-ink-soft hover:border-coral/60 hover:text-coral disabled:opacity-30 disabled:hover:border-hairline disabled:hover:text-ink-soft transition-colors"
    >
      {children}
    </button>
  );
}



/** Coral count marble — the D&3-style "this section is filtering" signal. */
function CountBadge({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-coral text-white text-[10px] font-semibold tabular leading-none">
      {n}
    </span>
  );
}

function SectionLabel({
  children,
  count = 0,
  action,
}: {
  children: React.ReactNode;
  count?: number;
  action?: React.ReactNode;
}) {
  return (
    // Fixed height on purpose: the count badge and All/Clear buttons come and
    // go with the selection, and without a reserved line-height their arrival
    // made this row taller — visibly shoving the input below it out of
    // alignment with its neighbors (Teams grew, Coaches didn't).
    <div className="flex items-center gap-2 mb-2 h-7">
      <span className="text-xs uppercase tracking-widest text-ink font-bold">{children}</span>
      {count > 0 && <CountBadge n={count} />}
      {action}
    </div>
  );
}

/** One selectable pill. Lit = coral fill, like D&3's team grid. */
function TogglePill({
  active,
  onClick,
  title,
  children,
  className = "",
  emphasis = false,
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
  /** Slightly heavier dormant treatment (power conferences). */
  emphasis?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`px-3 py-1.5 rounded-md border text-sm transition-all ${
        active
          ? "bg-coral border-coral text-white shadow-sm font-medium"
          : `bg-card text-ink-soft hover:border-coral/50 hover:text-ink ${
              emphasis ? "border-ink/25 font-semibold" : "border-hairline font-medium"
            }`
      } ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * Small utility button — Clear All and the per-section All/Clear actions.
 * Distinct from TogglePill by shape and hue, not weight: fully-rounded coral
 * ghost vs the pills' square-ish bordered cards. (A dark ink fill was tried
 * first and read as "selected", which is exactly the wrong signal.)
 */
const MINI_CLS =
  "px-2.5 py-1 rounded-md border border-coral/40 bg-coral/5 text-xs font-semibold text-coral";

function MiniButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`${MINI_CLS} hover:bg-coral hover:text-white transition-colors`}>
      {children}
    </button>
  );
}

/**
 * Type-ahead multi-select: type, pick a suggestion (Enter takes the top one),
 * the choice becomes a removable chip, keep typing for the next. Empty
 * selection = no filter, said out loud via the allLabel chip so "nothing
 * selected" never reads as "nothing will match".
 */
function ChipSearchMulti({
  label,
  values,
  options,
  onChange,
  placeholder,
  allLabel,
  icon,
}: {
  label: string;
  values: string[];
  options: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  allLabel: string;
  /** Optional per-name icon (school logos for teams/opponents). */
  icon?: (name: string) => React.ReactNode;
}) {
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const matches = useMemo(() => {
    const tokens = normName(q).split(" ").filter(Boolean);
    if (tokens.length === 0) return [];
    // Alias-aware and token-based: an option matches when every typed word
    // appears somewhere in its own name OR in any nickname it belongs to —
    // in both directions. "uconn" finds Connecticut, "connecticut" finds
    // UConn in the opponent name space, "south california" finds Southern
    // California because each token matches independently.
    return options
      .filter(
        (o) => !values.includes(o) && searchKeysFor(o).some((k) => tokens.every((t) => k.includes(t))),
      )
      .slice(0, 8);
  }, [q, options, values]);

  function pick(name: string) {
    onChange([...values, name]);
    setQ("");
    setHi(0);
  }

  return (
    <div>
      <SectionLabel
        count={values.length}
        action={values.length > 0 ? <MiniButton onClick={() => onChange([])}>All</MiniButton> : null}
      >
        {label}
      </SectionLabel>
      <div className="relative">
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setHi(0); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (matches[hi]) pick(matches[hi]);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setHi((h) => Math.min(h + 1, matches.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHi((h) => Math.max(h - 1, 0));
            } else if (e.key === "Escape") {
              setQ("");
            }
          }}
          placeholder={placeholder}
          aria-label={label}
          className="h-9 w-full px-3 rounded-md border border-hairline bg-card text-ink text-base sm:text-sm placeholder:text-ink-muted/70 focus:outline-none focus:ring-2 focus:ring-coral/40 placeholder:text-xs sm:placeholder:text-sm"
        />
        {matches.length > 0 && (
          <ul className="bta-pop-in absolute z-20 mt-1 w-full rounded-md border border-hairline bg-popover shadow-md overflow-hidden" role="listbox">
            {matches.map((m, i) => (
              <li key={m}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === hi}
                  // onMouseDown so the pick lands before the input blurs.
                  onMouseDown={(e) => { e.preventDefault(); pick(m); }}
                  onMouseEnter={() => setHi(i)}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors inline-flex items-center gap-2 ${
                    i === hi ? "bg-coral/10 text-ink" : "text-ink-soft"
                  }`}
                >
                  {icon?.(m)}
                  {m}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {values.length === 0 ? (
          // Empty selection MEANS "all", and this chip says so in the same
          // visual language as a lit pill — filled, clearly the current state.
          // cursor-default/select-none so it can't show a text caret and read
          // as a broken button.
          <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-coral text-white text-xs font-semibold shadow-sm cursor-default select-none">
            {allLabel}
          </span>
        ) : (
          values.map((v) => (
            <span key={v} className="bta-pop-in inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-md bg-coral/10 border border-coral/30 text-xs text-ink">
              {icon?.(v)}
              {v}
              <button
                type="button"
                onClick={() => onChange(values.filter((x) => x !== v))}
                aria-label={`Remove ${v}`}
                className="w-4 h-4 inline-flex items-center justify-center rounded text-ink-muted hover:text-white hover:bg-coral transition-colors leading-none"
              >
                ×
              </button>
            </span>
          ))
        )}
      </div>
    </div>
  );
}
