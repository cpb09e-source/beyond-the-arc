/**
 * Coach data layer — joins three sources:
 *   1. src/data/coach-history.json (SR scrape, 2013-2026) — preferred when present
 *   2. src/data/team-coaches.json (ESPN snapshot, 2025-26 only) — fallback / supplement
 *   3. public/data/teams-all.json — current-season conference + record
 *
 * Output shapes:
 *   - CoachIndexRow: one row per unique coach (for /coaches index)
 *   - CoachProfile:  full timeline + per-school breakdown (for /coaches/<slug>)
 *
 * If coach-history.json doesn't exist yet (scraper still running), the layer
 * gracefully degrades to ESPN-only single-season data.
 */

import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { readAllTeams } from "@/lib/static-data";
import { POWER_CONFS } from "@/lib/conf-tiers";

const TEAM_NAME_OVERRIDES: Record<string, string> = {
  "Southern California": "USC",
};
function overrideTeam(n: string): string { return TEAM_NAME_OVERRIDES[n] ?? n; }

export const LATEST_YEAR = 2026;

// ---------- raw input shapes ----------

type EspnCoach = {
  name: string;
  first_name: string;
  last_name: string;
  espn_id: string | null;
};

type SrSeason = {
  name: string;
  slug: string | null;
  wins: number | null;
  losses: number | null;
  conf?: string | null;          // SR conference abbreviation
  conf_wins?: number | null;     // conf-only wins
  conf_losses?: number | null;   // conf-only losses
  seed?: number | null;          // NCAA tournament seed (null = didn't qualify)
  round?: TourneyRound | null;   // furthest round reached
};

export type TourneyRound =
  | "First Four"
  | "R64"
  | "R32"
  | "Sweet 16"
  | "Elite Eight"
  | "Final Four"
  | "Runner-up"
  | "Champion";

/**
 * One game in an NCAA Tournament bracket. Scraped from SR's bracket pages.
 * Round label here uses bracket-position terminology — same TourneyRound type.
 * Note: the SR bracket page calls the championship game "Champion" (the
 * winner is the champ); our `coach-history.json` `round` field uses
 * "Runner-up" for the team that lost the final. Both refer to the same game.
 */
export type TourneyGame = {
  year: number;
  round: TourneyRound;
  date: string | null;            // ISO date string
  boxscore_url?: string | null;   // SR boxscore URL fragment, e.g. /cbb/boxscores/2025-04-07-20-houston.html
  winner: { seed: number | null; slug: string; school: string; score: number | null };
  loser: { seed: number | null; slug: string; school: string; score: number | null };
};

// ---------- output shapes ----------

export type CoachSeason = {
  year: number;
  team: string;
  conference: string | null;
  wins: number | null;
  losses: number | null;
  conf_wins?: number | null;          // conference-only wins
  conf_losses?: number | null;        // conference-only losses
  seed: number | null;
  round: TourneyRound | null;
  reg_season_conf_champ?: boolean;    // computed: best conf W% in this conference, that year
  bta_rtg?: number | null;            // Beyond the Arc rating value
  bta_rank?: number | null;           // Beyond the Arc D-I rank for that team-year (1 = best)
  bta_pct?: number | null;            // BTA RTG percentile within the year
  adj_oe?: number | null;             // Bart Torvik adjusted offensive efficiency
  adj_oe_pct?: number | null;         // adj_oe percentile within the year (higher=better)
  adj_de?: number | null;             // Bart Torvik adjusted defensive efficiency
  adj_de_pct?: number | null;         // adj_de percentile within the year (lower=better)
  adj_net?: number | null;            // adj_oe - adj_de
  adj_net_pct?: number | null;        // net percentile within the year (higher=better)
};

export type CoachSchoolStint = {
  team: string;
  first_year: number;
  last_year: number;
  seasons: number;
  wins: number;
  losses: number;
};

export type CoachIndexRow = {
  name: string;
  slug: string;                         // URL slug
  current_team: string | null;          // most recent team (highest year)
  current_conference: string | null;
  current_year: number | null;          // most recent year coached
  is_active: boolean;                   // most recent year === LATEST_YEAR
  career_wins: number;
  career_losses: number;
  career_win_pct: number | null;
  seasons_count: number;
  schools_count: number;
  /** Every distinct team this coach has been at in our 2013-26 window.
   *  Used by /coaches Team filter so picking "Abilene Christian" surfaces
   *  every coach who's been there since 2013, not just the current one. */
  all_teams: string[];
  // Composite ranking — TODO: formula in progress. Optional + nullable so
  // the UI can render "—" until the export pipeline populates it.
  composite_score?: number | null;
  // Aggregate counts used by the head-to-head compare modal on /coaches.
  // All scoped to the 2013-26 data window.
  ncaa_titles: number;
  final_fours: number;          // F4 + Runner-up + Champion
  sweet_sixteens: number;       // Sweet 16 + Elite Eight + F4 + Runner-up + Champion
  ncaa_appearances: number;     // seasons with any non-null tournament round
  power_reg_champs: number;     // reg_season_conf_champ AND conference in POWER_CONFS
  reg_season_champs: number;    // reg_season_conf_champ across ALL conferences
  twenty_win_seasons: number;   // any season with wins >= 20
  thirty_win_seasons: number;   // any season with wins >= 30
  best_finish: TourneyRound | null;  // furthest round reached across all seasons
};

export type CoachProfile = CoachIndexRow & {
  by_year: CoachSeason[];               // desc by year
  schools: CoachSchoolStint[];          // desc by last_year
  best_season: CoachSeason | null;      // highest win % with ≥10 games
  worst_season: CoachSeason | null;     // lowest win % with ≥10 games
  best_record_season: CoachSeason | null;   // most wins in a season
};

// ---------- helpers ----------

/**
 * Stable URL slug for a coach. Lowercase + non-alphanum → hyphen.
 */
export function coachSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function winPct(w: number, l: number): number | null {
  const total = w + l;
  return total > 0 ? w / total : null;
}

// ---------- core loader ----------

type RatingsRow = {
  bta_rtg: number | null;
  bta_rank: number | null;
  bta_pct: number | null;
  adj_oe: number | null;
  adj_oe_pct: number | null;
  adj_de: number | null;
  adj_de_pct: number | null;
  adj_net: number | null;
  adj_net_pct: number | null;
};
type RawSourceData = {
  history: Record<string, Record<string, SrSeason>>;   // { team: { year: SrSeason } }
  espn: Record<string, EspnCoach>;                     // { team: EspnCoach }
  meta: Map<string, { conference: string | null; record: string | null; wins: number | null; losses: number | null; year: number }>;
  confByTeamYear: Map<string, string | null>;          // "<team>|<year>" → conf (across full data window)
  ratingsByTeamYear: Map<string, RatingsRow>;          // "<team>|<year>" → all 4 ratings + percentiles
};

