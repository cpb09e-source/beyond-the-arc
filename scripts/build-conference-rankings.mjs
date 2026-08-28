/**
 * Build public/data/conference-rankings.json — one row per conference per
 * season, for /conferences.
 *
 * See docs/conference-rankings-spec.md for the rules. The short version:
 *
 *   - a conference row is its teams MINUS THE BOTTOM TWO by adjusted NET
 *   - rates and per-game stats are games-weighted means
 *   - ratings and schedule numbers are plain means over the kept teams
 *   - wins, losses and the outcome counts are PER-TEAM means, never totals
 *   - split-coverage stats (fast break, paint, off turnovers, second chance)
 *     weight by their own tracked-game counts, not the season's
 *
 * READS THE SAME FILES THE TEAM EXPLORER READS — public/data/teams-by-year —
 * and emits rows under the explorer's own stat keys. That is deliberate: the
 * page then takes its labels, number formats and percentile directions from
 * TEAM_STAT_COLUMNS, so there is one catalogue rather than two that drift.
 *
 *   node scripts/build-conference-rankings.mjs
 *
 * Reads local files only — no network, so the data freeze does not apply.
 */
import fs from "node:fs";
import path from "node:path";

const IN_DIR = "public/data/teams-by-year";
const OUT = "public/data/conference-rankings.json";

/** 2014-2026 without 2021. 2027 is the preview season: no games, no ranking. */
const SEASONS = [];
for (let y = 2014; y <= 2026; y++) if (y !== 2021) SEASONS.push(y);

/**
 * Fewer than this and it is not a league.
 *
 * Dropping two from a four-team group leaves a pair, and the only thing in
 * thirteen seasons that trips this is the independents — 1 team in 2014, 2015
 * and 2024, 2 in 2023 — who are by definition not a conference.
 */
const MIN_TEAMS = 5;
const DROP_WORST = 2;

// ---------------------------------------------------------------------------
// The stat table
// ---------------------------------------------------------------------------
// [outputKey, sourceKey, rule, weightKey?]
//
//   "w"    games-weighted mean          rates and per-game counts
//   "m"    plain mean over kept teams   ratings, schedule, outcome counts
//
// A weightKey names the games count that covers THAT stat. Absent means the
// season's own `games`.

