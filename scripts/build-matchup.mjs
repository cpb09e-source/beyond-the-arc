#!/usr/bin/env node
/**
 * build-matchup.mjs — everything the Matchup Predictor needs, for one season,
 * in one file the browser can hold.
 *
 *   node scripts/build-matchup.mjs --season 2026
 *
 * Out: public/data/matchup/<season>.json  (~55 KB raw, ~15 KB gzipped for the
 * team block; rosters roughly double it). Tracked in git like the other small
 * top-level corpora — it is rewritten once per rebuild, not nightly.
 *
 * WHY THIS IS ITS OWN BUILD AND NOT A READ OF team-ratings-<season>.json.
 * That file applies CAL = 0.84, a scale factor that lands its adjusted
 * ratings on CBBD's published magnitudes. The matchup model's constants
 * (src/lib/matchup.ts) were fitted against UNSCALED ratings from exactly the
 * engine below; dropping them onto the calibrated numbers would mis-scale
 * every projection by ~19% without a single error. So this emits its own
 * ratings, on its own scale, and nothing already shipping is touched.
 *
 * The engine is the walk-forward research harness (docs/matchup-predictor.md,
 * part 2 §3 and part 3) collapsed to its end-of-season case — every
 * modelling choice the backtests settled is a constant here, not an option:
 *
 *   possession gate        45..110 and |hPoss − aPoss| ≤ 4      (part 2 §2)
 *   home court             2.0 per side per 100                 (part 2 §3)
 *   shrinkage              k = 3 toward last season, carried unregressed
 *   efficiency cap         ±25 around the league mean
 *   style                  fixed point over six four-factor dimensions
 *   conference tier        top six leagues by mean adjusted net (part 2 §8)
 *   rotation               ≥3 appearances and ≥8 mpg over the last 10 (part 3 §15)
 *   continuity             share of last season's minutes that came back
 *
 * Names. The archive uses CBBD names ("Ohio State", "UConn"); the site's team
 * pages and logos use Bart names ("Ohio St.", "Connecticut"). Each team is
 * resolved to its Bart name through the same normalisation and alias table
 * src/lib/quad.ts uses for the win calculator, inverted; the build prints any
 * team it could not resolve so the miss is a line in the log, not a broken
 * link on the page.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const args = process.argv.slice(2);
const SEASON = Number(args[args.indexOf("--season") + 1]);
if (!SEASON) { console.error("usage: node scripts/build-matchup.mjs --season 2026"); process.exit(1); }
const PRIOR = SEASON - 1;

const ROOT = path.resolve(".");
const CBBD = (s) => path.join(ROOT, "data/cbbd", String(s));
const OUT_DIR = path.join(ROOT, "public/data/matchup");
const BUILT_AT = process.env.BUILD_STAMP || new Date().toISOString().slice(0, 10);

const DAY = 86400000;
const day = (iso) => Math.round(Date.parse(iso.slice(0, 10) + "T00:00:00Z") / DAY);
const gz = (p) => JSON.parse(zlib.gunzipSync(fs.readFileSync(p)));

// ── Games ──────────────────────────────────────────────────────────────────

const ff = (s) => ({
  efg: s?.fourFactors?.effectiveFieldGoalPct ?? null,
  orb: s?.fourFactors?.offensiveReboundPct ?? null,
  tov: s?.fourFactors?.turnoverRatio ?? null,
  ftr: s?.fourFactors?.freeThrowRate ?? null,
  fga: s?.fieldGoals?.attempted ?? null,
  fg3a: s?.threePointFieldGoals?.attempted ?? null,
  fg3m: s?.threePointFieldGoals?.made ?? null,
});

/** Every game of a season once, home first. The possession gate lives here. */
function loadGames(season) {
  const file = path.join(CBBD(season), "box-teams-full.json.gz");
  if (!fs.existsSync(file)) return null;
  const by = new Map();
  for (const r of gz(file)) {
    if (!by.has(r.gameId)) by.set(r.gameId, []);
    by.get(r.gameId).push(r);
  }
  const out = [];
  let dropped = 0;
  for (const [id, pair] of by) {
    if (pair.length !== 2) continue;
    let [a, b] = pair;
    if (a.neutralSite) { if (a.teamId > b.teamId) [a, b] = [b, a]; }
    else if (!a.isHome) [a, b] = [b, a];
    const ap = a.teamStats?.possessions, bp = b.teamStats?.possessions;
    const apt = a.teamStats?.points?.total, bpt = b.teamStats?.points?.total;
    if (!(ap > 0) || !(bp > 0) || apt == null || bpt == null) continue;
    // 17 games across 2023-26 carry impossible possession counts (Duke–Purdue
    // 2022-11-27 at 2). One is enough to detonate the fixed point.
    if (ap < 45 || bp < 45 || ap > 110 || bp > 110 || Math.abs(ap - bp) > 4 || !(a.pace > 0)) { dropped++; continue; }
    out.push({
      id, d: day(a.startDate), neutral: !!a.neutralSite, conf: !!a.conferenceGame,
      h: a.teamId, hName: a.team, hConf: a.conference,
      a: b.teamId, aName: b.team, aConf: b.conference ?? a.opponentConference,
      hPts: apt, aPts: bpt, hPoss: ap, aPoss: bp, pace: a.pace,
      hFF: ff(a.teamStats), aFF: ff(b.teamStats),
    });
  }
  out.sort((x, y) => x.d - y.d || x.id - y.id);
  return { games: out, dropped };
}