async function loadRawSources(): Promise<RawSourceData> {
  const dataDir = path.resolve("src/data");
  let history: Record<string, Record<string, SrSeason>> = {};
  let espn: Record<string, EspnCoach> = {};

  const historyPath = path.join(dataDir, "coach-history.json");
  if (existsSync(historyPath)) {
    history = JSON.parse(await fs.readFile(historyPath, "utf8"));
  }
  const espnPath = path.join(dataDir, "team-coaches.json");
  if (existsSync(espnPath)) {
    espn = JSON.parse(await fs.readFile(espnPath, "utf8"));
  }

  // Per-(team, year) lookup of conference + record. Current-year tier covers
  // record/wins/losses for /coaches columns; historical years just expose
  // conference for context on the year-by-year table.
  const teams = await readAllTeams();
  const meta = new Map<string, { conference: string | null; record: string | null; wins: number | null; losses: number | null; year: number }>();
  const confByTeamYear = new Map<string, string | null>();

  // First pass: collect raw values per (team, year) so we can rank them across
  // each year to compute percentiles. We bucket by year and then sort.
  type Raw = { team: string; year: number; bta: number | null; oe: number | null; de: number | null };
  const rawRows: Raw[] = [];
  for (const t of teams) {
    const team = overrideTeam(t.name);
    const key = `${team}|${t.year}`;
    confByTeamYear.set(key, t.conference ?? null);
    const bta = (t as unknown as { bta_rtg?: number | null }).bta_rtg ?? null;
    const trank = (t as unknown as { team_trank_stats?: { record?: string | null; wins?: number | null; losses?: number | null; adjoe?: number | null; adjde?: number | null } | null }).team_trank_stats;
    rawRows.push({ team, year: t.year, bta, oe: trank?.adjoe ?? null, de: trank?.adjde ?? null });
    if (t.year === LATEST_YEAR) {
      meta.set(team, {
        conference: t.conference ?? null,
        record: trank?.record ?? null,
        wins: trank?.wins ?? null,
        losses: trank?.losses ?? null,
        year: t.year,
      });
    }
  }

  // Build percentile lookups. For each metric, rank within year:
  //   higher-is-better (bta, oe, net): sort desc, top = 100th percentile
  //   lower-is-better (de):           sort asc,  bottom value = 100th percentile
  function pctileByYear<T extends Raw>(metric: (r: T) => number | null, higherBetter: boolean): Map<string, number> {
    const byYear = new Map<number, Raw[]>();
    for (const r of rawRows) {
      const v = metric(r as T);
      if (v == null) continue;
      const arr = byYear.get(r.year) ?? [];
      arr.push(r);
      byYear.set(r.year, arr);
    }
    const out = new Map<string, number>();
    for (const [year, list] of byYear) {
      const sorted = [...list].sort((a, b) => {
        const av = metric(a as T) ?? 0;
        const bv = metric(b as T) ?? 0;
        return higherBetter ? bv - av : av - bv;
      });
      const n = sorted.length;
      for (let i = 0; i < n; i++) {
        const pct = Math.round(((n - i) / n) * 100);
        out.set(`${sorted[i]!.team}|${year}`, pct);
      }
    }
    return out;
  }
  // Rank within year (1 = best). Mirrors pctileByYear but emits 1-indexed
  // position rather than a percentile.
  function rankByYear<T extends Raw>(metric: (r: T) => number | null, higherBetter: boolean): Map<string, number> {
    const byYear = new Map<number, Raw[]>();
    for (const r of rawRows) {
      const v = metric(r as T);
      if (v == null) continue;
      const arr = byYear.get(r.year) ?? [];
      arr.push(r);
      byYear.set(r.year, arr);
    }
    const out = new Map<string, number>();
    for (const [year, list] of byYear) {
      const sorted = [...list].sort((a, b) => {
        const av = metric(a as T) ?? 0;
        const bv = metric(b as T) ?? 0;
        return higherBetter ? bv - av : av - bv;
      });
      for (let i = 0; i < sorted.length; i++) {
        out.set(`${sorted[i]!.team}|${year}`, i + 1);
      }
    }
    return out;
  }
  const btaPct = pctileByYear<Raw>((r) => r.bta, true);
  const btaRank = rankByYear<Raw>((r) => r.bta, true);
  const oePct = pctileByYear<Raw>((r) => r.oe, true);
  const dePct = pctileByYear<Raw>((r) => r.de, false);
  const netPct = pctileByYear<Raw>((r) => (r.oe != null && r.de != null ? r.oe - r.de : null), true);

  const ratingsByTeamYear = new Map<string, RatingsRow>();
  for (const r of rawRows) {
    const key = `${r.team}|${r.year}`;
    ratingsByTeamYear.set(key, {
      bta_rtg: r.bta,
      bta_rank: btaRank.get(key) ?? null,
      bta_pct: btaPct.get(key) ?? null,
      adj_oe: r.oe,
      adj_oe_pct: oePct.get(key) ?? null,
      adj_de: r.de,
      adj_de_pct: dePct.get(key) ?? null,
      adj_net: r.oe != null && r.de != null ? r.oe - r.de : null,
      adj_net_pct: netPct.get(key) ?? null,
    });
  }

  return { history, espn, meta, confByTeamYear, ratingsByTeamYear };
}

/**
 * Flatten the historical map into a flat list of (coach, team, year) tuples,
 * supplemented with the ESPN snapshot for 2026 if historical doesn't have it.
 */
function flattenSeasons(raw: RawSourceData): CoachSeason[] {
  const out: CoachSeason[] = [];
  // Pass 1: historical SR data
  for (const [bartName, byYear] of Object.entries(raw.history)) {
    const team = overrideTeam(bartName);
    for (const [yearStr, s] of Object.entries(byYear)) {
      const year = parseInt(yearStr, 10);
      const key = `${team}|${year}`;
      const r = raw.ratingsByTeamYear.get(key);
      out.push({
        year,
        team,
        conference: raw.confByTeamYear.get(key) ?? null,
        wins: s.wins,
        losses: s.losses,
        conf_wins: s.conf_wins ?? null,
        conf_losses: s.conf_losses ?? null,
        seed: s.seed ?? null,
        round: s.round ?? null,
        bta_rtg: r?.bta_rtg ?? null,
        bta_rank: r?.bta_rank ?? null,
        bta_pct: r?.bta_pct ?? null,
        adj_oe: r?.adj_oe ?? null,
        adj_oe_pct: r?.adj_oe_pct ?? null,
        adj_de: r?.adj_de ?? null,
        adj_de_pct: r?.adj_de_pct ?? null,
        adj_net: r?.adj_net ?? null,
        adj_net_pct: r?.adj_net_pct ?? null,
      });
    }
  }

  // Pass 2: ESPN snapshot fills any team-year that historical missed for 2026.
  // (If SR scraper is still running or skipped a team, we still surface the
  // current coach.)
  const haveHistorical2026 = new Set<string>();
  for (const s of out) if (s.year === LATEST_YEAR) haveHistorical2026.add(s.team);

  for (const [bartName, espnCoach] of Object.entries(raw.espn)) {
    const team = overrideTeam(bartName);
    if (haveHistorical2026.has(team)) continue;
    const m = raw.meta.get(team);
    out.push({
      year: LATEST_YEAR,
      team,
      conference: m?.conference ?? null,
      wins: m?.wins ?? null,
      losses: m?.losses ?? null,
      conf_wins: null,
      conf_losses: null,
      seed: null,
      round: null,
    });
  }

  // Compute regular-season conference champions across the data window. For
  // each (conf, year), the team with the best conf win % is the regular-season
  // champ. Mutates `out` in place. We use the SR conf abbreviation since that's
  // what every season carries (Bart's conference is only populated for some
  // years via per-team meta).
  computeConfChamps(out, raw.history);
  return out;
}

