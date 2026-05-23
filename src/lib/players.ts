/**
 * Player query helpers. Bart's player advanced-stats CSV has no header; we
 * read by column position against a Cooper Flagg "rosetta stone" row.
 */

// Player CSV columns confirmed against Cooper Flagg 2024-25 and Robby Carmody
// 2024-25 rows. Stable across years.
export const PLAYER_COLS = {
  // From start
  name: 0,
  school: 1,
  conference: 2,
  games: 3,
  ft_made: 13,
  ft_att: 14,
  ft_pct: 15,
  fg2_made: 16,
  fg2_att: 17,
  fg2_pct: 18,
  fg3_made: 19,
  fg3_att: 20,
  fg3_pct: 21,
  class: 25,
  height: 26,
  year: 31,
  player_id: 32,
  hometown: 33,
  porpag: 28,                // Bart Torvik PORPAG — verified Flagg 5.99
  missed_ft_pg: 44,          // (FTA - FTM) / games — verified Flagg 0.92, Broome 0.94
  missed_fg_pg: 52,          // (FGA - FGM) / games — verified Flagg 6.96, Broome 6.71
  min_pg: 54,                // MPG — verified Flagg 30.68, Sears 32.26
  // From end (offset 0 = last column)
  dob_offset: 0,
  projection_offset: 1,
  notes_offset: 2,           // "Stretch 4", "Combo G"
  pts_pg_offset: 3,
  blk_pg_offset: 4,
  stl_pg_offset: 5,
  ast_pg_offset: 6,
  reb_pg_offset: 7,
  drb_pg_offset: 8,          // verified Flagg 6.16 (matches reb_pg − orb_pg)
  orb_pg_offset: 9,          // verified Flagg 1.32
} as const;

type RawCell = string | number | null;
type RawRow = RawCell[] | null;

function fromStart(row: RawRow, idx: number): RawCell {
  if (!row || row.length <= idx) return null;
  return row[idx] ?? null;
}
function fromEnd(row: RawRow, offset: number): RawCell {
  if (!row || row.length <= offset) return null;
  return row[row.length - 1 - offset] ?? null;
}
function asNum(v: RawCell): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export type PlayerSummary = {
  id: number;                   // players.id (per-season DB id)
  bart_player_id: number | null;
  name: string;
  team_name: string;
  team_conference: string | null;
  team_id: number;
  year: number;
  class: string | null;
  height: string | null;
  hometown: string | null;
  position_note: string | null;
  games: number | null;
  min_pg: number | null;
  pts_pg: number | null;
  reb_pg: number | null;
  ast_pg: number | null;
  stl_pg: number | null;
  blk_pg: number | null;
  fg_pct: number | null;        // combined 2P+3P percentage
  fg3_pct: number | null;
  fg2_pct: number | null;
  ft_pct: number | null;
  ts_pct: number | null;        // PTS / (2 * (FGA + 0.44 * FTA))
  efg_pct: number | null;       // (FGM + 0.5 * 3PM) / FGA
  fta_rate: number | null;      // FTA / FGA
  orb_pg: number | null;        // offensive rebounds per game
  // Per-season aggregates from CBB Analytics player_game_stats (see export
  // script's PlayerAdvancedAggregate). Null when the player has no CBB
  // game-log coverage for the season (~5% of historical seasons).
  tov_pg: number | null;        // turnovers per game
  usage_pct: number | null;     // usage rate (fraction, e.g. 0.305 = 30.5%)
  plus_minus_pg: number | null; // average plus-minus per game
  ast_to_tov: number | null;    // assist-to-turnover ratio (ast_pg / tov_pg)
  pir: number | null;           // EuroLeague PIR per game (minus TOV; see note)
  porpag: number | null;        // Bart Torvik Points Over Replacement Player per Adj Game
  bta_ind_ortg: number | null;  // avg(z(PIR), z(PORPAG)) * 20, with 12% non-power-conf penalty
  fg3_made: number | null;
  fg3_att: number | null;
};

