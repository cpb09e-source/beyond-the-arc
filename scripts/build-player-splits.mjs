#!/usr/bin/env node
/**
 * build-player-splits.mjs — per-player split stats with cohort percentiles.
 *
 * The Player Overview showed one column of numbers: a full season, per game,
 * about twenty stats. The team dossier has had eight splits and a far wider
 * stat list for a while, and the asymmetry was not principled — we hold every
 * player's game log back to 2014, so the same slicing was always available.
 *
 * OUT: public/data/player-splits/<bartId>.json, one file per ranked player,
 * mirrored to R2 alongside player-ranks and player-games.
 *
 *   { bartId, seasons: { "<year>": {
 *       bucket, cohort,
 *       impact: { epm: [value, pct], off_epm: …, def_epm: …, ewins: … },
 *       splits: { "<split>": {
 *         n: gamesInSplit,
 *         m: { stat: [value, pct] },   // meta + rates — basis-independent
 *         g: { stat: [value, pct] },   // counting stats per GAME
 *         f: { stat: [value, pct] },   // counting stats per 40 MINUTES
 *       } } } } }
 *
 * WHY THE THREE BLOCKS. A percentage is already a rate — TS% per 40 minutes is
 * not a thing — so splitting every stat two ways would have published a second
 * copy of every shooting number under a label that means nothing. Only counting
 * stats get the per-game / per-40 treatment; meta and rates sit in `m` and are
 * shown under either basis.
 *
 * IMPACT IS SEASON-LEVEL AND DOES NOT SPLIT. EPM comes out of a ridge fit over
 * a whole season of stints; there is no such thing as a player's home EPM,
 * because the fit never produced one. Rather than invent it by re-running the
 * regression on half a season — which would be a different, much noisier
 * number wearing the same name — impact sits outside `splits` entirely and the
 * UI labels it as full-season whatever else is selected.
 *
 * PERCENTILES ARE WITHIN (year, split, position bucket). A player's away
 * numbers are ranked against every other player's away numbers, matching how
 * the team panel does it. Players with fewer than MIN_SPLIT_GAMES in a split
 * still get their values but no percentile — four games is not a rate.
 *
 * COHORT is the ranked set: this reads public/data/player-ranks for who is in
 * and which bucket they are in, so the panel can never rank a player against a
 * cohort the rest of the page disagrees about.
 *
 * Reads only committed data — safe to run during the data freeze.
 *
 *   Run: node scripts/build-player-splits.mjs [--year 2026]
 */
import fs from "node:fs";
import path from "node:path";

const DATA = path.resolve("public/data");
const RANKS = path.join(DATA, "player-ranks");
const GAMES = path.join(DATA, "player-games");
const OUT = path.join(DATA, "player-splits");

const argYear = process.argv.includes("--year")
  ? Number(process.argv[process.argv.indexOf("--year") + 1])
  : null;

/** Below this a split's rate is noise, so it ships without a percentile. */
const MIN_SPLIT_GAMES = 4;

/** Season-level, unsplittable, ranked against the (year, bucket) cohort. */
const IMPACT_STATS = ["epm", "off_epm", "def_epm", "ewins", "on_off"];

const norm = (s) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/\buniversity\b|\bthe\b/g, "").replace(/\bstate\b/g, "st").replace(/[^a-z0-9]+/g, "");

const SPLITS = [
  { key: "full",    label: "Full Season",         test: () => true },
  { key: "conf",    label: "Conference Games",    test: (g) => g._conf === true },
  { key: "nonconf", label: "Non-Conference Games", test: (g) => g._conf === false },
  { key: "home",    label: "Home",                test: (g) => g.is_home === true },
  { key: "away",    label: "Away",                test: (g) => g.is_home === false && g.is_neutral !== true },
  { key: "awayn",   label: "Away + Neutral",      test: (g) => g.is_home === false },
  { key: "wins",    label: "Wins",                test: (g) => g.won === true },
  { key: "losses",  label: "Losses",              test: (g) => g.won === false },
];

