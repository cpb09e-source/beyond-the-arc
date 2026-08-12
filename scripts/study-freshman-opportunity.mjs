#!/usr/bin/env node
/**
 * study-freshman-opportunity.mjs — does the ROOM a freshman walks into predict
 * his freshman season, on top of what his recruit rank already says?
 * READ-ONLY; writes nothing.
 *
 * WHY. study-freshman-impact.mjs establishes the rank prior and its limit:
 * corr(RSCI rank, freshman EPM) is about -0.4, so rank explains roughly a sixth
 * of the variance. Something else is carrying the rest. The obvious candidate,
 * and the one the projection actually needs, is opportunity — a top-15 recruit
 * arriving where 70% of last season's minutes just left is not the same bet as
 * the same recruit arriving behind an intact rotation.
 *
 * That is the honest, computable version of "team fit". It is not chemistry or
 * system match; it is how many minutes and how much usage walked out the door,
 * which we can measure exactly from consecutive rosters.
 *
 * HOW OPPORTUNITY IS MEASURED, per (team, season):
 *   vacated_min  share of last season's total minutes played by players who are
 *                not on this season's roster
 *   NET_min      the same, minus the minutes INCOMING transfers played
 *                elsewhere last season — the room actually left for a freshman
 *   vacated_usg  vacated, weighted by usage rate — a departing 30%-usage guard
 *                leaves more behind than a 12%-usage one at equal minutes
 *   vacated_big  vacated minutes restricted to players 6-9 and taller
 *
 * Departures are counted from THIS team's point of view: transferring out,
 * graduating and going pro all vacate the same minutes.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT FOUND, and the wrong turn on the way
 *
 * The naive measure barely works. Raw vacated minutes correlate 0.10 with a
 * ranked freshman's minutes, with within-tier correlations around 0.05 and
 * minutes gaps under 1 mpg between crowded and open rosters. On that evidence
 * alone "team fit" looks like a dead end.
 *
 * It isn't — the measure was wrong, because THE PORTAL EATS THE VACANCY FIRST.
 * Measured across every team-season:
 *
 *   season   vacated min%   incoming transfer min%
 *   2016        44.8%              2.2%
 *   2020        47.3%              5.0%
 *   2022        43.6%             19.6%
 *   2024        55.3%             21.4%
 *   2026        72.4%             31.4%
 *
 * A 2026 team sheds 72% of its minutes and buys back 31% in proven transfers.
 * Vacated minutes stopped meaning freshman minutes somewhere around 2021.
 *
 * Netting the incoming transfers out triples the signal:
 *
 *   tier      n     vacated->mpg   NET->mpg
 *   1-5      55        0.09         -0.08
 *   6-15    111        0.33          0.25
 *   16-40   273        0.07          0.23
 *   41-60   220        0.08          0.26
 *   61-100  393       -0.02          0.32
 *   ALL    1052        0.10          0.30
 *
 * Two things to carry into the model:
 *
 *  1. Use NET opportunity, not vacated minutes. On the modern era alone (2022+)
 *     it is 0.31 against 0.19.
 *
 *  2. THE EFFECT VANISHES FOR TOP-5 RECRUITS (-0.08, and -0.44 on 2022+). They
 *     play whatever the roster looks like — 97% of them clear the minutes gate
 *     at 28.7 mpg. Opportunity is a real term for everyone else and a null term
 *     for the elite, so it belongs in the model interacted with tier rather
 *     than as a flat adjustment.
 *
 *   Run: node scripts/study-freshman-opportunity.mjs
 */
import fs from "node:fs";
import path from "node:path";

const DATA = path.resolve("public/data");
const norm = (s) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim().replace(/\s+(jr|sr|ii|iii|iv|v)$/, "");
const il = (s) => { const t = norm(s).split(" "); return t.length >= 2 ? `${t[0][0]} ${t[t.length - 1]}` : null; };
const normTeam = (s) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/\bstate\b/g, "st").replace(/[^a-z0-9]+/g, "");
const teamOf = (p) => (Array.isArray(p.teams) ? p.teams[0] : p.teams)?.name ?? null;
const rawOf = (p) => {
  const st = Array.isArray(p.player_bart_stats) ? p.player_bart_stats[0] : p.player_bart_stats;
  return st?.raw_row ?? null;
};
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const inches = (h) => { const m = /^(\d+)-(\d+)/.exec(h ?? ""); return m ? +m[1] * 12 + +m[2] : null; };

const yearCache = new Map();
function loadYear(y) {
  if (yearCache.has(y)) return yearCache.get(y);
  let list = [];
  try { list = JSON.parse(fs.readFileSync(path.join(DATA, "players-by-year", `${y}.json`), "utf8")); } catch {}
  yearCache.set(y, list);
  return list;
}