/**
 * Identify the regular-season conference champion for every (conf, year) and
 * stamp the `reg_season_conf_champ` flag on each matching season.
 *
 * Walks the raw SR history (which has the full cross-team set) — `out` only
 * contains seasons for coaches we're profiling, so it'd be incomplete.
 */
function computeConfChamps(
  out: CoachSeason[],
  history: Record<string, Record<string, SrSeason>>,
): void {
  type Cand = { team: string; year: number; conf: string; pct: number; cw: number; cl: number };
  const cands: Cand[] = [];
  for (const [bartName, byYear] of Object.entries(history)) {
    const team = overrideTeam(bartName);
    for (const [yearStr, s] of Object.entries(byYear)) {
      if (!s.conf || s.conf_wins == null || s.conf_losses == null) continue;
      const games = s.conf_wins + s.conf_losses;
      if (games < 6) continue; // shorten-season noise
      const pct = s.conf_wins / games;
      cands.push({ team, year: parseInt(yearStr, 10), conf: s.conf, pct, cw: s.conf_wins, cl: s.conf_losses });
    }
  }
  // Group by (conf, year) → highest pct, then highest raw wins as tiebreaker.
  const champs = new Set<string>(); // "team|year"
  const byConfYear = new Map<string, Cand[]>();
  for (const c of cands) {
    const k = `${c.conf}|${c.year}`;
    const arr = byConfYear.get(k) ?? [];
    arr.push(c);
    byConfYear.set(k, arr);
  }
  for (const [, arr] of byConfYear) {
    arr.sort((a, b) => b.pct - a.pct || b.cw - a.cw);
    const top = arr[0]!;
    // Tied teams (same pct AND same wins) are co-champs.
    for (const c of arr) {
      if (c.pct === top.pct && c.cw === top.cw) champs.add(`${c.team}|${c.year}`);
      else break;
    }
  }
  for (const s of out) {
    if (champs.has(`${s.team}|${s.year}`)) s.reg_season_conf_champ = true;
  }
}

/**
 * Map each season to its coach name. SR gives us the coach name per (team, year).
 * ESPN gives us the coach name per team for 2026. Merge.
 */
type SeasonWithCoach = CoachSeason & { coach_name: string };

function attachCoachNames(seasons: CoachSeason[], raw: RawSourceData): SeasonWithCoach[] {
  const out: SeasonWithCoach[] = [];
  // Build a (team, year) → coach name lookup from BOTH sources.
  const lookup = new Map<string, string>();
  for (const [bartName, byYear] of Object.entries(raw.history)) {
    const team = overrideTeam(bartName);
    for (const [yearStr, s] of Object.entries(byYear)) {
      lookup.set(`${team}|${yearStr}`, s.name);
    }
  }
  for (const [bartName, espnCoach] of Object.entries(raw.espn)) {
    const team = overrideTeam(bartName);
    const key = `${team}|${LATEST_YEAR}`;
    if (!lookup.has(key)) lookup.set(key, espnCoach.name);
  }
  for (const s of seasons) {
    const name = lookup.get(`${s.team}|${s.year}`);
    if (name) out.push({ ...s, coach_name: name });
  }
  return out;
}

/**
 * Group seasons by coach (by name — keep collisions visible like Mark Madsen
 * being listed at 3 schools) and build profiles.
 */
function profilesFromSeasons(seasons: SeasonWithCoach[], raw: RawSourceData): CoachProfile[] {
  const byCoach = new Map<string, SeasonWithCoach[]>();
  for (const s of seasons) {
    const key = s.coach_name;
    const arr = byCoach.get(key) ?? [];
    arr.push(s);
    byCoach.set(key, arr);
  }

  const profiles: CoachProfile[] = [];
  for (const [name, list] of byCoach.entries()) {
    list.sort((a, b) => b.year - a.year); // newest first
    const career_wins = list.reduce((s, x) => s + (x.wins ?? 0), 0);
    const career_losses = list.reduce((s, x) => s + (x.losses ?? 0), 0);
    const current = list[0]!;
    const is_active = current.year === LATEST_YEAR;

    // Per-school stints (handle re-tenures by summing all years at that school).
    const byTeam = new Map<string, SeasonWithCoach[]>();
    for (const s of list) {
      const arr = byTeam.get(s.team) ?? [];
      arr.push(s);
      byTeam.set(s.team, arr);
    }
    const schools: CoachSchoolStint[] = [];
    for (const [team, ts] of byTeam.entries()) {
      ts.sort((a, b) => a.year - b.year);
      schools.push({
        team,
        first_year: ts[0]!.year,
        last_year: ts[ts.length - 1]!.year,
        seasons: ts.length,
        wins: ts.reduce((s, x) => s + (x.wins ?? 0), 0),
        losses: ts.reduce((s, x) => s + (x.losses ?? 0), 0),
      });
    }
    schools.sort((a, b) => b.last_year - a.last_year);

    // Best/worst by win % (require ≥10 games to dodge tiny-sample noise).
    const eligible = list.filter((s) => (s.wins ?? 0) + (s.losses ?? 0) >= 10);
    const sortedByPct = [...eligible].sort((a, b) => {
      const aPct = winPct(a.wins ?? 0, a.losses ?? 0) ?? -1;
      const bPct = winPct(b.wins ?? 0, b.losses ?? 0) ?? -1;
      return bPct - aPct;
    });
    const sortedByWins = [...list].sort((a, b) => (b.wins ?? 0) - (a.wins ?? 0));

    // Strip coach_name from output (it's a property of the profile, not each row).
    const by_year: CoachSeason[] = list.map(({ coach_name: _drop, ...s }) => { void _drop; return s; });

    // Aggregate counts for the compare modal. Computed once here so the
    // index payload carries everything the compare needs (no per-coach
    // profile fetch on modal open).
    const ncaa_titles = by_year.filter((s) => s.round === "Champion").length;
    const final_fours = by_year.filter((s) => s.round === "Final Four" || s.round === "Runner-up" || s.round === "Champion").length;
    const sweet_sixteens = by_year.filter((s) => s.round === "Sweet 16" || s.round === "Elite Eight" || s.round === "Final Four" || s.round === "Runner-up" || s.round === "Champion").length;
    const ncaa_appearances = by_year.filter((s) => s.round != null).length;
    const power_reg_champs = by_year.filter((s) => s.reg_season_conf_champ && s.conference != null && POWER_CONFS.has(s.conference)).length;
    const reg_season_champs = by_year.filter((s) => s.reg_season_conf_champ).length;
    const twenty_win_seasons = by_year.filter((s) => (s.wins ?? 0) >= 20).length;
    const thirty_win_seasons = by_year.filter((s) => (s.wins ?? 0) >= 30).length;
    // Best finish — ranked by tournament-depth order.
    const ROUND_DEPTH: Record<string, number> = {
      "First Four": 0, "R64": 1, "R32": 2, "Sweet 16": 3, "Elite Eight": 4, "Final Four": 5, "Runner-up": 6, "Champion": 7,
    };
    let best_finish: TourneyRound | null = null;
    let best_depth = -1;
    for (const s of by_year) {
      if (s.round != null && ROUND_DEPTH[s.round] > best_depth) {
        best_depth = ROUND_DEPTH[s.round]!;
        best_finish = s.round;
      }
    }

    profiles.push({
      name,
      slug: coachSlug(name),
      current_team: current.team,
      current_conference: current.conference,
      current_year: current.year,
      is_active,
      career_wins,
      career_losses,
      career_win_pct: winPct(career_wins, career_losses),
      seasons_count: list.length,
      schools_count: byTeam.size,
      all_teams: Array.from(new Set(list.map((s) => s.team))).sort(),
      ncaa_titles,
      final_fours,
      sweet_sixteens,
      ncaa_appearances,
      power_reg_champs,
      reg_season_champs,
      twenty_win_seasons,
      thirty_win_seasons,
      best_finish,
      by_year,
      schools,
      best_season: sortedByPct[0] ? { year: sortedByPct[0].year, team: sortedByPct[0].team, conference: sortedByPct[0].conference, wins: sortedByPct[0].wins, losses: sortedByPct[0].losses, seed: sortedByPct[0].seed, round: sortedByPct[0].round } : null,
      worst_season: sortedByPct[sortedByPct.length - 1] ? { year: sortedByPct[sortedByPct.length - 1]!.year, team: sortedByPct[sortedByPct.length - 1]!.team, conference: sortedByPct[sortedByPct.length - 1]!.conference, wins: sortedByPct[sortedByPct.length - 1]!.wins, losses: sortedByPct[sortedByPct.length - 1]!.losses, seed: sortedByPct[sortedByPct.length - 1]!.seed, round: sortedByPct[sortedByPct.length - 1]!.round } : null,
      best_record_season: sortedByWins[0] ? { year: sortedByWins[0].year, team: sortedByWins[0].team, conference: sortedByWins[0].conference, wins: sortedByWins[0].wins, losses: sortedByWins[0].losses, seed: sortedByWins[0].seed, round: sortedByWins[0].round } : null,
    });
  }
  return profiles;
}

