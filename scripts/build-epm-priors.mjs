#!/usr/bin/env node
/**
 * build-epm-priors.mjs — SPM (box) prior for the RAPM fit, D&3-style.
 *
 * compute-epm.py fits RAPM as deviations from a Bayesian prior; that prior is a
 * statistical plus-minus (box) estimate. Our Box-EPM (box-epm-<year>.json, a
 * ridge box model calibrated to RAPM) IS that SPM, so we just map it from Bart
 * ids into the CBBD player-id space the stint matrix uses.
 *
 * Join: CBBD player (players.csv name+team) → Bart id (players-by-year name+team)
 * → Box-EPM off/def.  DEF is kept "positive = good defense" (compute-epm negates).
 *
 *   out: data/cbbd/<season>/priors.csv   (playerId, priorOff, priorDef)
 *   Run: node scripts/build-epm-priors.mjs --season 2026
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const args = process.argv.slice(2);
const SEASON = Number(args[args.indexOf("--season") + 1]);
if (!SEASON) { console.error("usage: --season 2026"); process.exit(1); }
const DATA = path.resolve("public/data");
const CBBD = path.resolve("data/cbbd", String(SEASON));

const norm = (s) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim().replace(/\s+(jr|sr|ii|iii|iv|v)$/, "");
const normTeam = (s) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/\buniversity\b|\bthe\b/g, "").replace(/\bstate\b/g, "st").replace(/[^a-z0-9]+/g, "");
const il = (n) => { const t = norm(n).split(" "); return t.length >= 2 ? `${t[0][0]} ${t[t.length - 1]}` : norm(n); };

// Bart index: name/team → bart_player_id.
const bart = JSON.parse(fs.readFileSync(path.join(DATA, "players-by-year", `${SEASON}.json`), "utf8"));
const byNT = new Map(), byName = new Map(), byIL = new Map();
for (const p of bart) {
  if (p.bart_player_id == null) continue;
  const t = Array.isArray(p.teams) ? p.teams[0] : p.teams;
  const nn = norm(p.name), nt = normTeam(t?.name);
  byNT.set(`${nn}|${nt}`, p.bart_player_id);
  if (!byName.has(nn)) byName.set(nn, []);
  byName.get(nn).push(p.bart_player_id);
  const k = `${il(p.name)}|${nt}`;
  if (!byIL.has(k)) byIL.set(k, p.bart_player_id);
}
function toBart(name, team) {
  const nn = norm(name), nt = normTeam(team);
  let bid = byNT.get(`${nn}|${nt}`);
  if (bid == null) { const c = byName.get(nn); if (c && c.length === 1) bid = c[0]; }
  if (bid == null) bid = byIL.get(`${il(name)}|${nt}`);
  return bid ?? null;
}

const box = JSON.parse(fs.readFileSync(path.join(DATA, `box-epm-${SEASON}.json`), "utf8")).players;

// CBBD players from the stint universe.
const players = zlib.gunzipSync(fs.readFileSync(path.join(CBBD, "players.csv.gz"))).toString()
  .split(/\r?\n/).map((l) => l.replace(/\r$/, "")).filter(Boolean);
const head = players[0].split(",");
const iId = head.indexOf("id"), iN = head.indexOf("name"), iT = head.indexOf("team");
function csvCell(line, i) { // players.csv quotes names
  const parts = line.match(/("([^"]|"")*"|[^,]*)/g).filter((_, k) => k % 2 === 0);
  const v = parts[i] ?? "";
  return v.startsWith('"') ? v.slice(1, -1).replace(/""/g, '"') : v;
}

// Usage rate by Bart id (raw_row[6]) — carried through so the fit can tell how
// much of a player's OFFENSIVE signal is his own. A player who ends few
// possessions is identified mostly by lineup covariation with his teammates, so
// compute-epm.py leans harder on the prior for him. See --low-usg-damp there.
const usgByBart = new Map();
for (const p of bart) {
  if (p.bart_player_id == null) continue;
  const st = Array.isArray(p.player_bart_stats) ? p.player_bart_stats[0] : p.player_bart_stats;
  const u = st?.raw_row?.[6];
  const n = typeof u === "number" ? u : typeof u === "string" ? Number(u) : NaN;
  if (Number.isFinite(n)) usgByBart.set(p.bart_player_id, n);
}

const out = ["playerId,priorOff,priorDef,usg"];
let hit = 0;
for (const line of players.slice(1)) {
  const id = csvCell(line, iId), name = csvCell(line, iN), team = csvCell(line, iT);
  const bid = toBart(name, team);
  const b = bid != null ? box[String(bid)] : null;
  if (!b) continue;
  const u = usgByBart.get(bid);
  out.push(`${id},${b.off},${b.def},${u ?? ""}`);
  hit++;
}
const dst = path.join(CBBD, "priors.csv");
fs.writeFileSync(dst, out.join("\n"));
console.log(`season ${SEASON}: ${hit}/${players.length - 1} CBBD players matched to a box prior → ${path.basename(dst)}`);