// Counting stats: summed, then divided by games or by minutes/40.
// `lo` marks the ones where less is better, so the percentile reads as ability.
const COUNTING = [
  { key: "pts", get: (g) => g.pts_scored },
  { key: "reb", get: (g) => g.reb },
  { key: "orb", get: (g) => g.orb },
  { key: "drb", get: (g) => g.drb },
  { key: "ast", get: (g) => g.ast },
  { key: "stl", get: (g) => g.stl },
  { key: "blk", get: (g) => g.blk },
  { key: "tov", get: (g) => g.tov, lo: true },
  { key: "pf",  get: (g) => g.pf,  lo: true },
  { key: "fga", get: (g) => g.fga },
  { key: "fgm", get: (g) => g.fgm },
  { key: "fga3", get: (g) => g.fga3 },
  { key: "fgm3", get: (g) => g.fgm3 },
  { key: "fta", get: (g) => g.fta },
  { key: "ftm", get: (g) => g.ftm },
];

// Rate stats: recomputed from the summed components rather than averaged over
// games. A mean of per-game percentages weights a 2-shot night the same as a
// 20-shot one, which is not what "his FG% at home" means.
const RATES = [
  { key: "fg_pct",  num: (t) => t.fgm,  den: (t) => t.fga },
  { key: "fg3_pct", num: (t) => t.fgm3, den: (t) => t.fga3 },
  { key: "ft_pct",  num: (t) => t.ftm,  den: (t) => t.fta },
  { key: "efg_pct", num: (t) => t.fgm + 0.5 * t.fgm3, den: (t) => t.fga },
  { key: "ts_pct",  num: (t) => t.pts / 2, den: (t) => t.fga + 0.44 * t.fta },
  // PPP belongs here rather than in AVERAGED for the same reason as TS%: it is
  // a ratio of season totals, and averaging per-game ratios would weight a
  // two-shot night like a twenty-shot one. Same numerator family as TS% — the
  // difference is that turnovers are in the denominator, so a possession ended
  // with a giveaway still counts as one spent, and the points are not halved.
  { key: "ppp",     num: (t) => t.pts, den: (t) => t.fga + 0.44 * t.fta + t.tov, scale: 1 },
];

// Averaged over games rather than derived, because the feed already computes
// them per game and we have no possession counts to re-derive them from.
const AVERAGED = [
  { key: "usage_pct", get: (g) => g.usage_pct },
  { key: "ortg", get: (g) => g.ortg },
  { key: "drtg", get: (g) => g.drtg, lo: true },
  { key: "game_score", get: (g) => g.game_score },
];

const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
const r2 = (x) => (x === null ? null : Math.round(x * 100) / 100);

