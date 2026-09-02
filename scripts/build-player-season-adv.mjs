#!/usr/bin/env node
/**
 * build-player-season-adv.mjs — per-player-season advanced aggregates from the
 * CBBD player box archive.
 *
 *   public/data/player-season-adv.json  →  { "<bartId>|<year>": {...} }
 *
 * REPLACES: the `player_game_stats` / `player_on_off_stats` aggregation that
 * export-static-data.mts used to run against Supabase (CBB Analytics'
 * /player-game-stats and /on-off-agg-stats). See docs/data-sources.md.
 *
 * THE JOIN: CBBD keys players by its own `athleteId`; the entire site keys them
 * by `bart_player_id`. There is no id correspondence, so players are matched on
 * (season, Bart team name, normalized player name). That is a tight key — a
 * team-season roster is ~15 people — which is why it resolves at a high rate
 * without any fuzzy distance matching. Team names come through the shared
 * CBBD↔Bart map so this can never disagree with the game-log build.
 *
 * WHAT HAPPENED TO PLUS/MINUS: it is gone, and it is not coming back for
 * 2014-2023. On-court plus/minus requires knowing who was on the floor, and
 * CBBD's play-by-play carries no `onFloor` data and no substitution events
 * before 2024 — so lineups cannot be reconstructed at all for those seasons.
 * CBBD's per-player `netRating` is NOT a substitute: it is an individual
 * offensive-minus-defensive rating per 100 possessions (Oliver-style), not team
 * point differential while on the court. Publishing it under a "+/-" label
 * would be a different statistic wearing the old name, so it ships as its own
 * column, `net_rtg`, and the "+/-" column is retired.
 *
 * Usage: node scripts/build-player-season-adv.mjs
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { norm, buildPlayerIndex, resolvePlayer } from "./lib/cbbd-join.mjs";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public/data/player-season-adv.json");
// 2021 JOINED THE RUN 2026-09-02, when box-players-full.json.gz was finally
// pulled. It is NOT excluded site-wide — see FLAGGED_SEASONS in
// src/lib/seasons.ts, which marks the COVID season as incomparable, not as
// absent. What is still missing for it is the play-by-play (~157
// plays-*.json.gz day files), a separate and much larger pull.
const SEASONS = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

const TEAM_MAP = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/cbbd-team-map.json"), "utf8"));

/** Season court time a player needs before net_rtg is meaningful (one game). */
const MIN_MINUTES_FOR_RATING = 40;
/** Plausible band for a single-game individual efficiency rating. */
const ratingInRange = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 300;

const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

/** (season|bartTeamName|normName) → bart_player_id, from the Bart player files. */
function bartIndex(season) {
  const fp = path.join(ROOT, "public/data/players-by-year", `${season}.json`);
  if (!fs.existsSync(fp)) return buildPlayerIndex([]);
  return buildPlayerIndex(JSON.parse(fs.readFileSync(fp, "utf8")));
}

function readPlayerBox(season) {
  const fp = path.join(ROOT, "data/cbbd", String(season), "box-players-full.json.gz");
  if (!fs.existsSync(fp)) return [];
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(fp)).toString());
}

/** Games that survived the log build — keeps this reconcilable with /calc. */
function eligibleGames(season) {
  const fp = path.join(ROOT, `public/data/game-logs-by-year/${season}.json`);
  if (!fs.existsSync(fp)) return null;
  return new Set(JSON.parse(fs.readFileSync(fp, "utf8")).map((g) => g.game_id));
}