function teamsOf(games) {
  const m = new Map();
  for (const g of games) {
    for (const [id, name, conf] of [[g.h, g.hName, g.hConf], [g.a, g.aName, g.aConf]]) {
      let t = m.get(id);
      if (!t) { t = { id, name, conf: conf ?? null, gp: 0, w: 0, l: 0 }; m.set(id, t); }
      t.gp++;
      if (conf && !t.conf) t.conf = conf;
      const won = id === g.h ? g.hPts > g.aPts : g.aPts > g.hPts;
      if (won) t.w++; else t.l++;
    }
  }
  return m;
}

const RATED_MIN_GP = 12;

// ── Efficiency and tempo ───────────────────────────────────────────────────

const HCA = 2.0, K = 3, CAP = 25, ITERS = 24;

function rate(games, ratedSet, prior) {
  const use = games.filter((g) => ratedSet.has(g.h) && ratedSet.has(g.a));
  let pts = 0, poss = 0, paceSum = 0;
  for (const g of use) { pts += g.hPts + g.aPts; poss += g.hPoss + g.aPoss; paceSum += g.pace; }
  const M = (100 * pts) / poss, T = paceSum / use.length;
  const clamp = (v) => Math.max(M - CAP, Math.min(M + CAP, v));

  const obs = new Map();
  const push = (id, o) => { let a = obs.get(id); if (!a) { a = []; obs.set(id, a); } a.push(o); };
  for (const g of use) {
    const hO = clamp((100 * g.hPts) / g.hPoss), aO = clamp((100 * g.aPts) / g.aPoss);
    const loc = g.neutral ? 0 : 1;
    push(g.h, { opp: g.a, o: hO, d: aO, t: g.pace, loc });
    push(g.a, { opp: g.h, o: aO, d: hO, t: g.pace, loc: -loc });
  }
  const ids = [...obs.keys()];
  const O = new Map(), D = new Map(), TT = new Map();
  for (const id of ids) { const p = prior?.get(id); O.set(id, p?.o ?? M); D.set(id, p?.d ?? M); TT.set(id, p?.t ?? T); }
  for (let it = 0; it < ITERS; it++) {
    const nO = new Map(), nD = new Map(), nT = new Map();
    for (const id of ids) {
      const p = prior?.get(id);
      let on = 0, dn = 0, tn = 0, den = 0;
      for (const g of obs.get(id)) {
        on += g.o - (D.get(g.opp) ?? M) + M - g.loc * HCA;
        dn += g.d - (O.get(g.opp) ?? M) + M + g.loc * HCA;
        tn += g.t - (TT.get(g.opp) ?? T) + T;
        den++;
      }
      nO.set(id, (on + K * (p?.o ?? M)) / (den + K));
      nD.set(id, (dn + K * (p?.d ?? M)) / (den + K));
      nT.set(id, (tn + K * (p?.t ?? T)) / (den + K));
    }
    for (const id of ids) { O.set(id, nO.get(id)); D.set(id, nD.get(id)); TT.set(id, nT.get(id)); }
  }
  return { M, T, O, D, TT };
}