// ---------- Stat filter columns ----------
// Filterable per-player stats grouped for the SearchableSelect dropdown.
// Each key maps 1:1 to a PlayerSummary field (see statKeyToField below).
// Groups render in `PLAYER_STAT_GROUP_ORDER` order; mirrors the editorial
// pattern from the team explorer's TEAM_STAT_COLUMNS.

export type PlayerStatGroup = "advanced" | "offense" | "shooting" | "defense" | "volume";

export type PlayerStatColumn = {
  key: string;
  label: string;
  desc: string;
  group: PlayerStatGroup;
  format: "pct1" | "num1" | "num2";
  field: keyof PlayerSummary;
};

export const PLAYER_STAT_COLUMNS: PlayerStatColumn[] = [
  // ── Advanced ─────────────────────────────────────────────
  { key: "bta_prtg", label: "BTA PRTG", desc: "Beyond the Arc Player Rating (z-composite × 20, with cohort + position adjustments)", group: "advanced", format: "num1", field: "bta_ind_ortg" },
  { key: "pir",      label: "PIR",      desc: "EuroLeague Performance Index Rating (per game, minus TOV)",                              group: "advanced", format: "num1", field: "pir" },
  { key: "pm_pg",    label: "+/-",      desc: "Average plus-minus per game (team point differential while on the court)",              group: "advanced", format: "num1", field: "plus_minus_pg" },
  { key: "ast_tov",  label: "AST/TOV",  desc: "Assist-to-turnover ratio (assists per game ÷ turnovers per game)",                       group: "advanced", format: "num2", field: "ast_to_tov" },

  // ── Offense ──────────────────────────────────────────────
  { key: "ppg",     label: "PPG",   desc: "Points per game",                                                   group: "offense", format: "num1", field: "pts_pg" },
  { key: "apg",     label: "APG",   desc: "Assists per game",                                                  group: "offense", format: "num1", field: "ast_pg" },
  { key: "rpg",     label: "RPG",   desc: "Rebounds per game",                                                 group: "offense", format: "num1", field: "reb_pg" },
  { key: "orpg",    label: "OREB",  desc: "Offensive rebounds per game",                                       group: "offense", format: "num1", field: "orb_pg" },
  { key: "tov_pg",  label: "TOV",   desc: "Turnovers per game (lower is better)",                              group: "offense", format: "num1", field: "tov_pg" },
  { key: "usg_pct", label: "USG%",  desc: "Usage rate — fraction of team possessions ending with this player",  group: "offense", format: "pct1", field: "usage_pct" },

  // ── Shooting ─────────────────────────────────────────────
  { key: "fg_pct",   label: "FG%",       desc: "Field goal % (combined 2P + 3P)",                        group: "shooting", format: "pct1", field: "fg_pct" },
  { key: "fg3_pct",  label: "3P%",       desc: "3-point %",                                               group: "shooting", format: "pct1", field: "fg3_pct" },
  { key: "fg2_pct",  label: "2P%",       desc: "2-point %",                                               group: "shooting", format: "pct1", field: "fg2_pct" },
  { key: "ft_pct",   label: "FT%",       desc: "Free-throw %",                                            group: "shooting", format: "pct1", field: "ft_pct" },
  { key: "ts_pct",   label: "TS%",       desc: "True shooting %: PTS / (2 × (FGA + 0.44 × FTA))",         group: "shooting", format: "pct1", field: "ts_pct" },
  { key: "efg_pct",  label: "eFG%",      desc: "Effective FG%: (FGM + 0.5 × 3PM) / FGA",                  group: "shooting", format: "pct1", field: "efg_pct" },
  { key: "fta_rate", label: "FTA Rate",  desc: "Free-throw attempts / FG attempts (line-drawing volume)", group: "shooting", format: "pct1", field: "fta_rate" },

  // ── Defense ──────────────────────────────────────────────
  { key: "spg", label: "SPG", desc: "Steals per game",  group: "defense", format: "num1", field: "stl_pg" },
  { key: "bpg", label: "BPG", desc: "Blocks per game",  group: "defense", format: "num1", field: "blk_pg" },

  // ── Volume ───────────────────────────────────────────────
  { key: "gp",  label: "GP",  desc: "Games played",   group: "volume", format: "num1", field: "games" },
  { key: "mpg", label: "MPG", desc: "Minutes per game", group: "volume", format: "num1", field: "min_pg" },
];

