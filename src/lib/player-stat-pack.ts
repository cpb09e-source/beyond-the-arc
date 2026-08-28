/**
 * The Players Explorer's extended stat catalogue — the client half.
 *
 * Built by scripts/build-player-stat-pack.mjs; spec in
 * docs/players-stat-spec.md. Everything here describes data that lives in
 * public/data/player-stats/<season>/<group>.json rather than on PlayerSummary.
 *
 * ── WHY THESE ARE NOT ON PlayerSummary ────────────────────────────────────
 *
 * The explorer payload is one file a season carrying every stat, and it is
 * already 1.68 MB for the 36 stats on PlayerSummary. Adding a hundred more in
 * that shape is ~4.8 MB a season, which the reader pays for on first paint
 * whether or not they ever open the view that uses them.
 *
 * So the pack is fetched per (season, GROUP), column-major, and only when a
 * view that needs it is chosen. The heaviest group is 223 KB gzipped and most
 * readers never load more than one.
 *
 * ── PERCENTILES COME WITH THE VALUES ──────────────────────────────────────
 *
 * They are computed at build time, not here, because the cohort is not simply
 * "every row in the file": per-40 stats rank only over players past a
 * 200-minute floor. Ranking client-side over whatever rows survived the
 * reader's filters would make a player's percentile move when someone else was
 * filtered out, which is the bug we removed from the team side.
 */

/** The ten files a season is split across. Keep in step with GROUPS in the build script. */
export type PackGroup =
  | "info" | "playtime" | "box" | "shooting" | "context"
  | "advoff" | "advdef" | "fouls" | "doubles" | "leaders";

/** One group file, exactly as the build script writes it. */
export type StatPack = {
  season: number;
  group: PackGroup;
  cols: string[];
  /** 1 = higher is better, -1 = lower is better, 0 = no percentile. */
  dir: number[];
  ids: number[];
  vals: Array<Array<number | null>>;
  pcts: Array<Array<number | null> | null>;
  /**
   * Share of the season's games present in the play-by-play archive.
   *
   * Below 0.9 the build nulls every play-by-play stat rather than publishing a
   * number built on half a season — see the spec. Carried here so the UI can
   * say WHY a column is empty instead of leaving the reader to guess.
   */
  pbpCoverage: number;
};

/** A pack indexed for lookup: bart id → value, per column. */
export type IndexedPack = {
  season: number;
  group: PackGroup;
  pbpCoverage: number;
  value: Map<string, Map<number, number | null>>;
  pct: Map<string, Map<number, number | null>>;
};

const CACHE = new Map<string, Promise<IndexedPack | null>>();

function indexPack(p: StatPack): IndexedPack {
  const value = new Map<string, Map<number, number | null>>();
  const pct = new Map<string, Map<number, number | null>>();
  p.cols.forEach((col, ci) => {
    const v = new Map<number, number | null>();
    const q = new Map<number, number | null>();
    const vs = p.vals[ci] ?? [];
    const ps = p.pcts[ci];
    for (let i = 0; i < p.ids.length; i++) {
      const id = p.ids[i]!;
      v.set(id, vs[i] ?? null);
      if (ps) q.set(id, ps[i] ?? null);
    }
    value.set(col, v);
    pct.set(col, q);
  });
  return { season: p.season, group: p.group, pbpCoverage: p.pbpCoverage, value, pct };
}

/**
 * Fetch and index one group for one season, once.
 *
 * Failures resolve to null rather than throwing: a missing pack means the
 * columns render as "—", which is the same thing the reader sees for a season
 * whose play-by-play was too thin to publish. A view that half-loads is worse
 * than a view that says it has nothing.
 */
export function loadStatPack(season: number, group: PackGroup): Promise<IndexedPack | null> {
  const key = `${season}|${group}`;
  const hit = CACHE.get(key);
  if (hit) return hit;
  const p = fetch(`/data/player-stats/${season}/${group}.json`)
    .then((r) => (r.ok ? (r.json() as Promise<StatPack>) : null))
    .then((j) => (j ? indexPack(j) : null))
    .catch(() => null);
  CACHE.set(key, p);
  return p;
}

