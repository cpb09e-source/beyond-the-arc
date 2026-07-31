import { clampSeason } from "@/lib/seasons";
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
  /**
   * Whether /players/<bart_player_id>/ was actually generated.
   *
   * generateStaticParams only emits profile pages for ranked players plus the
   * freshman pass, and its own comment says the rest should "render as plain
   * text everywhere else". The explorer was linking all of them regardless, so
   * 30% of its rows pointed at a 404. Set from the explorer payload, which
   * computes it against the same three rules the page generator uses.
   */
  has_page: boolean;
  /**
   * Whether this player's SEASON has EPM data at all.
   *
   * Set per season by the explorer, not by the payload. Players under the
   * 13 mpg floor are omitted from epm-<year>.json entirely — below it the fit
   * is essentially the prior, and publishing that as a number invited it to be
   * read as measured impact. The explorer hides those rows; this flag is what
   * stops it from also emptying the table for a season whose EPM was never
   * built, where every player is legitimately EPM-less.
   */
  epm_covered?: boolean;
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
  /**
   * Turnover rate — TOV / (FGA + 0.44·FTA + TOV): the share of possessions a
   * player USES that he ends with a turnover. Usage-adjusted, so unlike
   * tov_pg it does not simply punish whoever handles the ball most.
   */
  tov_pct: number | null;
  usage_pct: number | null;     // usage rate (fraction, e.g. 0.305 = 30.5%)
  /**
   * Individual offensive-minus-defensive rating per 100 possessions.
   *
   * This replaced `plus_minus_pg`, and is NOT the same statistic. On-court
   * plus/minus needs to know who was on the floor; CBBD's play-by-play carries
   * no lineup data and no substitution events before 2024, so team point
   * differential while a player was on the court is unrecoverable for
   * 2014-2023. Rather than relabel a different number as "+/-", the column is
   * honest about what it is.
   */
  net_rtg: number | null;
  ast_to_tov: number | null;    // assist-to-turnover ratio (ast_pg / tov_pg)
  drb_pg: number | null;        // defensive rebounds per game (reb − orb)
  hkm_pct: number | null;       // Hakeem % = BLK% + STL% (Bart raw cols 22+23)
  // EPM-extras (real-EPM seasons only; from epm-<year>.json). Filter-only.
  ewins: number | null;         // wins added vs an average player
  on_off: number | null;        // team net rating on-court minus off-court (raw)
  // Shooting profile from CBBD /stats/player/shooting/season (attached from
  // /data/shooting-<year>.json). Filter-only for now — NOT shown in the grid.
  // All are 0–100 numbers (not fractions). Zone FG% null below a small-sample
  // floor. rim = dunks+layups+tipIns, mid = 2PT jumpers.
  rim_pct: number | null;       // FG% at the rim
  mid_pct: number | null;       // mid-range (2PT jumper) FG%
  assisted_pct: number | null;  // % of made FGs that were assisted
  rim_rate: number | null;      // % of shot attempts at the rim (shot diet)
  tp_rate: number | null;       // % of shot attempts that are 3s (shot diet)
  // BTA EPM (ridge RAPM over CBBD stints; see scripts/compute-epm.py). Null
  // for seasons without a fit or unmatched players. Attached client-side from
  // /data/epm-<year>.json.
  epm: number | null;
  off_epm: number | null;
  def_epm: number | null;
  // True when epm/off/def are the box-score ESTIMATE (Box-EPM) rather than the
  // real play-by-play RAPM fit — i.e. seasons before onFloor data (pre-2024).
  // Drives the "≈ estimated" marker in the grid.
  epm_estimated: boolean;
  pir: number | null;           // EuroLeague PIR per game (minus TOV; see note)
  porpag: number | null;        // Bart Torvik Points Over Replacement Player per Adj Game
  /**
   * BTA's own points over replacement per game, built from CBBD primitives by
   * scripts/build-bta-porpag.mjs — per-game offensive rating and usage, credited
   * for the defence actually faced, minus a replacement rate set from the data.
   *
   * Shipped alongside Bart's rather than replacing it: the two agree at
   * r = 0.947, which is the evidence the construction is sound, and keeping
   * both visible is how that stays checkable. The long-term point is to stop
   * depending on someone else's derived stat — bta_ind_ortg is computed from
   * Bart's PORPAG today, so the dependency runs deeper than one column.
   */
  bta_porpag: number | null;
  bta_ind_ortg: number | null;  // avg(z(PIR), z(PORPAG)) * 20, with 12% non-power-conf penalty
  fg3_made: number | null;
  fg3_att: number | null;
};

