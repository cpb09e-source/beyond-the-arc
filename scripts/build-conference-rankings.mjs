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
const SPLIT_DIR = "public/data/team-splits";
const TOURNEY_FILE = "src/data/tournament-games.json";
const OUT = "public/data/conference-rankings.json";
/**
 * The splits ride in their own file.
 *
 * Folded into the main one they took it from 105 KB gzipped to 215, on every
 * visit, to serve a control most readers will never touch. Separate, the page
 * loads what it shows and fetches the rest the first time somebody picks a
 * split.
 */
const OUT_SPLITS = "public/data/conference-splits.json";

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

// ---------------------------------------------------------------------------
// The conference-games / non-conference-games splits
// ---------------------------------------------------------------------------
//
// public/data/team-splits/<year>.json holds each team's numbers cut eight
// ways; two of them are worth aggregating to a conference.
//
// A CONFERENCE ROW ON THE CONFERENCE SPLIT IS MOSTLY SELF-PLAY, and its
// margin collapses towards zero because of it: in league games the league is
// playing itself, so one team's points scored are another's allowed.
//
// It does NOT land on zero, and the gap is the whole point of this page. The
// kept teams are the league minus its worst two, and those two are exactly
// who the kept teams beat in league play — so a healthy conference sits at
// +1.4 to +4.8 (2026), not at 0. A league whose top teams cannot separate
// from its bottom two shows up here immediately.
//
// Read the conference split for pace, shooting and the rate stats, and read
// non-conference for how the league does against everybody else.
//
// [ourKey, splitKey, rule] — same two rules as the full-season table.
const SPLIT_STATS = [
  ["cbb_ortg", "ortg", "m"],
  ["cbb_drtg", "drtg", "m"],
  ["net_rtg", "net_rtg", "m"],
  ["cbb_pace", "pace", "m"],

  ["cbb_efg", "efg", "w"],
  ["cbb_ts", "ts_pct", "w"],
  ["cbb_orb", "orb_pct", "w"],
  ["cbb_tov", "tov_pct", "w"],
  ["cbb_ftarate", "ftr", "w"],
  ["cbb_fg3", "fg3_pct", "w"],
  ["cbb_ft", "ft_pct", "w"],
  ["cbb_fg3rate", "fg3_rate", "w"],

  ["cbb_pts_pg", "pts_pg", "w"],
  ["cbb_fga_pg", "fga_pg", "w"],
  ["cbb_ast_pg", "ast_pg", "w"],
  ["cbb_orb_pg", "orb_pg", "w"],
  ["cbb_drb_pg", "drb_pg", "w"],
  ["cbb_stl_pg", "stl_pg", "w"],
  ["cbb_blk_pg", "blk_pg", "w"],
  ["cbb_tov_pg", "tov_pg", "w"],
  ["cbb_pf_pg", "pf_pg", "w"],
  ["cbb_pfd_pg", "pfd_pg", "w"],

  ["cbb_fbpts_pg", "fbpts_pg", "w"],
  ["cbb_pitp_pg", "pitp_pg", "w"],
  ["cbb_potov_pg", "pot_pg", "w"],
  ["cbb_fbpts", "fbpts_sh", "w"],
  ["cbb_pitp", "pitp_sh", "w"],
  ["cbb_ast", "ast_pct", "w"],
  ["cbb_ast_to", "ast_tov", "w"],

  ["cbb_stl_pct", "stl_pct", "w"],
  ["cbb_blk_pct", "blk_pct", "w"],
  ["cbb_hakeem", "hkm_pct", "w"],
  ["cbb_drb_pct", "drb_pct", "w"],
  ["cbb_stl_pf", "stl_pf", "w"],
  ["cbb_blk_pf", "blk_pf", "w"],
  ["cbb_pf_eff", "pf_eff", "w"],
];
/** Which splits the page offers. `full` is the top-level row itself. */
const SPLIT_KEYS = ["conf", "nonconf"];