const STATS = [
  // ── Ratings and schedule (plain means) ────────────────────────────────
  ["a_net", "a_net", "m"],
  ["a_ortg", "a_ortg", "m"],
  ["a_drtg", "a_drtg", "m"],
  ["adjt", "adjt", "m"],
  ["cbb_pace", "pace", "m"],
  ["adj_sos", "sos", "m"],
  ["nc_sos", "nc_sos", "m"],
  ["conf_sos", "conf_sos", "m"],
  ["sos_wp", "sos_wp", "m"],
  ["wab", "wab", "m"],

  // ── Shooting rates (games-weighted) ───────────────────────────────────
  ["cbb_efg", "efg_pct", "w"],
  ["cbb_ts", "ts_pct", "w"],
  ["cbb_fg3", "fg3_pct", "w"],
  ["cbb_ft", "ft_pct", "w"],
  ["cbb_fg3rate", "fg3a_rate", "w"],
  ["cbb_ftarate", "fta_rate", "w"],

  // ── Traditional box (games-weighted per-game counts) ──────────────────
  ["cbb_pts_pg", "pts_pg", "w"],
  ["cbb_fga_pg", "fga_pg", "w"],
  ["cbb_ast_pg", "ast_pg", "w"],
  ["cbb_orb_pg", "orb_pg", "w"],
  ["cbb_drb_pg", "drb_pg", "w"],
  ["cbb_reb_pg", "reb_pg", "w"],
  ["cbb_stl_pg", "stl_pg", "w"],
  ["cbb_blk_pg", "blk_pg", "w"],
  ["cbb_tov_pg", "tov_pg", "w"],
  ["cbb_pf_pg", "pf_pg", "w"],
  ["cbb_pfd_pg", "pfd_pg", "w"],

  // ── Scoring context. The four split stats carry their own coverage. ───
  ["cbb_fbpts_pg", "fbpts_pg", "w", "fbpts_games"],
  ["cbb_pitp_pg", "pitp_pg", "w", "pitp_games"],
  ["cbb_potov_pg", "potov_pg", "w", "potov_games"],
  ["cbb_scp_pg", "scp_pg", "w", "scp_games"],
  ["cbb_bench_pg", "bench_pts_pg", "w"],
  ["cbb_fbpts", "fbpts_pct", "w", "fbpts_games"],
  ["cbb_pitp", "pitp_pct", "w", "pitp_games"],
  ["cbb_scp_pct", "scp_pct", "w", "scp_games"],
  ["cbb_bench_pct", "bench_pts_pct", "w"],
  ["cbb_ast", "ast_pct", "w"],
  ["cbb_unast_share", "unast_share", "w"],
  ["cbb_ast_to", "ast_to", "w"],

  // ── Defensive events ──────────────────────────────────────────────────
  ["cbb_stl_pct", "stl_pct", "w"],
  ["cbb_blk_pct", "blk_pct", "w"],
  ["cbb_hakeem", "hakeem_pct", "w"],
  ["cbb_drb_pct", "drb_pct", "w"],
  ["cbb_stl_pf", "stl_pf", "w"],
  ["cbb_blk_pf", "blk_pf", "w"],
  ["cbb_pf_eff", "pf_eff", "w"],

  // ── Differentials, per game only. See the spec on why no totals. ──────
  ["reb_diff_pg", "reb_diff_pg", "w"],
  ["fg3m_diff_pg", "fg3m_diff_pg", "w"],
  ["tov_diff_pg", "tov_diff_pg", "w"],
  ["fbpts_diff_pg", "fbpts_diff_pg", "w", "fbpts_games"],
  ["pitp_diff_pg", "pitp_diff_pg", "w", "pitp_games"],
  ["potov_diff_pg", "potov_diff_pg", "w", "potov_games"],
  ["scp_diff_pg", "scp_diff_pg", "w", "scp_games"],

  // ── Record and outcomes: per-team means, not sums. ────────────────────
  ["wins", "wins", "m"],
  ["losses", "losses", "m"],
  ["win_pct", "win_pct", "w"],
  ["wins_no_trail", "wins_no_trail", "m"],
  ["wire_wins", "wire_wins", "m"],
  ["losses_no_lead", "losses_no_lead", "m"],
  ["wire_losses", "wire_losses", "m"],
  ["wins_trailing_10", "wins_trailing_10", "m"],
  ["wins_trailing_20", "wins_trailing_20", "m"],
  ["losses_leading_10", "losses_leading_10", "m"],
  ["losses_leading_20", "losses_leading_20", "m"],
];

/**
 * Rate margins, computed AFTER aggregation from the conference's own offensive
 * and defensive rates — never averaged from the teams' own diffs, which would
 * be a mean of differences of means.
 */
const RATE_MARGINS = [
  ["efg_diff", "efg_pct", "efg_pct_def", +1],
  ["fg3_diff", "fg3_pct", "fg3_pct_def", +1],
  ["orb_diff", "orb_pct", "orb_pct_def", +1],
  // Turnovers: forcing them is good, committing them is not, so this one is
  // defense minus offense. Same sign convention as the team explorer.
  ["tov_diff", "tov_pct_def", "tov_pct", +1],
];
/** The offensive/defensive halves the margins need, aggregated the same way. */
const MARGIN_PARTS = ["efg_pct", "efg_pct_def", "fg3_pct", "fg3_pct_def", "orb_pct", "orb_pct_def", "tov_pct", "tov_pct_def"];

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const round = (v, dp) => (v === null ? null : Math.round(v * 10 ** dp) / 10 ** dp);

/** Games-weighted mean, skipping teams with no value or no weight. */
function weighted(teams, key, weightKey) {
  let num_ = 0, den = 0;
  for (const t of teams) {
    const v = num(t.s[key]);
    const w = num(weightKey ? t.s[weightKey] : t.s.games);
    if (v === null || w === null || w <= 0) continue;
    num_ += v * w;
    den += w;
  }
  return den > 0 ? num_ / den : null;
}