function main() {
  fs.mkdirSync(OUT, { recursive: true });

  // ---- who is in, and in which bucket ----
  const rankFiles = fs.readdirSync(RANKS).filter((f) => f.endsWith(".json"));
  const bucketOf = new Map();       // `${bid}|${year}` -> bucket
  for (const f of rankFiles) {
    const bid = parseInt(f, 10);
    if (!Number.isFinite(bid)) continue;
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(RANKS, f), "utf8")); } catch { continue; }
    for (const s of j.seasonRanks ?? []) {
      if (argYear && s.year !== argYear) continue;
      bucketOf.set(`${bid}|${s.year}`, s.bucket);
    }
  }
  const years = [...new Set([...bucketOf.keys()].map((k) => Number(k.split("|")[1])))].sort();
  console.log(`cohort: ${bucketOf.size.toLocaleString()} player-seasons across ${years.length} years`);

  // ---- conference lookup: player's own, and every opponent's ----
  const confByYear = new Map();     // year -> Map(normName -> conference)
  const ownConf = new Map();        // `${bid}|${year}` -> conference
  for (const y of years) {
    const tf = path.join(DATA, "teams-by-year", `${y}.json`);
    if (fs.existsSync(tf)) {
      const m = new Map();
      for (const t of JSON.parse(fs.readFileSync(tf, "utf8"))) m.set(norm(t.name), t.conference ?? null);
      confByYear.set(y, m);
    }
    const pf = path.join(DATA, "players-by-year", `${y}.json`);
    if (!fs.existsSync(pf)) continue;
    for (const p of JSON.parse(fs.readFileSync(pf, "utf8"))) {
      if (p.bart_player_id == null) continue;
      const t = Array.isArray(p.teams) ? p.teams[0] : p.teams;
      if (t?.conference) ownConf.set(`${p.bart_player_id}|${y}`, t.conference);
    }
  }

  // ---- season impact, straight off the shipped fit ----
  const impactOf = new Map();       // `${bid}|${year}` -> {epm, off_epm, def_epm, ewins}
  for (const y of years) {
    for (const file of [`epm-${y}.json`, `box-epm-${y}.json`]) {
      const fp = path.join(DATA, file);
      if (!fs.existsSync(fp)) continue;
      const j = JSON.parse(fs.readFileSync(fp, "utf8"));
      const est = file.startsWith("box-");
      for (const [id, v] of Object.entries(j.players ?? {})) {
        const key = `${id}|${y}`;
        // The play-by-play fit wins; the box estimate only fills gaps, matching
        // readImpactForYear() so the panel agrees with the rest of the site.
        if (est && impactOf.has(key)) continue;
        const epm = num(est ? v.epm_s ?? v.epm : v.epm);
        if (epm === null) continue;
        impactOf.set(key, {
          epm,
          off_epm: num(est ? v.off_s ?? v.off : v.off),
          def_epm: num(est ? v.def_s ?? v.def : v.def),
          ewins: num(v.ewins),
          // Raw on/off: team net rating with him on the floor minus off it.
          // Only the play-by-play fit carries it, and only above a possession
          // floor, so it is frequently null and that is the honest state.
          on_off: num(v.on_off),
        });
      }
    }
  }

  // ---- aggregate every cohort player's game log ----
  // rows: `${bid}|${year}` -> { splits: { key -> block } }
  const rows = new Map();
  let scanned = 0, noLog = 0;
  for (const key of bucketOf.keys()) {
    const [bidStr, yStr] = key.split("|");
    const bid = Number(bidStr), year = Number(yStr);
    const gf = path.join(GAMES, `${bid}.json`);
    if (!fs.existsSync(gf)) { noLog++; continue; }
    let log;
    try { log = JSON.parse(fs.readFileSync(gf, "utf8")); } catch { noLog++; continue; }

    const mine = (log.games ?? []).filter((g) => g.year === year);
    if (mine.length === 0) { noLog++; continue; }
    scanned++;

    // Conference flag per game: unresolved opponents are non-D1, which is
    // non-conference by definition rather than by failure.
    const my = ownConf.get(key) ?? null;
    const cmap = confByYear.get(year);
    for (const g of mine) {
      const oc = cmap ? cmap.get(norm(g.opp_team_market)) ?? null : null;
      g._conf = my !== null && oc !== null && oc === my;
    }

    const splits = {};
    for (const s of SPLITS) {
      const gs = mine.filter(s.test);
      if (gs.length === 0) continue;
      splits[s.key] = aggregate(gs);
    }
    rows.set(key, splits);
  }
  console.log(`game logs: ${scanned.toLocaleString()} aggregated, ${noLog.toLocaleString()} without one`);

  // ---- percentiles within (year, split, bucket) ----
  // Collected as parallel arrays so one sort per (cohort, stat) does the work.
  const pools = new Map();          // `${year}|${split}|${bucket}|${block}|${stat}` -> [{key, v}]
  const push = (pk, key, v) => {
    if (v === null) return;
    let a = pools.get(pk);
    if (!a) { a = []; pools.set(pk, a); }
    a.push({ key, v });
  };
  for (const [key, splits] of rows) {
    const [, yStr] = key.split("|");
    const bucket = bucketOf.get(key);
    for (const [sk, blk] of Object.entries(splits)) {
      if (blk.n < MIN_SPLIT_GAMES) continue;   // too few games to rank
      for (const block of ["m", "g", "f"]) {
        for (const [stat, v] of Object.entries(blk[block])) {
          push(`${yStr}|${sk}|${bucket}|${block}|${stat}`, key, v);
        }
      }
    }
  }
  // Impact pools sit outside the split loop — one cohort per (year, bucket).
  for (const key of rows.keys()) {
    const [, yStr] = key.split("|");
    const bucket = bucketOf.get(key);
    const im = impactOf.get(key);
    if (!im) continue;
    for (const stat of IMPACT_STATS) {
      push(`${yStr}|_impact|${bucket}|i|${stat}`, key, num(im[stat]));
    }
  }

  const LOWER_IS_BETTER = new Set([
    ...COUNTING.filter((c) => c.lo).map((c) => c.key),
    ...AVERAGED.filter((c) => c.lo).map((c) => c.key),
  ]);
  const pctOf = new Map();          // `${pk}|${key}` -> percentile
  for (const [pk, arr] of pools) {
    const stat = pk.slice(pk.lastIndexOf("|") + 1);
    const lower = LOWER_IS_BETTER.has(stat);
    arr.sort((a, b) => (lower ? a.v - b.v : b.v - a.v));
    const n = arr.length;
    for (let i = 0; i < n; i++) {
      // Ties share the best rank in their run, so identical values never get
      // different percentiles.
      let j = i;
      while (j + 1 < n && arr[j + 1].v === arr[i].v) j++;
      const pct = n === 1 ? 50 : Math.round(100 * (1 - i / (n - 1)));
      for (let k = i; k <= j; k++) pctOf.set(`${pk}|${arr[k].key}`, pct);
      i = j;
    }
  }
  console.log(`percentile pools: ${pools.size.toLocaleString()}`);

  // ---- write ----
  const byPlayer = new Map();
  for (const [key, splits] of rows) {
    const [bidStr, yStr] = key.split("|");
    const bucket = bucketOf.get(key);
    const out = { bucket, splits: {} };

    for (const [sk, blk] of Object.entries(splits)) {
      const rankable = blk.n >= MIN_SPLIT_GAMES;
      const emit = (block) => {
        const o = {};
        for (const [stat, v] of Object.entries(blk[block])) {
          const p = rankable ? pctOf.get(`${yStr}|${sk}|${bucket}|${block}|${stat}|${key}`) ?? null : null;
          o[stat] = [r2(v), p];
        }
        return o;
      };
      out.splits[sk] = { n: blk.n, m: emit("m"), g: emit("g"), f: emit("f") };
    }

    const im = impactOf.get(key);
    if (im) {
      out.impact = {};
      for (const stat of IMPACT_STATS) {
        const v = num(im[stat]);
        out.impact[stat] = [r2(v), v === null ? null : pctOf.get(`${yStr}|_impact|${bucket}|i|${stat}|${key}`) ?? null];
      }
    }
    // Cohort size for the full split, for the "ranked within N" line.
    out.cohort = pools.get(`${yStr}|full|${bucket}|m|mpg`)?.length ?? null;

    if (!byPlayer.has(bidStr)) byPlayer.set(bidStr, {});
    byPlayer.get(bidStr)[yStr] = out;
  }

  let written = 0;
  for (const [bid, seasons] of byPlayer) {
    fs.writeFileSync(path.join(OUT, `${bid}.json`), JSON.stringify({ bartId: Number(bid), seasons }));
    written++;
  }

  // Prune, same rule as the rank generator: this directory IS the split set.
  const stale = fs.readdirSync(OUT).filter((f) => f.endsWith(".json") && !byPlayer.has(f.replace(".json", "")));
  if (written > 0) for (const f of stale) fs.unlinkSync(path.join(OUT, f));

  console.log(`✓ wrote ${written.toLocaleString()} player-split files${stale.length ? `, pruned ${stale.length}` : ""}`);
}

