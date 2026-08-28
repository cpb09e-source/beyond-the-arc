/**
 * Table views for the Players Explorer — named column sets the reader switches
 * between, in place of building one column at a time.
 *
 * The team explorer's src/lib/team-views.ts is the model, deliberately: the two
 * pages should not have two different ideas of what a view is. Same shape, same
 * band headers, same "a view replaces the default columns and never the pinned
 * ones" rule.
 *
 * WHAT IS DIFFERENT HERE. A team view reads from one payload that is already in
 * memory, so switching costs nothing. A player view may need a stat pack that
 * has not been fetched — most of these columns live in
 * public/data/player-stats/<season>/<group>.json and load on demand. Views
 * therefore declare their keys and the client works out which files to pull;
 * see groupsFor() in player-stat-pack.ts.
 *
 * Keys may name a stat from EITHER catalogue — PLAYER_STAT_COLUMNS (on the
 * summary) or PACK_STAT_COLUMNS (in a pack). The dev-time check at the bottom
 * validates against both, because a typo would otherwise render a column of
 * dashes, which reads as missing data rather than as the mistake it is.
 */
import { PLAYER_STAT_COLUMNS } from "@/lib/players";
import { PACK_STAT_COLUMNS, groupsFor, type PackGroup } from "@/lib/player-stat-pack";

export type PlayerViewBand = {
  label: string;
  /** Rendered in the accent, for the band a view is really "about". */
  accent?: boolean;
  keys: string[];
};

export type PlayerView = {
  key: string;
  label: string;
  /** Section heading in the picker. */
  group: string;
  /** One-line explanation, shown as the option's title. */
  desc: string;
  bands: PlayerViewBand[];
  sortBy: string;
  sortDir: "asc" | "desc";
  /** An EMPTY view the reader fills in themselves. */
  custom?: boolean;
};

export const PLAYER_VIEWS: PlayerView[] = [
  // ── Overview ──────────────────────────────────────────────────────────────
  {
    key: "overview",
    label: "Overview",
    group: "Overview",
    desc: "The default table — role, impact, scoring, shooting and the box score in one screen",
    // MATCHES THE TABLE AS IT SHIPPED before views existed, column for column
    // and band for band. This view is the default, so any difference here
    // would read as the page having been rearranged rather than extended.
    bands: [
      { label: "EPM", accent: true, keys: ["off_epm", "def_epm", "epm", "ewins"] },
      { label: "Role", keys: ["usg_pct"] },
      { label: "Scoring", keys: ["ppg"] },
      { label: "Shooting", keys: ["ts_pct", "ppp", "fg_pct", "fg3_pct"] },
      { label: "Rebounding", keys: ["orpg", "rpg"] },
      { label: "Handle", keys: ["apg", "tov_pct"] },
      { label: "Defense", keys: ["spg", "bpg", "hkm"] },
    ],
    sortBy: "ewins",
    sortDir: "desc",
  },

  // ── Traditional ───────────────────────────────────────────────────────────
  {
    key: "traditional",
    label: "Traditional Boxscore",
    group: "Traditional Boxscore",
    desc: "Season totals and per-40 rates for every counting stat",
    bands: [
      { label: "Time", keys: ["gp", "gs", "mpg"] },
      { label: "Scoring", accent: true, keys: ["pts", "ppg", "pts_40"] },
      { label: "Rebounding", keys: ["orb", "drb", "reb"] },
      { label: "Playmaking", keys: ["ast", "tov", "ast_tov"] },
      { label: "Defense", keys: ["stl", "blk"] },
    ],
    sortBy: "pts",
    sortDir: "desc",
  },
  {
    key: "trad-shooting",
    label: "Traditional Shooting",
    group: "Traditional Boxscore",
    desc: "Makes, attempts and percentages from every distance",
    bands: [
      { label: "Volume", keys: ["fga", "fga_pg"] },
      { label: "Field goals", keys: ["fgm", "fg_pct", "efg_pct"] },
      { label: "Twos", keys: ["fg2m", "fg2a", "fg2_pct"] },
      { label: "Threes", keys: ["fg3m", "fg3a", "fg3_pct"] },
      { label: "Free throws", keys: ["ftm", "fta", "ft_pct"] },
      { label: "Efficiency", accent: true, keys: ["ts_pct", "rts_pct"] },
    ],
    sortBy: "ts_pct",
    sortDir: "desc",
  },
  {
    key: "scoring-context",
    label: "Scoring Context",
    group: "Traditional Boxscore",
    desc: "Where the points came from — paint, second chance and transition",
    bands: [
      { label: "Scoring", keys: ["pts", "ppg"] },
      { label: "Paint", accent: true, keys: ["pitp", "pitp_pg", "pitp_share"] },
      { label: "Second chance", keys: ["scp", "scp_pg", "scp_share"] },
      { label: "Transition", keys: ["fbp", "fbp_pg", "fbp_share"] },
    ],
    sortBy: "pitp",
    sortDir: "desc",
  },

  // ── Advanced ──────────────────────────────────────────────────────────────
  {
    key: "adv-offense",
    label: "Offensive Stats",
    group: "Advanced Boxscore",
    desc: "Usage, creation and efficiency, plus the points his passing produced",
    bands: [
      { label: "Load", keys: ["usg_pct", "ast_ratio", "ast_usg"] },
      { label: "Creation", accent: true, keys: ["ast_pct", "ppr", "ast_pts", "pts_created"] },
      { label: "Efficiency", keys: ["ts_pct", "ppp", "ftm_rate"] },
      { label: "Shot mix", keys: ["pts2_share", "pts3_share", "ptsft_share"] },
    ],
    sortBy: "pts_created",
    sortDir: "desc",
  },
  {
    key: "adv-defense",
    label: "Defensive Stats",
    group: "Advanced Boxscore",
    desc: "Steal and block rates against the possessions he was actually on the floor for",
    bands: [
      { label: "Events", keys: ["stl", "blk", "spg", "bpg"] },
      { label: "Rates", accent: true, keys: ["stl_pct", "blk_pct", "hkm"] },
      { label: "Rebounding", keys: ["drb_pct", "reb_pct"] },
      { label: "Cost", keys: ["stl_tov", "blkd_fga"] },
    ],
    sortBy: "hkm",
    sortDir: "desc",
  },
  {
    key: "foul-related",
    label: "Foul Related",
    group: "Advanced Boxscore",
    desc: "Fouls committed, and whether the disruption was worth the cost",
    bands: [
      { label: "Committed", keys: ["pf", "pf_pg", "pf_40", "fouled_out"] },
      { label: "Worth it?", accent: true, keys: ["pf_eff", "blk_pf", "stl_pf"] },
      { label: "Technicals", keys: ["tech"] },
    ],
    sortBy: "pf_eff",
    sortDir: "desc",
  },

  // ── Miscellaneous ─────────────────────────────────────────────────────────
  {
    key: "impact",
    label: "All-In-One Stats",
    group: "Miscellaneous",
    desc: "EPM and its parts — the site's own all-in-one numbers",
    bands: [
      { label: "EPM", accent: true, keys: ["epm", "off_epm", "def_epm"] },
      { label: "Parts", keys: ["box_epm", "on_off", "pm"] },
      { label: "Value", keys: ["ewins", "bta_porpag", "pir"] },
      { label: "Rating", keys: ["net_rtg", "ppp"] },
    ],
    sortBy: "ewins",
    sortDir: "desc",
  },
  {
    key: "doubles",
    label: "Double/Triple-Doubles",
    group: "Miscellaneous",
    desc: "How often he filled the box score — doubles, triples and the 5×5",
    bands: [
      { label: "Doubles", accent: true, keys: ["dd", "td"] },
      { label: "Twenty and ten", keys: ["g20p10a", "g20p10r"] },
      { label: "Across the board", keys: ["g3x5", "g4x5", "g5x5"] },
      { label: "Season", keys: ["pts", "reb", "ast"] },
    ],
    sortBy: "dd",
    sortDir: "desc",
  },
  {
    key: "leaders",
    label: "Single-Game Leaders",
    group: "Miscellaneous",
    desc: "Games he led his team, or everyone on the floor, in a category",
    bands: [
      { label: "Led his team", accent: true, keys: ["led_t_pts", "led_t_reb", "led_t_ast", "led_t_pra"] },
      { label: "Led the game", keys: ["led_g_pts", "led_g_reb", "led_g_ast", "led_g_pra"] },
      { label: "Defense", keys: ["led_t_stl", "led_t_blk"] },
    ],
    sortBy: "led_t_pts",
    sortDir: "desc",
  },
  {
    key: "player-info",
    label: "Player Info",
    group: "Miscellaneous",
    desc: "Age, height, draft position and how much he actually played",
    bands: [
      { label: "Who", accent: true, keys: ["age", "ht_in"] },
      { label: "Playing time", keys: ["gp", "gs", "min", "mpg"] },
      { label: "Outcome", keys: ["win_pct"] },
      { label: "Draft", keys: ["draft_pick", "draft_rd", "draft_rd_pick"] },
    ],
    sortBy: "age",
    sortDir: "asc",
  },

  // ── Custom ────────────────────────────────────────────────────────────────
  {
    key: "custom",
    label: "Select Your Own Columns",
    group: "Build Your Own Table",
    desc: "Start empty and add only the stats you want",
    bands: [],
    sortBy: "ewins",
    sortDir: "desc",
    custom: true,
  },
];

