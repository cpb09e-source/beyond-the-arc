/**
 * The Team Game Log Explorer's data layer — the player index's twin.
 *
 * Same packing, same reasoning as src/lib/game-index.ts: integer rows against
 * per-season string tables, and nothing stored that can be derived. Margin,
 * FG%, TS%, defensive rebounds and net rating are all computed here rather
 * than shipped.
 *
 * Built by scripts/build-team-game-index.mjs from two joined sources — see its
 * header for why neither is enough alone.
 */
import { dataUrl } from "@/lib/data-url";

// ── The packed file ────────────────────────────────────────────────────────

export type TeamGamePack = {
  season: number;
  epoch: string;
  epochMs: number;
  fields: string[];
  teams: { names: string[]; confs: string[] };
  opps: string[];
  rows: number[][];
  /**
   * Percentiles that arrived with the file, one array per stat key, aligned to
   * `rows` by index. Present only on the per-team files (see
   * loadTeamSeasonGames); the full-season pack has none and is ranked on the
   * client as it always was.
   *
   * A null entry means the stat was missing for that game, which is what an
   * absent key means in the map the client builds — so both paths render the
   * same chip, or the same nothing.
   */
  pct?: Record<string, Array<number | null>>;
};

/** Column offsets. Mirrors FIELDS in scripts/build-team-game-index.mjs. */
export const T = {
  t: 0, o: 1, d: 2, f: 3,
  pts: 4, pa: 5, poss: 6, pace: 7,
  fgm: 8, fga: 9, fg3m: 10, fg3a: 11, ftm: 12, fta: 13,
  oreb: 14, reb: 15, ast: 16, stl: 17, blk: 18, tov: 19, pf: 20,
  ortg: 21, drtg: 22,
  efg: 23, ftr: 24, tovr: 25, orbr: 26,
  efgd: 27, ftrd: 28, tovd: 29, orbd: 30,
  lead: 31, h1: 32, h2: 33, ot: 34,
  rebDif: 35, tovDif: 36, astDif: 37, stlDif: 38, blkDif: 39, fg3mDif: 40,
  ap: 41, oppAp: 42, seed: 43, oppSeed: 44,
} as const;

/** Bit flags in T.f. */
export const HOME = 1, NEUTRAL = 2, WON = 4, CONF = 8, TOURNEY = 16, POST = 32, NON_D1 = 64;

const CACHE = new Map<number, Promise<TeamGamePack | null>>();

/** Fetch one season, once. A failure resolves to null rather than throwing. */
export function loadTeamGameIndex(season: number): Promise<TeamGamePack | null> {
  const hit = CACHE.get(season);
  if (hit) return hit;
  const p = fetch(dataUrl(`/data/team-game-index/${season}.json`))
    .then((r) => (r.ok ? (r.json() as Promise<Omit<TeamGamePack, "epochMs">>) : null))
    .then((j) => (j ? { ...j, epochMs: Date.parse(`${j.epoch}T00:00:00Z`) } as TeamGamePack : null))
    .catch(() => null);
  CACHE.set(season, p);
  return p;
}

const TEAM_CACHE = new Map<string, Promise<TeamGamePack | null>>();

/**
 * One team's games for one season — about 9 KB, against the 1.6 MB the season
 * costs.
 *
 * WHY IT IS A SEPARATE FILE AND NOT A FILTER. The chip beside every number is
 * ranked against every game in the season, so a client holding one team cannot
 * compute it; that is why the team page used to download the season to draw
 * thirty rows. These files carry the ranking already done, over the same
 * cohort, by the same function — scripts/build-team-season-games.mts imports
 * this module's own TEAM_GAME_STATS rather than restating the formulas.
 *
 * It also closes a hole in the paywall. Team pages are free at every season by
 * decision, but the season corpora behind the explorers are not, and a free
 * 2019 team page fetching the whole 2019 corpus handed out exactly the bytes
 * the gate withholds.
 *
 * A miss resolves to null, and the caller falls back to the season file — so a
 * team-season with no per-team file renders correctly and slowly rather than
 * not at all.
 */
export function loadTeamSeasonGames(season: number, slug: string): Promise<TeamGamePack | null> {
  const key = `${season}|${slug}`;
  const hit = TEAM_CACHE.get(key);
  if (hit) return hit;
  const p = fetch(dataUrl(`/data/team-season-games/${season}/${slug}.json`))
    .then((r) => (r.ok ? (r.json() as Promise<Omit<TeamGamePack, "epochMs">>) : null))
    .then((j) => (j ? { ...j, epochMs: Date.parse(`${j.epoch}T00:00:00Z`) } as TeamGamePack : null))
    .catch(() => null);
  TEAM_CACHE.set(key, p);
  return p;
}

