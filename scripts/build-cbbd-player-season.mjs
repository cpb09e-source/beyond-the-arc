#!/usr/bin/env node
/**
 * build-cbbd-player-season.mjs — roll CBBD's per-GAME player box rows up into
 * one season row per player, keyed to OUR Bart ids, carrying the things Bart's
 * season table cannot express.
 *
 * The box prior behind BTA EPM has always been built from Bart's raw_row alone:
 * 23 season-level columns. CBBD gives us two sources it never touched —
 *
 *   box-players-full.json.gz    every player-game: usage, ORtg/DRtg, eFG, TS,
 *                               FTR, ORB%, AST/TO, rebounds, fouls, minutes,
 *                               PLUS who the opponent was and how fast the game
 *                               went
 *   shooting-players.json.gz    season shot diet split five ways (dunks, layups,
 *                               tip-ins, two-point jumpers, three-point jumpers)
 *                               with makes AND assisted counts per bucket
 *
 * — and between them they answer questions the season table cannot:
 *
 *   WHO DID HE DO IT AGAINST   per-game rows carry an opponent, so every rate
 *                              can be re-weighted by opponent quality. Box-EPM
 *                              measurably under-credits hard schedules; this is
 *                              the input that fixes it.
 *   DID HE CREATE IT HIMSELF   assisted% per shot bucket separates a player who
 *                              makes his own shot from one who finishes someone
 *                              else's. Same signal RAPTOR needed tracking for.
 *   WHERE DOES HE SCORE        dunk / layup / tip / mid / three shares are role
 *                              and rim pressure, which season FG% flattens away.
 *   HOW RELIABLY               per-game spread separates a steady 14 a night
 *                              from 30-then-2.
 *
 * Opponent quality comes from ratings-adjusted.json.gz (CBBD's own adjusted net
 * by teamId), joined on the opponentId already sitting in every box row — no
 * name matching needed on that edge.
 *
 * Join to Bart mirrors export-epm-json / export-shooting-json exactly: exact
 * name+team, then unique name, then first-initial+last+team.
 *
 *   in:  data/cbbd/<season>/{box-players-full,shooting-players,ratings-adjusted}.json.gz
 *        public/data/players-by-year/<season>.json
 *   out: data/derived/cbbd-season-<season>.json  { season, built_at, players: {<bart_id>: {...}}, meta }
 *        Gitignored build intermediate, same class as scripts/box-epm-features.csv.
 *        NOT under public/ on purpose: it is ~2.3 MB a season and nothing
 *        fetches it from the browser, so shipping it would add 12 MB of dead
 *        weight to a deploy that is already too heavy.
 *   Run: node scripts/build-cbbd-player-season.mjs --from 2022 --to 2026
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const DATA = path.resolve("public/data");
const DERIVED = path.resolve("data/derived");
const CBBD = path.resolve("data/cbbd");
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i > -1 ? args[i + 1] : null; };
const FROM = Number(opt("from") || 2022), TO = Number(opt("to") || 2026);

const norm = (s) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim().replace(/\s+(jr|sr|ii|iii|iv|v)$/, "");
const normTeam = (s) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/\buniversity\b|\bthe\b/g, "").replace(/\bstate\b/g, "st").replace(/[^a-z0-9]+/g, "");
const initLast = (n) => { const p = norm(n).split(" "); return p.length >= 2 ? `${p[0][0]} ${p[p.length - 1]}` : norm(n); };

const readGz = (fp) => JSON.parse(zlib.gunzipSync(fs.readFileSync(fp)).toString());
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

/**
 * Per-GAME offensive and defensive ratings are wild on small minutes — CBBD has
 * returned figures over 3,000 — so they are winsorized before any averaging.
 * The same clamp already guards scripts/build-bta-porpag.mjs.
 */
const RTG_MIN = 0, RTG_MAX = 300;
const clampRtg = (v) => (v == null ? null : Math.min(RTG_MAX, Math.max(RTG_MIN, v)));

function bartIndex(year) {
  const f = path.join(DATA, "players-by-year", `${year}.json`);
  if (!fs.existsSync(f)) return null;
  const arr = JSON.parse(fs.readFileSync(f, "utf8"));
  const byNT = new Map(), byName = new Map(), byIL = new Map();
  for (const p of arr) {
    if (p.bart_player_id == null) continue;
    const t = Array.isArray(p.teams) ? p.teams[0] : p.teams;
    const nn = norm(p.name), nt = normTeam(t?.name);
    byNT.set(`${nn}|${nt}`, p.bart_player_id);
    if (!byName.has(nn)) byName.set(nn, []);
    byName.get(nn).push(p.bart_player_id);
    const k = `${initLast(p.name)}|${nt}`;
    if (!byIL.has(k)) byIL.set(k, p.bart_player_id);
  }
  return {
    find(name, team) {
      const nn = norm(name), nt = normTeam(team);
      let id = byNT.get(`${nn}|${nt}`);
      if (id == null) { const c = byName.get(nn); if (c && c.length === 1) id = c[0]; }
      if (id == null) id = byIL.get(`${initLast(name)}|${nt}`);
      return id ?? null;
    },
  };
}