// ── Style ──────────────────────────────────────────────────────────────────

const DIMS = [
  ["efg", (f) => f.efg],
  ["orb", (f) => f.orb],
  ["tov", (f) => f.tov],
  ["ftr", (f) => f.ftr],
  ["t3r", (f) => (f.fga > 0 ? (100 * f.fg3a) / f.fga : null)],
  ["t3p", (f) => (f.fg3a > 0 ? (100 * f.fg3m) / f.fg3a : null)],
];

function styleRate(games, ratedSet) {
  const use = games.filter((g) => ratedSet.has(g.h) && ratedSet.has(g.a));
  const league = {}, off = new Map(), def = new Map();
  for (const [key, get] of DIMS) {
    const obs = new Map();
    let sum = 0, n = 0;
    for (const g of use) {
      const hv = get(g.hFF), av = get(g.aFF);
      if (hv == null || av == null) continue;
      sum += hv + av; n += 2;
      if (!obs.has(g.h)) obs.set(g.h, []);
      if (!obs.has(g.a)) obs.set(g.a, []);
      obs.get(g.h).push({ opp: g.a, o: hv, d: av });
      obs.get(g.a).push({ opp: g.h, o: av, d: hv });
    }
    const L = sum / n;
    league[key] = L;
    const O = new Map(), D = new Map();
    for (const id of obs.keys()) { O.set(id, L); D.set(id, L); }
    for (let it = 0; it < 12; it++) {
      const nO = new Map(), nD = new Map();
      for (const [id, list] of obs) {
        let on = 0, dn = 0;
        for (const x of list) { on += x.o - (D.get(x.opp) ?? L) + L; dn += x.d - (O.get(x.opp) ?? L) + L; }
        nO.set(id, (on + 4 * L) / (list.length + 4));
        nD.set(id, (dn + 4 * L) / (list.length + 4));
      }
      for (const id of obs.keys()) { O.set(id, nO.get(id)); D.set(id, nD.get(id)); }
    }
    for (const id of obs.keys()) {
      if (!off.has(id)) { off.set(id, {}); def.set(id, {}); }
      off.get(id)[key] = O.get(id); def.get(id)[key] = D.get(id);
    }
  }
  return { league, off, def };
}

// ── Rosters, continuity ────────────────────────────────────────────────────

/**
 * Per team: the players who had been playing, with how much and how well.
 *
 * athleteSourceId, NOT athleteId — the latter is a per-row surrogate key in
 * this archive (Cooper Flagg carries 37 of them across 37 games). See
 * docs/matchup-predictor.md part 3 §14.
 */
function rosters(season) {
  const file = path.join(CBBD(season), "box-players-full.json.gz");
  if (!fs.existsSync(file)) return new Map();
  const rows = gz(file).map((r) => ({ d: day(r.startDate), teamId: r.teamId, ps: r.players ?? [] }));
  rows.sort((a, b) => a.d - b.d);
  const hist = new Map();      // teamId -> sourceId -> {name, mins[], gsMin[], apps}
  for (const g of rows) {
    let H = hist.get(g.teamId);
    if (!H) { H = new Map(); hist.set(g.teamId, H); }
    for (const p of g.ps) {
      const id = p.athleteSourceId ?? `n:${p.name}`;
      let h = H.get(id);
      if (!h) { h = { id, name: p.name, mins: [], gsMin: [], apps: 0, totalMin: 0 }; H.set(id, h); }
      const min = p.minutes ?? 0;
      h.mins.push(min); h.apps += min > 0 ? 1 : 0; h.totalMin += min;
      if (min >= 5 && p.gameScore != null) h.gsMin.push(p.gameScore / min);
    }
  }
  const out = new Map();
  for (const [tid, H] of hist) {
    const list = [];
    for (const h of H.values()) {
      if (h.apps < 3) continue;
      const recent = h.mins.slice(-10);
      const mpg = recent.reduce((s, x) => s + x, 0) / recent.length;
      if (mpg < 8) continue;
      const gs40 = h.gsMin.length ? (h.gsMin.reduce((s, x) => s + x, 0) / h.gsMin.length) * 40 : 0;
      list.push({ id: h.id, name: h.name, mpg, gs40, val: (mpg / 40) * gs40, gp: h.apps, totalMin: h.totalMin });
    }
    list.sort((a, b) => b.mpg - a.mpg);
    out.set(tid, { list, minutes: hist.get(tid) });
  }
  return { rot: out, hist };
}