/**
 * Seasons with a file.
 *
 * 2021 IS HERE and its twin in game-index.ts does not have it, which is not an
 * oversight. This index joins the team box and the game logs, and the archive
 * has both for the COVID season — 7,906 team-games across 349 teams, joined
 * with zero misses. The player index needs the per-player box, which that
 * season's archive does not carry at all.
 */
export const TEAM_GAME_SEASONS = [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014];

// ── Reading a row ──────────────────────────────────────────────────────────

const div = (a: number, b: number): number | null => (b > 0 ? a / b : null);
const per = (v: number): number | null => (v ? v / 1000 : null);
const ten = (v: number): number | null => (v ? v / 10 : null);

export type TeamGameStat = {
  key: string;
  label: string;
  title: string;
  fmt: "int" | "num1" | "pct1";
  get: (r: number[]) => number | null;
  lowerBetter?: boolean;
  filterable?: boolean;
  /**
   * Show a percentile chip beside this column. DEFAULTS TO TRUE.
   *
   * Matches the team explorer, which chips every stat column it renders — the
   * point being that a reader moving between the two tables reads the same
   * signal the same way, and does not have to learn which page shows context
   * and which does not.
   *
   * The exceptions are the columns the explorer would not call stats at all:
   * the result flags (W, HOME, CONF, NCAA) and the rank-like context (AP rank,
   * seed), which are identity, not distribution. A percentile of a 3-seed is
   * not a fact about anything.
   *
   * PACE IS THE ONE TO READ CAREFULLY. Its chip means "how fast, ranked", not
   * "how good" — fast is not better than slow. A green 97 says this was a
   * track meet, not that a track meet is the right way to play.
   */
  pct?: boolean;
};

const S = (
  key: string, label: string, fmt: TeamGameStat["fmt"], title: string,
  get: TeamGameStat["get"], extra: Partial<TeamGameStat> = {},
): TeamGameStat => ({ key, label, title, fmt, get, filterable: true, pct: true, ...extra });

