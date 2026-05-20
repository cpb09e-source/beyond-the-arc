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
  pir: number | null;           // EuroLeague PIR per game (minus TOV; see note)
  porpag: number | null;        // Bart Torvik Points Over Replacement Player per Adj Game
  bta_ind_ortg: number | null;  // avg(z(PIR), z(PORPAG)) * 20, with 12% non-power-conf penalty
  fg3_made: number | null;
  fg3_att: number | null;
};

export type PlayerListSpec = {
  years: number[];             // multi-select; any combination of seasons
  conf: string[];              // empty = all conferences
  teams: string[];             // empty = all teams
  cls: string[];               // empty = all classes; each = "Fr" | "So" | "Jr" | "Sr" | "Gr"
  minGames: number;
  sortBy: "bta_ind_ortg" | "pir" | "pts" | "reb" | "ast" | "fg_pct" | "fg3_pct" | "ts_pct" | "games" | "name";
  sortDir: "asc" | "desc";
  limit: number;
};

export const DEFAULT_PLAYER_SPEC: PlayerListSpec = {
  years: [2026],
  conf: [],
  teams: [],
  cls: [],
  minGames: 10,
  sortBy: "bta_ind_ortg",
  sortDir: "desc",
  limit: 100,
};

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
    minGames: Number.isFinite(minG) && minG >= 0 ? minG : DEFAULT_PLAYER_SPEC.minGames,
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
  if (spec.minGames !== DEFAULT_PLAYER_SPEC.minGames) p.set("ming", String(spec.minGames));
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

