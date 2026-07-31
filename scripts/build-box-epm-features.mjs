#!/usr/bin/env node
// Build the Box-EPM training/prediction feature matrix.
//
// Emits one CSV row per (year, player) with box-score features derived ENTIRELY
// from Bart's raw_row — those columns are populated identically across all
// seasons 2008-2026 (the CBBD-sourced `advanced_stats` field is null pre-2010,
// so we deliberately don't touch it here). Training labels (epm/off/def) are
// joined from public/data/epm-<year>.json where a real fit exists (2026 today);
// rows without a label are still emitted so the Python step can predict them.
//
// Columns confirmed against transformPlayer + earlier probes:
//   raw_row[6]  = usage %          raw_row[9]  = turnover rate
//   raw_row[22] = block %          raw_row[23] = steal %
//   raw_row[28] = PORPAG           raw_row[54] = minutes per game
//   from-end offsets: pts=3 blk=4 stl=5 ast=6 reb=7 drb=8 orb=9
//   from-start totals: ftm=13 fta=14 fg2m=16 fg2a=17 fg3m=19 fg3a=20
//   notes (position) = from-end offset 2
//
// Output: scripts/box-epm-features.csv
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATA = join(ROOT, "public", "data");
const YEARS = Array.from({ length: 2026 - 2008 + 1 }, (_, i) => 2008 + i);

function num(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") { const n = Number(v); return Number.isFinite(n) ? n : null; }
  return null;
}
function fromEnd(row, off) { return row && row.length > off ? num(row[row.length - 1 - off]) : null; }
function fromStart(row, i) { return row && row.length > i ? num(row[i]) : null; }