function continuity(prevHist, curHist) {
  const out = new Map();
  for (const [tid, H] of prevHist) {
    const back = curHist.get(tid);
    if (!back) continue;
    let tot = 0, ret = 0;
    for (const [pid, h] of H) {
      tot += h.totalMin;
      const c = back.get(pid);
      if (c && c.totalMin > 0) ret += h.totalMin;
    }
    if (tot >= 1000) out.set(tid, ret / tot);
  }
  return out;
}

// ── Conference tiers, from the data ────────────────────────────────────────

function tiers(teams, R) {
  const byConf = new Map();
  for (const t of teams.values()) {
    const o = R.O.get(t.id), d = R.D.get(t.id);
    if (o == null || !t.conf) continue;
    if (!byConf.has(t.conf)) byConf.set(t.conf, []);
    byConf.get(t.conf).push(o - d);
  }
  const ranked = [...byConf].filter(([, v]) => v.length >= 5)
    .map(([c, v]) => ({ conf: c, net: v.reduce((s, x) => s + x, 0) / v.length }))
    .sort((a, b) => b.net - a.net);
  const power = new Set(ranked.slice(0, 6).map((r) => r.conf));
  return { power, ranked };
}

// ── CBBD name → Bart name ──────────────────────────────────────────────────

/** src/lib/quad.ts normTeamKey, verbatim. */
const normKey = (s) => (s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/\bst\.?\b/g, "state").replace(/\bu\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** src/lib/quad.ts TEAM_RATING_ALIASES (Bart → CBBD), inverted. */
const CBBD_TO_BART = {
  "UAlbany": "Albany", "American University": "American", "App State": "Appalachian St.",
  "California Baptist": "Cal Baptist", "UConn": "Connecticut", "Florida International": "FIU",
  "Grambling": "Grambling St.", "Hawai'i": "Hawaii", "IU Indianapolis": "IU Indy",
  "UIC": "Illinois Chicago", "Long Island University": "LIU", "UL Monroe": "Louisiana Monroe",
  "Loyola Maryland": "Loyola MD", "McNeese": "McNeese St.", "Miami": "Miami FL",
  "Ole Miss": "Mississippi", "NC State": "N.C. State", "Omaha": "Nebraska Omaha",
  "Nicholls": "Nicholls St.", "Pennsylvania": "Penn", "Queens University": "Queens",
  "St. Francis (PA)": "Saint Francis", "St. Francis Brooklyn": "St. Francis NY",
  "Sam Houston": "Sam Houston St.", "SE Louisiana": "Southeastern Louisiana",
  "St. Thomas-Minnesota": "St. Thomas", "UT Martin": "Tennessee Martin",
  "Texas A&M-Corpus Christi": "Texas A&M Corpus Chris", "Kansas City": "UMKC",
  "South Carolina Upstate": "USC Upstate",
};

const slugOf = (name) => name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function bartResolver(season) {
  const all = JSON.parse(fs.readFileSync(path.join(ROOT, "public/data/teams-all.json"), "utf8"));
  const names = new Set(all.filter((t) => t.year === season).map((t) => t.name));
  const byKey = new Map();
  for (const n of names) byKey.set(normKey(n), n);
  return (cbbd) => {
    if (names.has(cbbd)) return cbbd;
    const alias = CBBD_TO_BART[cbbd];
    if (alias && names.has(alias)) return alias;
    return byKey.get(normKey(alias ?? cbbd)) ?? null;
  };
}

// ── Build ──────────────────────────────────────────────────────────────────

const cur = loadGames(SEASON);
if (!cur) { console.error(`no archive for ${SEASON}`); process.exit(1); }
const teams = teamsOf(cur.games);
const rated = new Set([...teams.values()].filter((t) => t.gp >= RATED_MIN_GP).map((t) => t.id));

// Last season, as the prior. Carried UNREGRESSED — the backtest tried carry
// factors from 0.3 to 1.0 and 1.0 was best; k already governs how fast it fades.
let prior = null;
const prev = loadGames(PRIOR);
if (prev) {
  const pt = teamsOf(prev.games);
  const pr = new Set([...pt.values()].filter((t) => t.gp >= RATED_MIN_GP).map((t) => t.id));
  const PR = rate(prev.games, pr, null);
  prior = new Map();
  for (const id of PR.O.keys()) prior.set(id, { o: PR.O.get(id), d: PR.D.get(id), t: PR.TT.get(id) });
}

const R = rate(cur.games, rated, prior);
const S = styleRate(cur.games, rated);
const { power, ranked } = tiers(teams, R);
const curR = rosters(SEASON);
const prevR = rosters(PRIOR);
const cont = prevR.hist ? continuity(prevR.hist, curR.hist) : new Map();
const bart = bartResolver(SEASON);

const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;

const list = [...teams.values()].filter((t) => rated.has(t.id) && R.O.has(t.id));
list.sort((a, b) => (R.O.get(b.id) - R.D.get(b.id)) - (R.O.get(a.id) - R.D.get(a.id)));

const unresolved = [];
const out = list.map((t, i) => {
  const so = S.off.get(t.id) ?? {}, sd = S.def.get(t.id) ?? {};
  const b = bart(t.name);
  if (!b) unresolved.push(t.name);
  const rot = curR.rot.get(t.id)?.list ?? [];
  // The team's best player is the one the missTop term keys on: most
  // production per game, which is minutes × quality rather than either alone.
  let best = -1, bestV = -Infinity;
  rot.forEach((p, j) => { const v = p.mpg * p.gs40; if (v > bestV) { bestV = v; best = j; } });
  return {
    n: t.name,
    b: b ?? t.name,
    s: slugOf(b ?? t.name),
    c: t.conf,
    p: power.has(t.conf) ? 1 : 0,
    rk: i + 1,
    w: t.w, l: t.l,
    o: r2(R.O.get(t.id)), d: r2(R.D.get(t.id)), t: r2(R.TT.get(t.id)),
    so: DIMS.map(([k]) => r1(so[k] ?? S.league[k])),
    sd: DIMS.map(([k]) => r1(sd[k] ?? S.league[k])),
    k: r3(cont.get(t.id) ?? 0.436),
    best,
    // [name, minutes per game, value per game, games played]
    r: rot.map((p) => [p.name, r1(p.mpg), r2(p.val), p.gp]),
  };
});

const pack = {
  season: SEASON,
  built_at: BUILT_AT,
  games: cur.games.length,
  dropped: cur.dropped,
  league: { eff: r2(R.M), tempo: r2(R.T), style: DIMS.map(([k]) => r1(S.league[k])) },
  dims: DIMS.map(([k]) => k),
  power: [...power],
  teams: out,
};

fs.mkdirSync(OUT_DIR, { recursive: true });
const file = path.join(OUT_DIR, `${SEASON}.json`);
const json = JSON.stringify(pack);
fs.writeFileSync(file, json);

console.log(`season ${SEASON}: ${cur.games.length} games (${cur.dropped} dropped by the possession gate), ${out.length} teams`);
console.log(`league eff ${r2(R.M)}  tempo ${r2(R.T)}  prior ${prior ? "carried from " + PRIOR : "NONE (no " + PRIOR + " archive)"}`);
console.log(`power conferences: ${ranked.slice(0, 6).map((r) => `${r.conf} (${r.net.toFixed(1)})`).join(", ")}`);
console.log(`rosters: ${out.reduce((s, t) => s + t.r.length, 0)} rotation players; continuity for ${cont.size} teams`);
console.log(`top 5: ${out.slice(0, 5).map((t) => `${t.n} ${(t.o - t.d).toFixed(1)}`).join(" | ")}`);
if (unresolved.length) console.log(`UNRESOLVED to a Bart name (${unresolved.length}): ${unresolved.join(" | ")}`);
console.log(`wrote ${path.relative(ROOT, file)}  ${(json.length / 1024).toFixed(1)} KB raw, ${(zlib.gzipSync(json).length / 1024).toFixed(1)} KB gzipped`);