// ---------- Stat filter columns ----------
// Filterable per-player stats grouped for the SearchableSelect dropdown.
// Each key maps 1:1 to a PlayerSummary field (see statKeyToField below).
// Groups render in `PLAYER_STAT_GROUP_ORDER` order; mirrors the editorial
// pattern from the team explorer's TEAM_STAT_COLUMNS.

export type PlayerStatGroup = "impact" | "advanced" | "offense" | "shooting" | "defense" | "volume";

export type PlayerStatColumn = {
  key: string;
  label: string;
  desc: string;
  group: PlayerStatGroup;
  format: "pct1" | "num1" | "num2";
  field: keyof PlayerSummary;
  // Filterable but never surfaced as a grid column (even when filtered on).
  // Used for the shooting-profile stats that live only in the filter drawer.
  filterOnly?: boolean;
};

export const PLAYER_STAT_COLUMNS: PlayerStatColumn[] = [
  // ── Impact (BTA EPM — ridge RAPM over play-by-play stints) ───
  { key: "epm",     label: "EPM",     desc: "Estimated Plus-Minus — per-100-possession impact vs. an average player (offense + defense)", group: "impact", format: "num1", field: "epm" },
  { key: "off_epm", label: "Off EPM", desc: "Offensive EPM — per-100 offensive impact",                                                   group: "impact", format: "num1", field: "off_epm" },
  { key: "def_epm", label: "Def EPM", desc: "Defensive EPM — per-100 defensive impact (positive = better defense)",                        group: "impact", format: "num1", field: "def_epm" },
  // EPM-extras — filterable only (real-EPM seasons 2024+ have them).
  { key: "ewins",  label: "eWins",  desc: "Estimated wins added vs an average player (EPM × possessions)", group: "impact", format: "num1", field: "ewins",  filterOnly: true },
  { key: "on_off", label: "On/Off", desc: "Team net rating with the player on the court minus off (raw, per 100)", group: "impact", format: "num1", field: "on_off", filterOnly: true },

  // ── Advanced ─────────────────────────────────────────────
  { key: "pir",      label: "PIR",      desc: "EuroLeague Performance Index Rating (per game, minus TOV)",                              group: "advanced", format: "num1", field: "pir" },
  { key: "bta_porpag", label: "PORP",   desc: "BTA Points Over Replacement per game — points produced above a replacement-level player on the same possessions, credited for the defence actually faced. Built from per-game data, so a big night against the country's best defence counts as one.", group: "advanced", format: "num2", field: "bta_porpag" },
  { key: "net_rtg",  label: "Net Rtg",  desc: "Individual offensive rating minus defensive rating, per 100 possessions",               group: "advanced", format: "num1", field: "net_rtg" },
  { key: "on_off",   label: "On/Off",   desc: "Team net rating with this player on the floor minus with them off it, per 100 possessions. 2024 onward only — earlier seasons have no lineup data.", group: "advanced", format: "num1", field: "on_off" },
  { key: "ast_tov",  label: "AST/TOV",  desc: "Assist-to-turnover ratio (assists per game ÷ turnovers per game)",                       group: "advanced", format: "num2", field: "ast_to_tov" },

  // ── Offense ──────────────────────────────────────────────
  { key: "ppg",     label: "PPG",   desc: "Points per game",                                                   group: "offense", format: "num1", field: "pts_pg" },
  { key: "apg",     label: "APG",   desc: "Assists per game",                                                  group: "offense", format: "num1", field: "ast_pg" },
  { key: "rpg",     label: "RPG",   desc: "Rebounds per game",                                                 group: "offense", format: "num1", field: "reb_pg" },
  { key: "orpg",    label: "OREB",  desc: "Offensive rebounds per game",                                       group: "offense", format: "num1", field: "orb_pg" },
  { key: "drpg",    label: "DREB",  desc: "Defensive rebounds per game (RPG − OREB)",                          group: "offense", format: "num1", field: "drb_pg" },
  { key: "tov_pg",  label: "TOV",   desc: "Turnovers per game (lower is better)",                              group: "offense", format: "num1", field: "tov_pg" },
  { key: "tov_pct", label: "TOV%",  desc: "Turnover rate — share of possessions used that end in a turnover (lower is better)", group: "offense", format: "pct1", field: "tov_pct" },
  { key: "usg_pct", label: "USG%",  desc: "Usage rate — fraction of team possessions ending with this player",  group: "offense", format: "pct1", field: "usage_pct" },

  // ── Shooting ─────────────────────────────────────────────
  { key: "fg_pct",   label: "FG%",       desc: "Field goal % (combined 2P + 3P)",                        group: "shooting", format: "pct1", field: "fg_pct" },
  { key: "fg3_pct",  label: "3P%",       desc: "3-point %",                                               group: "shooting", format: "pct1", field: "fg3_pct" },
  { key: "fg2_pct",  label: "2P%",       desc: "2-point %",                                               group: "shooting", format: "pct1", field: "fg2_pct" },
  { key: "ft_pct",   label: "FT%",       desc: "Free-throw %",                                            group: "shooting", format: "pct1", field: "ft_pct" },
  { key: "ts_pct",   label: "TS%",       desc: "True shooting %: PTS / (2 × (FGA + 0.44 × FTA))",         group: "shooting", format: "pct1", field: "ts_pct" },
  { key: "efg_pct",  label: "eFG%",      desc: "Effective FG%: (FGM + 0.5 × 3PM) / FGA",                  group: "shooting", format: "pct1", field: "efg_pct" },
  { key: "fta_rate", label: "FTA Rate",  desc: "Free-throw attempts / FG attempts (line-drawing volume)", group: "shooting", format: "pct1", field: "fta_rate" },
  // Shooting profile (CBBD) — 0–100 values, filter-only. See PlayerSummary.
  { key: "rim_pct",  label: "Rim%",      desc: "Field goal % at the rim (dunks + layups + tip-ins)",            group: "shooting", format: "num1", field: "rim_pct",      filterOnly: true },
  { key: "mid_pct",  label: "Mid%",      desc: "Mid-range (2-point jumper) field goal %",                       group: "shooting", format: "num1", field: "mid_pct",      filterOnly: true },
  { key: "asst_pct", label: "Assisted%", desc: "% of made field goals that were assisted (lower = more self-created)", group: "shooting", format: "num1", field: "assisted_pct", filterOnly: true },
  { key: "rim_rate", label: "Rim rate",  desc: "% of shot attempts taken at the rim (shot diet)",               group: "shooting", format: "num1", field: "rim_rate",     filterOnly: true },
  { key: "tp_rate",  label: "3PT rate",  desc: "% of shot attempts that are 3-pointers (shot diet)",            group: "shooting", format: "num1", field: "tp_rate",      filterOnly: true },

  // ── Defense ──────────────────────────────────────────────
  { key: "spg", label: "SPG", desc: "Steals per game",  group: "defense", format: "num1", field: "stl_pg" },
  { key: "bpg", label: "BPG", desc: "Blocks per game",  group: "defense", format: "num1", field: "blk_pg" },
  { key: "hkm", label: "HKM%", desc: "Hakeem % — BLK% + STL% (named after Hakeem Olajuwon)", group: "defense", format: "num1", field: "hkm_pct" },

  // ── Volume ───────────────────────────────────────────────
  { key: "gp",  label: "GP",  desc: "Games played",   group: "volume", format: "num1", field: "games" },
  { key: "mpg", label: "MPG", desc: "Minutes per game", group: "volume", format: "num1", field: "min_pg" },
];

