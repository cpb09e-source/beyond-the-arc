#!/usr/bin/env node
/**
 * build-assist-network.mjs — who feeds whom, per team-season, from the CBBD
 * play-by-play archive.
 *
 *   public/data/assist-network.json      →  { "<team>|<year>": {...} }
 *   public/data/assist-players/<year>.json →  { names, players: { <bartId>: {...} } }
 *
 * TWO VIEWS OF ONE PASS. The team file answers "how does this offense fit
 * together"; the per-year player file answers "who feeds ME, and who do I
 * feed", which is the cut a reader actually recognises themselves in. They come
 * from the same tally because computing them separately would mean walking
 * three million plays a season twice, and would let the two drift.
 *
 * The team file keeps its top sixty connections; the player file is built from
 * the FULL edge set before that cut, because a role player's two or three real
 * connections routinely sit outside a team's top sixty and dropping them would
 * leave their panel empty.
 *
 * WHY THIS IS THE ONLY PASSING STAT AVAILABLE. CBBD's play-by-play has no pass
 * event, no touch, no dribble — the vocabulary is shots, rebounds, turnovers,
 * steals, blocks, fouls and substitutions. The single pass ever recorded is the
 * one immediately preceding a MADE field goal, as `shotInfo.assistedBy`. Every
 * pass into a miss, every swing, every entry pass is invisible. So this is not
 * a passing network in the tracking-data sense and must not be presented as
 * one; it is an assist network, which is a real but much narrower thing.
 *
 * The consequence worth stating on the page: a player who creates good looks
 * that don't go in is indistinguishable here from one who creates nothing.
 *
 * ASSISTED RATE IS OVER MAKES, NOT ATTEMPTS. An assist can only attach to a
 * made basket, so the denominator has to be made field goals or the rate is
 * silently a shooting stat. `rim_ast / rim_fgm` reads "of this player's makes at
 * the rim, what share were set up" — which is the split that separates a
 * finisher from a creator, and it is why the tally is kept per range.
 *
 * FREE THROWS ARE EXCLUDED. `shotInfo.range` includes `free_throw`, which is
 * never assisted and would drag every rate down if counted as a make.
 *
 * IDS ARE BART IDS. The plays carry CBBD player ids, which nothing else on the
 * site keys off, so both ends of every edge are resolved through the same
 * (normalized team | normalized name) index that player-games and player-shots
 * use. An edge is dropped when either end fails to resolve rather than being
 * kept with a dangling id — a network with half its nodes unlinkable is worse
 * than a slightly smaller one.
 *
 * Usage:
 *   node scripts/build-assist-network.mjs
 *   node scripts/build-assist-network.mjs --season 2026
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { buildPlayerIndex, resolvePlayer, norm } from "./lib/cbbd-join.mjs";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "public/data/assist-network.json");
const OUT_PLAYERS = path.join(ROOT, "public/data/assist-players");
const SEASONS = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

const args = process.argv.slice(2);
const oneSeason = args.includes("--season") ? Number(args[args.indexOf("--season") + 1]) : null;

const TEAM_MAP = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/cbbd-team-map.json"), "utf8"));

/** CBBD range → the three buckets we keep. free_throw is deliberately absent. */
const ZONE = { rim: "rim", jumper: "mid", three_pointer: "three" };

/**
 * How many edges survive per team-season. A roster produces a long tail of
 * one-off connections that say nothing — two players who connected once in
 * November are noise, and keeping them would triple the file to describe
 * nothing. 60 is comfortably past where a rotation's real structure ends.
 */
const MAX_EDGES = 60;

// norm() is IMPORTED, not written here. It is the TEAM normalizer and it
// rewrites "st." to "state" — the index is keyed with it, so a local copy that
// merely lowercases produced "st bonaventure" against a stored
// "state bonaventure" and missed every St./Saint school on the board.

const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);
const share = (n, d) => (d > 0 ? r3(n / d) : null);

/** (normTeam|normName) → bart_player_id, for one season. */
function bartIndex(season) {
  const fp = path.join(ROOT, "public/data/players-by-year", `${season}.json`);
  if (!fs.existsSync(fp)) return buildPlayerIndex([]);
  return buildPlayerIndex(JSON.parse(fs.readFileSync(fp, "utf8")));
}