// ---------------------------------------------------------------------------
// March
// ---------------------------------------------------------------------------
//
// EVERY TEAM IN THE LEAGUE, INCLUDING THE TWO THE ROW DROPS. This is the one
// place the drop rule does not apply, on purpose: "the ACC went 5-4 in March"
// is a fact about the ACC, and a bid is a bid however the team rated. A
// one-bid league whose auto-bid came from its 9th-best team still played that
// game, and hiding it would make the column wrong rather than consistent.
//
// Names come from Sports Reference and the conferences from Bart, so the join
// is normalised on both sides and anything left over is reported rather than
// silently dropped.
const tourneyByYear = fs.existsSync(TOURNEY_FILE)
  ? JSON.parse(fs.readFileSync(TOURNEY_FILE, "utf8"))
  : {};

function normSchool(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\bstate\b/g, "st")
    .replace(/\buniversity\b|\bthe\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

/** SR spellings that normalise to something Bart does not use. */
const TOURNEY_ALIASES = {
  connecticut: "connecticut",
  uconn: "connecticut",
  unc: "northcarolina",
  pittsburgh: "pittsburgh",
  pitt: "pittsburgh",
  "olemiss": "mississippi",
  umass: "massachusetts",
  "texasam": "texasam",
  "miamifl": "miamifl",
  miami: "miamifl",
  "miamiflorida": "miamifl",
  "loyolachicago": "loyolachicago",
  "loyoilchicago": "loyolachicago",
  "saintmarys": "saintmarys",
  "stmarys": "saintmarys",
  "saintmaryscalifornia": "saintmarys",
  "unclv": "unlv",
  "southerncalifornia": "usc",
  "brighamyoung": "byu",
  "centralflorida": "ucf",
  "virginiacommonwealth": "vcu",
  "texaschristian": "tcu",
  "southernmethodist": "smu",
  "louisianastate": "lsu",
  "nevadalasvegas": "unlv",
  "mountstmarys": "mountstmarys",
  // SR writes the parenthetical, Bart does not; SR abbreviates where Bart
  // spells out, and each of these was a real tournament team dropped from
  // its conference row until it was listed here.
  "albanyny": "albany",
  "stjohnsny": "stjohns",
  "etsu": "easttennesseest",
  "collegeofcharleston": "charleston",
  "loyolail": "loyolachicago",
  "fdu": "fairleighdickinson",
  "texasamcorpuschristi": "texasamcorpuschris",
  "grambling": "gramblingst",
  "mcneese": "mcneesest",
  "omaha": "nebraskaomaha",
  "californiabaptist": "calbaptist",
  "queensnc": "queens",
};
const joinKey = (name) => {
  const n = normSchool(name);
  return TOURNEY_ALIASES[n] ?? n;
};

/** Rounds a team reaching them has played, for the Sweet 16 tally. */
const DEEP_ROUNDS = new Set(["Sweet 16", "Elite Eight", "Final Four", "Champion"]);

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const round = (v, dp) => (v === null ? null : Math.round(v * 10 ** dp) / 10 ** dp);

/** Games-weighted mean, skipping teams with no value or no weight. */
function weighted(teams, key, weightKey, pick = (t) => t.s) {
  let num_ = 0, den = 0;
  for (const t of teams) {
    const bag = pick(t);
    if (!bag) continue;
    const v = num(bag[key]);
    const w = num(weightKey ? bag[weightKey] : bag.games);
    if (v === null || w === null || w <= 0) continue;
    num_ += v * w;
    den += w;
  }
  return den > 0 ? num_ / den : null;
}

/** Plain mean over the kept teams, skipping nulls. */
function mean(teams, key, pick = (t) => t.s) {
  let sum = 0, n = 0;
  for (const t of teams) {
    const bag = pick(t);
    if (!bag) continue;
    const v = num(bag[key]);
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
  if (key === "net_rtg") return 2;
  if (/_pct$|^cbb_(efg|ts|fg3|ft|fg3rate|ftarate|ast|unast_share|fbpts|pitp|hakeem|stl_pct|blk_pct|drb_pct)$|^win_pct$|_diff$/.test(key)) return 4;
  return 2;
}

let totalRows = 0;
const rows = [];
/** Tournament schools no conference could be found for, reported at the end. */
const marchUnmatched = [];
/** year|conf -> { conf, nonconf }, written to its own file. */
const splitRows = {};
const report = [];

for (const year of SEASONS) {
  const file = path.join(IN_DIR, `${year}.json`);
  if (!fs.existsSync(file)) {
    report.push(`${year}: MISSING ${file}`);
    continue;
  }
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));

  /**
   * The same season cut by conference / non-conference games, keyed by team
   * NAME — which is the only join these two files share. A missing file is
   * not fatal: the season simply has no splits and the page falls back to
   * full-season for it.
   */
  const splitFile = path.join(SPLIT_DIR, `${year}.json`);
  const splitDoc = fs.existsSync(splitFile) ? JSON.parse(fs.readFileSync(splitFile, "utf8")) : null;
  const splitStatIndex = new Map((splitDoc?.stats ?? []).map((st, i) => [st.key, i]));
  /**
   * One team's split as a flat {statKey: value, games} bag.
   *
   * SCALE CONVERSION HAPPENS HERE. The splits file stores a percentage as a
   * whole number (53.2 for an eFG%) where every other file on the site — and
   * every formatter reading these rows — stores it as a fraction. Read off
   * the file's own `fmt` rather than a hand-kept list, so a stat that changes
   * shape upstream cannot land here silently multiplied by a hundred.
   */
  const splitIsPct = new Set((splitDoc?.stats ?? []).filter((st) => st.fmt === "pct1").map((st) => st.key));
  const splitBag = (teamName, splitKey) => {
    const rec = splitDoc?.teams?.[teamName]?.[splitKey];
    if (!rec || !Array.isArray(rec.v)) return null;
    const out = { games: rec.games };
    for (const [k, i] of splitStatIndex) {
      const v = rec.v[i];
      out[k] = typeof v === "number" && splitIsPct.has(k) ? v / 100 : (v ?? null);
    }
    return out;
  };

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

  /**
   * conference -> { bids, w, l, s16 } for this season's NCAA tournament.
   *
   * Built over EVERY team in the league, not the kept ones — see the note on
   * tourneyByYear. Seasons with no tournament (2020, cancelled) simply have
   * no entry and the columns come out blank.
   */
  const marchByConf = new Map();
  {
    const games = tourneyByYear[String(year)] ?? [];
    const confOf = new Map();
    /** joinKey -> Bart's own spelling, which is what the logo lookup wants. */
    const bartName = new Map();
    for (const t of raw) {
      if (!t.conference || !t.name) continue;
      confOf.set(joinKey(t.name), t.conference);
      bartName.set(joinKey(t.name), t.name);
    }
    const seen = new Set();
    const unmatched = new Set();
    const bump = (conf, field, by = 1) => {
      const rec = marchByConf.get(conf) ?? { bids: 0, w: 0, l: 0, s16: 0, f4: 0, nc: 0 };
      rec[field] += by;
      marchByConf.set(conf, rec);
    };
    for (const g of games) {
      for (const [side, field] of [[g.winner, "w"], [g.loser, "l"]]) {
        const key = joinKey(side.school);
        const conf = confOf.get(key);
        if (!conf) { unmatched.add(side.school); continue; }
        bump(conf, field);
        // A bid is counted once per team, on whatever game it first appears
        // in — which is its opener, since the file is in bracket order.
        if (!seen.has(key)) { seen.add(key); bump(conf, "bids"); }
        // A ROUND IS REACHED BY WINNING THE ONE BEFORE IT. The file names a
        // game by the round it IS, so the Sweet 16 field is the set of R32
        // winners, the Final Four is the set of Elite Eight winners, and the
        // champion is the winner of the game called "Champion". Counting
        // appearances in the round itself would work too but would tally a
        // team twice where a round has two games.
        if (field === "w") {
          if (g.round === "R32") bump(conf, "s16");
          else if (g.round === "Elite Eight") bump(conf, "f4");
          else if (g.round === "Champion") {
            bump(conf, "nc");
            // The champion by name as well as by count: the table draws the
            // school's crest in that cell rather than the number 1, which is
            // the only value the column ever takes.
            const rec = marchByConf.get(conf);
            if (rec) rec.champ = bartName.get(key) ?? side.school;
          }
        }
      }
    }
    if (unmatched.size) marchUnmatched.push(`${year}: ${[...unmatched].join(", ")}`);
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

    // March, from the whole league rather than the kept set.
    {
      const m = marchByConf.get(conf);
      row.ncaa_bids = m ? m.bids : null;
      row.ncaa_w = m ? m.w : null;
      row.ncaa_l = m ? m.l : null;
      row.ncaa_s16 = m ? m.s16 : null;
      row.ncaa_f4 = m ? m.f4 : null;
      row.ncaa_nc = m ? m.nc : null;
      if (m?.champ) row.ncaa_champ = m.champ;
    }

    // Rate margins from the conference's own aggregated halves.
    const parts = {};
    for (const k of MARGIN_PARTS) parts[k] = weighted(kept, k);
    for (const [outKey, a, b] of RATE_MARGINS) {
      const va = parts[a], vb = parts[b];
      row[outKey] = va === null || vb === null ? null : round(va - vb, 4);
    }

    /**
     * THE SAME KEPT TEAMS, cut two more ways.
     *
     * The cut is decided once, on full-season aNET, and then applied to every
     * split. Re-ranking within each split would mean the conference-games row
     * and the full-season row described different sets of teams, and no
     * reader would be able to compare them.
     */
    if (splitDoc) {
      const split = {};
      for (const sk of SPLIT_KEYS) {
        const bag = (t) => splitBag(t.name, sk);
        const withData = kept.filter((t) => bag(t));
        if (withData.length < 3) continue;
        const block = {};
        for (const [outKey, srcKey, rule] of SPLIT_STATS) {
          const v = rule === "m" ? mean(withData, srcKey, bag) : weighted(withData, srcKey, undefined, bag);
          block[outKey] = round(v, dpFor(outKey));
        }
        // The splits carry offensive and defensive rebounds but not the sum.
        block.cbb_reb_pg = block.cbb_orb_pg !== null && block.cbb_drb_pg !== null
          ? round(block.cbb_orb_pg + block.cbb_drb_pg, 2) : null;
        // Points margin per game, from the same rating pair the row already
        // has: (net per 100) x (possessions per game) / 100.
        block.pts_diff_pg = block.net_rtg !== null && block.cbb_pace !== null
          ? round((block.net_rtg * block.cbb_pace) / 100, 2) : null;
        block.games = round(mean(withData, "games", bag), 1);
        block.teams = withData.length;
        split[sk] = block;
      }
      if (Object.keys(split).length) splitRows[`${year}|${conf}`] = split;
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
fs.writeFileSync(OUT_SPLITS, JSON.stringify({
  built: out.built,
  splits: [
    { key: "conf", label: "Conference Games" },
    { key: "nonconf", label: "Non-Conference Games" },
  ],
  rows: splitRows,
}));

for (const line of report) console.log(line);
if (marchUnmatched.length) {
  console.log("");
  console.log("Tournament schools with no conference match:");
  for (const line of marchUnmatched) console.log("  " + line);
}
console.log(`\n${OUT}: ${totalRows} rows, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
console.log(`${OUT_SPLITS}: ${Object.keys(splitRows).length} rows, ${(fs.statSync(OUT_SPLITS).size / 1024).toFixed(0)} KB`);