export const TEAM_GAME_STATS: TeamGameStat[] = [
  /**
   * NET is the default sort, and the team answer to the player page's Game
   * Score: what a team did per hundred possessions minus what it allowed, in
   * this one game. Points margin alone rewards playing fast; this does not.
   */
  S("net", "NET", "num1",
    "Net rating for this game — offensive rating minus defensive rating, per 100 possessions. The pace-independent version of margin.",
    (r) => {
      const o = ten(r[T.ortg]!), d = ten(r[T.drtg]!);
      return o === null || d === null ? null : o - d;
    }),
  S("margin", "MARGIN", "int", "Final margin. Negative in a loss.",
    (r) => r[T.pts]! - r[T.pa]!),
  S("pts", "PTS", "int", "Points scored.", (r) => r[T.pts]!),
  S("pa", "OPP", "int", "Points allowed.", (r) => r[T.pa]!, { lowerBetter: true }),
  S("poss", "POSS", "int", "Possessions.", (r) => r[T.poss]!),
  S("pace", "PACE", "num1",
    "Possessions per 40 minutes. The percentile ranks how FAST the game was, not how well it was played.",
    (r) => ten(r[T.pace]!)),
  S("ortg", "ORtg", "num1", "Offensive rating — points per 100 possessions.",
    (r) => ten(r[T.ortg]!)),
  S("drtg", "DRtg", "num1", "Defensive rating — points allowed per 100 possessions.",
    (r) => ten(r[T.drtg]!), { lowerBetter: true }),

  S("fgm", "FGM", "int", "Field goals made.", (r) => r[T.fgm]!),
  S("fga", "FGA", "int", "Field goals attempted.", (r) => r[T.fga]!),
  S("fg_pct", "FG%", "pct1", "Field goal percentage.", (r) => div(r[T.fgm]!, r[T.fga]!)),
  S("fg3m", "3PM", "int", "Three-pointers made.", (r) => r[T.fg3m]!),
  S("fg3a", "3PA", "int", "Three-pointers attempted.", (r) => r[T.fg3a]!),
  S("fg3_pct", "3P%", "pct1", "Three-point percentage.", (r) => div(r[T.fg3m]!, r[T.fg3a]!)),
  S("ftm", "FTM", "int", "Free throws made.", (r) => r[T.ftm]!),
  S("fta", "FTA", "int", "Free throws attempted.", (r) => r[T.fta]!),
  S("ft_pct", "FT%", "pct1", "Free throw percentage.", (r) => div(r[T.ftm]!, r[T.fta]!)),
  S("ts", "TS%", "pct1", "True shooting — points per shooting possession, free throws included.",
    (r) => div(r[T.pts]!, 2 * (r[T.fga]! + 0.44 * r[T.fta]!))),

  S("oreb", "OREB", "int", "Offensive rebounds.", (r) => r[T.oreb]!),
  S("dreb", "DREB", "int", "Defensive rebounds.", (r) => r[T.reb]! - r[T.oreb]!),
  S("reb", "REB", "int", "Total rebounds.", (r) => r[T.reb]!),
  S("ast", "AST", "int", "Assists.", (r) => r[T.ast]!),
  S("stl", "STL", "int", "Steals.", (r) => r[T.stl]!),
  S("blk", "BLK", "int", "Blocks.", (r) => r[T.blk]!),
  S("tov", "TOV", "int", "Turnovers.", (r) => r[T.tov]!, { lowerBetter: true }),
  S("pf", "PF", "int", "Personal fouls.", (r) => r[T.pf]!, { lowerBetter: true }),

  // ── The four factors, and what the defence allowed ──────────────────────
  S("efg", "eFG%", "pct1", "Effective field goal percentage — a three counted for what it is worth.",
    (r) => per(r[T.efg]!)),
  S("ftr", "FTR", "pct1", "Free throw rate — free throws attempted per field goal attempt.",
    (r) => per(r[T.ftr]!)),
  S("tovr", "TOV%", "pct1", "Turnover rate — turnovers per possession.",
    (r) => per(r[T.tovr]!), { lowerBetter: true }),
  S("orbr", "ORB%", "pct1", "Offensive rebound rate — share of own misses rebounded.",
    (r) => per(r[T.orbr]!)),
  S("efgd", "eFG% D", "pct1", "Effective field goal percentage allowed.",
    (r) => per(r[T.efgd]!), { lowerBetter: true }),
  S("ftrd", "FTR D", "pct1", "Free throw rate allowed.",
    (r) => per(r[T.ftrd]!), { lowerBetter: true }),
  S("tovd", "TOV% D", "pct1", "Turnover rate forced.", (r) => per(r[T.tovd]!)),
  S("orbd", "ORB% D", "pct1", "Offensive rebound rate allowed.",
    (r) => per(r[T.orbd]!), { lowerBetter: true }),

  // ── Situational ────────────────────────────────────────────────────────
  S("lead", "LEAD", "int", "Largest lead held.", (r) => r[T.lead]!),
  S("h1", "1H", "int", "First-half points.", (r) => r[T.h1]!),
  S("h2", "2H", "int", "Second-half points.", (r) => r[T.h2]!),
  // NO CHIP: 96% of games end in regulation, so a midrank puts every zero at
  // the 47th percentile and paints a column of identical amber on the most
  // common value in the table. Same reasoning as noPct in player-stat-pack.
  S("ot", "OT", "int", "Overtime points. Zero in a game that ended in regulation.",
    (r) => r[T.ot]!, { pct: false }),

  // ── Differentials, straight from the game log ──────────────────────────
  S("reb_dif", "REB±", "int", "Rebound margin.", (r) => r[T.rebDif]!),
  S("ast_dif", "AST±", "int", "Assist margin.", (r) => r[T.astDif]!),
  S("stl_dif", "STL±", "int", "Steal margin.", (r) => r[T.stlDif]!),
  S("blk_dif", "BLK±", "int", "Block margin.", (r) => r[T.blkDif]!),
  S("tov_dif", "TOV±", "int", "Turnover margin — positive means the opponent gave it away more.",
    (r) => r[T.tovDif]!),
  S("fg3m_dif", "3PM±", "int", "Three-point make margin.", (r) => r[T.fg3mDif]!),

  // ── Context, filterable so a question can be asked of it ───────────────
  // Flags read as 0/1 so the filter builder can reach them: "WON ≥ 1" is how
  // you ask for wins, and it composes with everything else.
  S("won", "W", "int", "1 for a win, 0 for a loss.", (r) => ((r[T.f]! & WON) ? 1 : 0), { pct: false }),
  S("home", "HOME", "int", "1 at home, 0 away or neutral.", (r) => ((r[T.f]! & HOME) ? 1 : 0), { pct: false }),
  S("neutral", "NEUT", "int", "1 on a neutral floor.", (r) => ((r[T.f]! & NEUTRAL) ? 1 : 0), { pct: false }),
  S("conf", "CONF", "int", "1 for a conference game.", (r) => ((r[T.f]! & CONF) ? 1 : 0), { pct: false }),
  S("tourney", "NCAA", "int", "1 for an NCAA tournament game.", (r) => ((r[T.f]! & TOURNEY) ? 1 : 0), { pct: false }),
  S("post", "POST", "int", "1 for any postseason game.", (r) => ((r[T.f]! & POST) ? 1 : 0), { pct: false }),
  S("ap", "AP", "int", "AP rank that week. 0 if unranked.", (r) => r[T.ap]!, { pct: false }),
  S("opp_ap", "OPP AP", "int", "Opponent's AP rank that week. 0 if unranked.", (r) => r[T.oppAp]!, { pct: false }),
  S("seed", "SEED", "int", "NCAA tournament seed. 0 outside the tournament.", (r) => r[T.seed]!, { pct: false }),
  S("opp_seed", "OPP SEED", "int", "Opponent's NCAA seed.", (r) => r[T.oppSeed]!, { pct: false }),
];

