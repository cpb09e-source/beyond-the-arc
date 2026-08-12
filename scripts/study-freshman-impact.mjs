#!/usr/bin/env node
/**
 * study-freshman-impact.mjs — what does a recruit's RSCI rank actually buy you
 * in his freshman season? READ-ONLY; writes nothing.
 *
 * Joins the RSCI Final top-100 for classes 2013-2025 (public/data/rsci/, from
 * fetch-rsci-history.mjs) to that class's freshman season in players-by-year,
 * then attaches the impact metric: the real play-by-play EPM where it exists
 * (2024+), the arc-scaled box estimate otherwise.
 *
 * WHY IT EXISTS. This is the empirical base for projecting incoming freshmen,
 * who by definition have no college stat line. Bart's public model projects
 * them from recruit rank alone and says the effect "tapers out pretty quickly";
 * this measures whether that is true on our data and by how much, rather than
 * taking his word for it.
 *
 * WHAT IT FOUND (2013-2025, 1,297 ranked recruits, 88% joined, 717 with an EPM)
 *
 *   tier      n   mean EPM   played%   mpg
 *   1-5      58     2.25       97%     28.7
 *   6-15    105     1.33       87%     25.7
 *   16-25    94     0.67       80%     22.4
 *   26-40   113     0.70       63%     19.0
 *   41-60   138     0.13       58%     17.2
 *   61-100  209    -0.08       49%     15.7
 *
 * Three things worth carrying into the model:
 *
 *  1. The taper is real and steep. Half the total drop happens between the top
 *     5 and the top 15. By 41-60 a ranked recruit is an average freshman, and
 *     61-100 is indistinguishable from unranked. Bart is right about the shape.
 *
 *  2. 16-25 and 26-40 are the same tier (0.67 vs 0.70, and 1.04 vs 1.11 on real
 *     fits). They should be merged; the natural bands are 1-5, 6-15, 16-40,
 *     41-60, 61-100.
 *
 *  3. BIGS ARE MORE FRESHMAN-READY THAN GUARDS, at every tier. Top-5 bigs
 *     average 3.09 EPM against 1.63 for top-5 guards, and the gap persists all
 *     the way down (41-60: +0.52 vs -0.04). EPM is two-way, and rim protection
 *     translates from high school immediately in a way that shot creation and
 *     decision-making do not. Bart's freshman projection is rank-only, so this
 *     is a dimension his public model doesn't carry.
 *
 * AND THE LIMIT: corr(rank, freshman EPM) is -0.39 over the full set and -0.47
 * on real fits alone. Rank explains something like a sixth of the variance. It
 * is a prior, not a prediction, and the model built on it should carry the
 * spread (p25/p75 below) rather than a point estimate. The `played%` column
 * says the same thing from another angle: half of all 61-100 recruits never
 * clear the minutes gate at all, so the honest structure is two-stage —
 * P(plays) x E[EPM | plays].
 *
 * Robustness: the gradient is stronger, not weaker, on the 139 real
 * play-by-play fits (corr -0.465), so the 578 box estimates are not
 * manufacturing it.
 *
 *   Run: node scripts/study-freshman-impact.mjs
 */
import fs from "node:fs";
import path from "node:path";

const DATA = path.resolve("public/data");
const norm = (s) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim()
  .replace(/\s+(jr|sr|ii|iii|iv|v)$/, "");
const il = (s) => { const t = norm(s).split(" "); return t.length >= 2 ? `${t[0][0]} ${t[t.length - 1]}` : null; };
const normTeam = (s) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/\buniversity\b|\bthe\b/g, "").replace(/\bstate\b/g, "st").replace(/[^a-z0-9]+/g, "");

const rows = [];
let rankedTotal = 0, joined = 0, noSeason = 0;
const unjoined = [];

for (let cls = 2013; cls <= 2025; cls++) {
  const season = cls + 1;                       // class of N is a freshman in season N+1
  let rsci, players, box = {}, real = {};
  try { rsci = JSON.parse(fs.readFileSync(path.join(DATA, "rsci", `${cls}.json`), "utf8")); } catch { continue; }
  try { players = JSON.parse(fs.readFileSync(path.join(DATA, "players-by-year", `${season}.json`), "utf8")); } catch { continue; }
  try { box = JSON.parse(fs.readFileSync(path.join(DATA, `box-epm-${season}.json`), "utf8")).players; } catch {}
  try { real = JSON.parse(fs.readFileSync(path.join(DATA, `epm-${season}.json`), "utf8")).players; } catch {}

  // index that season's players by name (and initial+surname) — freshmen only
  const byName = new Map(), byIL = new Map();
  for (const p of players) {
    if (p.class !== "Fr") continue;
    const k = norm(p.name);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(p);
    const k2 = il(p.name);
    if (k2) { if (!byIL.has(k2)) byIL.set(k2, []); byIL.get(k2).push(p); }
  }

  for (const r of rsci.players) {
    rankedTotal++;
    const cands = byName.get(norm(r.name)) ?? [];
    let hit = null;
    if (cands.length === 1) hit = cands[0];
    else if (cands.length > 1 && r.college) {
      hit = cands.find((c) => {
        const t = Array.isArray(c.teams) ? c.teams[0] : c.teams;
        return normTeam(t?.name) === normTeam(r.college);
      }) ?? null;
    }
    if (!hit) {
      // initial+surname, corroborated by college — "Karl Towns" vs
      // "Karl-Anthony Towns" is the common shape
      const alt = byIL.get(il(r.name) ?? "") ?? [];
      if (alt.length === 1) hit = alt[0];
      else if (alt.length > 1 && r.college) {
        hit = alt.find((c) => {
          const t = Array.isArray(c.teams) ? c.teams[0] : c.teams;
          return normTeam(t?.name) === normTeam(r.college);
        }) ?? null;
      }
    }
    if (!hit) { noSeason++; if (unjoined.length < 10) unjoined.push(`${cls} #${r.rank} ${r.name} (${r.college})`); continue; }
    joined++;

    const bid = hit.bart_player_id;
    const rv = bid != null ? real[bid] : null;
    const bv = bid != null ? box[bid] : null;
    const st = hit.player_bart_stats?.raw_row ?? (Array.isArray(hit.player_bart_stats) ? hit.player_bart_stats[0]?.raw_row : null);
    const fromEnd = (o) => { if (!st) return null; const v = Number(st[st.length - 1 - o]); return Number.isFinite(v) ? v : null; };
    rows.push({
      cls, season, rank: r.rank, pos: r.pos, name: r.name,
      team: (Array.isArray(hit.teams) ? hit.teams[0] : hit.teams)?.name ?? null,
      epm: rv?.epm ?? bv?.epm_s ?? null,
      epmSource: rv ? "real" : (bv ? "box" : null),
      ewins: rv?.ewins ?? null,
      mpg: st ? Number(st[54]) : null,
      pts: fromEnd(3),
    });
  }
}