// ── The catalogue ──────────────────────────────────────────────────────────

export type PackStatFormat = "int" | "num1" | "num2" | "pct1" | "pct100";

export type PackStatColumn = {
  key: string;
  label: string;
  desc: string;
  group: PackGroup;
  format: PackStatFormat;
  /**
   * Raw count, no percentile chip.
   *
   * Milestone counts, single-game leads and technical fouls are small integers
   * dominated by zero — technicals run about 0.026 per player-game. A midrank
   * over that is arithmetically correct and visually useless: one shared
   * percentile across most of the table, rendered as a wall of identical colour
   * that reads as a finding. The number alone says more.
   */
  noPct?: boolean;
  /** Needs the play-by-play archive, so empty below the coverage gate. */
  pbp?: boolean;
};

const C = (
  key: string, label: string, group: PackGroup, format: PackStatFormat,
  desc: string, extra: Partial<PackStatColumn> = {},
): PackStatColumn => ({ key, label, group, format, desc, ...extra });

/** Per-40 rates share one caveat, so they share one sentence. */
const PER40 = "Per 40 minutes played. Blank under 200 minutes on the season — a rate over a handful of appearances describes the appearances, not the player.";

export const PACK_STAT_COLUMNS: PackStatColumn[] = [
  // ── Player info ───────────────────────────────────────────────────────────
  C("age", "Age", "info", "num1",
    "Age at the end of the season, from the date of birth in Bart's player file. A 19-year-old and a 23-year-old putting up the same line are not the same prospect."),
  C("ht_in", "Height", "info", "int",
    "Height in inches, so it sorts and filters as a number. Displayed in feet and inches."),
  C("draft_pick", "Draft Pick", "info", "int",
    "Overall selection in the NBA draft, for players who were drafted. Blank for everyone else — which is almost everyone."),
  C("draft_rd", "Draft Rd", "info", "int",
    "Draft round. Derived from the overall pick rather than recorded, so it is right in a normal 60-pick year and can be off by a slot in a year with forfeited picks."),
  C("draft_rd_pick", "Rd Pick", "info", "int",
    "Selection number within the round."),

  // ── Playing time ──────────────────────────────────────────────────────────
  C("gs", "GS", "playtime", "int",
    "Games started. Bart's season table has no such column — this is counted from the starter flag on every per-game box row."),
  C("min", "MIN", "playtime", "int",
    "Total minutes played on the season."),
  C("win_pct", "Win%", "playtime", "pct1",
    "His team's winning percentage across the games he appeared in. A team statistic attached to a player, so read it as context rather than credit."),

  // ── Traditional box score ─────────────────────────────────────────────────
  C("pts", "PTS", "box", "int", "Total points on the season."),
  C("pts_40", "PTS/40", "box", "num1", `Points. ${PER40}`),
  C("reb", "REB", "box", "int", "Total rebounds."),
  C("reb_40", "REB/40", "box", "num1", `Rebounds. ${PER40}`),
  C("orb", "OREB", "box", "int", "Total offensive rebounds."),
  C("orb_40", "OREB/40", "box", "num1", `Offensive rebounds. ${PER40}`),
  C("drb", "DREB", "box", "int", "Total defensive rebounds."),
  C("drb_40", "DREB/40", "box", "num1", `Defensive rebounds. ${PER40}`),
  C("ast", "AST", "box", "int", "Total assists."),
  C("ast_40", "AST/40", "box", "num1", `Assists. ${PER40}`),
  C("stl", "STL", "box", "int", "Total steals."),
  C("stl_40", "STL/40", "box", "num1", `Steals. ${PER40}`),
  C("blk", "BLK", "box", "int", "Total blocks."),
  C("blk_40", "BLK/40", "box", "num1", `Blocks. ${PER40}`),
  C("tov", "TOV", "box", "int", "Total turnovers. Lower is better."),
  C("tov_40", "TOV/40", "box", "num1", `Turnovers, lower being better. ${PER40}`),
  C("pf", "PF", "box", "int", "Personal fouls committed. Lower is better."),
  C("pf_40", "PF/40", "box", "num1", `Personal fouls, lower being better. ${PER40}`),
  C("pf_pg", "PF/G", "box", "num1", "Personal fouls per game. Lower is better."),
  C("blkd", "BLKD", "box", "int",
    "Times his own shot was blocked. The play feed names the blocker and not the man he blocked, so this is recovered from the missed attempt immediately before each block.",
    { pbp: true }),
  C("pm", "+/−", "box", "num1",
    "Team point differential while he was on the floor. Needs to know who was playing, so 2024 onward only — earlier play-by-play carries no substitutions and no on-floor list, which is unrecoverable rather than merely missing.",
    { pbp: true }),
  C("tech", "TECH", "box", "int",
    "Technical fouls. Shown as a raw count with no percentile: nearly everyone has zero, and colouring that says nothing.",
    { noPct: true, pbp: true }),

  // ── Traditional shooting ──────────────────────────────────────────────────
  C("fgm", "FGM", "shooting", "int", "Field goals made."),
  C("fga", "FGA", "shooting", "int", "Field goals attempted."),
  C("fga_40", "FGA/40", "shooting", "num1", `Field goal attempts. ${PER40}`),
  C("fga_pg", "FGA/G", "shooting", "num1", "Field goal attempts per game."),
  C("fg2m", "2PM", "shooting", "int", "Two-point field goals made."),
  C("fg2a", "2PA", "shooting", "int", "Two-point field goals attempted."),
  C("fg2a_40", "2PA/40", "shooting", "num1", `Two-point attempts. ${PER40}`),
  C("fg2a_pg", "2PA/G", "shooting", "num1", "Two-point attempts per game."),
  C("fg3m", "3PM", "shooting", "int", "Three-point field goals made."),
  C("fg3a", "3PA", "shooting", "int", "Three-point field goals attempted."),
  C("fg3a_40", "3PA/40", "shooting", "num1", `Three-point attempts. ${PER40}`),
  C("fg3a_pg", "3PA/G", "shooting", "num1", "Three-point attempts per game."),
  C("ftm", "FTM", "shooting", "int", "Free throws made."),
  C("fta", "FTA", "shooting", "int", "Free throws attempted."),
  C("fta_40", "FTA/40", "shooting", "num1", `Free throw attempts. ${PER40}`),
  C("fta_pg", "FTA/G", "shooting", "num1", "Free throw attempts per game."),
  C("rts_pct", "rTS%", "shooting", "pct1",
    "True shooting against this season's own Division I mean, in percentage points. Shooting has moved a long way across the seasons on this site, so a raw 56% in 2014 and a raw 56% in 2026 are not the same achievement — this says how far above or below his own league he finished."),

  // ── Scoring context ───────────────────────────────────────────────────────
  //
  // Paint and fast break are ALLOCATED shares of CBBD's official team total,
  // which is why both carry decimals. Their descriptions say so, because a
  // reader who sees 12.4 points is owed an explanation for the .4.
  C("pitp", "PITP", "context", "num1",
    "Points in the paint. Shots are placed in the lane from their recorded coordinates, then each team's official league total for the game is divided among its players in those proportions — so a team's paint points always add up to the real figure. Fractional for that reason.",
    { pbp: true }),
  C("pitp_40", "PITP/40", "context", "num1", `Points in the paint. ${PER40}`, { pbp: true }),
  C("pitp_pg", "PITP/G", "context", "num1", "Points in the paint per game.", { pbp: true }),
  C("pitp_share", "% Pts Paint", "context", "pct1", "Share of his points scored in the paint.", { pbp: true }),
  C("scp", "2ND CH", "context", "int",
    "Second chance points — scored on possessions that began with an offensive rebound. Counted directly from the play feed, with no clock involved.",
    { pbp: true }),
  C("scp_40", "2ND CH/40", "context", "num1", `Second chance points. ${PER40}`, { pbp: true }),
  C("scp_pg", "2ND CH/G", "context", "num1", "Second chance points per game.", { pbp: true }),
  C("scp_share", "% Pts 2nd Ch", "context", "pct1", "Share of his points that were second chance points.", { pbp: true }),
  C("fbp", "FB", "context", "num1",
    "Fast break points, estimated. Nothing in the play feed tags a possession as transition, and the best time-based proxy is still about a third off — so it is not published raw. Each team's official league total for the game is divided among its players by their scoring inside five seconds of gaining the ball, which makes the team figure exact and leaves the uncertainty in the split. Fractional for that reason.",
    { pbp: true }),
  C("fbp_40", "FB/40", "context", "num1", `Fast break points, estimated. ${PER40}`, { pbp: true }),
  C("fbp_pg", "FB/G", "context", "num1", "Fast break points per game, estimated.", { pbp: true }),
  C("fbp_share", "% Pts FB", "context", "pct1", "Share of his points scored on the break, estimated.", { pbp: true }),

  // ── Advanced, offensive ───────────────────────────────────────────────────
  C("pts2_share", "% Pts 2P", "advoff", "pct1", "Share of his points that came from two-pointers."),
  C("pts3_share", "% Pts 3P", "advoff", "pct1", "Share of his points that came from threes."),
  C("ptsft_share", "% Pts FT", "advoff", "pct1", "Share of his points that came from the line."),
  C("ast_pct", "AST%", "advoff", "num1",
    "Share of his teammates' field goals that he assisted while on the floor. Blank under 100 minutes."),
  C("ast_ratio", "AST Rto", "advoff", "num1",
    "Assists per 100 possessions he used — assists as a share of everything he did with the ball."),
  C("ast_usg", "AST/USG", "advoff", "num2",
    "Assist percentage divided by usage. A high assist rate is easy to post when you hold the ball all night; this asks whether he passed more than his workload alone would explain."),
  C("ppr", "PPR", "advoff", "num1",
    "Pure Point Rating — assists weighed against turnovers, per 100 possessions, on Hollinger's two-thirds weighting. Positive means he creates more with the pass than he gives away."),
  C("ftm_rate", "FTM Rate", "advoff", "pct1",
    "Free throws MADE per field goal attempt. The companion to free-throw rate, which counts attempts: this one only credits the points that actually arrived."),
  C("orb_pct", "ORB%", "advoff", "num1",
    "Share of available offensive rebounds he collected while on the floor. Blank under 100 minutes."),
  C("reb_pct", "REB%", "advoff", "num1",
    "Share of all available rebounds he collected while on the floor. Blank under 100 minutes."),
  C("ast_pts", "AST PTS", "advoff", "int",
    "Points his teammates scored off his passes, valued at what the shot was actually worth — three for a three. An assist to a shooter is not the same as an assist to a dunker, and this is the column that says so.",
    { pbp: true }),
  C("pts_created", "PTS CR", "advoff", "int",
    "Points created — his own points plus the points his assists produced. The fullest single measure of what his offence put on the scoreboard.",
    { pbp: true }),
  C("self_orb_pct", "Self ORB%", "advoff", "num1",
    "Share of his own missed shots that he rebounded himself. Blank under 20 missed attempts.",
    { pbp: true }),

  // ── Advanced, defensive ───────────────────────────────────────────────────
  C("blk_pct", "BLK%", "advdef", "num1",
    "Share of opponent two-point attempts he blocked while on the floor. Blank under 100 minutes."),
  C("stl_pct", "STL%", "advdef", "num1",
    "Share of opponent possessions he ended with a steal while on the floor. Blank under 100 minutes."),
  C("drb_pct", "DRB%", "advdef", "num1",
    "Share of available defensive rebounds he collected while on the floor. Blank under 100 minutes."),
  C("stl_tov", "STL/TOV", "advdef", "num2",
    "Steals per turnover — takeaways weighed against giveaways."),
  C("blkd_fga", "BLKD/FGA", "advdef", "pct1",
    "Share of his shots that got blocked. Lower is better.",
    { pbp: true }),

  // ── Fouls ─────────────────────────────────────────────────────────────────
  C("pf_eff", "PF Eff", "fouls", "num2",
    "Steals plus blocks per personal foul — disruption weighed against the cost of getting it."),
  C("blk_pf", "BLK/PF", "fouls", "num2", "Blocks per personal foul."),
  C("stl_pf", "STL/PF", "fouls", "num2", "Steals per personal foul."),
  C("fouled_out", "FO", "fouls", "int", "Games fouled out. Lower is better."),

  // ── Milestones. Raw counts, no chips — see noPct. ──────────────────────────
  C("dd", "DD", "doubles", "int", "Double-doubles — games with ten or more in two of points, rebounds, assists, steals and blocks.", { noPct: true }),
  C("td", "TD", "doubles", "int", "Triple-doubles — ten or more in three of the five.", { noPct: true }),
  C("g20p10a", "20/10 A", "doubles", "int", "Games with 20 or more points and 10 or more assists.", { noPct: true }),
  C("g20p10r", "20/10 R", "doubles", "int", "Games with 20 or more points and 10 or more rebounds.", { noPct: true }),
  C("g3x5", "3×5", "doubles", "int", "Games with at least three of each of points, rebounds, assists, steals and blocks.", { noPct: true }),
  C("g4x5", "4×5", "doubles", "int", "Games with at least four of each of the five.", { noPct: true }),
  C("g5x5", "5×5", "doubles", "int", "Games with at least five of each of the five — the rarest line in the sport.", { noPct: true }),

  // ── Single-game leads. Ties count for everyone tied. ───────────────────────
  C("led_g_pts", "Led G PTS", "leaders", "int", "Games he led all players on the floor in scoring.", { noPct: true }),
  C("led_g_reb", "Led G REB", "leaders", "int", "Games he led all players in rebounds.", { noPct: true }),
  C("led_g_ast", "Led G AST", "leaders", "int", "Games he led all players in assists.", { noPct: true }),
  C("led_g_stl", "Led G STL", "leaders", "int", "Games he led all players in steals.", { noPct: true }),
  C("led_g_blk", "Led G BLK", "leaders", "int", "Games he led all players in blocks.", { noPct: true }),
  C("led_g_pa", "Led G P+A", "leaders", "int", "Games he led all players in points plus assists.", { noPct: true }),
  C("led_g_pr", "Led G P+R", "leaders", "int", "Games he led all players in points plus rebounds.", { noPct: true }),
  C("led_g_pra", "Led G P+R+A", "leaders", "int", "Games he led all players in points plus rebounds plus assists.", { noPct: true }),
  C("led_g_prasb", "Led G ALL5", "leaders", "int", "Games he led all players in the sum of all five box categories.", { noPct: true }),
  C("led_t_pts", "Led T PTS", "leaders", "int", "Games he led his own team in scoring.", { noPct: true }),
  C("led_t_reb", "Led T REB", "leaders", "int", "Games he led his team in rebounds.", { noPct: true }),
  C("led_t_ast", "Led T AST", "leaders", "int", "Games he led his team in assists.", { noPct: true }),
  C("led_t_stl", "Led T STL", "leaders", "int", "Games he led his team in steals.", { noPct: true }),
  C("led_t_blk", "Led T BLK", "leaders", "int", "Games he led his team in blocks.", { noPct: true }),
  C("led_t_pa", "Led T P+A", "leaders", "int", "Games he led his team in points plus assists.", { noPct: true }),
  C("led_t_pr", "Led T P+R", "leaders", "int", "Games he led his team in points plus rebounds.", { noPct: true }),
  C("led_t_pra", "Led T P+R+A", "leaders", "int", "Games he led his team in points plus rebounds plus assists.", { noPct: true }),
  C("led_t_prasb", "Led T ALL5", "leaders", "int", "Games he led his team in the sum of all five box categories.", { noPct: true }),
];

export const PACK_STAT_BY_KEY = new Map(PACK_STAT_COLUMNS.map((c) => [c.key, c]));

/** Which group files a set of stat keys needs fetched. */
export function groupsFor(keys: readonly string[]): PackGroup[] {
  const out = new Set<PackGroup>();
  for (const k of keys) {
    const c = PACK_STAT_BY_KEY.get(k);
    if (c) out.add(c.group);
  }
  return [...out];
}