const BY_KEY = new Map(PLAYER_VIEWS.map((v) => [v.key, v]));

export function playerViewByKey(key: string | undefined): PlayerView {
  return (key ? BY_KEY.get(key) : undefined) ?? PLAYER_VIEWS[0]!;
}

/** Picker sections, in declaration order. */
export function playerViewGroups(): Array<{ group: string; views: PlayerView[] }> {
  const out: Array<{ group: string; views: PlayerView[] }> = [];
  for (const v of PLAYER_VIEWS) {
    let g = out.find((x) => x.group === v.group);
    if (!g) { g = { group: v.group, views: [] }; out.push(g); }
    g.views.push(v);
  }
  return out;
}

/** Every stat key a view names, flattened in band order. */
export function playerViewKeys(v: PlayerView): string[] {
  return v.bands.flatMap((b) => b.keys);
}

/** Which stat-pack files a view needs before it can render. */
export function playerViewPackGroups(v: PlayerView): PackGroup[] {
  return groupsFor(playerViewKeys(v));
}

/**
 * VALIDATED AT MODULE LOAD in development, against BOTH catalogues.
 *
 * A key in neither renders as a column of dashes — present, headed and empty,
 * which reads as missing data rather than as the typo it is. Throwing is right
 * because the fix is a one-character edit and the failure is silent otherwise.
 */
if (process.env.NODE_ENV !== "production") {
  const known = new Set<string>([
    ...PLAYER_STAT_COLUMNS.map((c) => c.key),
    ...PACK_STAT_COLUMNS.map((c) => c.key),
  ]);
  const bad: string[] = [];
  for (const v of PLAYER_VIEWS) {
    for (const b of v.bands) for (const k of b.keys) if (!known.has(k)) bad.push(`${v.key}/${k}`);
    if (!v.custom && !known.has(v.sortBy)) bad.push(`${v.key}/sortBy:${v.sortBy}`);
  }
  if (bad.length) {
    throw new Error(`player-views.ts names stat keys that do not exist: ${bad.join(", ")}`);
  }
}