const tierOf = (r) => r <= 5 ? "1-5" : r <= 15 ? "6-15" : r <= 25 ? "16-25" : r <= 40 ? "26-40" : r <= 60 ? "41-60" : "61-100";
const TIERS = ["1-5", "6-15", "16-25", "26-40", "41-60", "61-100"];
const posOf = (p) => { const t = (p ?? "").toUpperCase(); if (/^(PG|SG|CG|G)$/.test(t)) return "G"; if (/^(SF|WF|WG|F)$/.test(t)) return "W"; if (/^(PF|C|PF\/C|F\/C)$/.test(t)) return "B"; return "?"; };

const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const stat = (a) => a.length ? {
  n: a.length,
  mean: +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(2),
  p25: +q(a, 0.25).toFixed(2), med: +q(a, 0.5).toFixed(2), p75: +q(a, 0.75).toFixed(2),
} : { n: 0 };

console.log(`RSCI ranked recruits 2013-2025: ${rankedTotal}`);
console.log(`  joined to a freshman season:  ${joined}  (${(100*joined/rankedTotal).toFixed(1)}%)`);
console.log(`  no D-I freshman season found: ${noSeason}  (prep year, overseas, NBA/G-League, injury, or name miss)`);
console.log(`  sample unjoined: ${unjoined.slice(0,5).join(" | ")}`);

const withEpm = rows.filter((r) => r.epm != null);
console.log(`\nof the joined, carrying an EPM: ${withEpm.length} (${withEpm.filter(r=>r.epmSource==='real').length} real fit, ${withEpm.filter(r=>r.epmSource==='box').length} box estimate)`);

console.log(`\n=== FRESHMAN EPM BY RSCI TIER ===`);
console.log(`tier      n   mean    p25    med    p75   |  played(%)  mpg`);
for (const t of TIERS) {
  const all = rows.filter((r) => tierOf(r.rank) === t);
  const e = all.filter((r) => r.epm != null).map((r) => r.epm);
  const s = stat(e);
  const mpg = all.map(r=>r.mpg).filter(x=>Number.isFinite(x));
  const pct = all.length ? (100 * e.length / all.length).toFixed(0) : "-";
  console.log(`${t.padEnd(8)} ${String(s.n).padStart(3)}  ${String(s.mean ?? '-').padStart(5)}  ${String(s.p25 ?? '-').padStart(5)}  ${String(s.med ?? '-').padStart(5)}  ${String(s.p75 ?? '-').padStart(5)}   |   ${String(pct).padStart(3)}%    ${mpg.length?(mpg.reduce((a,b)=>a+b,0)/mpg.length).toFixed(1):'-'}`);
}

console.log(`\n=== BY TIER x POSITION (mean EPM / n) ===`);
console.log(`tier      guards        wings         bigs`);
for (const t of TIERS) {
  const cells = ["G", "W", "B"].map((p) => {
    const e = rows.filter((r) => tierOf(r.rank) === t && posOf(r.pos) === p && r.epm != null).map((r) => r.epm);
    return e.length ? `${(e.reduce((s,x)=>s+x,0)/e.length).toFixed(2)} (${e.length})` : "-";
  });
  console.log(`${t.padEnd(8)} ${cells[0].padEnd(13)} ${cells[1].padEnd(13)} ${cells[2]}`);
}

// Is rank actually predictive? correlation on the joined-with-EPM set.
const xs = withEpm.map((r) => r.rank), ys = withEpm.map((r) => r.epm);
const mx = xs.reduce((a,b)=>a+b,0)/xs.length, my = ys.reduce((a,b)=>a+b,0)/ys.length;
let sxy=0,sxx=0,syy=0;
for (let i=0;i<xs.length;i++){sxy+=(xs[i]-mx)*(ys[i]-my);sxx+=(xs[i]-mx)**2;syy+=(ys[i]-my)**2;}
console.log(`\ncorr(RSCI rank, freshman EPM) = ${(sxy/Math.sqrt(sxx*syy)).toFixed(3)}   (negative = better rank -> higher EPM)`);
console.log(`slope: ${(sxy/sxx).toFixed(4)} EPM per rank place  →  ${((sxy/sxx)*50).toFixed(2)} EPM from #1 to #51`);