/** One split's numbers for one player-season. */
function aggregate(gs) {
  const t = { pts: 0, reb: 0, orb: 0, drb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0,
    fga: 0, fgm: 0, fga3: 0, fgm3: 0, fta: 0, ftm: 0, mins: 0 };
  let starts = 0;
  for (const g of gs) {
    for (const c of COUNTING) t[c.key] += num(c.get(g)) ?? 0;
    t.mins += num(g.mins) ?? 0;
    if (g.is_starter) starts++;
  }
  const n = gs.length;

  const m = { gp: n, gs: starts, mpg: t.mins / n };
  for (const r of RATES) {
    const d = r.den(t);
    // scale: every rate here is published as a PERCENTAGE except PPP, which is
    // points per possession and belongs on its natural ~1.0 scale. Without the
    // opt-out it shipped as 109.88 instead of 1.10.
    m[r.key] = d > 0 ? ((r.scale ?? 100) * r.num(t)) / d : null;
  }
  for (const a of AVERAGED) {
    const vals = gs.map((g) => num(a.get(g))).filter((v) => v !== null);
    m[a.key] = vals.length ? vals.reduce((x, y) => x + y, 0) / vals.length : null;
  }
  // usage_pct arrives as a fraction; publish it as a percentage like the rest.
  if (m.usage_pct !== null) m.usage_pct *= 100;

  const g = {}, f = {};
  for (const c of COUNTING) {
    g[c.key] = t[c.key] / n;
    f[c.key] = t.mins > 0 ? (t[c.key] * 40) / t.mins : null;
  }
  return { n, m, g, f };
}

main();