// ---------- Composite score ----------

/**
 * Programs that are expected to dance every year. Missing the tournament at
 * one of these schools is a stiff penalty in the composite score. Editorial
 * list — feel free to edit if a program's tier shifts.
 */
const BLUEBLOOD_PROGRAMS = new Set([
  // ACC
  "Duke", "North Carolina", "Louisville", "Virginia",
  // Big 12
  "Kansas", "Texas", "Arizona",
  // Big Ten
  "Michigan St.", "Indiana", "Michigan", "Ohio St.", "Wisconsin", "Purdue", "UCLA",
  // SEC
  "Kentucky", "Florida", "Tennessee", "Auburn",
  // Big East — title-winning programs in our 2013-26 window
  "Villanova", "Connecticut",
  // High mid-majors that have operated at Power tier the entire window.
  // Treated as blueblood for miss-penalty purposes since a Few/Sampson
  // missing the dance would be national news.
  "Gonzaga", "Houston",
]);

/**
 * The traditional college-basketball kings — programs where titles are part
 * of the institutional expectation, not an upset. Used for the "harder-path
 * title" bonus: winning the title at a non-elite blueblood (Villanova,
 * Virginia, etc.) gets extra credit; doing it at an elite blueblood
 * (Kentucky, Duke, UCLA, etc.) does not.
 */
const ELITE_BLUEBLOOD = new Set([
  "Kentucky", "Duke", "North Carolina", "UCLA", "Kansas", "Indiana",
  // UConn has 3 titles in our 2013-26 window alone (2014, 2023, 2024) —
  // they're elite by every measure now, even if their pedigree is younger
  // than the historical 6.
  "Connecticut",
]);

/**
 * Power-conference programs where making the tournament is a real
 * accomplishment, not an expectation. No miss-tournament penalty.
 */
const LOW_EXPECTATION_POWER = new Set([
  "Northwestern", "Vanderbilt", "Boston College", "Wake Forest",
  "Penn St.", "Nebraska", "Rutgers",
  "California", "Washington St.", "Oregon St.",
  "South Carolina", "Mississippi St.", "Mississippi",
  "Georgia Tech", "Pittsburgh",
  "DePaul", "Georgetown",
]);

// Tournament reach points — asymmetric by tier. Power coaches face the
// expectation tax (early exits are punishing); mid-major coaches are rewarded
// just for being there. Final Four / Runner-up / Champion are weighted heavily
// since the formula treats winning the title as the single most important
// résumé line — a champion gets ~2× a Sweet 16 outright.
const REACH_POINTS_POWER: Record<TourneyRound, number> = {
  "First Four": -0.5,
  "R64": -1,
  "R32": 0,
  "Sweet 16": 2,
  "Elite Eight": 4,
  "Final Four": 10,
  "Runner-up": 13,
  "Champion": 18,
};
const REACH_POINTS_MID: Record<TourneyRound, number> = {
  "First Four": 0.5,
  "R64": 2,
  "R32": 3,
  "Sweet 16": 6,
  "Elite Eight": 9,
  "Final Four": 17,
  "Runner-up": 20,
  "Champion": 25,
};

function btaRankBonus(rank: number | null | undefined): number {
  if (rank == null) return 0;
  if (rank <= 5) return 4;
  if (rank <= 10) return 3;
  if (rank <= 25) return 2;
  if (rank <= 50) return 1;
  if (rank <= 100) return 0.5;
  return 0;
}

function powerMissPenalty(team: string): number {
  if (BLUEBLOOD_PROGRAMS.has(team)) return -3.5;
  if (LOW_EXPECTATION_POWER.has(team)) return 0;
  return -0.5;
}

/**
 * "Fall from grace" penalty — a Power-conf blueblood (Kansas, Duke, etc.)
 * that wins under 20 games is a season-defining disappointment, and it
 * compounds the standard miss-tournament penalty. Restricted to Power-conf
 * bluebloods only (Gonzaga's bad year wouldn't trigger this since they play
 * in WCC). Tiered by severity.
 */
function bluebloodSubTwentyPenalty(team: string, wins: number, confIsPower: boolean): number {
  if (!confIsPower) return 0;
  if (!BLUEBLOOD_PROGRAMS.has(team)) return 0;
  if (wins >= 20) return 0;
  if (wins < 10) return -5;     // disaster — e.g. <30% W%
  if (wins < 15) return -3.5;   // very bad
  return -2;                    // 15–19 wins
}

