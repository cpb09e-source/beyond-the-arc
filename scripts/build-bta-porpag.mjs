#!/usr/bin/env node
/**
 * build-bta-porpag.mjs — BTA points over replacement, per game.
 *
 * WHY THIS EXISTS. The explorer's production column was Bart Torvik's PORPAG,
 * read out of raw_row[28]. Two problems with leaning on it: it is somebody
 * else's derived stat on a site heading behind a paywall, and BTA's own
 * bta_ind_ortg is computed FROM it, so the dependency runs deeper than one
 * column. This rebuilds the same idea from CBBD primitives we already hold.
 *
 * CONSTRUCTION. For each player-game CBBD gives offensiveRating (points
 * produced per 100 possessions used), usage, minutes and the game's pace:
 *
 *     possessions used   = (usage / 100) x gamePace x (minutes / 40)
 *     points produced    = (offensiveRating / 100) x possessions used
 *     opponent credit    = league mean defensive rating / opponent's
 *     BTA PORPAG         = (adjusted points produced
 *                           - replacement rate x possessions used) / games
 *
 * The opponent term is the "adjusted" part and is where this can beat a
 * season-average adjustment: we know the opponent on every single game, so a
 * line against the best defense in the country is credited as such on the day
 * it happened.
 *
 * REPLACEMENT LEVEL is the 20th percentile of SEASON offensive ratings among
 * rotation players (10+ games, 10+ mpg) — what a freely available player
 * actually produces. Deliberately not the 20th percentile of per-GAME ratings:
 * that is dominated by every rotation player's worst night and came out at
 * 72.8, which is nobody's true level.
 *
 * KEYED ON athleteSourceId. CBBD's athleteId is unique per player-GAME —
 * 126,735 rows, 126,735 distinct values — so keying on it gives every player a
 * one-game career and nothing qualifies.
 *
 * Validated against Bart's porpag at r = 0.947 (2026, 2,090 uniquely-joined
 * players), which is the evidence the construction is right rather than merely
 * plausible.
 *
 *   out: public/data/porpag-<season>.json
 *   Run: node scripts/build-bta-porpag.mjs [--season 2026]
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const args = process.argv.slice(2);
const ONE = args.includes("--season") ? Number(args[args.indexOf("--season") + 1]) : null;
const DATA = path.resolve("public/data");
const CBBD = path.resolve("data/cbbd");

const MIN_GAMES_REPL = 10, MIN_MPG_REPL = 10;   // who counts as "rotation" for the baseline
const REPL_PCTILE = 0.20;
const MIN_GAMES_OUT = 10;                        // who gets a published number

/**
 * CBBD's per-game offensiveRating has a corrupt tail, and one bad row is enough
 * to ruin a season total. Measured over 103,402 player-games in 2026:
 *
 *     p25 80.6   p50 108.7   p75 135.3   p95 179.3   p99 217.7   p99.9 300.0
 *     min -2227.5            max 3238.3
 *
 * Only 7 games exceed 300 and none of them are real — Jalin Rice of Nicholls
 * State posted a 3238.3 against Kentucky on 14 minutes and 13 points, which by
 * itself put a 5.4 ppg player top of the leaderboard at 10.5, clear of Cameron
 * Boozer. Negative ratings are impossible outright; you cannot produce fewer
 * than zero points.
 *
 * Clipping to [0, 300] keeps 99.99% of games untouched and every legitimately
 * huge one — the best real performances land around 200-240.
 */
const ORTG_MIN = 0, ORTG_MAX = 300;

const norm = (s) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim().replace(/\s+(jr|sr|ii|iii|iv|v)$/, "");
const normTeam = (s) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/\buniversity\b|\bthe\b/g, "").replace(/\bstate\b/g, "st").replace(/[^a-z0-9]+/g, "");
const il = (n) => { const t = norm(n).split(" "); return t.length >= 2 ? `${t[0][0]} ${t[t.length - 1]}` : norm(n); };

/** Bart id lookup for a season, same cascade build-epm-priors.mjs uses. */
function bartIndex(season) {
  const file = path.join(DATA, "players-by-year", `${season}.json`);
  if (!fs.existsSync(file)) return null;
  const byNT = new Map(), byName = new Map(), byIL = new Map();
  for (const p of JSON.parse(fs.readFileSync(file, "utf8"))) {
    if (p.bart_player_id == null) continue;
    const t = Array.isArray(p.teams) ? p.teams[0] : p.teams;
    const nn = norm(p.name), nt = normTeam(t?.name);
    byNT.set(`${nn}|${nt}`, p.bart_player_id);
    if (!byName.has(nn)) byName.set(nn, []);
    byName.get(nn).push(p.bart_player_id);
    const k = `${il(p.name)}|${nt}`;
    if (!byIL.has(k)) byIL.set(k, p.bart_player_id);
  }
  return (name, team) => {
    const nn = norm(name), nt = normTeam(team);
    let bid = byNT.get(`${nn}|${nt}`);
    if (bid == null) { const c = byName.get(nn); if (c && c.length === 1) bid = c[0]; }
    if (bid == null) bid = byIL.get(`${il(name)}|${nt}`);
    return bid ?? null;
  };
}