/**
 * Section headings for the "Add Columns" picker.
 *
 * The views decide what a reader sees BY DEFAULT; this decides how they browse
 * the whole catalogue when the default is not what they wanted. It is a second
 * arrangement of the same stats, not a second set — every key here is a key in
 * TEAM_GAME_STATS, and the assertion below is what keeps that true.
 *
 * Grouped by what the number is ABOUT rather than by view, because a reader
 * hunting for "3P%" looks under shooting whether or not the Scoring view is on
 * screen.
 */
export const TEAM_GAME_GROUPS: Array<{ key: string; label: string; keys: string[] }> = [
  { key: "result", label: "Result & Efficiency",
    keys: ["net", "margin", "pts", "pa", "poss", "pace", "ortg", "drtg"] },
  { key: "shooting", label: "Scoring & Shooting",
    keys: ["fgm", "fga", "fg_pct", "fg3m", "fg3a", "fg3_pct", "ftm", "fta", "ft_pct", "ts"] },
  { key: "box", label: "Rebounding & Defense",
    keys: ["oreb", "dreb", "reb", "ast", "stl", "blk", "tov", "pf"] },
  { key: "factors", label: "Four Factors",
    keys: ["efg", "ftr", "tovr", "orbr", "efgd", "ftrd", "tovd", "orbd"] },
  { key: "diffs", label: "Differentials",
    keys: ["reb_dif", "ast_dif", "stl_dif", "blk_dif", "tov_dif", "fg3m_dif"] },
  { key: "situational", label: "Situational",
    keys: ["lead", "h1", "h2", "ot"] },
  { key: "context", label: "Context",
    keys: ["won", "home", "neutral", "conf", "tourney", "post", "ap", "opp_ap", "seed", "opp_seed"] },
];

export const TEAM_GAME_GROUP_LABEL: Record<string, string> =
  Object.fromEntries(TEAM_GAME_GROUPS.map((g) => [g.key, g.label]));

/** Which section a stat browses under. Every stat has one — see the check below. */
const TEAM_GROUP_OF = new Map<string, string>(
  TEAM_GAME_GROUPS.flatMap((g) => g.keys.map((k) => [k, g.key] as [string, string])),
);

/**
 * The picker's option list, derived rather than hand-kept.
 *
 * Built FROM TEAM_GAME_STATS in group order, so a stat added to the catalogue
 * shows up here the moment it is given a group — and one that is not given a
 * group is dropped loudly in dev rather than silently going missing from the
 * picker.
 */
export const TEAM_GAME_PICK_OPTIONS: Array<{ key: string; label: string; desc: string; group: string }> =
  TEAM_GAME_GROUPS.flatMap((g) =>
    g.keys
      .map((k) => TEAM_GAME_STATS.find((s) => s.key === k))
      .filter((s): s is TeamGameStat => !!s)
      .map((s) => ({ key: s.key, label: s.label, desc: s.title, group: g.key })),
  );

