#!/usr/bin/env node
/**
 * build-shot-distribution.mjs — rim / mid-range / three-point shot distribution
 * per team-season, from the CBBD play-by-play archive.
 *
 *   public/data/shot-distribution.json  →  { "<team>|<year>": {...} }
 *
 * Every shot play in CBBD's PBP carries `shotInfo.range`, and its values map
 * one-to-one onto the three zones we want:
 *
 *   rim           → RIM
 *   jumper        → MID
 *   three_pointer → 3PT
 *   free_throw    → excluded (not a field-goal attempt)
 *
 * So this is a straight tally, not shot-chart geometry. `shotInfo.location`
 * (x/y) is present on ~72% of shots and is deliberately unused — the `range`
 * label is on 100% of them, and inferring zones from coordinates would produce a
 * different answer for the 28% with no coordinates.
 *
 * BOTH SIDES ARE TALLIED. `rim_rate` etc. is the share of a team's OWN field-goal
 * attempts; `rim_rate_def` is the share of attempts its OPPONENTS took from
 * there, which is the more interesting half (funnelling opponents off the rim is
 * a defensive scheme, not luck).
 *
 * COVERAGE IS PARTIAL BY DESIGN. PBP is only ingested for the seasons listed by
 * scripts/cbbd-ingest.mjs, so a team-season with no plays on disk is absent from
 * the output rather than present with zeros — the same rule the point-split
 * aggregation follows. `shot_games` reports how many of a team's games actually
 * contributed, so a thin sample is visible instead of silent.
 *
 * Usage:
 *   node scripts/build-shot-distribution.mjs
 *   node scripts/build-shot-distribution.mjs --season 2026
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public/data/shot-distribution.json");
const SEASONS = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

const args = process.argv.slice(2);
const oneSeason = args.includes("--season") ? Number(args[args.indexOf("--season") + 1]) : null;

const TEAM_MAP = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/cbbd-team-map.json"), "utf8"));

/** CBBD range label → our zone. Anything else (free_throw, unknown) is skipped. */
const ZONE = { rim: "rim", jumper: "mid", three_pointer: "three" };

const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);
const share = (n, d) => (d > 0 ? r3(n / d) : null);

/** Only count games the log build kept, so this reconciles with every other stat. */
function eligibleGameIds(season) {
  const fp = path.join(ROOT, `public/data/game-logs-by-year/${season}.json`);
  if (!fs.existsSync(fp)) return null;
  const ids = new Set();
  for (const g of JSON.parse(fs.readFileSync(fp, "utf8"))) {
    // game_id is "<cbbdGameId>-<teamId>"; the prefix is the game.
    const prefix = String(g.game_id ?? "").split("-")[0];
    if (prefix) ids.add(Number(prefix));
  }
  return ids;
}

function blank() {
  return {
    rim: 0, mid: 0, three: 0,
    rim_def: 0, mid_def: 0, three_def: 0,
    games: new Set(),
  };
}

function run(season) {
  const dir = path.join(ROOT, "data/cbbd", String(season));
  if (!fs.existsSync(dir)) return {};
  const files = fs.readdirSync(dir).filter((f) => f.startsWith("plays-") && f.endsWith(".json.gz"));
  if (files.length === 0) { console.log(`${season}: no play-by-play on disk — skipped`); return {}; }

  const eligible = eligibleGameIds(season);
  const totals = new Map();

  // Per game, we need each side's teamId to attribute "allowed" shots. The plays
  // carry teamId + opponentId directly, so no roster lookup is needed.
  let plays = 0, shots = 0, skippedGames = 0;

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
      if (eligible && !eligible.has(p.gameId)) { skippedGames++; continue; }
      const zone = ZONE[p.shotInfo?.range];
      if (!zone) continue;
      const shooter = TEAM_MAP[p.teamId];
      const defender = TEAM_MAP[p.opponentId];
      shots++;
      if (shooter) {
        const key = `${shooter.name}|${season}`;
        let a = totals.get(key);
        if (!a) { a = blank(); totals.set(key, a); }
        a[zone]++;
        a.games.add(p.gameId);
      }
      if (defender) {
        const key = `${defender.name}|${season}`;
        let a = totals.get(key);
        if (!a) { a = blank(); totals.set(key, a); }
        a[`${zone}_def`]++;
        a.games.add(p.gameId);
      }
    }
  }

  const out = {};
  for (const [key, a] of totals) {
    const fga = a.rim + a.mid + a.three;
    const fgaDef = a.rim_def + a.mid_def + a.three_def;
    if (fga === 0 && fgaDef === 0) continue;
    out[key] = {
      shot_games: a.games.size,
      rim_rate: share(a.rim, fga),
      mid_rate: share(a.mid, fga),
      three_rate: share(a.three, fga),
      rim_rate_def: share(a.rim_def, fgaDef),
      mid_rate_def: share(a.mid_def, fgaDef),
      three_rate_def: share(a.three_def, fgaDef),
    };
  }

  console.log(
    `${season}: ${Object.keys(out).length} team-seasons from ${files.length} slates  ` +
    `(${shots.toLocaleString()} shots of ${plays.toLocaleString()} plays` +
    `${skippedGames ? `, ${skippedGames.toLocaleString()} plays in non-eligible games` : ""})`,
  );
  return out;
}

const list = oneSeason ? [oneSeason] : SEASONS;
console.log(`Tallying shot distribution for ${list.length} season(s)…\n`);
const all = {};
for (const s of list) Object.assign(all, run(s));

// Merge so a single-season re-run doesn't discard the rest.
let existing = {};
if (fs.existsSync(OUT)) {
  try { existing = JSON.parse(fs.readFileSync(OUT, "utf8")); } catch { existing = {}; }
}
const merged = { ...existing, ...all };
fs.writeFileSync(OUT, JSON.stringify(merged));
console.log(`\n✓ ${Object.keys(merged).length} team-seasons → ${path.relative(ROOT, OUT)}`);