/**
 * Is this season "expected tier" for the formula — i.e. should we apply
 * Power-conf rules (tighter reach values, miss penalty, no upset bonus)?
 *
 * Two ways to qualify:
 *   1. Conference is in POWER_CONFS (ACC/B10/B12/P12/SEC/BE), OR
 *   2. BTA rank ≤ 30 for that season — captures Gonzaga, Saint Mary's,
 *      Houston (pre-B12), and any mid-major program operating at Power level.
 *
 * Without this rule, Gonzaga's 14-season run at top-5 BTA would inflate via
 * mid-major reach bonuses and end up 100 points above true Power coaches.
 */
function isExpectedTier(s: CoachSeason): boolean {
  if (s.conference && POWER_CONFS.has(s.conference)) return true;
  if (s.bta_rank != null && s.bta_rank <= 30) return true;
  return false;
}

/**
 * Career résumé score — per-season points summed across the coach's career.
 * Tenure is implicit (longer good careers compound). Rewards:
 *   - Win % × 10  (0–10 baseline)
 *   - 20+ wins      +1.5
 *   - Reg-season conf champ  +2
 *   - BTA rank tiered bonus  +0.5 to +4
 *   - Power-conf base bump   +0.5
 *   - Tournament reach (asymmetric by conf tier)
 *   - Mid-major upset bonus (per game): min(seedDiff × 0.4, 4)
 *
 * Penalties:
 *   - Power miss-tournament: blueblood −2.5 / default −0.5 / low-expectation 0
 *   - Power R64 first-round exit: −1
 *
 * Returns the raw composite (sum of season scores). Rounded to 1 decimal.
 */