export const PLAYER_STAT_GROUP_LABEL: Record<PlayerStatGroup, string> = {
  advanced: "Advanced",
  offense:  "Offense",
  shooting: "Shooting",
  defense:  "Defense",
  volume:   "Volume",
};

const PLAYER_STAT_COLUMN_BY_KEY = new Map(PLAYER_STAT_COLUMNS.map((c) => [c.key, c]));
function isPlayerStatKey(s: string | undefined): s is string {
  return !!s && PLAYER_STAT_COLUMN_BY_KEY.has(s);
}

export type PlayerComparator = "gt" | "gte" | "lt" | "lte";
function isPlayerComparator(s: string): s is PlayerComparator {
  return s === "gt" || s === "gte" || s === "lt" || s === "lte";
}

export type PlayerStatFilter = { stat: string; op: PlayerComparator; value: number };

export type PlayerListSpec = {
  years: number[];             // multi-select; any combination of seasons
  conf: string[];              // empty = all conferences
  teams: string[];             // empty = all teams
  cls: string[];               // empty = all classes; each = "Fr" | "So" | "Jr" | "Sr" | "Gr"
  pos: ("G" | "F" | "C")[];    // empty = all positions; bucket derived from Bart's position note
  minGames: number;
  filters: PlayerStatFilter[]; // stat threshold filters (AND-combined)
  sortBy: "bta_ind_ortg" | "pir" | "pts" | "reb" | "ast" | "fg_pct" | "fg3_pct" | "ts_pct" | "games" | "name";
  sortDir: "asc" | "desc";
  limit: number;
};

export const DEFAULT_PLAYER_SPEC: PlayerListSpec = {
  years: [2026],
  conf: [],
  teams: [],
  cls: [],
  pos: [],
  minGames: 10,
  filters: [],
  sortBy: "bta_ind_ortg",
  sortDir: "desc",
  limit: 100,
};

// Apply a single stat filter to a PlayerSummary. Returns true if the player
// passes (null stat values always fail — keeps the filter strict and
// predictable rather than silently letting in unranked rows).
export function passesPlayerFilter(p: PlayerSummary, f: PlayerStatFilter): boolean {
  const col = PLAYER_STAT_COLUMN_BY_KEY.get(f.stat);
  if (!col) return true;
  const raw = p[col.field];
  if (typeof raw !== "number" || !Number.isFinite(raw)) return false;
  switch (f.op) {
    case "gt":  return raw >  f.value;
    case "gte": return raw >= f.value;
    case "lt":  return raw <  f.value;
    case "lte": return raw <= f.value;
  }
}

function clampYear(y: number): number {
  if (!Number.isFinite(y)) return DEFAULT_PLAYER_SPEC.years[0]!;
  return Math.max(2013, Math.min(2026, Math.trunc(y)));
}

