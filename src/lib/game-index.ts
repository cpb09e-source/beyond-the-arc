/**
 * The Game Log Explorer's data layer: a season of player-games, and the stats
 * you can ask of one.
 *
 * The file this loads is built by scripts/build-game-index.mjs — a season's
 * ~115,000 player-games packed as integer rows against a table of player and
 * opponent strings. Everything derivable is derived HERE rather than stored:
 * shooting percentages, true shooting, defensive rebounds and game score cost
 * a division in the browser and six bytes a row over the wire.
 *
 * Rows stay as number arrays for their whole life. A season is 115k rows and
 * the table shows at most 500 of them, so turning every row into an object to
 * find the good ones would allocate a hundred thousand objects to throw away
 * ninety-nine thousand five hundred of them.
 */

import { dataUrl } from "@/lib/data-url";

// ── The packed file ────────────────────────────────────────────────────────


export type GamePack = {
  season: number;
  /** Date of the season's first game; row day-offsets count from here. */
  epoch: string;
  epochMs: number;
  fields: string[];
  classes: string[];
  players: {
    ids: number[];
    names: string[];
    teams: string[];
    confs: string[];
    cls: number[];
    page: number[];
    rank: number[];
  };
  opps: string[];
  rows: number[][];
};

/**
 * Column offsets into a packed row. Mirrors FIELDS in
 * scripts/build-game-index.mjs — the two lists are the same contract written
 * twice, so a change to one is a change to the other.
 */
export const F = {
  p: 0, d: 1, f: 2, o: 3,
  min: 4, pts: 5, fgm: 6, fga: 7, fg3m: 8, fg3a: 9, ftm: 10, fta: 11,
  orb: 12, reb: 13, ast: 14, stl: 15, blk: 16, tov: 17, pf: 18,
  usg: 19, ortg: 20, drtg: 21,
} as const;

/** Flag bits in F.f. */
export const HOME = 1, NEUTRAL = 2, WON = 4, STARTED = 8;

const CACHE = new Map<number, Promise<GamePack | null>>();

/**
 * Fetch one season, once.
 *
 * A failure resolves to null rather than throwing: the table says it has no
 * rows for that season, which is true, instead of taking the page down.
 */
export function loadGameIndex(season: number): Promise<GamePack | null> {
  const hit = CACHE.get(season);
  if (hit) return hit;
  // dataUrl, not a bare path: this dir is R2-mirrored, so in production the
  // file comes from the bucket and the copy under public/ is stripped from the
  // deploy. In development the env var is unset and this resolves to the local
  // path unchanged.
  const p = fetch(dataUrl(`/data/game-index/${season}.json`))
    .then((r) => (r.ok ? (r.json() as Promise<Omit<GamePack, "epochMs">>) : null))
    .then((j) => (j ? { ...j, epochMs: Date.parse(`${j.epoch}T00:00:00Z`) } as GamePack : null))
    .catch(() => null);
  CACHE.set(season, p);
  return p;
}

/** Seasons with a file on disk. 2021 is absent site-wide — the COVID year. */
export const GAME_SEASONS = [2026, 2025, 2024, 2023, 2022, 2020, 2019, 2018, 2017, 2016, 2015, 2014];

// ── Reading a row ──────────────────────────────────────────────────────────

const div = (a: number, b: number): number | null => (b > 0 ? a / b : null);

/**
 * Every stat the explorer can show, filter or sort on.
 *
 * `get` takes the packed row, so a derived stat is a formula rather than a
 * column in the file. `lowerBetter` only affects which way a header sorts on
 * first click — turnovers and fouls should open worst-first, not best-first.
 */
export type GameStat = {
  key: string;
  label: string;
  title: string;
  fmt: "int" | "num1" | "num2" | "pct1";
  get: (r: number[]) => number | null;
  lowerBetter?: boolean;
  /** Offered in the filter builder's list. */
  filterable?: boolean;
};

/**
 * Game Score — Hollinger's single-number line score.
 *
 * The default sort of the whole page, because "best single game" needs one
 * ordering and this is the one that reads closest to how a box score is
 * argued about: scoring efficiently is worth most, volume shooting costs, and
 * the other four columns count for something rather than nothing.
 */
export function gameScore(r: number[]): number {
  return (
    r[F.pts]! +
    0.4 * r[F.fgm]! -
    0.7 * r[F.fga]! -
    0.4 * (r[F.fta]! - r[F.ftm]!) +
    0.7 * r[F.orb]! +
    0.3 * (r[F.reb]! - r[F.orb]!) +
    r[F.stl]! +
    0.7 * r[F.ast]! +
    0.7 * r[F.blk]! -
    0.4 * r[F.pf]! -
    r[F.tov]!
  );
}

