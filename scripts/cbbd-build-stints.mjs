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
            // Shot detail for the luck adjustment: threes and free throws are
            // where on-off variance actually lives, so both attempts and makes
            // are tracked per side. See scripts/compute-epm-extras.py.
            fg3aH: 0, fg3mH: 0, fg3aA: 0, fg3mA: 0, ftmH: 0, ftmA: 0,
            // Box-line counters for the lineup grid. These are INDEPENDENT of
            // the possession inputs above on purpose: fgaH/orebH/toH feed the
            // possession formula and changing how they are counted would move
            // every EPM number on the site. These are read from shotInfo and
            // playType directly and validated against box-teams-full — FGA,
            // FGM, OREB, DREB, STL and BLK all land within 0.1% of the box.
            xFgaH: 0, xFgaA: 0, xFgmH: 0, xFgmA: 0,
            xRimaH: 0, xRimaA: 0, xRimmH: 0, xRimmA: 0,
            xMidaH: 0, xMidaA: 0, xMidmH: 0, xMidmA: 0,
            xOrebH: 0, xOrebA: 0, xDrebH: 0, xDrebA: 0,
            xAstH: 0, xAstA: 0, xStlH: 0, xStlA: 0,
            xBlkH: 0, xBlkA: 0, xPfH: 0, xPfA: 0, xToH: 0, xToA: 0,
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

        // ---- Box-line counters (see the note where these are declared).
        // Shots come from shotInfo rather than playType: it carries `range`,
        // which separates rim from jumper from three, and it reports free
        // throws as their own range so they are excluded from FGA here without
        // any playType special-casing. Verified 100% against the box on FGM
        // and 99.6% on FGA.
        {
          const si = p.shotInfo;
          if (si && si.range && si.range !== "free_throw") {
            const made = !!si.made;
            if (isHome) {
              cur.xFgaH++; if (made) cur.xFgmH++;
              if (si.range === "rim") { cur.xRimaH++; if (made) cur.xRimmH++; }
              else if (si.range === "jumper") { cur.xMidaH++; if (made) cur.xMidmH++; }
              // An assist belongs to the team that scored, and is only ever
              // recorded on a made field goal — never a free throw, which is
              // why this sits inside the non-free-throw branch.
              if (made && si.assisted) cur.xAstH++;
            } else {
              cur.xFgaA++; if (made) cur.xFgmA++;
              if (si.range === "rim") { cur.xRimaA++; if (made) cur.xRimmA++; }
              else if (si.range === "jumper") { cur.xMidaA++; if (made) cur.xMidmA++; }
              if (made && si.assisted) cur.xAstA++;
            }
          }
          // Steals and blocks are credited to the team that MADE them — the
          // defence — not to the team that lost the ball. Checked against the
          // box: both match exactly, so p.team is the right side with no flip.
          const t = p.playType;
          if (t === "Offensive Rebound") { isHome ? cur.xOrebH++ : cur.xOrebA++; }
          else if (t === "Defensive Rebound") { isHome ? cur.xDrebH++ : cur.xDrebA++; }
          else if (t === "Steal") { isHome ? cur.xStlH++ : cur.xStlA++; }
          else if (t === "Block Shot") { isHome ? cur.xBlkH++ : cur.xBlkA++; }
          else if (t === "PersonalFoul" || t === "Technical Foul") { isHome ? cur.xPfH++ : cur.xPfA++; }
          if (TO_TYPES.has(t) || /turnover/i.test(t ?? "")) { isHome ? cur.xToH++ : cur.xToA++; }
        }
        if (FGA_TYPES.has(p.playType)) {
          isHome ? cur.fgaH++ : cur.fgaA++;
          // scoreValue is the shot's value whether or not it went in, so a
          // missed three still reports 3 — which is exactly what an attempt
          // count needs.
          if (p.scoreValue === 3) {
            if (isHome) { cur.fg3aH++; if (p.scoringPlay) cur.fg3mH++; }
            else { cur.fg3aA++; if (p.scoringPlay) cur.fg3mA++; }
          }
        }
        else if (p.playType === "Offensive Rebound") { isHome ? cur.orebH++ : cur.orebA++; }
        else if (FTA_TYPES.has(p.playType)) {
          // Makes come from scoringPlay, NOT the play type. CBBD labels every
          // free throw "MadeFreeThrow" whichever way it goes — a miss reads
          // {playType:"MadeFreeThrow", scoringPlay:false, playText:"... missed
          // Free Throw."}. "MissedFreeThrow" is in FTA_TYPES but never occurs;
          // trusting the name gave a season free-throw rate of exactly 100%.
          if (isHome) { cur.ftaH++; if (p.scoringPlay) cur.ftmH++; }
          else { cur.ftaA++; if (p.scoringPlay) cur.ftmA++; }
        }
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
  // Columns appended, never reordered — compute-epm.py and compute-epm-extras.py
  // both read this by name via DictReader, so extra trailing fields are free.
  const lines = ["gameId,date,period,valid,secs,home5,away5,ptsHome,ptsAway,possHome,possAway,"
    + "fg3aHome,fg3mHome,fg3aAway,fg3mAway,ftaHome,ftmHome,ftaAway,ftmAway,"
    + "fgaHome,fgaAway,fgmHome,fgmAway,rimaHome,rimaAway,rimmHome,rimmAway,"
    + "midaHome,midaAway,midmHome,midmAway,orebHome,orebAway,drebHome,drebAway,"
    + "astHome,astAway,stlHome,stlAway,blkHome,blkAway,pfHome,pfAway,tovHome,tovAway"];
  for (const s of stintRows) {
    const secs = Math.max(0, (s.startSecs ?? 0) - (s.endSecs ?? 0));
    lines.push([
      s.gameId, s.date, s.period, s.valid ? 1 : 0, secs,
      s.home.join(";"), s.away.join(";"),
      s.ptsHome, s.ptsAway,
      poss(s.fgaH, s.orebH, s.toH, s.ftaH).toFixed(2),
      poss(s.fgaA, s.orebA, s.toA, s.ftaA).toFixed(2),
      s.fg3aH, s.fg3mH, s.fg3aA, s.fg3mA,
      s.ftaH, s.ftmH, s.ftaA, s.ftmA,
      s.xFgaH, s.xFgaA, s.xFgmH, s.xFgmA,
      s.xRimaH, s.xRimaA, s.xRimmH, s.xRimmA,
      s.xMidaH, s.xMidaA, s.xMidmH, s.xMidmA,
      s.xOrebH, s.xOrebA, s.xDrebH, s.xDrebA,
      s.xAstH, s.xAstA, s.xStlH, s.xStlA,
      s.xBlkH, s.xBlkA, s.xPfH, s.xPfA, s.xToH, s.xToA,
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