/** Plain mean over the kept teams, skipping nulls. */
function mean(teams, key) {
  let sum = 0, n = 0;
  for (const t of teams) {
    const v = num(t.s[key]);
    if (v === null) continue;
    sum += v;
    n++;
  }
  return n > 0 ? sum / n : null;
}

/**
 * Decimals to keep, by stat shape. Percentages are stored as fractions and
 * rendered as percentages, so they need three; ratings need one more than they
 * display so a sort never ties on a rounding artifact.
 */
function dpFor(key) {
  if (/_pct$|^cbb_(efg|ts|fg3|ft|fg3rate|ftarate|ast|unast_share|fbpts|pitp|hakeem|stl_pct|blk_pct|drb_pct)$|^win_pct$|_diff$/.test(key)) return 4;
  return 2;
}

let totalRows = 0;
const rows = [];
const report = [];

for (const year of SEASONS) {
  const file = path.join(IN_DIR, `${year}.json`);
  if (!fs.existsSync(file)) {
    report.push(`${year}: MISSING ${file}`);
    continue;
  }
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));

  /** conference → teams, carrying just the two objects we read from. */
  const byConf = new Map();
  for (const t of raw) {
    const conf = t.conference;
    const s = t.team_season_stats;
    if (!conf || !s) continue;
    const arr = byConf.get(conf) ?? [];
    arr.push({ id: t.id, name: t.name, s });
    byConf.set(conf, arr);
  }

  let skipped = [];
  for (const [conf, teams] of byConf) {
    if (teams.length < MIN_TEAMS) {
      skipped.push(`${conf}(${teams.length})`);
      continue;
    }
    // Bottom two by adjusted NET. A team with no rating at all sorts last —
    // it cannot be shown to belong at the top, and leaving it in would let a
    // missing number survive the cut that exists to remove weak teams.
    const ranked = [...teams].sort((a, b) => (num(b.s.a_net) ?? -Infinity) - (num(a.s.a_net) ?? -Infinity));
    const kept = ranked.slice(0, ranked.length - DROP_WORST);
    const dropped = ranked.slice(ranked.length - DROP_WORST);

    const row = {
      year,
      conf,
      teams: teams.length,
      kept: kept.length,
      dropped: dropped.map((t) => t.name),
    };

    for (const [outKey, srcKey, rule, weightKey] of STATS) {
      const v = rule === "m" ? mean(kept, srcKey) : weighted(kept, srcKey, weightKey);
      row[outKey] = round(v, dpFor(outKey));
    }

    // Points margin per game. The source carries a season total only, so this
    // is the one per-game figure the conference table has to derive itself:
    // every team's margin over every team's game.
    {
      let pts = 0, g = 0;
      for (const t of kept) {
        const d = num(t.s.pts_diff), gg = num(t.s.games);
        if (d === null || gg === null || gg <= 0) continue;
        pts += d;
        g += gg;
      }
      row.pts_diff_pg = g > 0 ? round(pts / g, 2) : null;
    }

    // Rate margins from the conference's own aggregated halves.
    const parts = {};
    for (const k of MARGIN_PARTS) parts[k] = weighted(kept, k);
    for (const [outKey, a, b] of RATE_MARGINS) {
      const va = parts[a], vb = parts[b];
      row[outKey] = va === null || vb === null ? null : round(va - vb, 4);
    }

    rows.push(row);
    totalRows++;
  }
  report.push(`${year}: ${byConf.size - skipped.length} conferences${skipped.length ? `  (skipped ${skipped.join(", ")})` : ""}`);
}

rows.sort((a, b) => b.year - a.year || (b.a_net ?? -Infinity) - (a.a_net ?? -Infinity));

const out = {
  built: new Date().toISOString().slice(0, 10),
  seasons: SEASONS,
  minTeams: MIN_TEAMS,
  dropWorst: DROP_WORST,
  rows,
};
fs.writeFileSync(OUT, JSON.stringify(out));

for (const line of report) console.log(line);
console.log(`\n${OUT}: ${totalRows} rows, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