const S = (
  key: string, label: string, fmt: GameStat["fmt"], title: string,
  get: GameStat["get"], extra: Partial<GameStat> = {},
): GameStat => ({ key, label, title, fmt, get, filterable: true, ...extra });

export const GAME_STATS: GameStat[] = [
  S("gmsc", "GmSc", "num1",
    "Game Score — Hollinger's one-number summary of a box score line. Roughly: 10 is a solid starter's night, 20 is a very good one, 40+ is a game people remember.",
    gameScore),
  S("min", "MIN", "int", "Minutes played.", (r) => r[F.min]!),
  S("pts", "PTS", "int", "Points scored.", (r) => r[F.pts]!),
  S("reb", "REB", "int", "Total rebounds.", (r) => r[F.reb]!),
  S("orb", "ORB", "int", "Offensive rebounds.", (r) => r[F.orb]!),
  S("drb", "DRB", "int", "Defensive rebounds.", (r) => r[F.reb]! - r[F.orb]!),
  S("ast", "AST", "int", "Assists.", (r) => r[F.ast]!),
  S("stl", "STL", "int", "Steals.", (r) => r[F.stl]!),
  S("blk", "BLK", "int", "Blocks.", (r) => r[F.blk]!),
  S("tov", "TOV", "int", "Turnovers.", (r) => r[F.tov]!, { lowerBetter: true }),
  S("pf", "PF", "int", "Personal fouls.", (r) => r[F.pf]!, { lowerBetter: true }),
  S("fgm", "FGM", "int", "Field goals made.", (r) => r[F.fgm]!),
  S("fga", "FGA", "int", "Field goals attempted.", (r) => r[F.fga]!),
  S("fg_pct", "FG%", "pct1", "Field goal percentage. Blank on a game with no attempt.",
    (r) => div(r[F.fgm]!, r[F.fga]!)),
  S("fg3m", "3PM", "int", "Three-pointers made.", (r) => r[F.fg3m]!),
  S("fg3a", "3PA", "int", "Three-pointers attempted.", (r) => r[F.fg3a]!),
  S("fg3_pct", "3P%", "pct1", "Three-point percentage. Blank on a game with no attempt.",
    (r) => div(r[F.fg3m]!, r[F.fg3a]!)),
  S("fg2m", "2PM", "int", "Two-pointers made.", (r) => r[F.fgm]! - r[F.fg3m]!),
  S("fg2a", "2PA", "int", "Two-pointers attempted.", (r) => r[F.fga]! - r[F.fg3a]!),
  S("ftm", "FTM", "int", "Free throws made.", (r) => r[F.ftm]!),
  S("fta", "FTA", "int", "Free throws attempted.", (r) => r[F.fta]!),
  S("ft_pct", "FT%", "pct1", "Free throw percentage. Blank on a game with no attempt.",
    (r) => div(r[F.ftm]!, r[F.fta]!)),
  S("efg", "eFG%", "pct1",
    "Effective field goal percentage — field goal percentage with a three counted for what it is worth.",
    (r) => div(r[F.fgm]! + 0.5 * r[F.fg3m]!, r[F.fga]!)),
  S("ts", "TS%", "pct1",
    "True shooting — points per shooting possession, counting free throws. Blank on a game with no shot attempt.",
    (r) => div(r[F.pts]!, 2 * (r[F.fga]! + 0.44 * r[F.fta]!))),
  S("usg", "USG%", "pct1",
    "Usage — the share of his team's possessions this player finished while on the floor.",
    (r) => (r[F.usg]! ? r[F.usg]! / 1000 : null)),
  S("ortg", "ORtg", "num1", "Offensive rating — points produced per 100 possessions.",
    (r) => (r[F.ortg]! ? r[F.ortg]! / 10 : null)),
  S("drtg", "DRtg", "num1", "Defensive rating — points allowed per 100 possessions. Lower is better.",
    (r) => (r[F.drtg]! ? r[F.drtg]! / 10 : null), { lowerBetter: true }),
  // Combinations people actually search on. Cheap to derive, and without them
  // "30 and 10" is two filters where the reader thinks in one number.
  S("pra", "P+R+A", "int", "Points plus rebounds plus assists.",
    (r) => r[F.pts]! + r[F.reb]! + r[F.ast]!),
  S("stocks", "STK", "int", "Steals plus blocks — the two ways a box score records a stop.",
    (r) => r[F.stl]! + r[F.blk]!),
];

/**
 * Section headings for the "Add Columns" picker — see the team index's twin
 * block for why this exists alongside the views.
 */