function buildSeason(season) {
  const boxPath = path.join(CBBD, String(season), "box-players-full.json.gz");
  const ratePath = path.join(CBBD, String(season), "ratings-adjusted.json.gz");
  if (!fs.existsSync(boxPath) || !fs.existsSync(ratePath)) return null;

  const box = JSON.parse(zlib.gunzipSync(fs.readFileSync(boxPath)).toString());
  const ratings = JSON.parse(zlib.gunzipSync(fs.readFileSync(ratePath)).toString());
  const defByTeamId = new Map(ratings.map((r) => [r.teamId, r.defensiveRating]));
  const leagueDef = ratings.reduce((s, r) => s + r.defensiveRating, 0) / ratings.length;

  const agg = new Map();
  let clipped = 0;
  for (const g of box) {
    const oppDef = defByTeamId.get(g.opponentId);
    const oppMult = typeof oppDef === "number" && oppDef > 0 ? leagueDef / oppDef : 1;
    const pace = g.gamePace ?? 68;
    for (const p of g.players) {
      const min = p.minutes ?? 0;
      if (min <= 0 || typeof p.offensiveRating !== "number" || typeof p.usage !== "number") continue;
      const possUsed = (p.usage / 100) * pace * (min / 40);
      if (possUsed <= 0) continue;
      const ortg = Math.max(ORTG_MIN, Math.min(ORTG_MAX, p.offensiveRating));
      if (ortg !== p.offensiveRating) clipped++;
      let a = agg.get(p.athleteSourceId);
      if (!a) { a = { name: p.name, team: g.team, games: 0, min: 0, possUsed: 0, pts: 0, adjPts: 0 }; agg.set(p.athleteSourceId, a); }
      a.games++; a.min += min; a.team = g.team;
      a.possUsed += possUsed;
      a.pts += (ortg / 100) * possUsed;
      a.adjPts += (ortg / 100) * possUsed * oppMult;
    }
  }

  const all = [...agg.values()].map((a) => ({
    ...a, mpg: a.min / a.games, ortg: a.possUsed > 0 ? (100 * a.pts) / a.possUsed : null,
  }));
  const rotation = all.filter((a) => a.games >= MIN_GAMES_REPL && a.mpg >= MIN_MPG_REPL && a.ortg != null);
  if (rotation.length < 50) return null;
  const ortgs = rotation.map((a) => a.ortg).sort((x, y) => x - y);
  const REPL = ortgs[Math.floor(ortgs.length * REPL_PCTILE)];

  const toBart = bartIndex(season);
  const players = {};
  let matched = 0, unmatched = 0;
  for (const a of all) {
    if (a.games < MIN_GAMES_OUT || a.ortg == null) continue;
    const bid = toBart ? toBart(a.name, a.team) : null;
    if (bid == null) { unmatched++; continue; }
    matched++;
    players[bid] = {
      porpag: Math.round(((a.adjPts - (REPL / 100) * a.possUsed) / a.games) * 100) / 100,
      ortg: Math.round(a.ortg * 10) / 10,
      poss_used: Math.round(a.possUsed),
      games: a.games,
    };
  }

  return {
    payload: {
      season,
      built_at: process.env.BUILD_STAMP || new Date().toISOString(),
      replacement_ortg: Math.round(REPL * 10) / 10,
      method: "CBBD per-game offensiveRating x possessions used, opponent-adjusted, minus replacement",
      players,
    },
    stats: { matched, unmatched, repl: REPL, pool: rotation.length, clipped },
  };
}

function main() {
  const seasons = ONE ? [ONE] : fs.readdirSync(CBBD).map(Number).filter(Number.isFinite).sort();
  let wrote = 0;
  for (const s of seasons) {
    const r = buildSeason(s);
    if (!r) { if (ONE) console.error(`  season ${s}: no box/ratings data`); continue; }
    fs.writeFileSync(path.join(DATA, `porpag-${s}.json`), JSON.stringify(r.payload));
    wrote++;
    console.log(
      `  porpag-${s}.json  ${String(r.stats.matched).padStart(4)} players  ` +
      `replacement ${r.stats.repl.toFixed(1)}  (${r.stats.unmatched} unjoined, ${r.stats.clipped} ratings clipped)`,
    );
  }
  console.log(`\n✓ wrote ${wrote} season files`);
}

main();