export const PLAYER_STAT_GROUP_LABEL: Record<PlayerStatGroup, string> = {
  impact:   "Impact",
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
/** Lookup a filterable stat column by key (label/format/desc for the filter UI). */
export function playerStatColumn(key: string): PlayerStatColumn | undefined {
  return PLAYER_STAT_COLUMN_BY_KEY.get(key);
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
  /**
   * Stats pinned as leading columns, in pick order. Independent of `filters`:
   * a reader can show a stat without narrowing on it. Setting a range auto-pins
   * the stat, which is what the table used to infer from `filters` alone.
   */
  cols: string[];
  sortBy: "bta_ind_ortg" | "pir" | "bta_porpag" | "pts" | "reb" | "ast" | "fg_pct" | "fg3_pct" | "ts_pct" | "games" | "name"
    | "epm" | "off_epm" | "def_epm" | "min" | "usage" | "orb" | "drb" | "tov" | "tov_pct" | "stl" | "blk" | "hkm";
  sortDir: "asc" | "desc";
  limit: number;
};

/**
 * Every accepted sort key. This is the allow-list a URL is checked against, so
 * a key missing here is silently ignored and the table quietly falls back to
 * EPM — which is how sorting by TOV% went unnoticed. Keep in step with
 * PlayerListSpec["sortBy"] and with sortKeyMap in players-client.
 */
export const VALID_SORTS: PlayerListSpec["sortBy"][] = [
  "bta_ind_ortg", "pir", "bta_porpag", "pts", "reb", "ast", "fg_pct", "fg3_pct",
  "ts_pct", "games", "name", "epm", "off_epm", "def_epm", "min", "usage",
  "orb", "drb", "tov", "tov_pct", "stl", "blk", "hkm",
];

export const DEFAULT_PLAYER_SPEC: PlayerListSpec = {
  years: [2026],
  conf: [],
  teams: [],
  cls: [],
  pos: [],
  minGames: 10,
  filters: [],
  cols: [],
  sortBy: "epm",
  sortDir: "desc",
  // 50 a page. The table now sizes itself to the viewport rather than a
  // fixed 1250px box, so a page of 50 fills the screen and the pager is
  // reachable without scrolling a second, nested scrollbar.
  limit: 50,
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
  // Window (floor / ceiling / excluded COVID season) lives in src/lib/seasons.ts.
  return clampSeason(y, DEFAULT_PLAYER_SPEC.years[0]!);
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
  // the team explorer's URL encoding. Cap at 40 (each range slider can emit a
  // min + a max, so the range panel needs headroom well past a handful).
  const filters: PlayerStatFilter[] = [];
  for (let i = 0; i < 40; i++) {
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
  // Keep in step with PlayerListSpec["sortBy"] — this is the allow-list a URL
  // is checked against, so a key missing here is silently ignored and the table
  // quietly falls back to EPM.
  const validSorts = VALID_SORTS;
  const sortBy = validSorts.includes(sortRaw as PlayerListSpec["sortBy"]) ? (sortRaw as PlayerListSpec["sortBy"]) : DEFAULT_PLAYER_SPEC.sortBy;
  const sortDirRaw = get("order");
  // Pinned columns. Unknown keys are dropped rather than trusted — this comes
  // straight off the query string — and filterOnly stats are refused because
  // they have no grid representation.
  const colsRaw = get("cols");
  const cols = colsRaw
    ? colsRaw
        .split(",")
        .map((s) => s.trim())
        .filter((k) => {
          const c = PLAYER_STAT_COLUMN_BY_KEY.get(k);
          return !!c && !c.filterOnly;
        })
        .filter((k, i, a) => a.indexOf(k) === i)
    : [];
  return {
    years,
    conf,
    teams,
    cls,
    pos,
    minGames: Number.isFinite(minG) && minG >= 0 ? minG : DEFAULT_PLAYER_SPEC.minGames,
    filters,
    cols,
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
  if (spec.cols.length) p.set("cols", spec.cols.join(","));
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