export const GAME_GROUPS: Array<{ key: string; label: string; keys: string[] }> = [
  { key: "overall", label: "Overall",
    keys: ["gmsc", "min", "pts", "pra", "stocks"] },
  { key: "shooting", label: "Scoring & Shooting",
    keys: ["fgm", "fga", "fg_pct", "fg2m", "fg2a", "fg3m", "fg3a", "fg3_pct",
           "ftm", "fta", "ft_pct", "efg", "ts"] },
  { key: "box", label: "Rebounding & Defense",
    keys: ["orb", "drb", "reb", "ast", "stl", "blk", "tov", "pf"] },
  { key: "advanced", label: "Advanced",
    keys: ["usg", "ortg", "drtg"] },
];

export const GAME_GROUP_LABEL: Record<string, string> =
  Object.fromEntries(GAME_GROUPS.map((g) => [g.key, g.label]));

const GAME_GROUP_OF = new Map<string, string>(
  GAME_GROUPS.flatMap((g) => g.keys.map((k) => [k, g.key] as [string, string])),
);

export const GAME_PICK_OPTIONS: Array<{ key: string; label: string; desc: string; group: string }> =
  GAME_GROUPS.flatMap((g) =>
    g.keys
      .map((k) => GAME_STATS.find((s) => s.key === k))
      .filter((s): s is GameStat => !!s)
      .map((s) => ({ key: s.key, label: s.label, desc: s.title, group: g.key })),
  );

if (process.env.NODE_ENV !== "production") {
  const missing = GAME_STATS.filter((s) => !GAME_GROUP_OF.has(s.key)).map((s) => s.key);
  if (missing.length) console.warn("[game-index] stats with no picker group:", missing);
}

/**
 * The date, as a sortable column rather than a suffix on the opponent.
 *
 * Not in any view — an identity column the table always renders. In the
 * catalogue so SortableTh can name it; unfilterable because a day offset is
 * not something anyone types into a filter box. `get` returns the offset
 * within a season, and selectRows adds the season, which a stat function
 * cannot see.
 */
export const GAME_DATE_STAT: GameStat = {
  key: "date",
  label: "Date",
  title: "Date of the game.",
  fmt: "int",
  get: (r) => r[F.d]!,
  filterable: false,
};

export const GAME_STAT_BY_KEY = new Map(
  [...GAME_STATS, GAME_DATE_STAT].map((s) => [s.key, s]),
);
export const gameStat = (key: string): GameStat | undefined => GAME_STAT_BY_KEY.get(key);

// ── Views ──────────────────────────────────────────────────────────────────

export type GameView = { key: string; label: string; desc: string; keys: string[] };

export const GAME_VIEWS: GameView[] = [
  {
    key: "overview", label: "Overview",
    desc: "The line as it would be read out: minutes, the five counting stats, shooting, and Game Score.",
    keys: ["min", "pts", "reb", "ast", "stl", "blk", "fgm", "fga", "fg3m", "ts", "gmsc"],
  },
  {
    key: "scoring", label: "Scoring & Shooting",
    desc: "Every shot taken and made, with the three efficiency figures.",
    keys: ["min", "pts", "fgm", "fga", "fg_pct", "fg3m", "fg3a", "fg3_pct", "ftm", "fta", "ft_pct", "efg", "ts"],
  },
  {
    key: "allaround", label: "All-Around",
    desc: "The non-scoring half of the box score, plus the combined lines people search on.",
    keys: ["min", "pts", "orb", "drb", "reb", "ast", "stl", "blk", "stocks", "tov", "pf", "pra"],
  },
  {
    key: "advanced", label: "Advanced",
    desc: "Rate stats: usage, the two ratings, and efficiency.",
    keys: ["min", "pts", "usg", "ortg", "drtg", "efg", "ts", "gmsc"],
  },
  {
    key: "everything", label: "Everything",
    desc: "Every column this page has.",
    keys: [
      "min", "pts", "fgm", "fga", "fg_pct", "fg3m", "fg3a", "fg3_pct", "ftm", "fta", "ft_pct",
      "orb", "drb", "reb", "ast", "stl", "blk", "tov", "pf", "efg", "ts", "usg", "ortg", "drtg",
      "pra", "stocks", "gmsc",
    ],
  },
];

export const gameViewByKey = (key: string | null | undefined): GameView =>
  GAME_VIEWS.find((v) => v.key === key) ?? GAME_VIEWS[0]!;

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
export type GameOp = "gt" | "gte" | "lt" | "lte";
export type GameFilter = { stat: string; op: GameOp; value: number };

export const OP_LABEL: Record<GameOp, string> = { gte: "≥", gt: ">", lte: "≤", lt: "<" };