const out = {};
for (const season of SEASONS) {
  const bart = bartIndex(season);
  const eligible = eligibleGames(season);
  const rows = readPlayerBox(season);
  if (!rows.length || !bart.exact.size) { console.log(`${season}: skipped (no box or no bart index)`); continue; }

  // bartId → running totals
  const agg = new Map();
  let matched = 0, unmatched = 0;

  for (const r of rows) {
    const team = TEAM_MAP[r.teamId];
    if (!team) continue;
    if (eligible && !eligible.has(`${r.gameId}-${r.teamId}`)) continue;
    if (!Array.isArray(r.players)) continue;
    const tk = norm(team.name);

    for (const p of r.players) {
      if (!p?.name) continue;
      const bartId = resolvePlayer(bart, tk, p.name);
      if (bartId == null) { unmatched++; continue; }
      matched++;
      let a = agg.get(bartId);
      if (!a) {
        // `gsc` is game SCORE, `starts` is games STARTED — two different things
        // one letter apart, so neither gets to be called `gs` here.
        a = { games: 0, starts: 0, min: 0, tov: 0, tovN: 0, usg: 0, usgN: 0, net: 0, netMin: 0, gsc: 0, gscN: 0, toTov: 0, toFga: 0, toFta: 0 };
        agg.set(bartId, a);
      }
      a.games++;
      if (p.starter === true) a.starts++;
      if (typeof p.minutes === "number") a.min += p.minutes;
      if (typeof p.turnovers === "number") { a.tov += p.turnovers; a.tovN++; }
      // Season totals for turnover RATE. Summed rather than averaged per game:
      // TOV% is a ratio of totals, and averaging per-game ratios would weight a
      // 4-minute appearance the same as a 38-minute one.
      if (typeof p.turnovers === "number" && typeof p.fieldGoals?.attempted === "number" && typeof p.freeThrows?.attempted === "number") {
        a.toTov += p.turnovers;
        a.toFga += p.fieldGoals.attempted;
        a.toFta += p.freeThrows.attempted;
      }
      // CBBD sends usage as 0-100; the site stores rates 0-1.
      if (typeof p.usage === "number") { a.usg += p.usage / 100; a.usgN++; }
      // MINUTES-WEIGHTED, unlike the others. An individual offensive/defensive
      // rating is a per-100-possessions rate, so a one-minute cameo can produce
      // values in the thousands: the unweighted season mean ranged from -4613 to
      // +1095, which would have put garbage rows at the top of any Net Rtg sort.
      // Weighting by minutes makes a 1-minute appearance contribute ~1/30th of a
      // full game instead of an equal share.
      //
      // The components are bounded first. CBBD's per-game `offensiveRating` is
      // sometimes corrupt — measured range on 2026 alone is -2227.5 to +3238.3,
      // and a negative points-produced-per-100 is not a thing. `defensiveRating`
      // is well behaved (5.2 to 196) so it's the offensive side that poisons
      // netRating. The p99 of ORtg is 217.7, so a 0-300 window discards only the
      // handful of impossible rows.
      if (
        typeof p.netRating === "number" && typeof p.minutes === "number" && p.minutes > 0 &&
        ratingInRange(p.offensiveRating) && ratingInRange(p.defensiveRating)
      ) {
        a.net += p.netRating * p.minutes;
        a.netMin += p.minutes;
      }
      if (typeof p.gameScore === "number") { a.gsc += p.gameScore; a.gscN++; }
    }
  }

  for (const [bartId, a] of agg) {
    out[`${bartId}|${season}`] = {
      games: a.games,
      // Games STARTED. Nothing else on the site carries it: Bart's season CSV
      // has no such column, so the only place it exists is the per-game
      // `starter` flag, which this loop is already walking.
      gs: a.starts,
      min_pg: r1(a.games > 0 ? a.min / a.games : null),
      tov_pg: r3(a.tovN > 0 ? a.tov / a.tovN : null),
      // The season TOTAL, alongside the per-game rate. The career table's
      // Totals view would otherwise have to multiply tov_pg back up by a games
      // count, and the right multiplier is tovN (games with a turnover number),
      // not `games` — so it ships as its own field rather than as a sum the
      // caller has to reconstruct correctly.
      tov: a.tovN > 0 ? a.tov : null,
      // Turnover rate: share of the possessions a player USES that he ends with
      // a turnover — TOV / (FGA + 0.44·FTA + TOV), the standard formulation.
      // Unlike tov_pg this is usage-adjusted, so a high-minute primary handler
      // is no longer punished for simply touching the ball more.
      // Guarded on a real denominator: a player who never attempted a shot or a
      // free throw has no possessions to have wasted, so the answer is "no
      // data", not 100%.
      tov_pct: r3(a.toFga + 0.44 * a.toFta + a.toTov > 0
        ? a.toTov / (a.toFga + 0.44 * a.toFta + a.toTov)
        : null),
      usage_pct: r3(a.usgN > 0 ? a.usg / a.usgN : null),
      // Minutes-weighting fixes the average but can't rescue a player-season
      // whose entire sample IS one short cameo — all the weight sits on it, so
      // a single 1-minute possession still yields ratings in the thousands.
      // Below one full game of court time the number isn't an estimate of
      // anything, so it's null rather than a leaderboard-topping artifact.
      net_rtg: r1(a.netMin >= MIN_MINUTES_FOR_RATING ? a.net / a.netMin : null),
      game_score_pg: r1(a.gscN > 0 ? a.gsc / a.gscN : null),
    };
  }

  const rate = matched + unmatched > 0 ? (100 * matched) / (matched + unmatched) : 0;
  console.log(
    `${season}: ${agg.size.toLocaleString()} player-seasons  ` +
    `(${matched.toLocaleString()} player-game rows joined, ${rate.toFixed(1)}%; ${unmatched.toLocaleString()} unmatched)`,
  );
}

fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`\n✓ ${Object.keys(out).length.toLocaleString()} player-seasons → ${path.relative(ROOT, OUT)}`);
console.log(`  ${(fs.statSync(OUT).size / 1024 / 1024).toFixed(2)} MB`);
