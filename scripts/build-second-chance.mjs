#!/usr/bin/env node
/**
 * build-second-chance.mjs — second-chance points per team per game, reconstructed
 * from play-by-play.
 *
 *   data/cbbd/<season>/second-chance.json.gz
 *   { "<gameId>": { "<teamId>": points, ... }, ... }
 *
 * WHY THIS EXISTS: second-chance points are the ONE stat the old CBB Analytics
 * feed carried that CBBD has no equivalent for — not in the game box, not in
 * /stats/team/season. It is a live filter on both the team explorer ("2nd-Chance
 * Diff") and /calc, so losing it outright would have been a visible regression.
 *
 * DEFINITION: points scored on a possession that included an offensive rebound.
 * The play-by-play has explicit "Offensive Rebound" events back to 2014, so this
 * is reconstruction from real events rather than estimation.
 *
 * THE POSSESSION MODEL: walk the plays in order, per game. An offensive rebound
 * ARMS the rebounding team; every point that team scores while armed is
 * second-chance. The arming clears when the possession ends:
 *
 *   - defensive rebound       (ball changed hands)
 *   - any turnover            (ball changed hands)
 *   - end of period           (possession cannot span the break)
 *   - a SHOT by the other team (they are demonstrably on offense now)
 *
 * Note what does NOT clear it: a made field goal or free throw by the armed team.
 * That is deliberate. Clearing on a made shot looks right but breaks two-shot
 * trips — the second free throw of an and-one or a two-shot foul would stop
 * being counted. Waiting for a genuine change-of-possession event handles both,
 * and the following shot-by-the-other-team rule closes the possession anyway.
 *
 * Usage:
 *   node scripts/build-second-chance.mjs
 *   node scripts/build-second-chance.mjs --season 2026
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = process.cwd();
const SEASONS = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

const args = process.argv.slice(2);
const oneSeason = args.includes("--season") ? Number(args[args.indexOf("--season") + 1]) : null;

const isTurnover = (t) => typeof t === "string" && /turnover/i.test(t);
const isOffReb = (t) => t === "Offensive Rebound";
const isDefReb = (t) => t === "Defensive Rebound";
const isPeriodEnd = (t) => t === "End Period" || t === "End Game";

/**
 * Order plays within a game. `secondsRemaining` counts DOWN within a period, so
 * ascending period then descending clock is chronological. Falls back to the
 * archive order when the clock is missing, which is stable because CBBD returns
 * plays in sequence.
 */
function chronological(plays) {
  return plays
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      const pa = a.p.period ?? 0, pb = b.p.period ?? 0;
      if (pa !== pb) return pa - pb;
      const sa = a.p.secondsRemaining, sb = b.p.secondsRemaining;
      if (typeof sa === "number" && typeof sb === "number" && sa !== sb) return sb - sa;
      return a.i - b.i;
    })
    .map((x) => x.p);
}

function run(season) {
  const dir = path.join(ROOT, "data/cbbd", String(season));
  if (!fs.existsSync(dir)) return false;
  const files = fs.readdirSync(dir).filter((f) => f.startsWith("plays-") && f.endsWith(".json.gz"));
  if (files.length === 0) { console.log(`${season}: no play-by-play — skipped`); return false; }

  // gameId → array of plays, PROJECTED DOWN to the ten fields the possession
  // walk needs. Retaining the raw objects held every play of a season in memory
  // at once — 3.5M of them for 2026 — and reliably died with "Ineffective
  // mark-compacts near heap limit" around 3.5 GB. The projection is what makes
  // a whole season fit.
  //
  // The API buckets by UTC date, so a late tip appears in two consecutive pulls;
  // plays are de-duplicated by play id.
  const byGame = new Map();
  const seenPlay = new Set();
  for (const f of files) {
    let rows;
    try {
      rows = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, f))).toString());
    } catch (e) { console.warn(`   ! ${f}: ${e.message}`); continue; }
    for (const p of rows) {
      if (p.id != null) {
        if (seenPlay.has(p.id)) continue;
        seenPlay.add(p.id);
      }
      let a = byGame.get(p.gameId);
      if (!a) { a = []; byGame.set(p.gameId, a); }
      a.push({
        playType: p.playType,
        teamId: p.teamId,
        opponentId: p.opponentId,
        scoringPlay: p.scoringPlay,
        scoreValue: p.scoreValue,
        shootingPlay: p.shootingPlay,
        period: p.period,
        secondsRemaining: p.secondsRemaining,
      });
    }
    rows = null;
  }

  const out = {};
  let games = 0, withOffReb = 0;

  for (const [gameId, raw] of byGame) {
    const plays = chronological(raw);

    // Seed BOTH teams at 0 before counting.
    //
    // Without this, a team that happened to score no second-chance points has no
    // key at all, and every consumer does `scp[gameId]?.[teamId]` — which yields
    // undefined, i.e. "we have no data", not "they scored zero". The differential
    // then goes null for the game instead of being computed. That silently
    // dropped ~half the games from the first run of this script.
    const scp = {};
    for (const p of plays) {
      if (p.teamId != null) scp[p.teamId] ??= 0;
      if (p.opponentId != null) scp[p.opponentId] ??= 0;
    }

    let armed = null;          // teamId currently credited with an offensive rebound
    let sawOffReb = false;

    for (const p of plays) {
      const type = p.playType;
      const team = p.teamId;

      if (isPeriodEnd(type)) { armed = null; continue; }

      if (isOffReb(type)) { armed = team ?? null; sawOffReb = true; continue; }
      if (isDefReb(type) || isTurnover(type)) { armed = null; continue; }

      // The other team taking a shot proves possession has changed even when the
      // change-of-possession event itself is missing from the feed.
      if (armed !== null && p.shootingPlay && team !== armed) { armed = null; continue; }

      if (armed !== null && p.scoringPlay && team === armed) {
        const v = typeof p.scoreValue === "number" ? p.scoreValue : 0;
        if (v > 0) scp[team] = (scp[team] ?? 0) + v;
      }
    }

    games++;
    if (sawOffReb) withOffReb++;
    // Written even when empty: an explicit 0 for a game we DID process is a real
    // zero, and is what lets the consumers tell it apart from an absent game.
    out[gameId] = scp;
  }

  const fp = path.join(dir, "second-chance.json.gz");
  fs.writeFileSync(fp, zlib.gzipSync(JSON.stringify(out)));
  console.log(`${season}: ${games.toLocaleString()} games (${withOffReb.toLocaleString()} with offensive rebounds) → ${path.relative(ROOT, fp)}`);
  return true;
}

const list = oneSeason ? [oneSeason] : SEASONS;
console.log(`Reconstructing second-chance points for ${list.length} season(s)…\n`);
let ok = 0;
for (const s of list) if (run(s)) ok++;
console.log(`\nDone — ${ok} season(s) written.`);