/** Pre-rename ops, still honoured on the way in. */
const OP_ALIAS: Record<string, GameOp> = { ge: "gte", le: "lte", gte: "gte", gt: "gt", lte: "lte", lt: "lt" };

export function passesFilters(r: number[], filters: GameFilter[]): boolean {
  for (const f of filters) {
    const s = GAME_STAT_BY_KEY.get(f.stat);
    if (!s) continue;
    const v = s.get(r);
    // A blank stat fails every comparison rather than passing one. "3P% ≥ 50"
    // must not return the games where nobody shot a three.
    if (v === null) return false;
    if (f.op === "gte" && !(v >= f.value)) return false;
    if (f.op === "gt" && !(v > f.value)) return false;
    if (f.op === "lte" && !(v <= f.value)) return false;
    if (f.op === "lt" && !(v < f.value)) return false;
  }
  return true;
}

/** `pts:ge:30,reb:ge:10` — short enough to live in a shareable URL. */
export function parseFilters(raw: string | null): GameFilter[] {
  if (!raw) return [];
  const out: GameFilter[] = [];
  for (const part of raw.split(",")) {
    const [stat, op, value] = part.split(":");
    if (!stat || !GAME_STAT_BY_KEY.has(stat)) continue;
    const mapped = op ? OP_ALIAS[op] : undefined;
    if (!mapped) continue;
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    out.push({ stat, op: mapped, value: n });
  }
  return out;
}

export const serializeFilters = (fs: GameFilter[]): string =>
  fs.map((f) => `${f.stat}:${f.op}:${f.value}`).join(",");

/**
 * The shortcuts row.
 *
 * These are the questions the page exists to answer, spelled as filter sets so
 * that picking one leaves the reader inside the builder rather than in a mode
 * they have to leave. Each is a real feat, not a round number chosen for looks:
 * a 40-point game happens a few dozen times a season, a 5x5 once or twice.
 */
export const GAME_PRESETS: Array<{ key: string; label: string; desc: string; filters: GameFilter[] }> = [
  { key: "p40", label: "40-point games", desc: "Every 40-point performance.",
    filters: [{ stat: "pts", op: "gte", value: 40 }] },
  { key: "td", label: "Triple-doubles", desc: "Points, rebounds and assists all in double figures.",
    filters: [
      { stat: "pts", op: "gte", value: 10 },
      { stat: "reb", op: "gte", value: 10 },
      { stat: "ast", op: "gte", value: 10 },
    ] },
  { key: "2010", label: "20 & 10", desc: "Twenty points and ten rebounds.",
    filters: [{ stat: "pts", op: "gte", value: 20 }, { stat: "reb", op: "gte", value: 10 }] },
  { key: "5x5", label: "5×5", desc: "Five or more in all five counting stats — the rarest line in the box score.",
    filters: [
      { stat: "pts", op: "gte", value: 5 }, { stat: "reb", op: "gte", value: 5 },
      { stat: "ast", op: "gte", value: 5 }, { stat: "stl", op: "gte", value: 5 },
      { stat: "blk", op: "gte", value: 5 },
    ] },
  { key: "bombs", label: "8+ threes", desc: "Eight or more three-pointers made.",
    filters: [{ stat: "fg3m", op: "gte", value: 8 }] },
  { key: "swat", label: "7+ blocks", desc: "Seven or more blocks.",
    filters: [{ stat: "blk", op: "gte", value: 7 }] },
  { key: "dime", label: "12+ assists", desc: "Twelve or more assists.",
    filters: [{ stat: "ast", op: "gte", value: 12 }] },
  { key: "eff", label: "Perfect 15+", desc: "Fifteen points or more without missing a shot.",
    filters: [
      { stat: "pts", op: "gte", value: 15 },
      { stat: "fg_pct", op: "gte", value: 1 },
      { stat: "fga", op: "gte", value: 5 },
    ] },
];

// ── Formatting ─────────────────────────────────────────────────────────────

export function fmtGameValue(v: number | null, fmt: GameStat["fmt"]): string {
  if (v === null) return "—";
  switch (fmt) {
    case "pct1": return `${(v * 100).toFixed(1)}%`;
    case "num1": return v.toFixed(1);
    case "num2": return v.toFixed(2);
    default: return String(Math.round(v));
  }
}

/** A row's date, as a real Date, from the pack's epoch and the row's offset. */
export function rowDate(pack: GamePack, r: number[]): Date {
  return new Date(pack.epochMs + r[F.d]! * 86400000);
}

export function fmtGameDate(pack: GamePack, r: number[]): string {
  const d = rowDate(pack, r);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${String(d.getUTCFullYear()).slice(-2)}`;
}
