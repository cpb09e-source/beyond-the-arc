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
      by_year,
      schools,
      best_season: sortedByPct[0] ? { year: sortedByPct[0].year, team: sortedByPct[0].team, conference: sortedByPct[0].conference, wins: sortedByPct[0].wins, losses: sortedByPct[0].losses, seed: sortedByPct[0].seed, round: sortedByPct[0].round } : null,
      worst_season: sortedByPct[sortedByPct.length - 1] ? { year: sortedByPct[sortedByPct.length - 1]!.year, team: sortedByPct[sortedByPct.length - 1]!.team, conference: sortedByPct[sortedByPct.length - 1]!.conference, wins: sortedByPct[sortedByPct.length - 1]!.wins, losses: sortedByPct[sortedByPct.length - 1]!.losses, seed: sortedByPct[sortedByPct.length - 1]!.seed, round: sortedByPct[sortedByPct.length - 1]!.round } : null,
      best_record_season: sortedByWins[0] ? { year: sortedByWins[0].year, team: sortedByWins[0].team, conference: sortedByWins[0].conference, wins: sortedByWins[0].wins, losses: sortedByWins[0].losses, seed: sortedByWins[0].seed, round: sortedByWins[0].round } : null,
    });
  }
  return profiles;
}

// ---------- exports ----------

export async function loadAllCoachProfiles(): Promise<CoachProfile[]> {
  const raw = await loadRawSources();
  const seasons = flattenSeasons(raw);
  const withCoach = attachCoachNames(seasons, raw);
  return profilesFromSeasons(withCoach, raw);
}

export async function loadCoachIndex(): Promise<CoachIndexRow[]> {
  const profiles = await loadAllCoachProfiles();
  // Strip the heavy fields for the index page.
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

export function gamesForTeamYear(
  lookup: Map<string, TourneyGame[]>,
  team: string,
  year: number,
): TourneyGame[] {
  return lookup.get(`${normSchool(team)}|${year}`) ?? [];
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