export function parsePlayerSpec(searchParams: Record<string, string | string[] | undefined>): PlayerListSpec {
  const get = (k: string) => {
    const v = searchParams[k];
    return Array.isArray(v) ? v[0] : v;
  };
  // Years: prefer ?ys=2024,2025; fall back to legacy ?year=2026.
  let years: number[] = [];
  const ys = get("ys");
  if (ys) {
    years = ys
      .split(",")
      .map((s) => clampYear(Number(s.trim())))
      .filter((n, i, a) => a.indexOf(n) === i);
  } else if (get("year") !== undefined) {
    years = [clampYear(Number(get("year")))];
  }
  if (years.length === 0) years = [...DEFAULT_PLAYER_SPEC.years];
  years.sort((a, b) => b - a); // newest-first

  // Conf / team / cls: comma-separated. Legacy single-value forms split to a
  // one-element array, so old ?conf=ACC and ?cls=Fr bookmarks still work.
  const confRaw = get("conf");
  const conf = confRaw ? confRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const teamRaw = get("team");
  const teams = teamRaw ? teamRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const clsRaw = get("cls");
  const cls = clsRaw ? clsRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const posRaw = get("pos");
  const pos = posRaw
    ? (posRaw
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter((s): s is "G" | "F" | "C" => s === "G" || s === "F" || s === "C"))
    : [];

  // Stat filters serialized as ?f0=ppg.gte.15&f1=ts_pct.gt.0.6 — mirrors
  // the team explorer's URL encoding. Cap at 8 to keep URLs bounded.
  const filters: PlayerStatFilter[] = [];
  for (let i = 0; i < 8; i++) {
    const raw = get(`f${i}`);
    if (!raw) continue;
    const dot1 = raw.indexOf(".");
    const dot2 = raw.indexOf(".", dot1 + 1);
    if (dot1 < 0 || dot2 < 0) continue;
    const stat = raw.slice(0, dot1);
    const op = raw.slice(dot1 + 1, dot2);
    const valueStr = raw.slice(dot2 + 1);
    if (!isPlayerStatKey(stat) || !isPlayerComparator(op)) continue;
    const value = Number(valueStr);
    if (!Number.isFinite(value)) continue;
    filters.push({ stat, op, value });
  }

  const minG = Number(get("ming"));
  const limitRaw = Number(get("limit"));
  const sortRaw = get("sort");
  const validSorts: PlayerListSpec["sortBy"][] = ["bta_ind_ortg", "pir", "pts", "reb", "ast", "fg_pct", "fg3_pct", "ts_pct", "games", "name"];
  const sortBy = validSorts.includes(sortRaw as PlayerListSpec["sortBy"]) ? (sortRaw as PlayerListSpec["sortBy"]) : DEFAULT_PLAYER_SPEC.sortBy;
  const sortDirRaw = get("order");
  return {
    years,
    conf,
    teams,
    cls,
    pos,
    minGames: Number.isFinite(minG) && minG >= 0 ? minG : DEFAULT_PLAYER_SPEC.minGames,
    filters,
    sortBy,
    sortDir: sortDirRaw === "asc" || sortDirRaw === "desc" ? sortDirRaw : DEFAULT_PLAYER_SPEC.sortDir,
    limit: Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 1000 ? limitRaw : DEFAULT_PLAYER_SPEC.limit,
  };
}

export function playerSpecToParams(spec: PlayerListSpec): URLSearchParams {
  const p = new URLSearchParams();
  // Years: only set ?ys= when it differs from the default (current season).
  const defaultYears = DEFAULT_PLAYER_SPEC.years;
  if (
    spec.years.length !== defaultYears.length ||
    spec.years.some((y, i) => y !== defaultYears[i])
  ) {
    p.set("ys", spec.years.join(","));
  }
  if (spec.conf.length) p.set("conf", spec.conf.join(","));
  if (spec.teams.length) p.set("team", spec.teams.join(","));
  if (spec.cls.length) p.set("cls", spec.cls.join(","));
  if (spec.pos.length) p.set("pos", spec.pos.join(","));
  if (spec.minGames !== DEFAULT_PLAYER_SPEC.minGames) p.set("ming", String(spec.minGames));
  spec.filters.forEach((f, i) => p.set(`f${i}`, `${f.stat}.${f.op}.${f.value}`));
  if (spec.sortBy !== DEFAULT_PLAYER_SPEC.sortBy) p.set("sort", spec.sortBy);
  if (spec.sortDir !== DEFAULT_PLAYER_SPEC.sortDir) p.set("order", spec.sortDir);
  if (spec.limit !== DEFAULT_PLAYER_SPEC.limit) p.set("limit", String(spec.limit));
  return p;
}

// Silence unused-variable warnings for the column-access helpers; they are
// imported by the client component as PLAYER_COLS only.
void fromStart;
void fromEnd;
void asNum;