/** Per-team opportunity vacated between season y-1 and season y. */
function opportunity(y) {
  const prev = loadYear(y - 1), cur = loadYear(y);
  if (!prev.length || !cur.length) return new Map();
  const stayed = new Map();               // team -> Set(bart ids on the roster in y)
  for (const p of cur) {
    const t = teamOf(p); if (!t || p.bart_player_id == null) continue;
    if (!stayed.has(t)) stayed.set(t, new Set());
    stayed.get(t).add(p.bart_player_id);
  }
  // Minutes ARRIVING by transfer: a player on this roster now who played
  // somewhere else last season, credited with the minutes he played there.
  // This is the half that turns vacated minutes into real freshman opportunity.
  const prevById = new Map(prev.filter((p) => p.bart_player_id != null).map((p) => [p.bart_player_id, p]));
  const incoming = new Map();
  for (const p of cur) {
    const t = teamOf(p); if (!t || p.bart_player_id == null) continue;
    const was = prevById.get(p.bart_player_id);
    if (!was || teamOf(was) === t) continue;
    incoming.set(t, (incoming.get(t) ?? 0) + (num(rawOf(was)?.[54]) ?? 0));
  }
  const agg = new Map();                  // team -> totals
  for (const p of prev) {
    const t = teamOf(p); if (!t) continue;
    const r = rawOf(p);
    const mpg = num(r?.[54]); if (mpg == null) continue;
    const usg = num(r?.[6]) ?? 0;
    const tall = (inches(p.height) ?? 0) >= 81;   // 6-9 and up
    const a = agg.get(t) ?? { min: 0, minGone: 0, usg: 0, usgGone: 0, big: 0, bigGone: 0 };
    const gone = p.bart_player_id == null || !(stayed.get(t)?.has(p.bart_player_id));
    a.min += mpg; a.usg += mpg * usg; if (tall) a.big += mpg;
    if (gone) { a.minGone += mpg; a.usgGone += mpg * usg; if (tall) a.bigGone += mpg; }
    agg.set(t, a);
  }
  const out = new Map();
  for (const [t, a] of agg) {
    if (a.min < 100) continue;            // too little prior-season data to speak
    out.set(t, {
      vacMin: a.minGone / a.min,
      netMin: (a.minGone - (incoming.get(t) ?? 0)) / a.min,
      vacUsg: a.usg > 0 ? a.usgGone / a.usg : null,
      vacBig: a.big > 0 ? a.bigGone / a.big : null,
    });
  }
  return out;
}

// ---- join RSCI ranks to freshman seasons, and attach the team's opportunity ----
const rows = [];
for (let cls = 2013; cls <= 2025; cls++) {
  const season = cls + 1;
  let rsci;
  try { rsci = JSON.parse(fs.readFileSync(path.join(DATA, "rsci", `${cls}.json`), "utf8")); } catch { continue; }
  const cur = loadYear(season);
  if (!cur.length) continue;
  let box = {}, real = {};
  try { box = JSON.parse(fs.readFileSync(path.join(DATA, `box-epm-${season}.json`), "utf8")).players; } catch {}
  try { real = JSON.parse(fs.readFileSync(path.join(DATA, `epm-${season}.json`), "utf8")).players; } catch {}
  const opp = opportunity(season);

  const byName = new Map(), byIL = new Map();
  for (const p of cur) {
    if (p.class !== "Fr") continue;
    const k = norm(p.name);
    if (!byName.has(k)) byName.set(k, []); byName.get(k).push(p);
    const k2 = il(p.name);
    if (k2) { if (!byIL.has(k2)) byIL.set(k2, []); byIL.get(k2).push(p); }
  }
  const pick = (cands, college) => {
    if (cands.length === 1) return cands[0];
    if (cands.length > 1 && college) return cands.find((c) => normTeam(teamOf(c)) === normTeam(college)) ?? null;
    return null;
  };

  for (const r of rsci.players) {
    const hit = pick(byName.get(norm(r.name)) ?? [], r.college) ?? pick(byIL.get(il(r.name) ?? "") ?? [], r.college);
    if (!hit) continue;
    const t = teamOf(hit);
    const o = t ? opp.get(t) : null;
    if (!o) continue;                       // no prior-season baseline for that team
    const raw = rawOf(hit);
    const bid = hit.bart_player_id;
    const epm = (bid != null && real[bid]?.epm) ?? (bid != null && box[bid]?.epm_s) ?? null;
    rows.push({
      cls, season, rank: r.rank, pos: r.pos, name: r.name, team: t,
      mpg: num(raw?.[54]), usg: num(raw?.[6]), epm,
      vacMin: o.vacMin, netMin: o.netMin, vacUsg: o.vacUsg, vacBig: o.vacBig,
      tall: (inches(hit.height) ?? 0) >= 81,
    });
  }
}