function computeCompositeScore(
  profile: CoachProfile,
  gamesLookup: Map<string, TourneyGame[]>,
): number {
  // Pre-compute tenure per team — needed for the first-season-loss waiver.
  // A losing first season is forgiven (no point deductions) when the coach
  // stuck around long enough to build the program back up. Captures the
  // "rebuilding a bad job" scenario that shouldn't dock a coach.
  const tenureByTeam = new Map<string, { firstYear: number; total: number }>();
  for (const s of profile.by_year) {
    const cur = tenureByTeam.get(s.team);
    if (!cur) tenureByTeam.set(s.team, { firstYear: s.year, total: 1 });
    else tenureByTeam.set(s.team, {
      firstYear: Math.min(cur.firstYear, s.year),
      total: cur.total + 1,
    });
  }

  let total = 0;
  for (const s of profile.by_year) {
    if (s.wins == null || s.losses == null) continue;
    const games = s.wins + s.losses;
    if (games === 0) continue;
    const winPct = s.wins / games;
    const expected = isExpectedTier(s);
    const confIsPower = s.conference ? POWER_CONFS.has(s.conference) : false;

    // First-season-loss waiver: if this is the coach's first season at this
    // team AND they coached there for 4+ seasons AND the season was a losing
    // record, all per-season penalties are suppressed. This forgives the
    // rebuilding year when a coach inherits a struggling program.
    const tenure = tenureByTeam.get(s.team);
    const isFirstAtTeam = tenure ? tenure.firstYear === s.year : false;
    const longTenure = tenure ? tenure.total > 3 : false;
    const losingRecord = s.wins < s.losses;
    const waiver = isFirstAtTeam && longTenure && losingRecord;

    // Base — win % × 10 (0–10 points)
    let season = winPct * 10;

    // Threshold bonuses
    if (s.wins >= 20) season += 1.5;
    // 30+ wins is rare in a Power-conference schedule (gauntlet of P5 opponents
    // means more losses baked in). Mid-major 30-win seasons only get the +1.5
    // for 20+ wins; this extra bonus is conference-power-only.
    if (s.wins >= 30 && confIsPower) season += 2;
    if (s.reg_season_conf_champ) {
      season += 2;
      // Winning a Power-conf regular season title is materially harder than
      // running the table in a one-bid league — extra bump for P5 reg champs.
      if (confIsPower) season += 1.5;
    }

    // BTA rank bonus
    season += btaRankBonus(s.bta_rank);

    // Expected-tier base bump
    if (expected) season += 0.5;

    // Tournament reach (asymmetric). Reach values themselves can be negative
    // for Power R64 exits — gate that branch on the waiver too so a 0-2 first
    // R64 trip doesn't sting a coach we're forgiving for inheriting a bad team.
    if (s.round != null) {
      const reach = expected ? REACH_POINTS_POWER[s.round] : REACH_POINTS_MID[s.round];
      // Positive reach (S16+) always counts. Negative reach (R64 Power = −1,
      // First Four Power = −0.5) is suppressed under the waiver.
      if (reach >= 0 || !waiver) season += reach;
      // Top-seed first-round disaster — worst bracket outcome possible.
      if (s.round === "R64" && s.seed != null && s.seed <= 3 && !waiver) {
        season -= 6;
      }
      // Blueblood R1 exit, any seed — coaching at a top program raises the
      // floor; a first-round exit at Duke/Kansas/UNC/etc. is a résumé negative
      // even as a 5-seed. Tiny tax so it nudges without overwhelming the
      // existing top-3 seed disaster penalty (which stacks).
      if (s.round === "R64" && BLUEBLOOD_PROGRAMS.has(s.team) && !waiver) {
        season -= 1;
      }
      // Cinderella deep-run bonus — flat bump for reaching F4+ as a high
      // seed. Captures the rare significance of a Dusty-May-2023-style run
      // (9-seed F4 with FAU) that the standard reach + per-game upset
      // bonuses don't fully reward. Title-game finishes get a bigger tier
      // than F4-only since reaching the title game as a Cinderella is
      // historically thinner air.
      //
      // Power-conf teams are NOT eligible — a Power program reaching F4 as
      // an 11-seed (Cronin's 2021 UCLA, Keatts' 2024 NC State) has inherent
      // resource/recruiting advantages a true mid-major Cinderella lacks.
      if (s.seed != null && !confIsPower) {
        const isF4 = s.round === "Final Four";
        const isFinal = s.round === "Runner-up" || s.round === "Champion";
        if (isFinal) {
          if (s.seed >= 13) season += 30;
          else if (s.seed >= 10) season += 25;
          else if (s.seed >= 8) season += 18;
          else if (s.seed >= 6) season += 10;
          else if (s.seed >= 5) season += 5;
        } else if (isF4) {
          if (s.seed >= 13) season += 20;
          else if (s.seed >= 10) season += 15;
          else if (s.seed >= 8) season += 8;
          else if (s.seed >= 6) season += 5;
        }
      }
    } else if (expected && !waiver && s.year !== 2020) {
      // Missed tournament as an expected-tier coach — penalty depends on
      // program tier. Mid-majors that didn't hit top-30 BTA escape penalty.
      // 2020 exempt: the tournament was cancelled, not missed.
      season += powerMissPenalty(s.team);
    }

    // Power-conf blueblood "fall from grace" — compounds the miss penalty
    // when a top program also fails to clear 20 wins. Waived for rebuilding
    // first seasons.
    if (!waiver) {
      season += bluebloodSubTwentyPenalty(s.team, s.wins, confIsPower);
    }

    // Sub-.500 Power-conf penalty — at a Power-conference job, a losing
    // record is a résumé negative, not a positive. Without this rule a
    // mediocre coach piles up "showed up to work" points just for staying
    // employed (Pikiell at Rutgers archetype). −6/season, conf-power only
    // (mid-major .470 records reflect real difficulty), waivered for
    // rebuilding first seasons, and stacks with blueblood-sub-20 tax.
    if (!waiver && confIsPower && s.wins < s.losses) {
      season -= 6;
    }

    // Mediocre Power-conf tax — Power seasons in the .50-.60 win-pct range
    // are "treading water" at a job that pays for above-average results.
    // Without this, coaches like Michael White accumulate résumé points
    // from a long career of mediocre-Power years. −3/season; waivered for
    // first-season rebuilds.
    if (!waiver && confIsPower && winPct >= 0.5 && winPct < 0.6) {
      season -= 3;
    }

    // Catastrophic-bottom tax — sub-25% win-pct seasons. These are total
    // collapses regardless of conference (3-27 at Mississippi Valley St.,
    // 9-23 at Alabama A&M, etc.). −5/season on top of any sub-.500 Power
    // penalty. Waivered for first-season rebuilds since a 5-25 season
    // inheriting a bad job shouldn't dock a coach who builds from there.
    if (!waiver && winPct < 0.25) {
      season -= 5;
    }

    // Non-Power expected-tier schedule tax — coaches who get Power-conf
    // treatment via top-30 BTA (Gonzaga, Saint Mary's, Houston pre-B12) are
    // still partly riding a softer conference schedule. Small per-season
    // tax keeps the formula honest. Doesn't apply if conference is Power.
    if (expected && !confIsPower) {
      season -= 0.65;
    }

    // Mid-major upset bonus — only when an UNEXPECTED-TIER team was the
    // higher seed (worse number) AND won. Expected-tier teams (Power confs +
    // top-30 BTA programs) get nothing here, per "Kansas as a 10-seed
    // beating a 7-seed shouldn't matter" — same logic applies to Gonzaga.
    if (!expected && s.seed != null) {
      const tGames = gamesForTeamYear(gamesLookup, s.team, s.year);
      for (const g of tGames) {
        const isWinner = normSchool(g.winner.school) === normSchool(s.team);
        if (!isWinner) continue;
        const mySeed = g.winner.seed;
        const oppSeed = g.loser.seed;
        if (mySeed == null || oppSeed == null) continue;
        if (mySeed <= oppSeed) continue; // not an upset — we were favored
        const diff = mySeed - oppSeed;
        season += Math.min(diff * 0.4, 4);
      }
    }

    total += season;
  }

  // Repeated top-seed first-round disasters — career-level stacking penalty
  // when a coach has flamed out as a 1-3 seed in R1 more than once. The
  // per-season −6 already prices the individual mistake; this captures the
  // pattern (Calipari's St. Peter's 2022 + Oakland 2024). −4 per repeat
  // occurrence beyond the first.
  {
    const topSeedR1Losses = profile.by_year.filter(
      (s) => s.round === "R64" && s.seed != null && s.seed <= 3,
    ).length;
    if (topSeedR1Losses > 1) {
      total -= 4 * (topSeedR1Losses - 1);
    }
  }

  const titles = profile.by_year.filter((s) => s.round === "Champion").length;

  // Career-arc gate — all bumps and taxes that depend on cumulative career
  // shape are suppressed for coaches with fewer than 5 total seasons. A
  // 1-year wonder shouldn't get the +10 80%-Power-career bonus from one hot
  // season, and a 4-year coach shouldn't be taxed for not winning a title
  // yet. Keeps short-tenure coaches (Jon Scheyer, Ben McCollum, Tommy Lloyd
  // through year-3) at a neutral "résumé in progress" score — just the sum
  // of per-season points without career-arc multipliers in either direction.
  const careerArcEligible = profile.seasons_count >= 5;

  // Fast-start bonus — explicit reward for newer coaches having clear
  // success. Sits OUTSIDE the career-arc gate so short-tenure standouts
  // (Scheyer at Duke, McCollum at Iowa) get acknowledged without inflating
  // them past long-tenured greats. Two tiers:
  //   • 2-4 seasons, 75%+ career W%, majority at expected-tier programs
  //     → +(seasons × 2) — scales with how much data backs the start
  //   • 1 season, 75%+ W%, top-25 BTA rank that year → +3 flat
  // Tommy Lloyd hits the 5-season mark so he goes through the regular
  // career-arc pipeline and doesn't get this bonus.
  if (profile.career_win_pct != null) {
    const expectedSeasons = profile.by_year.filter(isExpectedTier).length;
    const majorityExpected = expectedSeasons / Math.max(1, profile.seasons_count) >= 0.5;
    if (
      profile.seasons_count >= 2 &&
      profile.seasons_count <= 4 &&
      profile.career_win_pct >= 0.75 &&
      majorityExpected
    ) {
      total += profile.seasons_count * 2;
    } else if (profile.seasons_count === 1 && profile.career_win_pct >= 0.75) {
      // 1-season case requires that single season to be top-25 BTA so we
      // only reward genuine standouts, not random one-year flashes.
      const bestRank = profile.by_year[0]?.bta_rank;
      if (bestRank != null && bestRank <= 25) total += 3;
    }
  }

  if (careerArcEligible) {
    // Powerhouse-without-a-ring tax — Mark Few archetype. −0.5 per blueblood
    // season when career-window title count is zero.
    if (titles === 0) {
      const ringlessYearsAtPowerhouse = profile.by_year.filter((s) =>
        BLUEBLOOD_PROGRAMS.has(s.team),
      ).length;
      total += ringlessYearsAtPowerhouse * -0.5;
    }

    // "Harder path" title bonus — non-elite blueblood titles (Villanova,
    // Virginia, etc.) +5/title.
    const titleAtBorderlineBlueblood = profile.by_year.filter(
      (s) =>
        s.round === "Champion" &&
        BLUEBLOOD_PROGRAMS.has(s.team) &&
        !ELITE_BLUEBLOOD.has(s.team),
    ).length;
    total += titleAtBorderlineBlueblood * 5;

    // Villanova-specific extra bump — removed per editorial preference;
    // Wright still gets the non-elite blueblood bonus + multi-title +
    // dynasty bonuses. Left as a comment so the rationale isn't lost.

    // Power-conf reg-season champ accumulation — owning your league is a
    // sustained-excellence marker the per-season +3 (reg-champ + Power bonus)
    // already partially captures. Career-level bump rewards multiple titles
    // beyond what cumulative season points alone produce. Slight at 4+, a
    // little more at 8+.
    {
      const powerRegChamps = profile.by_year.filter(
        (s) => s.reg_season_conf_champ && s.conference != null && POWER_CONFS.has(s.conference),
      ).length;
      if (powerRegChamps >= 8) total += 5;
      else if (powerRegChamps >= 4) total += 3;
    }

    // Thin-deep-résumé tax — 8+ Power-conf seasons with no title and ≤1
    // Final Four signals a coach who maxes regular-season production but
    // underwhelms when it matters most. Captures the Cronin/Painter/Altman
    // pattern: long Power-conf careers without the proportional March peak.
    // Threshold of 8 lets coaches with split Power/non-Power careers (Cronin
    // at Cincinnati AAC + UCLA Power) qualify on the Power portion alone.
    // −2 career-level.
    {
      const finalFours = profile.by_year.filter(
        (s) => s.round === "Final Four" || s.round === "Runner-up" || s.round === "Champion",
      ).length;
      const powerSeasons = profile.by_year.filter(
        (s) => s.conference != null && POWER_CONFS.has(s.conference),
      ).length;
      if (powerSeasons >= 8 && titles === 0 && finalFours <= 1) {
        total -= 2;
      }
    }

    // NCAA tournament reliability — coaches who show up in March nearly every
    // year carry weight beyond per-season reach points. 12+ tournament
    // appearances in the data window separates the consistently-elite from
    // coaches with NIT gaps (Izzo's 13-for-13 vs Calipari's 11-for-13).
    {
      const ncaaAppearances = profile.by_year.filter((s) => s.round != null).length;
      if (ncaaAppearances >= 12) total += 2;
    }

    // Never-missed-the-tournament bonus — a tiny extra +1 for coaches who
    // made the tournament every season they coached, ignoring the cancelled
    // 2020 (which would otherwise disqualify everyone). Already gated by the
    // 5-season career-arc check above, so 1-year wonders don't qualify.
    {
      const eligibleSeasons = profile.by_year.filter((s) => s.year !== 2020);
      if (eligibleSeasons.length > 0 && eligibleSeasons.every((s) => s.round != null)) {
        total += 1;
      }
    }

    // Sweet 16 accumulation — repeated second-weekend trips signal sustained
    // tournament excellence beyond what the per-season reach points capture.
    // Slight career-level bump at 8+, a little more at 12+.
    {
      const sweetSixteenPlus = profile.by_year.filter((s) => {
        if (s.round == null) return false;
        return (
          s.round === "Sweet 16" ||
          s.round === "Elite Eight" ||
          s.round === "Final Four" ||
          s.round === "Runner-up" ||
          s.round === "Champion"
        );
      }).length;
      if (sweetSixteenPlus >= 12) total += 5;
      else if (sweetSixteenPlus >= 8) total += 3;
    }

    // 80%+ career win-pct at a Power-conf program — exclusive club. Requires
    // a majority of seasons played in Power conferences.
    if (profile.career_win_pct != null && profile.career_win_pct >= 0.80) {
      const powerSeasons = profile.by_year.filter(
        (s) => s.conference != null && POWER_CONFS.has(s.conference),
      ).length;
      if (powerSeasons / profile.seasons_count >= 0.5) {
        total += 10;
      }
    }

    // Multi-title bonus + dynasty cluster — +10 per title past the first,
    // plus +10 if back-to-back (gap 1, historically unprecedented in the
    // modern era) or +5 if 2 in 3 years (gap 2).
    if (titles >= 2) {
      total += (titles - 1) * 10;
      const titleYears = profile.by_year
        .filter((s) => s.round === "Champion")
        .map((s) => s.year)
        .sort((a, b) => a - b);
      let bestGap = Infinity;
      for (let i = 0; i < titleYears.length - 1; i++) {
        bestGap = Math.min(bestGap, titleYears[i + 1]! - titleYears[i]!);
      }
      if (bestGap === 1) total += 10;
      else if (bestGap === 2) total += 5;
    }
  }

  // Fast 3-start bonus — coach won 20+ games in EACH of their first 3
  // seasons at a school. Rewards immediate, sustained impact (Tommy Lloyd
  // at Arizona, Wade at LSU's first stint, etc.). +5 per qualifying school
  // so multi-program coaches who repeated the feat get rewarded twice.
  // Sits outside the career-arc gate — short-tenure coaches who pull this
  // off deserve recognition even before the 5-season mark.
  {
    const byTeam = new Map<string, CoachSeason[]>();
    for (const s of profile.by_year) {
      if (!byTeam.has(s.team)) byTeam.set(s.team, []);
      byTeam.get(s.team)!.push(s);
    }
    for (const [, teamSeasons] of byTeam) {
      const sorted = [...teamSeasons].sort((a, b) => a.year - b.year);
      const first3 = sorted.slice(0, 3);
      if (first3.length === 3 && first3.every((s) => (s.wins ?? 0) >= 20)) {
        total += 5;
      }
    }
  }

  // Blend a per-season-quality component into the cumulative composite —
  // 75% raw sum + 25% (per-season × 14). The ×14 normalizes per-season to
  // the scale of a full 14-year career, so coaches with full tenure who
  // performed consistently are unchanged; short-tenure standouts get
  // boosted by their per-season rate; long-tenure mediocre piles up less.
  const TARGET_TENURE = 14;
  const perSeason = profile.seasons_count > 0 ? total / profile.seasons_count : 0;
  const blended = total * 0.75 + perSeason * TARGET_TENURE * 0.25;

  return Math.round(blended * 10) / 10;
}

