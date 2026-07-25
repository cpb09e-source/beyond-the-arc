#!/usr/bin/env node
/**
 * export-shooting-json.mjs — join CBBD season shooting profiles onto our Bart
 * player ids and write public/data/shooting-<season>.json for the Players
 * filters (rim/mid/3PT FG%, assisted%, shot diet).
 *
 * Rim  = dunks + layups + tipIns    Mid = twoPointJumpers   3PT = threePointJumpers
 * Zone FG% is nulled below a small-sample floor so a 3-for-3 rim night can't
 * pass a "rim% > 70" filter. Shot-diet rates + assisted% are volume-stable.
 *
 * Join cascade mirrors export-epm-json: normalized name (+ suffix-stripped)
 * corroborated by team.
 *
 *   in:  data/cbbd/<season>/shooting-players.json.gz
 *   out: public/data/shooting-<season>.json
 *   Run: node scripts/export-shooting-json.mjs --from 2014 --to 2026
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const DATA = path.resolve("public/data");
const CBBD = path.resolve("data/cbbd");
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i > -1 ? args[i + 1] : null; };
const FROM = Number(opt("from") || 2014), TO = Number(opt("to") || 2026);
const MIN_ZONE_ATT = 15; // small-sample floor for zone FG%

const norm = (s) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim().replace(/\s+(jr|sr|ii|iii|iv|v)$/, "");
const normTeam = (s) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/\buniversity\b|\bthe\b/g, "").replace(/\bstate\b/g, "st").replace(/[^a-z0-9]+/g, "");
const initLast = (n) => { const p = norm(n).split(" "); return p.length >= 2 ? p[0][0] + " " + p[p.length - 1] : norm(n); };

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pct = (made, att) => (att >= MIN_ZONE_ATT && att > 0 ? Math.round((made / att) * 1000) / 10 : null);

function buildBartIndex(year) {
  const f = path.join(DATA, "players-by-year", `${year}.json`);
  if (!fs.existsSync(f)) return null;
  const players = JSON.parse(fs.readFileSync(f, "utf8"));
  const exact = new Map(), byInitLast = new Map();
  for (const p of players) {
    const team = Array.isArray(p.teams) ? p.teams[0] : p.teams;
    if (p.bart_player_id == null) continue;
    const rec = { bid: p.bart_player_id, team: normTeam(team?.name) };
    exact.set(`${norm(p.name)}|${rec.team}`, rec.bid);
    const k = `${initLast(p.name)}|${rec.team}`;
    (byInitLast.get(k) || byInitLast.set(k, []).get(k)).push(rec.bid);
  }
  return { exact, byInitLast };
}
function matchBart(idx, name, team) {
  const t = normTeam(team);
  const e = idx.exact.get(`${norm(name)}|${t}`);
  if (e != null) return e;
  const cand = idx.byInitLast.get(`${initLast(name)}|${t}`);
  return cand && cand.length === 1 ? cand[0] : null;
}

let grand = 0;
for (let season = FROM; season <= TO; season++) {
  const src = path.join(CBBD, String(season), "shooting-players.json.gz");
  if (!fs.existsSync(src)) { console.warn(`skip ${season}: no shooting archive`); continue; }
  const idx = buildBartIndex(season);
  if (!idx) { console.warn(`skip ${season}: no players-by-year`); continue; }
  const rows = JSON.parse(zlib.gunzipSync(fs.readFileSync(src)).toString());

  const out = {};
  let matched = 0;
  for (const r of rows) {
    const bid = matchBart(idx, r.athleteName, r.team);
    if (bid == null) continue;
    matched++;
    const rimAtt = (r.dunks?.attempted || 0) + (r.layups?.attempted || 0) + (r.tipIns?.attempted || 0);
    const rimMade = (r.dunks?.made || 0) + (r.layups?.made || 0) + (r.tipIns?.made || 0);
    const midAtt = r.twoPointJumpers?.attempted || 0, midMade = r.twoPointJumpers?.made || 0;
    const tpAtt = r.threePointJumpers?.attempted || 0, tpMade = r.threePointJumpers?.made || 0;
    const bd = r.attemptsBreakdown || {};
    out[bid] = {
      rim_pct: pct(rimMade, rimAtt),
      mid_pct: pct(midMade, midAtt),
      tp_pct: pct(tpMade, tpAtt),
      asst: num(r.assistedPct),
      rim_rate: num((bd.dunks || 0) + (bd.layups || 0) + (bd.tipIns || 0)) || null,
      mid_rate: num(bd.twoPointJumpers),
      tp_rate: num(bd.threePointJumpers),
      ftr: num(r.freeThrowRate),
      tracked: num(r.trackedShots),
    };
  }
  // Percentiles for the zone FG%s (higher = better) so the player page can
  // color them on the same ramp as the site's percentile chips. Computed over
  // players who have a value for that zone this season.
  for (const stat of ["rim_pct", "mid_pct", "tp_pct"]) {
    const withVal = Object.values(out).filter((p) => typeof p[stat] === "number");
    const sorted = withVal.map((p) => p[stat]).sort((a, b) => a - b);
    const n = sorted.length;
    const pctileKey = stat.replace("_pct", "_ptile");
    for (const p of Object.values(out)) {
      if (typeof p[stat] !== "number" || n < 2) { p[pctileKey] = null; continue; }
      // rank = count of values strictly below → 0..n-1 → 0..100
      let lo = 0, hi = n;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < p[stat]) lo = mid + 1; else hi = mid; }
      p[pctileKey] = Math.round((lo / (n - 1)) * 100);
    }
  }

  fs.writeFileSync(path.join(DATA, `shooting-${season}.json`), JSON.stringify({ season, players: out }));
  grand += matched;
  console.log(`shooting-${season}.json: ${matched}/${rows.length} matched`);
}
console.log(`total matched: ${grand}`);