/** Weighted mean that ignores null samples rather than treating them as zero. */
function wmean(pairs) {
  let s = 0, w = 0;
  for (const [v, ww] of pairs) { if (v == null || !(ww > 0)) continue; s += v * ww; w += ww; }
  return w > 0 ? s / w : null;
}

function buildSeason(year) {
  const dir = path.join(CBBD, String(year));
  const boxFile = path.join(dir, "box-players-full.json.gz");
  if (!fs.existsSync(boxFile)) return null;
  const games = readGz(boxFile);
  const idx = bartIndex(year);
  if (!idx) return null;

  // Opponent quality by CBBD teamId. Mean-centred so "opponent strength" reads
  // as points better or worse than an average D-I team, and a non-D-I opponent
  // (absent from the ratings file) is priced below the worst rated team rather
  // than dropped — those games are real minutes and real production.
  const adj = new Map();
  const rf = path.join(dir, "ratings-adjusted.json.gz");
  if (fs.existsSync(rf)) for (const t of readGz(rf)) adj.set(t.teamId, num(t.netRating));
  const vals = [...adj.values()].filter((v) => v != null);
  const lgNet = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  const worst = vals.length ? Math.min(...vals) : 0;
  const NON_D1 = worst - 10;
  const oppStrength = (teamId) => (adj.has(teamId) ? adj.get(teamId) : NON_D1) - lgNet;

  // ── pass 1: accumulate per player-season ────────────────────────────────
  const acc = new Map();
  for (const g of games) {
    const opp = oppStrength(g.opponentId);
    const pace = num(g.gamePace) ?? 68;
    for (const p of g.players ?? []) {
      const min = num(p.minutes);
      if (!(min > 0)) continue;
      const k = p.athleteSourceId ?? `n:${p.name}|${g.teamId}`;
      let a = acc.get(k);
      if (!a) {
        a = {
          name: p.name, team: g.team, teamId: g.teamId, pos: p.position,
          gp: 0, min: 0, starts: 0, poss: 0,
          gs: [], oppW: 0, oppSum: 0,
          rate: [], // [{min, poss, opp, ortg, drtg, usg, efg, ts, ftr, orb, ato, fouls, pts}]
        };
        acc.set(k, a);
      }
      a.gp++;
      a.min += min;
      if (p.starter) a.starts++;
      const poss = (pace * min) / 40;
      a.poss += poss;
      a.oppSum += opp * min; a.oppW += min;
      const gs = num(p.gameScore);
      if (gs != null) a.gs.push((gs / min) * 40);
      a.rate.push({
        min, poss, opp,
        ortg: clampRtg(num(p.offensiveRating)), drtg: clampRtg(num(p.defensiveRating)),
        usg: num(p.usage), efg: num(p.effectiveFieldGoalPct), ts: num(p.trueShootingPct),
        ftr: num(p.freeThrowRate), orb: num(p.offensiveReboundPct),
        ato: num(p.assistsTurnoverRatio), fouls: num(p.fouls), pts: num(p.points),
        fga: num(p.fieldGoals?.attempted) ?? 0,
      });
    }
  }

  // ── shot diet + self-creation, season level ─────────────────────────────
  const shot = new Map();
  const sf = path.join(dir, "shooting-players.json.gz");
  if (fs.existsSync(sf)) {
    for (const s of readGz(sf)) {
      const b = s.attemptsBreakdown ?? {};
      const att = (o) => num(o?.attempted) ?? 0;
      const made = (o) => num(o?.made) ?? 0;
      const asst = (o) => num(o?.assisted) ?? 0;
      const rimA = att(s.dunks) + att(s.layups) + att(s.tipIns);
      const rimM = made(s.dunks) + made(s.layups) + made(s.tipIns);
      const rimAs = asst(s.dunks) + asst(s.layups) + asst(s.tipIns);
      const jumpA = att(s.twoPointJumpers) + att(s.threePointJumpers);
      const jumpAs = asst(s.twoPointJumpers) + asst(s.threePointJumpers);
      shot.set(`${norm(s.athleteName)}|${normTeam(s.team)}`, {
        tracked: num(s.trackedShots) ?? 0,
        // shot diet, as a share of tracked attempts
        dunk_rate: num(b.dunks), layup_rate: num(b.layups), tip_rate: num(b.tipIns),
        mid_rate: num(b.twoPointJumpers), tp_rate: num(b.threePointJumpers),
        rim_rate: (num(b.dunks) ?? 0) + (num(b.layups) ?? 0) + (num(b.tipIns) ?? 0),
        // finishing by zone
        rim_pct: rimA >= 20 ? (rimM / rimA) * 100 : null,
        mid_pct: att(s.twoPointJumpers) >= 20 ? (made(s.twoPointJumpers) / att(s.twoPointJumpers)) * 100 : null,
        // SELF-CREATION. assistedPct is the share of MAKES that were assisted,
        // so its complement is the share a player generated himself. Split by
        // zone because an unassisted layup and an unassisted three are
        // different skills — one is a drive, the other is shot-making off the
        // dribble.
        unassisted: num(s.assistedPct) == null ? null : 100 - num(s.assistedPct),
        unassisted_rim: rimM >= 20 ? 100 - (rimAs / rimM) * 100 : null,
        unassisted_jump: made(s.twoPointJumpers) + made(s.threePointJumpers) >= 20
          ? 100 - (jumpAs / (made(s.twoPointJumpers) + made(s.threePointJumpers))) * 100 : null,
        ftr_cbbd: num(s.freeThrowRate),
        jump_share: rimA + jumpA > 0 ? (jumpA / (rimA + jumpA)) * 100 : null,
      });
    }
  }

  // ── pass 2: reduce and join ─────────────────────────────────────────────
  const players = {};
  let matched = 0, unmatched = 0, withShots = 0;
  for (const a of acc.values()) {
    const bid = idx.find(a.name, a.team);
    if (bid == null) { unmatched++; continue; }
    matched++;
    const R = a.rate;
    const oppMean = a.oppW > 0 ? a.oppSum / a.oppW : null;

    // Minutes-weighted season rates.
    const w = (f, weight = "min") => wmean(R.map((r) => [f(r), r[weight]]));
    // Opponent-weighted: the same rate, but games against better teams count
    // for more. Difference between the two IS the schedule signal.
    const OPP_SPAN = 20; // ~ worst to best D-I in adjusted net
    const oppW = (f) => wmean(R.map((r) => [f(r), r.min * Math.exp(r.opp / OPP_SPAN)]));

    const gs = a.gs;
    const gsMean = gs.length ? gs.reduce((x, y) => x + y, 0) / gs.length : null;
    const gsSd = gs.length > 2
      ? Math.sqrt(gs.reduce((s, v) => s + (v - gsMean) ** 2, 0) / gs.length) : null;

    const ortg = w((r) => r.ortg), ortgOpp = oppW((r) => r.ortg);
    const drtg = w((r) => r.drtg), drtgOpp = oppW((r) => r.drtg);
    const sh = shot.get(`${norm(a.name)}|${normTeam(a.team)}`) ?? null;
    if (sh) withShots++;

    players[bid] = {
      gp: a.gp, min: r1(a.min), poss: Math.round(a.poss),
      start_pct: r1((a.starts / a.gp) * 100),
      opp: r2(oppMean),
      ortg: r1(ortg), drtg: r1(drtg),
      // How a player's rates hold up as the opponent gets better. Positive =
      // he did MORE against the good teams than his season line suggests.
      ortg_opp_delta: ortg != null && ortgOpp != null ? r2(ortgOpp - ortg) : null,
      drtg_opp_delta: drtg != null && drtgOpp != null ? r2(drtgOpp - drtg) : null,
      usg: r1(w((r) => r.usg)), usg_opp_delta: r2((oppW((r) => r.usg) ?? 0) - (w((r) => r.usg) ?? 0)),
      efg: r1(w((r) => r.efg, "poss")), ts: r1(w((r) => r.ts, "poss")),
      ftr: r1(w((r) => r.ftr)), orb_pct: r1(w((r) => r.orb)),
      ato: r2(w((r) => r.ato)),
      fouls40: r2(wmean(R.map((r) => [(r.fouls / r.min) * 40, r.min]))),
      gs40: r2(gsMean), gs40_sd: r2(gsSd),
      ...(sh ? {
        tracked: sh.tracked,
        dunk_rate: r1(sh.dunk_rate), layup_rate: r1(sh.layup_rate), tip_rate: r1(sh.tip_rate),
        rim_rate: r1(sh.rim_rate), mid_rate: r1(sh.mid_rate), tp_rate: r1(sh.tp_rate),
        rim_pct: r1(sh.rim_pct), mid_pct: r1(sh.mid_pct),
        unassisted: r1(sh.unassisted), unassisted_rim: r1(sh.unassisted_rim),
        unassisted_jump: r1(sh.unassisted_jump),
        jump_share: r1(sh.jump_share), ftr_cbbd: r1(sh.ftr_cbbd),
      } : {}),
    };
  }

  const out = {
    season: year, built_at: new Date().toISOString(),
    players, meta: { matched, unmatched, with_shot_diet: withShots, games: games.length },
  };
  fs.mkdirSync(DERIVED, { recursive: true });
  const fp = path.join(DERIVED, `cbbd-season-${year}.json`);
  fs.writeFileSync(fp, JSON.stringify(out));
  console.log(`✓ ${year}: ${matched.toLocaleString()} matched, ${unmatched.toLocaleString()} unmatched, `
    + `${withShots.toLocaleString()} with shot diet → ${path.basename(fp)}`);
  return out;
}

for (let y = FROM; y <= TO; y++) {
  try { buildSeason(y); } catch (e) { console.warn(`skip ${y}: ${e.message}`); }
}