// ---------- exports ----------

export async function loadAllCoachProfiles(): Promise<CoachProfile[]> {
  const raw = await loadRawSources();
  const seasons = flattenSeasons(raw);
  const withCoach = attachCoachNames(seasons, raw);
  const profiles = profilesFromSeasons(withCoach, raw);

  // Attach composite résumé score. Load tournament games once and share the
  // (team, year) lookup across all profiles.
  const tGames = await loadTournamentGames();
  const gamesLookup = buildGamesByTeamYear(tGames);
  for (const p of profiles) {
    p.composite_score = computeCompositeScore(p, gamesLookup);
  }
  return profiles;
}

export async function loadCoachIndex(): Promise<CoachIndexRow[]> {
  const profiles = await loadAllCoachProfiles();
  // Strip the heavy fields for the index page. composite_score is small (one
  // number) and serves the table, so it stays.
  return profiles.map(({ by_year: _b, schools: _s, best_season: _bs, worst_season: _ws, best_record_season: _br, ...row }) => {
    void _b; void _s; void _bs; void _ws; void _br;
    return row;
  });
}

export async function loadCoachProfile(slug: string): Promise<CoachProfile | null> {
  const profiles = await loadAllCoachProfiles();
  return profiles.find((p) => p.slug === slug) ?? null;
}

/**
 * Load all NCAA Tournament games (winner/loser, score, round) by year. The
 * SR scrape stores them in `src/data/tournament-games.json`. Returns the raw
 * map; callers index into it as needed.
 */
export async function loadTournamentGames(): Promise<Record<string, TourneyGame[]>> {
  const file = path.join(path.resolve("src/data"), "tournament-games.json");
  if (!existsSync(file)) return {};
  return JSON.parse(await fs.readFile(file, "utf8"));
}

