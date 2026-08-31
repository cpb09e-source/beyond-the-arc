#!/usr/bin/env node
/**
 * study-minutes-allocation.mjs — how do minutes get handed out, given what a
 * coach knew going in? READ-ONLY; writes nothing.
 *
 * WHY. A team projection needs a minutes number for every player, and minutes
 * are the one input that is strictly ZERO-SUM: five men are on the floor at all
 * times, so a roster's minutes must add to 200 a game no matter who is on it.
 * That makes minutes a RANKING problem rather than a prediction problem — what
 * matters is not how good a player is in the abstract but how good he is
 * relative to the four or five men competing with him for the same slot.
 *
 * So this measures the allocation curve directly: sort each roster by what was
 * knowable BEFORE the season (last season's EPM, or the recruit-rank prior for
 * a true freshman), then look at what the Nth-best man on a roster actually
 * played. That curve is the projection's minutes model.
 *
 * PRIOR EPM, not this season's, on purpose. Using the current season's EPM to
 * explain the current season's minutes would be circular — EPM is fitted from
 * possessions, so the two are entangled by construction. Everything here is
 * strictly information available the previous spring.
 *
 * ONLY PLAYERS WITH A GENUINE PRIOR ARE RANKED — returners and incoming
 * transfers, both of whom carry last season's EPM (a transfer's from his old
 * school). The first cut of this also slotted true freshmen in at their tier
 * prior, which broke it: 1,002 of 1,102 freshmen in a class are unranked by
 * RSCI and so entered at one identical value, and a sort over a thousand tied
 * keys is arbitrary. The curve came out flat and even rose again at slot 6,
 * which is not a rotation. Freshmen are reported separately below instead.
 *
 * MINUTES ARE A SHARE OF THE TEAM'S OWN TOTAL, not of 200. Bart's mpg is per
 * game PLAYED, so a roster with injuries and partial seasons sums well past
 * 200 — median 231, up to 302. Dividing by a notional 200 would have credited
 * those teams with more rotation than exists.
 *
 *   Run: node scripts/study-minutes-allocation.mjs
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
const norm = (s) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim().replace(/\s+(jr|sr|ii|iii|iv|v)$/, "");

const yc = new Map();
const loadYear = (y) => {
  if (yc.has(y)) return yc.get(y);
  let l = [];
  try { l = JSON.parse(fs.readFileSync(path.join(DATA, "players-by-year", `${y}.json`), "utf8")); } catch {}
  yc.set(y, l); return l;
};
const loadEpm = (y) => {
  let real = {}, box = {};
  try { real = JSON.parse(fs.readFileSync(path.join(DATA, `epm-${y}.json`), "utf8")).players; } catch {}
  try { box = JSON.parse(fs.readFileSync(path.join(DATA, `box-epm-${y}.json`), "utf8")).players; } catch {}
  return (bid) => (bid == null ? null : (real[bid]?.epm ?? box[bid]?.epm_s ?? null));
};


const teamRows = [];   // one entry per (team, season) with its sorted roster
for (let y = 2015; y <= 2026; y++) {
  const cur = loadYear(y), prev = loadYear(y - 1);
  if (!cur.length || !prev.length) continue;
  const priorEpm = loadEpm(y - 1);

  const byTeam = new Map();
  for (const p of cur) {
    const t = teamOf(p); if (!t) continue;
    if (!byTeam.has(t)) byTeam.set(t, []);
    byTeam.get(t).push(p);
  }

  for (const [t, roster] of byTeam) {
    const totalMpg = roster.reduce((s, p) => s + (num(rawOf(p)?.[54]) ?? 0), 0);
    if (totalMpg < 120) continue;
    const known = roster.map((p) => ({
      name: p.name, mpg: num(rawOf(p)?.[54]), prior: priorEpm(p.bart_player_id),
    })).filter((x) => x.prior != null && Number.isFinite(x.mpg));
    if (known.length < 6) continue;                 // need a rankable core
    const frMpg = roster.filter((p) => p.class === "Fr")
      .reduce((s, p) => s + (num(rawOf(p)?.[54]) ?? 0), 0);
    known.sort((a, b) => b.prior - a.prior);
    teamRows.push({ y, team: t, totalMpg, players: known, frShare: frMpg / totalMpg });
  }
}

console.log(`team-seasons with a rankable roster: ${teamRows.length}\n`);

// --- how much of a game does a roster actually add up to? ---
const totals = teamRows.map((t) => t.totalMpg).sort((a, b) => a - b);
console.log(`team total mpg — median ${totals[Math.floor(totals.length/2)].toFixed(0)}, ` +
  `p10 ${totals[Math.floor(totals.length*0.1)].toFixed(0)}, p90 ${totals[Math.floor(totals.length*0.9)].toFixed(0)} (over 200 because mpg is per game PLAYED — hence shares, not /200)\n`);

// --- THE ALLOCATION CURVE ---
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
console.log("=== MINUTES BY PRE-SEASON RANK ON THE ROSTER ===");
console.log("(roster sorted by last seasons EPM — returners and transfers only)\n");
console.log("slot     n     mpg    p25    p75    share of team minutes");
for (let i = 0; i < 12; i++) {
  const rowsAt = teamRows.filter((t) => t.players[i]);
  const m = rowsAt.map((t) => t.players[i].mpg);
  if (!m.length) break;
  const sh = rowsAt.map((t) => t.players[i].mpg / t.totalMpg);
  console.log(`  ${String(i + 1).padStart(2)}   ${String(m.length).padStart(4)}  ${mean(m).toFixed(1).padStart(5)}  ${q(m,0.25).toFixed(1).padStart(5)}  ${q(m,0.75).toFixed(1).padStart(5)}        ${(100*mean(sh)).toFixed(1)}%`);
}

// --- does the prior actually order the minutes? ---
let conc = 0, disc = 0;
for (const t of teamRows) {
  const p = t.players.filter((x) => Number.isFinite(x.mpg)).slice(0, 10);
  for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) {
    if (p[i].mpg === p[j].mpg) continue;
    (p[i].mpg > p[j].mpg ? conc++ : disc++);
  }
}
const tau = (conc - disc) / (conc + disc);
console.log(`\nrank agreement (Kendall tau, pre-season order vs actual minutes): ${tau.toFixed(3)}`);
console.log(`  ${conc.toLocaleString()} pairs in the predicted order, ${disc.toLocaleString()} inverted`);

// --- how much of the rotation goes to true freshmen, and is it moving? ---
// The minutes the curve above does NOT account for are mostly freshman
// minutes, so this is the other side of the same ledger.
console.log(`\n=== SHARE OF TEAM MINUTES GOING TO TRUE FRESHMEN ===`);
for (let y = 2015; y <= 2026; y++) {
  const a = teamRows.filter((t) => t.y === y).map((t) => t.frShare);
  if (!a.length) continue;
  const pct = 100 * mean(a);
  console.log(`  ${y}   ${pct.toFixed(1).padStart(5)}%  ${"#".repeat(Math.round(pct))}`);
}