if (process.env.NODE_ENV !== "production") {
  const missing = TEAM_GAME_STATS.filter((s) => !TEAM_GROUP_OF.has(s.key)).map((s) => s.key);
  if (missing.length) console.warn("[team-game-index] stats with no picker group:", missing);
}

/**
 * The date, as a sortable column rather than a suffix on the opponent.
 *
 * NOT IN ANY VIEW — it is an identity column the table always renders, like
 * the team and the opponent. It lives in the catalogue so SortableTh can name
 * it and the sort machinery can find it, and it is unfilterable because a
 * day-offset is not a number anyone would type into a filter box.
 *
 * `get` returns the offset WITHIN a season, which is only half an ordering;
 * selectRows adds the season, because a stat function cannot see which pack
 * its row came from.
 */
export const TEAM_GAME_DATE_STAT: TeamGameStat = {
  key: "date",
  label: "Date",
  title: "Date of the game.",
  fmt: "int",
  get: (r) => r[T.d]!,
  filterable: false,
  pct: false,
};

export const TEAM_GAME_STAT_BY_KEY = new Map(
  [...TEAM_GAME_STATS, TEAM_GAME_DATE_STAT].map((s) => [s.key, s]),
);
export const teamGameStat = (key: string) => TEAM_GAME_STAT_BY_KEY.get(key);

// ── Views ──────────────────────────────────────────────────────────────────

export type TeamGameView = { key: string; label: string; desc: string; keys: string[] };

export const TEAM_GAME_VIEWS: TeamGameView[] = [
  {
    key: "overview", label: "Overview",
    desc: "The result and the shape of it: score, pace, efficiency both ways.",
    keys: ["pts", "pa", "margin", "poss", "pace", "efg", "ts", "ortg", "drtg", "net"],
  },
  {
    key: "scoring", label: "Scoring & Shooting",
    desc: "Every shot the team took, and how many fell.",
    keys: ["pts", "fgm", "fga", "fg_pct", "fg3m", "fg3a", "fg3_pct", "ftm", "fta", "ft_pct", "efg", "ts"],
  },
  {
    key: "four-factors", label: "Four Factors",
    desc: "Dean Oliver's four, and the same four allowed.",
    keys: ["efg", "ftr", "tovr", "orbr", "efgd", "ftrd", "tovd", "orbd", "net"],
  },
  {
    key: "allaround", label: "Rebounding & Defense",
    desc: "The non-scoring box score.",
    keys: ["oreb", "dreb", "reb", "ast", "stl", "blk", "tov", "pf"],
  },
  {
    key: "differentials", label: "Differentials",
    desc: "Margins — what the team did minus what it allowed.",
    keys: ["margin", "reb_dif", "ast_dif", "stl_dif", "blk_dif", "tov_dif", "fg3m_dif", "lead"],
  },
  {
    key: "situational", label: "Situational",
    desc: "Halves, overtime, largest lead, and who was ranked.",
    keys: ["h1", "h2", "ot", "lead", "margin", "ap", "opp_ap", "seed", "opp_seed"],
  },
  {
    key: "everything", label: "Everything",
    desc: "Every column this page has.",
    keys: [
      "pts", "pa", "margin", "poss", "pace", "fgm", "fga", "fg_pct", "fg3m", "fg3a", "fg3_pct",
      "ftm", "fta", "ft_pct", "oreb", "dreb", "reb", "ast", "stl", "blk", "tov", "pf",
      "efg", "ftr", "tovr", "orbr", "efgd", "ftrd", "tovd", "orbd",
      "ortg", "drtg", "net", "lead", "h1", "h2", "ot",
      "reb_dif", "ast_dif", "stl_dif", "blk_dif", "tov_dif", "fg3m_dif",
    ],
  },
];

export const teamGameViewByKey = (key: string | null | undefined): TeamGameView =>
  TEAM_GAME_VIEWS.find((v) => v.key === key) ?? TEAM_GAME_VIEWS[0]!;

// ── Filters ────────────────────────────────────────────────────────────────

/**
 * The comparators, which are the team explorer's comparators.
 *
 * `gte` / `gt` / `lte` / `lt` — the same four the shared FilterRow offers, so a
 * reader who has used the team or players table already knows this one. There
 * is no equality: `TS% = 70` matches nothing on a float, and an operator that
 * silently returns an empty table is worse than one that is not offered.
 *
 * LEGACY ALIASES on the way in. This page shipped with `ge` / `le` / `eq`, so
 * a link somebody kept still has to work. `ge` and `le` are the same question
 * under a new name; `eq` has no equivalent and is DROPPED rather than mapped
 * to something adjacent — a filter that quietly means something else is worse
 * than one that is gone.
 */