/**
 * Build a lookup of games-played-by-(school, year) for fast resolution in the
 * Tournament Success component. School names normalized to lowercase + non-alphanum
 * stripped, since SR's bracket names (e.g. "Mount St. Mary's") may not match
 * Bart's per-team names exactly.
 */
function normSchool(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "");
}
export function buildGamesByTeamYear(games: Record<string, TourneyGame[]>): Map<string, TourneyGame[]> {
  const out = new Map<string, TourneyGame[]>();
  for (const [year, list] of Object.entries(games)) {
    for (const g of list) {
      for (const cell of [g.winner, g.loser]) {
        const key = `${normSchool(cell.school)}|${year}`;
        const arr = out.get(key) ?? [];
        arr.push(g);
        out.set(key, arr);
      }
    }
  }
  // Sort each team's games by round depth so callers can render in order.
  const order: Record<TourneyRound, number> = {
    "First Four": 0, R64: 1, R32: 2, "Sweet 16": 3, "Elite Eight": 4,
    "Final Four": 5, "Runner-up": 6, Champion: 7,
  };
  for (const arr of out.values()) arr.sort((a, b) => order[a.round] - order[b.round]);
  return out;
}

/**
 * Bart name → SR (tournament-games.json) name. Only for schools where the
 * two sources use materially different strings — the broad ".St." vs ".State"
 * difference is handled by the suffix transform below. Add new entries here
 * when an alias-needed school surfaces.
 */
const BART_TO_SR_ALIAS: Record<string, string> = {
  "Connecticut":              "UConn",
  "North Carolina":           "UNC",
  "Pittsburgh":               "Pitt",
  "Mississippi":              "Ole Miss",
  "Massachusetts":            "UMass",
  "East Tennessee St.":       "ETSU",
  "N.C. State":               "NC State",
  "McNeese St.":              "McNeese",
  "Miami FL":                 "Miami (FL)",
  "Miami OH":                 "Miami (OH)",
  "Loyola Chicago":           "Loyola (IL)",
  "St. John's":               "St. John's (NY)",
  "Charleston":               "College of Charleston",
  "Fairleigh Dickinson":      "FDU",
  "Cal Baptist":              "California Baptist",
  "Albany":                   "Albany (NY)",
  "Queens":                   "Queens (NC)",
  "Gardner Webb":             "Gardner-Webb",
  "SIU Edwardsville":         "SIU-Edwardsville",
  "Texas A&M Corpus Chris":   "Texas A&M-Corpus Christi",
  "Nebraska Omaha":           "Omaha",
  "Grambling St.":            "Grambling",
};

export function gamesForTeamYear(
  lookup: Map<string, TourneyGame[]>,
  team: string,
  year: number,
): TourneyGame[] {
  const direct = lookup.get(`${normSchool(team)}|${year}`);
  if (direct) return direct;

  // Hand-curated aliases for schools where Bart and SR use materially
  // different names (UConn ↔ Connecticut, UNC ↔ North Carolina, etc).
  const srAlias = BART_TO_SR_ALIAS[team];
  if (srAlias) {
    const aliased = lookup.get(`${normSchool(srAlias)}|${year}`);
    if (aliased) return aliased;
  }

  // Bart uses "Michigan St." while SR uses "Michigan State". 62 schools
  // differ on this suffix alone. Try the expanded form before giving up.
  if (/\bSt\.$/.test(team)) {
    const expanded = team.replace(/\bSt\.$/, "State");
    const aliased = lookup.get(`${normSchool(expanded)}|${year}`);
    if (aliased) return aliased;
  }
  return [];
}

/**
 * NCAA Tournament wins for a coach across the data window. Each round reached
 * implies a fixed number of wins (R64=0, R32=1, S16=2, E8=3, F4=4, NF=5, C=6).
 */
const ROUND_WINS_LOOKUP: Record<TourneyRound, number> = {
  "First Four": 0,
  "R64": 0,
  "R32": 1,
  "Sweet 16": 2,
  "Elite Eight": 3,
  "Final Four": 4,
  "Runner-up": 5,
  "Champion": 6,
};
export function tournamentWinsForCoach(profile: CoachProfile): number {
  return profile.by_year.reduce(
    (sum, s) => sum + (s.round ? ROUND_WINS_LOOKUP[s.round] : 0),
    0,
  );
}

/**
 * Rank-among-all-coaches by tournament wins. Returns { rank, total } where
 * `total` is the number of coaches with ≥1 tournament appearance.
 */
export function tournamentWinsRank(
  profiles: CoachProfile[],
  target: CoachProfile,
): { rank: number; total: number; wins: number } {
  const tally = profiles.map((p) => ({ slug: p.slug, wins: tournamentWinsForCoach(p) }))
    .filter((t) => t.wins > 0 || profiles.find((p) => p.slug === t.slug)?.by_year.some((s) => s.seed !== null));
  tally.sort((a, b) => b.wins - a.wins);
  const idx = tally.findIndex((t) => t.slug === target.slug);
  return { rank: idx >= 0 ? idx + 1 : 0, total: tally.length, wins: tally[idx]?.wins ?? 0 };
}

// ---------- legacy types kept for the existing /coaches index ----------

export type CoachTeamRow = {
  name: string;
  team_name: string;
  conference: string | null;
  record: string | null;
  wins: number | null;
  losses: number | null;
  espn_id: string | null;
};

/**
 * Legacy loader — single-season ESPN snapshot only. Retained while the index
 * page transitions to the new loadCoachIndex() shape. New code should use
 * loadCoachIndex() / loadCoachProfile().
 */
export async function loadCoachTeamRows(): Promise<CoachTeamRow[]> {
  const dataDir = path.resolve("src/data");
  const espnPath = path.join(dataDir, "team-coaches.json");
  let raw: Record<string, EspnCoach> = {};
  if (existsSync(espnPath)) {
    raw = JSON.parse(await fs.readFile(espnPath, "utf8"));
  }
  const teams = await readAllTeams();
  type TeamRecord = { conference: string | null; record: string | null; wins: number | null; losses: number | null };
  const meta = new Map<string, TeamRecord>();
  for (const t of teams) {
    if (t.year !== LATEST_YEAR) continue;
    const trank = (t as unknown as { team_trank_stats?: { record?: string | null; wins?: number | null; losses?: number | null } | null }).team_trank_stats;
    meta.set(overrideTeam(t.name), {
      conference: t.conference ?? null,
      record: trank?.record ?? null,
      wins: trank?.wins ?? null,
      losses: trank?.losses ?? null,
    });
  }
  const rows: CoachTeamRow[] = [];
  for (const [bartName, c] of Object.entries(raw)) {
    const team = overrideTeam(bartName);
    const m = meta.get(team);
    rows.push({
      name: c.name,
      team_name: team,
      conference: m?.conference ?? null,
      record: m?.record ?? null,
      wins: m?.wins ?? null,
      losses: m?.losses ?? null,
      espn_id: c.espn_id,
    });
  }
  return rows;
}
