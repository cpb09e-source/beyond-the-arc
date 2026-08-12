#!/usr/bin/env node
/**
 * study-returning-players.mjs — how does a returning player's EPM move from one
 * season to the next, and does it depend on class? READ-ONLY; writes nothing.
 *
 * WHY. Returners are most of a roster and all of them already have a number, so
 * this is the easiest part of the projection to get roughly right and the most
 * costly to get subtly wrong. The question is what to do with last season's EPM:
 * carry it forward, regress it toward average, or bump it by class.
 *
 * THE HYPOTHESIS UNDER TEST is Bart's, stated in his own methodology post:
 *
 *     "sophomores get a 50% bump, juniors get a 30% bump, and seniors and grad
 *      transfers get a 10% bump. [For 2017 I've altered the bumps somewhat,
 *      more like 40%, 15%, 10%] This reflects the well-known pattern that
 *      college players generally take their biggest leap as sophomores, with
 *      lesser improvements thereafter."
 *
 * He applies those to "Opts" (offensive rating x usage, discounted by minutes),
 * not to EPM, so this is not a like-for-like test of his model. It is a test of
 * the underlying claim — that improvement is large going into year two and
 * tapers — against a two-way metric.
 *
 * WHAT REGRESSION TO THE MEAN DOES TO THIS QUESTION, and why the naive version
 * misleads: any noisy measure repeated over two seasons will show the high
 * values falling and the low values rising, whether or not anyone improved. So
 * a raw year-over-year delta by class confounds real development with mean
 * reversion. Both are reported below — the raw delta, and the delta after
 * conditioning on where the player started — because only the second says
 * anything about development.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT FOUND (17,455 returning player-seasons, 2015-2026)
 *
 * The raw table reproduces Bart's story exactly: Fr->So +0.48 EPM, So->Jr
 * +0.29, Jr->Sr +0.25. Biggest leap into year two, tapering after. If you stop
 * there you would happily adopt his 40/15/10 bumps.
 *
 * Conditioning on where the player started takes most of it away:
 *
 *   start band      Fr->So    So->Jr    Jr->Sr
 *   below -1        +0.79     +0.85     +0.82
 *   -1 to +0.5      +0.32     +0.26     +0.26
 *   +0.5 to +2      +0.15     -0.08     -0.07
 *   above +2        +0.29     -0.46     -0.49
 *
 * Below average, every class gains about +0.8 — no class effect at all, that
 * is pure mean reversion and would happen to a rock. The sophomore bump is
 * real but survives only in the upper bands, where Fr->So still gains while
 * So->Jr and Jr->Sr DECLINE. A flat multiplicative bump would inflate exactly
 * the players who are about to get worse: good juniors and seniors.
 *
 * PERSISTENCE, which is the parameter the projection actually needs:
 *
 *   all returners   next = 0.669 x last + 0.24   r=0.606
 *   stayed put      next = 0.715 x last + 0.23   r=0.638
 *   TRANSFERRED     next = 0.503 x last + 0.27   r=0.482
 *
 * A transfer keeps far less of his number than a returner — 0.50 against 0.72.
 * Bart discounts transfer "Opts" too and calls it "guessy-bessy"; this is the
 * measured version of that discount, and it is large.
 *
 * And a claim this script made in its first cut that its own output disproves:
 * minutes are NOT more predictable than impact. Last season's mpg predicts next
 * season's at r=0.47, against 0.61 for EPM. Minutes are a coaching decision
 * rather than a property of a player, so the allocation curve is the better
 * route to them than a carry-forward.
 *
 *   Run: node scripts/study-returning-players.mjs
 */
import fs from "node:fs";
import path from "node:path";

const DATA = path.resolve("public/data");
const teamOf = (p) => (Array.isArray(p.teams) ? p.teams[0] : p.teams)?.name ?? null;
const rawOf = (p) => {
  const st = Array.isArray(p.player_bart_stats) ? p.player_bart_stats[0] : p.player_bart_stats;
  return st?.raw_row ?? null;
};
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

const yc = new Map();
const loadYear = (y) => {
  if (yc.has(y)) return yc.get(y);
  let l = [];
  try { l = JSON.parse(fs.readFileSync(path.join(DATA, "players-by-year", `${y}.json`), "utf8")); } catch {}
  yc.set(y, l); return l;
};
const epmCache = new Map();
function epmFor(y) {
  if (epmCache.has(y)) return epmCache.get(y);
  let real = {}, box = {};
  try { real = JSON.parse(fs.readFileSync(path.join(DATA, `epm-${y}.json`), "utf8")).players; } catch {}
  try { box = JSON.parse(fs.readFileSync(path.join(DATA, `box-epm-${y}.json`), "utf8")).players; } catch {}
  const f = (bid) => {
    if (bid == null) return null;
    if (typeof real[bid]?.epm === "number") return { epm: real[bid].epm, src: "real" };
    if (typeof box[bid]?.epm_s === "number") return { epm: box[bid].epm_s, src: "box" };
    return null;
  };
  epmCache.set(y, f); return f;
}

// Pairs: same player, consecutive seasons, with an EPM in both.
const pairs = [];
for (let y = 2015; y <= 2026; y++) {
  const prev = loadYear(y - 1), cur = loadYear(y);
  if (!prev.length || !cur.length) continue;
  const e0 = epmFor(y - 1), e1 = epmFor(y);
  const prevById = new Map(prev.filter((p) => p.bart_player_id != null).map((p) => [p.bart_player_id, p]));
  for (const p of cur) {
    const bid = p.bart_player_id; if (bid == null) continue;
    const was = prevById.get(bid); if (!was) continue;
    const a = e0(bid), b = e1(bid);
    if (!a || !b) continue;
    pairs.push({
      y, name: p.name,
      fromClass: was.class, toClass: p.class,
      moved: teamOf(was) !== teamOf(p),
      e0: a.epm, e1: b.epm, src: a.src === "real" && b.src === "real" ? "real" : "box",
      mpg0: num(rawOf(was)?.[54]), mpg1: num(rawOf(p)?.[54]),
    });
  }
}

