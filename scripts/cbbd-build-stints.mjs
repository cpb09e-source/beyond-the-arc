/**
 * cbbd-build-stints.mjs — turn the raw CBBD play archive into RAPM-ready stints.
 *
 * A stint = a maximal run of plays within one game where the same 10 players
 * are on the floor. For each we record both five-man units (player ids), elapsed
 * seconds, points scored by each side, and a possession estimate per side
 * (FGA − OREB + TO + 0.475·FTA — the standard box formula, computed from play
 * events inside the stint). Stints where onFloor is incomplete (≠10, common in
 * some low-major broadcasts) are written with valid:false — the RAPM fit skips
 * them, the box prior covers those players instead.
 *
 * In:  data/cbbd/<season>/plays-*.json.gz   (from cbbd-ingest.mjs)
 * Out: data/cbbd/<season>/stints.csv.gz     one row per stint
 *      data/cbbd/<season>/players.csv.gz    id,name,team (everyone seen on floor)
 *
 * Run: node scripts/cbbd-build-stints.mjs --season 2026
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const OUT_ROOT = path.resolve("data/cbbd");
const args = process.argv.slice(2);
const SEASON = args[args.indexOf("--season") + 1];
if (!SEASON || !/^\d{4}$/.test(SEASON)) { console.error("usage: --season 2026"); process.exit(1); }

const readGz = (fp) => JSON.parse(zlib.gunzipSync(fs.readFileSync(fp)).toString());

// Shot / event classification by playType.
const FGA_TYPES = new Set(["JumpShot", "LayUpShot", "DunkShot", "TipShot", "HookShot"]);
const TO_TYPES = new Set(["Lost Ball Turnover", "Turnover", "Shot Clock Turnover", "Bad Pass\nTurnover", "Bad Pass Turnover", "Offensive Goal Tending Turnover", "Out of Bounds Turnover", "Traveling Turnover", "3 Second Violation Turnover", "5 Second Violation Turnover", "10 Second Violation Turnover", "Double Dribble Turnover", "Offensive Foul Turnover", "Palming Turnover", "Backcourt Violation Turnover", "Lane Violation Turnover"]);
const FTA_TYPES = new Set(["MadeFreeThrow", "MissedFreeThrow"]);

function main() {
  const dir = path.join(OUT_ROOT, SEASON);
  const files = fs.readdirSync(dir).filter((f) => f.startsWith("plays-") && f.endsWith(".json.gz")).sort();
  console.log(`🧮 stint build — season ${SEASON}, ${files.length} slates`);

  const stintRows = [];
  const players = new Map(); // id -> {name, team}
  // The API's /plays/date buckets by UTC, so a 7pm-ET game appears in BOTH its
  // ET date's pull and the next UTC day's — process every gameId exactly once.
  const seenGames = new Set();
  let games = 0, badGames = 0, dupGames = 0;

  for (const f of files) {
    const plays = readGz(path.join(dir, f));
    if (!plays.length) continue;
    const byGame = new Map();
    for (const p of plays) {
      if (!byGame.has(p.gameId)) byGame.set(p.gameId, []);
      byGame.get(p.gameId).push(p);
    }
    for (const [gameId, gp] of byGame) {
      if (seenGames.has(gameId)) { dupGames++; continue; }
      seenGames.add(gameId);
      games++;
      // Home team name: any play row knows it via isHomeTeam + team.
      const homeRow = gp.find((p) => p.team && p.isHomeTeam != null);
      if (!homeRow) { badGames++; continue; }
      const homeTeam = homeRow.isHomeTeam ? homeRow.team : homeRow.opponent;
      const date = (gp[0].gameStartDate ?? "").slice(0, 10);
      // Chronological order: period asc, clock desc (secondsRemaining counts down
      // within the period on this feed), source id as tiebreak.
      gp.sort((a, b) => (a.period - b.period) || (b.secondsRemaining - a.secondsRemaining) || (a.id - b.id));

      let cur = null; // active stint
      const close = () => { if (cur) { stintRows.push(cur); cur = null; } };
      const keyOf = (onFloor) => onFloor.map((x) => x.id).sort((a, b) => a - b).join("|");

      let prevHome = 0, prevAway = 0;
      for (const p of gp) {
        const of = Array.isArray(p.onFloor) ? p.onFloor : [];
        for (const x of of) if (x.id != null && !players.has(x.id)) players.set(x.id, { name: x.name, team: x.team });
        const valid = of.length === 10;
        const key = valid ? keyOf(of) : `invalid:${of.length}`;

        if (!cur || cur.key !== key || cur.period !== p.period) {
          close();
          const homeFive = [], awayFive = [];
          for (const x of of) (x.team === homeTeam ? homeFive : awayFive).push(x.id);
          cur = {
            key, gameId, date, period: p.period, valid: valid && homeFive.length === 5 && awayFive.length === 5,
            home: homeFive.sort((a, b) => a - b), away: awayFive.sort((a, b) => a - b),
            startSecs: p.secondsRemaining, endSecs: p.secondsRemaining,
            ptsHome: 0, ptsAway: 0,
            fgaH: 0, fgaA: 0, orebH: 0, orebA: 0, toH: 0, toA: 0, ftaH: 0, ftaA: 0,
          };
        }
        cur.endSecs = p.secondsRemaining;

        // Score attribution from the running score columns (robust to playText).
        // Monotonic max: scorer corrections emit down-then-up sequences (62→61→62)
        // and naive positive-delta counting double-counts the re-up.
        const h = Math.max(prevHome, p.homeScore ?? 0), a = Math.max(prevAway, p.awayScore ?? 0);
        if (h > prevHome) cur.ptsHome += h - prevHome;
        if (a > prevAway) cur.ptsAway += a - prevAway;
        prevHome = h; prevAway = a;

        // Possession components by acting side.
        const isHome = p.team === homeTeam;
        if (FGA_TYPES.has(p.playType)) { isHome ? cur.fgaH++ : cur.fgaA++; }
        else if (p.playType === "Offensive Rebound") { isHome ? cur.orebH++ : cur.orebA++; }
        else if (FTA_TYPES.has(p.playType)) { isHome ? cur.ftaH++ : cur.ftaA++; }
        else if (TO_TYPES.has(p.playType) || /turnover/i.test(p.playType ?? "")) { isHome ? cur.toH++ : cur.toA++; }
      }
      close();
    }
  }

  // Possession estimate + serialize. NO per-stint clamping — tiny stints can go
  // fractionally negative (a lone-OREB segment is −1 FGA-equivalent) and
  // clamping each to 0 inflates the game sum by ~15 poss. Negative fragments
  // cancel correctly when stints aggregate; the RAPM weighting floors at 0 there.
  const poss = (fga, oreb, to, fta) => fga - oreb + to + 0.475 * fta;
  const lines = ["gameId,date,period,valid,secs,home5,away5,ptsHome,ptsAway,possHome,possAway"];
  for (const s of stintRows) {
    const secs = Math.max(0, (s.startSecs ?? 0) - (s.endSecs ?? 0));
    lines.push([
      s.gameId, s.date, s.period, s.valid ? 1 : 0, secs,
      s.home.join(";"), s.away.join(";"),
      s.ptsHome, s.ptsAway,
      poss(s.fgaH, s.orebH, s.toH, s.ftaH).toFixed(2),
      poss(s.fgaA, s.orebA, s.toA, s.ftaA).toFixed(2),
    ].join(","));
  }
  fs.writeFileSync(path.join(dir, "stints.csv.gz"), zlib.gzipSync(lines.join("\n")));
  const pl = ["id,name,team", ...[...players.entries()].map(([id, v]) => `${id},"${(v.name ?? "").replace(/"/g, "")}","${(v.team ?? "").replace(/"/g, "")}"`)];
  fs.writeFileSync(path.join(dir, "players.csv.gz"), zlib.gzipSync(pl.join("\n")));

  const valid = stintRows.filter((s) => s.valid).length;
  console.log(`✓ ${games} games (${badGames} unusable, ${dupGames} UTC-dupes skipped) → ${stintRows.length.toLocaleString()} stints (${valid.toLocaleString()} valid = ${(valid / stintRows.length * 100).toFixed(1)}%) · ${players.size.toLocaleString()} players`);
  console.log(`  wrote ${path.join(dir, "stints.csv.gz")}`);
}

main();
