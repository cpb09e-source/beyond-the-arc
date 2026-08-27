#!/usr/bin/env node
/**
 * build-team-outcomes.mjs — lead-state records, from the play-by-play archive.
 *
 *   public/data/team-outcomes.json  →  { "<team>|<year>": {...} }
 *
 * WHAT THIS ANSWERS that nothing else here can: not whether a team won, but
 * what the scoreboard looked like on the way. Comebacks, collapses, and games
 * that were never in doubt are all invisible in a box score and all sitting in
 * the play-by-play, which carries a running `homeScore` / `awayScore` on every
 * play.
 *
 * TWO SIMILAR THINGS THAT ARE NOT THE SAME, and the distinction is the reason
 * both are emitted:
 *
 *   wins_no_trail   won without ever being behind. Ties are allowed — every
 *                   game starts 0-0, so a definition that forbids them would
 *                   count nothing.
 *   wire_wins       won wire to wire: never behind, AND never tied again after
 *                   first going ahead. This is the stricter one, and it is what
 *                   "wire to wire" is usually taken to mean.
 *
 * Losses are the mirror: `losses_no_lead` never led, `wire_losses` the opponent
 * led wire to wire.
 *
 * COVERAGE IS THE PLAY-BY-PLAY'S, NOT THE BOX SCORE'S — 2014-2026 except 2021,
 * for which no slates were ever archived. A team-season with no play-by-play is
 * absent rather than zeroed: "never trailed by 15 in any game" and "we have no
 * game data" must not read the same way.
 *
 * THE GAME LOG IS STILL THE AUTHORITY ON WHICH GAMES COUNT. A play whose game
 * is not in game-logs-by-year was filtered upstream (cancelled, exhibition,
 * non-D1 perspective) and is skipped, so these records reconcile with the Wins
 * and Losses columns computed in build-adjusted-ratings.mjs.
 *
 * Reads local files only — no network, so the data freeze does not apply.
 *
 *   node scripts/build-team-outcomes.mjs            # every season
 *   node scripts/build-team-outcomes.mjs 2026       # named seasons only
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public/data/team-outcomes.json");
const SEASONS = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

/** Deficit / lead thresholds, matching the ones the metric is usually quoted at. */
const MARGINS = [5, 10, 15, 20];

const TEAM_MAP = JSON.parse(
  fs.readFileSync(path.join(ROOT, "src/data/cbbd-team-map.json"), "utf8"),
);

/** Game ids the season's log kept, so this cannot count a filtered game. */
function eligibleGames(season) {
  const fp = path.join(ROOT, `public/data/game-logs-by-year/${season}.json`);
  if (!fs.existsSync(fp)) return null;
  const ids = new Set();
  for (const g of JSON.parse(fs.readFileSync(fp, "utf8"))) {
    const prefix = String(g.game_id ?? "").split("-")[0];
    if (prefix) ids.add(Number(prefix));
  }
  return ids;
}

function blank() {
  const z = {};
  for (const m of MARGINS) { z[`wins_trailing_${m}`] = 0; z[`losses_leading_${m}`] = 0; }
  return {
    pbp_games: 0,
    wins_no_trail: 0, losses_no_lead: 0,
    wire_wins: 0, wire_losses: 0,
    ...z,
  };
}