const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const f = (x, d = 2) => x == null ? "  -  " : (x >= 0 ? "+" : "") + x.toFixed(d);

console.log(`returning player-seasons with an EPM in both years: ${pairs.length}`);
console.log(`  of which both from the real play-by-play fit: ${pairs.filter((p) => p.src === "real").length}`);
console.log(`  changed school between the two: ${pairs.filter((p) => p.moved).length}\n`);

console.log("=== RAW YEAR-OVER-YEAR EPM CHANGE BY CLASS TRANSITION ===");
console.log("(this number is CONFOUNDED by mean reversion — see the next table)\n");
console.log("transition      n     EPM before   EPM after    change");
const TRANS = [["Fr", "So"], ["So", "Jr"], ["Jr", "Sr"], ["Sr", "Gr"]];
for (const [from, to] of TRANS) {
  const a = pairs.filter((p) => p.fromClass === from && p.toClass === to);
  if (a.length < 20) continue;
  console.log(`${(from + " -> " + to).padEnd(14)} ${String(a.length).padStart(4)}      ${f(mean(a.map((p) => p.e0)))}        ${f(mean(a.map((p) => p.e1)))}       ${f(mean(a.map((p) => p.e1 - p.e0)))}`);
}

console.log("\n=== THE SAME, SPLIT BY WHERE THE PLAYER STARTED ===");
console.log("(mean reversion pushes every starting band toward the middle;");
console.log(" real development would show up as a class effect WITHIN a band)\n");
const BANDS = [[-99, -1, "below -1"], [-1, 0.5, "-1 to +0.5"], [0.5, 2, "+0.5 to +2"], [2, 99, "above +2"]];
process.stdout.write("start band     ");
for (const [from, to] of TRANS) process.stdout.write((from + "->" + to).padStart(12));
console.log();
for (const [lo, hi, label] of BANDS) {
  process.stdout.write(label.padEnd(15));
  for (const [from, to] of TRANS) {
    const a = pairs.filter((p) => p.fromClass === from && p.toClass === to && p.e0 >= lo && p.e0 < hi);
    process.stdout.write((a.length < 15 ? "  -  " : `${f(mean(a.map((p) => p.e1 - p.e0)))} (${a.length})`).padStart(12));
  }
  console.log();
}

console.log("\n=== HOW MUCH OF LAST SEASON SURVIVES? ===");
console.log("(regressing this season's EPM on last season's, over all returners)\n");
function fit(rows) {
  const n = rows.length; if (n < 30) return null;
  const mx = mean(rows.map((r) => r.e0)), my = mean(rows.map((r) => r.e1));
  let sxy = 0, sxx = 0, syy = 0;
  for (const r of rows) { sxy += (r.e0 - mx) * (r.e1 - my); sxx += (r.e0 - mx) ** 2; syy += (r.e1 - my) ** 2; }
  return { n, slope: sxy / sxx, intercept: my - (sxy / sxx) * mx, r: sxy / Math.sqrt(sxx * syy) };
}
const all = fit(pairs);
console.log(`all returners      n=${all.n}   next = ${all.slope.toFixed(3)} x last ${f(all.intercept)}   r=${all.r.toFixed(3)}`);
const real = fit(pairs.filter((p) => p.src === "real"));
if (real) console.log(`real fits only     n=${real.n}    next = ${real.slope.toFixed(3)} x last ${f(real.intercept)}   r=${real.r.toFixed(3)}`);
const stayed = fit(pairs.filter((p) => !p.moved));
const moved = fit(pairs.filter((p) => p.moved));
if (stayed) console.log(`stayed put         n=${stayed.n}   next = ${stayed.slope.toFixed(3)} x last ${f(stayed.intercept)}   r=${stayed.r.toFixed(3)}`);
if (moved) console.log(`transferred        n=${moved.n}    next = ${moved.slope.toFixed(3)} x last ${f(moved.intercept)}   r=${moved.r.toFixed(3)}`);
console.log(`\nA slope below 1 is the shrinkage the projection should apply to last`);
console.log(`season's EPM before using it. The intercept is where a player with no`);
console.log(`prior signal lands.`);

console.log("\n=== MINUTES CARRY-OVER ===");
const withM = pairs.filter((p) => Number.isFinite(p.mpg0) && Number.isFinite(p.mpg1));
const mFit = (() => {
  const mx = mean(withM.map((r) => r.mpg0)), my = mean(withM.map((r) => r.mpg1));
  let sxy = 0, sxx = 0, syy = 0;
  for (const r of withM) { sxy += (r.mpg0 - mx) * (r.mpg1 - my); sxx += (r.mpg0 - mx) ** 2; syy += (r.mpg1 - my) ** 2; }
  return { slope: sxy / sxx, intercept: my - (sxy / sxx) * mx, r: sxy / Math.sqrt(sxx * syy) };
})();
console.log(`n=${withM.length}  next mpg = ${mFit.slope.toFixed(3)} x last ${f(mFit.intercept, 1)}   r=${mFit.r.toFixed(3)}`);
console.log(`(NOT more predictable than impact — r=0.47 against EPM's 0.61. Minutes`);
console.log(` are a coach's decision rather than a property of the player, so last`);
console.log(` season's are a weaker guide than they look. The allocation curve in`);
console.log(` study-minutes-allocation.mjs is the better route to next-year minutes.)`);