const tierOf = (r) => r <= 5 ? "1-5" : r <= 15 ? "6-15" : r <= 40 ? "16-40" : r <= 60 ? "41-60" : "61-100";
const TIERS = ["1-5", "6-15", "16-40", "41-60", "61-100"];
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
function corr(pairs) {
  const n = pairs.length; if (n < 12) return null;
  const mx = mean(pairs.map((p) => p[0])), my = mean(pairs.map((p) => p[1]));
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pairs) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}
const f = (x, d = 2) => x == null ? "  -  " : x.toFixed(d).padStart(5);

console.log(`ranked freshmen with a team opportunity baseline: ${rows.length}\n`);

console.log("=== DOES VACATED OPPORTUNITY PREDICT THE FRESHMAN'S ROLE? ===");
console.log("(correlation within rank tier, so rank is held roughly constant)\n");
console.log("tier      n   vacated->mpg   NET->mpg   NET->mpg (2022+)");
for (const t of TIERS) {
  const a = rows.filter((r) => tierOf(r.rank) === t && r.mpg != null);
  const mod = a.filter((r) => r.season >= 2022);
  console.log(`${t.padEnd(8)} ${String(a.length).padStart(3)}      ${f(corr(a.map((r) => [r.vacMin, r.mpg])))}      ${f(corr(a.map((r) => [r.netMin, r.mpg])))}       ${f(corr(mod.map((r) => [r.netMin, r.mpg])))}`);
}
{
  const a = rows.filter((r) => r.mpg != null);
  console.log(`${"ALL".padEnd(8)} ${String(a.length).padStart(3)}      ${f(corr(a.map((r) => [r.vacMin, r.mpg])))}      ${f(corr(a.map((r) => [r.netMin, r.mpg])))}       ${f(corr(a.filter((r) => r.season >= 2022).map((r) => [r.netMin, r.mpg])))}`);
}

console.log("\n=== MINUTES BY TIER x HOW MUCH ROOM THERE WAS ===");
console.log("(vacated-minutes share of the team's prior season, split at the median)\n");
const med = [...rows.map((r) => r.vacMin)].sort((a, b) => a - b)[Math.floor(rows.length / 2)];
console.log(`median vacated-minutes share: ${(med * 100).toFixed(1)}%\n`);
console.log("tier      crowded roster        open roster        gap");
for (const t of TIERS) {
  const a = rows.filter((r) => tierOf(r.rank) === t && r.mpg != null);
  const lo = a.filter((r) => r.vacMin <= med).map((r) => r.mpg);
  const hi = a.filter((r) => r.vacMin > med).map((r) => r.mpg);
  const ml = mean(lo), mh = mean(hi);
  console.log(`${t.padEnd(8)} ${f(ml, 1)} mpg (n=${String(lo.length).padStart(3)})   ${f(mh, 1)} mpg (n=${String(hi.length).padStart(3)})   ${ml && mh ? (mh - ml >= 0 ? "+" : "") + (mh - ml).toFixed(1) : "-"}`);
}

console.log("\n=== SAME, FOR EPM ===");
console.log("tier      crowded roster        open roster        gap");
for (const t of TIERS) {
  const a = rows.filter((r) => tierOf(r.rank) === t && r.epm != null);
  const lo = a.filter((r) => r.vacMin <= med).map((r) => r.epm);
  const hi = a.filter((r) => r.vacMin > med).map((r) => r.epm);
  const ml = mean(lo), mh = mean(hi);
  console.log(`${t.padEnd(8)} ${f(ml)} EPM (n=${String(lo.length).padStart(3)})   ${f(mh)} EPM (n=${String(hi.length).padStart(3)})   ${ml != null && mh != null ? (mh - ml >= 0 ? "+" : "") + (mh - ml).toFixed(2) : "-"}`);
}

console.log("\n=== BIGS AGAINST VACATED BIG MINUTES SPECIFICALLY ===");
const bigs = rows.filter((r) => r.tall && r.vacBig != null);
console.log(`freshman bigs (6-9+): ${bigs.length}`);
console.log(`  corr(vacated BIG minutes, his mpg) = ${f(corr(bigs.filter((r) => r.mpg != null).map((r) => [r.vacBig, r.mpg])))}`);
console.log(`  corr(vacated ALL minutes, his mpg) = ${f(corr(bigs.filter((r) => r.mpg != null).map((r) => [r.vacMin, r.mpg])))}`);