function run(season) {
  const dir = path.join(ROOT, "data/cbbd", String(season));
  if (!fs.existsSync(dir)) return {};
  const files = fs.readdirSync(dir).filter((f) => f.startsWith("plays-") && f.endsWith(".json.gz"));
  if (files.length === 0) { console.log(`${season}: no play-by-play on disk — skipped`); return {}; }

  const eligible = eligibleGames(season);

  /**
   * gameId -> { homeId, awayId, homeMaxLead, awayMaxLead, homeEverTied, ... }
   *
   * Accumulated across the whole season before being scored, because a slate
   * file holds every game played that day and a game's plays are contiguous
   * within it but its identity is not known until the first play is read.
   */
  const games = new Map();

  let plays = 0;
  for (const f of files) {
    let rows;
    try {
      rows = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, f))).toString());
    } catch (e) {
      console.warn(`   ! ${f}: ${e.message}`);
      continue;
    }
    for (const p of rows) {
      plays++;
      if (eligible && !eligible.has(p.gameId)) continue;
      const h = p.homeScore, a = p.awayScore;
      if (typeof h !== "number" || typeof a !== "number") continue;

      let g = games.get(p.gameId);
      if (!g) {
        g = {
          homeId: null, awayId: null,
          homeMaxLead: 0, awayMaxLead: 0,
          // Tracked from the moment a side first goes ahead, which is what
          // separates wire-to-wire from merely never trailing.
          homeLedYet: false, awayLedYet: false,
          homeTiedAfterLead: false, awayTiedAfterLead: false,
          finalH: h, finalA: a,
        };
        games.set(p.gameId, g);
      }

      // IDENTITY IS RESOLVED LAZILY, NOT ON THE FIRST PLAY.
      //
      // Every game opens with administrative rows — tip-off and period markers
      // — that carry null teamId, null opponentId and null isHomeTeam: 877 of
      // 37,231 plays on a sample slate. Reading identity off the first play we
      // happen to see therefore stamped null on both sides and never revisited
      // it, which silently dropped ~60% of teams from the output while every
      // game still appeared to score.
      //
      // isHomeTeam is relative to the ACTING team on the play, so it is what
      // resolves which of teamId / opponentId is the home side.
      if (g.homeId === null && typeof p.isHomeTeam === "boolean"
          && p.teamId != null && p.opponentId != null) {
        g.homeId = p.isHomeTeam ? p.teamId : p.opponentId;
        g.awayId = p.isHomeTeam ? p.opponentId : p.teamId;
      }

      const diff = h - a;
      if (diff > g.homeMaxLead) g.homeMaxLead = diff;
      if (-diff > g.awayMaxLead) g.awayMaxLead = -diff;
      if (diff > 0) g.homeLedYet = true;
      if (diff < 0) g.awayLedYet = true;
      if (diff === 0) {
        if (g.homeLedYet) g.homeTiedAfterLead = true;
        if (g.awayLedYet) g.awayTiedAfterLead = true;
      }
      // The last play carries the final score; plays arrive in order within a
      // file and a game never spans two slates.
      g.finalH = h; g.finalA = a;
    }
  }

  const totals = new Map();
  const bump = (teamId, fn) => {
    const mapped = TEAM_MAP[teamId];
    if (!mapped) return;
    const key = `${mapped.name}|${season}`;
    let t = totals.get(key);
    if (!t) { t = blank(); totals.set(key, t); }
    fn(t);
  };

  let scored = 0, unresolved = 0;
  for (const g of games.values()) {
    // A game with no scoring at all is a parse artefact, not a game.
    if (g.finalH === 0 && g.finalA === 0) continue;
    // No play in the whole game named both sides. Skipped rather than credited
    // to whichever half did resolve, which would give one team a phantom game.
    if (g.homeId === null || g.awayId === null) { unresolved++; continue; }
    scored++;

    for (const side of ["home", "away"]) {
      const isHome = side === "home";
      const id = isHome ? g.homeId : g.awayId;
      const myMaxLead = isHome ? g.homeMaxLead : g.awayMaxLead;
      const theirMaxLead = isHome ? g.awayMaxLead : g.homeMaxLead;
      const myLedYet = isHome ? g.homeLedYet : g.awayLedYet;
      const myTiedAfterLead = isHome ? g.homeTiedAfterLead : g.awayTiedAfterLead;
      const theirTiedAfterLead = isHome ? g.awayTiedAfterLead : g.homeTiedAfterLead;
      const theirLedYet = isHome ? g.awayLedYet : g.homeLedYet;
      const won = isHome ? g.finalH > g.finalA : g.finalA > g.finalH;

      bump(id, (t) => {
        t.pbp_games++;
        if (won) {
          if (theirMaxLead === 0) t.wins_no_trail++;
          if (theirMaxLead === 0 && myLedYet && !myTiedAfterLead) t.wire_wins++;
          for (const m of MARGINS) if (theirMaxLead >= m) t[`wins_trailing_${m}`]++;
        } else {
          if (myMaxLead === 0) t.losses_no_lead++;
          if (myMaxLead === 0 && theirLedYet && !theirTiedAfterLead) t.wire_losses++;
          for (const m of MARGINS) if (myMaxLead >= m) t[`losses_leading_${m}`]++;
        }
      });
    }
  }

  // NO WINS OR LOSSES HERE, deliberately.
  //
  // They were emitted and then removed: build-adjusted-ratings.mjs already
  // counts the record off the game log, which is the authority on which games a
  // season contains, and the play-by-play archive is not complete. CBBD's
  // /plays/date times out on the biggest Saturday slates, so 21% of 2026 teams
  // are short a game or two here — enough that a PBP-derived record would have
  // contradicted the Wins column sitting beside it in the same table.
  //
  // `pbp_games` ships instead: the denominator these counts are actually over,
  // so the gap is visible rather than absorbed into a number that looks whole.
  const out = {};
  for (const [key, t] of totals) out[key] = { ...t };

  console.log(
    `${season}: ${String(Object.keys(out).length).padStart(3)} teams  ` +
    `${String(scored).padStart(5)} games scored from ${files.length} slates ` +
    `(${plays.toLocaleString()} plays` +
    `${unresolved ? `, ${unresolved} unresolved` : ""})`,
  );
  return out;
}

const named = process.argv.slice(2).filter((a) => /^\d{4}$/.test(a)).map(Number);
const list = named.length ? named : SEASONS;

let doc = {};
if (named.length && fs.existsSync(OUT)) {
  try { doc = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch { doc = {}; }
}
for (const s of list) Object.assign(doc, run(s));

fs.writeFileSync(OUT, JSON.stringify(doc));
console.log(
  `\n✓ ${Object.keys(doc).length} team-seasons → ${path.relative(ROOT, OUT)}  ` +
  `${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`,
);