/** Only games the log build kept, so this reconciles with every other stat. */
function eligibleGameIds(season) {
  const fp = path.join(ROOT, `public/data/game-logs-by-year/${season}.json`);
  if (!fs.existsSync(fp)) return null;
  const ids = new Set();
  for (const g of JSON.parse(fs.readFileSync(fp, "utf8"))) {
    const prefix = String(g.game_id ?? "").split("-")[0];
    if (prefix) ids.add(Number(prefix));
  }
  return ids;
}

function blankTeam() {
  return {
    games: new Set(),
    /** "passer>shooter" → { n, rim, mid, three } */
    edges: new Map(),
    /** bartId → per-player tallies */
    players: new Map(),
    /** bartId → display name, for the panel */
    names: new Map(),
  };
}

function blankPlayer() {
  return {
    fgm: 0, ast_fgm: 0,
    rim_fgm: 0, rim_ast: 0,
    mid_fgm: 0, mid_ast: 0,
    three_fgm: 0, three_ast: 0,
    ast_given: 0,
  };
}

/** Top N of a tally map, as [otherId, count] pairs. */
function topPairs(map, n) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function run(season) {
  const dir = path.join(ROOT, "data/cbbd", String(season));
  if (!fs.existsSync(dir)) return {};
  const files = fs.readdirSync(dir).filter((f) => f.startsWith("plays-") && f.endsWith(".json.gz"));
  if (files.length === 0) {
    console.log(`${season}: no play-by-play on disk — skipped`);
    return {};
  }

  const bart = bartIndex(season);
  if (!bart.exact.size) {
    console.log(`${season}: no players-by-year index — skipped`);
    return {};
  }
  const eligible = eligibleGameIds(season);

  const teams = new Map();
  /** bartId → this season's connections in both directions. */
  const playerView = new Map();
  /** bartId → name, across every team in the season. */
  const allNames = new Map();
  let makes = 0, assisted = 0, unmatched = 0;

  // The API's /plays/date buckets by UTC, so a 7pm-ET game appears in BOTH its
  // ET date's pull and the next UTC day's. Measured on 2026: 1,337 of 6,263
  // games (21.3%) are present twice. Without this every count from those games
  // was doubled. Rates survived it — numerator and denominator doubled
  // together — which is why it went unnoticed, but any total did not.
  // cbbd-build-stints.mjs has always guarded this; these two did not.
  const seenGames = new Set();

  for (const f of files) {
    let rows;
    try {
      rows = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, f))).toString());
    } catch (e) {
      console.warn(`   ! ${f}: ${e.message}`);
      continue;
    }

    // Claim each game for the first file it appears in, before any play from
    // it is counted.
    const firstSeen = new Set();
    for (const p of rows) {
      if (seenGames.has(p.gameId) && !firstSeen.has(p.gameId)) continue;
      firstSeen.add(p.gameId);
      seenGames.add(p.gameId);

      const si = p.shotInfo;
      if (!si || !si.made) continue;              // assists attach to makes only
      const zone = ZONE[si.range];
      if (!zone) continue;                        // drops free throws
      const team = TEAM_MAP[p.teamId];
      if (!team?.name) continue;
      if (eligible && !eligible.has(p.gameId)) continue;

      const shooterName = si.shooter?.name;
      if (!shooterName) continue;
      const tk = norm(team.name);
      const shooterId = resolvePlayer(bart, tk, shooterName);
      if (shooterId == null) { unmatched++; continue; }

      makes++;
      const key = `${team.name}|${season}`;
      let t = teams.get(key);
      if (!t) { t = blankTeam(); teams.set(key, t); }
      t.games.add(p.gameId);
      t.names.set(shooterId, shooterName);

      let sp = t.players.get(shooterId);
      if (!sp) { sp = blankPlayer(); t.players.set(shooterId, sp); }
      sp.fgm++;
      sp[`${zone}_fgm`]++;

      if (!si.assisted) continue;
      const passerName = si.assistedBy?.name;
      if (!passerName) continue;
      const passerId = resolvePlayer(bart, tk, passerName);
      // Dangling edge — keep the shooter's make, drop the connection.
      if (passerId == null) { unmatched++; continue; }

      assisted++;
      t.names.set(passerId, passerName);
      sp.ast_fgm++;
      sp[`${zone}_ast`]++;

      let pp = t.players.get(passerId);
      if (!pp) { pp = blankPlayer(); t.players.set(passerId, pp); }
      pp.ast_given++;

      const ek = `${passerId}>${shooterId}`;
      let e = t.edges.get(ek);
      if (!e) { e = { n: 0, rim: 0, mid: 0, three: 0 }; t.edges.set(ek, e); }
      e.n++;
      e[zone]++;
    }
    rows = null;
  }

  const out = {};
  for (const [key, t] of teams) {
    const edges = [...t.edges.entries()]
      .map(([ek, e]) => {
        const [a, b] = ek.split(">").map(Number);
        return [a, b, e.n, e.rim, e.mid, e.three];
      })
      .sort((x, y) => y[2] - x[2])
      .slice(0, MAX_EDGES);

    // Only the players an edge or a make actually names — not the roster.
    const keep = new Set(edges.flatMap(([a, b]) => [a, b]));
    for (const [id, pl] of t.players) if (pl.fgm > 0 || pl.ast_given > 0) keep.add(id);

    const players = {};
    for (const id of keep) {
      const pl = t.players.get(id);
      if (!pl) continue;
      players[id] = {
        fgm: pl.fgm,
        ast_given: pl.ast_given,
        ast_rate: share(pl.ast_fgm, pl.fgm),
        rim_ast_rate: share(pl.rim_ast, pl.rim_fgm),
        mid_ast_rate: share(pl.mid_ast, pl.mid_fgm),
        three_ast_rate: share(pl.three_ast, pl.three_fgm),
      };
    }

    const names = {};
    for (const id of keep) if (t.names.has(id)) names[id] = t.names.get(id);

    out[key] = { games: t.games.size, edges, players, names };

    // ---- the per-player view, from the FULL edge set, not the trimmed one.
    const teamName = key.split("|")[0];
    for (const [ek, e] of t.edges) {
      const [passer, shooter] = ek.split(">").map(Number);
      for (const [id, other, dir] of [[passer, shooter, "fed"], [shooter, passer, "fed_by"]]) {
        let pv = playerView.get(id);
        if (!pv) {
          pv = { team: teamName, fed: new Map(), fed_by: new Map() };
          playerView.set(id, pv);
        }
        pv[dir].set(other, (pv[dir].get(other) ?? 0) + e.n);
      }
    }
    for (const [id, pl] of t.players) {
      let pv = playerView.get(id);
      if (!pv) { pv = { team: teamName, fed: new Map(), fed_by: new Map() }; playerView.set(id, pv); }
      pv.fgm = pl.fgm;
      pv.ast_given = pl.ast_given;
      pv.ast_rate = share(pl.ast_fgm, pl.fgm);
      pv.rim_ast_rate = share(pl.rim_ast, pl.rim_fgm);
      pv.mid_ast_rate = share(pl.mid_ast, pl.mid_fgm);
      pv.three_ast_rate = share(pl.three_ast, pl.three_fgm);
    }
    for (const [id, name] of t.names) allNames.set(id, name);
  }

  // Write the player view for this season.
  if (playerView.size) {
    const players = {};
    const referenced = new Set();
    for (const [id, pv] of playerView) {
      const fed = topPairs(pv.fed, 6);
      const fedBy = topPairs(pv.fed_by, 6);
      if (!fed.length && !fedBy.length && !pv.fgm) continue;
      players[id] = {
        team: pv.team,
        fed, fed_by: fedBy,
        fgm: pv.fgm ?? 0,
        ast_given: pv.ast_given ?? 0,
        ast_rate: pv.ast_rate ?? null,
        rim_ast_rate: pv.rim_ast_rate ?? null,
        mid_ast_rate: pv.mid_ast_rate ?? null,
        three_ast_rate: pv.three_ast_rate ?? null,
      };
      referenced.add(id);
      for (const [o] of fed) referenced.add(o);
      for (const [o] of fedBy) referenced.add(o);
    }
    // Only the names an entry actually points at — the roster of every team in
    // the country would be most of the file.
    const names = {};
    for (const id of referenced) if (allNames.has(id)) names[id] = allNames.get(id);

    fs.mkdirSync(OUT_PLAYERS, { recursive: true });
    fs.writeFileSync(
      path.join(OUT_PLAYERS, `${season}.json`),
      JSON.stringify({ names, players }),
    );
  }

  console.log(
    `${season}: ${Object.keys(out).length} team-seasons  ` +
    `(${makes.toLocaleString()} makes, ${assisted.toLocaleString()} assisted` +
    `${unmatched ? `, ${unmatched.toLocaleString()} unresolved names dropped` : ""})`,
  );
  return out;
}

const list = oneSeason ? [oneSeason] : SEASONS;
console.log(`Building assist networks for ${list.length} season(s)…\n`);
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