export type TeamGameOp = "gt" | "gte" | "lt" | "lte";
export type TeamGameFilter = { stat: string; op: TeamGameOp; value: number };

export const TEAM_OP_LABEL: Record<TeamGameOp, string> = { gte: "≥", gt: ">", lte: "≤", lt: "<" };

/** Pre-rename ops, still honoured on the way in. */
const TEAM_OP_ALIAS: Record<string, TeamGameOp> = { ge: "gte", le: "lte", gte: "gte", gt: "gt", lte: "lte", lt: "lt" };

export function passesTeamFilters(r: number[], filters: TeamGameFilter[]): boolean {
  for (const f of filters) {
    const s = TEAM_GAME_STAT_BY_KEY.get(f.stat);
    if (!s) continue;
    const v = s.get(r);
    if (v === null) return false;
    if (f.op === "gte" && !(v >= f.value)) return false;
    if (f.op === "gt" && !(v > f.value)) return false;
    if (f.op === "lte" && !(v <= f.value)) return false;
    if (f.op === "lt" && !(v < f.value)) return false;
  }
  return true;
}

export function parseTeamFilters(raw: string | null): TeamGameFilter[] {
  if (!raw) return [];
  const out: TeamGameFilter[] = [];
  for (const part of raw.split(",")) {
    const [stat, op, value] = part.split(":");
    if (!stat || !TEAM_GAME_STAT_BY_KEY.has(stat)) continue;
    const mapped = op ? TEAM_OP_ALIAS[op] : undefined;
    if (!mapped) continue;
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    out.push({ stat, op: mapped, value: n });
  }
  return out;
}

export const serializeTeamFilters = (fs: TeamGameFilter[]): string =>
  fs.map((f) => `${f.stat}:${f.op}:${f.value}`).join(",");

/**
 * The shortcuts row — the questions this page exists to answer.
 *
 * Several lean on the flag stats above, which is the whole reason they are
 * filterable: "beat a ranked team" is `won ≥ 1` AND `opp AP between 1 and 25`,
 * and it composes with anything else the reader adds.
 */
export const TEAM_GAME_PRESETS: Array<{ key: string; label: string; desc: string; filters: TeamGameFilter[] }> = [
  { key: "p100", label: "100-point games", desc: "A team scored triple figures.",
    filters: [{ stat: "pts", op: "gte", value: 100 }] },
  { key: "blowout", label: "30-point wins", desc: "Won by thirty or more.",
    filters: [{ stat: "margin", op: "gte", value: 30 }] },
  { key: "lockdown", label: "Held under 50", desc: "Allowed fewer than fifty points.",
    filters: [{ stat: "pa", op: "lte", value: 49 }] },
  { key: "bombs", label: "18+ threes", desc: "Eighteen or more three-pointers made.",
    filters: [{ stat: "fg3m", op: "gte", value: 18 }] },
  { key: "ot", label: "Overtime", desc: "Games that needed extra time.",
    filters: [{ stat: "ot", op: "gte", value: 1 }] },
  { key: "upset", label: "Beat a ranked team", desc: "A win over an AP top-25 opponent.",
    filters: [
      { stat: "won", op: "gte", value: 1 },
      { stat: "opp_ap", op: "gte", value: 1 },
      { stat: "opp_ap", op: "lte", value: 25 },
    ] },
  { key: "ncaa", label: "NCAA tournament", desc: "March Madness games only.",
    filters: [{ stat: "tourney", op: "gte", value: 1 }] },
  { key: "clinic", label: "25+ assists", desc: "Twenty-five or more assists.",
    filters: [{ stat: "ast", op: "gte", value: 25 }] },
];

// ── Formatting ─────────────────────────────────────────────────────────────

export function fmtTeamGameValue(v: number | null, fmt: TeamGameStat["fmt"]): string {
  if (v === null) return "—";
  switch (fmt) {
    case "pct1": return `${(v * 100).toFixed(1)}%`;
    case "num1": return v.toFixed(1);
    default: return String(Math.round(v));
  }
}

export function fmtTeamGameDate(pack: TeamGamePack, r: number[]): string {
  const d = new Date(pack.epochMs + r[T.d]! * 86400000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${String(d.getUTCFullYear()).slice(-2)}`;
}