function heightIn(h) {
  if (!h || typeof h !== "string") return null;
  const m = h.match(/(\d+)\s*[-']\s*(\d+)/);
  return m ? Number(m[1]) * 12 + Number(m[2]) : null;
}
const CLASS_NUM = { Fr: 1, So: 2, Jr: 3, Sr: 4, Gr: 5 };
// Position bucket from Bart's note (mirror of players-client BUCKET_BY_NOTE).
const BUCKET = {
  "Pure PG": "G", "Scoring PG": "G", "Combo G": "G", "Wing G": "G",
  "Wing F": "F", "Stretch 4": "F", "G/F": "G", "F/G": "F",
  "C/F": "C", "PF/C": "C", "C": "C",
};

// Feature column order — Python reads this header.
const FEATURES = [
  "min_pg", "usg", "to_rate", "porpag",
  "ts", "efg", "ftr", "tpar",
  "pts40", "ast40", "reb40", "orb40", "drb40", "stl40", "blk40",
  "blk_pct", "stl_pct", "height_in", "class_num",
  "is_g", "is_f", "is_c",
  "team_adj_net", // team adjusted net rating (from team-ratings-<year>.json); "" when that season's ratings aren't built yet
];

// Team adjusted net rating per season, keyed by normalized team name so Bart
// player-team names join to CBBD-derived team-ratings.
function normTeam(s) {
  return (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/\buniversity\b|\bthe\b/g, "").replace(/\bstate\b/g, "st")
    .replace(/[^a-z0-9]+/g, "");
}
function loadTeamRatings(year) {
  const f = join(DATA, `team-ratings-${year}.json`);
  if (!existsSync(f)) return null;
  const j = JSON.parse(readFileSync(f, "utf8"));
  const m = new Map();
  for (const t of j.teams) m.set(normTeam(t.team), t.adj_net);
  return m;
}

/**
 * Three-point shrinkage for the PRIOR.
 *
 * This file feeds Box-EPM, which is the Bayesian prior the ridge-RAPM fit
 * starts from — so its job is to estimate a player's TALENT, not to recount
 * what the scoreboard said. A season three-point percentage is a bad estimate
 * of talent at college volume, and we can say how bad from our own archive.
 *
 * Empirical Bayes over 2014-2026 (players with 50+ 3PA): the observed spread in
 * 3P% is 4.9-5.2 points, of which 4.4-4.5 is binomial noise. What survives is
 * sd(true) ~ 2.2%. That puts the shrinkage constant — the attempt count at
 * which a player's own rate finally deserves half the weight — at a MEDIAN OF
 * 412 ATTEMPTS. Year over year, the same player's 3P% correlates at just r=0.22.
 * At a typical 150 attempts, three quarters of a shooter's deviation from
 * league average is noise.
 *
 * So the prior sees expected threes, not made threes:
 *
 *     expected 3P%  = (3PM + K * league3P%) / (3PA + K)
 *     luck          = 3 * (3PM - 3PA * expected 3P%)
 *
 * and TS / eFG / pts40 / PORPAG are all restated net of that luck.
 *
 * FREE THROWS AND TWOS ARE LEFT ALONE, and the same measurement is why:
 * FT% has k = 27 attempts and repeats at r=0.735; 2P% has k = 71 and r=0.602.
 * Both are essentially skill by the end of a season — a player who shot 88%
 * from the line really is an 88% shooter. Only the three needed this.
 *
 * Note this asks a DIFFERENT question than the team-level luck adjustment in
 * compute-epm.py. There we removed a team's wobble around its own season rate
 * and kept the rate. Here the season rate ITSELF is the estimate under
 * suspicion, which is why free throws come out of the two tests differently.
 */
const SHRINK_3PA = Number(process.env.BTA_SHRINK_3PA ?? 412);

function featurize(p, lg3) {
  const st = Array.isArray(p.player_bart_stats) ? p.player_bart_stats[0] : p.player_bart_stats;
  const row = st?.raw_row ?? null;
  if (!row) return null;
  const games = num(st?.games);
  const min_pg = fromStart(row, 54);
  if (!min_pg || min_pg <= 0 || !games) return null;

  const per40 = (v) => (v == null ? null : (v / min_pg) * 40);
  const pts_pg = fromEnd(row, 3), ast_pg = fromEnd(row, 6), reb_pg = fromEnd(row, 7);
  const drb_pg = fromEnd(row, 8), orb_pg = fromEnd(row, 9), stl_pg = fromEnd(row, 5), blk_pg = fromEnd(row, 4);

  const ftm = fromStart(row, 13), fta = fromStart(row, 14);
  const fg2m = fromStart(row, 16), fg2a = fromStart(row, 17);
  const fg3m = fromStart(row, 19), fg3a = fromStart(row, 20);
  const fgm = fg2m != null && fg3m != null ? fg2m + fg3m : null;
  const fga = fg2a != null && fg3a != null ? fg2a + fg3a : null;

  // Expected threes. Falls through to zero when a season lacks the split, so a
  // player without shot totals is simply left unadjusted rather than dropped.
  const exp3 = SHRINK_3PA > 0 && lg3 != null && fg3a != null && fg3m != null
    ? (fg3m + SHRINK_3PA * lg3) / (fg3a + SHRINK_3PA) : null;
  const luck3 = exp3 != null ? 3 * (fg3m - fg3a * exp3) : 0;

  const ptsTot = pts_pg != null && games ? pts_pg * games - luck3 : null;
  const ts = ptsTot != null && fga != null && fta != null && (fga + 0.44 * fta) > 0
    ? ptsTot / (2 * (fga + 0.44 * fta)) : null;
  // eFG on expected threes: every three counts as exp3 of a make, half-weighted.
  const efg = fga && fg2m != null && exp3 != null ? (fg2m + 1.5 * exp3 * fg3a) / fga
    : fgm != null && fg3m != null && fga ? (fgm + 0.5 * fg3m) / fga : null;
  const ftr = fta != null && fga ? fta / fga : null;
  const tpar = fg3a != null && fga ? fg3a / fga : null;   // volume, not luck

  // PORPAG STAYS RAW, and that is a measured decision, not an oversight. It is
  // the one remaining points-driven feature, so it still carries three-point
  // luck — but the correction available for it is worse than the disease.
  // Subtracting luck/games looks dimensionally right and is not: Bart's
  // denominator is pace-adjusted games and the statistic is points over a
  // REPLACEMENT baseline, not raw points. Trying it dropped OFF train R2 from
  // 0.905 to 0.816 and pushed the prior's out-of-sample correlation with next
  // season's RAPM BELOW the unadjusted baseline (0.553 vs 0.578), while
  // handing +3.95 box-EPM to a single high-volume cold shooter. Leaving it
  // alone is the honest limitation.
  const porpag = fromStart(row, 28);

  const note = fromEndNote(row);
  const bucket = note ? BUCKET[note] ?? null : null;

  return {
    min_pg,
    usg: fromStart(row, 6),
    to_rate: fromStart(row, 9),
    porpag,
    ts, efg, ftr, tpar,
    pts40: per40(ptsTot != null && games ? ptsTot / games : pts_pg),
    ast40: per40(ast_pg), reb40: per40(reb_pg),
    orb40: per40(orb_pg), drb40: per40(drb_pg), stl40: per40(stl_pg), blk40: per40(blk_pg),
    blk_pct: fromStart(row, 22), stl_pct: fromStart(row, 23),
    height_in: heightIn(p.height),
    class_num: p.class ? CLASS_NUM[p.class] ?? null : null,
    is_g: bucket === "G" ? 1 : 0,
    is_f: bucket === "F" ? 1 : 0,
    is_c: bucket === "C" ? 1 : 0,
  };
}
function fromEndNote(row) {
  // notes (position) sits at from-end offset 2 (string, e.g. "Combo G").
  const v = row && row.length > 2 ? row[row.length - 1 - 2] : null;
  return typeof v === "string" ? v : null;
}

function loadEpm(year) {
  const f = join(DATA, `epm-${year}.json`);
  if (!existsSync(f)) return null;
  const j = JSON.parse(readFileSync(f, "utf8"));
  return j.players ?? j;
}

const rows = [];
let labeled = 0;
for (const year of YEARS) {
  const f = join(DATA, "players-by-year", `${year}.json`);
  if (!existsSync(f)) { console.warn(`skip ${year}: no players file`); continue; }
  const players = JSON.parse(readFileSync(f, "utf8"));
  const epm = loadEpm(year);
  const tr = loadTeamRatings(year);
  // League 3P% for THIS season — the mean the shrinkage pulls toward. Computed
  // per season rather than once overall because the college line moved in 2020.
  let m3 = 0, a3 = 0;
  for (const p of players) {
    const st = Array.isArray(p.player_bart_stats) ? p.player_bart_stats[0] : p.player_bart_stats;
    const row = st?.raw_row;
    if (!row) continue;
    const m = fromStart(row, 19), a = fromStart(row, 20);
    if (m != null && a != null) { m3 += m; a3 += a; }
  }
  const lg3 = a3 > 0 ? m3 / a3 : null;
  if (lg3 != null) console.log(`  ${year}: league 3P% ${(lg3 * 100).toFixed(1)} over ${a3.toLocaleString()} attempts`);
  for (const p of players) {
    const bid = p.bart_player_id;
    if (bid == null) continue;
    const feat = featurize(p, lg3);
    if (!feat) continue;
    const team = Array.isArray(p.teams) ? p.teams[0] : p.teams;
    const lab = epm ? epm[String(bid)] : null;
    if (lab) labeled++;
    const teamAdjNet = tr && team ? (tr.get(normTeam(team.name)) ?? "") : "";
    rows.push({
      year, bart_player_id: bid, name: p.name, team: team?.name ?? "",
      ...feat,
      team_adj_net: teamAdjNet,
      epm: lab ? lab.epm : "", off: lab ? lab.off : "", def: lab ? lab.def : "",
      poss: lab ? lab.poss : "",
    });
  }
}

// ── Era normalization ──────────────────────────────────────────────
// College efficiency has drifted up over the years (avg D1 ORtg ~105 in the
// mid-2010s → ~110 by 2026). Raw efficiency/rate features would make older
// players look weak against a model trained on modern norms, so we z-score the
// drift-sensitive features WITHIN each season: each becomes "SDs above/below
// your own era." A 2016 player at +1 SD TS scores like a 2026 player at +1 SD.
// Left RAW (not era stats): min_pg, height, class, position dummies, and
// team_adj_net (already adjusted vs its season's league average).
const ERA_FEATURES = [
  "usg", "to_rate", "porpag", "ts", "efg", "ftr", "tpar",
  "pts40", "ast40", "reb40", "orb40", "drb40", "stl40", "blk40", "blk_pct", "stl_pct",
];
{
  const byYear = new Map();
  for (const r of rows) { if (!byYear.has(r.year)) byYear.set(r.year, []); byYear.get(r.year).push(r); }
  for (const [, yrows] of byYear) {
    for (const f of ERA_FEATURES) {
      const vals = yrows.map((r) => r[f]).filter((v) => typeof v === "number" && Number.isFinite(v));
      if (vals.length < 2) continue;
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) || 1;
      for (const r of yrows) {
        if (typeof r[f] === "number" && Number.isFinite(r[f])) {
          r[f] = Math.round(((r[f] - mean) / sd) * 10000) / 10000;
        }
      }
    }
  }
}

const header = ["year", "bart_player_id", "name", "team", ...FEATURES, "epm", "off", "def", "poss"];
const csvEsc = (v) => {
  if (v == null || v === "") return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const lines = [header.join(",")];
for (const r of rows) lines.push(header.map((h) => csvEsc(r[h])).join(","));
const out = join(__dirname, "box-epm-features.csv");
writeFileSync(out, lines.join("\n"));
console.log(`Wrote ${rows.length} rows (${labeled} labeled) → ${out}`);
console.log(`Features (${FEATURES.length}): ${FEATURES.join(", ")}`);
